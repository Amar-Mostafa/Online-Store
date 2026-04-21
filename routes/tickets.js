const express = require('express');
const db = require('../database');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// Pick an online support agent (active within last 2 minutes), otherwise least-loaded support agent
function pickSupportAgent() {
  const ONLINE_WINDOW_SECONDS = 120;
  const online = db.prepare(`
    SELECT u.id, u.name, u.phone,
      (SELECT COUNT(*) FROM tickets t
        WHERE t.assigned_support_id = u.id AND t.status IN ('open', 'in_progress')) as load
    FROM users u
    WHERE u.role IN ('support', 'admin')
      AND u.last_active_at IS NOT NULL
      AND (julianday('now') - julianday(u.last_active_at)) * 86400 < ?
    ORDER BY load ASC, u.last_active_at DESC
    LIMIT 1
  `).get(ONLINE_WINDOW_SECONDS);

  if (online) return online;

  // Fallback: any support/admin agent with least current load
  return db.prepare(`
    SELECT u.id, u.name, u.phone,
      (SELECT COUNT(*) FROM tickets t
        WHERE t.assigned_support_id = u.id AND t.status IN ('open', 'in_progress')) as load
    FROM users u
    WHERE u.role IN ('support', 'admin')
    ORDER BY load ASC, u.id ASC
    LIMIT 1
  `).get();
}

// Public: submit a ticket (no auth required — user might not have account)
router.post('/submit', (req, res) => {
  const { service_number, product_id, order_id, name, phone, problem_description } = req.body;

  if (!name?.trim() || !phone?.trim() || !problem_description?.trim()) {
    return res.status(400).json({ error: 'Name, phone, and problem description are required' });
  }

  const cleanPhone = phone.trim();
  const cleanName = name.trim();

  // Find or create a user record for this phone
  let user = db.prepare('SELECT * FROM users WHERE phone = ?').get(cleanPhone);
  if (!user) {
    db.prepare('INSERT INTO users (phone, name, role) VALUES (?, ?, ?)').run(cleanPhone, cleanName, 'customer');
    user = db.prepare('SELECT * FROM users WHERE phone = ?').get(cleanPhone);
  } else if (!user.name && cleanName) {
    db.prepare('UPDATE users SET name = ? WHERE id = ?').run(cleanName, user.id);
  }

  // Auto-assign
  const agent = pickSupportAgent();

  // Create a chat conversation linked to the ticket
  const convoResult = db.prepare(`
    INSERT INTO chat_conversations (user_id, support_id, status)
    VALUES (?, ?, ?)
  `).run(user.id, agent ? agent.id : null, agent ? 'assigned' : 'open');
  const conversationId = convoResult.lastInsertRowid;

  // Create the ticket
  const ticketResult = db.prepare(`
    INSERT INTO tickets (service_number, product_id, order_id, name, phone, problem_description,
                          status, assigned_support_id, conversation_id, user_id)
    VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)
  `).run(
    service_number?.trim() || '',
    product_id || null,
    order_id || null,
    cleanName,
    cleanPhone,
    problem_description.trim(),
    agent ? agent.id : null,
    conversationId,
    user.id
  );

  // Seed the conversation with the problem description
  const problemText = [
    `--- New Ticket #${ticketResult.lastInsertRowid} ---`,
    service_number ? `Service Number: ${service_number}` : null,
    product_id ? `Product ID: ${product_id}` : null,
    order_id ? `Order ID: ${order_id}` : null,
    `Customer: ${cleanName} (${cleanPhone})`,
    '',
    problem_description.trim()
  ].filter(Boolean).join('\n');

  db.prepare(`
    INSERT INTO chat_messages (conversation_id, sender_id, message)
    VALUES (?, ?, ?)
  `).run(conversationId, user.id, problemText);

  if (agent) {
    db.prepare(`
      INSERT INTO chat_messages (conversation_id, sender_id, message)
      VALUES (?, ?, ?)
    `).run(conversationId, agent.id, `--- Assigned to ${agent.name || 'Support Agent'} ---`);
  }

  res.json({
    success: true,
    ticket_id: ticketResult.lastInsertRowid,
    conversation_id: conversationId,
    assigned_to: agent ? agent.name || 'Support Agent' : null,
    message: agent
      ? `Ticket #${ticketResult.lastInsertRowid} created and assigned to ${agent.name || 'a support agent'}.`
      : `Ticket #${ticketResult.lastInsertRowid} created. A support agent will be assigned shortly.`
  });
});

