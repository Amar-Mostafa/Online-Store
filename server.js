require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/products', require('./routes/products'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/tickets', require('./routes/tickets'));
app.use('/api/support', require('./routes/support'));

// Serve SPA - fallback to index.html for client-side routing
app.get('/admin/*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html'));
});

app.get('/support/*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'support', 'index.html'));
});

app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

app.listen(PORT, () => {
  console.log(`\n  ╔═══════════════════════════════════════════╗`);
  console.log(`  ║   Digital Store running on port ${PORT}        ║`);
  console.log(`  ║   http://localhost:${PORT}                    ║`);
  console.log(`  ║   Admin: http://localhost:${PORT}/admin        ║`);
  console.log(`  ╚═══════════════════════════════════════════╝\n`);
  console.log(`  Support: http://localhost:${PORT}/support   `);
  console.log(`  Admin phone: 00966580549057`);
  console.log(`  Roles: customer, support, admin`);
  console.log(`  OTP codes will appear in this console.\n`);
});
