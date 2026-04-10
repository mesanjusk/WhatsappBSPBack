const mongoose = require("mongoose");

const UsersSchema = new mongoose.Schema({
  User_uuid: { type: String },
  employeeId: { type: String },
  name: { type: String },
  phone: { type: String, unique: true, sparse: true },
  User_name: { type: String, required: true },
  Password: { type: String, required: true },
  Mobile_number: { type: String, required: true, unique: true },
  User_group: { type: String, required: true },
  Amount: { type: Number, required: true },
  AccountID: { type: String },
  lastCustomerMessageAt: { type: Date },
  Allowed_Task_Groups: {
    type: [String],
    default: [],
  },
});

UsersSchema.index({ User_name: 1 });
UsersSchema.index({ User_group: 1 });
UsersSchema.index({ User_uuid: 1 });

module.exports = mongoose.model("Users", UsersSchema);