const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Twilio Verify setup
let twilioClient = null;
let verifyServiceSid = null;
const twilioConfigured = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);

if (twilioConfigured) {
  const twilio = require('twilio');
  twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

  // Create or reuse a Verify Service
  (async () => {
    try {
      // Check for existing service
      const services = await twilioClient.verify.v2.services.list({ limit: 20 });
      const existing = services.find(s => s.friendlyName === 'SubStore');
      if (existing) {
        verifyServiceSid = existing.sid;
      } else {
        const service = await twilioClient.verify.v2.services.create({ friendlyName: 'SubStore', codeLength: 6 });
        verifyServiceSid = service.sid;
      }
      console.log('  SMS: Twilio Verify ready — OTP codes will be sent via SMS');
    } catch (err) {
      console.error('  SMS: Failed to set up Twilio Verify:', err.message);
    }
  })();
} else {
  console.log('  SMS: Twilio not configured — OTP codes will appear in console');
  console.log('  To enable SMS, set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in .env');
}

// Convert phone to E.164 format for Twilio
function toE164(phone) {
  let cleaned = phone.replace(/[\s\-()]/g, '');
  if (cleaned.startsWith('00')) {
    cleaned = '+' + cleaned.substring(2);
  }
  if (!cleaned.startsWith('+')) {
    cleaned = '+' + cleaned;
  }
  return cleaned;
}

// Send OTP to phone number
router.post('/send-otp', async (req, res) => {
  const { phone } = req.body;
  if (!phone || phone.trim().length < 8) {
    return res.status(400).json({ error: 'Valid phone number is required' });
  }

  const cleanPhone = phone.trim();

  // Send via Twilio Verify
  if (twilioClient && verifyServiceSid) {
    try {
      const e164 = toE164(cleanPhone);
      await twilioClient.verify.v2
        .services(verifyServiceSid)
        .verifications.create({ to: e164, channel: 'sms' });

      console.log(`  OTP sent via SMS to ${e164}`);
      return res.json({ success: true, message: 'Verification code sent to your phone number.' });
    } catch (err) {
      console.error('  SMS failed:', err.message);
      return res.status(500).json({ error: 'Failed to send SMS. Please try again.' });
    }
  }

  // Fallback: generate our own code and log to console
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  db.prepare('UPDATE otps SET used = 1 WHERE phone = ? AND used = 0').run(cleanPhone);
  db.prepare('INSERT INTO otps (phone, code, expires_at) VALUES (?, ?, ?)').run(cleanPhone, code, expiresAt);

  console.log(`\n========================================`);
  console.log(`  OTP for ${cleanPhone}: ${code}`);
  console.log(`  Expires at: ${new Date(expiresAt).toLocaleTimeString()}`);
  console.log(`========================================\n`);

  res.json({ success: true, message: 'OTP sent successfully. Check server console for the code.' });
});

// Verify OTP and login/register
router.post('/verify-otp', async (req, res) => {
  const { phone, code } = req.body;
  if (!phone || !code) {
    return res.status(400).json({ error: 'Phone and code are required' });
  }

  const cleanPhone = phone.trim();

  // Verify via Twilio Verify
  if (twilioClient && verifyServiceSid) {
    try {
      const e164 = toE164(cleanPhone);
      const check = await twilioClient.verify.v2
        .services(verifyServiceSid)
        .verificationChecks.create({ to: e164, code });

      if (check.status !== 'approved') {
        return res.status(400).json({ error: 'Invalid or expired code' });
      }
    } catch (err) {
      return res.status(400).json({ error: 'Invalid or expired code' });
    }
  } else {
    // Fallback: check our own OTP table
    const otp = db.prepare(`
      SELECT * FROM otps
      WHERE phone = ? AND code = ? AND used = 0 AND expires_at > datetime('now')
      ORDER BY created_at DESC LIMIT 1
    `).get(cleanPhone, code);

    if (!otp) {
      return res.status(400).json({ error: 'Invalid or expired OTP code' });
    }

    db.prepare('UPDATE otps SET used = 1 WHERE id = ?').run(otp.id);
  }

  // Find or create user
  let user = db.prepare('SELECT * FROM users WHERE phone = ?').get(cleanPhone);
  if (!user) {
    db.prepare('INSERT INTO users (phone) VALUES (?)').run(cleanPhone);
    user = db.prepare('SELECT * FROM users WHERE phone = ?').get(cleanPhone);
  }

  // Create session (valid for 7 days)
  const sessionId = uuidv4();
  const sessionExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').run(sessionId, user.id, sessionExpires);

  res.json({
    success: true,
    token: sessionId,
    user: {
      id: user.id,
      phone: user.phone,
      name: user.name,
      is_admin: user.is_admin,
      role: user.role || (user.is_admin ? 'admin' : 'customer')
    }
  });
});

// Get current user
router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

// Update profile
router.put('/profile', authenticate, (req, res) => {
  const { name } = req.body;
  db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name || '', req.user.id);
  res.json({ success: true, user: { ...req.user, name } });
});

// Logout
router.post('/logout', authenticate, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(req.sessionId);
  res.json({ success: true });
});

module.exports = router;
