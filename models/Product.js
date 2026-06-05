const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  sku: { type: String, required: true, unique: true },
  size: { type: String, required: true },
  navCategory: { type: String, required: true },
  accordionCategory: { type: String, required: true },
  colour: { type: String, required: true },
  shade: { type: String, required: true },
  description: { type: String },
  userIndustry: [{ type: String }], // Array for filtering in sidebar
  img: { type: String, required: true }, // Cloudinary Image URL
}, { timestamps: true });

module.exports = mongoose.model('Product', productSchema);



