const mongoose = require('mongoose');

const VendorsSchema=new mongoose.Schema({
    Vendor_uuid: { type: String },
    Date: { type: Date, required: true },
    Order_Number: { type: Number, required: true },
    Order_uuid: { type: String, required: true },
    Item_uuid: { type: String, required: true },
 },  { timestamps: true })

// Indexes for faster vendor lookups
VendorsSchema.index({ Order_Number: 1 });
VendorsSchema.index({ Order_uuid: 1 });
VendorsSchema.index({ Item_uuid: 1 });
VendorsSchema.index({ Date: 1 });

 const Vendors = mongoose.model("Vendors", VendorsSchema);

module.exports = Vendors;
