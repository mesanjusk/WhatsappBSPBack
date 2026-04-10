const { updateOrderStage, getOrderTasks } = require('../services/orderLifecycleService');

const patchOrderStage = async (req, res) => {
  try {
    const updated = await updateOrderStage({
      orderId: req.params.id,
      stage: req.body?.stage,
    });

    return res.status(200).json({
      success: true,
      message: 'Order stage updated successfully',
      result: updated,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to update order stage',
    });
  }
};

const listOrderTasks = async (req, res) => {
  try {
    const tasks = await getOrderTasks(req.params.id);
    return res.status(200).json({ success: true, result: tasks });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to fetch order tasks',
    });
  }
};

module.exports = {
  patchOrderStage,
  listOrderTasks,
};
