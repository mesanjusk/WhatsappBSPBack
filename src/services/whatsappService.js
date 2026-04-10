const WhatsAppAccount = require('../repositories/whatsappAccount');
const AppError = require('../utils/AppError');
const { decrypt, encrypt } = require('../utils/crypto');
const {
  exchangeForLongLivedToken,
  sendMessage,
  fetchTemplates,
} = require('./metaApiService');

const REFRESH_BUFFER_MS = 7 * 24 * 60 * 60 * 1000; // refresh 7 days before expiry

// ------------------------------
// Helpers
// ------------------------------

const normalizeNumber = (number) => {
  if (!number) throw new AppError('Recipient number is required', 400);
  return String(number).replace(/\D/g, '');
};

const ensureAccountOwnership = async (accountId, userId) => {
  const account = await WhatsAppAccount.findOne({ _id: accountId, userId });
  if (!account) {
    throw new AppError('WhatsApp account not found or access denied', 404);
  }
  return account;
};

const refreshTokenIfNeeded = async (account) => {
  const expiresAt = new Date(account.tokenExpiresAt).getTime();
  const now = Date.now();

  // Token still valid
  if (expiresAt - now > REFRESH_BUFFER_MS) {
    return decrypt(account.accessToken);
  }

  // Refresh required
  const currentToken = decrypt(account.accessToken);

  const refreshed = await exchangeForLongLivedToken(currentToken);

  const newToken = refreshed.access_token || currentToken;
  const expiresIn = Number(refreshed.expires_in || 60 * 24 * 60 * 60);

  account.accessToken = encrypt(newToken);
  account.tokenExpiresAt = new Date(now + expiresIn * 1000);
  await account.save();

  return newToken;
};

const validateSessionPolicy = (customerLastMessageAt) => {
  if (!customerLastMessageAt) {
    throw new AppError(
      'customerLastMessageAt required for session text message',
      400
    );
  }

  const lastMessageTime = new Date(customerLastMessageAt).getTime();
  const twentyFourHoursMs = 24 * 60 * 60 * 1000;

  if (
    Number.isNaN(lastMessageTime) ||
    Date.now() - lastMessageTime > twentyFourHoursMs
  ) {
    throw new AppError(
      'Session window expired. Use a template message.',
      400
    );
  }
};

// ------------------------------
// Message Senders
// ------------------------------

const sendTextMessage = async ({
  accountId,
  userId,
  to,
  body,
  customerLastMessageAt,
}) => {
  validateSessionPolicy(customerLastMessageAt);

  const account = await ensureAccountOwnership(accountId, userId);
  const accessToken = await refreshTokenIfNeeded(account);

  return sendMessage({
    phoneNumberId: account.phoneNumberId,
    accessToken,
    payload: {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: normalizeNumber(to),
      type: 'text',
      text: {
        preview_url: false,
        body,
      },
    },
  });
};

const sendTemplateMessage = async ({
  accountId,
  userId,
  to,
  templateName,
  languageCode = 'en_US',
  components = [],
}) => {
  const account = await ensureAccountOwnership(accountId, userId);
  const accessToken = await refreshTokenIfNeeded(account);

  return sendMessage({
    phoneNumberId: account.phoneNumberId,
    accessToken,
    payload: {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: normalizeNumber(to),
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode },
        components,
      },
    },
  });
};

const sendMediaMessage = async ({
  accountId,
  userId,
  to,
  mediaType,
  mediaId,
  link,
  caption,
}) => {
  const supportedTypes = ['image', 'document', 'video', 'audio'];

  if (!supportedTypes.includes(mediaType)) {
    throw new AppError(
      `Unsupported mediaType. Allowed: ${supportedTypes.join(', ')}`,
      400
    );
  }

  const account = await ensureAccountOwnership(accountId, userId);
  const accessToken = await refreshTokenIfNeeded(account);

  const mediaPayload = {};
  if (caption) mediaPayload.caption = caption;
  if (mediaId) mediaPayload.id = mediaId;
  if (link) mediaPayload.link = link;

  return sendMessage({
    phoneNumberId: account.phoneNumberId,
    accessToken,
    payload: {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: normalizeNumber(to),
      type: mediaType,
      [mediaType]: mediaPayload,
    },
  });
};

const syncApprovedTemplates = async ({ accountId, userId }) => {
  const account = await ensureAccountOwnership(accountId, userId);
  const accessToken = await refreshTokenIfNeeded(account);

  const templates = await fetchTemplates({
    wabaId: account.wabaId,
    accessToken,
  });

  return (templates.data || []).filter(
    (item) => item.status === 'APPROVED'
  );
};

module.exports = {
  sendTextMessage,
  sendTemplateMessage,
  sendMediaMessage,
  syncApprovedTemplates,
};