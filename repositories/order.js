const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const statusSchema = new mongoose.Schema(
  {
    Task: { type: String, required: true },
    Assigned: { type: String, required: true },
    Delivery_Date: { type: Date, required: true },
    Status_number: { type: Number, required: true },
    CreatedAt: { type: Date, required: true },
  },
  { _id: false }
);

const stepSchema = new mongoose.Schema(
  {
    label: { type: String, required: true },
    checked: { type: Boolean, default: false },
    vendorId: { type: String, default: null },
    vendorName: { type: String, default: null },
    costAmount: { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: ["pending", "done", "posted", "paid"],
      default: "pending",
    },
    posting: {
      isPosted: { type: Boolean, default: false },
      txnId: { type: mongoose.Schema.Types.Mixed, default: null },
      postedAt: { type: Date, default: null },
    },
  },
  { _id: true }
);

stepSchema.pre("validate", function (next) {
  if (["done", "posted", "paid"].includes(this.status) && !this.vendorId) {
    return next(new Error(`Vendor is required when step status is ${this.status}`));
  }
  next();
});

const itemSchema = new mongoose.Schema(
  {
    lineId: { type: String, default: uuidv4 },
    Item: { type: String, required: true },
    Item_uuid: { type: String, default: "" },
    Item_group: { type: String, default: "" },
    itemType: {
      type: String,
      enum: ["finished_item", "raw_material", "service", "consumable"],
      default: "finished_item",
    },
    Quantity: { type: Number, required: true },
    Rate: { type: Number, required: true },
    Amount: { type: Number, required: true },
    Priority: { type: String, default: "Normal" },
    Remark: { type: String, default: "" },
  },
  { _id: true }
);

const vendorAssignmentSchema = new mongoose.Schema(
  {
    assignmentId: { type: String, default: uuidv4 },
    vendorCustomerUuid: { type: String, required: true },
    vendorName: { type: String, required: true },
    workType: { type: String, default: "General" },
    note: { type: String, default: "" },
    qty: { type: Number, default: 0, min: 0 },
    amount: { type: Number, default: 0, min: 0 },
    dueDate: { type: Date, default: null },
    paymentStatus: {
      type: String,
      enum: ["pending", "partial", "paid"],
      default: "pending",
    },
    status: {
      type: String,
      enum: ["pending", "in_progress", "completed"],
      default: "pending",
    },
  },
  { _id: true }
);

const orderWorkRowSchema = new mongoose.Schema(
  {
    workRowId: { type: String, default: uuidv4 },
    sourceLineId: { type: String, default: "" },
    sourceItemUuid: { type: String, default: "" },
    sourceItemName: { type: String, default: "" },
    sourceBomComponentId: { type: String, default: "" },
    type: {
      type: String,
      enum: ["raw_material", "service", "consumable"],
      required: true,
    },
    itemUuid: { type: String, default: "" },
    itemName: { type: String, required: true },
    itemGroup: { type: String, default: "" },
    unit: { type: String, default: "Nos" },
    requiredQty: { type: Number, default: 0, min: 0 },
    reservedQty: { type: Number, default: 0, min: 0 },
    consumedQty: { type: Number, default: 0, min: 0 },
    executionMode: {
      type: String,
      enum: ["stock", "purchase", "in_house", "vendor", "hybrid"],
      default: "stock",
    },
    assignedVendorCustomerUuid: { type: String, default: null },
    assignedVendorName: { type: String, default: null },
    assignedUserUuid: { type: String, default: null },
    assignedUserName: { type: String, default: null },
    assignLater: { type: Boolean, default: true },
    status: {
      type: String,
      enum: ["pending", "assigned", "in_progress", "done", "cancelled"],
      default: "pending",
    },
    estimatedCost: { type: Number, default: 0, min: 0 },
    actualCost: { type: Number, default: 0, min: 0 },
    note: { type: String, default: "" },
    dueDate: { type: Date, default: null },
  },
  { _id: true }
);

