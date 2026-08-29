const express = require('express');
const crypto = require('crypto');
const Device = require('../models/Device');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// Generate a random 6-char pairing token
const genPairingToken = () => crypto.randomBytes(3).toString('hex').toUpperCase();

// ─── TRACK INSTALL (called by Electron on first run) ────────────────────────
router.post('/track-install', async (req, res) => {
  try {
    const { deviceId, hostname, username, version } = req.body;
    if (!deviceId) return res.status(400).json({ error: 'deviceId required' });

    let device = await Device.findOne({ deviceId });

    if (!device) {
      // New device — create it
      device = new Device({
        deviceId,
        pairingToken: genPairingToken(),
        hostname: hostname || 'Unknown PC',
        username: username || 'Unknown',
        version: version || '1.0.0'
      });
      await device.save();
      console.log(`[Device] New install: ${deviceId} (${hostname})`);
    } else {
      // Existing device — update it
      device.hostname = hostname || device.hostname;
      device.username = username || device.username;
      device.version = version || device.version;
      device.installCount += 1;
      await device.save();
    }

    res.json({ success: true, pairingToken: device.pairingToken });
  } catch (err) {
    console.error('[Device] track-install error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── GET DEVICE BY PAIRING TOKEN ─────────────────────────────────────────────
router.get('/by-token/:token', async (req, res) => {
  try {
    const device = await Device.findOne({
      pairingToken: req.params.token.toUpperCase()
    }).select('-__v');

    if (!device) return res.status(404).json({ error: 'Device not found' });

    res.json({ success: true, device });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── LIST MY DEVICES (protected) ─────────────────────────────────────────────
router.get('/mine', authMiddleware, async (req, res) => {
  try {
    const devices = await Device.find({ userId: req.user._id }).select('-__v');
    res.json({ success: true, devices });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── LINK DEVICE TO ACCOUNT (protected) ──────────────────────────────────────
router.post('/link', authMiddleware, async (req, res) => {
  try {
    const { pairingToken } = req.body;
    const device = await Device.findOne({ pairingToken: pairingToken.toUpperCase() });

    if (!device) return res.status(404).json({ error: 'Device not found' });

    device.userId = req.user._id;
    await device.save();

    res.json({ success: true, message: 'Device linked to your account' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
