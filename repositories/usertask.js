const mongoose = require('mongoose');

const UsertasksSchema=new mongoose.Schema({
    Usertask_uuid: { type: String },
    Usertask_Number: { type: Number, required: true, unique: true },
    User: { type: String, required: true},
    Usertask_name: { type: String, required: true },   
    Date: { type: Date, required: true },
    Time: { type: String, required: true },
    Deadline: { type: Date, required: true},
    Remark: { type: String, required: true},
    Status: { type: String, required: true}
 },  { timestamps: true })

// Indexes for common query fields
UsertasksSchema.index({ User: 1 });
UsertasksSchema.index({ Date: 1 });
UsertasksSchema.index({ Deadline: 1 });
UsertasksSchema.index({ Status: 1 });

 const Usertasks = mongoose.model("Usertasks", UsertasksSchema);

module.exports = Usertasks;
