const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const vendorLedgerSchema = new mongoose.Schema(
  {
    entry_uuid: { type: String, unique: true, index: true },
    vendor_uuid: { type: String, required: true, index: true },
    vendor_name: { type: String, default: '' },
    date: { type: Date, default: Date.now, index: true },
    entry_type: {
      type: String,
      enum: ['opening', 'advance_paid', 'material_issued', 'job_bill', 'material_bill', 'debit_note', 'payment', 'adjustment'],
      required: true,
      index: true,
    },
    job_uuid: { type: String, default: '', index: true },
    order_uuid: { type: String, default: '', index: true },
    order_number: { type: Number, default: null },
    amount: { type: Number, required: true },
    dr_cr: { type: String, enum: ['dr', 'cr'], required: true },
    narration: { type: String, default: '' },
    transaction_uuid: { type: String, default: '' },
    reference_type: { type: String, default: '' },
    reference_id: { type: String, default: '' },
  },
  { timestamps: true, collection: 'vendor_ledger' }
);

vendorLedgerSchema.pre('validate', function(next) {
  if (!this.entry_uuid) this.entry_uuid = uuidv4();
  next();
});

module.exports = mongoose.model('VendorLedger', vendorLedgerSchema);
