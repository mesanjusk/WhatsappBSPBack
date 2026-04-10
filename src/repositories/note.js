const mongoose = require('mongoose');

const NotesSchema=new mongoose.Schema({
    Note_uuid: { type: String },
    Order_uuid: { type: String, required: true },
    Customer_uuid: { type: String, required: true },
    Note_name: { type: String, required: true }
 })

// Index notes by related entities
NotesSchema.index({ Order_uuid: 1 });
NotesSchema.index({ Customer_uuid: 1 });
NotesSchema.index({ Note_name: 1 });
NotesSchema.index({ Note_uuid: 1 });

 const Notes = mongoose.model("Notes", NotesSchema);

module.exports = Notes;
