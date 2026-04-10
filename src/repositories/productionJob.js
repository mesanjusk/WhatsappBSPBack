const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const qtyItemSchema = new mongoose.Schema(
  {
    itemName: { type: String, required: true, trim: true },
    itemUuid: { type: String, default: '' },
    itemType: { type: String, enum: ['raw', 'semi_finished', 'finished', 'service'], default: 'raw' },
    quantity: { type: Number, default: 0 },
    uom: { type: String, default: 'pcs' },
    rate: { type: Number, default: 0 },
    amount: { type: Number, default: 0 },
    remarks: { type: String, default: '' },
  },
  { _id: true }
);

const linkedOrderSchema = new mongoose.Schema(
  {
    orderUuid: { type: String, default: '' },
    orderNumber: { type: Number, default: null },
    orderItemLineId: { type: String, default: '' },
    quantity: { type: Number, default: 0 },
    outputQuantity: { type: Number, default: 0 },
    costShareAmount: { type: Number, default: 0 },
    allocationBasis: { type: String, enum: ['qty', 'sheets', 'weight', 'manual'], default: 'manual' },
  },
  { _id: true }
);

const productionJobSchema = new mongoose.Schema(
  {
    job_uuid: { type: String, unique: true, index: true },
    job_number: { type: Number, unique: true, sparse: true },
    job_type: {
      type: String,
      enum: ['purchase', 'printing', 'lamination', 'cutting', 'packing', 'manual', 'other'],
      default: 'manual',
      index: true,
    },
    job_mode: {
      type: String,
      enum: ['jobwork_only', 'vendor_with_material', 'own_material_sent', 'mixed'],
      default: 'jobwork_only',
    },
    vendor_uuid: { type: String, default: '', index: true },
    vendor_name: { type: String, default: '' },
    job_date: { type: Date, default: Date.now, index: true },
    status: { type: String, enum: ['draft', 'in_progress', 'completed', 'cancelled'], default: 'draft', index: true },
    inputItems: { type: [qtyItemSchema], default: [] },
    outputItems: { type: [qtyItemSchema], default: [] },
    linkedOrders: { type: [linkedOrderSchema], default: [] },
    advanceAmount: { type: Number, default: 0 },
    jobValue: { type: Number, default: 0 },
    materialValue: { type: Number, default: 0 },
    otherCharges: { type: Number, default: 0 },
    totalCost: { type: Number, default: 0 },
    notes: { type: String, default: '' },
    createdBy: { type: String, default: '' },
  },
  { timestamps: true, collection: 'production_jobs' }
);

productionJobSchema.pre('validate', function(next) {
  if (!this.job_uuid) this.job_uuid = uuidv4();
  const inputs = Array.isArray(this.inputItems) ? this.inputItems.reduce((sum, item) => sum + Number(item.amount || item.quantity * item.rate || 0), 0) : 0;
  const outputs = Number(this.jobValue || 0);
  this.materialValue = Number(this.materialValue || inputs || 0);
  this.totalCost = Number(this.materialValue || 0) + Number(this.jobValue || 0) + Number(this.otherCharges || 0);
  next();
});

module.exports = mongoose.model('ProductionJob', productionJobSchema);
