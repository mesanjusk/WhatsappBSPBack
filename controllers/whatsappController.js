const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const axios = require('axios');
const crypto = require('crypto');
const { v4: uuid } = require('uuid');
const Message = require('../repositories/Message');
const CampaignMessageStatus = require('../repositories/CampaignMessageStatus');
const Contact = require('../repositories/contact');
const Customers = require('../repositories/customer');
const Enquiry = require('../repositories/enquiry');
const User = require('../repositories/users');
const { emitNewMessage } = require('../socket');
const { resolveAutoReplyRule, resolveReplyDelayMs } = require('../middleware/autoReply');
const { processIncomingMessageFlow } = require('../services/flowEngineService');
const {
  uploadWhatsAppMediaToCloudinary,
  uploadBufferToCloudinary,
} = require('../services/whatsappMediaService');
const {
  checkWhatsAppHealth,
  classifyWhatsAppApiError,
  validateWhatsAppConfig,
} = require('../services/whatsappHealthService');
const Flow = require('../repositories/Flow');
const { processWhatsAppAttendanceCommand } = require('../services/whatsappAttendanceService');
const AutoReply = require('../repositories/AutoReply');
const { formatIST } = require('../utils/dateTime');

const {
  WHATSAPP_ACCESS_TOKEN,
  WHATSAPP_PHONE_NUMBER_ID,
  WHATSAPP_API_VERSION,
  WHATSAPP_APP_SECRET,
} = process.env;

const SUPPORTED_INCOMING_TYPES = new Set([
  'text',
  'image',
  'video',
  'document',
  'audio',
  'sticker',
  'button',
  'interactive',
]);
const RESOLVED_API_VERSION = WHATSAPP_API_VERSION || 'v19.0';
const normalizePhone = (to) => String(to || '').replace(/\D/g, '');
const MESSAGE_TYPES = new Set(['text', 'image', 'document', 'template', 'flow']);

const ensureWhatsAppMessagingConfig = () => {
  const config = validateWhatsAppConfig();
  if (!config.ok) {
    throw new AppError('Missing WhatsApp configuration', 400);
  }

  return config;
};

