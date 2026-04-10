const mongoose = require('mongoose');
const Customers = require('../repositories/customer');
const Orders = require('../repositories/order');
const Transaction = require('../repositories/transaction');
const Enquiry = require('../repositories/enquiry');
const Message = require('../repositories/Message');

const normalizePhone = (value) => String(value || '').replace(/\D/g, '');

const getCustomerTimeline = async (req, res) => {
  try {
    const customerId = String(req.params.id || '').trim();
    if (!customerId) {
      return res.status(400).json({ success: false, message: 'Customer id is required' });
    }

    const customerFilter = mongoose.isValidObjectId(customerId)
      ? { _id: customerId }
      : { Customer_uuid: customerId };

    const customer = await Customers.findOne(customerFilter).lean();
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    const customerUuid = String(customer.Customer_uuid || '');
    const customerName = String(customer.Customer_name || '');
    const phone = normalizePhone(customer.Mobile_number);

    const [orders, payments, enquiries, whatsappMessages] = await Promise.all([
      Orders.find({ Customer_uuid: customerUuid }).sort({ createdAt: -1 }).lean(),
      Transaction.find({
        $or: [{ Customer_uuid: customerUuid }, { 'Journal_entry.Account_id': customerUuid }],
      })
        .sort({ Transaction_date: -1 })
        .lean(),
      Enquiry.find({ Customer_name: customerName }).sort({ createdAt: -1 }).lean(),
      customerUuid || phone
        ? Message.find(
            customerUuid
              ? { $or: [{ customerUuid }, ...(phone ? [{ from: phone }, { to: phone }] : [])] }
              : { $or: [{ from: phone }, { to: phone }] }
          )
            .sort({ timestamp: -1, createdAt: -1 })
            .lean()
        : [],
    ]);

    return res.status(200).json({
      success: true,
      result: {
        customer,
        orders,
        payments,
        enquiries,
        whatsappMessages,
      },
    });
  } catch (error) {
    console.error('Customer timeline error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch customer timeline' });
  }
};

module.exports = { getCustomerTimeline };
