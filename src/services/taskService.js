const mongoose = require('mongoose');
const { v4: uuid } = require('uuid');
const Tasks = require('../repositories/tasks');
const Orders = require('../repositories/order');

const resolveOrderFilter = (rawId) => {
  const id = String(rawId || '').trim();
  if (!id) return null;
  if (mongoose.isValidObjectId(id)) return { _id: id };
  if (/^\d+$/.test(id)) return { Order_Number: Number(id) };
  return { Order_uuid: id };
};

const createTask = async (payload = {}) => {
  const Task_name = String(payload.Task_name || '').trim();
  const Task_group = String(payload.Task_group || '').trim();
  const status = String(payload.status || 'pending').trim().toLowerCase();

  if (!Task_name || !Task_group) {
    const error = new Error('Task_name and Task_group are required');
    error.statusCode = 400;
    throw error;
  }

  if (!['pending', 'in_progress', 'done'].includes(status)) {
    const error = new Error('status must be one of pending, in_progress, done');
    error.statusCode = 400;
    throw error;
  }

  let resolvedOrderId = null;
  const orderInput = payload.orderId || payload.Order_id || payload.Order_uuid || payload.Order_Number;
  if (orderInput) {
    const orderFilter = resolveOrderFilter(orderInput);
    const order = orderFilter ? await Orders.findOne(orderFilter, { _id: 1 }).lean() : null;
    if (!order) {
      const error = new Error('Provided orderId is invalid or order does not exist');
      error.statusCode = 400;
      throw error;
    }
    resolvedOrderId = order._id;
  }

  const newTask = new Tasks({
    Task_uuid: uuid(),
    Task_name,
    Task_group,
    orderId: resolvedOrderId,
    deadline: payload.deadline || null,
    status,
  });

  await newTask.save();
  return newTask;
};

module.exports = { createTask };
