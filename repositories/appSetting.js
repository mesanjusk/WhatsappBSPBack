const mongoose = require('mongoose');

const attendanceCommandSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    aliases: { type: [String], default: [] },
    attendanceType: { type: String, required: true, trim: true },
    nextAllowed: { type: [String], default: [] },
    successMessage: { type: String, default: '' },
    duplicateMessage: { type: String, default: '' },
    invalidMessage: { type: String, default: '' },
    enabled: { type: Boolean, default: true },
  },
  { _id: false }
);

const whatsappAttendanceConfigSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: true },
    markUnknownNumbers: { type: Boolean, default: false },
    unknownNumberReply: {
      type: String,
      default: 'Your number is not registered. Contact admin.',
    },
    duplicateReply: {
      type: String,
      default: 'Attendance for this action is already marked today.',
    },
    invalidTransitionReply: {
      type: String,
      default: 'This command is not allowed right now.',
    },
    commands: { type: [attendanceCommandSchema], default: [] },
  },
  { _id: false }
);

const appSettingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, trim: true },
    value: { type: mongoose.Schema.Types.Mixed, default: {} },
    description: { type: String, default: '' },
  },
  { timestamps: true, collection: 'app_settings' }
);

appSettingSchema.statics.getSetting = async function (key, fallback = null) {
  const existing = await this.findOne({ key }).lean();
  return existing ? existing.value : fallback;
};

appSettingSchema.statics.upsertSetting = async function ({ key, value, description = '' }) {
  const updated = await this.findOneAndUpdate(
    { key },
    { $set: { value, description } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  return updated;
};

const AppSetting = mongoose.model('AppSetting', appSettingSchema);
module.exports = { AppSetting, whatsappAttendanceConfigSchema };
