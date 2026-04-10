const mongoose = require('mongoose');

const UsergroupSchema=new mongoose.Schema({
    User_group_uuid: { type: String },
    User_group: { type: String, required: true },
 })

// Index for faster retrieval
UsergroupSchema.index({ User_group: 1 });
UsergroupSchema.index({ User_group_uuid: 1 });

 const Usergroup = mongoose.model("Usergroup", UsergroupSchema);

module.exports = Usergroup;
