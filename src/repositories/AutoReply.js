const mongoose = require('mongoose');

const autoReplySchema = new mongoose.Schema(
  {
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
autoReplySchema.index({ isActive: 1, keyword: 1, matchType: 1 });

module.exports = mongoose.model('AutoReply', autoReplySchema);