const express = require('express');
const db = require('../database');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// All admin routes require authentication + admin role
router.use(authenticate, requireAdmin);

// Dashboard stats
router.get('/stats', (req, res) => {
  const totalProducts = db.prepare('SELECT COUNT(*) as count FROM products WHERE is_active = 1').get().count;
  const totalOrders = db.prepare('SELECT COUNT(*) as count FROM orders').get().count;
  const totalRevenue = db.prepare('SELECT COALESCE(SUM(total), 0) as total FROM orders WHERE status = \'paid\'').get().total;
  const totalCustomers = db.prepare('SELECT COUNT(*) as count FROM users WHERE is_admin = 0').get().count;
  const recentOrders = db.prepare(`
    SELECT o.*, u.phone, u.name as customer_name
    FROM orders o
    JOIN users u ON o.user_id = u.id
    ORDER BY o.created_at DESC LIMIT 5
  `).all();

  res.json({ totalProducts, totalOrders, totalRevenue, totalCustomers, recentOrders });
});

// --- Products Management ---

// Get all products (including inactive)
router.get('/products', (req, res) => {
  let products = db.prepare('SELECT * FROM products ORDER BY id DESC').all();
  products = products.map(p => ({ ...p, features: JSON.parse(p.features || '[]') }));
  res.json(products);
});

// Create product
router.post('/products', (req, res) => {
  const { name, description, features, price, image_url, category, duration, badge } = req.body;

  if (!name || !price) {
    return res.status(400).json({ error: 'Name and price are required' });
  }

  const result = db.prepare(`
    INSERT INTO products (name, description, features, price, image_url, category, duration, badge)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    name,
    description || '',
    JSON.stringify(features || []),
    price,
    image_url || '',
    category || '',
    duration || '1 Month',
    badge || ''
  );

  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(result.lastInsertRowid);
  product.features = JSON.parse(product.features);
  res.json(product);
});

// Update product
router.put('/products/:id', (req, res) => {
  const { name, description, features, price, image_url, category, duration, badge, is_active } = req.body;

  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: 'Product not found' });
  }

  db.prepare(`
    UPDATE products SET
      name = ?, description = ?, features = ?, price = ?,
      image_url = ?, category = ?, duration = ?, badge = ?,
      is_active = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    name ?? existing.name,
    description ?? existing.description,
    features ? JSON.stringify(features) : existing.features,
    price ?? existing.price,
    image_url ?? existing.image_url,
    category ?? existing.category,
    duration ?? existing.duration,
    badge ?? existing.badge,
    is_active ?? existing.is_active,
    req.params.id
  );

  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  product.features = JSON.parse(product.features);
  res.json(product);
});

// Delete product (soft delete)
router.delete('/products/:id', (req, res) => {
  db.prepare('UPDATE products SET is_active = 0 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// --- Orders Management ---

router.get('/orders', (req, res) => {
  const { status } = req.query;
  let orders;

  if (status && status !== 'all') {
    orders = db.prepare(`
      SELECT o.*, u.phone, u.name as customer_name
      FROM orders o JOIN users u ON o.user_id = u.id
      WHERE o.status = ?
      ORDER BY o.created_at DESC
    `).all(status);
  } else {
    orders = db.prepare(`
      SELECT o.*, u.phone, u.name as customer_name
      FROM orders o JOIN users u ON o.user_id = u.id
      ORDER BY o.created_at DESC
    `).all();
  }

  const ordersWithItems = orders.map(order => {
    const items = db.prepare(`
      SELECT oi.*, p.name as product_name
      FROM order_items oi JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = ?
    `).all(order.id);
    return { ...order, items };
  });

  res.json(ordersWithItems);
});

// Update order status
router.put('/orders/:id', (req, res) => {
  const { status, notes } = req.body;
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }

  db.prepare('UPDATE orders SET status = ?, notes = ? WHERE id = ?').run(
    status || order.status,
    notes ?? order.notes,
    req.params.id
  );

  const updated = db.prepare(`
    SELECT o.*, u.phone, u.name as customer_name
    FROM orders o JOIN users u ON o.user_id = u.id
    WHERE o.id = ?
  `).get(req.params.id);

  res.json(updated);
});

// --- Customers ---

router.get('/customers', (req, res) => {
  const customers = db.prepare(`
    SELECT u.*,
      COUNT(o.id) as order_count,
      COALESCE(SUM(o.total), 0) as total_spent
    FROM users u
    LEFT JOIN orders o ON u.id = o.user_id
    WHERE u.role = 'customer'
    GROUP BY u.id
    ORDER BY u.created_at DESC
  `).all();

  res.json(customers);
});

// --- User Management ---

// Get all users
router.get('/users', (req, res) => {
  const users = db.prepare(`
    SELECT u.*,
      COUNT(o.id) as order_count,
      COALESCE(SUM(o.total), 0) as total_spent
    FROM users u
    LEFT JOIN orders o ON u.id = o.user_id
    GROUP BY u.id
    ORDER BY u.created_at DESC
  `).all();

  res.json(users);
});

// Update user role
router.put('/users/:id/role', (req, res) => {
  const { role } = req.body;
  const validRoles = ['customer', 'support', 'admin'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: 'Invalid role. Must be: customer, support, or admin' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  // Prevent demoting yourself
  if (user.id === req.user.id && role !== 'admin') {
    return res.status(400).json({ error: 'Cannot change your own role' });
  }

  db.prepare('UPDATE users SET role = ?, is_admin = ? WHERE id = ?').run(
    role,
    role === 'admin' ? 1 : 0,
    req.params.id
  );

  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  res.json(updated);
});

// Delete user
router.delete('/users/:id', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (user.id === req.user.id) {
    return res.status(400).json({ error: 'Cannot delete yourself' });
  }

  // Delete sessions, then user
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(req.params.id);
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
