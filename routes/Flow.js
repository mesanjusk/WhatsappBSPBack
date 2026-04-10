const express = require('express');
const { requireAuth } = require('../middleware/auth');
const {
  listFlows,
  createFlow,
  updateFlow,
  deleteFlow,
  toggleFlow,
} = require('../controllers/flowController');

const router = express.Router();

router.get('/flows', requireAuth, listFlows);
router.post('/flows', requireAuth, createFlow);
router.put('/flows/:id', requireAuth, updateFlow);
router.delete('/flows/:id', requireAuth, deleteFlow);
router.post('/flows/toggle/:id', requireAuth, toggleFlow);

module.exports = router;
