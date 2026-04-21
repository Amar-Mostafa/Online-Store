const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Allow overriding DB path for production deployment (e.g. a mounted disk)
const dbPath = process.env.DATABASE_PATH || path.join(__dirname, 'store.db');
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(dbPath);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT UNIQUE NOT NULL,
    name TEXT DEFAULT '',
    is_admin INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS otps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT NOT NULL,
    code TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    features TEXT DEFAULT '[]',
    price REAL NOT NULL,
    image_url TEXT DEFAULT '',
    category TEXT DEFAULT '',
    duration TEXT DEFAULT '1 Month',
    badge TEXT DEFAULT '',
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    total REAL NOT NULL,
    status TEXT DEFAULT 'pending',
    payment_method TEXT DEFAULT '',
    payment_ref TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER DEFAULT 1,
    price REAL NOT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
  );

  CREATE TABLE IF NOT EXISTS chat_conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    support_id INTEGER,
    status TEXT DEFAULT 'open',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (support_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    sender_id INTEGER NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id),
    FOREIGN KEY (sender_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service_number TEXT DEFAULT '',
    product_id INTEGER,
    order_id INTEGER,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    problem_description TEXT NOT NULL,
    status TEXT DEFAULT 'open',
    priority TEXT DEFAULT 'normal',
    assigned_support_id INTEGER,
    conversation_id INTEGER,
    user_id INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (product_id) REFERENCES products(id),
    FOREIGN KEY (order_id) REFERENCES orders(id),
    FOREIGN KEY (assigned_support_id) REFERENCES users(id),
    FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS quick_replies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    support_id INTEGER,
    shortcut TEXT NOT NULL,
    message TEXT NOT NULL,
    is_global INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (support_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS conversation_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    support_id INTEGER NOT NULL,
    note TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id),
    FOREIGN KEY (support_id) REFERENCES users(id)
  );
