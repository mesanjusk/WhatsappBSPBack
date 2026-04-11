const express = require('express');
const multer = require('multer');
const { requireAuth } = require('../middleware/auth');
const { createRateLimiter } = require('../middleware/rateLimit');
const { enforceWhatsApp24hWindow } = require('../middleware/whatsapp24hGuard');

const {
  getConnectConfig,
  exchangeMetaToken,
  completeConnection,
  manualConnect,
  listAccounts,
  getAccount,
  activateAccount,
  deleteAccount,
  disconnectAccount,
  revalidateAccount,
  updateManualAccount,
  getStatus,
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
  getContacts,
  createContact,
  updateContact,
  importContacts,
  getTemplates,
  getMessages,
  getConversations,
  getAnalytics,
} = require('../controllers/whatsappController');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });
const messagingLimiter = createRateLimiter({ windowMs: 60 * 1000, maxRequests: 30 });

router.get('/connect/config', requireAuth, getConnectConfig);
router.post('/connect/complete', requireAuth, completeConnection);
router.post('/connect/manual', requireAuth, manualConnect);
router.get('/account', requireAuth, getAccount);
router.post('/embedded-signup/exchange-code', requireAuth, exchangeMetaToken);
router.post('/manual-connect', requireAuth, manualConnect);

router.get('/accounts', requireAuth, listAccounts);
router.post('/accounts/:id/activate', requireAuth, activateAccount);
router.post('/account/:id/disconnect', requireAuth, disconnectAccount);
router.post('/account/:id/revalidate', requireAuth, revalidateAccount);
router.put('/account/:id/manual', requireAuth, updateManualAccount);
router.get('/status', requireAuth, getStatus);
router.delete('/accounts/:id', requireAuth, deleteAccount);
router.delete('/account/:id', requireAuth, deleteAccount);

router.post('/send-text', requireAuth, messagingLimiter, enforceWhatsApp24hWindow, sendText);
router.post('/send-template', requireAuth, messagingLimiter, sendTemplate);
router.post('/send-media', requireAuth, messagingLimiter, upload.single('file'), enforceWhatsApp24hWindow, sendMedia);
router.post('/send-message', requireAuth, messagingLimiter, enforceWhatsApp24hWindow, sendMessage);
router.post('/broadcast', requireAuth, messagingLimiter, sendBroadcast);

router.get('/contacts', requireAuth, getContacts);
router.post('/contacts', requireAuth, createContact);
router.put('/contacts/:id', requireAuth, updateContact);
router.post('/contacts/import', requireAuth, importContacts);

router.post('/auto-reply', requireAuth, createAutoReplyRule);
router.get('/auto-reply', requireAuth, getAutoReplyRules);
router.put('/auto-reply/:id', requireAuth, updateAutoReplyRule);
router.delete('/auto-reply/:id', requireAuth, deleteAutoReplyRule);
router.patch('/auto-reply/:id/toggle', requireAuth, toggleAutoReplyRule);

router.get('/templates', requireAuth, getTemplates);
router.get('/messages', requireAuth, getMessages);
router.get('/conversations', requireAuth, getConversations);
router.get('/analytics', requireAuth, getAnalytics);

module.exports = router;
