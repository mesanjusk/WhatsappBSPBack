const mongoose = require("mongoose");

const normalizePartyRoles = (roles = []) => {
  const allowed = new Set(["customer", "vendor"]);
  const normalized = Array.isArray(roles)
    ? roles
        .map((role) => String(role || "").trim().toLowerCase())
        .filter((role) => allowed.has(role))
    : [];

  return normalized.length ? [...new Set(normalized)] : ["customer"];
};

const CustomersSchema = new mongoose.Schema({
  Customer_uuid: { type: String },
  Customer_name: { type: String, required: true },
  Mobile_number: { type: String },
  Customer_group: { type: String, required: true },
  Status: { type: String, default: "active" },
  Tags: { type: [String], default: [] },
  PartyRoles: {
    type: [String],
    enum: ["customer", "vendor"],
    default: ["customer"],
    set: normalizePartyRoles,
  },
  LastInteraction: { type: Date, default: Date.now },
});

CustomersSchema.pre("validate", function (next) {
  if (!Array.isArray(this.PartyRoles) || this.PartyRoles.length === 0) {
    this.PartyRoles = ["customer"];
  }

  if (!Array.isArray(this.Tags)) {
    this.Tags = [];
  }

  const lowerTags = new Set(this.Tags.map((tag) => String(tag || "").trim().toLowerCase()));
  if (this.PartyRoles.includes("vendor")) lowerTags.add("vendor");
  if (this.PartyRoles.includes("customer")) lowerTags.add("customer");
  this.Tags = [...lowerTags].filter(Boolean);

  next();
});

CustomersSchema.index({ Customer_name: 1 });
CustomersSchema.index({ Mobile_number: 1 });
CustomersSchema.index({ Customer_group: 1 });
CustomersSchema.index({ Status: 1 });
CustomersSchema.index({ Customer_uuid: 1 });
CustomersSchema.index({ LastInteraction: -1 });
CustomersSchema.index({ PartyRoles: 1 });

module.exports = mongoose.model("Customers", CustomersSchema);
