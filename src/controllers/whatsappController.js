const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const axios = require('axios');
const crypto = require('crypto');
const Message = require('../repositories/Message');
const Contact = require('../repositories/contact');
const AutoReply = require('../repositories/AutoReply');
const CampaignMessageStatus = require('../repositories/CampaignMessageStatus');
const WhatsAppAccount = require('../repositories/whatsappAccount');
const { emitNewMessage } = require('../socket');
const { resolveAutoReplyRule, resolveReplyDelayMs } = require('../middleware/autoReply');
const {
  uploadWhatsAppMediaToCloudinary,
  uploadBufferToCloudinary,
} = require('../services/whatsappMediaService');
const {
  checkWhatsAppHealth,
  classifyWhatsAppApiError,
  validateWhatsAppConfig,
} = require('../services/whatsappHealthService');
const { encryptSensitiveValue } = require('../utils/crypto');
const {
  resolveCurrentWhatsAppAccount,
  sanitizeAccount,
  loadActiveWhatsAppAccountForUser,
  loadWhatsAppAccountByPhoneNumberId,
} = require('../services/whatsappAccountService');

const normalizePhone = (v) => String(v || '').replace(/\D/g, '');
const RESOLVED_API_VERSION = process.env.WHATSAPP_API_VERSION || 'v19.0';

const ensureWhatsAppMessagingConfig = (config) => {
  const validated = validateWhatsAppConfig(config || {});
  if (!validated.ok) throw new AppError('Missing WhatsApp configuration', 400);
  return validated;
};

const normalizeWhatsAppApiError = (error, fallbackMessage = 'WhatsApp API request failed') => {
  const normalized = classifyWhatsAppApiError(error);
  const statusCode = normalized.code === 'INVALID_CONFIG' ? 400 : normalized.code === 'TOKEN_EXPIRED' ? 401 : 502;

  const sanitizedMessage =
    normalized.code === 'TOKEN_EXPIRED'
      ? 'WhatsApp authorization failed'
      : normalized.code === 'INVALID_CONFIG'
      ? 'Missing WhatsApp configuration'
      : fallbackMessage;

  return new AppError(sanitizedMessage, statusCode);
};

