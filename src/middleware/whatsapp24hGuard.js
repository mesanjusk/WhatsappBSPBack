const Message = require('../repositories/Message');

const WINDOW_MS = 24 * 60 * 60 * 1000;

const normalizePhone = (value) => String(value || '').replace(/\D/g, '');

const resolveMessageType = (req) => {
  const explicitType = String(req.body?.type || '').trim().toLowerCase();
  if (explicitType) return explicitType;

  if (req.path.endsWith('/send-text')) return 'text';
  if (req.path.endsWith('/send-template')) return 'template';
  if (req.path.endsWith('/send-media')) return String(req.body?.type || '').trim().toLowerCase() || 'media';

  return '';
};

const resolveConversationKeys = (req) => {
  const body = req.body || {};
  const phone = normalizePhone(body.to || body.contactId || body.conversationId);
  const contactId = String(body.contactId || '').trim();
  const conversationId = String(body.conversationId || '').trim();

  return {
    phone,
    contactId,
    conversationId,
  };
};

const buildIncomingFilter = ({ phone, contactId, conversationId }) => {
  const incomingDirectionFilters = [{ direction: 'incoming' }, { fromMe: false }];

  const identityFilters = [];

  if (phone) {
    const last10 = phone.slice(-10);
    identityFilters.push({ from: phone }, { from: `+${phone}` });

    if (last10 && last10 !== phone) {
      identityFilters.push({ from: last10 }, { from: `+${last10}` });
    }
  }

  if (contactId) {
    identityFilters.push({ customerId: contactId }, { customerUuid: contactId });
  }

  if (conversationId) {
    identityFilters.push({ customerId: conversationId }, { customerUuid: conversationId });

    const normalizedConversationPhone = normalizePhone(conversationId);
    if (normalizedConversationPhone) {
      identityFilters.push({ from: normalizedConversationPhone }, { from: `+${normalizedConversationPhone}` });
    }
  }

  if (!identityFilters.length) return null;

  return {
    $and: [{ $or: incomingDirectionFilters }, { $or: identityFilters }],
  };
};

const enforceWhatsApp24hWindow = async (req, res, next) => {
  try {
    const messageType = resolveMessageType(req);

    if (!messageType) {
      return next();
    }

    const conversationKeys = resolveConversationKeys(req);
    const filter = buildIncomingFilter(conversationKeys);

    if (!filter) {
      console.warn('[whatsapp-24h-guard] Skipped enforcement: unable to resolve conversation identity', {
        path: req.originalUrl,
        hasTo: Boolean(req.body?.to),
        hasContactId: Boolean(req.body?.contactId),
        hasConversationId: Boolean(req.body?.conversationId),
      });
      return next();
    }

    const lastIncomingMessage = await Message.findOne(filter)
      .sort({ timestamp: -1, time: -1, createdAt: -1 })
      .lean();

    const lastUserMessageAtRaw =
      lastIncomingMessage?.timestamp || lastIncomingMessage?.time || lastIncomingMessage?.createdAt || null;

    const lastUserMessageAt = lastUserMessageAtRaw ? new Date(lastUserMessageAtRaw) : null;
    const now = Date.now();
    const isInsideWindow =
      Boolean(lastUserMessageAt) && !Number.isNaN(lastUserMessageAt.getTime()) && now - lastUserMessageAt.getTime() <= WINDOW_MS;

    req.whatsapp24hWindow = {
      isInsideWindow,
      lastUserMessageAt,
      messageType,
    };

    if (!isInsideWindow && messageType !== 'template') {
      console.warn('[whatsapp-24h-guard] Blocked outbound message outside 24h window', {
        path: req.originalUrl,
        messageType,
        to: req.body?.to || null,
        contactId: req.body?.contactId || null,
        conversationId: req.body?.conversationId || null,
        lastUserMessageAt,
      });

      return res.status(403).json({
        success: false,
        message: 'Outside 24h window. केवल template messages allowed हैं.',
      });
    }

    return next();
  } catch (error) {
    return next(error);
  }
};

module.exports = { enforceWhatsApp24hWindow };
