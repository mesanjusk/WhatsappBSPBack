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

const normalizePhone = (v) => String(v || '').replace(/\D/g, '');
const RESOLVED_API_VERSION = process.env.WHATSAPP_API_VERSION || 'v19.0';

const ensureWhatsAppMessagingConfig = () => {
  const config = validateWhatsAppConfig();
  if (!config.ok) throw new AppError('Missing WhatsApp configuration', 400);
  return config;
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

const callWhatsAppMessagesApi = async (payload, { fallbackMessage } = {}) => {
  const { accessToken, graphVersion, phoneNumberId } = ensureWhatsAppMessagingConfig();

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
    const existing = await Message.findOne({ messageId: payload.messageId }).lean();
    if (existing) return { message: existing, isDuplicate: true };
  }

  const savedMessage = await Message.create(payload);
  emitNewMessage(savedMessage.toObject());
  return { message: savedMessage, isDuplicate: false };
};

const dispatchTextMessage = async ({ to, body, campaignId = '' }) => {
  const normalizedTo = normalizePhone(to);
  if (!normalizedTo) throw new AppError('Invalid recipient number', 400);

  const data = await callWhatsAppMessagesApi(
    {
      messaging_product: 'whatsapp',
      to: normalizedTo,
      type: 'text',
      text: { body },
    },
    { fallbackMessage: 'Failed to send WhatsApp text message' }
  );

  const messageId = data?.messages?.[0]?.id || '';
  await saveAndEmitMessage({
    fromMe: true,
    from: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
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
      { messageId, status: 'sent' },
      { $setOnInsert: { messageId, status: 'sent', timestamp: new Date(), campaignId } },
      { upsert: true }
    );
  }

  return data;
};

const dispatchTemplateMessage = async ({ to, templateName, language = 'en_US', components = [], campaignId = '' }) => {
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
    { fallbackMessage: 'Failed to send WhatsApp template message' }
  );

  const messageId = data?.messages?.[0]?.id || '';
  await saveAndEmitMessage({
    fromMe: true,
    from: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
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
      { messageId, status: 'sent' },
      { $setOnInsert: { messageId, status: 'sent', timestamp: new Date(), campaignId } },
      { upsert: true }
    );
  }

  return data;
};

