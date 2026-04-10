const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    fromMe: Boolean,
    from: String,
    to: String,
    message: String,
    body: String,
    timestamp: Date,
    status: String,
    direction: String,
    messageId: String,
    type: String,
    text: String,
    mediaUrl: String,
    mediaId: String,
    caption: String,
    filename: String,
    mimeType: String,
    time: Date,
    customerUuid: String,
    customerId: String,

    // NEW: interactive / flow support
    interactiveType: String,
    replyId: String,
    replyTitle: String,
    flowId: String,
    flowToken: String,
    flowResponseData: mongoose.Schema.Types.Mixed,
  },
  { timestamps: true }
);

messageSchema.pre('save', function syncLegacyFields(next) {
  if (typeof this.fromMe === 'undefined') {
    this.fromMe = this.direction === 'outgoing';
  }

  if (!this.message && this.body) {
    this.message = this.body;
  }

  if (!this.message && this.text) {
    this.message = this.text;
  }

  if (!this.message && this.mediaUrl) {
    this.message = this.mediaUrl;
  }

  if (!this.body && this.message) {
    this.body = this.message;
  }

  if (!this.body && this.text) {
    this.body = this.text;
  }

  if (!this.text && this.body) {
    this.text = this.body;
  }

  if (!this.text && this.message && this.type === 'text') {
    this.text = this.message;
  }

  if (!this.timestamp && this.time) {
    this.timestamp = this.time;
  }

  if (!this.time && this.timestamp) {
    this.time = this.timestamp;
  }

  next();
});

messageSchema.index({ from: 1 });
messageSchema.index({ to: 1 });
messageSchema.index({ timestamp: 1 });
messageSchema.index({ time: -1 });
messageSchema.index({ messageId: 1 }, { sparse: true });
messageSchema.index({ customerUuid: 1 });
messageSchema.index({ flowId: 1 });
messageSchema.index({ flowToken: 1 });

module.exports = mongoose.model('Message', messageSchema);
