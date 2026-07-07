const mongoose = require('mongoose');
const roomSchema = new mongoose.Schema({
  name: { type: String, required: true },
  category: { type: String, required: true },
  supportedCollections: [{ type: String }],
  previewUrl: { type: String, required: true },
  maskUrl: { type: String },
  isLive: { type: Boolean, default: false }, // ← ADD THIS
  position: { type: Number, default: 0 },
  categoryOrder: { type: Number, default: 0 }
}, { timestamps: true });

module.exports = mongoose.model('Room', roomSchema);
