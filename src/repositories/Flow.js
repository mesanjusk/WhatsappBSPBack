const mongoose = require('mongoose');

const flowNodeSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: ['text', 'delay', 'condition', 'end', 'message', 'question', 'button', 'api_call'],
      required: true,
    },
    message: { type: String, default: '' },
    delayMs: { type: Number, default: 0, min: 0 },
    nextNodeId: { type: String, default: null },
    variableKey: { type: String, default: null },
    options: [
      {
        label: { type: String, required: true },
        nextNodeId: { type: String, default: null },
      },
    ],
    buttons: [
      {
        id: { type: String, default: null },
        label: { type: String, required: true },
        value: { type: String, default: null },
        nextNodeId: { type: String, default: null },
      },
    ],
    conditions: [
      {
        variable: { type: String, required: true },
        operator: {
          type: String,
          enum: ['equals', 'not_equals', 'contains', 'exists'],
          default: 'equals',
        },
        value: { type: String, default: null },
        nextNodeId: { type: String, required: true },
      },
    ],
    defaultNextNodeId: { type: String, default: null },
    apiConfig: {
      url: { type: String, default: null },
      method: { type: String, default: 'GET' },
      headers: { type: mongoose.Schema.Types.Mixed, default: {} },
      body: { type: mongoose.Schema.Types.Mixed, default: {} },
      saveResponseAs: { type: String, default: null },
      nextNodeId: { type: String, default: null },
      onErrorNodeId: { type: String, default: null },
      timeoutMs: { type: Number, default: 10000 },
    },
    isStart: { type: Boolean, default: false },
  },
  { _id: false }
);

const flowEdgeSchema = new mongoose.Schema(
  {
    source: { type: String, required: true },
    target: { type: String, required: true },
    label: { type: String, default: '' },
  },
  { _id: false }
);

const flowSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    triggerKeywords: [{ type: String, trim: true, lowercase: true }],
    nodes: { type: [flowNodeSchema], default: [] },
    edges: { type: [flowEdgeSchema], default: [] },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'flows' }
);

flowSchema.index({ isActive: 1, triggerKeywords: 1 });

flowSchema.statics.findActiveFlows = function findActiveFlows() {
  return this.find({ isActive: true }).sort({ createdAt: 1 });
};

flowSchema.statics.findMatchingFlow = async function findMatchingFlow(messageText = '') {
  const normalizedMessage = String(messageText || '').trim().toLowerCase();
  if (!normalizedMessage) return null;

  const activeFlows = await this.findActiveFlows().lean();
  return (
    activeFlows.find((flow) =>
      Array.isArray(flow.triggerKeywords) &&
      flow.triggerKeywords.some((keyword) => {
        const normalizedKeyword = String(keyword || '').trim().toLowerCase();
        return Boolean(normalizedKeyword) && normalizedMessage.includes(normalizedKeyword);
      })
    ) || null
  );
};

module.exports = mongoose.model('Flow', flowSchema);