const normalizeWhatsAppApiError = (error, fallbackMessage = 'WhatsApp API request failed') => {
  const normalized = classifyWhatsAppApiError(error);
  const statusCode =
    normalized.code === 'INVALID_CONFIG'
      ? 400
      : normalized.code === 'TOKEN_EXPIRED'
      ? 401
      : 502;

  if (normalized.code === 'TOKEN_EXPIRED') {
    console.error('[whatsapp] token issue detected:', error?.response?.status || error?.message);
  } else if (normalized.code === 'NETWORK_ERROR') {
    console.error('[whatsapp] network/API failure:', error?.response?.status || error?.message);
  }

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

const parseWebhookTimestamp = (timestampInSeconds) => {
  const parsedTimestamp = Number(timestampInSeconds);
  return Number.isNaN(parsedTimestamp) ? new Date() : new Date(parsedTimestamp * 1000);
};

const safeJsonParse = (value, fallback = null) => {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value;

  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
};

const extractIncomingMessageData = (message = {}) => {
  const messageType = String(message?.type || 'text').toLowerCase();
  const normalized = {
    type: messageType,
    from: String(message?.from || ''),
    timestamp: message?.timestamp || '',
    messageId: String(message?.id || ''),
    content: '',
    mediaId: '',
    caption: '',
    filename: '',
    mimeType: '',
    replyId: '',
    replyTitle: '',
    interactiveType: '',
    flowId: '',
    flowToken: '',
    flowResponseData: null,
  };

  if (messageType === 'text') {
    normalized.content = String(message?.text?.body || '');
    return normalized;
  }

  if (
    messageType === 'image' ||
    messageType === 'video' ||
    messageType === 'audio' ||
    messageType === 'sticker'
  ) {
    const mediaNode = message?.[messageType] || {};
    normalized.mediaId = String(mediaNode?.id || '');
    normalized.caption = String(mediaNode?.caption || '');
    normalized.mimeType = String(mediaNode?.mime_type || '');
    return normalized;
  }

  if (messageType === 'document') {
    const mediaNode = message?.document || {};
    normalized.mediaId = String(mediaNode?.id || '');
    normalized.caption = String(mediaNode?.caption || '');
    normalized.filename = String(mediaNode?.filename || '');
    normalized.mimeType = String(mediaNode?.mime_type || '');
    return normalized;
  }

  if (messageType === 'button') {
    normalized.replyId = String(message?.button?.payload || '');
    normalized.replyTitle = String(message?.button?.text || '');
    normalized.content = normalized.replyTitle || normalized.replyId;
    return normalized;
  }

  if (messageType === 'interactive') {
    const interactive = message?.interactive || {};
    const interactiveType = String(interactive?.type || '').toLowerCase();

    normalized.interactiveType = interactiveType;

    if (interactiveType === 'button_reply') {
      normalized.replyId = String(interactive?.button_reply?.id || '');
      normalized.replyTitle = String(interactive?.button_reply?.title || '');
      normalized.content = normalized.replyTitle || normalized.replyId;
      return normalized;
    }

    if (interactiveType === 'list_reply') {
      normalized.replyId = String(interactive?.list_reply?.id || '');
      normalized.replyTitle = String(interactive?.list_reply?.title || '');
      normalized.content = normalized.replyTitle || normalized.replyId;
      return normalized;
    }

    if (interactiveType === 'nfm_reply') {
      const responseJson = safeJsonParse(interactive?.nfm_reply?.response_json, {});
      normalized.flowResponseData = responseJson || {};
      normalized.flowToken = String(responseJson?.flow_token || '');
      normalized.flowId = String(responseJson?.flow_id || '');
      normalized.content =
        String(responseJson?.flow_cta || interactive?.nfm_reply?.name || 'Flow submitted');
      return normalized;
    }

    normalized.content = 'Interactive message received';
    return normalized;
  }

  return null;
};

const saveAndEmitMessage = async (payload) => {
  if (payload.messageId) {
    const existing = await Message.findOne({ messageId: payload.messageId }).lean();
    if (existing) {
      console.log(`[whatsapp] Skipped duplicate message ${payload.messageId}`);
      return { message: existing, isDuplicate: true };
    }
  }

  const savedMessage = await Message.create(payload);
  console.log(`[whatsapp] Saved ${savedMessage.direction || 'unknown'} message ${savedMessage._id}`);
  emitNewMessage(savedMessage.toObject());
  return { message: savedMessage, isDuplicate: false };
};

const computeConversationWindow = (lastCustomerMessageAt) => {
  if (!lastCustomerMessageAt) return { lastCustomerMessageAt: null, windowOpen: false };
  const last = new Date(lastCustomerMessageAt);
  const windowOpen = Date.now() - last.getTime() < 24 * 60 * 60 * 1000;
  return { lastCustomerMessageAt: last, windowOpen };
};

const upsertContactFromIncomingMessage = async (payload) => {
  const phone = normalizePhone(payload?.from);
  if (!phone) return;

  const conversation = computeConversationWindow(payload?.timestamp || new Date());

  await Contact.findOneAndUpdate(
    { phone },
    {
      $setOnInsert: {
        phone,
        name: '',
        tags: [],
        customFields: {},
        assignedAgent: '',
      },
      $set: {
        lastMessage: String(payload?.message || payload?.body || payload?.text || ''),
        lastSeen: payload?.timestamp || new Date(),
        conversation,
      },
    },
    { upsert: true, new: false }
  );
};

const upsertCustomerAndEnquiryFromIncomingMessage = async (payload) => {
  const phone = normalizePhone(payload?.from);
  if (!phone) return { customer: null, createdEnquiry: false };

  const existingCustomer = await Customers.findOne({ Mobile_number: phone }).lean();
  if (existingCustomer) {
    await Customers.updateOne(
      { _id: existingCustomer._id },
      { $set: { LastInteraction: payload?.timestamp || new Date() } }
    );
    return { customer: existingCustomer, createdEnquiry: false };
  }

  const customerName = `WhatsApp ${phone.slice(-4)}`;
  const customerDoc = await Customers.create({
    Customer_uuid: uuid(),
    Customer_name: customerName,
    Mobile_number: phone,
    Customer_group: 'Customer',
    Status: 'active',
    Tags: ['whatsapp'],
    LastInteraction: payload?.timestamp || new Date(),
  });

  const lastEnquiry = await Enquiry.findOne().sort({ Enquiry_Number: -1 }).lean();
  const newEnquiryNumber = lastEnquiry ? lastEnquiry.Enquiry_Number + 1 : 1;

  await Enquiry.create({
    Enquiry_uuid: `WA-${Date.now()}-${phone}`,
    Enquiry_Number: newEnquiryNumber,
    Customer_name: customerDoc.Customer_name,
    Priority: 'Normal',
    Item: 'WhatsApp Enquiry',
    Task: 'Enquiry',
    Assigned: 'System',
    Delivery_Date: new Date(),
    Remark: String(payload?.message || payload?.body || 'Auto created from WhatsApp').slice(0, 2000),
  });

  return {
    customer: customerDoc.toObject ? customerDoc.toObject() : customerDoc,
    createdEnquiry: true,
  };
};

const markWhatsAppStartAttendance = async (payload) => {
  try {
    return await processWhatsAppAttendanceCommand({
      payload,
      sendText: dispatchTextMessage,
    });
  } catch (error) {
    console.error('[whatsapp] Failed to process attendance command:', error);
    return { handled: false };
  }
};

const getFlowReply = async (message) => {
  const normalizedMessage = String(message || '').trim().toLowerCase();
  if (!normalizedMessage) return null;

  const flows =
    typeof Flow.findActiveFlows === 'function'
      ? await Flow.findActiveFlows().lean()
      : await Flow.find({ isActive: true }).sort({ createdAt: 1 }).lean();

  let matchedKeyword = '';

  const matchedFlow =
    flows.find(
      (flow) =>
        Array.isArray(flow.triggerKeywords) &&
        flow.triggerKeywords.some((keyword) => {
          const normalizedKeyword = String(keyword || '').trim().toLowerCase();
          const isMatched =
            normalizedKeyword &&
            normalizedMessage.toLowerCase().includes(normalizedKeyword.toLowerCase());

          if (isMatched && !matchedKeyword) matchedKeyword = normalizedKeyword;
          return isMatched;
        })
    ) || null;

  if (!matchedFlow) return null;

  const replyText = String(matchedFlow.replyText || '').trim();
  if (replyText) {
    return {
      flowId: String(matchedFlow._id || ''),
      matchedKeyword,
      replyText,
    };
  }

  const startNode =
    (matchedFlow.nodes || []).find(
      (node) => node?.isStart && (node?.type === 'message' || node?.type === 'text')
    ) ||
    (matchedFlow.nodes || []).find(
      (node) => node?.type === 'message' || node?.type === 'text'
    );

  const fallbackReplyText = String(startNode?.message || '').trim();
  if (!fallbackReplyText) return null;

  return {
    flowId: String(matchedFlow._id || ''),
    matchedKeyword,
    replyText: fallbackReplyText,
  };
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const dispatchTextMessage = async ({ to, body }) => {
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

  const metaMessageId = data?.messages?.[0]?.id || '';

  await saveAndEmitMessage({
    fromMe: true,
    from: WHATSAPP_PHONE_NUMBER_ID || '',
    to: normalizedTo,
    message: body,
    body,
    timestamp: new Date(),
    status: 'sent',
    direction: 'outgoing',
    type: 'text',
    text: body,
    time: new Date(),
    messageId: metaMessageId,
  });

  return data;
};

const dispatchMediaMessage = async ({ to, type, link, caption = '', filename = '' }) => {
  const normalizedTo = normalizePhone(to);
  if (!normalizedTo) throw new AppError('Invalid recipient number', 400);

  const allowedTypes = new Set(['image', 'video', 'audio', 'document']);
  if (!allowedTypes.has(type)) {
    throw new AppError('Unsupported media type for sending', 400);
  }

  const mediaNode = { link };

  if (caption && (type === 'image' || type === 'video' || type === 'document')) {
    mediaNode.caption = caption;
  }

  if (filename && type === 'document') {
    mediaNode.filename = filename;
  }

  const payload = {
    messaging_product: 'whatsapp',
    to: normalizedTo,
    type,
    [type]: mediaNode,
  };

  const data = await callWhatsAppMessagesApi(payload, {
    fallbackMessage: 'Failed to send WhatsApp media message',
  });

  const metaMessageId = data?.messages?.[0]?.id || '';

  await saveAndEmitMessage({
    fromMe: true,
    from: WHATSAPP_PHONE_NUMBER_ID || '',
    to: normalizedTo,
    message: caption || link,
    body: caption || link,
    timestamp: new Date(),
    status: 'sent',
    direction: 'outgoing',
    type,
    text: caption || '',
    mediaUrl: link,
    caption,
    filename,
    time: new Date(),
    messageId: metaMessageId,
  });

  return data;
};

const dispatchTemplateMessage = async ({ to, templateName, language = 'en_US', components = [] }) => {
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

  const metaMessageId = data?.messages?.[0]?.id || '';

  await saveAndEmitMessage({
    fromMe: true,
    from: WHATSAPP_PHONE_NUMBER_ID || '',
    to: normalizedTo,
    message: templateName,
    body: templateName,
    timestamp: new Date(),
    status: 'sent',
    direction: 'outgoing',
    type: 'template',
    text: templateName,
    time: new Date(),
    messageId: metaMessageId,
  });

  return data;
};

const dispatchFlowMessage = async ({
  to,
  flowId,
  flowToken = '',
  flowCta = 'Open Form',
  screen = '',
  data = {},
  mode = 'published',
}) => {
  const normalizedTo = normalizePhone(to);
  if (!normalizedTo) throw new AppError('Invalid recipient number', 400);
  if (!flowId) throw new AppError('flowId is required', 400);

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: normalizedTo,
    type: 'interactive',
    interactive: {
      type: 'flow',
      header: {
        type: 'text',
        text: 'Form',
      },
      body: {
        text: 'Please fill this form.',
      },
      action: {
        name: 'flow',
        parameters: {
          mode,
          flow_message_version: '3',
          flow_id: String(flowId),
          flow_cta: String(flowCta || 'Open Form').slice(0, 20),
          ...(flowToken ? { flow_token: String(flowToken) } : {}),
          ...(screen
            ? {
                flow_action: 'navigate',
                flow_action_payload: {
                  screen,
                  ...(data && Object.keys(data).length ? { data } : {}),
                },
              }
            : {}),
        },
      },
    },
  };

  const response = await callWhatsAppMessagesApi(payload, {
    fallbackMessage: 'Failed to send WhatsApp flow message',
  });

  const metaMessageId = response?.messages?.[0]?.id || '';

  await saveAndEmitMessage({
    fromMe: true,
    from: WHATSAPP_PHONE_NUMBER_ID || '',
    to: normalizedTo,
    message: `Flow: ${flowCta}`,
    body: `Flow: ${flowCta}`,
    timestamp: new Date(),
    status: 'sent',
    direction: 'outgoing',
    type: 'flow',
    text: `Flow: ${flowCta}`,
    time: new Date(),
    messageId: metaMessageId,
    flowId: String(flowId),
    flowToken: flowToken || '',
    interactiveType: 'flow',
  });

  return response;
};

const normalizeStatus = (rawStatus) => {
  const normalized = String(rawStatus || '').toLowerCase();
  if (['sent', 'delivered', 'read', 'failed'].includes(normalized)) {
    return normalized;
  }
  return '';
};

const parseStatusTimestamp = (timestampInSeconds) => {
  const parsedTimestamp = Number(timestampInSeconds);
  return Number.isNaN(parsedTimestamp) ? new Date() : new Date(parsedTimestamp * 1000);
};

const persistStatusEvents = async (statusEvents = []) => {
  const statusOps = [];
  const messageOps = [];

  for (const statusEvent of statusEvents) {
    const messageId = String(statusEvent?.id || '').trim();
    const status = normalizeStatus(statusEvent?.status);

    if (!messageId || !status) {
      continue;
    }

    const timestamp = parseStatusTimestamp(statusEvent?.timestamp);
    const campaignId = String(statusEvent?.conversation?.id || '').trim();

    statusOps.push({
      updateOne: {
        filter: { messageId, status },
        update: { $setOnInsert: { messageId, status, timestamp, campaignId } },
        upsert: true,
      },
    });

    messageOps.push({
      updateOne: {
        filter: { messageId },
        update: {
          $set: {
            status,
            timestamp,
            time: timestamp,
          },
        },
      },
    });
  }

  if (statusOps.length > 0) {
    await CampaignMessageStatus.bulkWrite(statusOps, { ordered: false });
  }

  if (messageOps.length > 0) {
    await Message.bulkWrite(messageOps, { ordered: false });
  }
};

const processIncomingMediaMessage = async ({ messageRecordId, mediaId }) => {
  if (!messageRecordId || !mediaId) return;

  try {
    const uploaded = await uploadWhatsAppMediaToCloudinary({
      mediaId,
      accessToken: WHATSAPP_ACCESS_TOKEN,
      graphVersion: RESOLVED_API_VERSION,
    });

    const updated = await Message.findByIdAndUpdate(
      messageRecordId,
      {
        $set: {
          mediaUrl: uploaded.mediaUrl,
          mimeType: uploaded.mimeType,
          message: uploaded.mediaUrl,
          body: uploaded.mediaUrl,
        },
      },
      { new: true }
    ).lean();

    if (updated) {
      emitNewMessage(updated);
      console.log(`[whatsapp] Media processed for message=${messageRecordId} mediaId=${mediaId}`);
    }
  } catch (error) {
    console.error(`[whatsapp] Media processing failed for mediaId=${mediaId}:`, error.message);
  }
};

const sendAutoReplyForIncomingMessage = async (incomingPayload) => {
  if (!incomingPayload || incomingPayload.type !== 'text') return;

  const incomingText = String(incomingPayload.message || '').trim();
  if (!incomingText) return;

  console.log('[whatsapp] Auto reply resolver input:', incomingText);
  const matchedRule = await resolveAutoReplyRule(incomingText);
  console.log('[whatsapp] Auto reply matched keyword:', matchedRule?.keyword || null);
  console.log('[whatsapp] Auto reply DB result:', matchedRule || null);

  const fallbackReply = String(
    process.env.WHATSAPP_FALLBACK_REPLY || 'Thanks for your message. We will get back to you shortly.'
  ).trim();

  const replyType = matchedRule?.replyType || (fallbackReply ? 'text' : null);
  const reply = matchedRule?.reply || fallbackReply;

  if (!replyType || !reply) {
    return;
  }

  const delayMs = resolveReplyDelayMs(matchedRule);
  if (delayMs > 0) {
    await wait(delayMs);
  }

  if (replyType === 'template') {
    await dispatchTemplateMessage({
      to: incomingPayload.from,
      templateName: reply,
      language: matchedRule?.templateLanguage || 'en_US',
      components: [],
    });
    return;
  }

  await dispatchTextMessage({
    to: incomingPayload.from,
    body: reply,
  });
};

const normalizeTemplateLanguage = (language) => {
  const value = String(language || '').trim();
  if (!value) return 'en_US';
  return value.includes('_') ? value : value.toLowerCase() === 'en' ? 'en_US' : value;
};

const buildAutoReplyPayload = (payload = {}) => {
  const keyword = String(payload.keyword || '').trim();
  const matchType = String(payload.matchType || 'contains').trim().toLowerCase();
  const replyType = String(payload.replyType || payload.replyMode || 'text').trim().toLowerCase();
  const isActive =
    typeof payload.isActive === 'boolean'
      ? payload.isActive
      : typeof payload.active === 'boolean'
      ? payload.active
      : true;
  const templateLanguage = normalizeTemplateLanguage(payload.templateLanguage || payload.language);

  const reply =
    replyType === 'template'
      ? String(payload.reply || payload.templateName || '').trim()
      : String(payload.reply || payload.replyText || '').trim();

  if (!keyword || !reply) {
    throw new AppError('keyword and reply are required', 400);
  }

  if (!['exact', 'contains', 'starts_with'].includes(matchType)) {
    throw new AppError('Invalid matchType', 400);
  }

  if (!['text', 'template'].includes(replyType)) {
    throw new AppError('Invalid replyType', 400);
  }

  const rawDelay = payload.delaySeconds;
  let delaySeconds = null;

  if (rawDelay !== null && rawDelay !== undefined && rawDelay !== '') {
    const parsedDelay = Number(rawDelay);
    if (!Number.isFinite(parsedDelay) || parsedDelay < 0 || parsedDelay > 30) {
      throw new AppError('delaySeconds must be between 0 and 30', 400);
    }
    delaySeconds = parsedDelay;
  }

  return {
    keyword,
    reply,
    matchType,
    replyType,
    templateLanguage,
    isActive,
    delaySeconds,
  };
};

const createAutoReplyRule = asyncHandler(async (req, res) => {
  console.log('Incoming Auto Reply:', req.body);
  const payload = buildAutoReplyPayload(req.body || {});
  const savedRule = await AutoReply.create(payload);

  console.log('[whatsapp] Auto reply save DB result:', savedRule);
  return res.status(201).json({ success: true, data: savedRule });
});

const updateAutoReplyRule = asyncHandler(async (req, res) => {
  const payload = buildAutoReplyPayload(req.body || {});
  const savedRule = await AutoReply.findByIdAndUpdate(req.params.id, payload, {
    new: true,
    runValidators: true,
  }).lean();

  if (!savedRule) {
    throw new AppError('Auto reply rule not found', 404);
  }

  return res.status(200).json({ success: true, data: savedRule });
});

const deleteAutoReplyRule = asyncHandler(async (req, res) => {
  const savedRule = await AutoReply.findByIdAndDelete(req.params.id).lean();

  if (!savedRule) {
    throw new AppError('Auto reply rule not found', 404);
  }

  return res.status(200).json({ success: true, data: savedRule });
});

const toggleAutoReplyRule = asyncHandler(async (req, res) => {
  const existingRule = await AutoReply.findById(req.params.id);

  if (!existingRule) {
    throw new AppError('Auto reply rule not found', 404);
  }

  existingRule.isActive = !existingRule.isActive;
  await existingRule.save();

  return res.status(200).json({ success: true, data: existingRule.toObject() });
});

const sendText = asyncHandler(async (req, res) => {
  const { to, body } = req.body;
  if (!to || !body) throw new AppError('to and body are required', 400);

  const data = await dispatchTextMessage({ to, body });
  return res.status(200).json({ success: true, data });
});


const sendAdminAlert = asyncHandler(async (req, res) => {
  const target = String(req.body?.to || ADMIN_ALERT_PHONE || '').replace(/\D/g, '');
  const body = String(req.body?.body || '').trim();

  if (!target || !body) {
    throw new AppError('to and body are required', 400);
  }

  const data = await dispatchTextMessage({ to: target, body });
  return res.status(200).json({ success: true, data });
});

const getAutoReplyRules = asyncHandler(async (_req, res) => {
  const rules = await AutoReply.find().sort({ createdAt: -1 }).lean();

  return res.status(200).json({
    success: true,
    data: rules,
  });
});

const sendTemplate = asyncHandler(async (req, res) => {
  const {
    to,
    template_name,
    language = 'en_US',
    components = [],
  } = req.body;

  if (!to || !template_name) {
    throw new AppError('to and template_name are required', 400);
  }

  if (!components.length) {
    throw new AppError('Template parameters missing', 400);
  }

  const finalComponents = components.map((comp) => {
    if (comp.type === 'body') {
      return {
        ...comp,
        parameters: (comp.parameters || []).filter((p) => p.text && p.text.trim() !== ''),
      };
    }
    return comp;
  });

  const data = await dispatchTemplateMessage({
    to,
    templateName: template_name,
    language,
    components: finalComponents,
  });

  return res.status(200).json({ success: true, data });
});

const sendFlow = asyncHandler(async (req, res) => {
  const {
    to,
    flowId,
    flowToken = '',
    flowCta = 'Open Form',
    screen = '',
    data = {},
    mode = 'published',
  } = req.body || {};

  if (!to || !flowId) {
    throw new AppError('to and flowId are required', 400);
  }

  const result = await dispatchFlowMessage({
    to,
    flowId,
    flowToken,
    flowCta,
    screen,
    data,
    mode,
  });

  return res.status(200).json({
    success: true,
    data: result,
  });
});

const sendMedia = asyncHandler(async (req, res) => {
  const { to, type, caption } = req.body;

  if (!to || !type) {
    throw new AppError('to and type are required', 400);
  }

  // FILE UPLOAD FLOW
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
      caption,
      filename: req.file.originalname,
    });

    return res.status(200).json({ success: true, data });
  }

  // LINK FLOW (BACKWARD COMPATIBLE)
  const link =
    req.body?.link ||
    req.body?.mediaUrl ||
    req.body?.imageUrl ||
    req.body?.documentUrl ||
    req.body?.image?.link ||
    req.body?.document?.link ||
    req.body?.video?.link ||
    req.body?.audio?.link ||
    '';

  if (!link) {
    throw new AppError('file, link, mediaUrl or image/document URL is required', 400);
  }

  const data = await dispatchMediaMessage({
    to,
    type,
    link,
    caption,
    filename: req.body?.filename || '',
  });

  return res.status(200).json({ success: true, data });
});

