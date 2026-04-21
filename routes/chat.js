const express = require('express');
const db = require('../database');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// All chat routes require authentication
router.use(authenticate);

// --- Customer endpoints ---

// Start or get active conversation
router.post('/start', (req, res) => {
  // Check for an existing open conversation
  let convo = db.prepare(`
    SELECT * FROM chat_conversations
    WHERE user_id = ? AND status IN ('open', 'assigned')
    ORDER BY created_at DESC LIMIT 1
  `).get(req.user.id);

  if (!convo) {
    const result = db.prepare(`
      INSERT INTO chat_conversations (user_id) VALUES (?)
    `).run(req.user.id);
    convo = db.prepare('SELECT * FROM chat_conversations WHERE id = ?').get(result.lastInsertRowid);

    // Auto-send a welcome message
    db.prepare(`
      INSERT INTO chat_messages (conversation_id, sender_id, message)
      VALUES (?, ?, ?)
    `).run(convo.id, req.user.id, '--- Customer started a new conversation ---');
  }

  res.json(convo);
});

// Get active conversation
router.get('/active', (req, res) => {
  const convo = db.prepare(`
    SELECT * FROM chat_conversations
    WHERE user_id = ? AND status IN ('open', 'assigned')
    ORDER BY created_at DESC LIMIT 1
  `).get(req.user.id);

  res.json(convo || null);
});

// Send a message
router.post('/message', (req, res) => {
  const { conversation_id, message } = req.body;
  if (!conversation_id || !message?.trim()) {
    return res.status(400).json({ error: 'Conversation ID and message are required' });
  }

  // Verify user is part of this conversation
  const convo = db.prepare(`
    SELECT * FROM chat_conversations WHERE id = ?
  `).get(conversation_id);

  if (!convo) {
    return res.status(404).json({ error: 'Conversation not found' });
  }

  // Customers can only message their own conversations, support/admin can message any
  if (req.user.role === 'customer' && convo.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Not your conversation' });
  }

  if (convo.status === 'closed') {
    return res.status(400).json({ error: 'Conversation is closed' });
  }

  const result = db.prepare(`
    INSERT INTO chat_messages (conversation_id, sender_id, message)
    VALUES (?, ?, ?)
  `).run(conversation_id, req.user.id, message.trim());

  db.prepare('UPDATE chat_conversations SET updated_at = datetime(\'now\') WHERE id = ?').run(conversation_id);

  const msg = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(result.lastInsertRowid);
  res.json(msg);
});

// Get messages (with polling via after_id)
router.get('/messages/:conversationId', (req, res) => {
  const { conversationId } = req.params;
  const { after_id } = req.query;

  const convo = db.prepare('SELECT * FROM chat_conversations WHERE id = ?').get(conversationId);
  if (!convo) {
    return res.status(404).json({ error: 'Conversation not found' });
  }

  // Customers see only their own; support/admin see any
  if (req.user.role === 'customer' && convo.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Not your conversation' });
  }

  let messages;
  if (after_id) {
    messages = db.prepare(`
      SELECT m.*, u.name as sender_name, u.role as sender_role
      FROM chat_messages m
      JOIN users u ON m.sender_id = u.id
      WHERE m.conversation_id = ? AND m.id > ?
      ORDER BY m.id ASC
    `).all(conversationId, after_id);
  } else {
    messages = db.prepare(`
      SELECT m.*, u.name as sender_name, u.role as sender_role
      FROM chat_messages m
      JOIN users u ON m.sender_id = u.id
      WHERE m.conversation_id = ?
      ORDER BY m.id ASC
    `).all(conversationId);
  }

  res.json({ messages, conversation: convo });
});

// Close conversation (customer can close their own)
router.put('/close/:conversationId', (req, res) => {
  const convo = db.prepare('SELECT * FROM chat_conversations WHERE id = ?').get(req.params.conversationId);
  if (!convo) return res.status(404).json({ error: 'Not found' });

  if (req.user.role === 'customer' && convo.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Not your conversation' });
  }

  db.prepare("UPDATE chat_conversations SET status = 'closed', updated_at = datetime('now') WHERE id = ?").run(convo.id);
  res.json({ success: true });
});

// --- Support endpoints ---

// Get all conversations (support & admin only)
router.get('/support/conversations', requireRole('support', 'admin'), (req, res) => {
  const { status } = req.query;
  let convos;

  if (status && status !== 'all') {
    convos = db.prepare(`
      SELECT c.*, u.phone as customer_phone, u.name as customer_name,
        s.name as support_name,
        (SELECT COUNT(*) FROM chat_messages WHERE conversation_id = c.id) as message_count
      FROM chat_conversations c
      JOIN users u ON c.user_id = u.id
      LEFT JOIN users s ON c.support_id = s.id
      WHERE c.status = ?
      ORDER BY c.updated_at DESC
    `).all(status);
  } else {
    convos = db.prepare(`
      SELECT c.*, u.phone as customer_phone, u.name as customer_name,
        s.name as support_name,
        (SELECT COUNT(*) FROM chat_messages WHERE conversation_id = c.id) as message_count
      FROM chat_conversations c
      JOIN users u ON c.user_id = u.id
      LEFT JOIN users s ON c.support_id = s.id
      ORDER BY c.updated_at DESC
    `).all();
  }

  res.json(convos);
});

// Assign conversation to self
router.put('/support/assign/:conversationId', requireRole('support', 'admin'), (req, res) => {
  const convo = db.prepare('SELECT * FROM chat_conversations WHERE id = ?').get(req.params.conversationId);
  if (!convo) return res.status(404).json({ error: 'Not found' });

  db.prepare(`
    UPDATE chat_conversations SET support_id = ?, status = 'assigned', updated_at = datetime('now')
    WHERE id = ?
  `).run(req.user.id, convo.id);

  // Send system message
  db.prepare(`
    INSERT INTO chat_messages (conversation_id, sender_id, message)
    VALUES (?, ?, ?)
  `).run(convo.id, req.user.id, `--- Support agent ${req.user.name || 'Agent'} joined the chat ---`);

  res.json({ success: true });
});

// Get customer details for support context
router.get('/support/customer/:userId', requireRole('support', 'admin'), (req, res) => {
  const user = db.prepare('SELECT id, phone, name, role, created_at FROM users WHERE id = ?').get(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  // Recent orders with items
  const orders = db.prepare(`
    SELECT o.* FROM orders o
    WHERE o.user_id = ?
    ORDER BY o.created_at DESC LIMIT 5
  `).all(user.id);

  const ordersWithItems = orders.map(order => {
    const items = db.prepare(`
      SELECT oi.*, p.name as product_name, p.description as product_description, p.category
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = ?
    `).all(order.id);
    return { ...order, items };
  });

  res.json({ user, orders: ordersWithItems });
});

// Support stats
router.get('/support/stats', requireRole('support', 'admin'), (req, res) => {
  const open = db.prepare("SELECT COUNT(*) as count FROM chat_conversations WHERE status = 'open'").get().count;
  const assigned = db.prepare("SELECT COUNT(*) as count FROM chat_conversations WHERE status = 'assigned'").get().count;
  const myActive = db.prepare("SELECT COUNT(*) as count FROM chat_conversations WHERE support_id = ? AND status = 'assigned'").get(req.user.id).count;
  const closedToday = db.prepare("SELECT COUNT(*) as count FROM chat_conversations WHERE status = 'closed' AND updated_at >= date('now')").get().count;

  res.json({ open, assigned, myActive, closedToday });
});

module.exports = router;
