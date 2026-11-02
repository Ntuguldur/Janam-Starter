// ????? ??????? store server: zero dependencies, Node 22.5+, SQLite file database.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = +process.env.PORT || 3000;
const DATA = process.env.DATA_DIR || path.join(here, 'data');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const ADMIN_PATH = process.env.ADMIN_PATH || '/manage-7f3c9a2e8b6d4f1a0c5e9b7d3a6f2c8e';
if (ADMIN_PASSWORD.length < 8) { console.error('Set ADMIN_PASSWORD to at least 8 characters.'); process.exit(1); }
if (!/^\/[a-zA-Z0-9_-]{16,100}$/.test(ADMIN_PATH)) { console.error('ADMIN_PATH must be a slash followed by 16–100 letters, numbers, underscores, or hyphens.'); process.exit(1); }
fs.mkdirSync(DATA, { recursive: true });
const db = new DatabaseSync(path.join(DATA, 'oyu.db'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, google_sub TEXT UNIQUE, email TEXT, name TEXT NOT NULL, phone TEXT, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY, user_id INTEGER, admin INTEGER NOT NULL DEFAULT 0, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, price INTEGER NOT NULL CHECK(price>0), sale INTEGER CHECK(sale IS NULL OR sale>0), stock INTEGER NOT NULL DEFAULT 0 CHECK(stock>=0), sizes TEXT NOT NULL DEFAULT '[]', img TEXT, status TEXT NOT NULL DEFAULT 'Active', demo INTEGER NOT NULL DEFAULT 0, description TEXT NOT NULL DEFAULT '', images TEXT NOT NULL DEFAULT '[]', updated INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS categories(id INTEGER PRIMARY KEY, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY, number TEXT UNIQUE NOT NULL, user_id INTEGER NOT NULL, phone TEXT NOT NULL, email TEXT, name TEXT NOT NULL, address TEXT NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL, words TEXT, note TEXT, status TEXT NOT NULL DEFAULT 'PENDING', total INTEGER NOT NULL, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS order_items(id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id), product_id INTEGER, name TEXT NOT NULL, size TEXT, price INTEGER NOT NULL, qty INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS ix_orders_user ON orders(user_id, created);
CREATE INDEX IF NOT EXISTS ix_orders_status ON orders(status, created);`);

// Upgrade databases created by the earlier phone-sign-up version (old customers and orders are kept).
if (!db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'google_sub')) {
  db.exec(`BEGIN; ALTER TABLE users RENAME TO users_old;
  CREATE TABLE users(id INTEGER PRIMARY KEY, google_sub TEXT UNIQUE, email TEXT, name TEXT NOT NULL, phone TEXT, created INTEGER NOT NULL);
  INSERT INTO users(id,name,phone,created) SELECT id,name,phone,created FROM users_old; DROP TABLE users_old; COMMIT;`);
}
if (!db.prepare('PRAGMA table_info(orders)').all().some((c) => c.name === 'email')) db.exec('ALTER TABLE orders ADD COLUMN email TEXT');
if (!db.prepare('PRAGMA table_info(orders)').all().some((c) => c.name === 'words')) db.exec('ALTER TABLE orders ADD COLUMN words TEXT');

// Upgrade: product descriptions and photo galleries (old single images become the first gallery photo).
for (const [col, ddl] of [['description', "TEXT NOT NULL DEFAULT ''"], ['images', "TEXT NOT NULL DEFAULT '[]'"], ['updated', 'INTEGER NOT NULL DEFAULT 0']]) if (!db.prepare('PRAGMA table_info(products)').all().some((c) => c.name === col)) db.exec(`ALTER TABLE products ADD COLUMN ${col} ${ddl}`);
db.exec("UPDATE products SET images=json_array(img), img=NULL WHERE images='[]' AND img IS NOT NULL");
db.exec("UPDATE products SET description=name||' from the \u0416\u0430\u043d\u0430\u043c \u0441\u0442\u0430\u0440\u0442\u0435\u0440 collection. Soft, comfortable and easy to style.' WHERE demo=1 AND description=''");

const TYPES = ['dress', 'top', 'pants', 'bag', 'shoe'];
const CATEGORY_NAMES = {dress:'\u042f\u043f\u043e\u043d',top:'\u0425\u044f\u0442\u0430\u0434',pants:'\u0421\u043e\u043b\u043e\u043d\u0433\u043e\u0441',bag:'\u0410\u043c\u0435\u0440\u0438\u043a',shoe:'\u0415\u0432\u0440\u043e\u043f'};
if (!db.prepare('SELECT 1 FROM categories LIMIT 1').get()) for (const type of TYPES) db.prepare('INSERT INTO categories(slug,name) VALUES(?,?)').run(type,CATEGORY_NAMES[type]);
// The requested five origin categories combine the old Accessories category into Europe.
if (db.prepare("SELECT 1 FROM categories WHERE slug='acc' AND name='Accessories'").get()) {
  db.prepare("UPDATE products SET type='shoe' WHERE type='acc'").run();
  db.prepare("DELETE FROM categories WHERE slug='acc'").run();
}
for (const [slug,name] of Object.entries(CATEGORY_NAMES)) db.prepare('UPDATE categories SET name=? WHERE slug=?').run(name,slug);
const SIZES = { dress: [], top: [], pants: [], shoe: [], bag: [] };
const NAMES = { dress: ['Satin Slip Midi Dress','Floral Wrap Dress'], top: ['Ribbed Knit Top','Oversized Poplin Shirt'], pants: ['Wide-Leg Trousers','High-Rise Straight Jeans'], bag: ['Mini Shoulder Bag','Canvas Tote Bag'], shoe: ['Leather Chunky Sneakers','Suede Ankle Boots'] };
if (!db.prepare('SELECT 1 FROM products LIMIT 1').get()) { // demo data, flagged demo=1
  let n = 0;
  for (const t of TYPES) for (const name of NAMES[t]) { n++; const price = 19000 + (n * 7000) % 60000;
    db.prepare('INSERT INTO products(name,type,price,sale,stock,sizes,description,demo,created) VALUES(?,?,?,?,?,?,?,1,?)').run(name, t, price, n % 3 === 0 ? Math.round(price * .7) : null, 4 + (n * 5) % 20, JSON.stringify(SIZES[t]), name + ' from the \u0416\u0430\u043d\u0430\u043c \u0441\u0442\u0430\u0440\u0442\u0435\u0440 collection. Soft, comfortable and easy to style.', Date.now()); }
}

const now = () => Date.now();
class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const bad = (m, c = 400) => { throw new HttpError(c, m); };
const send = (res, code, obj, extra = {}) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra }); res.end(JSON.stringify(obj)); };
async function readBody(req) { let n = 0; const ch = []; for await (const c of req) { n += c.length; if (n > 5e6) bad('Request too large.', 413); ch.push(c); } try { return JSON.parse(Buffer.concat(ch).toString() || '{}'); } catch { return bad('Invalid JSON.'); } }
const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((s) => s.trim().split('=')).filter((a) => a[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hits = new Map();
function limit(key, max, ms) { const t = now(), a = (hits.get(key) || []).filter((x) => t - x < ms); a.push(t); hits.set(key, a); if (a.length > max) bad('Too many attempts. Please try again later.', 429); }
const ip = (req) => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

function startSession(req, res, userId, admin) {
  const token = crypto.randomBytes(32).toString('hex'), days = admin ? 1 : 30;
  db.prepare('INSERT INTO sessions(hash,user_id,admin,expires) VALUES(?,?,?,?)').run(sha(token), userId, admin ? 1 : 0, now() + days * 864e5);
  const secure = req.headers['x-forwarded-proto'] === 'https' || process.env.NODE_ENV === 'production' ? '; Secure' : '';
  const c = `${admin ? 'adm' : 'sid'}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${days * 86400}${secure}`;
  const prev = res.getHeader('Set-Cookie'); res.setHeader('Set-Cookie', prev ? [].concat(prev, c) : c);
}
function session(req, name, admin) { const t = cookies(req)[name]; if (!t) return null; return db.prepare('SELECT * FROM sessions WHERE hash=? AND admin=? AND expires>?').get(sha(t), admin ? 1 : 0, now()) || null; }
function needAdmin(req) { if (!session(req, 'adm', true)) bad('Admin sign-in required.', 401); }

const pub = (r, full) => { const urls = JSON.parse(r.images || '[]').map((_, i) => `/img/${r.id}/${i}?v=${r.updated}`); return { id: r.id, name: r.name, type: r.type, stock: r.stock, img: urls[0] || null, status: r.status, demo: !!r.demo, ...(full ? { images: urls, description: r.description } : {}) }; };
const int = (v) => (Number.isInteger(v) ? v : null);
function imagesIn(list, id) {
  if (!Array.isArray(list) || list.length > 6) bad('Add up to 6 photos.');
  const old = id ? JSON.parse(db.prepare('SELECT images FROM products WHERE id=?').get(id)?.images || '[]') : [];
  return list.map((x) => {
    x = String(x); const m = x.match(/^\/img\/(\d+)\/(\d+)/);
    if (m && id && +m[1] === id && old[+m[2]]) return old[+m[2]]; // keep an existing photo
    if (!/^data:image\/(jpeg|png|webp);base64,/.test(x) || x.length > 900000) bad('Each photo must be a JPEG, PNG or WebP under about 600 KB.');
    return x;
  });
}
function prodIn(b, id) {
  const name = String(b.name || '').trim(); if (!name || name.length > 120) bad('Product name is required (max 120 characters).');
  if (!db.prepare('SELECT 1 FROM categories WHERE slug=?').get(b.type)) bad('Choose a valid product category.');
  const price = id ? db.prepare('SELECT price FROM products WHERE id=?').get(id).price : 1;
  const sale = null;
  const stock = int(b.stock); if (stock === null || stock < 0) bad('Stock must be 0 or more.');
  const sizes = [];
  const cur = id ? db.prepare('SELECT images,description FROM products WHERE id=?').get(id) : null;
  const description = b.description === undefined && cur ? cur.description : String(b.description || '').trim(); if (description.length > 2000) bad('Description can be up to 2000 characters.');
  const images = b.images === undefined && cur ? JSON.parse(cur.images) : imagesIn(b.images ?? [], id);
  const status = b.status || 'Active'; if (!['Active', 'Draft', 'Archived'].includes(status)) bad('Invalid status.');
  return [name, b.type, price, sale, stock, JSON.stringify(sizes), status, description, JSON.stringify(images)];
}
async function api(req, res, p, m) {
  if (m !== 'GET' && m !== 'DELETE' && !(req.headers['content-type'] || '').includes('application/json')) bad('Content-Type must be application/json.', 415);
  if (p === '/api/products' && m === 'GET') return send(res, 200, db.prepare("SELECT * FROM products WHERE status='Active' ORDER BY id").all().map((r) => pub(r)));
  if (p === '/api/categories' && m === 'GET') return send(res, 200, db.prepare('SELECT slug,name FROM categories ORDER BY id').all());
  { const d = p.match(/^\/api\/products\/(\d+)$/); if (d && m === 'GET') { const r = db.prepare("SELECT * FROM products WHERE id=? AND status='Active'").get(+d[1]); if (!r) bad('Product not found.', 404); return send(res, 200, pub(r, true)); } }
  if (p === '/api/logout' && m === 'POST') { const t = cookies(req); if (t.adm) db.prepare('DELETE FROM sessions WHERE hash=?').run(sha(t.adm)); res.setHeader('Set-Cookie', 'adm=; Path=/; Max-Age=0'); return send(res, 200, { ok: true }); }
  // ---- admin ----
  if (p === '/api/admin/login' && m === 'POST') {
    limit('adm' + ip(req), 8, 9e5); const b = await readBody(req), a = Buffer.from(sha(String(b.password || ''))), c = Buffer.from(sha(ADMIN_PASSWORD));
    if (!crypto.timingSafeEqual(a, c)) bad('Wrong password.', 401); startSession(req, res, null, true); return send(res, 200, { ok: true });
  }
  if (p === '/api/admin/me' && m === 'GET') return send(res, 200, { admin: !!session(req, 'adm', true) });
  if (p.startsWith('/api/admin/')) {
    needAdmin(req);
    if (p === '/api/admin/products' && m === 'GET') return send(res, 200, db.prepare('SELECT * FROM products ORDER BY id DESC').all().map((r) => pub(r, true)));
    if (p === '/api/admin/categories' && m === 'GET') return send(res, 200, db.prepare('SELECT slug,name FROM categories ORDER BY id').all());
    if (p === '/api/admin/categories' && m === 'POST') {
      const name=String((await readBody(req)).name||'').trim(); if(!name||name.length>40) bad('Category name is required (max 40 characters).');
      const slug=name.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40); if(!slug) bad('Use a category name with letters or numbers.');
      if(db.prepare('SELECT 1 FROM categories WHERE slug=?').get(slug)) bad('That category already exists.');
      db.prepare('INSERT INTO categories(slug,name) VALUES(?,?)').run(slug,name); return send(res,201,{slug,name});
    }
    { const c=p.match(/^\/api\/admin\/categories\/([a-z0-9-]+)$/); if(c&&m==='DELETE') { const slug=c[1]; if(!db.prepare('SELECT 1 FROM categories WHERE slug=?').get(slug)) bad('Category not found.',404); if(db.prepare('SELECT 1 FROM products WHERE type=? LIMIT 1').get(slug)) bad('Move or delete products in this category before removing it.'); db.prepare('DELETE FROM categories WHERE slug=?').run(slug); return send(res,200,{ok:true}); } }
    if (p === '/api/admin/products' && m === 'POST') { const v = prodIn(await readBody(req), null); const r = db.prepare('INSERT INTO products(name,type,price,sale,stock,sizes,status,description,images,updated,created) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(...v, now(), now()); return send(res, 201, pub(db.prepare('SELECT * FROM products WHERE id=?').get(r.lastInsertRowid), true)); }
    let mm = p.match(/^\/api\/admin\/products\/(\d+)$/);
    if (mm && m === 'PUT') { const id = +mm[1]; if (!db.prepare('SELECT 1 FROM products WHERE id=?').get(id)) bad('Product not found.', 404); const v = prodIn(await readBody(req), id); db.prepare('UPDATE products SET name=?,type=?,price=?,sale=?,stock=?,sizes=?,status=?,description=?,images=?,updated=? WHERE id=?').run(...v, now(), id); return send(res, 200, pub(db.prepare('SELECT * FROM products WHERE id=?').get(id), true)); }
    if (mm && m === 'DELETE') { db.prepare('DELETE FROM products WHERE id=?').run(+mm[1]); return send(res, 200, { ok: true }); }
    if (p === '/api/admin/stats' && m === 'GET') return send(res, 200, { products: db.prepare('SELECT COUNT(*) v FROM products').get().v, lowStock: db.prepare("SELECT id,name,stock FROM products WHERE stock<=5 AND status='Active' ORDER BY stock").all() });
  }
  return bad('Not found.', 404);
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon' };
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Referrer-Policy', 'same-origin');
  try {
    const url = new URL(req.url, 'http://x'), p = decodeURIComponent(url.pathname);
    if (p.startsWith('/api/')) return await api(req, res, p, req.method);
    const mi = p.match(/^\/img\/(\d+)\/(\d+)$/);
    if (mi) { // product photos are stored in the database and served with long caching (URL changes when edited)
      const row = db.prepare('SELECT images FROM products WHERE id=?').get(+mi[1]), d = row && JSON.parse(row.images)[+mi[2]], mt = d && d.match(/^data:(image\/(?:jpeg|png|webp));base64,([\s\S]+)$/);
      if (!mt) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': mt[1], 'Cache-Control': 'public, max-age=31536000, immutable' }); return res.end(Buffer.from(mt[2], 'base64'));
    }
    // The dashboard is only served at the configured hard-to-guess path.
    if (p === '/admin' || p === '/admin.html') { res.writeHead(404); return res.end('Not found'); }
    const root = path.join(here, 'public'); let f = path.join(root, p === '/' ? 'index.html' : p === ADMIN_PATH ? 'admin.html' : p);
    // Serve the storefront for clean client-side routes such as /new and /product/123.
    if (!fs.existsSync(f) && req.method === 'GET' && !path.extname(p)) f = path.join(root, 'index.html');
    if (!f.startsWith(root + path.sep) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': f.endsWith('.html') ? 'no-cache' : 'public, max-age=3600' }); fs.createReadStream(f).pipe(res);
  } catch (e) { if (e instanceof HttpError) return send(res, e.code, { error: e.message }); console.error(e); send(res, 500, { error: 'Something went wrong. Please try again.' }); }
});
setInterval(() => db.prepare('DELETE FROM sessions WHERE expires<?').run(now()), 36e5).unref();
server.listen(PORT, () => console.log(`????? ??????? store running on port ${PORT}`));
