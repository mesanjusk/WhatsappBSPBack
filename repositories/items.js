const mongoose = require("mongoose");

const bomComponentSchema = new mongoose.Schema(
  {
    componentItemUuid: { type: String, default: "" },
    componentItemName: { type: String, required: true, trim: true },
    componentType: {
      type: String,
      enum: ["raw_material", "service", "finished_item", "consumable"],
      default: "raw_material",
    },
    itemGroup: { type: String, default: "" },
    qty: { type: Number, default: 1, min: 0 },
    unit: { type: String, default: "Nos" },
    wastePercent: { type: Number, default: 0, min: 0 },
    executionMode: {
      type: String,
      enum: ["stock", "purchase", "in_house", "vendor", "hybrid"],
      default: "stock",
    },
    preferredVendorUuids: { type: [String], default: [] },
    preferredUserGroups: { type: [String], default: [] },
    preferredUserNames: { type: [String], default: [] },
    defaultCost: { type: Number, default: 0, min: 0 },
    note: { type: String, default: "" },
  },
  { _id: true }
);

const ItemsSchema = new mongoose.Schema(
  {
    Item_uuid: { type: String },
    Item_name: { type: String, required: true, trim: true },
    Item_group: { type: String, required: true, trim: true },
    itemType: {
      type: String,
      enum: ["finished_item", "raw_material", "service", "consumable"],
      default: "finished_item",
      index: true,
    },
    unit: { type: String, default: "Nos" },
    stockTracked: { type: Boolean, default: false },
    openingStock: { type: Number, default: 0 },
    reorderLevel: { type: Number, default: 0 },
    defaultPurchaseRate: { type: Number, default: 0 },
    defaultSaleRate: { type: Number, default: 0 },
    executionMode: {
      type: String,
      enum: ["stock", "purchase", "in_house", "vendor", "hybrid"],
      default: "stock",
    },
    preferredVendorUuids: { type: [String], default: [] },
    preferredUserGroups: { type: [String], default: [] },
    preferredUserNames: { type: [String], default: [] },
    description: { type: String, default: "" },
    bom: { type: [bomComponentSchema], default: [] },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

ItemsSchema.index({ Item_name: 1 });
ItemsSchema.index({ Item_group: 1 });
ItemsSchema.index({ Item_uuid: 1 });
ItemsSchema.index({ itemType: 1 });
ItemsSchema.index({ isActive: 1 });

module.exports = mongoose.model("Items", ItemsSchema);