const sendMessage = asyncHandler(async (req, res) => {
  const { to, type } = req.body;
  if (!to || !type) throw new AppError('to and type are required', 400);

  let data;

  if (!MESSAGE_TYPES.has(String(type))) {
    throw new AppError('Unsupported type. Use text, image, document, template or flow', 400);
  }

  if (type === 'text') {
    if (!req.body.text) throw new AppError('text is required for text type', 400);
    data = await dispatchTextMessage({ to, body: req.body.text });
  } else if (type === 'image') {
    if (!req.body.imageUrl) throw new AppError('imageUrl is required for image type', 400);
    data = await dispatchMediaMessage({
      to,
      type: 'image',
      link: req.body.imageUrl,
      caption: req.body.caption || '',
    });
  } else if (type === 'document') {
    if (!req.body.documentUrl) throw new AppError('documentUrl is required for document type', 400);
    data = await dispatchMediaMessage({
      to,
      type: 'document',
      link: req.body.documentUrl,
      filename: req.body.filename || 'document',
      caption: req.body.caption || '',
    });
  } else if (type === 'template') {
    const templateName = String(req.body.template_name || req.body.templateName || '').trim();
    if (!templateName) throw new AppError('template_name is required for template type', 400);

    data = await dispatchTemplateMessage({
      to,
      templateName,
      language: req.body.language || 'en_US',
      components: Array.isArray(req.body.components) ? req.body.components : [],
    });
  } else if (type === 'flow') {
    const flowId = String(req.body.flowId || '').trim();
    if (!flowId) throw new AppError('flowId is required for flow type', 400);

    data = await dispatchFlowMessage({
      to,
      flowId,
      flowToken: req.body.flowToken || '',
      flowCta: req.body.flowCta || 'Open Form',
      screen: req.body.screen || '',
      data:
        req.body.data && typeof req.body.data === 'object'
          ? req.body.data
          : {},
      mode: req.body.mode || 'published',
    });
  } else {
    throw new AppError('Unsupported type. Use text, image, document, template or flow', 400);
  }

  return res.status(200).json({ success: true, data });
});

