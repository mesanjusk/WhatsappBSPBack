const mongoose = require('mongoose');

const CustomergroupSchema=new mongoose.Schema({
    Customer_group_uuid: {type: String},
    Customer_group: { type: String, required: true },
 })

// Indexes for group queries
CustomergroupSchema.index({ Customer_group: 1 });
CustomergroupSchema.index({ Customer_group_uuid: 1 });

 const Customergroup = mongoose.model("Customergroup", CustomergroupSchema);

module.exports = Customergroup;
