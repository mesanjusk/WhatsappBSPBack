const mongoose = require('mongoose');

const CallLogsSchema=new mongoose.Schema({
    CallLog_uuid: { type: String },
    Name: { type: String, required: true },
    Mobile_number: { type:Number, required: true, unique: true},
    Type: { type: String, required: true },
    Duration: { type: Number, required: true },
    Status: { type: String, required: true}
 })

// Indexes to optimise frequent call log operations
CallLogsSchema.index({ Name: 1 });
CallLogsSchema.index({ Type: 1 });
CallLogsSchema.index({ Status: 1 });
CallLogsSchema.index({ CallLog_uuid: 1 });

 const CallLogs = mongoose.model("CallLogs", CallLogsSchema);

module.exports = CallLogs;