const getTemplates = asyncHandler(async (_req, res) => {
  const wabaId = String(process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '').trim();
  const accessToken = String(WHATSAPP_ACCESS_TOKEN || '').trim();

  if (!accessToken) {
    throw new AppError('Missing WhatsApp access token', 400);
  }
  if (!wabaId) {
    throw new AppError('Missing WhatsApp Business Account ID', 400);
  }

  const fetchTemplatesFromApi = async () =>
    axios.get(
      `https://graph.facebook.com/${RESOLVED_API_VERSION}/${wabaId}/message_templates`,
      { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 15000 }
    );

  try {
    let response;

    try {
      response = await fetchTemplatesFromApi();
    } catch (firstError) {
      console.error(
        '[whatsapp] Template API first attempt failed:',
        firstError?.response?.status || firstError?.message
      );
      response = await fetchTemplatesFromApi();
    }

    return res.status(200).json({
      success: true,
      templates: Array.isArray(response?.data?.data) ? response.data.data : [],
    });
  } catch (error) {
    console.error('[whatsapp] Template API failed:', error?.response?.status || error?.message);
    throw normalizeWhatsAppApiError(error, 'Failed to load WhatsApp templates');
  }
});

const getMessages = asyncHandler(async (req, res) => {
  const sortOrder = String(req.query.sort || '').toLowerCase();
  const includeUiFields = String(req.query.includeUiFields || '').toLowerCase() === 'true';
  const includeUnreadCount = String(req.query.includeUnreadCount || '').toLowerCase() === 'true';
  const hasPaging = req.query.page !== undefined || req.query.limit !== undefined;
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = hasPaging ? Math.min(200, Math.max(1, Number(req.query.limit) || 50)) : null;
  const skip = hasPaging && limit ? (page - 1) * limit : 0;

  const isLatestFirst = sortOrder === 'latest' || sortOrder === 'desc';
  const sort = isLatestFirst
    ? { timestamp: -1, time: -1, createdAt: -1 }
    : { timestamp: 1, time: 1, createdAt: 1 };

  const messageQuery = Message.find({}).sort(sort);
  if (hasPaging && limit) {
    messageQuery.skip(skip).limit(limit);
  }

  const [rawMessages, total, unreadCount] = await Promise.all([
    messageQuery.lean(),
    Message.countDocuments({}),
    includeUnreadCount
      ? Message.countDocuments({
          $and: [
            { $or: [{ direction: 'incoming' }, { fromMe: false }] },
            { status: { $ne: 'read' } },
          ],
        })
      : Promise.resolve(null),
  ]);

  const messages = includeUiFields
    ? rawMessages.map((message) => {
        const baseTime = message.timestamp || message.time || message.createdAt;
        const messageDate = baseTime ? new Date(baseTime) : null;
        const isValidDate = messageDate && !Number.isNaN(messageDate.getTime());
        const ist = isValidDate ? formatIST(messageDate) : { date: '', time: '' };

        return {
          ...message,
          formattedTime: ist.time,
          groupedDate: ist.date,
        };
      })
    : rawMessages;

  const payload = {
    data: messages,
    pagination: {
      page,
      limit: limit || rawMessages.length,
      total,
      hasMore: hasPaging ? skip + rawMessages.length < total : false,
    },
  };

  if (includeUnreadCount) {
    payload.unreadCount = unreadCount || 0;
  }

  return res.json(payload);
});

