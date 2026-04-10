const mongoose = require('mongoose');

const VendorWorkSchema = new mongoose.Schema(
  {
    work_uuid: { type: String, required: true, unique: true, index: true },

    Date: { type: Date, default: Date.now },

    Vendor_uuid: { type: String, required: true, index: true },
    Vendor_name: { type: String, required: true },

    Order_Number: { type: Number, default: null, index: true },
    Order_uuid: { type: String, default: '', index: true },

    Process: {
      type: String,
      enum: ['purchase', 'printing', 'lamination', 'cutting', 'packing', 'other'],
      default: 'other',
    },

    Material_Source: {
      type: String,
      enum: ['own', 'vendor', 'mixed'],
      default: 'own',
    },

    Input_Item_Name: { type: String, default: '' },
    Output_Item_Name: { type: String, default: '' },

    Input_Qty: { type: Number, default: 0 },
    Output_Qty: { type: Number, default: 0 },

    Amount: { type: Number, default: 0 },
    Advance_Amount: { type: Number, default: 0 },
    Paid_Amount: { type: Number, default: 0 },

    Status: {
      type: String,
      enum: ['draft', 'sent', 'completed', 'paid'],
      default: 'draft',
    },

    Notes: { type: String, default: '' },
  },
  { timestamps: true }
);

VendorWorkSchema.index({ Vendor_uuid: 1, Date: -1 });
VendorWorkSchema.index({ Order_uuid: 1, Date: -1 });
VendorWorkSchema.index({ Status: 1 });

module.exports = mongoose.model('VendorWork', VendorWorkSchema);