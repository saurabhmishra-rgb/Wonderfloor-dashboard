const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');

// Optional: Define a secret key in your .env file, or fall back to a default
const JWT_SECRET = process.env.JWT_SECRET || 'wonderfloor_super_secret_key_2026';

// ─── POST /auth/signup (Create Account) ───
router.post('/signup', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    
    if (!name || !email || !password) {
      return res.status(400).json({ success: false, error: 'All fields are required' });
    }

    // 1. Check if an admin with this email already exists
    const existingAdmin = await Admin.findOne({ email });
    if (existingAdmin) {
      return res.status(409).json({ success: false, error: 'An account with this email already exists' });
    }

    // 2. Create and save the new admin
    // Note: The password will be automatically hashed by our pre-save hook in Admin.js
    const newAdmin = new Admin({ name, email, password });
    await newAdmin.save();

    return res.status(201).json({ 
      success: true, 
      message: 'Account created successfully. You can now log in.' 
    });

  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ success: false, error: 'Server error during registration' });
  }
});

// ─── POST /auth/login (Sign In) ───
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required' });
    }

    // 1. Find the admin by email
    const admin = await Admin.findOne({ email });
    if (!admin) {
      return res.status(401).json({ success: false, error: 'Invalid email or password' });
    }

    // 2. Compare the provided password with the hashed password in the database
    const isMatch = await admin.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ success: false, error: 'Invalid email or password' });
    }

    // 3. Generate a real JWT token
    const token = jwt.sign(
      { adminId: admin._id, email: admin.email },
      JWT_SECRET,
      { expiresIn: '24h' } // Token expires in 24 hours
    );

    return res.status(200).json({ 
      success: true, 
      token: token,
      adminData: { name: admin.name, email: admin.email },
      message: 'Login successful' 
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, error: 'Server error during login' });
  }
});

// ─── POST /auth/forgot-password ───
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ success: false, error: 'Email is required' });
  }

  // To build a real forgot password flow later, you would:
  // 1. Check if email exists in Admin collection
  // 2. Generate a temporary reset token and save it to the DB with an expiration time
  // 3. Send an email to the user with a link containing that token
  // For now, we will just return a success message to complete the UI flow.

  return res.status(200).json({ 
    success: true, 
    message: 'If an account exists, a password reset link has been sent.' 
  });
});

module.exports = router;