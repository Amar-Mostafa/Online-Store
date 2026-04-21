const express = require('express');
const db = require('../database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Create order
router.post('/', authenticate, (req, res) => {
  const { items, payment_method, cardholder_name } = req.body;

  if (!items || !items.length) {
    return res.status(400).json({ error: 'Order must have at least one item' });
  }

  if (!payment_method) {
    return res.status(400).json({ error: 'Payment method is required' });
  }

  // Validate items and calculate total
  let total = 0;
  const validatedItems = [];

  for (const item of items) {
    const product = db.prepare('SELECT * FROM products WHERE id = ? AND is_active = 1').get(item.product_id);
    if (!product) {
      return res.status(400).json({ error: `Product #${item.product_id} not found` });
    }
    const qty = item.quantity || 1;
    total += product.price * qty;
    validatedItems.push({ product_id: product.id, quantity: qty, price: product.price });
  }

  // Simulate payment processing
  const paymentRef = 'PAY-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6).toUpperCase();

  // Create order in transaction
  const createOrder = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO orders (user_id, total, status, payment_method, payment_ref)
      VALUES (?, ?, 'paid', ?, ?)
    `).run(req.user.id, total, payment_method, paymentRef);

    const orderId = result.lastInsertRowid;

    const insertItem = db.prepare('INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (?, ?, ?, ?)');
    for (const item of validatedItems) {
      insertItem.run(orderId, item.product_id, item.quantity, item.price);
    }

    return orderId;
  });

  const orderId = createOrder();

  // Fetch the complete order
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  const orderItems = db.prepare(`
    SELECT oi.*, p.name as product_name, p.image_url, p.duration
    FROM order_items oi
    JOIN products p ON oi.product_id = p.id
    WHERE oi.order_id = ?
  `).all(orderId);

  res.json({
    success: true,
    order: { ...order, items: orderItems }
  });
});

// Get user's orders
router.get('/', authenticate, (req, res) => {
  const orders = db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);

  const ordersWithItems = orders.map(order => {
    const items = db.prepare(`
      SELECT oi.*, p.name as product_name, p.image_url, p.duration
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = ?
    `).all(order.id);
    return { ...order, items };
  });

  res.json(ordersWithItems);
});

// Get unique purchased products for the current user (for chat widget quick-picks)
router.get('/my-products', authenticate, (req, res) => {
  const rows = db.prepare(`
    SELECT p.id, p.name, p.image_url, p.category, p.duration,
      MAX(o.id) as last_order_id,
      MAX(o.created_at) as last_ordered_at,
      COUNT(DISTINCT o.id) as order_count
    FROM order_items oi
    JOIN orders o ON oi.order_id = o.id
    JOIN products p ON oi.product_id = p.id
    WHERE o.user_id = ?
    GROUP BY p.id
    ORDER BY last_ordered_at DESC
  `).all(req.user.id);
  res.json(rows);
});

// Get single order
router.get('/:id', authenticate, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }

  const items = db.prepare(`
    SELECT oi.*, p.name as product_name, p.image_url, p.duration
    FROM order_items oi
    JOIN products p ON oi.product_id = p.id
    WHERE oi.order_id = ?
  `).all(order.id);

  res.json({ ...order, items });
});

module.exports = router;
