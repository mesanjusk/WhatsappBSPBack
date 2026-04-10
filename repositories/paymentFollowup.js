// Models/paymentFollowup.js
const mongoose = require("mongoose");

const paymentFollowupSchema = new mongoose.Schema(
  {
    followup_uuid: { type: String, required: true, index: true, unique: true },
    customer_name: { type: String, required: true, index: true },
    amount: { type: Number, required: true, min: 0 },
    title: { type: String, default: "" }, // short reason/subject
    remark: { type: String, default: "" },
    followup_date: { type: Date, required: true }, // default handled in route
    status: {
      type: String,
      enum: ["pending", "done"],
      default: "pending",
      index: true,
    },
    created_by: { type: String, default: "" }, // optional: user name/id
  },
  { timestamps: true }
);

module.exports = mongoose.model("PaymentFollowup", paymentFollowupSchema);
