require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const fs = require('fs');

// ─── APP CONFIG ───────────────────────────────────────────────────────────────
const APP_NAME = process.env.APP_NAME || 'RemoteLink';
const PORT = process.env.PORT || 3001;
const MONGODB_URI = process.env.MONGODB_URI;
const JWT_SECRET = process.env.JWT_SECRET;

if (!MONGODB_URI) console.warn('⚠️  MONGODB_URI is not set — DB features will not work');
if (!JWT_SECRET) console.warn('⚠️  JWT_SECRET is not set — Auth will not work');

// ─── EXPRESS SETUP ────────────────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ─── SOCKET.IO (Relay Hub) ────────────────────────────────────────────────────
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  maxHttpBufferSize: 20 * 1024 * 1024 // 20MB for screen frames
});

// In-memory store: pairingToken → { desktopSocket, mobileSocket }
const sessions = new Map();

io.on('connection', (socket) => {
  console.log(`[Relay] Socket connected: ${socket.id}`);

  // ── Desktop or Mobile identifies itself ──────────────────────────────────
  socket.on('identify', (data) => {
    const { type, deviceId, pairingToken, hostname, username, version } = data;
    const token = (pairingToken || '').toUpperCase();

    console.log(`[Relay] ${type} identified | token=${token} | device=${deviceId}`);

    socket.pairingToken = token;
    socket.clientType = type;
    socket.deviceId = deviceId;

    if (!sessions.has(token)) {
      sessions.set(token, { desktop: null, mobile: null });
    }
    const session = sessions.get(token);

    if (type === 'desktop') {
      // Prevent multiple desktops/PCs from using the same login account simultaneously
      if (session.desktop && session.desktop.id !== socket.id) {
        console.log(`[Relay] Conflict detected for token ${token}. Disconnecting previous desktop socket ${session.desktop.id}`);
        session.desktop.emit('relay:conflict', { message: 'This account has been logged in on another device.' });
        session.desktop.disconnect(true);
      }
      session.desktop = socket;
      session.plan = getSessionPlanFromSocket(socket); // Determine plan: 'free' or 'premium'
      socket.emit('identified', { status: 'connected', token });
      socket.emit('relay:ready', { status: 'connected', token }); // Desktop compatibility

      // Notify mobile if already waiting
      if (session.mobile) {
        session.mobile.emit('desktop-connected', {
          hostname: hostname || 'PC',
          username: username || 'User'
        });
        session.mobile.emit('session-plan', { plan: session.plan || 'free' });
        // Also notify this newly connected desktop that mobile is waiting so it starts streaming!
        socket.emit('mobile-connected', { deviceId: session.mobile.deviceId });
        socket.emit('relay:mobile-connected', { deviceId: session.mobile.deviceId }); // Desktop compatibility

        // Start session timer for free connections
        if (session.plan !== 'premium') {
          console.log(`[Timer] Starting 5-minute timer for session token: ${token} (Desktop linked second)`);
          if (session.timer) clearTimeout(session.timer);
          session.timer = setTimeout(() => {
            console.log(`[Timer] Free trial expired! Forcefully closing session token: ${token}`);
            if (session.mobile?.connected) {
              session.mobile.emit('session-expired');
              session.mobile.disconnect(true);
            }
            if (session.desktop?.connected) {
              session.desktop.emit('session-expired');
              session.desktop.disconnect(true);
            }
            session.mobile = null;
            session.desktop = null;
            session.timer = null;
          }, 5 * 60 * 1000);
        }
      }
    } else if (type === 'mobile') {
      session.mobile = socket;
      socket.emit('identified', { status: 'connected', token });
      
      // 🚀 AUTO-APPROVE: Immediately approve connection so phone bypasses the security wall
      socket.emit('connection:approved');
      
      // Notify mobile of the session plan
      socket.emit('session-plan', { plan: session.plan || 'free' });

      // Notify desktop if already connected
      if (session.desktop) {
        session.desktop.emit('mobile-connected', { deviceId });
        session.desktop.emit('relay:mobile-connected', { deviceId }); // Desktop compatibility
        session.desktop.emit('approve-device', { deviceId });

        // Start session timer for free connections
        if (session.plan !== 'premium') {
          console.log(`[Timer] Starting 5-minute timer for session token: ${token} (Mobile linked second)`);
          if (session.timer) clearTimeout(session.timer);
          session.timer = setTimeout(() => {
            console.log(`[Timer] Free trial expired! Forcefully closing session token: ${token}`);
            if (session.mobile?.connected) {
              session.mobile.emit('session-expired');
              session.mobile.disconnect(true);
            }
            if (session.desktop?.connected) {
              session.desktop.emit('session-expired');
              session.desktop.disconnect(true);
            }
            session.mobile = null;
            session.desktop = null;
            session.timer = null;
          }, 5 * 60 * 1000);
        }
      }
    }
  });

  // Forward manual approve-device events from PC to phone
  socket.on('approve-device', (data) => {
    const token = socket.pairingToken;
    if (!token) return;
    const session = sessions.get(token);
    if (session?.mobile?.connected) {
      session.mobile.emit('connection:approved', data);
    }
  });

  // ── Desktop → Mobile relay ─────────────────────────────────────────────
  socket.on('to-mobile', (data) => {
    const { deviceId, event, payload } = data;
    const token = socket.pairingToken;
    if (!token) return;

    const session = sessions.get(token);
    if (session?.mobile?.connected) {
      session.mobile.emit(event, payload);
    }
  });

  // ── Mobile → Desktop commands ──────────────────────────────────────────
  socket.on('command:move-mouse', (data) => relayToDesktop(socket, 'command:move-mouse', data));
  socket.on('command:click',      (data) => relayToDesktop(socket, 'command:click', data));
  socket.on('command:type',       (data) => relayToDesktop(socket, 'command:type', data));
  socket.on('command:key',        (data) => relayToDesktop(socket, 'command:key', data));
  socket.on('command:scroll',     (data) => relayToDesktop(socket, 'command:scroll', data));
  socket.on('command:peek',       (data) => relayToDesktop(socket, 'command:peek', data));
  socket.on('command:lock',       (data) => relayToDesktop(socket, 'command:lock', data));
  socket.on('command:camera',     (data) => relayToDesktop(socket, 'command:camera', data));
  socket.on('command:camera-stop',(data) => relayToDesktop(socket, 'command:camera-stop', data));
  socket.on('command:audio-start',(data) => relayToDesktop(socket, 'command:audio-start', data));
  socket.on('command:audio-stop', (data) => relayToDesktop(socket, 'command:audio-stop', data));
  socket.on('command:stealth-stream-start', (data) => relayToDesktop(socket, 'command:stealth-stream-start', data));
  socket.on('command:stealth-stream-stop',  (data) => relayToDesktop(socket, 'command:stealth-stream-stop', data));

  // ── WebRTC Signaling ────────────────────────────────────────────────────
  socket.on('webrtc:offer',     (data) => relayToDesktop(socket, 'webrtc:offer', data));
  socket.on('webrtc:answer',    (data) => relayToMobile(socket, 'webrtc:answer', data));
  socket.on('webrtc:candidate', (data) => {
    const token = socket.pairingToken;
    if (!token) return;
    const session = sessions.get(token);
    if (socket.clientType === 'mobile' && session?.desktop?.connected) {
      session.desktop.emit('webrtc:candidate', data);
    } else if (socket.clientType === 'desktop' && session?.mobile?.connected) {
      session.mobile.emit('webrtc:candidate', data);
    }
  });

  // ── Disconnect ─────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    const token = socket.pairingToken;
    console.log(`[Relay] Socket disconnected: ${socket.id} (token=${token})`);

    if (!token) return;
    const session = sessions.get(token);
    if (!session) return;

    if (socket.clientType === 'desktop') {
      if (session.desktop === socket) {
        session.desktop = null;
        if (session.timer) {
          clearTimeout(session.timer);
          session.timer = null;
        }
        if (session.mobile?.connected) {
          session.mobile.emit('desktop-disconnected');
          session.mobile.disconnect(true);
        }
      }
    } else if (socket.clientType === 'mobile') {
      if (session.mobile === socket) {
        session.mobile = null;
        if (session.timer) {
          clearTimeout(session.timer);
          session.timer = null;
        }
        if (session.desktop?.connected) {
          session.desktop.emit('mobile-disconnected');
          session.desktop.emit('relay:mobile-disconnected'); // Desktop compatibility
        }
      }
    }

    // Clean up empty sessions
    if (!session.desktop && !session.mobile) {
      sessions.delete(token);
    }
  });
});