const callWhatsAppMessagesApi = async (payload, accountContext, { fallbackMessage } = {}) => {
  const { accessToken, graphVersion, phoneNumberId } = ensureWhatsAppMessagingConfig(accountContext);

  try {
    const response = await axios.post(
      `https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );

    return response.data;
  } catch (error) {
    throw normalizeWhatsAppApiError(error, fallbackMessage || 'Failed to send WhatsApp message');
  }
};

const saveAndEmitMessage = async (payload) => {
  if (payload.messageId) {
    const existing = await Message.findOne({
      messageId: payload.messageId,
      ...(payload.whatsappAccountId ? { whatsappAccountId: payload.whatsappAccountId } : {}),
    }).lean();
    if (existing) return { message: existing, isDuplicate: true };
  }

  const savedMessage = await Message.create(payload);
  emitNewMessage(savedMessage.toObject());
  return { message: savedMessage, isDuplicate: false };
};

const dispatchTextMessage = async ({ accountContext, userId, to, body, campaignId = '' }) => {
  const normalizedTo = normalizePhone(to);
  if (!normalizedTo) throw new AppError('Invalid recipient number', 400);

  const data = await callWhatsAppMessagesApi(
    {
      messaging_product: 'whatsapp',
      to: normalizedTo,
      type: 'text',
      text: { body },
    },
    accountContext,
    { fallbackMessage: 'Failed to send WhatsApp text message' }
  );

  const messageId = data?.messages?.[0]?.id || '';
  await saveAndEmitMessage({
    userId,
    whatsappAccountId: accountContext?.account?._id,
    fromMe: true,
    from: accountContext.phoneNumberId || '',
    to: normalizedTo,
    message: body,
    body,
    text: body,
    timestamp: new Date(),
    time: new Date(),
    status: 'sent',
    direction: 'outgoing',
    type: 'text',
    messageId,
  });

  if (campaignId && messageId) {
    await CampaignMessageStatus.updateOne(
      {
        userId,
        whatsappAccountId: accountContext?.account?._id,
        messageId,
        status: 'sent',
      },
      {
        $setOnInsert: {
          userId,
          whatsappAccountId: accountContext?.account?._id,
          messageId,
          status: 'sent',
          timestamp: new Date(),
          campaignId,
        },
      },
      { upsert: true }
    );
  }

  return data;
};

const dispatchTemplateMessage = async ({ accountContext, userId, to, templateName, language = 'en_US', components = [], campaignId = '' }) => {
  const normalizedTo = normalizePhone(to);
  if (!normalizedTo) throw new AppError('Invalid recipient number', 400);

  const data = await callWhatsAppMessagesApi(
    {
      messaging_product: 'whatsapp',
      to: normalizedTo,
      type: 'template',
      template: {
        name: templateName,
        language: { code: language },
        components,
      },
    },
    accountContext,
    { fallbackMessage: 'Failed to send WhatsApp template message' }
  );

  const messageId = data?.messages?.[0]?.id || '';
  await saveAndEmitMessage({
    userId,
    whatsappAccountId: accountContext?.account?._id,
    fromMe: true,
    from: accountContext.phoneNumberId || '',
    to: normalizedTo,
    message: templateName,
    body: templateName,
    text: templateName,
    timestamp: new Date(),
    time: new Date(),
    status: 'sent',
    direction: 'outgoing',
    type: 'template',
    messageId,
  });

  if (campaignId && messageId) {
    await CampaignMessageStatus.updateOne(
      {
        userId,
        whatsappAccountId: accountContext?.account?._id,
        messageId,
        status: 'sent',
      },
      {
        $setOnInsert: {
          userId,
          whatsappAccountId: accountContext?.account?._id,
          messageId,
          status: 'sent',
          timestamp: new Date(),
          campaignId,
        },
      },
      { upsert: true }
    );
  }

  return data;
};

const dispatchMediaMessage = async ({ accountContext, userId, to, type, link, caption = '', filename = '' }) => {
  const normalizedTo = normalizePhone(to);
  if (!normalizedTo) throw new AppError('Invalid recipient number', 400);

  const payload = {
    messaging_product: 'whatsapp',
    to: normalizedTo,
    type,
    [type]: {
      link,
      ...(caption ? { caption } : {}),
      ...(filename && type === 'document' ? { filename } : {}),
    },
  };

  const data = await callWhatsAppMessagesApi(payload, accountContext, {
    fallbackMessage: 'Failed to send WhatsApp media message',
  });

  const messageId = data?.messages?.[0]?.id || '';
  await saveAndEmitMessage({
    userId,
    whatsappAccountId: accountContext?.account?._id,
    fromMe: true,
    from: accountContext.phoneNumberId || '',
    to: normalizedTo,
    message: caption || link,
    body: caption || link,
    text: caption || '',
    mediaUrl: link,
    caption,
    filename,
    timestamp: new Date(),
    time: new Date(),
    status: 'sent',
    direction: 'outgoing',
    type,
    messageId,
  });

  return data;
};

const getConnectConfig = asyncHandler(async (_req, res) => {
  return res.status(200).json({
    success: true,
    data: {
      appId: process.env.META_APP_ID || '',
      configId: process.env.META_EMBEDDED_SIGNUP_CONFIG_ID || '',
      apiVersion: RESOLVED_API_VERSION,
    },
  });
});

const exchangeMetaToken = asyncHandler(async (req, res) => {
  const {
    accessToken,
    phoneNumberId,
    wabaId,
    businessId,
    businessAccountId,
    displayName,
    displayPhoneNumber,
    verifiedName,
    tokenType,
    expiresIn,
    metadata,
  } = req.body || {};

  if (!accessToken || !phoneNumberId) {
    throw new AppError('accessToken and phoneNumberId are required', 400);
  }

  const account = await WhatsAppAccount.findOneAndUpdate(
    { userId: req.user?.id, phoneNumberId: String(phoneNumberId) },
    {
      $set: {
        userId: req.user?.id,
        phoneNumberId: String(phoneNumberId),
        wabaId: String(wabaId || ''),
        businessAccountId: String(businessAccountId || businessId || ''),
        displayPhoneNumber: String(displayPhoneNumber || displayName || phoneNumberId),
        verifiedName: String(verifiedName || ''),
        accessTokenEncrypted: encryptSensitiveValue(String(accessToken)),
        tokenType: String(tokenType || 'Bearer'),
        tokenExpiresAt: expiresIn ? new Date(Date.now() + Number(expiresIn) * 1000) : null,
        status: 'active',
        isActive: true,
        connectedAt: new Date(),
        lastSyncAt: new Date(),
        metadata: metadata && typeof metadata === 'object' ? metadata : {},
      },
    },
    { upsert: true, new: true }
  );

  await WhatsAppAccount.updateMany(
    { userId: req.user?.id, _id: { $ne: account._id }, isActive: true },
    { $set: { isActive: false } }
  );

  return res.status(200).json({ success: true, data: sanitizeAccount(account) });
});

const completeConnection = exchangeMetaToken;
const manualConnect = exchangeMetaToken;

const listAccounts = asyncHandler(async (req, res) => {
  const accounts = await WhatsAppAccount.find({ userId: req.user?.id }).sort({ createdAt: -1 }).lean();
  return res.status(200).json({ success: true, data: accounts.map(sanitizeAccount) });
});

const getAccount = asyncHandler(async (req, res) => {
  const active = await loadActiveWhatsAppAccountForUser(req.user?.id, { requireAccount: false });
  if (!active) {
    return res.status(200).json({ success: true, data: null });
  }

  if (active.source === 'legacy-env') {
    return res.status(200).json({
      success: true,
      data: {
        source: 'legacy-env',
        phoneNumberId: active.phoneNumberId || '',
        displayPhoneNumber: active.displayPhoneNumber || '',
        wabaId: active.wabaId || '',
        businessAccountId: active.businessAccountId || '',
        status: active.status || 'active',
      },
    });
  }

  return res.status(200).json({ success: true, data: sanitizeAccount(active.account) });
});

const activateAccount = asyncHandler(async (req, res) => {
  const account = await WhatsAppAccount.findOne({ _id: req.params.id, userId: req.user?.id });
  if (!account) throw new AppError('Account not found', 404);

  await WhatsAppAccount.updateMany({ userId: req.user?.id }, { $set: { isActive: false } });
  account.isActive = true;
  account.status = account.status === 'disconnected' ? 'active' : account.status;
  await account.save();

  return res.status(200).json({ success: true, data: sanitizeAccount(account) });
});

const getStatus = asyncHandler(async (req, res) => {
  const accountContext = await resolveCurrentWhatsAppAccount(req);
  const health = await checkWhatsAppHealth(accountContext);
  const accounts = await WhatsAppAccount.find({ userId: req.user?.id }).select('_id phoneNumberId displayPhoneNumber verifiedName status isActive').lean();

  return res.status(200).json({
    success: true,
    status: health.isConnected ? 'connected' : 'disconnected',
    data: accounts.map((account) => ({
      ...sanitizeAccount(account),
      displayName: account.displayPhoneNumber || account.phoneNumberId,
    })),
  });
});

const deleteAccount = asyncHandler(async (req, res) => {
  const existing = await WhatsAppAccount.findOne({ _id: req.params.id, userId: req.user?.id });
  if (!existing) throw new AppError('Account not found', 404);

  const wasActive = Boolean(existing.isActive);
  existing.status = 'disconnected';
  existing.isActive = false;
  await existing.save();

  if (wasActive) {
    const fallbackAccount = await WhatsAppAccount.findOne({
      userId: req.user?.id,
      _id: { $ne: existing._id },
      status: { $ne: 'disconnected' },
    }).sort({ updatedAt: -1 });

    if (fallbackAccount) {
      fallbackAccount.isActive = true;
      await fallbackAccount.save();
    }
  }

  return res.status(200).json({ success: true, message: 'Account removed' });
});

const sendText = asyncHandler(async (req, res) => {
  const { to, text } = req.body || {};
  if (!to || !text) throw new AppError('to and text are required', 400);
  const accountContext = await resolveCurrentWhatsAppAccount(req);
  const data = await dispatchTextMessage({ accountContext, userId: req.user?.id, to, body: String(text) });
  return res.status(200).json({ success: true, data });
});

const sendTemplate = asyncHandler(async (req, res) => {
  const { to, templateName, template_name, language = 'en_US', components = [] } = req.body || {};
  const resolvedTemplate = String(templateName || template_name || '').trim();
  if (!to || !resolvedTemplate) throw new AppError('to and templateName are required', 400);

  const accountContext = await resolveCurrentWhatsAppAccount(req);
  const data = await dispatchTemplateMessage({
    accountContext,
    userId: req.user?.id,
    to,
    templateName: resolvedTemplate,
    language,
    components: Array.isArray(components) ? components : [],
  });

  return res.status(200).json({ success: true, data });
});

const sendMedia = asyncHandler(async (req, res) => {
  const { to, type, caption } = req.body || {};
  if (!to || !type) throw new AppError('to and type are required', 400);
  const accountContext = await resolveCurrentWhatsAppAccount(req);

  if (req.file) {
    const uploaded = await uploadBufferToCloudinary({
      buffer: req.file.buffer,
      mimeType: req.file.mimetype || '',
      folder: 'whatsapp_media',
    });

    const data = await dispatchMediaMessage({
      accountContext,
      userId: req.user?.id,
      to,
      type,
      link: uploaded.secure_url,
      caption: caption || '',
      filename: req.file.originalname || '',
    });

    return res.status(200).json({ success: true, data });
  }

  const link = req.body?.link || req.body?.mediaUrl || req.body?.imageUrl || req.body?.documentUrl || '';
  if (!link) throw new AppError('file or media link is required', 400);

  const data = await dispatchMediaMessage({
    accountContext,
    userId: req.user?.id,
    to,
    type,
    link,
    caption: caption || '',
    filename: req.body?.filename || '',
  });

  return res.status(200).json({ success: true, data });
});

const sendMessage = asyncHandler(async (req, res) => {
  const { type } = req.body || {};
  if (type === 'text') return sendText(req, res);
  if (type === 'template') return sendTemplate(req, res);
  if (['image', 'video', 'audio', 'document'].includes(String(type || '').toLowerCase())) return sendMedia(req, res);
  throw new AppError('Unsupported type. Use text, template, image, video, audio, document', 400);
});

const sendBroadcast = asyncHandler(async (req, res) => {
  const { recipients = [], messageType = 'text', text = '', templateName = '', language = 'en_US', components = [], campaignId } = req.body || {};
  if (!Array.isArray(recipients) || recipients.length === 0) {
    throw new AppError('recipients must be a non-empty array', 400);
  }

  const accountContext = await resolveCurrentWhatsAppAccount(req);
  const finalCampaignId = String(campaignId || `campaign_${Date.now()}`);
  const results = [];

  for (const recipient of recipients) {
    try {
      if (messageType === 'template') {
        await dispatchTemplateMessage({
          accountContext,
          userId: req.user?.id,
          to: recipient,
          templateName,
          language,
          components,
          campaignId: finalCampaignId,
        });
      } else {
        await dispatchTextMessage({ accountContext, userId: req.user?.id, to: recipient, body: text, campaignId: finalCampaignId });
      }
      results.push({ recipient, success: true });
    } catch (error) {
      results.push({ recipient, success: false, error: error.message });
    }
  }

  return res.status(200).json({ success: true, campaignId: finalCampaignId, results });
});

const createAutoReplyRule = asyncHandler(async (req, res) => {
  const accountContext = await resolveCurrentWhatsAppAccount(req);
  const rule = await AutoReply.create({
    ...(req.body || {}),
    userId: req.user?.id,
    whatsappAccountId: accountContext?.account?._id,
  });
  return res.status(201).json({ success: true, data: rule });
});

const updateAutoReplyRule = asyncHandler(async (req, res) => {
  const accountContext = await resolveCurrentWhatsAppAccount(req);
  const rule = await AutoReply.findOneAndUpdate(
    { _id: req.params.id, userId: req.user?.id, ...(accountContext?.account?._id ? { whatsappAccountId: accountContext.account._id } : {}) },
    req.body || {},
    { new: true }
  );
  if (!rule) throw new AppError('Auto reply rule not found', 404);
  return res.status(200).json({ success: true, data: rule });
});

const deleteAutoReplyRule = asyncHandler(async (req, res) => {
  const accountContext = await resolveCurrentWhatsAppAccount(req);
  const deleted = await AutoReply.findOneAndDelete({
    _id: req.params.id,
    userId: req.user?.id,
    ...(accountContext?.account?._id ? { whatsappAccountId: accountContext.account._id } : {}),
  });
  if (!deleted) throw new AppError('Auto reply rule not found', 404);
  return res.status(200).json({ success: true, message: 'Rule deleted' });
});

const toggleAutoReplyRule = asyncHandler(async (req, res) => {
  const accountContext = await resolveCurrentWhatsAppAccount(req);
  const current = await AutoReply.findOne({
    _id: req.params.id,
    userId: req.user?.id,
    ...(accountContext?.account?._id ? { whatsappAccountId: accountContext.account._id } : {}),
  });
  if (!current) throw new AppError('Auto reply rule not found', 404);
  current.isActive = !current.isActive;
  await current.save();
  return res.status(200).json({ success: true, data: current });
});

const getAutoReplyRules = asyncHandler(async (req, res) => {
  const accountContext = await resolveCurrentWhatsAppAccount(req);
  const data = await AutoReply.find({
    userId: req.user?.id,
    ...(accountContext?.account?._id ? { whatsappAccountId: accountContext.account._id } : {}),
  })
    .sort({ createdAt: -1 })
    .lean();
  return res.status(200).json({ success: true, data });
});

const getTemplates = asyncHandler(async (req, res) => {
  const accountContext = await resolveCurrentWhatsAppAccount(req);
  const wabaId = String(accountContext.wabaId || accountContext.businessAccountId || '').trim();
  const accessToken = String(accountContext.accessToken || '').trim();
  if (!accessToken || !wabaId) throw new AppError('Missing WhatsApp credentials', 400);

  try {
    const response = await axios.get(
      `https://graph.facebook.com/${RESOLVED_API_VERSION}/${wabaId}/message_templates`,
      { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 15000 }
    );

    return res.status(200).json({ success: true, templates: Array.isArray(response?.data?.data) ? response.data.data : [] });
  } catch (error) {
    throw normalizeWhatsAppApiError(error, 'Failed to load WhatsApp templates');
  }
});

