const mongoose = require("mongoose");

const GoogleDriveTokenSchema = new mongoose.Schema(
  {
    provider: {
      type: String,
      default: "google_drive",
      unique: true,
    },
    email: {
      type: String,
      default: null,
    },
    refreshToken: {
      type: String,
      required: true,
    },
    accessToken: {
      type: String,
      default: null,
    },
    expiryDate: {
      type: Number,
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("GoogleDriveToken", GoogleDriveTokenSchema);