const OrdersSchema = new mongoose.Schema(
  {
    Order_uuid: { type: String, required: true, unique: true },
    Order_Number: { type: Number, required: true, unique: true },
    Customer_uuid: { type: String, required: true },
    Priority: { type: String, default: undefined, select: false },
    Remark: { type: String, default: undefined, select: false },
    orderMode: { type: String, enum: ["note", "items"], default: "note", index: true },
    orderNote: { type: String, default: "" },
    vendorAssignments: { type: [vendorAssignmentSchema], default: [] },
    Items: { type: [itemSchema], default: [] },
    workRows: { type: [orderWorkRowSchema], default: [] },
    Status: { type: [statusSchema], default: [] },
    Steps: { type: [stepSchema], default: [] },
    Rate: { type: Number, default: 0 },
    Quantity: { type: Number, default: 0 },
    Amount: { type: Number, default: 0 },
    saleSubtotal: { type: Number, default: 0 },
    stepsCostTotal: { type: Number, default: 0 },
    vendorAssignmentsTotal: { type: Number, default: 0 },
    workRowsEstimatedCost: { type: Number, default: 0 },
    billStatus: { type: String, enum: ["unpaid", "paid"], default: "unpaid", index: true },
    billPaidAt: { type: Date, default: null },
    billPaidBy: { type: String, default: null },
    billPaidNote: { type: String, default: null },
    billPaidTxnUuid: { type: String, default: null },
    billPaidTxnId: { type: Number, default: null },
    stage: {
      type: String,
      enum: ["enquiry", "quoted", "approved", "design", "printing", "finishing", "ready", "delivered", "paid"],
      default: "enquiry",
      index: true,
    },
    stageHistory: {
      type: [new mongoose.Schema({ stage: { type: String, enum: ["enquiry", "quoted", "approved", "design", "printing", "finishing", "ready", "delivered", "paid"], required: true }, timestamp: { type: Date, default: Date.now } }, { _id: false })],
      default: () => [{ stage: "enquiry", timestamp: new Date() }],
    },
    priority: { type: String, enum: ["low", "medium", "high"], default: "medium", index: true },
    dueDate: { type: Date, default: null, index: true },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "Users", default: null, index: true },
    driveFile: {
      status: { type: String, enum: ["pending", "created", "failed", "skipped"], default: "pending" },
      templateFileId: { type: String, default: null },
      fileId: { type: String, default: null },
      folderId: { type: String, default: null },
      name: { type: String, default: null },
      description: { type: String, default: null },
      webViewLink: { type: String, default: null },
      webContentLink: { type: String, default: null },
      error: { type: String, default: null },
      createdAt: { type: Date, default: null },
    },
  },
  { timestamps: true }
);

OrdersSchema.index({ Customer_uuid: 1 });
OrdersSchema.index({ Amount: 1 });
OrdersSchema.index({ "Items.Item": 1 });
OrdersSchema.index({ "workRows.itemName": 1 });
OrdersSchema.index({ "Steps.vendorId": 1 });
OrdersSchema.index({ "Steps.posting.isPosted": 1 });
OrdersSchema.index({ "vendorAssignments.vendorCustomerUuid": 1 });
OrdersSchema.index({ createdAt: -1 });

function recalcTotals(doc) {
  doc.saleSubtotal = (doc.Items || []).reduce((s, it) => s + (+it.Amount || 0), 0);
  doc.stepsCostTotal = (doc.Steps || []).reduce((s, st) => s + (+st.costAmount || 0), 0);
  doc.vendorAssignmentsTotal = (doc.vendorAssignments || []).reduce((s, row) => s + (+row.amount || 0), 0);
  doc.workRowsEstimatedCost = (doc.workRows || []).reduce((s, row) => s + ((+row.estimatedCost || 0) * ((+row.requiredQty || 0) || 1)), 0);
}

OrdersSchema.pre("validate", function (next) {
  if (!this.Order_uuid) this.Order_uuid = uuidv4();
  if (!this.stage) this.stage = "enquiry";
  if (!this.orderMode) this.orderMode = Array.isArray(this.Items) && this.Items.length ? "items" : "note";
  if (!Array.isArray(this.stageHistory)) this.stageHistory = [];
  if (this.stageHistory.length === 0) {
    this.stageHistory.push({ stage: this.stage || "enquiry", timestamp: new Date() });
  }
  next();
});

OrdersSchema.pre("save", function (next) {
  recalcTotals(this);
  next();
});

OrdersSchema.post("findOneAndUpdate", async function (doc) {
  if (!doc) return;
  recalcTotals(doc);
  await doc.updateOne({
    $set: {
      saleSubtotal: doc.saleSubtotal,
      stepsCostTotal: doc.stepsCostTotal,
      vendorAssignmentsTotal: doc.vendorAssignmentsTotal,
      workRowsEstimatedCost: doc.workRowsEstimatedCost,
    },
  });
});

module.exports = mongoose.model("Orders", OrdersSchema);
