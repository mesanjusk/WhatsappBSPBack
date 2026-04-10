const Orders = require('../repositories/order');
const Transaction = require('../repositories/transaction');
const Attendance = require('../repositories/attendance');

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
const endOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

const getDashboardSummary = async (_req, res) => {
  try {
    const now = new Date();
    const from = startOfDay(now);
    const to = endOfDay(now);

    const [orderAgg, revenueAgg, pendingPaymentAgg, attendanceAgg, urgentOrders] = await Promise.all([
      Orders.aggregate([
        {
          $facet: {
            todayOrders: [{ $match: { createdAt: { $gte: from, $lte: to } } }, { $count: 'count' }],
            pendingOrders: [
              { $match: { stage: { $nin: ['delivered', 'paid'] } } },
              { $count: 'count' },
            ],
          },
        },
      ]),
      Transaction.aggregate([
        { $match: { Transaction_date: { $gte: from, $lte: to } } },
        { $group: { _id: null, revenue: { $sum: { $ifNull: ['$Total_Debit', 0] } } } },
      ]),
      Orders.aggregate([
        { $match: { billStatus: { $ne: 'paid' } } },
        { $group: { _id: null, pendingPayments: { $sum: { $ifNull: ['$Amount', 0] } } } },
      ]),
      Attendance.aggregate([
        { $match: { Date: { $gte: from, $lte: to } } },
        { $group: { _id: null, count: { $sum: 1 } } },
      ]),
      Orders.find({
        dueDate: { $lt: now, $ne: null },
        stage: { $nin: ['delivered', 'paid'] },
      })
        .sort({ dueDate: 1 })
        .limit(100)
        .lean(),
    ]);

    const todayOrdersCount = orderAgg?.[0]?.todayOrders?.[0]?.count || 0;
    const pendingOrdersCount = orderAgg?.[0]?.pendingOrders?.[0]?.count || 0;
    const todayRevenue = revenueAgg?.[0]?.revenue || 0;
    const pendingPayments = pendingPaymentAgg?.[0]?.pendingPayments || 0;
    const todayAttendance = attendanceAgg?.[0]?.count || 0;

    return res.status(200).json({
      success: true,
      result: {
        todayOrdersCount,
        pendingOrdersCount,
        urgentOrders,
        todayRevenue,
        pendingPayments,
        todayAttendance,
      },
    });
  } catch (error) {
    console.error('Dashboard summary error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch dashboard summary' });
  }
};

module.exports = { getDashboardSummary };
