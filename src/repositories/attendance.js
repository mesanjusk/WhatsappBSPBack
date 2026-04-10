const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    Time: { type: String, required: true },
    Type: { type: String, required: true },
    SourceCommand: { type: String, default: '' },
    CreatedAt: { type: Date, required: true} 
});

const AttendanceSchema = new mongoose.Schema({
    Attendance_uuid: { type: String },
    Attendance_Record_ID: { type: Number, required: true, unique: true },
    Employee_uuid: { type: String, required: true },
    Date: { type: Date, required: true },
    Status: { type: String, required: true },
    source: { type: String, enum: ['dashboard', 'whatsapp'], default: 'dashboard' },
    User: [userSchema]
});

// Indexes to speed up lookups and sorting
AttendanceSchema.index({ Employee_uuid: 1 });
AttendanceSchema.index({ Date: 1 });
AttendanceSchema.index({ Status: 1 });

const Attendance = mongoose.model("Attendance", AttendanceSchema);
module.exports = Attendance;
