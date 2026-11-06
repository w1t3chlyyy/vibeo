import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const PORT = 3000;
const PUBLIC_URL = (process.env.PUBLIC_URL || process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const ADMINS = (process.env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
const PLUS_INFO = process.env.PLUS_INFO || '💎 Vibeo Plus: высокое качество и никакой рекламы. Для подключения напишите администратору.';
const PROD = process.env.NODE_ENV === 'production';
let BOT_NAME = process.env.TELEGRAM_BOT_USERNAME || '';

/* ---------- storage (data.json) ---------- */
const FILE = path.resolve('data.json');
const db: any = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : {};
db.users ??= {}; db.sessions ??= {}; db.rooms ??= {}; db.reviews ??= [];
db.ad ??= { on: false, video: '', link: '', minutes: 20 };
let timer: any;
const save = () => { clearTimeout(timer); timer = setTimeout(() => fs.writeFile(FILE, JSON.stringify(db), () => {}), 300); };
const pending: Record<string, any> = {};
const clients = new Map<string, Set<any>>();

/* ---------- telegram ---------- */
async function tg(method: string, body: any = {}, ms = 15000): Promise<any> {
  if (!BOT_TOKEN) return null;
  try {
    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms),
    });
    return (await r.json() as any).result;
  } catch { return null; }
}
const say = (chat: any, text: string) => tg('sendMessage', { chat_id: chat, text, disable_web_page_preview: true });
const isPlus = (u: any) => !!u && (u.plusUntil || 0) > Date.now();

