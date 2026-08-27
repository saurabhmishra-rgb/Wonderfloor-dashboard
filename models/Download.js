// models/Download.js
const mongoose = require('mongoose');

const downloadSchema = new mongoose.Schema({
  name: String,
  phone: String,
  productName: String,
  productSku: String,
  roomId: String,
}, { timestamps: true }); // createdAt/updatedAt automatically add ho jayenge

module.exports = mongoose.model('Download', downloadSchema);
