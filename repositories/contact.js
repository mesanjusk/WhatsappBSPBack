const mongoose = require('mongoose');

const contactSchema = new mongoose.Schema(
  {
    phone: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    name: {
      type: String,
      default: '',
      trim: true,
    },
    tags: {
      type: [String],
      default: [],
    },
    lastMessage: {
      type: String,
      default: '',
    },
    lastSeen: {
      type: Date,
      default: null,
    },
    customFields: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    assignedAgent: {
      type: String,
      default: '',
      trim: true,
    },
    conversation: {
      lastCustomerMessageAt: {
        type: Date,
        default: null,
      },
      windowOpen: {
        type: Boolean,
        default: false,
      },
    },
  },
  { timestamps: true }
);

contactSchema.pre('save', function normalizeContact(next) {
  this.phone = String(this.phone || '').replace(/\D/g, '');

  this.tags = [
    ...new Set(
      (this.tags || [])
        .map((tag) => String(tag || '').trim().toLowerCase())
        .filter(Boolean)
    ),
  ];

  if (
    !this.customFields ||
    typeof this.customFields !== 'object' ||
    Array.isArray(this.customFields)
  ) {
    this.customFields = {};
  }

  next();
});

// Keep only non-duplicate indexes here
contactSchema.index({ tags: 1 });
contactSchema.index({ lastSeen: -1 });
contactSchema.index({ assignedAgent: 1 });

// IMPORTANT:
// Do not add this again:
// contactSchema.index({ phone: 1 }, { unique: true });

module.exports = mongoose.model('Contact', contactSchema);