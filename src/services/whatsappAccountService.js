const WhatsAppAccount = require('../repositories/whatsappAccount');
const AppError = require('../utils/AppError');
const { decryptSensitiveValue } = require('../utils/crypto');

const graphVersion = () => process.env.WHATSAPP_API_VERSION || process.env.META_API_VERSION || 'v19.0';

const sanitizeAccount = (accountDoc) => {
  if (!accountDoc) return null;
  const account = typeof accountDoc.toObject === 'function' ? accountDoc.toObject() : { ...accountDoc };
  delete account.accessTokenEncrypted;
  delete account.accessToken;
  return account;
};

const resolveLegacyEnvConfig = () => {
  const accessToken = String(process.env.WHATSAPP_ACCESS_TOKEN || '').trim();
  const phoneNumberId = String(process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
  if (!accessToken || !phoneNumberId) return null;

  return {
    source: 'legacy-env',
    graphVersion: graphVersion(),
    accessToken,
    phoneNumberId,
    wabaId: String(process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || process.env.WABA_ID || '').trim(),
    businessAccountId: String(process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '').trim(),
    verifiedName: '',
    displayPhoneNumber: phoneNumberId,
    status: 'active',
    webhookSubscribed: false,
  };
};

const toAccountContext = (account) => {
  let accessToken = '';

  if (account.accessTokenEncrypted) {
    try {
      accessToken = decryptSensitiveValue(account.accessTokenEncrypted);
    } catch (_error) {
      throw new AppError('Connected WhatsApp account token is invalid', 500);
    }
  } else if (account.accessToken) {
    accessToken = String(account.accessToken);
  }

  return {
    source: 'database',
    graphVersion: graphVersion(),
    accessToken,
    phoneNumberId: String(account.phoneNumberId || ''),
    wabaId: String(account.wabaId || ''),
    businessAccountId: String(account.businessAccountId || ''),
    verifiedName: String(account.verifiedName || ''),
    displayPhoneNumber: String(account.displayPhoneNumber || ''),
    status: account.status,
    webhookSubscribed: Boolean(account.webhookSubscribed),
    account,
  };
};

const loadActiveWhatsAppAccountForUser = async (userId, options = {}) => {
  const { requireAccount = true } = options;

  let account = await WhatsAppAccount.findOne({ userId, isActive: true, status: { $ne: 'disconnected' } })
    .sort({ updatedAt: -1 })
    .lean();

  if (!account) {
    account = await WhatsAppAccount.findOne({ userId, status: { $ne: 'disconnected' } }).sort({ updatedAt: -1 }).lean();
  }

  if (!account) {
    const legacy = resolveLegacyEnvConfig();
    if (legacy) return legacy;
    if (!requireAccount) return null;
    throw new AppError('No active WhatsApp account connected', 404);
  }

  return toAccountContext(account);
};

const loadWhatsAppAccountByPhoneNumberId = async (phoneNumberId, options = {}) => {
  const { requireAccount = true } = options;
  if (!phoneNumberId) {
    if (!requireAccount) return null;
    throw new AppError('phoneNumberId is required', 400);
  }

  const account = await WhatsAppAccount.findOne({
    phoneNumberId: String(phoneNumberId),
    status: { $ne: 'disconnected' },
  })
    .sort({ isActive: -1, updatedAt: -1 })
    .lean();

  if (!account) {
    if (!requireAccount) return null;
    throw new AppError('No WhatsApp account matched for phone number', 404);
  }

  return toAccountContext(account);
};

const resolveCurrentWhatsAppAccount = async (req, options = {}) => {
  if (!req.user?.id) throw new AppError('Unauthorized', 401);
  const resolved = await loadActiveWhatsAppAccountForUser(req.user.id, options);
  req.whatsappAccountContext = resolved;
  return resolved;
};

module.exports = {
  sanitizeAccount,
  resolveLegacyEnvConfig,
  loadActiveWhatsAppAccountForUser,
  loadWhatsAppAccountByPhoneNumberId,
  resolveCurrentWhatsAppAccount,
};