const getMessages = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const skip = (page - 1) * limit;

  const accountContext = await resolveCurrentWhatsAppAccount(req);
  const filter = {
    userId: req.user?.id,
    ...(accountContext?.account?._id ? { whatsappAccountId: accountContext.account._id } : {}),
  };

  const [data, total] = await Promise.all([
    Message.find(filter).sort({ timestamp: -1, createdAt: -1 }).skip(skip).limit(limit).lean(),
    Message.countDocuments(filter),
  ]);

  return res.status(200).json({
    success: true,
    data,
    pagination: { page, limit, total, hasMore: skip + data.length < total },
  });
});

const getConversations = asyncHandler(async (req, res) => {
  const accountContext = await resolveCurrentWhatsAppAccount(req);
  const matchStage = {
    userId: req.user?.id,
    ...(accountContext?.account?._id ? { whatsappAccountId: accountContext.account._id } : {}),
  };

  const conversations = await Message.aggregate([
    { $match: matchStage },
    {
      $addFields: {
        chatKey: {
          $cond: [{ $eq: ['$direction', 'incoming'] }, '$from', '$to'],
        },
      },
    },
    { $sort: { timestamp: -1, createdAt: -1 } },
    {
      $group: {
        _id: '$chatKey',
        lastMessage: { $first: '$message' },
        lastTimestamp: { $first: '$timestamp' },
        direction: { $first: '$direction' },
      },
    },
    { $sort: { lastTimestamp: -1 } },
  ]);

  const phones = conversations.map((item) => normalizePhone(item._id)).filter(Boolean);
  const contacts = await Contact.find({ phone: { $in: phones } }).lean();
  const contactMap = new Map(contacts.map((c) => [c.phone, c]));

  const data = conversations.map((item) => {
    const phone = normalizePhone(item._id);
    const contact = contactMap.get(phone);
    return {
      phone,
      name: contact?.name || phone,
      lastMessage: item.lastMessage,
      lastTimestamp: item.lastTimestamp,
      direction: item.direction,
    };
  });

  return res.status(200).json({ success: true, data });
});

