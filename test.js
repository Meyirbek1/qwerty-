'use strict';
const test = require('node:test'), assert = require('node:assert');
process.env.AI_PROVIDER = 'demo'; process.env.DATA_DIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'aq-'));
const { demo, normalize } = require('./analyzer'); const { createServer } = require('./server');
const FAKE = 'ШОК! Срочно перешлите всем! Врачи скрывают чудодейственный рецепт, который излечивает любую болезнь за одну ночь! Это тайно запрещено, 100% работает!!!';
const OK = 'Қалалық әкімдік 12 қазанда жаңа жол жөндеу жұмыстары басталатынын хабарлады. Ресми дереккөз: әкімдіктің сайты.';
test('demo: fake', () => { const r = demo(FAKE, 'ru'); assert.equal(r.verdict, 'fake'); assert.ok(r.signs.length >= 3); assert.ok(r.phrases.every(p => FAKE.includes(p))); });
test('demo: reliable', () => assert.equal(demo(OK, 'kk').verdict, 'reliable'));
test('normalize clamps', () => { const r = normalize({ verdict: 'x', confidence: 999, phrases: ['нет'] }, 'abc', 't'); assert.equal(r.verdict, 'suspicious'); assert.equal(r.confidence, 100); assert.deepEqual(r.phrases, []); });
test('http api + auth', async () => {
  const s = createServer(); await new Promise(r => s.listen(0, r)); const b = `http://127.0.0.1:${s.address().port}`;
  const post = (u, o, c) => fetch(b + u, { method: 'POST', headers: c ? { cookie: c } : {}, body: JSON.stringify(o) });
  assert.equal((await fetch(b + '/api/health')).status, 200); assert.equal((await fetch(b + '/')).status, 200);
  assert.equal((await fetch(b + '/../server.js')).status === 200, false);
  assert.equal((await post('/api/analyze', { text: FAKE, lang: 'ru' })).status, 401);          // без входа нельзя
  assert.equal((await post('/api/register', { name: 'A', email: 'x', password: '1' })).status, 400);
  const reg = await post('/api/register', { name: 'Айбек', email: 'A@b.kz', password: 'secret1', lang: 'kk' }); assert.equal(reg.status, 200);
  const ck = reg.headers.get('set-cookie').split(';')[0];
  assert.equal((await post('/api/register', { name: 'Айбек', email: 'a@b.kz', password: 'secret1' })).status, 409);
  assert.equal((await post('/api/login', { email: 'a@b.kz', password: 'wrong11' })).status, 401);
  assert.equal((await fetch(b + '/api/me', { headers: { cookie: ck } })).status, 200);
  assert.equal((await fetch(b + '/api/me', { headers: { cookie: ck + 'x' } })).status, 401);
  assert.equal((await post('/api/analyze', { text: 'qысқа', lang: 'kk' }, ck)).status, 400);
  const r = await post('/api/analyze', { text: FAKE, lang: 'ru' }, ck); assert.equal(r.status, 200); assert.equal((await r.json()).verdict, 'fake');
  assert.equal((await post('/api/login', { email: 'A@B.kz', password: 'secret1' })).status, 200);
  s.close();
});
