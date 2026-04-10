const mongoose = require("mongoose");

const StockLedgerSchema = new mongoose.Schema(
  {
    itemUuid: { type: String, required: true, index: true },
    itemName: { type: String, required: true },
    txnType: {
      type: String,
      enum: ["opening", "purchase", "issue", "adjustment", "return"],
      required: true,
    },
    qtyIn: { type: Number, default: 0 },
    qtyOut: { type: Number, default: 0 },
    unit: { type: String, default: "Nos" },
    rate: { type: Number, default: 0 },
    orderUuid: { type: String, default: null },
    vendorCustomerUuid: { type: String, default: null },
    note: { type: String, default: "" },
    createdBy: { type: String, default: "system" },
  },
  { timestamps: true }
);

StockLedgerSchema.index({ createdAt: -1 });
module.exports = mongoose.model("StockLedger", StockLedgerSchema);