const verifyWebhook = (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;

  if (mode === 'subscribe' && token === verifyToken) return res.status(200).send(challenge);
  return res.sendStatus(403);
};

const parseIncoming = (msg = {}) => {
  const type = String(msg.type || 'text').toLowerCase();
  if (type === 'text') return { type, message: String(msg.text?.body || ''), mediaId: '' };
  if (['image', 'video', 'audio', 'sticker', 'document'].includes(type)) {
    const mediaNode = msg[type] || {};
    return {
      type,
      message: String(mediaNode.caption || mediaNode.id || ''),
      mediaId: String(mediaNode.id || ''),
    };
  }
  return null;
};

const receiveWebhook = (req, res) => {
  try {
    const enforceSignature = String(process.env.WHATSAPP_ENFORCE_WEBHOOK_SIGNATURE).toLowerCase() !== 'false';
    const appSecret = String(process.env.WHATSAPP_APP_SECRET || process.env.META_APP_SECRET || '');

    if (enforceSignature && appSecret) {
      const signature = String(req.headers['x-hub-signature-256'] || '');
      if (!signature.startsWith('sha256=') || !req.rawBody) return res.status(403).send('Invalid signature');

      const expected =
        'sha256=' + crypto.createHmac('sha256', appSecret).update(req.rawBody).digest('hex');

      const isValid = (() => {
        try {
          return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
        } catch (_error) {
          return false;
        }
      })();

      if (!isValid) return res.status(403).send('Invalid signature');
    }

    const entries = Array.isArray(req.body?.entry) ? req.body.entry : [];
    const incoming = [];
    const statuses = [];

    for (const entry of entries) {
      const changes = Array.isArray(entry?.changes) ? entry.changes : [];
      for (const change of changes) {
        const value = change?.value || {};
        const metadata = value?.metadata || {};
        const phoneNumberId = String(metadata.phone_number_id || '');

        if (Array.isArray(value?.statuses)) {
          for (const status of value.statuses) {
            statuses.push({ ...status, phoneNumberId });
          }
        }

        for (const msg of Array.isArray(value?.messages) ? value.messages : []) {
          const parsed = parseIncoming(msg);
          if (!parsed) continue;

          incoming.push({
            phoneNumberId,
            fromMe: false,
            from: String(msg.from || ''),
            to: String(metadata?.display_phone_number || metadata?.phone_number_id || ''),
            message: parsed.message,
            body: parsed.message,
            text: parsed.type === 'text' ? parsed.message : '',
            timestamp: new Date(Number(msg.timestamp || Date.now() / 1000) * 1000),
            time: new Date(Number(msg.timestamp || Date.now() / 1000) * 1000),
            status: 'received',
            direction: 'incoming',
            messageId: String(msg.id || ''),
            type: parsed.type,
            mediaId: parsed.mediaId,
          });
        }
      }
    }

    res.status(200).json({ received: true });

    setImmediate(async () => {
      for (const statusEvent of statuses) {
        const messageId = String(statusEvent?.id || '');
        const status = String(statusEvent?.status || '').toLowerCase();
        const phoneNumberId = String(statusEvent?.phoneNumberId || '');
        if (!messageId || !['sent', 'delivered', 'read', 'failed'].includes(status)) continue;

        const matchedAccount = phoneNumberId ? await WhatsAppAccount.findOne({ phoneNumberId }).lean() : null;
        const timestamp = new Date(Number(statusEvent?.timestamp || Date.now() / 1000) * 1000);
        const campaignId = String(statusEvent?.conversation?.id || '');

        await CampaignMessageStatus.updateOne(
          {
            userId: matchedAccount?.userId,
            whatsappAccountId: matchedAccount?._id,
            messageId,
            status,
          },
          {
            $setOnInsert: {
              userId: matchedAccount?.userId,
              whatsappAccountId: matchedAccount?._id,
              messageId,
              status,
              timestamp,
              campaignId,
            },
          },
          { upsert: true }
        );

        await Message.updateOne(
          {
            messageId,
            ...(matchedAccount?._id ? { whatsappAccountId: matchedAccount._id } : {}),
          },
          { $set: { status, timestamp, time: timestamp } }
        );
      }

      for (const payload of incoming) {
        const matchedAccount = payload.phoneNumberId
          ? await WhatsAppAccount.findOne({ phoneNumberId: payload.phoneNumberId, status: { $ne: 'disconnected' } }).lean()
          : null;

        const withOwnership = {
          ...payload,
          userId: matchedAccount?.userId,
          whatsappAccountId: matchedAccount?._id,
        };

        const { message, isDuplicate } = await saveAndEmitMessage(withOwnership);

        const phone = normalizePhone(payload.from);
        if (phone) {
          await Contact.findOneAndUpdate(
            { phone },
            {
              $setOnInsert: { phone, name: '' },
              $set: {
                lastMessage: payload.message,
                lastSeen: payload.timestamp,
                'conversation.lastCustomerMessageAt': payload.timestamp,
                'conversation.windowOpen': true,
              },
            },
            { upsert: true }
          );
        }

        if (!isDuplicate && payload.mediaId && matchedAccount?.accessTokenEncrypted) {
          let accountContext;
          try {
            accountContext = await loadWhatsAppAccountByPhoneNumberId(payload.phoneNumberId, { requireAccount: false });
          } catch (_error) {
            accountContext = null;
          }

          if (accountContext?.accessToken) {
            uploadWhatsAppMediaToCloudinary({
              mediaId: payload.mediaId,
              accessToken: accountContext.accessToken,
              graphVersion: RESOLVED_API_VERSION,
            })
              .then((uploaded) =>
                Message.findByIdAndUpdate(message._id, {
                  $set: { mediaUrl: uploaded.mediaUrl, mimeType: uploaded.mimeType },
                })
              )
              .catch((error) => console.error('[whatsapp] media processing failed', error.message));
          }
        }

        if (!isDuplicate && payload.type === 'text' && matchedAccount?._id && matchedAccount?.userId) {
          const matchedRule = await resolveAutoReplyRule(payload.message, {
            userId: matchedAccount.userId,
            whatsappAccountId: matchedAccount._id,
          });

          if (matchedRule) {
            const delay = resolveReplyDelayMs(matchedRule);
            setTimeout(async () => {
              try {
                const accountContext = await loadWhatsAppAccountByPhoneNumberId(payload.phoneNumberId);
                if (matchedRule.replyType === 'template') {
                  await dispatchTemplateMessage({
                    accountContext,
                    userId: matchedAccount.userId,
                    to: payload.from,
                    templateName: matchedRule.reply,
                    language: matchedRule.templateLanguage || 'en_US',
                    components: [],
                  });
                } else {
                  await dispatchTextMessage({
                    accountContext,
                    userId: matchedAccount.userId,
                    to: payload.from,
                    body: matchedRule.reply,
                  });
                }
              } catch (error) {
                console.error('[whatsapp] auto reply failed:', error.message);
              }
            }, delay);
          }
        }

        if (matchedAccount?._id) {
          await WhatsAppAccount.updateOne(
            { _id: matchedAccount._id },
            { $set: { lastWebhookAt: new Date(), lastSyncAt: new Date() } }
          );
        }
      }
    });
  } catch (error) {
    console.error('[whatsapp] webhook error:', error);
    return res.status(200).json({ received: true });
  }
};

