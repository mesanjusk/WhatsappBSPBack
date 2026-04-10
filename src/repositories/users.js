const mongoose = require('mongoose');

const usersSchema = new mongoose.Schema(
  {
    User_name: { type: String, required: true, trim: true, index: true },
    Password: { type: String, required: true },
    Mobile_number: { type: String, default: '', trim: true },
    User_group: { type: String, default: 'user', trim: true, index: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Users', usersSchema);
