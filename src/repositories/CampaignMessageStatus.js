const mongoose = require('mongoose');

const campaignMessageStatusSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'Users', index: true },
    whatsappAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'WhatsAppAccount', index: true },
    messageId: { type: String, required: true, index: true },
    status: { type: String, required: true, enum: ['sent', 'delivered', 'read', 'failed'] },
    timestamp: { type: Date, required: true },
    campaignId: { type: String, default: '' },
  },
  { timestamps: true }
);

campaignMessageStatusSchema.index({ messageId: 1, status: 1 }, { unique: true });
campaignMessageStatusSchema.index({ userId: 1, whatsappAccountId: 1, campaignId: 1, status: 1, timestamp: -1 });

module.exports = mongoose.model('CampaignMessageStatus', campaignMessageStatusSchema);
