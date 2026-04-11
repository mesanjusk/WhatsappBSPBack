const express = require('express');
const multer = require('multer');
const { requireAuth } = require('../middleware/auth');
const { createRateLimiter } = require('../middleware/rateLimit');
const { enforceWhatsApp24hWindow } = require('../middleware/whatsapp24hGuard');
const controller = require('../controllers/whatsappController');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });
const messagingLimiter = createRateLimiter({ windowMs: 60 * 1000, maxRequests: 30 });

const safe = (name, fallbackName) => {
  const fn = controller[name] || (fallbackName ? controller[fallbackName] : undefined);
  if (typeof fn === 'function') return fn;
  return (req, res) => {
    res.status(500).json({
      success: false,
      message: `Missing WhatsApp controller handler: ${name}${fallbackName ? ` (fallback: ${fallbackName})` : ''}`,
    });
  };
};

router.get('/connect/config', requireAuth, safe('getConnectConfig'));
router.post('/connect/complete', requireAuth, safe('completeConnection', 'exchangeMetaToken'));
router.post('/connect/manual', requireAuth, safe('manualConnect'));
router.get('/account', requireAuth, safe('getAccount'));
router.post('/embedded-signup/exchange-code', requireAuth, safe('exchangeMetaToken'));
router.post('/manual-connect', requireAuth, safe('manualConnect'));

router.get('/accounts', requireAuth, safe('listAccounts'));
router.post('/accounts/:id/activate', requireAuth, safe('activateAccount'));
router.post('/account/:id/disconnect', requireAuth, safe('disconnectAccount', 'deleteAccount'));
router.post('/account/:id/revalidate', requireAuth, safe('revalidateAccount', 'getStatus'));
router.put('/account/:id/manual', requireAuth, safe('updateManualAccount', 'manualConnect'));
router.get('/status', requireAuth, safe('getStatus'));
router.delete('/accounts/:id', requireAuth, safe('deleteAccount'));
router.delete('/account/:id', requireAuth, safe('deleteAccount'));

router.post('/send-text', requireAuth, messagingLimiter, enforceWhatsApp24hWindow, safe('sendText'));
router.post('/send-template', requireAuth, messagingLimiter, safe('sendTemplate'));
router.post('/send-media', requireAuth, messagingLimiter, upload.single('file'), enforceWhatsApp24hWindow, safe('sendMedia'));
router.post('/send-message', requireAuth, messagingLimiter, enforceWhatsApp24hWindow, safe('sendMessage'));
router.post('/broadcast', requireAuth, messagingLimiter, safe('sendBroadcast', 'sendMessage'));

router.post('/auto-reply', requireAuth, safe('createAutoReplyRule'));
router.get('/auto-reply', requireAuth, safe('getAutoReplyRules'));
router.put('/auto-reply/:id', requireAuth, safe('updateAutoReplyRule'));
router.delete('/auto-reply/:id', requireAuth, safe('deleteAutoReplyRule'));
router.patch('/auto-reply/:id/toggle', requireAuth, safe('toggleAutoReplyRule', 'updateAutoReplyRule'));

router.post('/auto-replies', requireAuth, safe('createAutoReplyRule'));
router.get('/auto-replies', requireAuth, safe('getAutoReplyRules'));
router.put('/auto-replies/:id', requireAuth, safe('updateAutoReplyRule'));
router.delete('/auto-replies/:id', requireAuth, safe('deleteAutoReplyRule'));
router.patch('/auto-replies/:id/toggle', requireAuth, safe('toggleAutoReplyRule', 'updateAutoReplyRule'));

router.post('/auto-reply-rules', requireAuth, safe('createAutoReplyRule'));
router.get('/auto-reply-rules', requireAuth, safe('getAutoReplyRules'));
router.put('/auto-reply-rules/:id', requireAuth, safe('updateAutoReplyRule'));
router.delete('/auto-reply-rules/:id', requireAuth, safe('deleteAutoReplyRule'));
router.patch('/auto-reply-rules/:id/toggle', requireAuth, safe('toggleAutoReplyRule', 'updateAutoReplyRule'));

router.get('/templates', requireAuth, safe('getTemplates'));
router.get('/messages', requireAuth, safe('getMessages'));
router.get('/conversations', requireAuth, safe('getConversations'));
router.get('/analytics', requireAuth, safe('getAnalytics'));

module.exports = router;