const verifyWebhook = (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;

  if (mode === 'subscribe' && token === verifyToken) return res.status(200).send(challenge);
  return res.sendStatus(403);
};

const receiveWebhook = (req, res) => {
  try {
    console.log('Webhook event:', req.body);

    const enforceSignature =
      String(process.env.WHATSAPP_ENFORCE_WEBHOOK_SIGNATURE).toLowerCase() !== 'false';

    if (enforceSignature && WHATSAPP_APP_SECRET) {
      const signature = String(req.headers['x-hub-signature-256'] || '');

      if (!req.rawBody || !signature.startsWith('sha256=')) {
        console.error('[whatsapp] Missing rawBody or signature header');
        return res.status(403).send('Invalid signature');
      }

      const expectedSignature =
        'sha256=' +
        crypto
          .createHmac('sha256', WHATSAPP_APP_SECRET)
          .update(req.rawBody)
          .digest('hex');

      const isValidSignature = (() => {
        try {
          return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
        } catch (_error) {
          return false;
        }
      })();

      if (!isValidSignature) {
        console.error('[whatsapp] Signature mismatch');
        return res.status(403).send('Invalid signature');
      }
    }

    const entries = Array.isArray(req.body?.entry) ? req.body.entry : [];
    const incomingPayloads = [];
    const statusPayloads = [];

    for (const entry of entries) {
      const changes = Array.isArray(entry?.changes) ? entry.changes : [];

      for (const change of changes) {
        const value = change?.value || {};
        const messageEvents = value?.messages;
        const statusEvents = Array.isArray(value?.statuses) ? value.statuses : [];

        if (statusEvents.length > 0) {
          statusPayloads.push(...statusEvents);
        }

        if (!Array.isArray(messageEvents)) continue;

        const destinationNumber =
          value?.metadata?.display_phone_number ||
          value?.metadata?.phone_number_id ||
          WHATSAPP_PHONE_NUMBER_ID ||
          '';

        for (const msg of messageEvents) {
          if (!SUPPORTED_INCOMING_TYPES.has(String(msg?.type || 'text').toLowerCase())) {
            console.warn(
              `[whatsapp] Unsupported message payload type=${msg?.type || 'unknown'} id=${msg?.id || 'n/a'}`
            );
            continue;
          }

          const normalized = extractIncomingMessageData(msg);
          if (!normalized) {
            console.warn(`[whatsapp] Failed to normalize payload id=${msg?.id || 'n/a'}`);
            continue;
          }

          const parsedTimestamp = parseWebhookTimestamp(normalized.timestamp);
          const normalizedMessageText =
            normalized.type === 'text' ||
            normalized.type === 'button' ||
            normalized.type === 'interactive'
              ? normalized.content
              : normalized.caption || normalized.mediaId;

          const payload = {
            fromMe: false,
            from: normalized.from || msg?.from || '',
            to: destinationNumber,
            message: normalizedMessageText,
            body: normalizedMessageText,
            timestamp: parsedTimestamp,
            status: 'received',
            direction: 'incoming',
            text:
              normalized.type === 'text' ||
              normalized.type === 'button' ||
              normalized.type === 'interactive'
                ? normalized.content
                : '',
            time: parsedTimestamp,
            messageId: normalized.messageId,
            type: normalized.type,
            mediaId: normalized.mediaId,
            caption: normalized.caption,
            filename: normalized.filename,
            mimeType: normalized.mimeType,
            mediaUrl: '',
            interactiveType: normalized.interactiveType,
            replyId: normalized.replyId,
            replyTitle: normalized.replyTitle,
            flowId: normalized.flowId,
            flowToken: normalized.flowToken,
            flowResponseData: normalized.flowResponseData,
          };

          incomingPayloads.push(payload);
        }
      }
    }

    res.status(200).json({ received: true });

    setImmediate(async () => {
      try {
        await persistStatusEvents(statusPayloads);
      } catch (statusError) {
        console.error('[whatsapp] Failed to persist status events:', statusError);
      }

      for (const payload of incomingPayloads) {
        try {
          upsertContactFromIncomingMessage(payload).catch((contactError) => {
            console.error('[whatsapp] Failed to upsert contact:', contactError);
          });

          const customerSync = await upsertCustomerAndEnquiryFromIncomingMessage(payload).catch(
            (customerError) => {
              console.error('[whatsapp] Failed to sync customer/enquiry:', customerError);
              return null;
            }
          );

          if (customerSync?.customer) {
            payload.customerUuid = String(customerSync.customer.Customer_uuid || '');
            payload.customerId = String(customerSync.customer._id || '');
          }

          const { message: savedMessage, isDuplicate } = await saveAndEmitMessage(payload);

          if (!isDuplicate && payload.mediaId) {
            setImmediate(() => {
              processIncomingMediaMessage({
                messageRecordId: savedMessage._id,
                mediaId: payload.mediaId,
              });
            });
          }

          if (!isDuplicate && ['text', 'button', 'interactive'].includes(payload.type)) {
            try {
              const userMessage = String(payload?.text || payload?.message || '').trim();
              console.log('Incoming message:', userMessage);

              const attendanceTriggerResult = await markWhatsAppStartAttendance(payload);
              if (attendanceTriggerResult.handled) {
                continue;
              }

              const flowResult = await processIncomingMessageFlow({
                payload,
                sendText: dispatchTextMessage,
              });

              if (flowResult?.handled) {
                console.log(
                  '[whatsapp] Triggered flow ID:',
                  flowResult?.flowId || flowResult?.session?.flowId || null
                );
                console.log('[whatsapp] Matched keyword:', flowResult?.matchedKeyword || null);
                continue;
              }

              const simpleFlowReply = await getFlowReply(userMessage);
              console.log('Flow matched:', simpleFlowReply);

              if (simpleFlowReply?.replyText) {
                console.log('[whatsapp] Matched keyword:', simpleFlowReply.matchedKeyword || null);
                console.log('[whatsapp] Triggered flow ID:', simpleFlowReply.flowId || null);
                await dispatchTextMessage({
                  to: payload.from,
                  body: simpleFlowReply.replyText,
                });
                continue;
              }

              await sendAutoReplyForIncomingMessage({
  ...payload,
  type: 'text',
  message: userMessage,
  text: userMessage,
});
              continue;
            } catch (replyError) {
              console.error('[whatsapp] Failed to send auto reply:', replyError);
            }
          }
        } catch (saveError) {
          console.error('[whatsapp] Failed to save incoming message:', saveError);
        }
      }
    });
  } catch (error) {
    console.error('[whatsapp] Webhook error:', error);
    return res.status(200).json({ received: true });
  }
};

