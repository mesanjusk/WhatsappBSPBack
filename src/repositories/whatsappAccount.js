const mongoose = require('mongoose');

const whatsappAccountSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Users',
      required: true,
      index: true,
    },
    businessId: { type: String, required: true, index: true },
    wabaId: { type: String, required: true, index: true },
    phoneNumberId: { type: String, required: true, index: true },
    displayName: { type: String, required: true },
    accessToken: { type: String, required: true },
    tokenExpiresAt: { type: Date, required: true },
  },
  {
    timestamps: { createdAt: true, updatedAt: true },
  }
);

whatsappAccountSchema.index({ userId: 1, phoneNumberId: 1 }, { unique: true });

module.exports = mongoose.model('WhatsAppAccount', whatsappAccountSchema);
