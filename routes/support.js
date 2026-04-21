const express = require('express');
const db = require('../database');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);

// Heartbeat — called periodically from the support panel to keep the agent "online"
router.post('/heartbeat', requireRole('support', 'admin'), (req, res) => {
  db.prepare("UPDATE users SET last_active_at = datetime('now') WHERE id = ?").run(req.user.id);
  res.json({ success: true, now: new Date().toISOString() });
});

// List online support agents (active within last 2 minutes)
router.get('/online', requireRole('support', 'admin'), (req, res) => {
  const ONLINE_WINDOW_SECONDS = 120;
  const agents = db.prepare(`
    SELECT id, name, phone, role, last_active_at,
      (SELECT COUNT(*) FROM tickets t
        WHERE t.assigned_support_id = u.id AND t.status IN ('open','in_progress')) as open_tickets,
      (SELECT COUNT(*) FROM chat_conversations c
        WHERE c.support_id = u.id AND c.status = 'assigned') as active_chats
    FROM users u
    WHERE role IN ('support', 'admin')
      AND last_active_at IS NOT NULL
      AND (julianday('now') - julianday(last_active_at)) * 86400 < ?
    ORDER BY last_active_at DESC
  `).all(ONLINE_WINDOW_SECONDS);
  res.json(agents);
});

// Quick replies — list (global + own)
router.get('/quick-replies', requireRole('support', 'admin'), (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM quick_replies
    WHERE is_global = 1 OR support_id = ?
    ORDER BY is_global DESC, shortcut ASC
  `).all(req.user.id);
  res.json(rows);
});

// Create a personal quick reply
router.post('/quick-replies', requireRole('support', 'admin'), (req, res) => {
  const { shortcut, message } = req.body;
  if (!shortcut?.trim() || !message?.trim()) {
    return res.status(400).json({ error: 'Shortcut and message are required' });
  }
  const result = db.prepare(`
    INSERT INTO quick_replies (support_id, shortcut, message, is_global)
    VALUES (?, ?, ?, 0)
  `).run(req.user.id, shortcut.trim(), message.trim());
  const qr = db.prepare('SELECT * FROM quick_replies WHERE id = ?').get(result.lastInsertRowid);
  res.json(qr);
});

// Delete personal quick reply
router.delete('/quick-replies/:id', requireRole('support', 'admin'), (req, res) => {
  const qr = db.prepare('SELECT * FROM quick_replies WHERE id = ?').get(req.params.id);
  if (!qr) return res.status(404).json({ error: 'Not found' });
  if (qr.is_global && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Only admins can delete global quick replies' });
  }
  if (!qr.is_global && qr.support_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Cannot delete another agent\'s reply' });
  }
  db.prepare('DELETE FROM quick_replies WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Conversation notes — list
router.get('/notes/:conversationId', requireRole('support', 'admin'), (req, res) => {
  const notes = db.prepare(`
    SELECT n.*, u.name as support_name
    FROM conversation_notes n
    JOIN users u ON n.support_id = u.id
    WHERE n.conversation_id = ?
    ORDER BY n.created_at DESC
  `).all(req.params.conversationId);
  res.json(notes);
});

// Add note
router.post('/notes/:conversationId', requireRole('support', 'admin'), (req, res) => {
  const { note } = req.body;
  if (!note?.trim()) return res.status(400).json({ error: 'Note is required' });
  const result = db.prepare(`
    INSERT INTO conversation_notes (conversation_id, support_id, note)
    VALUES (?, ?, ?)
  `).run(req.params.conversationId, req.user.id, note.trim());
  const row = db.prepare(`
    SELECT n.*, u.name as support_name
    FROM conversation_notes n
    JOIN users u ON n.support_id = u.id
    WHERE n.id = ?
  `).get(result.lastInsertRowid);
  res.json(row);
});

module.exports = router;
