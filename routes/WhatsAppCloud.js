const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { createRateLimiter } = require('../middleware/rateLimit');
const { enforceWhatsApp24hWindow } = require('../middleware/whatsapp24hGuard');

const {
  exchangeMetaToken,
  manualConnect,
  listAccounts,
  deleteAccount,
  getStatus,
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
  getTemplates,
  verifyWebhook,
  getAutoReplyRules,
  receiveWebhook,
  getMessages,
  getAnalytics,
} = require('../controllers/whatsappController');

const multer = require('multer');

// Rate limiter for sending messages
const messagingLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 30,
});

// memory storage (best for cloudinary)
const upload = multer({
  storage: multer.memoryStorage(),
});

// ---------- Embedded Signup ----------
router.post('/embedded-signup/exchange-code', exchangeMetaToken);

// ---------- Manual connect (for SaaS clients) ----------
router.post('/manual-connect', manualConnect);

// ---------- Account routes ----------
router.get('/accounts', listAccounts);
router.get('/status', getStatus);
router.delete('/accounts/:id', deleteAccount);

// ---------- Messaging routes ----------
router.post('/send-text', requireAuth, messagingLimiter, enforceWhatsApp24hWindow, sendText);
router.post('/send-template', requireAuth, messagingLimiter, enforceWhatsApp24hWindow, sendTemplate);
router.post('/send-admin-alert', requireAuth, messagingLimiter, sendAdminAlert);
router.post('/send-flow', requireAuth, messagingLimiter, enforceWhatsApp24hWindow, sendFlow);

router.post(
  '/send-media',
  requireAuth,
  messagingLimiter,
  upload.single('file'),
  enforceWhatsApp24hWindow,
  sendMedia
);

router.post('/send-message', requireAuth, messagingLimiter, enforceWhatsApp24hWindow, sendMessage);

// ---------- Auto Reply ----------
router.post('/auto-reply', requireAuth, createAutoReplyRule);
router.get('/auto-reply', requireAuth, getAutoReplyRules);
router.put('/auto-reply/:id', requireAuth, updateAutoReplyRule);
router.delete('/auto-reply/:id', requireAuth, deleteAutoReplyRule);
router.patch('/auto-reply/:id/toggle', requireAuth, toggleAutoReplyRule);

// Compatibility aliases
router.get('/auto-replies', requireAuth, getAutoReplyRules);
router.get('/auto-reply-rules', requireAuth, getAutoReplyRules);

// ---------- Templates ----------
router.get('/templates', requireAuth, getTemplates);

// ---------- Messages API ----------
router.get('/messages', requireAuth, getMessages);
router.get('/analytics', requireAuth, getAnalytics);

// ---------- Webhook (no auth) ----------
router.get('/webhook', verifyWebhook);
router.post('/webhook', receiveWebhook);

// ---------- Test route ----------
router.get('/test', (_req, res) => {
  res.status(200).json({
    success: true,
    message: 'WhatsApp API Active',
  });
});

module.exports = router;