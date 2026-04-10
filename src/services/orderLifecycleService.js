const mongoose = require('mongoose');
const Orders = require('../repositories/order');
const Tasks = require('../repositories/tasks');

const VALID_STAGES = [
  'enquiry',
  'quoted',
  'approved',
  'design',
  'printing',
  'finishing',
  'ready',
  'delivered',
  'paid',
];

const stageIndex = new Map(VALID_STAGES.map((value, index) => [value, index]));

const resolveOrderFilter = (rawId) => {
  const id = String(rawId || '').trim();
  if (!id) return null;
  if (mongoose.isValidObjectId(id)) return { _id: id };
  if (/^\d+$/.test(id)) return { Order_Number: Number(id) };
  return { Order_uuid: id };
};

const normalizeStage = (stage) => String(stage || '').trim().toLowerCase();

const assertValidStage = (stage) => {
  if (!stageIndex.has(stage)) {
    const error = new Error(`Invalid stage. Allowed stages: ${VALID_STAGES.join(', ')}`);
    error.statusCode = 400;
    throw error;
  }
};

const updateOrderStage = async ({ orderId, stage }) => {
  const normalizedStage = normalizeStage(stage);
  assertValidStage(normalizedStage);

  const filter = resolveOrderFilter(orderId);
  if (!filter) {
    const error = new Error('Order id is required');
    error.statusCode = 400;
    throw error;
  }

  const order = await Orders.findOne(filter).lean();
  if (!order) {
    const error = new Error('Order not found');
    error.statusCode = 404;
    throw error;
  }

  const currentStage = normalizeStage(order.stage || 'enquiry');
  assertValidStage(currentStage);

  if (stageIndex.get(normalizedStage) < stageIndex.get(currentStage)) {
    const error = new Error(`Stage rollback not allowed from ${currentStage} to ${normalizedStage}`);
    error.statusCode = 400;
    throw error;
  }

  if (currentStage === normalizedStage) {
    return await Orders.findById(order._id);
  }

  await Orders.updateOne(
    { _id: order._id },
    {
      $set: { stage: normalizedStage },
      $push: { stageHistory: { stage: normalizedStage, timestamp: new Date() } },
    }
  );

  return await Orders.findById(order._id);
};

const getOrderTasks = async (orderId) => {
  const filter = resolveOrderFilter(orderId);
  if (!filter) {
    const error = new Error('Order id is required');
    error.statusCode = 400;
    throw error;
  }

  const order = await Orders.findOne(filter, { _id: 1 }).lean();
  if (!order) {
    const error = new Error('Order not found');
    error.statusCode = 404;
    throw error;
  }

  return await Tasks.find({ orderId: order._id }).sort({ deadline: 1, createdAt: -1 });
};

module.exports = {
  VALID_STAGES,
  updateOrderStage,
  getOrderTasks,
};
