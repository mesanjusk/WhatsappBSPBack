const mongoose = require('mongoose');

const autoReplySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'Users', index: true },
    whatsappAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'WhatsAppAccount', index: true },
    keyword: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },

    matchType: {
      type: String,
      enum: ['exact', 'contains', 'starts_with'], // ✅ added
      default: 'contains',
    },

    replyType: {
      type: String,
      enum: ['text', 'template'],
      default: 'text',
    },

    reply: {
      type: String,
      required: true,
      trim: true,
    },

    // ✅ NEW (for template replies)
    templateLanguage: {
      type: String,
      default: 'en_US',
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    delaySeconds: {
      type: Number,
      min: 0,
      max: 30,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'autoReplies',
  }
);

// index for faster lookup
autoReplySchema.index({ userId: 1, whatsappAccountId: 1, isActive: 1, keyword: 1, matchType: 1 });

module.exports = mongoose.model('AutoReply', autoReplySchema);