const dispatchMediaMessage = async ({ to, type, link, caption = '', filename = '' }) => {
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

  const data = await callWhatsAppMessagesApi(payload, {
    fallbackMessage: 'Failed to send WhatsApp media message',
  });

  const messageId = data?.messages?.[0]?.id || '';
  await saveAndEmitMessage({
    fromMe: true,
    from: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
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

const exchangeMetaToken = asyncHandler(async (req, res) => {
  const { accessToken, phoneNumberId, wabaId, businessId, displayName } = req.body || {};
  if (!accessToken || !phoneNumberId) {
    throw new AppError('accessToken and phoneNumberId are required', 400);
  }

  const account = await WhatsAppAccount.findOneAndUpdate(
    { userId: req.user?.id, phoneNumberId: String(phoneNumberId) },
    {
      $set: {
        userId: req.user?.id,
        accessToken: String(accessToken),
        phoneNumberId: String(phoneNumberId),
        wabaId: String(wabaId || process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || ''),
        businessId: String(businessId || ''),
        displayName: String(displayName || phoneNumberId),
        tokenExpiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
      },
    },
    { upsert: true, new: true }
  );

  return res.status(200).json({ success: true, data: account });
});

const manualConnect = exchangeMetaToken;

const listAccounts = asyncHandler(async (req, res) => {
  const accounts = await WhatsAppAccount.find({ userId: req.user?.id }).sort({ createdAt: -1 }).lean();
  return res.status(200).json({ success: true, data: accounts });
});

const getStatus = asyncHandler(async (req, res) => {
  const health = await checkWhatsAppHealth();
  const accounts = await WhatsAppAccount.find({ userId: req.user?.id }).select('_id phoneNumberId displayName').lean();

  return res.status(200).json({
    success: true,
    status: health.isConnected ? 'connected' : 'disconnected',
    data: accounts.map((account) => ({ ...account, status: health.isConnected ? 'connected' : 'disconnected' })),
  });
});

const deleteAccount = asyncHandler(async (req, res) => {
  const removed = await WhatsAppAccount.findOneAndDelete({ _id: req.params.id, userId: req.user?.id });
  if (!removed) throw new AppError('Account not found', 404);
  return res.status(200).json({ success: true, message: 'Account removed' });
});

const sendText = asyncHandler(async (req, res) => {
  const { to, text } = req.body || {};
  if (!to || !text) throw new AppError('to and text are required', 400);
  const data = await dispatchTextMessage({ to, body: String(text) });
  return res.status(200).json({ success: true, data });
});

const sendTemplate = asyncHandler(async (req, res) => {
  const { to, templateName, template_name, language = 'en_US', components = [] } = req.body || {};
  const resolvedTemplate = String(templateName || template_name || '').trim();
  if (!to || !resolvedTemplate) throw new AppError('to and templateName are required', 400);

  const data = await dispatchTemplateMessage({
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

  if (req.file) {
    const uploaded = await uploadBufferToCloudinary({
      buffer: req.file.buffer,
      mimeType: req.file.mimetype || '',
      folder: 'whatsapp_media',
    });

    const data = await dispatchMediaMessage({
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

  const finalCampaignId = String(campaignId || `campaign_${Date.now()}`);
  const results = [];

  for (const recipient of recipients) {
    try {
      if (messageType === 'template') {
        await dispatchTemplateMessage({
          to: recipient,
          templateName,
          language,
          components,
          campaignId: finalCampaignId,
        });
      } else {
        await dispatchTextMessage({ to: recipient, body: text, campaignId: finalCampaignId });
      }
      results.push({ recipient, success: true });
    } catch (error) {
      results.push({ recipient, success: false, error: error.message });
    }
  }

  return res.status(200).json({ success: true, campaignId: finalCampaignId, results });
});

const createAutoReplyRule = asyncHandler(async (req, res) => {
  const rule = await AutoReply.create(req.body || {});
  return res.status(201).json({ success: true, data: rule });
});

const updateAutoReplyRule = asyncHandler(async (req, res) => {
  const rule = await AutoReply.findByIdAndUpdate(req.params.id, req.body || {}, { new: true });
  if (!rule) throw new AppError('Auto reply rule not found', 404);
  return res.status(200).json({ success: true, data: rule });
});

const deleteAutoReplyRule = asyncHandler(async (req, res) => {
  const deleted = await AutoReply.findByIdAndDelete(req.params.id);
  if (!deleted) throw new AppError('Auto reply rule not found', 404);
  return res.status(200).json({ success: true, message: 'Rule deleted' });
});

const toggleAutoReplyRule = asyncHandler(async (req, res) => {
  const current = await AutoReply.findById(req.params.id);
  if (!current) throw new AppError('Auto reply rule not found', 404);
  current.isActive = !current.isActive;
  await current.save();
  return res.status(200).json({ success: true, data: current });
});

const getAutoReplyRules = asyncHandler(async (_req, res) => {
  const data = await AutoReply.find({}).sort({ createdAt: -1 }).lean();
  return res.status(200).json({ success: true, data });
});

const getTemplates = asyncHandler(async (_req, res) => {
  const wabaId = String(process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '').trim();
  const accessToken = String(process.env.WHATSAPP_ACCESS_TOKEN || '').trim();
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

  const [data, total] = await Promise.all([
    Message.find({}).sort({ timestamp: -1, createdAt: -1 }).skip(skip).limit(limit).lean(),
    Message.countDocuments({}),
  ]);

  return res.status(200).json({
    success: true,
    data,
    pagination: { page, limit, total, hasMore: skip + data.length < total },
  });
});

const getConversations = asyncHandler(async (_req, res) => {
  const conversations = await Message.aggregate([
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
    const appSecret = String(process.env.WHATSAPP_APP_SECRET || '');

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
        if (Array.isArray(value?.statuses)) statuses.push(...value.statuses);

        for (const msg of Array.isArray(value?.messages) ? value.messages : []) {
          const parsed = parseIncoming(msg);
          if (!parsed) continue;

          incoming.push({
            fromMe: false,
            from: String(msg.from || ''),
            to: String(value?.metadata?.display_phone_number || value?.metadata?.phone_number_id || ''),
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
        if (!messageId || !['sent', 'delivered', 'read', 'failed'].includes(status)) continue;

        const timestamp = new Date(Number(statusEvent?.timestamp || Date.now() / 1000) * 1000);
        const campaignId = String(statusEvent?.conversation?.id || '');

        await CampaignMessageStatus.updateOne(
          { messageId, status },
          { $setOnInsert: { messageId, status, timestamp, campaignId } },
          { upsert: true }
        );

        await Message.updateOne({ messageId }, { $set: { status, timestamp, time: timestamp } });
      }

      for (const payload of incoming) {
        const { message, isDuplicate } = await saveAndEmitMessage(payload);

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

        if (!isDuplicate && payload.mediaId) {
          uploadWhatsAppMediaToCloudinary({
            mediaId: payload.mediaId,
            accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
            graphVersion: RESOLVED_API_VERSION,
          })
            .then((uploaded) =>
              Message.findByIdAndUpdate(message._id, {
                $set: { mediaUrl: uploaded.mediaUrl, mimeType: uploaded.mimeType },
              })
            )
            .catch((error) => console.error('[whatsapp] media processing failed', error.message));
        }

        if (!isDuplicate && payload.type === 'text') {
          const matchedRule = await resolveAutoReplyRule(payload.message);
          if (matchedRule) {
            const delay = resolveReplyDelayMs(matchedRule);
            setTimeout(async () => {
              try {
                if (matchedRule.replyType === 'template') {
                  await dispatchTemplateMessage({
                    to: payload.from,
                    templateName: matchedRule.reply,
                    language: matchedRule.templateLanguage || 'en_US',
                    components: [],
                  });
                } else {
                  await dispatchTextMessage({ to: payload.from, body: matchedRule.reply });
                }
              } catch (error) {
                console.error('[whatsapp] auto reply failed:', error.message);
              }
            }, delay);
          }
        }
      }
    });
  } catch (error) {
    console.error('[whatsapp] webhook error:', error);
    return res.status(200).json({ received: true });
  }
};

const getAnalytics = asyncHandler(async (_req, res) => {
  const [sent, delivered, read, failed] = await Promise.all([
    CampaignMessageStatus.distinct('messageId', { status: 'sent' }),
    CampaignMessageStatus.distinct('messageId', { status: 'delivered' }),
    CampaignMessageStatus.distinct('messageId', { status: 'read' }),
    CampaignMessageStatus.distinct('messageId', { status: 'failed' }),
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
  exchangeMetaToken,
  manualConnect,
  listAccounts,
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
