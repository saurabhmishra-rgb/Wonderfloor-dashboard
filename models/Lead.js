const mongoose = require('mongoose');

const leadSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true, unique: true },
     email: { 
      type: String,
      required: true,
      trim: true, 
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email address'],
    },
    message: { type: String, trim: true }, 

    productName: { type: String, trim: true },
    productSku: { type: String, trim: true },
    roomId: { type: String, trim: true },
    source: { type: String, default: 'AR Visualizer' },

    status: { type: String, enum: ['new', 'contacted', 'converted', 'closed'], default: 'new' },

    downloadCount: { type: Number, default: 1 },
    lastSeenAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);
module.exports = mongoose.model('Lead', leadSchema);
