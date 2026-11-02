import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
const PORT = 3999, B = `http://localhost:${PORT}`, DIR = fs.mkdtempSync('/tmp/oyu-'), CID = 'test-client.apps.googleusercontent.com';
const kp = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }), other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...kp.publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
let srv, jwksSrv, w3Srv, hookSrv, admin;
const hooks = []; let failHooks = false;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function token(over = {}, key = kp.privateKey) { const d = b64({ alg: 'RS256', kid: 'k1' }) + '.' + b64({ iss: 'https://accounts.google.com', aud: CID, sub: 's1', email: 'a@x.com', email_verified: true, name: 'Ann', exp: Math.floor(Date.now() / 1000) + 3600, ...over }); return d + '.' + crypto.sign('RSA-SHA256', Buffer.from(d), key).toString('base64url'); }
before(async () => {
  hookSrv = http.createServer((q, r) => { let b = ''; q.on('data', (c) => (b += c)); q.on('end', () => {
    if (q.url.endsWith('/getUpdates')) return r.end(JSON.stringify({ ok: true, result: [{ update_id: 1, message: { chat: { id: 555, first_name: 'Bat', type: 'private' } } }, { update_id: 2, message: { chat: { id: 555, first_name: 'Bat' } } }] }));
    if (q.url === '/_fail') { failHooks = true; return r.end('ok'); } if (q.url === '/_ok') { failHooks = false; return r.end('ok'); }
    if (failHooks) { r.statusCode = 500; return r.end('{}'); } hooks.push({ url: q.url, body: JSON.parse(b || '{}') }); r.setHeader('Content-Type', 'application/json'); r.end('{"ok":true}'); }); }).listen(3993);
  w3Srv = http.createServer((q, r) => { const u = new URL(q.url, 'http://x'), i = u.searchParams.get('input') || ''; r.setHeader('Content-Type', 'application/json');
    if (u.searchParams.get('key') !== 'w3key') { r.statusCode = 401; return r.end('{}'); }
    if (i.startsWith('down.server')) { r.statusCode = 500; return r.end('{}'); }
    const all = [{ words: 'filled.count.soap', nearestPlace: 'Ulaanbaatar, Ulaanbaatar', country: 'MN' }, { words: 'filled.count.soup', nearestPlace: 'Darkhan', country: 'MN' }];
    r.end(JSON.stringify({ suggestions: all.filter((x) => x.words.startsWith(i)) })); }).listen(3995);
  jwksSrv = http.createServer((q, r) => { r.setHeader('Content-Type', 'application/json'); r.end(JSON.stringify({ keys: [jwk] })); }).listen(3998);
  srv = spawn('node', ['--disable-warning=ExperimentalWarning', 'server.js'], { env: { ...process.env, PORT, DATA_DIR: DIR, ADMIN_PASSWORD: 'testpass123', GOOGLE_CLIENT_ID: CID, GOOGLE_JWKS_URL: 'http://localhost:3998/certs', W3W_API_KEY: 'w3key', W3W_API_URL: 'http://localhost:3995', TELEGRAM_BOT_TOKEN: 'tgtoken', TELEGRAM_CHAT_ID: '4242', TELEGRAM_API_URL: 'http://localhost:3993', NTFY_TOPIC: 'oyu-test-topic', NTFY_SERVER: 'http://localhost:3993', PUBLIC_URL: 'https://shop.example' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(B + '/api/products'); return; } catch { await new Promise((r) => setTimeout(r, 100)); } }
});
after(() => { srv.kill(); jwksSrv.close(); w3Srv.close(); hookSrv.close(); fs.rmSync(DIR, { recursive: true, force: true }); });
async function call(method, path, body, cookie) { const r = await fetch(B + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined }); const sc = r.headers.getSetCookie?.() || []; return { status: r.status, json: await r.json(), cookie: sc.map((c) => c.split(';')[0]).join('; ') }; }
const google = (over, key) => call('POST', '/api/auth/google', { credential: token(over, key) });
const loc = { phone: '9911 2233', address: 'Peace Avenue 12, building 4, floor 3', words: '///Filled.Count.Soap' };
let ann;
test('Google sign-in accepts only valid tokens', async () => {
  assert.equal((await call('POST', '/api/auth/google', { credential: 'junk' })).status, 401);
  assert.equal((await google({ aud: 'someone-else' })).status, 401);
  assert.equal((await google({ exp: 1 })).status, 401);
  assert.equal((await google({ email_verified: false })).status, 401);
  assert.equal((await google({ iss: 'https://evil.example' })).status, 401);
  assert.equal((await google({}, other.privateKey)).status, 401); // wrong signature
  const r = await google({}); assert.equal(r.status, 200); assert.equal(r.json.user.email, 'a@x.com'); ann = r.cookie;
  assert.equal((await call('GET', '/api/me', null, ann)).json.user.name, 'Ann');
  assert.equal((await google({})).status, 200); // same Google account signs in again
});
test('admin login and permissions', async () => {
  assert.equal((await call('POST', '/api/admin/login', { password: 'nope' })).status, 401);
  assert.equal((await call('GET', '/api/admin/orders')).status, 401);
  assert.equal((await call('GET', '/api/admin/orders', null, ann)).status, 401);
  admin = (await call('POST', '/api/admin/login', { password: 'testpass123' })).cookie; assert.ok(admin);
});
test('order needs sign-in and phone, ignores client prices, decrements stock, links what3words', async () => {
  const p = (await call('GET', '/api/products')).json.find((x) => x.sizes.length && x.stock >= 3);
  const items = [{ id: p.id, size: p.sizes[0], qty: 2, price: 1 }];
  assert.equal((await call('POST', '/api/orders', { items, ...loc })).status, 401);
  assert.equal((await call('POST', '/api/orders', { items, ...loc, phone: '' }, ann)).status, 400);
  assert.equal((await call('POST', '/api/orders', { items: [{ id: p.id, qty: 1 }], ...loc }, ann)).status, 400); // size required
  const r = await call('POST', '/api/orders', { items, ...loc }, ann);
  assert.equal(r.status, 201); assert.equal(r.json.total, (p.sale ?? p.price) * 2); assert.equal(r.json.mapsUrl, 'https://what3words.com/filled.count.soap'); assert.equal(r.json.words, 'filled.count.soap');
  assert.equal(r.json.phone, '+97699112233'); assert.equal(r.json.email, 'a@x.com');
  assert.equal((await call('GET', '/api/products')).json.find((x) => x.id === p.id).stock, p.stock - 2);
  assert.equal((await call('GET', '/api/orders', null, ann)).json.length, 1);
  assert.equal((await call('GET', '/api/admin/orders', null, admin)).json[0].email, 'a@x.com');
  await call('PUT', `/api/admin/orders/${r.json.id}/status`, { status: 'CANCELLED' }, admin);
  assert.equal((await call('GET', '/api/products')).json.find((x) => x.id === p.id).stock, p.stock);
  assert.equal((await call('PUT', `/api/admin/orders/${r.json.id}/status`, { status: 'PENDING' }, admin)).status, 409);
});
test('concurrent orders cannot oversell', async () => {
  const p = (await call('GET', '/api/admin/products', null, admin)).json.find((x) => x.sizes.length);
  await call('PUT', `/api/admin/products/${p.id}`, { ...p, stock: 1 }, admin);
  const users = await Promise.all([1, 2, 3, 4].map((i) => google({ sub: 'c' + i, email: `c${i}@x.com`, name: 'C' + i })));
  const rs = await Promise.all(users.map((u) => call('POST', '/api/orders', { items: [{ id: p.id, size: p.sizes[0], qty: 1 }], ...loc }, u.cookie)));
  assert.equal(rs.filter((r) => r.status === 201).length, 1); assert.equal(rs.filter((r) => r.status === 409).length, 3);
});
test('admin validation, stats and customers', async () => {
  assert.equal((await call('POST', '/api/admin/products', { name: 'X', type: 'top', price: 100, sale: 200, stock: 1 }, admin)).status, 400);
  const s = (await call('GET', '/api/admin/stats', null, admin)).json; assert.ok(s.orders >= 1 && s.customers === 5);
  assert.equal((await call('GET', '/api/admin/customers', null, admin)).json[0].email.includes('@'), true);
});
const PNG = 'data:image/png;base64,' + Buffer.from('fake-png-bytes').toString('base64');
test('product photos, description and detail page', async () => {
  const body = { name: 'Gallery Coat', type: 'top', price: 90000, stock: 5, sizes: ['S', 'M'], description: 'Warm coat.', images: [PNG, PNG + 'A', PNG + 'B'] };
  assert.equal((await call('POST', '/api/admin/products', { ...body, images: ['http://evil.example/x.png'] }, admin)).status, 400);
  assert.equal((await call('POST', '/api/admin/products', { ...body, images: Array(7).fill(PNG) }, admin)).status, 400);
  const c = await call('POST', '/api/admin/products', body, admin); assert.equal(c.status, 201); assert.equal(c.json.images.length, 3);
  const id = c.json.id;
  const list = (await call('GET', '/api/products')).json.find((x) => x.id === id); assert.ok(list.img.startsWith(`/img/${id}/0`)); assert.equal(list.images, undefined);
  const d = (await call('GET', `/api/products/${id}`)).json; assert.equal(d.images.length, 3); assert.equal(d.description, 'Warm coat.');
  const img = await fetch(B + d.images[0]); assert.equal(img.status, 200); assert.equal(img.headers.get('content-type'), 'image/png'); assert.equal(Buffer.from(await img.arrayBuffer()).toString(), 'fake-png-bytes');
  // edit: keep photos 1 and 3 (by URL), drop photo 2, change description
  const u = await call('PUT', `/api/admin/products/${id}`, { ...c.json, images: [c.json.images[2], c.json.images[0]], description: 'Updated.' }, admin);
  assert.equal(u.status, 200); assert.equal(u.json.images.length, 2); assert.equal(u.json.description, 'Updated.');
  const first = await fetch(B + u.json.images[0]); assert.equal(Buffer.from(await first.arrayBuffer()).toString(), 'fake-png-bytesB'.length ? Buffer.from((PNG + 'B').split(',')[1], 'base64').toString() : '');
  await call('PUT', `/api/admin/products/${id}`, { ...u.json, status: 'Draft' }, admin);
  assert.equal((await call('GET', `/api/products/${id}`)).status, 404); // drafts are not public
  assert.equal((await fetch(B + '/img/999999/0')).status, 404);
});
test('what3words address and address details are both required and checked', async () => {
  const p = (await call('GET', '/api/products')).json.find((x) => !x.sizes.length && x.stock >= 3);
  const items = [{ id: p.id, qty: 1 }], order = (extra) => call('POST', '/api/orders', { items, ...loc, ...extra }, ann);
  assert.equal((await order({ words: '' })).status, 400); // missing
  assert.equal((await order({ words: 'only.two' })).status, 400); // wrong format
  assert.equal((await order({ words: 'not.a.number1' })).status, 400);
  const nf = await order({ words: 'nothing.such.here' }); assert.equal(nf.status, 400); assert.match(nf.json.error, /not found/); // what3words says it does not exist
  assert.equal((await order({ address: 'x' })).status, 400); // address details still required
  assert.equal((await order({ words: 'down.server.now' })).status, 201); // what3words is down: the order is still accepted
  assert.equal((await order({})).status, 201);
});
test('what3words suggestions come through the server (key stays hidden)', async () => {
  const s = (await call('GET', '/api/w3w/suggest?input=filled.count.so')).json; assert.equal(s.enabled, true);
  assert.deepEqual(s.items.map((x) => x.words), ['filled.count.soap', 'filled.count.soup']); assert.equal(s.items[0].place, 'Ulaanbaatar, Ulaanbaatar');
  assert.deepEqual((await call('GET', '/api/w3w/suggest?input=ab')).json.items, []);
  assert.equal((await call('GET', '/api/w3w/suggest?input=down.server.now')).json.unavailable, true);
  assert.ok(!JSON.stringify(s).includes('w3key'));
});
const waitFor = async (fn, ms = 4000) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await new Promise((r) => setTimeout(r, 50)); } return false; };
test('phone notifications: sent on checkout, short by default, and never block an order', async () => {
  const p = (await call('GET', '/api/products')).json.find((x) => !x.sizes.length && x.stock >= 3), items = [{ id: p.id, qty: 1 }];
  hooks.length = 0;
  const r = await call('POST', '/api/orders', { items, ...loc }, ann); assert.equal(r.status, 201);
  assert.ok(await waitFor(() => hooks.length >= 2)); const tg = hooks.find((h) => h.url.startsWith('/bottgtoken/sendMessage')), nt = hooks.find((h) => h.url === '/');
  assert.equal(tg.body.chat_id, '4242'); assert.ok(tg.body.text.includes(r.json.number)); assert.ok(tg.body.text.includes('Open: https://shop.example/admin'));
  assert.ok(!tg.body.text.includes('9911') && !tg.body.text.includes('Peace Avenue')); // short mode keeps phone and address out of third-party servers
  assert.equal(nt.body.topic, 'oyu-test-topic'); assert.equal(nt.body.click, 'https://shop.example/admin');
  await fetch(B + '/../_fail').catch(() => {}); await fetch('http://localhost:3993/_fail');
  const r2 = await call('POST', '/api/orders', { items, ...loc }, ann); assert.equal(r2.status, 201); // channel down: the order still succeeds
  const test = await call('POST', '/api/admin/notify-test', {}, admin); assert.equal(test.status, 200); assert.ok(test.json.results.every((x) => x.ok === false));
  await fetch('http://localhost:3993/_ok');
  assert.equal((await call('POST', '/api/admin/notify-test', {})).status, 401);
  const ok = await call('POST', '/api/admin/notify-test', {}, admin); assert.ok(ok.json.results.length === 2 && ok.json.results.every((x) => x.ok));
  assert.deepEqual((await call('GET', '/api/admin/stats', null, admin)).json.notify, { telegram: true, telegramToken: true, ntfy: true, full: false });
});
test('Telegram helper finds the chat id for the admin only', async () => {
  assert.equal((await call('GET', '/api/admin/telegram-chats')).status, 401);
  const r = await call('GET', '/api/admin/telegram-chats', null, admin); assert.equal(r.status, 200);
  assert.deepEqual(r.json.chats, [{ id: '555', name: 'Bat' }]); // duplicates removed
});
