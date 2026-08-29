const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const router = express.Router();

// ─── REGISTER ────────────────────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Check if user exists
    const existing = await User.findOne({ email: email.toLowerCase().trim() });
    if (existing) {
      return res.status(409).json({ error: 'Account with this email already exists' });
    }

    const user = new User({
      email: email.toLowerCase().trim(),
      password,
      name: name || ''
    });
    await user.save();

    res.status(201).json({
      success: true,
      message: 'Account created successfully! Redirecting to login page...'
    });
  } catch (err) {
    console.error('[Auth] Register error:', err);
    res.status(500).json({ error: 'Server error during registration' });
  }
});

// ─── LOGIN ───────────────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password, passkey, planSelection } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const isValid = await user.comparePassword(password);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Conditional Passkey Enforcement
    if (planSelection === 'premium') {
      if (!passkey || !user.passkey || user.passkey !== passkey.trim()) {
        return res.status(401).json({ error: 'Invalid or missing passkey for Premium account' });
      }
    }

    const token = jwt.sign(
      { userId: user._id, email: user.email, sessionPlan: planSelection || 'free' },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        plan: user.plan
      }
    });
  } catch (err) {
    console.error('[Auth] Login error:', err);
    res.status(500).json({ error: 'Server error during login' });
  }
});

// ─── GET CURRENT USER (protected) ────────────────────────────────────────────
const authMiddleware = require('../middleware/auth');

router.get('/me', authMiddleware, async (req, res) => {
  res.json({
    success: true,
    user: {
      id: req.user._id,
      email: req.user.email,
      name: req.user.name,
      plan: req.user.plan,
      devices: req.user.devices
    }
  });
});

// ─── CHANGE PASSWORD (protected) ─────────────────────────────────────────────
router.post('/change-password', authMiddleware, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user._id);

    const isValid = await user.comparePassword(currentPassword);
    if (!isValid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    user.password = newPassword;
    await user.save();

    res.json({ success: true, message: 'Password changed successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── USER STATUS (check if email exists / get plan) ─────────────────────────
router.get('/status', async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: 'Email required' });
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({
      success: true,
      plan: user.plan || 'free',
      status: 'active',
      email: user.email,
      name: user.name
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── VERIFY CODE (email verification - auto approve) ─────────────────────────
router.post('/verify-code', async (req, res) => {
  res.json({ success: true, message: 'Code verified' });
});

// ─── CONFIRM PAYMENT (upgrade user to pro and send SMTP email confirmation) ─
router.post('/confirm-payment', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Upgrade plan to pro (Premium)
    user.plan = 'pro';
    await user.save();

    // Send payment confirmation email via Nodemailer
    const nodemailer = require('nodemailer');

    // Create SMTP transporter using user's Gmail credentials
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: 'rcsupportofficial@gmail.com',
        pass: 'xazh abhz uzmr vzly'
      }
    });

    const mailOptions = {
      from: '"RemoteLink Support" <rcsupportofficial@gmail.com>',
      to: user.email,
      subject: 'Payment Confirmation - RemoteLink Premium',
      text: `Hello ${user.name || 'Valued Client'},\n\nWe have successfully received your payment! Your account has been upgraded to Premium.\n\nYou can now log in using the "Premium Account" option to enjoy unlimited remote control sessions.\n\nThank you for choosing RemoteLink!\n\nBest regards,\nRemoteLink Team`,
      html: `<div style="font-family: sans-serif; padding: 20px; color: #333;">
              <h2 style="color: #2563eb;">Payment Received!</h2>
              <p>Hello <strong>${user.name || 'Valued Client'}</strong>,</p>
              <p>We are pleased to confirm that your payment has been processed successfully. Your RemoteLink account has been upgraded to <strong>Premium</strong>.</p>
              <p>You can now log in using the <strong>Premium Account</strong> selection to start unlimited, high-speed remote control sessions.</p>
              <br>
              <p>Thank you for choosing RemoteLink!</p>
              <p>Best regards,<br><strong>RemoteLink Team</strong></p>
             </div>`
    };

    await transporter.sendMail(mailOptions);
    console.log(`[Billing] Payment confirmed and email sent to: ${user.email}`);

    res.json({ success: true, message: 'Payment confirmed and confirmation email sent.' });
  } catch (err) {
    console.error('[Billing] Confirm payment error:', err);
    res.status(500).json({ error: 'Server error during payment confirmation' });
  }
});

