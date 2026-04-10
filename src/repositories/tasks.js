const mongoose = require('mongoose');

const TasksSchema=new mongoose.Schema({
    Task_uuid: { type: String },
    Task_name: { type: String, required: true },
    Task_group: { type: String, required: true },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Orders", default: null, index: true },
    deadline: { type: Date, default: null },
    status: { type: String, enum: ["pending", "in_progress", "done"], default: "pending", index: true },
 })

// Indexes for task lookup
TasksSchema.index({ Task_name: 1 });
TasksSchema.index({ Task_group: 1 });
TasksSchema.index({ Task_uuid: 1 });

 const Tasks = mongoose.model("Tasks", TasksSchema);

module.exports = Tasks;
