const express = require('express');
const router = express.Router();
const { v4: uuid } = require('uuid');
const VendorsLegacy = require('../repositories/vendor');
const VendorMaster = require('../repositories/vendorMaster');
const VendorLedger = require('../repositories/vendorLedger');
const ProductionJob = require('../repositories/productionJob');
const StockMovement = require('../repositories/stockMovement');
const Orders = require('../repositories/order');
const Counter = require('../repositories/counter');
const Items = require('../repositories/items');
const { getAttendanceConfig, saveAttendanceConfig } = require('../services/whatsappAttendanceService');

async function nextCounter(id, seed = 0) {
  const current = await Counter.findById(id).lean();
  if (!current?.seq) {
    await Counter.updateOne({ _id: id }, { $max: { seq: seed } }, { upsert: true });
  }
  const updated = await Counter.findByIdAndUpdate(id, { $inc: { seq: 1 } }, { new: true, upsert: true }).lean();
  return Number(updated?.seq || 1);
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildLedgerSummary(entries = []) {
  let debit = 0;
  let credit = 0;
  for (const entry of entries) {
    const amount = Number(entry.amount || 0);
    if (entry.dr_cr === 'dr') debit += amount;
    else credit += amount;
  }
  return {
    debit,
    credit,
    balance: credit - debit,
    balanceNature: credit - debit >= 0 ? 'payable' : 'advance',
  };
}

async function ensureVendorMaster(vendorPayload = {}) {
  if (vendorPayload.vendor_uuid) {
    const existing = await VendorMaster.findOne({ Vendor_uuid: vendorPayload.vendor_uuid });
    if (existing) return existing;
  }

  if (vendorPayload.vendor_name) {
    const existingByName = await VendorMaster.findOne({ Vendor_name: vendorPayload.vendor_name.trim() });
    if (existingByName) return existingByName;
  }

  const created = await VendorMaster.create({
    Vendor_uuid: vendorPayload.vendor_uuid || uuid(),
    Vendor_name: String(vendorPayload.vendor_name || '').trim(),
    Mobile_number: String(vendorPayload.mobile_number || ''),
    Address: String(vendorPayload.address || ''),
    GST: String(vendorPayload.gst || ''),
    Opening_balance: toNumber(vendorPayload.opening_balance, 0),
    Opening_balance_type: vendorPayload.opening_balance_type || 'none',
    Payment_terms: String(vendorPayload.payment_terms || ''),
    Vendor_type: vendorPayload.vendor_type || 'mixed',
    Active: vendorPayload.active !== false,
    Notes: String(vendorPayload.notes || ''),
    Raw_material_capable: Boolean(vendorPayload.raw_material_capable),
    Jobwork_capable: vendorPayload.jobwork_capable !== false,
  });

  if (created.Opening_balance > 0 && created.Opening_balance_type !== 'none') {
    await VendorLedger.create({
      vendor_uuid: created.Vendor_uuid,
      vendor_name: created.Vendor_name,
      entry_type: 'opening',
      amount: created.Opening_balance,
      dr_cr: created.Opening_balance_type === 'advance' ? 'dr' : 'cr',
      narration: 'Opening balance',
    });
  }

  return created;
}

router.post('/addVendor', async (req, res) => {
  const { Order_Number, Order_uuid, Item_uuid } = req.body;

  try {
    const check = await VendorsLegacy.findOne({ Order_Number: Order_Number });
    if (check) return res.json('exist');

    const matchedItem = await Items.findOne({ $or: [{ Item_name: Item_uuid }, { Item_uuid: Item_uuid }] });
    if (!matchedItem) {
      return res.status(400).json({ message: 'Item not found' });
    }

    const newVendor = new VendorsLegacy({
      Order_Number,
      Order_uuid,
      Item_uuid: matchedItem.Item_uuid,
      Date: new Date().toISOString().split('T')[0],
      Vendor_uuid: uuid(),
    });
    await newVendor.save();
    res.json('notexist');
  } catch (e) {
    console.error('Error saving vendor:', e);
    res.status(500).json('fail');
  }
});

router.get('/GetVendorList', async (_req, res) => {
  try {
    const [legacy, masters] = await Promise.all([
      VendorsLegacy.find({}).lean(),
      VendorMaster.find({}).sort({ Vendor_name: 1 }).lean(),
    ]);

    res.json({
      success: true,
      result: legacy.filter((a) => a.Order_Number),
      masters,
    });
  } catch (err) {
    console.error('Error fetching vendors:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/masters', async (req, res) => {
  try {
    const query = {};
    if (String(req.query.activeOnly || '').toLowerCase() === 'true') query.Active = true;
    const vendors = await VendorMaster.find(query).sort({ Vendor_name: 1 }).lean();
    res.json({ success: true, result: vendors });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/masters', async (req, res) => {
  try {
    const vendor = await ensureVendorMaster(req.body || {});
    res.json({ success: true, result: vendor });
  } catch (error) {
    console.error('Failed to create vendor master', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.put('/masters/:vendorUuid', async (req, res) => {
  try {
    const updated = await VendorMaster.findOneAndUpdate(
      { Vendor_uuid: req.params.vendorUuid },
      {
        $set: {
          Vendor_name: String(req.body.vendor_name || '').trim(),
          Mobile_number: String(req.body.mobile_number || ''),
          Address: String(req.body.address || ''),
          GST: String(req.body.gst || ''),
          Payment_terms: String(req.body.payment_terms || ''),
          Vendor_type: req.body.vendor_type || 'mixed',
          Active: req.body.active !== false,
          Notes: String(req.body.notes || ''),
          Raw_material_capable: Boolean(req.body.raw_material_capable),
          Jobwork_capable: req.body.jobwork_capable !== false,
        },
      },
      { new: true }
    );
    if (!updated) return res.status(404).json({ success: false, message: 'Vendor not found' });
    res.json({ success: true, result: updated });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/orders/list', async (_req, res) => {
  try {
    const orders = await Orders.find({}, { Order_uuid: 1, Order_Number: 1, Items: 1, Customer_uuid: 1, stage: 1, saleSubtotal: 1, createdAt: 1 })
      .sort({ createdAt: -1 })
      .limit(300)
      .lean();
    res.json({ success: true, result: orders });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/settings/whatsapp-attendance', async (_req, res) => {
  try {
    const config = await getAttendanceConfig();
    res.json({ success: true, result: config });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.put('/settings/whatsapp-attendance', async (req, res) => {
  try {
    const config = await saveAttendanceConfig(req.body || {});
    res.json({ success: true, result: config });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/ledger/:vendorUuid', async (req, res) => {
  try {
    const entries = await VendorLedger.find({ vendor_uuid: req.params.vendorUuid }).sort({ date: 1, createdAt: 1 }).lean();
    const summary = buildLedgerSummary(entries);
    res.json({ success: true, result: entries, summary });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/ledger', async (req, res) => {
  try {
    const vendor = await ensureVendorMaster({ vendor_uuid: req.body.vendor_uuid, vendor_name: req.body.vendor_name || req.body.vendorName });
    const created = await VendorLedger.create({
      vendor_uuid: vendor.Vendor_uuid,
      vendor_name: vendor.Vendor_name,
      date: req.body.date || new Date(),
      entry_type: req.body.entry_type,
      job_uuid: req.body.job_uuid || '',
      order_uuid: req.body.order_uuid || '',
      order_number: req.body.order_number || null,
      amount: toNumber(req.body.amount, 0),
      dr_cr: req.body.dr_cr,
      narration: String(req.body.narration || ''),
      transaction_uuid: req.body.transaction_uuid || '',
      reference_type: req.body.reference_type || '',
      reference_id: req.body.reference_id || '',
    });
    res.json({ success: true, result: created });
  } catch (error) {
    console.error('Failed to create vendor ledger entry', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/production-jobs', async (req, res) => {
  try {
    const filter = {};
    if (req.query.vendor_uuid) filter.vendor_uuid = String(req.query.vendor_uuid);
    if (req.query.status) filter.status = String(req.query.status);
    const jobs = await ProductionJob.find(filter).sort({ job_date: -1, createdAt: -1 }).limit(500).lean();
    res.json({ success: true, result: jobs });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/production-jobs', async (req, res) => {
  try {
    const vendor = req.body.vendor_name || req.body.vendor_uuid
      ? await ensureVendorMaster({ vendor_uuid: req.body.vendor_uuid, vendor_name: req.body.vendor_name })
      : null;
    const jobNumber = await nextCounter('production_job_number', 0);
    const linkedOrders = Array.isArray(req.body.linkedOrders)
      ? req.body.linkedOrders.map((entry) => ({
          orderUuid: entry.orderUuid || entry.order_uuid || '',
          orderNumber: toNumber(entry.orderNumber || entry.order_number || 0, 0) || null,
          orderItemLineId: entry.orderItemLineId || entry.order_item_line_id || '',
          quantity: toNumber(entry.quantity, 0),
          outputQuantity: toNumber(entry.outputQuantity, 0),
          costShareAmount: toNumber(entry.costShareAmount, 0),
          allocationBasis: entry.allocationBasis || 'manual',
        }))
      : [];

    const created = await ProductionJob.create({
      job_uuid: uuid(),
      job_number: jobNumber,
      job_type: req.body.job_type || 'manual',
      job_mode: req.body.job_mode || 'jobwork_only',
      vendor_uuid: vendor?.Vendor_uuid || req.body.vendor_uuid || '',
      vendor_name: vendor?.Vendor_name || req.body.vendor_name || '',
      job_date: req.body.job_date || new Date(),
      status: req.body.status || 'draft',
      inputItems: Array.isArray(req.body.inputItems) ? req.body.inputItems : [],
      outputItems: Array.isArray(req.body.outputItems) ? req.body.outputItems : [],
      linkedOrders,
      advanceAmount: toNumber(req.body.advanceAmount, 0),
      jobValue: toNumber(req.body.jobValue, 0),
      materialValue: toNumber(req.body.materialValue, 0),
      otherCharges: toNumber(req.body.otherCharges, 0),
      notes: String(req.body.notes || ''),
      createdBy: String(req.body.createdBy || ''),
    });

    const ledgerEntries = [];
    if (created.advanceAmount > 0 && created.vendor_uuid) {
      ledgerEntries.push({
        vendor_uuid: created.vendor_uuid,
        vendor_name: created.vendor_name,
        entry_type: 'advance_paid',
        amount: created.advanceAmount,
        dr_cr: 'dr',
        narration: `Advance for job #${created.job_number}`,
        job_uuid: created.job_uuid,
        order_uuid: linkedOrders[0]?.orderUuid || '',
        order_number: linkedOrders[0]?.orderNumber || null,
      });
    }
    if (created.jobValue > 0 && created.vendor_uuid) {
      ledgerEntries.push({
        vendor_uuid: created.vendor_uuid,
        vendor_name: created.vendor_name,
        entry_type: created.job_mode === 'vendor_with_material' ? 'material_bill' : 'job_bill',
        amount: created.jobValue,
        dr_cr: 'cr',
        narration: `Bill for job #${created.job_number}`,
        job_uuid: created.job_uuid,
        order_uuid: linkedOrders[0]?.orderUuid || '',
        order_number: linkedOrders[0]?.orderNumber || null,
      });
    }
    if (ledgerEntries.length) await VendorLedger.insertMany(ledgerEntries);

    const stockEntries = [];
    for (const item of created.inputItems || []) {
      if (Number(item.quantity || 0) > 0) {
        stockEntries.push({
          item_uuid: item.itemUuid || '',
          item_name: item.itemName,
          item_type: item.itemType || 'raw',
          movement_type: created.job_mode === 'vendor_with_material' ? 'purchase' : 'issue_to_vendor',
          qty_out: created.job_mode === 'vendor_with_material' ? 0 : Number(item.quantity || 0),
          qty_in: created.job_mode === 'vendor_with_material' ? Number(item.quantity || 0) : 0,
          rate: Number(item.rate || 0),
          value: Number(item.amount || 0),
          vendor_uuid: created.vendor_uuid,
          vendor_name: created.vendor_name,
          order_uuid: linkedOrders[0]?.orderUuid || '',
          order_number: linkedOrders[0]?.orderNumber || null,
          job_uuid: created.job_uuid,
          reference_type: 'production_job',
          reference_id: created.job_uuid,
          remarks: created.notes,
        });
      }
    }
    for (const item of created.outputItems || []) {
      if (Number(item.quantity || 0) > 0) {
        stockEntries.push({
          item_uuid: item.itemUuid || '',
          item_name: item.itemName,
          item_type: item.itemType || 'finished',
          movement_type: item.itemType === 'finished' ? 'finished_goods_receipt' : 'receive_from_vendor',
          qty_in: Number(item.quantity || 0),
          qty_out: 0,
          rate: Number(item.rate || 0),
          value: Number(item.amount || 0),
          vendor_uuid: created.vendor_uuid,
          vendor_name: created.vendor_name,
          order_uuid: linkedOrders[0]?.orderUuid || '',
          order_number: linkedOrders[0]?.orderNumber || null,
          job_uuid: created.job_uuid,
          reference_type: 'production_job',
          reference_id: created.job_uuid,
          remarks: created.notes,
        });
      }
    }
    if (stockEntries.length) await StockMovement.insertMany(stockEntries);

    res.json({ success: true, result: created });
  } catch (error) {
    console.error('Failed to create production job', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/stock-movements', async (req, res) => {
  try {
    const filter = {};
    if (req.query.vendor_uuid) filter.vendor_uuid = String(req.query.vendor_uuid);
    if (req.query.item_name) filter.item_name = String(req.query.item_name);
    const rows = await StockMovement.find(filter).sort({ date: -1, createdAt: -1 }).limit(1000).lean();
    res.json({ success: true, result: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/reports/summary', async (_req, res) => {
  try {
    const [vendors, jobs, stockRows, ledgerRows] = await Promise.all([
      VendorMaster.countDocuments(),
      ProductionJob.find({}).lean(),
      StockMovement.find({}).lean(),
      VendorLedger.find({}).lean(),
    ]);

    const ledgerSummary = buildLedgerSummary(ledgerRows);
    const jobValue = jobs.reduce((sum, job) => sum + Number(job.totalCost || 0), 0);
    const stockValue = stockRows.reduce((sum, row) => sum + Number(row.value || 0) * (Number(row.qty_in || 0) > 0 ? 1 : -1), 0);

    const vendorBalances = Object.values(
      ledgerRows.reduce((acc, row) => {
        const key = row.vendor_uuid;
        if (!acc[key]) acc[key] = { vendor_uuid: key, vendor_name: row.vendor_name, debit: 0, credit: 0 };
        if (row.dr_cr === 'dr') acc[key].debit += Number(row.amount || 0);
        else acc[key].credit += Number(row.amount || 0);
        acc[key].balance = acc[key].credit - acc[key].debit;
        return acc;
      }, {})
    ).sort((a, b) => Math.abs(b.balance || 0) - Math.abs(a.balance || 0));

    res.json({
      success: true,
      result: {
        vendorCount: vendors,
        jobCount: jobs.length,
        totalJobCost: jobValue,
        stockNetValue: stockValue,
        totalVendorPayable: ledgerSummary.balance > 0 ? ledgerSummary.balance : 0,
        totalVendorAdvance: ledgerSummary.balance < 0 ? Math.abs(ledgerSummary.balance) : 0,
        topVendorBalances: vendorBalances.slice(0, 10),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const vendor = await VendorsLegacy.findById(id);
    if (!vendor) {
      return res.status(404).json({ success: false, message: 'Vendor not found' });
    }
    res.status(200).json({ success: true, result: vendor });
  } catch (error) {
    console.error('Error fetching vendor:', error);
    res.status(500).json({ success: false, message: 'Error fetching vendor', error: error.message });
  }
});

module.exports = router;
