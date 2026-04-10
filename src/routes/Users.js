const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const Users = require('../repositories/users');
const WhatsAppAccount = require('../repositories/whatsappAccount');
const { encryptSensitiveValue } = require('../utils/crypto');
const { hashPassword, isHashedPassword, verifyPassword } = require('../utils/password');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

const ADMIN_USER_NAME = 'admin';
const ADMIN_PASSWORD = 'admin';

const sanitizeUser = (userDoc) => {
  if (!userDoc) return null;
  return {
    id: String(userDoc._id),
    User_name: userDoc.User_name,
    User_group: userDoc.User_group,
    Mobile_number: userDoc.Mobile_number || '',
    createdAt: userDoc.createdAt,
    updatedAt: userDoc.updatedAt,
  };
};

const sanitizeAccount = (accountDoc) => {
  if (!accountDoc) return null;
  return {
    id: String(accountDoc._id),
    phoneNumberId: accountDoc.phoneNumberId || '',
    businessAccountId: accountDoc.businessAccountId || '',
    wabaId: accountDoc.wabaId || '',
    displayPhoneNumber: accountDoc.displayPhoneNumber || '',
    verifiedName: accountDoc.verifiedName || '',
    connectionMode: accountDoc.connectionMode || 'manual',
    isActive: Boolean(accountDoc.isActive),
    status: accountDoc.status || 'active',
    webhookSubscribed: Boolean(accountDoc.webhookSubscribed),
    connectedAt: accountDoc.connectedAt || null,
    lastSyncAt: accountDoc.lastSyncAt || null,
    lastWebhookAt: accountDoc.lastWebhookAt || null,
  };
};

const signTokenForUser = (payload) =>
  jwt.sign(payload, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '99d' });