const getAnalytics = asyncHandler(async (req, res) => {
  const includeCampaignWise =
    String(req.query.campaignWise || '').toLowerCase() === 'true' ||
    String(req.query.includeCampaignWise || '').toLowerCase() === 'true';

  const [totalSentMessages, deliveredMessages, readMessages, failedMessages] = await Promise.all([
    CampaignMessageStatus.distinct('messageId', { status: 'sent' }),
    CampaignMessageStatus.distinct('messageId', { status: 'delivered' }),
    CampaignMessageStatus.distinct('messageId', { status: 'read' }),
    CampaignMessageStatus.distinct('messageId', { status: 'failed' }),
  ]);

  const totalSent = totalSentMessages.length;
  const deliveredCount = deliveredMessages.length;
  const readCount = readMessages.length;
  const failedCount = failedMessages.length;

  const calculatePercentage = (count) =>
    totalSent > 0 ? Number(((count / totalSent) * 100).toFixed(2)) : 0;

  const analytics = {
    totalSent,
    deliveredPercentage: calculatePercentage(deliveredCount),
    readPercentage: calculatePercentage(readCount),
    failedPercentage: calculatePercentage(failedCount),
  };

  if (includeCampaignWise) {
    const campaignWise = await CampaignMessageStatus.aggregate([
      { $match: { campaignId: { $ne: '' }, status: { $in: ['sent', 'delivered', 'read', 'failed'] } } },
      {
        $group: {
          _id: '$campaignId',
          sent: { $addToSet: { $cond: [{ $eq: ['$status', 'sent'] }, '$messageId', null] } },
          delivered: {
            $addToSet: { $cond: [{ $eq: ['$status', 'delivered'] }, '$messageId', null] },
          },
          read: { $addToSet: { $cond: [{ $eq: ['$status', 'read'] }, '$messageId', null] } },
          failed: { $addToSet: { $cond: [{ $eq: ['$status', 'failed'] }, '$messageId', null] } },
        },
      },
      {
        $project: {
          _id: 0,
          campaignId: '$_id',
          totalSent: {
            $size: { $filter: { input: '$sent', as: 'messageId', cond: { $ne: ['$$messageId', null] } } },
          },
          deliveredCount: {
            $size: {
              $filter: { input: '$delivered', as: 'messageId', cond: { $ne: ['$$messageId', null] } },
            },
          },
          readCount: {
            $size: { $filter: { input: '$read', as: 'messageId', cond: { $ne: ['$$messageId', null] } } },
          },
          failedCount: {
            $size: { $filter: { input: '$failed', as: 'messageId', cond: { $ne: ['$$messageId', null] } } },
          },
        },
      },
      { $sort: { campaignId: 1 } },
    ]);

    analytics.campaignWise = campaignWise.map((item) => {
      const base = item.totalSent || 0;
      const toPercent = (count) => (base > 0 ? Number(((count / base) * 100).toFixed(2)) : 0);

      return {
        campaignId: item.campaignId,
        totalSent: base,
        deliveredPercentage: toPercent(item.deliveredCount || 0),
        readPercentage: toPercent(item.readCount || 0),
        failedPercentage: toPercent(item.failedCount || 0),
      };
    });
  }

  return res.status(200).json({ success: true, data: analytics });
});

