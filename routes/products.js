const express = require('express');
const db = require('../database');

const router = express.Router();

// Get all active products
router.get('/', (req, res) => {
  const { category } = req.query;
  let products;
  if (category && category !== 'all') {
    products = db.prepare('SELECT * FROM products WHERE is_active = 1 AND category = ? ORDER BY id').all(category);
  } else {
    products = db.prepare('SELECT * FROM products WHERE is_active = 1 ORDER BY id').all();
  }

  // Parse features JSON
  products = products.map(p => ({
    ...p,
    features: JSON.parse(p.features || '[]')
  }));

  res.json(products);
});

// Get single product
router.get('/:id', (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ? AND is_active = 1').get(req.params.id);
  if (!product) {
    return res.status(404).json({ error: 'Product not found' });
  }
  product.features = JSON.parse(product.features || '[]');
  res.json(product);
});

// Get categories
router.get('/meta/categories', (req, res) => {
  const categories = db.prepare('SELECT DISTINCT category FROM products WHERE is_active = 1 ORDER BY category').all();
  res.json(categories.map(c => c.category));
});

module.exports = router;
