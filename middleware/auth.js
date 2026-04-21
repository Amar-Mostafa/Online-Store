const db = require('../database');

function authenticate(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const session = db.prepare(`
    SELECT s.*, u.id as user_id, u.phone, u.name, u.is_admin, u.role
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.id = ? AND s.expires_at > datetime('now')
  `).get(token);

  if (!session) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }

  req.user = {
    id: session.user_id,
    phone: session.phone,
    name: session.name,
    is_admin: session.is_admin,
    role: session.role || (session.is_admin ? 'admin' : 'customer')
  };
  req.sessionId = token;

  // Update presence timestamp on every authenticated request
  try {
    db.prepare("UPDATE users SET last_active_at = datetime('now') WHERE id = ?").run(session.user_id);
  } catch (e) { /* ignore */ }

  next();
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin' && !req.user?.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Access restricted to: ${roles.join(', ')}` });
    }
    next();
  };
}

module.exports = { authenticate, requireAdmin, requireRole };