module.exports = {
  exchangeMetaToken: asyncHandler(async (_req, _res) => { /* stub */ }),
  manualConnect: asyncHandler(async (_req, _res) => { /* stub */ }),
  listAccounts: asyncHandler(async (_req, res) => {
    const config = validateWhatsAppConfig();
    if (!config.ok) {
      return res.status(200).json({ success: true, data: [] });
    }

    const health = await checkWhatsAppHealth();

    return res.status(200).json({
      success: true,
      data: [
        {
          id: process.env.WHATSAPP_PHONE_NUMBER_ID,
          status: health.isConnected ? 'connected' : 'disconnected',
        },
      ],
    });
  }),
  getStatus: asyncHandler(async (_req, res) => {
    const config = validateWhatsAppConfig();
    if (!config.ok) {
      return res.status(200).json({ success: true, status: 'disconnected', data: [] });
    }

    const health = await checkWhatsAppHealth();
    return res.status(200).json({
      success: true,
      status: health.isConnected ? 'connected' : 'disconnected',
      data: [
        {
          id: process.env.WHATSAPP_PHONE_NUMBER_ID,
          status: health.isConnected ? 'connected' : 'disconnected',
        },
      ],
    });
  }),
  deleteAccount: asyncHandler(async (_req, _res) => { /* stub */ }),
  sendText,
  sendTemplate,
  sendAdminAlert,
  sendFlow,
  sendMedia,
  sendMessage,
  createAutoReplyRule,
  updateAutoReplyRule,
  deleteAutoReplyRule,
  toggleAutoReplyRule,
  getAutoReplyRules,
  getTemplates,
  getMessages,
  getAnalytics,
  verifyWebhook,
  receiveWebhook,
};