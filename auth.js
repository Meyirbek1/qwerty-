'use strict';
// Аккаунттар: scrypt-хэш + қол қойылған HttpOnly cookie. Тәуелділіксіз, дерекқор — data/users.json
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const dir = () => process.env.DATA_DIR || path.join(__dirname, 'data');
const file = () => path.join(dir(), 'users.json');
let SECRET;
function secret() {
  if (SECRET) return SECRET;
  if (process.env.SESSION_SECRET) return (SECRET = process.env.SESSION_SECRET);
  const f = path.join(dir(), 'secret.txt'); fs.mkdirSync(dir(), { recursive: true });
  try { SECRET = fs.readFileSync(f, 'utf8').trim(); } catch (_) { SECRET = crypto.randomBytes(32).toString('hex'); fs.writeFileSync(f, SECRET); }
  return SECRET;
}
const load = () => { try { return JSON.parse(fs.readFileSync(file(), 'utf8')); } catch (_) { return []; } };
const save = (u) => { fs.mkdirSync(dir(), { recursive: true }); const t = file() + '.tmp'; fs.writeFileSync(t, JSON.stringify(u, null, 2)); fs.renameSync(t, file()); };
const hash = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString('hex');
const pub = (u) => ({ id: u.id, name: u.name, email: u.email });
const same = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };

function register(name, email, pw) {
  name = String(name || '').trim(); email = String(email || '').trim().toLowerCase(); pw = String(pw || '');
  if (name.length < 2 || name.length > 40) return { err: 'name' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 120) return { err: 'email' };
  if (pw.length < 6 || pw.length > 100) return { err: 'pass' };
  const users = load(); if (users.some(u => u.email === email)) return { err: 'exists' };
  const salt = crypto.randomBytes(16).toString('hex');
  const u = { id: crypto.randomBytes(8).toString('hex'), name, email, salt, hash: hash(pw, salt), created: Date.now() };
  users.push(u); save(users); return { user: pub(u) };
}
function login(email, pw) {
  email = String(email || '').trim().toLowerCase();
  const u = load().find(x => x.email === email);
  if (!u || !same(hash(String(pw || ''), u.salt), u.hash)) return { err: 'login' };
  return { user: pub(u) };
}
const sign = (uid) => { const p = uid + '.' + (Date.now() + 7 * 864e5); return p + '.' + crypto.createHmac('sha256', secret()).update(p).digest('hex'); };
function userFrom(req) {
  const m = /(?:^|;\s*)sid=([^;]+)/.exec(req.headers.cookie || ''); if (!m) return null;
  const [uid, exp, sig] = m[1].split('.'); if (!sig || +exp < Date.now()) return null;
  if (!same(sig, crypto.createHmac('sha256', secret()).update(uid + '.' + exp).digest('hex'))) return null;
  const u = load().find(x => x.id === uid); return u ? pub(u) : null;
}
const cookie = (uid) => `sid=${uid ? sign(uid) : ''}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${uid ? 604800 : 0}`;
module.exports = { register, login, userFrom, cookie };
