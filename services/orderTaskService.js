const mongoose = require('mongoose');
const Orders = require('../repositories/order');
const Users = require('../repositories/users');

const CLOSED_STAGES = new Set(['ready', 'delivered', 'paid']);

function getIstDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const map = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return map;
}

function buildDefaultDueDate(baseDate = new Date()) {
  const { year, month, day } = getIstDateParts(baseDate);
  return new Date(`${year}-${month}-${day}T20:00:00+05:30`);
}

function getTomorrowDueDate(baseDate = new Date()) {
  const due = buildDefaultDueDate(baseDate);
  due.setUTCDate(due.getUTCDate() + 1);
  return due;
}

function isPendingOrder(order) {
  return !CLOSED_STAGES.has(String(order?.stage || '').toLowerCase());
}

function decorateOrder(order, now = new Date()) {
  const due = order?.dueDate ? new Date(order.dueDate) : null;
  const latestStatusTask = Array.isArray(order?.Status) && order.Status.length ? order.Status[order.Status.length - 1] : null;
  return {
    ...order,
    latestStatusTask,
    overdue: Boolean(due && due.getTime() < now.getTime() && isPendingOrder(order)),
  };
}

async function getPendingOrdersForUser(userOrName) {
  const user = typeof userOrName === 'string'
    ? await Users.findOne({ User_name: userOrName })
    : userOrName;

  if (!user) throw new Error('User not found');

  const rows = await Orders.find({
    $or: [
      { assignedTo: user._id },
      { 'Status.Assigned': user.User_name },
    ],
  }).sort({ dueDate: 1, createdAt: 1 }).lean();

  const orders = rows.map((row) => decorateOrder(row)).filter(isPendingOrder);
  return {
    user: {
      id: String(user._id),
      userName: user.User_name,
      role: user.User_group,
      mobile: user.Mobile_number,
    },
    orders,
    overdueCount: orders.filter((order) => order.overdue).length,
    pendingCount: orders.length,
  };
}

async function getUnassignedOrders() {
  const rows = await Orders.find({
    $and: [
      { $or: [{ assignedTo: null }, { assignedTo: { $exists: false } }] },
      { $or: [{ 'Status.Assigned': 'None' }, { 'Status.Assigned': { $exists: false } }] },
      { stage: { $nin: Array.from(CLOSED_STAGES) } },
    ],
  }).sort({ createdAt: 1 }).lean();

  return rows.map((row) => decorateOrder(row));
}

async function assignOrderToUser({ orderId, userId, userName, assignedBy = 'System', via = 'app' }) {
  const filter = mongoose.isValidObjectId(orderId) ? { _id: orderId } : { Order_uuid: orderId };
  const order = await Orders.findOne(filter);
  if (!order) throw new Error('Order not found');

  const user = userId
    ? await Users.findById(userId)
    : await Users.findOne({ User_name: String(userName || '').trim() });

  if (!user) throw new Error('Assignee user not found');

  order.assignedTo = user._id;
  order.dueDate = order.dueDate || buildDefaultDueDate();
  if (!order.stage || order.stage === 'enquiry') {
    order.stage = 'design';
  }

  if (!Array.isArray(order.Status) || order.Status.length === 0) {
    order.Status = [{
      Task: 'Design',
      Assigned: user.User_name,
      Delivery_Date: order.dueDate,
      Status_number: 1,
      CreatedAt: new Date(),
    }];
  } else {
    const last = order.Status[order.Status.length - 1];
    last.Assigned = user.User_name;
    last.Delivery_Date = order.dueDate;
    last.CreatedAt = new Date();
  }

  order.stageHistory = Array.isArray(order.stageHistory) ? order.stageHistory : [];
  order.stageHistory.push({ stage: order.stage, timestamp: new Date() });
  await order.save();

  const plain = order.toObject ? order.toObject() : order;
  return {
    ...decorateOrder(plain),
    assignmentMeta: {
      assignedBy,
      via,
      assignedAt: new Date(),
    },
  };
}

async function rolloverPendingOrders() {
  const now = new Date();
  const cutoff = buildDefaultDueDate(now);
  if (now.getTime() < cutoff.getTime()) return { touched: 0 };

  const rows = await Orders.find({
    stage: { $nin: Array.from(CLOSED_STAGES) },
    dueDate: { $lt: now },
  });

  let touched = 0;
  for (const order of rows) {
    order.dueDate = getTomorrowDueDate(now);
    await order.save();
    touched += 1;
  }
  return { touched };
}

function buildTaskSummaryMessage({ employee, orders = [] }) {
  if (!orders.length) {
    return `Hi ${employee?.User_name || 'team'}, no pending order tasks are assigned to you right now.`;
  }

  const list = orders.slice(0, 8).map((order, index) => {
    const latest = order.latestStatusTask;
    return `${index + 1}. Order #${order.Order_Number} - ${latest?.Task || order.stage || 'Task'}${order.overdue ? ' (overdue)' : ''}`;
  }).join('\n');

  return `Hi ${employee?.User_name || 'team'}, here are your pending order tasks for today till 8:00 PM:\n${list}`;
}

module.exports = {
  buildDefaultDueDate,
  getTomorrowDueDate,
  getPendingOrdersForUser,
  getUnassignedOrders,
  assignOrderToUser,
  rolloverPendingOrders,
  buildTaskSummaryMessage,
};
