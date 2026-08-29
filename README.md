# ??? RemoteLink — Relay Server

> A lightweight **Socket.io relay server** that bridges your **Chrome Extension** (running on your PC) with the **RemoteLink mobile app** on your phone. Handles real-time screen streaming, mouse/keyboard commands, and WebRTC signaling.

---

## ?? What is this?

This is the **backend relay server** for RemoteLink. It does **not** run on your PC or phone — it runs in the cloud (on [Render](https://render.com) or [Railway](https://railway.app)).

### How it works:

```
[Your PC]                    [This Server]               [Your Phone]
Chrome Extension  <-------->  Relay Server  <---------->  Mobile App
(sends screenshots)           (routes data)               (shows screen, sends commands)
```

Both your PC and your phone connect to this server using a **pairing token**. The server routes:
- ?? **Screen frames** from PC ? Phone
- ?? **Keyboard / Mouse commands** from Phone ? PC
- ?? **Audio streaming** from PC ? Phone
- ?? **WebRTC signaling** for peer-to-peer connections

---

## ?? Project Structure

```
server/
+-- index.js              # Main entry point — Express + Socket.io relay hub
+-- package.json          # Node.js dependencies
+-- middleware/
¦   +-- auth.js           # JWT authentication middleware
+-- models/
¦   +-- User.js           # MongoDB User model (email, plan, API keys)
¦   +-- Device.js         # MongoDB Device model
+-- routes/
    +-- auth.js           # Auth routes: /api/auth/register, /api/auth/login
    +-- devices.js        # Device routes: /api/devices
```

---

## ?? Deploy on Render (Free)

### Step 1 — Create a free account
Go to [render.com](https://render.com) and sign up for a free account.

### Step 2 — Create a Web Service
1. Click **New +** ? **Web Service**
2. Choose **Public Git Repository**
3. Paste this URL:
   ```
   https://github.com/ershivshankar/Extension-Test.git
   ```
4. Click **Continue**

### Step 3 — Configure the service

| Setting | Value |
|---|---|
| **Name** | `extension-relay` (any name) |
| **Runtime** | `Node` |
| **Build Command** | `npm install` |
| **Start Command** | `node index.js` |
| **Instance Type** | `Free` |

### Step 4 — Add Environment Variables

In the **Environment** tab, add these variables:

| Variable | Value | Required? |
|---|---|---|
| `MONGODB_URI` | Your MongoDB Atlas connection string | Optional |
| `JWT_SECRET` | Any random secret string (e.g. `mysecret123`) | Optional |
| `PORT` | Leave blank — Render sets this automatically | Auto |

> **Note:** The server works without MongoDB. Screen streaming and relay features work fully without a database. MongoDB is only needed if you want user login/registration features.

### Step 5 — Deploy
Click **Deploy Web Service** and wait 2–3 minutes. You will get a URL like:
```
https://extension-relay.onrender.com
```

---

## ?? Connect the Chrome Extension

Once deployed, copy your Render URL and:

1. Click the **JarvisType / RemoteLink** icon in Chrome
2. Open **Settings**
3. Change the **Relay URL** to your new URL
4. Click **Save**

---

## ?? API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | /health | Health check |
| GET | /api/health | Detailed health with active sessions count |
| GET | /validate-trial | Always returns active (no trial limits) |
| POST | /api/auth/register | Register a new user |
| POST | /api/auth/login | Login and get JWT token |
| GET | /api/user/status | Get user plan and API keys |
| POST | /api/user/update-api-keys | Update Gemini / ChatGPT / Grok API keys |
| POST | /api/send-link | Send pairing link via email |

---

## ?? Run Locally

```bash
git clone https://github.com/ershivshankar/Extension-Test.git
cd Extension-Test
npm install
node index.js
```

Server starts at: http://localhost:3001

---

## ?? Requirements

- Node.js v18 or higher
- MongoDB Atlas (optional, free tier) — only needed for user auth features

---

## ?? Notes

- All relay sessions are stored in-memory — cleared on server restart.
- Free Render accounts spin down after 15 min of inactivity. First reconnect takes ~30 seconds.
- Use [UptimeRobot](https://uptimerobot.com) to ping /health every 5 minutes to keep it alive for free.