const getAnalytics = asyncHandler(async (req, res) => {
  const accountContext = await resolveCurrentWhatsAppAccount(req);
  const filter = {
    userId: req.user?.id,
    ...(accountContext?.account?._id ? { whatsappAccountId: accountContext.account._id } : {}),
  };

  const [sent, delivered, read, failed] = await Promise.all([
    CampaignMessageStatus.distinct('messageId', { ...filter, status: 'sent' }),
    CampaignMessageStatus.distinct('messageId', { ...filter, status: 'delivered' }),
    CampaignMessageStatus.distinct('messageId', { ...filter, status: 'read' }),
    CampaignMessageStatus.distinct('messageId', { ...filter, status: 'failed' }),
  ]);

  const totalSent = sent.length;
  const pct = (count) => (totalSent > 0 ? Number(((count / totalSent) * 100).toFixed(2)) : 0);

  return res.status(200).json({
    success: true,
    data: {
      totalSent,
      deliveredPercentage: pct(delivered.length),
      readPercentage: pct(read.length),
      failedPercentage: pct(failed.length),
    },
  });
});

module.exports = {
  getConnectConfig,
  exchangeMetaToken,
  completeConnection,
  manualConnect,
  listAccounts,
  getAccount,
  activateAccount,
  getStatus,
  deleteAccount,
  sendText,
  sendTemplate,
  sendMedia,
  sendMessage,
  sendBroadcast,
  createAutoReplyRule,
  updateAutoReplyRule,
  deleteAutoReplyRule,
  toggleAutoReplyRule,
  getAutoReplyRules,
  getTemplates,
  getMessages,
  getConversations,
  verifyWebhook,
  receiveWebhook,
  getAnalytics,
};
