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
  userIndustry: [{ type: String }],

  // Searchable Tags Array
  tags: [{ type: String }],

  // ── NEW FIELDS ──────────────────────────────
  thickness: { type: String },           // e.g. "2.0mm" or "1.0mm, 2.0mm"
  style: { type: String },               // e.g. "Homogeneous Flooring", "Cushion Vinyl"
  productLink: { type: String },         // External URL to product page / datasheet
  pattern: { type: String },            // e.g. "Non-Directional", "Directional"
  // ───────────────────────────────────────────

  img: { type: String, required: true },

  // ── VISIBILITY FLAG ──
  isVisible: { type: Boolean, default: true },

}, { timestamps: true });

module.exports = mongoose.model('Product', productSchema);