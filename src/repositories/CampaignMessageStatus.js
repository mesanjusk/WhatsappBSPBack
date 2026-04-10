const mongoose = require('mongoose');

const campaignMessageStatusSchema = new mongoose.Schema(
  {
    messageId: { type: String, required: true, index: true },
    status: { type: String, required: true, enum: ['sent', 'delivered', 'read', 'failed'] },
    timestamp: { type: Date, required: true },
    campaignId: { type: String, default: '' },
  },
  { timestamps: true }
);

campaignMessageStatusSchema.index({ messageId: 1, status: 1 }, { unique: true });
campaignMessageStatusSchema.index({ campaignId: 1, status: 1, timestamp: -1 });

module.exports = mongoose.model('CampaignMessageStatus', campaignMessageStatusSchema);
