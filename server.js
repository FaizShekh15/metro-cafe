require('dotenv').config();
const express = require('express');
const session = require('express-session');
const SQLiteStoreFactory = require('connect-sqlite3');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DB_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DB_DIR, { recursive: true });

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  console.error('SESSION_SECRET is required and must be at least 32 characters. Copy .env.example to .env and set it.');
  process.exit(1);
}
if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD_HASH) {
  console.error('ADMIN_USERNAME and ADMIN_PASSWORD_HASH are required. See README.md.');
  process.exit(1);
}

const db = new Database(path.join(DB_DIR, 'metro-cafe.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    address TEXT NOT NULL,
    payment TEXT NOT NULL,
    items_json TEXT NOT NULL,
    total INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'New',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));

const SQLiteStore = SQLiteStoreFactory(session);
app.use(session({
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: DB_DIR, concurrentDB: true }),
  name: 'metro_cafe_admin',
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 8 * 60 * 60 * 1000
  }
}));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' }
});

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.status(401).json({ error: 'Admin sign-in required.' });
}
function cleanText(value, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

app.post('/api/admin/login', loginLimiter, async (req, res) => {
  const username = cleanText(req.body.username, 100);
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const userOk = username === process.env.ADMIN_USERNAME;
  let passOk = false;
  try { passOk = await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH); } catch (_) {}
  if (!userOk || !passOk) return res.status(401).json({ error: 'Incorrect username or password.' });
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: 'Could not start admin session.' });
    req.session.isAdmin = true;
    req.session.adminUsername = username;
    req.session.save(err2 => {
      if (err2) return res.status(500).json({ error: 'Could not save admin session.' });
      res.json({ ok: true, username });
    });
  });
});

app.post('/api/admin/logout', requireAdmin, (req, res) => {
  req.session.destroy(err => {
    res.clearCookie('metro_cafe_admin');
    if (err) return res.status(500).json({ error: 'Could not sign out.' });
    res.json({ ok: true });
  });
});

app.get('/api/admin/me', requireAdmin, (req, res) => {
  res.json({ ok: true, username: req.session.adminUsername || process.env.ADMIN_USERNAME });
});

app.get('/api/admin/orders', requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 500').all();
  res.json({ orders: rows.map(row => ({
    id: row.id,
    name: row.customer_name,
    phone: row.phone,
    address: row.address,
    payment: row.payment,
    items: JSON.parse(row.items_json),
    total: row.total,
    status: row.status,
    createdAt: row.created_at
  })) });
});

app.patch('/api/admin/orders/:id/status', requireAdmin, (req, res) => {
  const allowed = ['New', 'Accepted', 'Preparing', 'Ready', 'Out for delivery', 'Completed', 'Cancelled'];
  const status = cleanText(req.body.status, 40);
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid order status.' });
  const result = db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, Number(req.params.id));
  if (!result.changes) return res.status(404).json({ error: 'Order not found.' });
  res.json({ ok: true });
});

app.post('/api/orders', (req, res) => {
  const name = cleanText(req.body.name, 100);
  const phone = cleanText(req.body.phone, 20);
  const address = cleanText(req.body.address, 500);
  const payment = cleanText(req.body.payment, 50);
  const allowedPayments = ['Cash on Delivery', 'UPI (confirm with cafe)'];
  const inputItems = Array.isArray(req.body.items) ? req.body.items : [];
  if (!name || !phone || !address || !allowedPayments.includes(payment)) {
    return res.status(400).json({ error: 'Please provide valid customer and delivery details.' });
  }
  if (!/^[0-9+\-\s]{10,16}$/.test(phone)) return res.status(400).json({ error: 'Please enter a valid phone number.' });
  const normalizedAddress = address.normalize('NFKD').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!['lunawada', 'lunavada'].some(city => normalizedAddress.split(' ').includes(city))) {
    return res.status(400).json({ error: 'Delivery is currently available only in Lunawada / Lunavada.' });
  }
  if (inputItems.length < 1 || inputItems.length > 30) return res.status(400).json({ error: 'Cart is empty or has too many different items.' });

  // Server-owned prices prevent a browser from submitting an arbitrary total.
  const catalog = {'Coffee':50,'Milkshake':100,'Coke':50,'Latte':150,'Aloo Paratha':130,'Chicken Rice (Half)':50,'Chicken Rice (Full)':90,'Chicken Noodles (Half)':50,'Chicken Noodles (Full)':90,'Margherita Pizza':149,'Veg Burger':99,'Grilled Sandwich':89,'Chicken Shawarma':70,'Tandoori Chicken':199,'Chicken Burger':120};
  const items = [];
  for (const raw of inputItems) {
    const itemName = cleanText(raw && raw.name, 100);
    const qty = Number(raw && raw.qty);
    if (!Object.prototype.hasOwnProperty.call(catalog, itemName) || !Number.isInteger(qty) || qty < 1 || qty > 99) {
      return res.status(400).json({ error: 'One or more cart items are invalid. Please refresh the menu and try again.' });
    }
    items.push({ name: itemName, price: catalog[itemName], qty });
  }
  const total = items.reduce((sum, item) => sum + item.price * item.qty, 0);
  const insert = db.prepare(`INSERT INTO orders (customer_name, phone, address, payment, items_json, total)
    VALUES (?, ?, ?, ?, ?, ?)`);
  const result = insert.run(name, phone, address, payment, JSON.stringify(items), total);
  const row = db.prepare('SELECT id, created_at, status FROM orders WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ order: { id: `UC${String(row.id).padStart(6, '0')}`, createdAt: row.created_at, status: row.status, total } });
});

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Metro Cafe running on port ${PORT}`);
});
