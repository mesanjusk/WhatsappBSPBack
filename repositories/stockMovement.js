const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const stockMovementSchema = new mongoose.Schema(
  {
    movement_uuid: { type: String, unique: true, index: true },
    date: { type: Date, default: Date.now, index: true },
    item_uuid: { type: String, default: '' },
    item_name: { type: String, required: true, trim: true, index: true },
    item_type: { type: String, enum: ['raw', 'semi_finished', 'finished'], default: 'raw' },
    movement_type: {
      type: String,
      enum: ['purchase', 'issue_to_vendor', 'receive_from_vendor', 'consume_in_production', 'adjustment', 'wastage', 'finished_goods_receipt'],
      required: true,
      index: true,
    },
    qty_in: { type: Number, default: 0 },
    qty_out: { type: Number, default: 0 },
    rate: { type: Number, default: 0 },
    value: { type: Number, default: 0 },
    vendor_uuid: { type: String, default: '', index: true },
    vendor_name: { type: String, default: '' },
    order_uuid: { type: String, default: '', index: true },
    order_number: { type: Number, default: null },
    job_uuid: { type: String, default: '', index: true },
    reference_type: { type: String, default: '' },
    reference_id: { type: String, default: '' },
    remarks: { type: String, default: '' },
  },
  { timestamps: true, collection: 'stock_movements' }
);

stockMovementSchema.pre('validate', function(next) {
  if (!this.movement_uuid) this.movement_uuid = uuidv4();
  if (!this.value) this.value = Number((this.qty_in || this.qty_out || 0) * (this.rate || 0));
  next();
});

module.exports = mongoose.model('StockMovement', stockMovementSchema);
