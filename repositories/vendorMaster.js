const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const vendorMasterSchema = new mongoose.Schema(
  {
    Vendor_uuid: { type: String, unique: true, index: true },
    Vendor_name: { type: String, required: true, trim: true, index: true },
    Mobile_number: { type: String, default: '' },
    Address: { type: String, default: '' },
    GST: { type: String, default: '' },
    Opening_balance: { type: Number, default: 0 },
    Opening_balance_type: { type: String, enum: ['payable', 'advance', 'none'], default: 'none' },
    Payment_terms: { type: String, default: '' },
    Vendor_type: { type: String, enum: ['material', 'jobwork', 'mixed'], default: 'mixed' },
    Active: { type: Boolean, default: true },
    Notes: { type: String, default: '' },
    Raw_material_capable: { type: Boolean, default: false },
    Jobwork_capable: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'vendor_masters' }
);

vendorMasterSchema.pre('validate', function(next) {
  if (!this.Vendor_uuid) this.Vendor_uuid = uuidv4();
  next();
});

module.exports = mongoose.model('VendorMaster', vendorMasterSchema);