async function onMsg(m: any) {
  const id = String(m.from.id), text = (m.text || '').trim();
  if (!text) return;
  const [cmd, ...args] = text.split(/\s+/);
  const admin = ADMINS.includes(id);

  if (cmd === '/start') {
    const tk = args[0];
    if (tk === 'plus') return say(id, PLUS_INFO);
    if (tk && pending[tk]) {
      const u = (db.users[id] ??= { id, joined: Date.now(), plusUntil: 0 });
      u.name = [m.from.first_name, m.from.last_name].filter(Boolean).join(' ') || m.from.username || 'Гость';
      pending[tk].uid = id; save();
      return say(id, '✅ Готово! Вернитесь на сайт — вход выполнится автоматически.');
    }
    return say(id, `Привет! Это бот Vibeo.\nВойти и создать комнату: ${PUBLIC_URL}/register.html\n/plus — статус подписки`);
  }
  if (cmd === '/plus') {
    if (admin && args.length >= 2) {
      const u = db.users[args[0]]; const d = Number(args[1]);
      if (!u || isNaN(d)) return say(id, 'Формат: /plus <tg_id> <дней> (0 — отключить)');
      u.plusUntil = d <= 0 ? 0 : Math.max(Date.now(), u.plusUntil || 0) + d * 864e5; save();
      if (d > 0) say(u.id, `💎 Vibeo Plus активен до ${new Date(u.plusUntil).toLocaleDateString('ru-RU')}`);
      return say(id, 'ok');
    }
    const u = db.users[id];
    return say(id, isPlus(u) ? `💎 Vibeo Plus до ${new Date(u.plusUntil).toLocaleDateString('ru-RU')}` : PLUS_INFO);
  }
  if (!admin) return;
  if (cmd === '/admin') return say(id, '/ad <ссылка_на_видео> <ссылка_перехода>\n/adoff\n/adminutes <N>\n/plus <tg_id> <дней>\n/stats');
  if (cmd === '/ad') {
    if (!/^https?:\/\//.test(args[0] || '') || !/^https?:\/\//.test(args[1] || '')) return say(id, 'Формат: /ad <https://видео.mp4> <https://куда-вести>');
    db.ad.video = args[0]; db.ad.link = args[1]; db.ad.on = true; save();
    return say(id, `📢 Реклама включена, каждые ${db.ad.minutes} мин.`);
  }
  if (cmd === '/adoff') { db.ad.on = false; save(); return say(id, 'Реклама выключена'); }
  if (cmd === '/adminutes') { db.ad.minutes = Math.max(1, Number(args[0]) || 20); save(); return say(id, `Интервал: ${db.ad.minutes} мин.`); }
  if (cmd === '/stats') {
    const us = Object.values(db.users) as any[];
    return say(id, `Пользователей: ${us.length}\nPlus: ${us.filter(isPlus).length}\nКомнат: ${Object.keys(db.rooms).length}\nОтзывов: ${db.reviews.length}\nРеклама: ${db.ad.on ? 'вкл' : 'выкл'}`);
  }
}

async function initBot() {
  if (!BOT_TOKEN) return console.warn('⚠ TELEGRAM_BOT_TOKEN не задан — вход через бота не работает');
  const me = await tg('getMe');
  if (me?.username) BOT_NAME = me.username;
  console.log('Bot:', BOT_NAME);
  let offset = 0;
  for (;;) {
    const ups = await tg('getUpdates', { offset, timeout: 30, allowed_updates: ['message'] }, 40000);
    if (!ups) { await new Promise(r => setTimeout(r, 3000)); continue; }
    for (const u of ups) { offset = u.update_id + 1; if (u.message?.from) onMsg(u.message).catch(console.error); }
  }
}

/* ---------- http api ---------- */
const app = express();
app.use(express.json({ limit: '20kb' }));
const cookie = (req: any, n: string) => (req.headers.cookie || '').match(new RegExp('(?:^|; )' + n + '=([^;]+)'))?.[1] || '';
const userOf = (req: any) => db.users[db.sessions[cookie(req, 'sid')]?.uid];
const need = (req: any, res: any, next: any) => { const u = userOf(req); if (!u) return res.status(401).json({ error: 'auth' }); req.user = u; next(); };

app.post('/api/auth/start', (_q, res) => {
  if (!BOT_NAME) return res.status(503).json({ error: 'bot' });
  for (const k in pending) if (Date.now() - pending[k].t > 9e5) delete pending[k];
  const token = crypto.randomBytes(12).toString('hex');
  pending[token] = { t: Date.now() };
  res.json({ token, url: `https://t.me/${BOT_NAME}?start=${token}` });
});
app.get('/api/auth/poll', (req, res) => {
  const k = String(req.query.token), p = pending[k];
  if (!p) return res.json({ status: 'expired' });
  if (!p.uid) return res.json({ status: 'wait' });
  const sid = crypto.randomBytes(24).toString('hex');
  db.sessions[sid] = { uid: p.uid }; delete pending[k]; save();
  res.setHeader('Set-Cookie', `sid=${sid}; HttpOnly; Path=/; SameSite=Lax; Max-Age=31536000${PUBLIC_URL.startsWith('https') ? '; Secure' : ''}`);
  res.json({ status: 'ok' });
});
app.get('/api/me', (req, res) => {
  const u = userOf(req), ad = db.ad;
  res.json({
    user: u ? { id: u.id, name: u.name, plus: isPlus(u) } : null,
    publicUrl: PUBLIC_URL, bot: BOT_NAME,
    ad: u && !isPlus(u) && ad.on && ad.video ? { video: ad.video, link: ad.link, minutes: ad.minutes } : null,
  });
});

const room = (req: any, res: any) => { const r = db.rooms[req.params.id]; if (!r) res.status(404).json({ error: 'room' }); return r; };
const push = (id: string, ev: any) => clients.get(id)?.forEach(c => c.write(`data: ${JSON.stringify(ev)}\n\n`));
const online = (id: string) => clients.get(id)?.size || 0;

app.post('/api/rooms', need, (req: any, res) => {
  const id = crypto.randomBytes(4).toString('hex');
  db.rooms[id] = { id, name: String(req.body.name || '').slice(0, 60) || 'Киновечер', owner: req.user.id, video: '', state: { playing: false, t: 0, at: Date.now() }, chat: [] };
  save(); res.json({ id });
});
app.get('/api/rooms/:id', need, (req, res) => {
  const r = room(req, res); if (!r) return;
  const s = r.state;
  res.json({ id: r.id, name: r.name, video: r.video, state: { playing: s.playing, t: s.t + (s.playing ? (Date.now() - s.at) / 1000 : 0) }, chat: r.chat.slice(-60) });
});
app.get('/api/rooms/:id/events', need, (req, res) => {
  const r = room(req, res); if (!r) return;
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  if (!clients.has(r.id)) clients.set(r.id, new Set());
  clients.get(r.id)!.add(res);
  push(r.id, { type: 'presence', n: online(r.id) });
  const hb = setInterval(() => res.write(': hb\n\n'), 25000);
  req.on('close', () => { clearInterval(hb); clients.get(r.id)?.delete(res); push(r.id, { type: 'presence', n: online(r.id) }); });
});
app.post('/api/rooms/:id/video', need, (req, res) => {
  const r = room(req, res); if (!r) return;
  const url = String(req.body.url || '').trim();
  if (!/^https?:\/\//.test(url) || url.length > 500) return res.status(400).json({ error: 'url' });
  r.video = url; r.state = { playing: false, t: 0, at: Date.now() }; save();
  push(r.id, { type: 'video', video: url, cid: req.body.cid }); res.json({ ok: 1 });
});
app.post('/api/rooms/:id/state', need, (req, res) => {
  const r = room(req, res); if (!r) return;
  const t = Number(req.body.t); if (!isFinite(t)) return res.status(400).end();
  r.state = { playing: !!req.body.playing, t, at: Date.now() };
  push(r.id, { type: 'state', playing: r.state.playing, t, cid: req.body.cid }); res.json({ ok: 1 });
});
app.post('/api/rooms/:id/chat', need, (req: any, res) => {
  const r = room(req, res); if (!r) return;
  const text = String(req.body.text || '').trim().slice(0, 500); if (!text) return res.status(400).end();
  const msg = { id: crypto.randomBytes(4).toString('hex'), name: req.user.name, plus: isPlus(req.user), text, ts: Date.now() };
  r.chat.push(msg); if (r.chat.length > 100) r.chat.shift(); save();
  push(r.id, { type: 'chat', msg }); res.json({ ok: 1 });
});
app.post('/api/review', need, (req: any, res) => {
  const rating = Math.min(5, Math.max(1, Number(req.body.rating) || 5));
  const text = String(req.body.text || '').slice(0, 1000);
  db.reviews.push({ uid: req.user.id, rating, text, room: String(req.body.room || ''), ts: Date.now() }); save();
  ADMINS.forEach(a => say(a, `⭐ Отзыв ${rating}/5\n${text || '(без текста)'}\n\nОт: ${req.user.name} (${req.user.id})\nКомната: ${req.body.room || '-'}`));
  res.json({ ok: 1 });
});

/* ---------- pages ---------- */
async function start() {
  if (!PROD) {
    const { createServer } = await import('vite');
    const vite = await createServer({ server: { middlewareMode: true }, appType: 'mpa' });
    app.get('/room/:id', async (req, res) => {
      res.type('html').send(await vite.transformIndexHtml(req.originalUrl, fs.readFileSync('room.html', 'utf8')));
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static('dist'));
    app.get('/room/:id', (_q, res) => res.sendFile(path.resolve('dist/room.html')));
  }
  app.listen(PORT, '0.0.0.0', () => console.log(`Vibeo: ${PUBLIC_URL} (port ${PORT})`));
  initBot();
}
start();
