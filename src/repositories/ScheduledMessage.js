const mongoose = require('mongoose');

const ScheduledMessageSchema = new mongoose.Schema({
  sessionId: { type: String, required: true },
  to: { type: String, required: true },
  message: { type: String, required: true },
  sendAt: { type: Date, required: true },
  status: { type: String, enum: ['scheduled', 'sent', 'failed'], default: 'scheduled' },
  createdAt: { type: Date, default: Date.now }
});

// Indexes to manage scheduled message queue
ScheduledMessageSchema.index({ sessionId: 1 });
ScheduledMessageSchema.index({ to: 1 });
ScheduledMessageSchema.index({ sendAt: 1 });
ScheduledMessageSchema.index({ status: 1 });

module.exports = mongoose.model('ScheduledMessage', ScheduledMessageSchema);
