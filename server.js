'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
try { for (const l of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]; } } catch (_) {}
const { analyze } = require('./analyzer'); const auth = require('./auth');
const PUB = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const buckets = {};
const limited = (k, ip, max) => { const b = buckets[k] = buckets[k] || new Map(), n = Date.now(), a = (b.get(ip) || []).filter(t => n - t < 60000); a.push(n); b.set(ip, a); return a.length > max; };
const MSG = { short: ['Мәтін тым қысқа (кемінде 20 таңба).', 'Текст слишком короткий (минимум 20 символов).'], long: ['Мәтін тым ұзын (5000 таңбаға дейін).', 'Текст слишком длинный (до 5000 символов).'],
  rate: ['Сұраныс тым жиі. Бір минут күтіңіз.', 'Слишком много запросов. Подождите минуту.'], bad: ['Қате сұраныс.', 'Некорректный запрос.'],
  auth: ['Талдау үшін аккаунтқа кіріңіз.', 'Для анализа войдите в аккаунт.'], name: ['Атыңыз 2–40 таңба болуы керек.', 'Имя должно быть от 2 до 40 символов.'],
  email: ['Email дұрыс емес.', 'Некорректный email.'], pass: ['Құпиясөз кемінде 6 таңба.', 'Пароль минимум 6 символов.'],
  exists: ['Бұл email тіркелген.', 'Этот email уже зарегистрирован.'], login: ['Email немесе құпиясөз қате.', 'Неверный email или пароль.'] };
const m = (k, lang) => MSG[k][lang === 'ru' ? 1 : 0];
const send = (res, c, o, h) => { res.writeHead(c, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...(h || {}) }); res.end(JSON.stringify(o)); };
function body(req, res, cb) {
  let b = '', over = false;
  req.on('data', c => { b += c; if (b.length > 30000) { over = true; req.destroy(); } });
  req.on('end', () => { if (over) return; try { cb(JSON.parse(b) || {}); } catch (_) { send(res, 400, { error: m('bad', 'kk') + ' / ' + m('bad', 'ru') }); } });
}

function createServer() {
  return http.createServer((req, res) => {
    const url = req.url.split('?')[0], ip = req.socket.remoteAddress;
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'GET' && url === '/api/health') return send(res, 200, { ok: true, provider: process.env.AI_PROVIDER || 'demo' });
    if (req.method === 'GET' && url === '/api/me') { const u = auth.userFrom(req); return u ? send(res, 200, { user: u }) : send(res, 401, { error: 'auth' }); }
    if (req.method === 'POST' && url === '/api/logout') return send(res, 200, { ok: true }, { 'Set-Cookie': auth.cookie(null) });
    if (req.method === 'POST' && (url === '/api/register' || url === '/api/login')) return body(req, res, j => {
      const lang = j.lang === 'ru' ? 'ru' : 'kk';
      if (limited('auth', ip, 10)) return send(res, 429, { error: m('rate', lang) });
      const r = url === '/api/login' ? auth.login(j.email, j.password) : auth.register(j.name, j.email, j.password);
      if (r.err) return send(res, r.err === 'exists' ? 409 : r.err === 'login' ? 401 : 400, { error: m(r.err, lang) });
      send(res, 200, { user: r.user }, { 'Set-Cookie': auth.cookie(r.user.id) });
    });
    if (req.method === 'POST' && url === '/api/analyze') return body(req, res, async j => {
      const lang = j.lang === 'ru' ? 'ru' : 'kk', text = typeof j.text === 'string' ? j.text.trim() : '';
      if (!auth.userFrom(req)) return send(res, 401, { error: m('auth', lang), code: 'auth' });
      if (limited('an', ip, +process.env.RATE_LIMIT || 12)) return send(res, 429, { error: m('rate', lang) });
      if (text.length < 20) return send(res, 400, { error: m('short', lang) });
      if (text.length > 5000) return send(res, 400, { error: m('long', lang) });
      try { send(res, 200, await analyze(text, lang)); } catch (e) { send(res, 500, { error: m('bad', lang) }); }
    });
    if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
    const f = path.normalize(path.join(PUB, url === '/' ? 'index.html' : url));
    if (!f.startsWith(PUB)) return send(res, 403, { error: 'Forbidden' });
    fs.readFile(f, (e, d) => { if (e) return send(res, 404, { error: 'Not found' }); res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(d); });
  });
}
module.exports = { createServer };
if (require.main === module) {
  const port = +process.env.PORT || 3000;
  createServer().listen(port, () => console.log(`\n  aqiqat.ai  ->  http://localhost:${port}   (AI_PROVIDER=${process.env.AI_PROVIDER || 'demo'})\n`));
}
