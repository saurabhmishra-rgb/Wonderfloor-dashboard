// routes/leads.js
const express = require('express');
const router = express.Router();
const Lead = require('../models/Lead');
const Download = require('../models/Download'); 
// ── CREATE / UPDATE ──
// Agar phone number pehle se exist karta hai to duplicate row nahi banegi,
// existing lead hi update ho jayegi (naya product + downloadCount++)
router.post('/', async (req, res) => {
  try {
    const { phone, name, email, message, productName, productSku, roomId } = req.body;

    if (!phone || !name || !email) {
      return res.status(400).json({ success: false, error: 'Name and phone are required.' });
    }

    let lead = await Lead.findOne({ phone });

    if (lead) {
      lead.email = email || lead.email;
      lead.message = message || lead.message;
      lead.productName = productName || lead.productName;
      lead.productSku = productSku || lead.productSku;
      lead.roomId = roomId || lead.roomId;
      lead.lastSeenAt = new Date();
      lead.downloadCount += 1;
      await lead.save();

      // product-wise tracking ke liye
      await Download.create({ name, phone, productName, productSku, roomId });

      return res.json({ success: true, lead, isNew: false });
    }

    lead = await Lead.create({ name, phone, email, message, productName, productSku, roomId });
    console.log(` New lead captured: ${lead.name} (${lead.phone})`);

    // pehli download bhi log karo
    await Download.create({ name, phone, productName, productSku, roomId });

    res.status(201).json({ success: true, lead, isNew: true });

  } catch (error) {
    console.error('Lead creation failed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});
// ── READ ALL (Settings.jsx / dashboard ke liye) ──
router.get('/', async (req, res) => {
  try {
    const leads = await Lead.find().sort({ lastSeenAt: -1 }); 
    res.json({ success: true, leads });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── UPDATE STATUS (contacted/converted/closed mark karne ke liye) ──
router.patch('/:id', async (req, res) => {
  try {
    const lead = await Lead.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ success: true, lead });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── DELETE single lead ──
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await Lead.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Lead not found.' });
    }
    res.json({ success: true, deletedId: req.params.id });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── DELETE all leads ──
router.delete('/', async (req, res) => {
  try {
    const result = await Lead.deleteMany({});
    res.json({ success: true, deletedCount: result.deletedCount });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// product-wise accurate count
router.get('/downloads/top', async (req, res) => {
  try {
    const results = await Download.aggregate([
      { $group: { _id: '$productName', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      // { $limit: 5 },
    ]);
    const formatted = results.map(r => ({ name: r._id || 'Unknown product', count: r.count }));
    res.json({ success: true, topDownloads: formatted });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
module.exports = router;