// ─── REQUEST UPGRADE (client fills form → admin gets notified via email) ─────
router.post('/request-upgrade', async (req, res) => {
  try {
    const { name, email, phone, plan, message } = req.body;
    if (!name || !email || !phone) {
      return res.status(400).json({ error: 'Name, email and phone are required' });
    }

    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: 'rcsupportofficial@gmail.com',
        pass: 'xazh abhz uzmr vzly'
      }
    });

    // Email to Admin (you)
    await transporter.sendMail({
      from: '"RemoteLink System" <rcsupportofficial@gmail.com>',
      to: 'shivshankaryadhav02@gmail.com',
      subject: `🔔 New Premium Upgrade Request — ${name}`,
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:auto;background:#0f0f0f;color:#fff;padding:32px;border-radius:16px;border:1px solid #1f2937;">
          <h2 style="color:#3b82f6;margin-bottom:4px;">🔔 New Upgrade Request</h2>
          <p style="color:#6b7280;font-size:0.85rem;margin-bottom:24px;">A client has requested Premium access. Review and approve below.</p>
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="padding:10px 0;border-bottom:1px solid #1f2937;color:#9ca3af;font-size:0.8rem;width:40%;">Client Name</td><td style="padding:10px 0;border-bottom:1px solid #1f2937;color:#fff;font-weight:600;">${name}</td></tr>
            <tr><td style="padding:10px 0;border-bottom:1px solid #1f2937;color:#9ca3af;font-size:0.8rem;">Email</td><td style="padding:10px 0;border-bottom:1px solid #1f2937;color:#fff;font-weight:600;">${email}</td></tr>
            <tr><td style="padding:10px 0;border-bottom:1px solid #1f2937;color:#9ca3af;font-size:0.8rem;">Phone</td><td style="padding:10px 0;border-bottom:1px solid #1f2937;color:#fff;font-weight:600;">${phone}</td></tr>
            <tr><td style="padding:10px 0;border-bottom:1px solid #1f2937;color:#9ca3af;font-size:0.8rem;">Requested Plan</td><td style="padding:10px 0;border-bottom:1px solid #1f2937;"><span style="background:#f59e0b22;color:#fbbf24;padding:3px 10px;border-radius:20px;font-size:0.8rem;font-weight:700;">⭐ ${plan || 'Premium'}</span></td></tr>
            ${message ? `<tr><td style="padding:10px 0;color:#9ca3af;font-size:0.8rem;">Message</td><td style="padding:10px 0;color:#d1d5db;">${message}</td></tr>` : ''}
          </table>
          <div style="margin-top:24px;padding:16px;background:#1f2937;border-radius:10px;font-size:0.8rem;color:#9ca3af;">
            <strong style="color:#fff;">To approve:</strong> Log in to MongoDB Atlas, find user <code style="color:#60a5fa;">${email}</code>, set <code style="color:#4ade80;">plan → "pro"</code> and add their <code style="color:#fbbf24;">passkey</code>, then reply to the client.
          </div>
        </div>
      `
    });

    // Confirmation email to client
    await transporter.sendMail({
      from: '"RemoteLink Support" <rcsupportofficial@gmail.com>',
      to: email,
      subject: 'RemoteLink — Upgrade Request Received ✅',
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:auto;background:#0f0f0f;color:#fff;padding:32px;border-radius:16px;border:1px solid #1f2937;">
          <h2 style="color:#3b82f6;">Hi ${name}! 👋</h2>
          <p style="color:#d1d5db;line-height:1.7;">Thank you for your interest in <strong>RemoteLink Premium</strong>. We have received your upgrade request.</p>
          <div style="background:#1f2937;border-radius:12px;padding:16px;margin:20px 0;">
            <p style="color:#9ca3af;font-size:0.85rem;margin:0;">Our admin will review your request and contact you at <strong style="color:#60a5fa;">${email}</strong> or <strong style="color:#60a5fa;">${phone}</strong> within <strong style="color:#fff;">24 hours</strong> with your passkey and payment confirmation.</p>
          </div>
          <p style="color:#6b7280;font-size:0.8rem;">If you have any questions, you can contact us directly.</p>
          <p style="color:#6b7280;font-size:0.75rem;margin-top:24px;border-top:1px solid #1f2937;padding-top:16px;">— RemoteLink Team · Developed by Shiv Shankar</p>
        </div>
      `
    });

    res.json({ success: true, message: 'Upgrade request sent! Please wait for admin response within 24 hours.' });
  } catch (err) {
    console.error('[Upgrade] Request error:', err);
    res.status(500).json({ error: 'Failed to send upgrade request. Please try again.' });
  }
});

module.exports = router;