// Support/admin: list tickets
router.get('/', authenticate, requireRole('support', 'admin'), (req, res) => {
  const { status, mine } = req.query;
  const conditions = [];
  const params = [];

  if (status && status !== 'all') {
    conditions.push('t.status = ?');
    params.push(status);
  }
  if (mine === '1') {
    conditions.push('t.assigned_support_id = ?');
    params.push(req.user.id);
  }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  const tickets = db.prepare(`
    SELECT t.*,
      p.name as product_name,
      s.name as support_name,
      s.phone as support_phone,
      (SELECT COUNT(*) FROM chat_messages WHERE conversation_id = t.conversation_id) as message_count
    FROM tickets t
    LEFT JOIN products p ON t.product_id = p.id
    LEFT JOIN users s ON t.assigned_support_id = s.id
    ${where}
    ORDER BY
      CASE t.status
        WHEN 'open' THEN 1
        WHEN 'in_progress' THEN 2
        WHEN 'resolved' THEN 3
        WHEN 'closed' THEN 4
        ELSE 5
      END,
      t.created_at DESC
  `).all(...params);

  res.json(tickets);
});

// Support/admin: get single ticket
router.get('/:id', authenticate, requireRole('support', 'admin'), (req, res) => {
  const ticket = db.prepare(`
    SELECT t.*, p.name as product_name, s.name as support_name
    FROM tickets t
    LEFT JOIN products p ON t.product_id = p.id
    LEFT JOIN users s ON t.assigned_support_id = s.id
    WHERE t.id = ?
  `).get(req.params.id);

  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
  res.json(ticket);
});

// Support/admin: update ticket status
router.put('/:id/status', authenticate, requireRole('support', 'admin'), (req, res) => {
  const { status } = req.body;
  const valid = ['open', 'in_progress', 'resolved', 'closed'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  db.prepare("UPDATE tickets SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, req.params.id);
  res.json({ success: true });
});

// Support/admin: claim/assign ticket to self
router.put('/:id/claim', authenticate, requireRole('support', 'admin'), (req, res) => {
  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

  db.prepare(`
    UPDATE tickets SET assigned_support_id = ?, status = 'in_progress', updated_at = datetime('now')
    WHERE id = ?
  `).run(req.user.id, req.params.id);

  if (ticket.conversation_id) {
    db.prepare(`
      UPDATE chat_conversations SET support_id = ?, status = 'assigned', updated_at = datetime('now')
      WHERE id = ?
    `).run(req.user.id, ticket.conversation_id);

    db.prepare(`
      INSERT INTO chat_messages (conversation_id, sender_id, message)
      VALUES (?, ?, ?)
    `).run(ticket.conversation_id, req.user.id, `--- ${req.user.name || 'Support Agent'} claimed this ticket ---`);
  }

  res.json({ success: true });
});

// Support/admin: ticket stats
router.get('/stats/summary', authenticate, requireRole('support', 'admin'), (req, res) => {
  const open = db.prepare("SELECT COUNT(*) as c FROM tickets WHERE status = 'open'").get().c;
  const inProgress = db.prepare("SELECT COUNT(*) as c FROM tickets WHERE status = 'in_progress'").get().c;
  const resolved = db.prepare("SELECT COUNT(*) as c FROM tickets WHERE status = 'resolved' AND updated_at >= date('now')").get().c;
  const mine = db.prepare("SELECT COUNT(*) as c FROM tickets WHERE assigned_support_id = ? AND status IN ('open','in_progress')").get(req.user.id).c;
  res.json({ open, in_progress: inProgress, resolved_today: resolved, mine });
});

module.exports = router;
