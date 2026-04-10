const express = require('express');
const jwt = require('jsonwebtoken');
const Users = require('../repositories/users');
const { hashPassword, isHashedPassword, verifyPassword } = require('../utils/password');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { User_name, Password } = req.body || {};

  if (!User_name || !Password) {
    return res.status(400).json({ success: false, message: 'User_name and Password are required' });
  }

  try {
    const user = await Users.findOne({ User_name });
    if (!user || !verifyPassword(Password, user.Password)) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    if (!isHashedPassword(user.Password)) {
      user.Password = hashPassword(Password);
      await user.save();
    }

    const token = jwt.sign(
      {
        id: user._id,
        userName: user.User_name,
        userGroup: user.User_group,
      },
      process.env.ACCESS_TOKEN_SECRET,
      { expiresIn: '99d' }
    );

    return res.status(200).json({
      success: true,
      token,
      user: {
        id: user._id,
        User_name: user.User_name,
        User_group: user.User_group,
        Mobile_number: user.Mobile_number,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ success: false, message: 'Login failed' });
  }
});

router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await Users.findById(req.user.id).select('_id User_name User_group Mobile_number');

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    return res.status(200).json({ success: true, user });
  } catch (error) {
    console.error('Me endpoint error:', error);
    return res.status(500).json({ success: false, message: 'Failed to load user' });
  }
});

router.post('/logout', requireAuth, async (_req, res) => {
  return res.status(200).json({ success: true, message: 'Logged out successfully' });
});

module.exports = router;
