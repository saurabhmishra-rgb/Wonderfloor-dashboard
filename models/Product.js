const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  sku: { type: String, required: true, unique: true },
  size: { type: String, required: true },
  navCategory: { type: String, required: true },
  widthMM: {type: Number},
  heightMM: {type: Number},
  accordionCategory: { type: String, required: true },
  colour: { type: String, required: true },
  shade: { type: String, required: true },
  description: { type: String },
  userIndustry: [{ type: String }],
  applicationArea: [{ type: String }],
  // Searchable Tags Array
  tags: [{ type: String }],

  // ── NEW FIELDS ──────────────────────────────
  thickness: { type: String },           
  style: { type: String },              
  productLink: { type: String },         
  pattern: { type: String },            
  // ───────────────────────────────────────────

  img: { type: String, required: true },

  // ── VISIBILITY FLAG ──
  isVisible: { type: Boolean, default: true },
  //  ADD THIS FIELD FOR DRAG AND DROP SORTING 
order: { type: Number, default: 0 },
  collectionTierOrder: { type: Number, default: 0 },

}, { timestamps: true });


module.exports = mongoose.model('Product', productSchema);
