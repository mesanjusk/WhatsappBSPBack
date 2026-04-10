const WhatsAppAccount = require('../repositories/whatsappAccount');
const AppError = require('../utils/AppError');
const { decrypt, encrypt } = require('../utils/crypto');
const {
  exchangeForLongLivedToken,
  sendMessage,
  fetchTemplates,
} = require('./metaApiService');

const REFRESH_BUFFER_MS = 7 * 24 * 60 * 60 * 1000;

const ensureAccountOwnership = async (accountId, userId) => {
  const account = await WhatsAppAccount.findOne({ _id: accountId, userId });
  if (!account) {
    throw new AppError('WhatsApp account not found or access denied', 404);
  }
  return account;
};

const refreshTokenIfNeeded = async (account) => {
  const expiresAt = new Date(account.tokenExpiresAt).getTime();
  if (expiresAt - Date.now() > REFRESH_BUFFER_MS) {
    return { account, accessToken: decrypt(account.accessToken) };
  }

  const currentToken = decrypt(account.accessToken);
  const refreshed = await exchangeForLongLivedToken(currentToken);
  const newToken = refreshed.access_token || currentToken;
  const expiresIn = Number(refreshed.expires_in || 60 * 24 * 60 * 60);

  account.accessToken = encrypt(newToken);
  account.tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);
  await account.save();

  return { account, accessToken: newToken };
};

const validatePolicy = ({ type, customerLastMessageAt }) => {
  if (type === 'text') {
    if (!customerLastMessageAt) {
      throw new AppError('customerLastMessageAt is required for session text messages', 400);
    }

    const lastMessageTime = new Date(customerLastMessageAt).getTime();
    const twentyFourHoursMs = 24 * 60 * 60 * 1000;
    if (Number.isNaN(lastMessageTime) || Date.now() - lastMessageTime > twentyFourHoursMs) {
      throw new AppError('Session window expired. Use a pre-approved template message.', 400);
    }
  }
};

const sendTextMessage = async ({ accountId, userId, to, body, customerLastMessageAt }) => {
  validatePolicy({ type: 'text', customerLastMessageAt });

  const account = await ensureAccountOwnership(accountId, userId);
  const { accessToken } = await refreshTokenIfNeeded(account);

  return sendMessage({
    phoneNumberId: account.phoneNumberId,
    accessToken,
    payload: {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { preview_url: false, body },
    },
  });
};

const sendTemplateMessage = async ({ accountId, userId, to, templateName, languageCode, components = [] }) => {
  const account = await ensureAccountOwnership(accountId, userId);
  const { accessToken } = await refreshTokenIfNeeded(account);

  return sendMessage({
    phoneNumberId: account.phoneNumberId,
    accessToken,
    payload: {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode || 'en_US' },
        components,
      },
    },
  });
};

const sendMediaMessage = async ({ accountId, userId, to, mediaType, mediaId, link, caption }) => {
  const supportedTypes = ['image', 'document', 'video', 'audio'];
  if (!supportedTypes.includes(mediaType)) {
    throw new AppError(`Unsupported mediaType. Allowed: ${supportedTypes.join(', ')}`, 400);
  }

  const account = await ensureAccountOwnership(accountId, userId);
  const { accessToken } = await refreshTokenIfNeeded(account);

  const mediaPayload = { caption };
  if (mediaId) mediaPayload.id = mediaId;
  if (link) mediaPayload.link = link;

  return sendMessage({
    phoneNumberId: account.phoneNumberId,
    accessToken,
    payload: {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: mediaType,
      [mediaType]: mediaPayload,
    },
  });
};

const syncApprovedTemplates = async ({ accountId, userId }) => {
  const account = await ensureAccountOwnership(accountId, userId);
  const { accessToken } = await refreshTokenIfNeeded(account);
  const templates = await fetchTemplates({ wabaId: account.wabaId, accessToken });

  const approved = (templates.data || []).filter((item) => item.status === 'APPROVED');
  return approved;
};

module.exports = {
  ensureAccountOwnership,
  refreshTokenIfNeeded,
  sendTextMessage,
  sendTemplateMessage,
  sendMediaMessage,
  syncApprovedTemplates,
};
