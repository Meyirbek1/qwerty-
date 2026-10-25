'use strict';
// Анализатор: Gemini / Claude / demo (правила). При любой ошибке ИИ -> автоматически demo.
const SYS = (lang) => `You are a careful fake-news analysis assistant. Analyze the user's text for signs of misinformation: manipulation, clickbait, unverifiable claims, conspiracy framing, absolute statements, missing sources, emotional pressure. You cannot browse the web: judge only by language, logic and plausibility, and be honest about uncertainty. Reply with ONLY a JSON object, no markdown: {"verdict":"fake|suspicious|reliable","confidence":0-100,"summary":"1-2 sentences","reasons":["..."],"signs":["short manipulation labels"],"phrases":["exact substrings copied from the text that look suspicious"],"advice":"how to verify"}. Write all text values in ${lang === 'ru' ? 'Russian' : 'Kazakh'}.`;

const arr = (a, n) => (Array.isArray(a) ? a.filter(x => typeof x === 'string' && x.trim()).slice(0, n) : []);
function normalize(o, text, provider) {
  const v = ['fake', 'suspicious', 'reliable'].includes(o && o.verdict) ? o.verdict : 'suspicious';
  const c = Math.max(0, Math.min(100, Math.round(Number(o && o.confidence)) || 50));
  return { verdict: v, confidence: c, summary: String((o && o.summary) || '').slice(0, 500),
    reasons: arr(o && o.reasons, 6), signs: arr(o && o.signs, 8),
    phrases: arr(o && o.phrases, 10).filter(p => text.includes(p)), advice: String((o && o.advice) || '').slice(0, 500), provider };
}
const parseJSON = (s) => JSON.parse(String(s).replace(/```json|```/g, '').trim());

async function withTimeout(url, opts, ms = 20000) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ac.signal }); } finally { clearTimeout(t); }
}
async function gemini(text, lang) {
  const key = process.env.GEMINI_API_KEY; if (!key) throw new Error('no GEMINI_API_KEY');
  const models = process.env.GEMINI_MODEL ? [process.env.GEMINI_MODEL] : ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];
  let last;
  for (const m of models) {
    try {
      const r = await withTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: SYS(lang) }] }, contents: [{ role: 'user', parts: [{ text }] }],
          generationConfig: { temperature: 0.2, responseMimeType: 'application/json' } }) });
      if (!r.ok) throw new Error(`gemini ${m} ${r.status}`);
      const j = await r.json();
      return normalize(parseJSON(j.candidates[0].content.parts.map(p => p.text || '').join('')), text, 'gemini');
    } catch (e) { last = e; }
  }
  throw last;
}
async function claude(text, lang) {
  const key = process.env.ANTHROPIC_API_KEY; if (!key) throw new Error('no ANTHROPIC_API_KEY');
  const r = await withTimeout('https://api.anthropic.com/v1/messages', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: process.env.CLAUDE_MODEL || 'claude-haiku-5-5', max_tokens: 1000, system: SYS(lang), messages: [{ role: 'user', content: text }] }) });
  if (!r.ok) throw new Error('claude ' + r.status);
  const j = await r.json();
  return normalize(parseJSON(j.content.map(b => b.text || '').join('')), text, 'claude');
}

