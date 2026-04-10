const express = require('express');
const router = express.Router();
const Message = require('../repositories/Message');     // Adjust if needed
const Customer = require('../repositories/customer');   // Adjust if needed


/**
 * GET /chatlist
 * Returns a list of customers who have any chat history (sent/received)
 */
router.get('/chatlist', async (req, res) => {
  try {
    const fromNumbers = await Message.distinct('from', { from: { $ne: 'me' } });
    const toNumbers = await Message.distinct('to', { to: { $ne: 'me' } });

    const uniqueNumbers = [...new Set([...fromNumbers, ...toNumbers])];

    const customers = await Customer.find({
      Mobile_number: { $in: uniqueNumbers }
    });

    res.json({ success: true, list: customers });
  } catch (err) {
    console.error('Error in /chatlist:', err);
    res.status(500).json({ success: false, error: 'Failed to load chat list' });
  }
});

/**
 * GET /customer/by-number/:number
 * Finds a customer by normalized WhatsApp number
 */
router.get('/customer/by-number/:number', async (req, res) => {
  try {
    const number = req.params.number;

    const customer = await Customer.findOne({ Mobile_number: number });

    if (customer) {
      res.json({ success: true, customer });
    } else {
      res.json({ success: false, error: 'Customer not found' });
    }
  } catch (err) {
    console.error('Error in /customer/by-number:', err);
    res.status(500).json({ success: false, error: 'Error fetching customer' });
  }
});

module.exports = router;