router.post('/login', async (req, res) => {
  const { User_name, Password } = req.body || {};
  const normalizedUserName = String(User_name || '').trim();

  if (!normalizedUserName || !Password) {
    return res.status(400).json({ success: false, message: 'User_name and Password are required' });
  }

  try {
    if (normalizedUserName.toLowerCase() === ADMIN_USER_NAME && Password === ADMIN_PASSWORD) {
      const token = signTokenForUser({
        id: 'admin-root',
        userName: ADMIN_USER_NAME,
        userGroup: 'admin',
      });

      return res.status(200).json({
        success: true,
        token,
        user: {
          id: 'admin-root',
          User_name: ADMIN_USER_NAME,
          User_group: 'admin',
          Mobile_number: '',
        },
      });
    }

    const user = await Users.findOne({ User_name: normalizedUserName });
    if (!user || !verifyPassword(Password, user.Password)) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    if (!isHashedPassword(user.Password)) {
      user.Password = hashPassword(Password);
      await user.save();
    }

    const token = signTokenForUser({
      id: user._id,
      userName: user.User_name,
      userGroup: user.User_group,
    });

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
    if (req.user?.isAdmin) {
      return res.status(200).json({
        success: true,
        user: { id: 'admin-root', User_name: ADMIN_USER_NAME, User_group: 'admin', Mobile_number: '' },
      });
    }

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

router.get('/manage', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const users = await Users.find({}).sort({ createdAt: -1 }).lean();
    const userIds = users.map((user) => user._id);
    const accounts = await WhatsAppAccount.find({ userId: { $in: userIds } })
      .sort({ updatedAt: -1 })
      .lean();

    const accountByUserId = new Map();
    for (const account of accounts) {
      const key = String(account.userId);
      if (!accountByUserId.has(key) || account.isActive) {
        accountByUserId.set(key, account);
      }
    }

    return res.status(200).json({
      success: true,
      items: users.map((user) => ({
        ...sanitizeUser(user),
        whatsappAccount: sanitizeAccount(accountByUserId.get(String(user._id))),
      })),
    });
  } catch (error) {
    console.error('Manage users list error:', error);
    return res.status(500).json({ success: false, message: 'Failed to load users' });
  }
});

router.post('/manage', requireAuth, requireAdmin, async (req, res) => {
  const {
    User_name,
    Password,
    Mobile_number = '',
    User_group = 'user',
    whatsapp = {},
  } = req.body || {};

  const normalizedUserName = String(User_name || '').trim();
  const normalizedPassword = String(Password || '').trim();
  const normalizedGroup = String(User_group || 'user').trim() || 'user';

  if (!normalizedUserName || !normalizedPassword) {
    return res.status(400).json({ success: false, message: 'User name and password are required.' });
  }

  if (normalizedUserName.toLowerCase() === ADMIN_USER_NAME) {
    return res.status(400).json({ success: false, message: 'This username is reserved.' });
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const existingUser = await Users.findOne({ User_name: normalizedUserName }).session(session);
    if (existingUser) {
      await session.abortTransaction();
      session.endSession();
      return res.status(409).json({ success: false, message: 'User name already exists.' });
    }

    const createdUsers = await Users.create([
      {
        User_name: normalizedUserName,
        Password: hashPassword(normalizedPassword),
        Mobile_number: String(Mobile_number || '').trim(),
        User_group: normalizedGroup,
      },
    ], { session });

    const user = createdUsers[0];

    const accessToken = String(whatsapp?.accessToken || '').trim();
    const phoneNumberId = String(whatsapp?.phoneNumberId || '').trim();
    const businessAccountId = String(whatsapp?.businessAccountId || '').trim();
    const wabaId = String(whatsapp?.wabaId || businessAccountId).trim();

    let account = null;
    if (accessToken && phoneNumberId && (businessAccountId || wabaId)) {
      account = await WhatsAppAccount.findOneAndUpdate(
        { userId: user._id, phoneNumberId },
        {
          $set: {
            userId: user._id,
            accountKey: '',
            connectionMode: 'manual',
            phoneNumberId,
            businessAccountId: businessAccountId || wabaId,
            wabaId: wabaId || businessAccountId,
            displayPhoneNumber: String(whatsapp?.displayPhoneNumber || '').trim(),
            verifiedName: String(whatsapp?.verifiedName || '').trim(),
            accessTokenEncrypted: encryptSensitiveValue(accessToken),
            tokenType: 'Bearer',
            status: 'active',
            webhookSubscribed: Boolean(whatsapp?.webhookSubscribed),
            isActive: true,
            connectedAt: new Date(),
            lastSyncAt: new Date(),
            metadata: {
              createdByAdmin: true,
            },
          },
        },
        { upsert: true, new: true, session }
      );
    }

    await session.commitTransaction();
    session.endSession();

    return res.status(201).json({
      success: true,
      message: 'User created successfully.',
      item: {
        ...sanitizeUser(user),
        whatsappAccount: sanitizeAccount(account),
      },
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error('Create user error:', error);
    return res.status(500).json({ success: false, message: 'Failed to create user.' });
  }
});

router.put('/manage/:id', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const {
    User_name,
    Password,
    Mobile_number = '',
    User_group = 'user',
    whatsapp = {},
  } = req.body || {};

  try {
    const user = await Users.findById(id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const normalizedUserName = String(User_name || user.User_name).trim();
    if (!normalizedUserName) {
      return res.status(400).json({ success: false, message: 'User name is required.' });
    }

    if (normalizedUserName.toLowerCase() === ADMIN_USER_NAME) {
      return res.status(400).json({ success: false, message: 'This username is reserved.' });
    }

    const conflictUser = await Users.findOne({ User_name: normalizedUserName, _id: { $ne: user._id } }).lean();
    if (conflictUser) {
      return res.status(409).json({ success: false, message: 'User name already exists.' });
    }

    user.User_name = normalizedUserName;
    user.Mobile_number = String(Mobile_number || '').trim();
    user.User_group = String(User_group || 'user').trim() || 'user';
    if (String(Password || '').trim()) {
      user.Password = hashPassword(String(Password).trim());
    }
    await user.save();

    const accessToken = String(whatsapp?.accessToken || '').trim();
    const phoneNumberId = String(whatsapp?.phoneNumberId || '').trim();
    const businessAccountId = String(whatsapp?.businessAccountId || '').trim();
    const wabaId = String(whatsapp?.wabaId || businessAccountId).trim();

    let account = await WhatsAppAccount.findOne({ userId: user._id, isActive: true }).sort({ updatedAt: -1 });
    if (!account && phoneNumberId) {
      account = await WhatsAppAccount.findOne({ userId: user._id, phoneNumberId });
    }

    if (accessToken && phoneNumberId && (businessAccountId || wabaId)) {
      if (!account) {
        account = new WhatsAppAccount({
          userId: user._id,
          phoneNumberId,
          accessTokenEncrypted: encryptSensitiveValue(accessToken),
        });
      }
      account.connectionMode = 'manual';
      account.phoneNumberId = phoneNumberId;
      account.businessAccountId = businessAccountId || wabaId;
      account.wabaId = wabaId || businessAccountId;
      account.displayPhoneNumber = String(whatsapp?.displayPhoneNumber || account.displayPhoneNumber || '').trim();
      account.verifiedName = String(whatsapp?.verifiedName || account.verifiedName || '').trim();
      account.accessTokenEncrypted = encryptSensitiveValue(accessToken);
      account.tokenType = 'Bearer';
      account.status = 'active';
      account.webhookSubscribed = Boolean(whatsapp?.webhookSubscribed);
      account.isActive = true;
      account.lastSyncAt = new Date();
      account.metadata = {
        ...(account.metadata || {}),
        updatedByAdmin: true,
      };
      await WhatsAppAccount.updateMany({ userId: user._id, _id: { $ne: account._id } }, { $set: { isActive: false } });
      await account.save();
    }

    if (whatsapp?.clearAccount === true) {
      await WhatsAppAccount.deleteMany({ userId: user._id });
      account = null;
    }

    return res.status(200).json({
      success: true,
      message: 'User updated successfully.',
      item: {
        ...sanitizeUser(user),
        whatsappAccount: sanitizeAccount(account),
      },
    });
  } catch (error) {
    console.error('Update user error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update user.' });
  }
});

module.exports = router;
