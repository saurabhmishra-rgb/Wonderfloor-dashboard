// routes/leads.js
const express = require('express');
const router = express.Router();
const Lead = require('../models/Lead');

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
      return res.json({ success: true, lead, isNew: false });
    }

    lead = await Lead.create({ name, phone, email, message, productName, productSku, roomId });
    console.log(` New lead captured: ${lead.name} (${lead.phone})`);
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

module.exports = router;
