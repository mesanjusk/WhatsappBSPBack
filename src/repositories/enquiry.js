const mongoose = require('mongoose');

const EnquirySchema=new mongoose.Schema({
    Enquiry_uuid: { type: String },
    Enquiry_Number: { type: Number, required: true, unique: true },
    Customer_name: { type: String, required: true },
    Priority: { type: String, required: true },
    Item: { type: String, required: true },
    Task: { type: String, required: true },
    Assigned: { type: String, required: true },
    Delivery_Date: { type: Date, required: true },
    Remark: { type: String, required: true },
 },  { timestamps: true })

// Index definitions to improve query speed
EnquirySchema.index({ Customer_name: 1 });
EnquirySchema.index({ Priority: 1 });
EnquirySchema.index({ Item: 1 });
EnquirySchema.index({ Task: 1 });
EnquirySchema.index({ Assigned: 1 });
EnquirySchema.index({ Delivery_Date: 1 });

 const Enquiry = mongoose.model("Enquiry", EnquirySchema);

module.exports = Enquiry;
