const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema({
  name: { type: String, required: true },
  category: { type: String, required: true },
  supportedCollections: [{ type: String }], // Which tiles can be placed here
  previewUrl: { type: String, required: true }, // Cloudinary Base Image URL
  maskUrl: { type: String }, // Cloudinary Mask Image URL (Optional)
}, { timestamps: true });

module.exports = mongoose.model('Room', roomSchema);