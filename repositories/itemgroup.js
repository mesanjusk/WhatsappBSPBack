const mongoose = require("mongoose");

const ItemgroupSchema = new mongoose.Schema(
  {
    Item_group_uuid: { type: String },
    Item_group: { type: String, required: true, trim: true },
    groupType: {
      type: String,
      enum: ["finished_goods", "raw_materials", "services", "consumables", "outsourced_work", "general"],
      default: "general",
    },
    description: { type: String, default: "" },
    defaultItemType: {
      type: String,
      enum: ["finished_item", "raw_material", "service", "consumable"],
      default: "finished_item",
    },
    stockTrackedDefault: { type: Boolean, default: false },
  },
  { timestamps: true }
);

ItemgroupSchema.index({ Item_group: 1 });
ItemgroupSchema.index({ Item_group_uuid: 1 });
ItemgroupSchema.index({ groupType: 1 });

module.exports = mongoose.model("Itemgroup", ItemgroupSchema);