`);

// Add role column if it doesn't exist
try {
  db.exec(`ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'customer'`);
} catch (e) {
  // Column already exists
}

// Add last_active_at column for presence tracking
try {
  db.exec(`ALTER TABLE users ADD COLUMN last_active_at TEXT`);
} catch (e) {
  // Column already exists
}

// Add is_read column to chat_messages for unread tracking
try {
  db.exec(`ALTER TABLE chat_messages ADD COLUMN is_read INTEGER DEFAULT 0`);
} catch (e) {
  // Column already exists
}

// Migrate: sync role from is_admin flag
db.prepare(`UPDATE users SET role = 'admin' WHERE is_admin = 1 AND role = 'customer'`).run();

// Seed default global quick replies
const quickReplyCount = db.prepare('SELECT COUNT(*) as count FROM quick_replies WHERE is_global = 1').get().count;
if (quickReplyCount === 0) {
  const defaults = [
    { shortcut: '/hi', message: 'Hello! Thanks for reaching out. How can I help you today?' },
    { shortcut: '/wait', message: 'Please give me a moment to look into this for you.' },
    { shortcut: '/refund', message: 'I understand your concern. Let me check your order details and help process this.' },
    { shortcut: '/delivery', message: 'Your order will be delivered to the email on your account within a few minutes. Please check spam if not received.' },
    { shortcut: '/thanks', message: 'Thank you for contacting SubStore support. Have a great day!' },
    { shortcut: '/issue', message: 'Could you please share your order/service number and a screenshot of the issue?' }
  ];
  const insertQR = db.prepare('INSERT INTO quick_replies (support_id, shortcut, message, is_global) VALUES (NULL, ?, ?, 1)');
  for (const qr of defaults) insertQR.run(qr.shortcut, qr.message);
}

// Seed admin user
const adminPhone = '00966580549057';
const existingAdmin = db.prepare('SELECT id FROM users WHERE phone = ?').get(adminPhone);
if (!existingAdmin) {
  db.prepare('INSERT INTO users (phone, name, is_admin, role) VALUES (?, ?, 1, ?)').run(adminPhone, 'Admin', 'admin');
} else {
  db.prepare('UPDATE users SET role = ?, is_admin = 1 WHERE phone = ?').run('admin', adminPhone);
}

// Seed products
const productCount = db.prepare('SELECT COUNT(*) as count FROM products').get().count;
if (productCount === 0) {
  const seedProducts = [
    {
      name: 'ChatGPT Plus',
      description: 'Unlock the full power of OpenAI\'s most advanced AI assistant. Get access to GPT-4o, image generation with DALL·E, advanced data analysis, custom GPTs, and priority access during peak times.',
      features: JSON.stringify([
        'Access to GPT-4o and latest models',
        'DALL·E image generation',
        'Advanced data analysis & file uploads',
        'Custom GPTs & GPT Store',
        'Priority access during peak times',
        'Browse the web for real-time info'
      ]),
      price: 20.00,
      image_url: '/images/chatgpt.svg',
      category: 'AI Tools',
      duration: '1 Month',
      badge: 'Most Popular'
    },
    {
      name: 'LinkedIn Premium Business',
      description: 'Elevate your professional presence with LinkedIn Premium. Get unlimited profile views, InMail messages, advanced search filters, and business insights to grow your network and career.',
      features: JSON.stringify([
        'Unlimited profile browsing',
        '15 InMail messages per month',
        'Advanced search filters',
        'Business insights & analytics',
        'Who viewed your profile (90 days)',
        'LinkedIn Learning courses included'
      ]),
      price: 59.99,
      image_url: '/images/linkedin.svg',
      category: 'Professional',
      duration: '1 Month',
      badge: 'Best for Business'
    },
    {
      name: 'YouTube Premium',
      description: 'Enjoy YouTube without interruptions. Watch ad-free videos, download content for offline viewing, play videos in the background, and get full access to YouTube Music Premium.',
      features: JSON.stringify([
        'Ad-free video watching',
        'Background play on mobile',
        'Download videos offline',
        'YouTube Music Premium included',
        'Picture-in-picture mode',
        'Access to YouTube Originals'
      ]),
      price: 13.99,
      image_url: '/images/youtube.svg',
      category: 'Entertainment',
      duration: '1 Month',
      badge: ''
    },
    {
      name: 'Spotify Premium',
      description: 'Listen to music your way with Spotify Premium. Stream over 100 million songs ad-free, download for offline listening, enjoy high-quality audio, and control your music on any device.',
      features: JSON.stringify([
        'Ad-free music streaming',
        '100M+ songs on demand',
        'Download for offline listening',
        'High-quality audio (320kbps)',
        'Play any song, any time',
        'Group Session with friends'
      ]),
      price: 10.99,
      image_url: '/images/spotify.svg',
      category: 'Entertainment',
      duration: '1 Month',
      badge: 'Best Value'
    },
    {
      name: 'Netflix Standard',
      description: 'Stream thousands of movies, TV shows, documentaries, and more on Netflix. Enjoy Full HD quality on two screens simultaneously with unlimited downloads on supported devices.',
      features: JSON.stringify([
        'Unlimited movies & TV shows',
        'Full HD (1080p) streaming',
        'Watch on 2 screens at once',
        'Download on 2 devices',
        'No ads, no interruptions',
        'New releases every week'
      ]),
      price: 15.49,
      image_url: '/images/netflix.svg',
      category: 'Entertainment',
      duration: '1 Month',
      badge: ''
    },
    {
      name: 'Microsoft 365 Personal',
      description: 'Get the full suite of Microsoft Office apps plus 1TB OneDrive cloud storage. Access Word, Excel, PowerPoint, Outlook, and more across all your devices with always up-to-date features.',
      features: JSON.stringify([
        'Word, Excel, PowerPoint, Outlook',
        '1 TB OneDrive cloud storage',
        'Install on up to 5 devices',
        'Advanced security features',
        'Microsoft Editor grammar tools',
        'Always up-to-date versions'
      ]),
      price: 9.99,
      image_url: '/images/microsoft365.svg',
      category: 'Productivity',
      duration: '1 Month',
      badge: ''
    },
    {
      name: 'Adobe Creative Cloud',
      description: 'Access the full collection of 20+ Adobe creative apps including Photoshop, Illustrator, Premiere Pro, and After Effects. Create stunning visuals, videos, and designs with industry-standard tools.',
      features: JSON.stringify([
        'Photoshop, Illustrator, Premiere Pro',
        '20+ creative applications',
        '100GB cloud storage',
        'Adobe Fonts & Portfolio',
        'Regular feature updates',
        'Cross-device sync & collaboration'
      ]),
      price: 54.99,
      image_url: '/images/adobe.svg',
      category: 'Creative',
      duration: '1 Month',
      badge: 'Professional'
    },
    {
      name: 'Canva Pro',
      description: 'Design anything with Canva Pro. Access premium templates, advanced design tools, brand kit management, background remover, and unlimited content library for all your creative needs.',
      features: JSON.stringify([
        '100M+ premium templates & photos',
        'Background remover tool',
        'Brand Kit management',
        'Magic Resize for any format',
        'Schedule social media posts',
        '1TB cloud storage'
      ]),
      price: 12.99,
      image_url: '/images/canva.svg',
      category: 'Creative',
      duration: '1 Month',
      badge: ''
    }
  ];

  const insertProduct = db.prepare(`
    INSERT INTO products (name, description, features, price, image_url, category, duration, badge)
    VALUES (@name, @description, @features, @price, @image_url, @category, @duration, @badge)
  `);

  const insertMany = db.transaction((products) => {
    for (const product of products) {
      insertProduct.run(product);
    }
  });

  insertMany(seedProducts);
}

module.exports = db;
