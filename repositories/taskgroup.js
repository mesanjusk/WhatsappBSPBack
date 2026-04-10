const mongoose = require('mongoose');

const TaskgroupSchema=new mongoose.Schema({
    Task_group_uuid: { type: String },
    Task_group: { type: String, required: true },
    Id: { type: Number, required: true }
 })

// Indexes for task group usage
TaskgroupSchema.index({ Task_group: 1 });
TaskgroupSchema.index({ Task_group_uuid: 1 });
TaskgroupSchema.index({ Id: 1 });

 const  Taskgroup = mongoose.model(" Taskgroup",  TaskgroupSchema);

module.exports =  Taskgroup;
