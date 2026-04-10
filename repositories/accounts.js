const mongoose = require('mongoose');

const AccountsSchema=new mongoose.Schema({
    Account_uuid: { type: String },
    Account_name: { type: String, required: true },
    Account_type: { type: String, required: true },
    Account_code: { type: Number, required: true },
    Balance: { type: Number, required: true },
    Currency: { type: String, required: true },
    Created_at: { type: Date, required: true },
    Updated_at: { type: Date, required: true },
 },  { timestamps: true })

// Indexes for account management
AccountsSchema.index({ Account_name: 1 });
AccountsSchema.index({ Account_type: 1 });
AccountsSchema.index({ Account_code: 1 });
AccountsSchema.index({ Account_uuid: 1 });

 const Accounts = mongoose.model("Accounts", AccountsSchema);

module.exports = Accounts;
