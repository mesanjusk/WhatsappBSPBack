const mongoose = require('mongoose');

const whatsappAccountSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Users',
      required: true,
      index: true,
    },
    accountKey: { type: String, default: '', trim: true },
    connectionMode: {
      type: String,
      enum: ['embedded_signup', 'manual'],
      default: 'manual',
      index: true,
    },
    wabaId: { type: String, default: '', trim: true, index: true },
    businessAccountId: { type: String, default: '', trim: true, index: true },
    phoneNumberId: { type: String, required: true, trim: true, index: true },
    displayPhoneNumber: { type: String, default: '', trim: true },
    verifiedName: { type: String, default: '', trim: true },
    accessTokenEncrypted: { type: String, required: true },
    tokenType: { type: String, default: 'Bearer', trim: true },
    tokenExpiresAt: { type: Date, default: null },
    systemUserId: { type: String, default: '', trim: true },
    appScopedMetaUserId: { type: String, default: '', trim: true },
    status: {
      type: String,
      enum: ['active', 'disconnected', 'error', 'pending'],
      default: 'active',
      index: true,
    },
    webhookSubscribed: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true, index: true },
    connectedAt: { type: Date, default: Date.now },
    lastSyncAt: { type: Date, default: null },
    lastWebhookAt: { type: Date, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: { createdAt: true, updatedAt: true },
  }
);

whatsappAccountSchema.index({ userId: 1, phoneNumberId: 1 }, { unique: true });
whatsappAccountSchema.index({ userId: 1, isActive: 1, status: 1 });
whatsappAccountSchema.index({ userId: 1, accountKey: 1 }, { unique: true, sparse: true });
whatsappAccountSchema.index(
  { userId: 1, isActive: 1 },
  { unique: true, partialFilterExpression: { isActive: true } }
);

module.exports = mongoose.model('WhatsAppAccount', whatsappAccountSchema);
