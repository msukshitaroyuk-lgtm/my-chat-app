/**
 * Improved server.js
 * - validates & persists settings
 * - uses undici or global fetch with timeout
 * - basic forwarding throttling, message validation
 * - retains Bengali messages/logging
 */

const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');

// Fetch fallback for Node <18
let fetchImpl, AbortControllerImpl;
if (globalThis.fetch) {
  fetchImpl = globalThis.fetch.bind(globalThis);
  AbortControllerImpl = globalThis.AbortController;
} else {
  // npm i undici
  const undici = require('undici');
  fetchImpl = undici.fetch.bind(undici);
  AbortControllerImpl = undici.AbortController;
}

const app = express();
const server = http.createServer(app);
const io = new socketIo.Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

app.use(express.json());
app.use(express.static('public'));

// serve index.html for root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Settings persistence
const SETTINGS_FILE = path.join(__dirname, 'settings.json');
let userSettings = {
  forwardingLink: '',
  gatewayName: '',
  isActive: false
};

async function loadSettings() {
  try {
    const raw = await fs.readFile(SETTINGS_FILE, 'utf8');
    userSettings = JSON.parse(raw);
    console.log('Settings loaded from disk.');
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('Settings load error:', e);
    else console.log('No settings file; using defaults.');
  }
}

async function persistSettings() {
  try {
    await fs.writeFile(SETTINGS_FILE, JSON.stringify(userSettings, null, 2), 'utf8');
    console.log('Settings saved to disk.');
  } catch (e) {
    console.error('Failed to save settings:', e);
  }
}

// Helpers
function isValidUrl(s) {
  try {
    new URL(s);
    return true;
  } catch {
    return false;
  }
}
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
}

// API: get settings
app.get('/api/settings', (req, res) => {
  res.json(userSettings);
});

// API: save settings
app.post('/api/save-settings', async (req, res) => {
  try {
    const { forwardingLink = '', gatewayName = '', isActive = false } = req.body || {};

    if (forwardingLink && !isValidUrl(forwardingLink)) {
      return res.status(400).json({ status: 'Error', message: 'Invalid forwardingLink' });
    }
    if (typeof gatewayName !== 'string') {
      return res.status(400).json({ status: 'Error', message: 'Invalid gatewayName' });
    }

    userSettings = { forwardingLink, gatewayName, isActive: !!isActive };
    await persistSettings();

    console.log('সেটিংস আপডেট হয়েছে:', userSettings);
    return res.json({ status: 'Success', message: 'সেটিংস সফলভাবে সেভ হয়েছে!' });
  } catch (e) {
    console.error('Error saving settings:', e);
    return res.status(500).json({ status: 'Error', message: 'Failed to save settings' });
  }
});

// Simple in-memory message store (optional)
const chatMessages = [];
const MAX_MESSAGES = 200;

// Forwarding throttle (per gateway)
const lastForward = new Map();
const MIN_FORWARD_INTERVAL_MS = 200; // tune as needed

async function forwardToWebsite(message) {
  const { forwardingLink, gatewayName, isActive } = userSettings;
  if (!isActive || !forwardingLink) return;

  if (gatewayName && gatewayName.trim() !== '') {
    const re = new RegExp(`\\b${escapeRegExp(gatewayName)}\\b`, 'i');
    if (!re.test(message)) return;
  }

  // throttle
  const now = Date.now();
  const key = forwardingLink + '|' + (gatewayName || '');
  const last = lastForward.get(key) || 0;
  if (now - last < MIN_FORWARD_INTERVAL_MS) {
    console.warn('Forwarding throttled');
    return;
  }
  lastForward.set(key, now);

  const controller = new AbortControllerImpl();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const resp = await fetchImpl(forwardingLink, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'my-chat-app/1.0' },
      body: JSON.stringify({ message, time: new Date().toISOString(), gateway: gatewayName }),
      signal: controller.signal
    });

    if (!resp.ok) {
      console.warn('Forwarding response status:', resp.status);
    } else {
      console.log('মেসেজ ফরওয়ার্ড করা হয়েছে!');
    }
  } catch (e) {
    if (e.name === 'AbortError') {
      console.error('ফরওয়ার্ডিং টাইমআউট হয়েছে');
    } else {
      console.error('ফরওয়ার্ডিং ব্যর্থ:', e);
    }
  } finally {
    clearTimeout(timeout);
  }
}

// Socket events
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // send current messages
  socket.emit('load_messages', chatMessages);

  socket.on('new_sms', async (msg) => {
    try {
      if (typeof msg !== 'string') {
        socket.emit('error', 'Invalid message type');
        return;
      }
      const trimmed = msg.trim();
      if (!trimmed) return;
      if (trimmed.length > 2000) { // guard very large messages
        console.warn('Dropped oversized message from', socket.id);
        return;
      }

      const messageObj = {
        id: Date.now(),
        content: trimmed,
        timestamp: new Date().toISOString(),
        sender: 'SMS Gateway'
      };

      chatMessages.push(messageObj);
      if (chatMessages.length > MAX_MESSAGES) chatMessages.shift();

      io.emit('display_message', messageObj);

      // forward (don't await to keep socket responsive)
      forwardToWebsite(trimmed).catch((e) => console.error('forwardToWebsite error:', e));
    } catch (e) {
      console.error('Error handling new_sms:', e);
    }
  });

  socket.on('disconnect', (reason) => {
    console.log('User disconnected:', socket.id, reason);
  });
});

// graceful shutdown
function shutdown() {
  console.log('শাটডাউন শুরু...');
  server.close((err) => {
    if (err) {
      console.error('Shutdown error:', err);
      process.exit(1);
    }
    console.log('শাটডাউন সম্পন্ন');
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('unhandledRejection', (r) => console.error('Unhandled Rejection:', r));

// start
(async () => {
  await loadSettings();
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`সার্ভার রানিং! পোর্ট: ${PORT}`);
  });
})();

module.exports = app;