// ---- demo: анализ по правилам (қаз + рус) ----
const RULES = [
  [/шұғыл|срочно|немедленно|перешлите|таратыңыз|барлығына жіберіңіз|пока не удалили|өшіріп тастамай/gi, 2, 'Шұғылдық пен таратуға шақыру', 'Давление срочностью и призыв к репосту'],
  [/шок|сенбейсіз|не поверите|шокирующ|сенсация|скрывают|жасырып/gi, 2, 'Кликбейт / сенсация', 'Кликбейт / сенсация'],
  [/100 ?%|әрдайым|ешқашан|никогда|всегда|абсолютно|все врачи/gi, 1, 'Абсолютті тұжырымдар', 'Абсолютные утверждения'],
  [/құпия|жасырын|заговор|тайно|мировое правительство|әлемдік үкімет/gi, 2, 'Қастандық теориясы', 'Теория заговора'],
  [/бір досым|белгісіз дереккөз|анонимн|говорят|по слухам|айтады екен/gi, 2, 'Дереккөзі расталмаған', 'Непроверяемый источник'],
  [/кез келген ауруды|чудодейственн|излечивает|керемет емдейді|за одну ночь|бір түнде/gi, 2, 'Керемет уәде (денсаулық)', 'Чудо-обещания (здоровье)'],
  [/ұтып алдыңыз|вы выиграли|переведите|гарантированный доход|кепілдендірілген табыс/gi, 3, 'Алаяқтық белгісі', 'Признак мошенничества'],
];
function demo(text, lang) {
  const ru = lang === 'ru'; let s = 0; const signs = [], phrases = [], reasons = [];
  for (const [re, w, kk, rr] of RULES) {
    const m = text.match(re);
    if (m) { s += w; signs.push(ru ? rr : kk); m.slice(0, 2).forEach(x => phrases.push(x)); reasons.push((ru ? rr : kk) + ': «' + m[0] + '»'); }
  }
  const letters = text.replace(/[^A-Za-zА-Яа-яӘәҒғҚқҢңӨөҰұҮүІіҺһЁё]/g, '');
  const caps = letters.length > 30 ? letters.replace(/[^A-ZА-ЯӘҒҚҢӨҰҮІҺЁ]/g, '').length / letters.length : 0;
  if (caps > 0.3) { s += 2; signs.push(ru ? 'КАПС' : 'КАПС (бас әріптер)'); reasons.push(ru ? 'Слишком много заглавных букв' : 'Бас әріптер тым көп'); }
  if ((text.match(/!/g) || []).length >= 3) { s += 1; signs.push(ru ? 'Эмоциональный тон' : 'Эмоциялық үн'); reasons.push(ru ? 'Много восклицательных знаков' : 'Леп белгілері көп'); }
  if (text.length > 80 && !/\d|дереккөз|источник|http/i.test(text)) { s += 1; reasons.push(ru ? 'Нет цифр, дат и ссылок на источники' : 'Сандар, күндер, дереккөз көрсетілмеген'); }
  const verdict = s >= 6 ? 'fake' : s >= 3 ? 'suspicious' : 'reliable';
  const confidence = verdict === 'fake' ? Math.min(92, 55 + s * 5) : verdict === 'suspicious' ? 50 + s * 4 : Math.max(55, 80 - s * 10);
  const summary = ru ? { fake: 'Много признаков манипуляции.', suspicious: 'Есть признаки, требующие проверки.', reliable: 'Явных признаков манипуляции не найдено.' }[verdict]
    : { fake: 'Манипуляция белгілері көп.', suspicious: 'Тексеруді қажет ететін белгілер бар.', reliable: 'Манипуляцияның айқын белгілері табылмады.' }[verdict];
  return { verdict, confidence, summary: summary + (ru ? ' (демо-анализ по правилам)' : ' (ережеге негізделген демо-талдау)'), reasons: reasons.slice(0, 6), signs, phrases: [...new Set(phrases)].filter(p => text.includes(p)),
    advice: ru ? 'Найдите первоисточник, сверьте с 2–3 надёжными изданиями, проверьте дату и автора.' : 'Бастапқы дереккөзді табыңыз, 2–3 сенімді басылыммен салыстырыңыз, күні мен авторын тексеріңіз.', provider: 'demo' };
}

async function analyze(text, lang) {
  const p = (process.env.AI_PROVIDER || 'demo').toLowerCase();
  try {
    if (p === 'gemini') return await gemini(text, lang);
    if (p === 'claude') return await claude(text, lang);
  } catch (e) { console.warn('[ai fallback -> demo]', e.message); const d = demo(text, lang); d.fallback = true; return d; }
  return demo(text, lang);
}
module.exports = { analyze, demo, normalize };