function relayToDesktop(fromSocket, event, data) {
  const token = fromSocket.pairingToken;
  if (!token) return;
  const session = sessions.get(token);
  if (session?.desktop?.connected) {
    session.desktop.emit(event, data);
  }
}

function relayToMobile(fromSocket, event, data) {
  const token = fromSocket.pairingToken;
  if (!token) return;
  const session = sessions.get(token);
  if (session?.mobile?.connected) {
    session.mobile.emit(event, data);
  }
}

// ─── REST API ROUTES ─────────────────────────────────────────────────────────
app.use('/api/auth', require('./routes/auth'));
app.use('/api/devices', require('./routes/devices'));

// /api/user/status — alias to /api/auth/status
app.get('/api/user/status', async (req, res) => {
  try {
    const mongoose = require('mongoose');
    const User = require('./models/User');
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: 'Email required' });
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({
      success: true,
      plan: user.plan || 'free',
      status: 'active',
      email: user.email,
      name: user.name,
      geminiKey: user.geminiKey || null,
      chatgptKey: user.chatgptKey || null,
      grokKey: user.grokKey || null
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// /api/user/update-api-keys — update API keys in database
app.post('/api/user/update-api-keys', async (req, res) => {
  try {
    const mongoose = require('mongoose');
    const User = require('./models/User');
    const { email, gemini, chatgpt, grok } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) return res.status(404).json({ error: 'User not found' });
    user.geminiKey = gemini;
    user.chatgptKey = chatgpt;
    user.grokKey = grok;
    await user.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// /api/device/link — device registration
app.post('/api/device/link', async (req, res) => {
  res.json({ success: true, message: 'Device linked' });
});

// ─── SEND PAIRING LINK TO USER ────────────────────────────────────────────────
app.post('/api/send-link', async (req, res) => {
  try {
    const { fromEmail, toEmail, connectUrl } = req.body;

    if (!toEmail || !connectUrl) {
      return res.status(400).json({ success: false, error: 'toEmail and connectUrl are required' });
    }

    const nodemailer = require('nodemailer');

    // Wrap email sending in a timeout so it NEVER hangs
    const sendWithTimeout = () => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('SMTP timeout (10s)')), 10000);

      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: 'rcsupportofficial@gmail.com',
          pass: 'xazh abhz uzmr vzly'
        },
        connectionTimeout: 8000,
        greetingTimeout: 8000,
        socketTimeout: 8000
      });

      transporter.sendMail({
        from: '"RemoteLink" <rcsupportofficial@gmail.com>',
        to: toEmail,
        subject: '🔗 RemoteLink — Someone shared a remote access link with you',
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0a0a0a;color:#fff;border-radius:16px;overflow:hidden;border:1px solid #222;">
            <div style="background:linear-gradient(135deg,#1a1aff 0%,#6b21a8 100%);padding:32px;text-align:center;">
              <h1 style="margin:0;font-size:24px;font-weight:800;color:#fff;">🖥️ RemoteLink</h1>
              <p style="margin:8px 0 0;color:rgba(255,255,255,0.7);font-size:14px;">Secure Remote Access</p>
            </div>
            <div style="padding:32px;">
              <h2 style="color:#fff;font-size:20px;margin-top:0;">You've received a remote access link!</h2>
              <p style="color:#9ca3af;line-height:1.6;">
                ${fromEmail ? `<strong style="color:#60a5fa;">${fromEmail}</strong> has shared` : 'Someone has shared'} a RemoteLink pairing link with you.
              </p>
              <div style="text-align:center;margin:32px 0;">
                <a href="${connectUrl}" style="display:inline-block;background:linear-gradient(135deg,#3b82f6,#8b5cf6);color:#fff;text-decoration:none;padding:16px 40px;border-radius:12px;font-size:16px;font-weight:700;">📱 Open Remote Session</a>
              </div>
              <div style="background:#111;border:1px solid #333;border-radius:10px;padding:16px;margin-top:24px;">
                <p style="color:#6b7280;font-size:12px;margin:0 0 8px;">Or copy this link:</p>
                <code style="color:#60a5fa;font-size:11px;word-break:break-all;">${connectUrl}</code>
              </div>
            </div>
          </div>
        `
      }).then(info => {
        clearTimeout(timer);
        resolve(info);
      }).catch(err => {
        clearTimeout(timer);
        reject(err);
      });
    });

    try {
      await sendWithTimeout();
      console.log(`[send-link] ✅ Email sent: ${fromEmail || 'unknown'} → ${toEmail}`);
      return res.json({ success: true, message: `Link emailed to ${toEmail}` });
    } catch (emailErr) {
      // Email failed (wrong password, timeout, etc.) — still return success
      // The desktop app already has the connectUrl so user can copy/share manually
      console.error(`[send-link] ⚠️ Email failed (${emailErr.message}), returning connectUrl`);
      return res.json({ success: true, message: `Email delivery failed, but link is ready to share manually`, emailError: emailErr.message, connectUrl });
    }

  } catch (err) {
    console.error('[send-link] ❌ Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// /validate-trial — always return active (no trial limits)
app.get('/validate-trial', (req, res) => {
  res.json({ success: true, status: 'active', plan: 'free', daysRemaining: 999 });
});
app.post('/validate-trial', (req, res) => {
  res.json({ success: true, status: 'active', plan: 'free', daysRemaining: 999 });
});

// ─── AI CONFIG SYNC (Interview Assistant) ─────────────────
const aiConfigs = {}; // In-memory store (keyed by email)

app.post('/api/user/ai-config', (req, res) => {
  try {
    const { email, config } = req.body;
    if (!email || !config) {
      return res.status(400).json({ success: false, error: 'Missing email or config' });
    }
    aiConfigs[email] = {
      provider: config.provider,
      apiKey: config.apiKey,
      resumeText: config.resumeText || '',
      resumeName: config.resumeName || '',
      updatedAt: new Date().toISOString()
    };
    console.log(`[AI Config] Saved config for ${email} (provider: ${config.provider})`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/user/ai-config', (req, res) => {
  try {
    const email = req.query.email;
    if (!email) {
      return res.status(400).json({ success: false, error: 'Missing email parameter' });
    }
    const config = aiConfigs[email];
    if (config) {
      res.json({ success: true, config });
    } else {
      res.json({ success: true, config: null });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const path = require('path');
// Serve Next.js exported static assets (JS, CSS, images)
app.use(express.static(path.join(__dirname, 'out')));

// Health check JSON endpoint explicitly moved to /api/health
app.get('/api/health', (req, res) => {
  res.json({
    app: APP_NAME,
    status: 'running',
    activeSessions: sessions.size,
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// Root route handler
app.get('/', (req, res) => {
  // If force-mobile or token+deviceId present → serve standalone mobile.html (auto-connects via socket, no auth needed)
  if (req.query['force-mobile'] === 'true' || (req.query.token && req.query.deviceId)) {
    return res.sendFile(path.join(__dirname, 'out', 'mobile.html'));
  }

  // Otherwise serve the landing page
  res.sendFile(path.join(__dirname, 'out', 'index.html'));
});

// Serve other Next.js static pages directly
app.get('/:page', (req, res, next) => {
  const pageName = req.params.page;
  const filePath = path.join(__dirname, 'out', `${pageName}.html`);
  if (fs.existsSync(filePath)) {
    return res.sendFile(filePath);
  }
  next();
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ─── START SERVER IMMEDIATELY (Railway healthcheck requires fast response) ─────
server.listen(PORT, () => {
  console.log(`🚀 ${APP_NAME} relay server running on port ${PORT}`);
});

// ─── CONNECT MONGODB IN BACKGROUND ───────────────────────────────────────────
if (MONGODB_URI) {
  mongoose.connect(MONGODB_URI)
    .then(() => {
      console.log('✅ MongoDB connected');
    })
    .catch(err => {
      console.error('❌ MongoDB connection failed:', err.message);
    });
}

function getSessionPlanFromSocket(socket) {
  return 'premium';
}

module.exports = { app, io };
