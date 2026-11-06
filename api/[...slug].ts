import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

const env = process.env;
const PUBLIC_URL = (env.PUBLIC_URL || (env.VERCEL_URL ? `https://${env.VERCEL_URL}` : 'http://localhost:3000')).replace(/\/$/, '');
const BOT_TOKEN = env.TELEGRAM_BOT_TOKEN || '';
const ADMINS = (env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
const PLUS_INFO = env.PLUS_INFO || '💎 Vibeo Plus: высокое качество и никакой рекламы. Для подключения напишите администратору.';
const SB_URL = env.SUPABASE_URL || '', SB_KEY = env.SUPABASE_SERVICE_ROLE_KEY || '', SB_ANON = env.SUPABASE_ANON_KEY || '';
const db: any = createClient(SB_URL || 'http://localhost', SB_KEY || 'x', { auth: { persistSession: false } });
const WH = crypto.createHash('sha256').update(BOT_TOKEN).digest('hex').slice(0, 32);
let botName = env.TELEGRAM_BOT_USERNAME || '';

/* ---------- helpers ---------- */
async function tg(method: string, body: any = {}) {
  if (!BOT_TOKEN) return null;
  try {
    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return ((await r.json()) as any).result;
  } catch { return null; }
}
const say = (chat: any, text: string) => tg('sendMessage', { chat_id: chat, text, disable_web_page_preview: true });
const isPlus = (u: any) => !!u && Number(u.plus_until || 0) > Date.now();
const rid = () => crypto.randomBytes(4).toString('hex');
async function getBot() { if (!botName) botName = (await tg('getMe'))?.username || ''; return botName; }
async function getAd() { const { data } = await db.from('settings').select('value').eq('key', 'ad').maybeSingle(); return data?.value || { on: false, video: '', link: '', minutes: 20 }; }
const setAd = (v: any) => db.from('settings').upsert({ key: 'ad', value: v });
async function broadcast(room: string, payload: any) {
  await fetch(`${SB_URL}/realtime/v1/api/broadcast`, {
    method: 'POST', headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ topic: 'room-' + room, event: 'ev', payload, private: false }] }),
  }).catch(() => {});
}
const cookie = (req: any, n: string) => (req.headers.cookie || '').match(new RegExp('(?:^|; )' + n + '=([^;]+)'))?.[1] || '';
async function userOf(req: any) {
  const sid = cookie(req, 'sid'); if (!sid) return null;
  const { data } = await db.from('sessions').select('users(*)').eq('sid', sid).maybeSingle();
  return data?.users || null;
}

/* ---------- bot ---------- */
async function onMsg(m: any) {
  const id = String(m.from.id), text = (m.text || '').trim();
  if (!text) return;
  const [cmd, ...args] = text.split(/\s+/);
  const admin = ADMINS.includes(id);

  if (cmd === '/start') {
    const tk = args[0];
    if (tk === 'plus') return say(id, PLUS_INFO);
    if (tk) {
      const { data: p } = await db.from('pending').select('token').eq('token', tk).maybeSingle();
      if (p) {
        const name = [m.from.first_name, m.from.last_name].filter(Boolean).join(' ') || m.from.username || 'Гость';
        await db.from('users').upsert({ id, name });
        await db.from('pending').update({ uid: id }).eq('token', tk);
        return say(id, '✅ Готово! Вернитесь на сайт — вход выполнится автоматически.');
      }
    }
    return say(id, `Привет! Это бот Vibeo.\nВойти и создать комнату: ${PUBLIC_URL}/register.html\n/plus — статус подписки`);
  }
  if (cmd === '/plus') {
    if (admin && args.length >= 2) {
      const d = Number(args[1]);
      const { data: u } = await db.from('users').select('*').eq('id', args[0]).maybeSingle();
      if (!u || isNaN(d)) return say(id, 'Формат: /plus <tg_id> <дней> (0 — отключить)');
      const until = d <= 0 ? 0 : Math.max(Date.now(), Number(u.plus_until) || 0) + d * 864e5;
      await db.from('users').update({ plus_until: until }).eq('id', u.id);
      if (d > 0) say(u.id, `💎 Vibeo Plus активен до ${new Date(until).toLocaleDateString('ru-RU')}`);
      return say(id, 'ok');
    }
    const { data: u } = await db.from('users').select('*').eq('id', id).maybeSingle();
    return say(id, isPlus(u) ? `💎 Vibeo Plus до ${new Date(Number(u.plus_until)).toLocaleDateString('ru-RU')}` : PLUS_INFO);
  }
  if (!admin) return;
  if (cmd === '/admin') return say(id, '/ad <ссылка_на_видео> <ссылка_перехода>\n/adoff\n/adminutes <N>\n/plus <tg_id> <дней>\n/stats');
  const ad = await getAd();
  if (cmd === '/ad') {
    if (!/^https?:\/\//.test(args[0] || '') || !/^https?:\/\//.test(args[1] || '')) return say(id, 'Формат: /ad <https://видео.mp4> <https://куда-вести>');
    await setAd({ ...ad, video: args[0], link: args[1], on: true });
    return say(id, `📢 Реклама включена, каждые ${ad.minutes} мин.`);
  }
  if (cmd === '/adoff') { await setAd({ ...ad, on: false }); return say(id, 'Реклама выключена'); }
  if (cmd === '/adminutes') { const n = Math.max(1, Number(args[0]) || 20); await setAd({ ...ad, minutes: n }); return say(id, `Интервал: ${n} мин.`); }
  if (cmd === '/stats') {
    const c = async (t: string, f?: (q: any) => any) => { let q = db.from(t).select('*', { count: 'exact', head: true }); if (f) q = f(q); return (await q).count ?? 0; };
    return say(id, `Пользователей: ${await c('users')}\nPlus: ${await c('users', q => q.gt('plus_until', Date.now()))}\nКомнат: ${await c('rooms')}\nОтзывов: ${await c('reviews')}\nРеклама: ${ad.on ? 'вкл' : 'выкл'}`);
  }
}

/* ---------- router ---------- */
export default async function handler(req: any, res: any) {
  const url = new URL(req.url, 'http://x');
  const [a, b, c] = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  const m = req.method, body = req.body && typeof req.body === 'object' ? req.body : {};
  const out = (code: number, o: any) => res.status(code).json(o);
  try {
    // --- telegram webhook + одноразовая установка ---
    if (a === 'tg' && m === 'POST') {
      if (b !== WH) return out(403, {});
      if (body.message?.from) await onMsg(body.message);
      return res.status(200).send('ok');
    }
    if (a === 'tg-setup') {
      if (!BOT_TOKEN) return out(500, { error: 'TELEGRAM_BOT_TOKEN не задан' });
      const ok = await tg('setWebhook', { url: `${PUBLIC_URL}/api/tg/${WH}`, allowed_updates: ['message'] });
      return out(200, { ok: !!ok, bot: await getBot(), webhook: `${PUBLIC_URL}/api/tg/…` });
    }
    // --- cron-job.org: чистка ---
    if (a === 'cron') {
      if (!env.CRON_SECRET || url.searchParams.get('key') !== env.CRON_SECRET) return out(403, {});
      await db.from('pending').delete().lt('t', Date.now() - 36e5);
      await db.from('rooms').delete().lt('updated', Date.now() - 30 * 864e5);
      return out(200, { ok: true });
    }
    // --- вход ---
    if (a === 'auth' && b === 'start' && m === 'POST') {
      if (!(await getBot())) return out(503, { error: 'bot' });
      const token = crypto.randomBytes(12).toString('hex');
      await db.from('pending').insert({ token, t: Date.now() });
      return out(200, { token, url: `https://t.me/${botName}?start=${token}` });
    }
    if (a === 'auth' && b === 'poll') {
      const token = String(url.searchParams.get('token') || '');
      const { data: p } = await db.from('pending').select('*').eq('token', token).maybeSingle();
      if (!p || Date.now() - Number(p.t) > 9e5) return out(200, { status: 'expired' });
      if (!p.uid) return out(200, { status: 'wait' });
      const sid = crypto.randomBytes(24).toString('hex');
      await db.from('sessions').insert({ sid, uid: p.uid });
      await db.from('pending').delete().eq('token', token);
      res.setHeader('Set-Cookie', `sid=${sid}; HttpOnly; Path=/; SameSite=Lax; Max-Age=31536000${PUBLIC_URL.startsWith('https') ? '; Secure' : ''}`);
      return out(200, { status: 'ok' });
    }
    const user = await userOf(req);
    if (a === 'me') {
      const ad = await getAd();
      return out(200, {
        user: user ? { id: user.id, name: user.name, plus: isPlus(user) } : null,
        publicUrl: PUBLIC_URL, bot: await getBot(), sb: { url: SB_URL, anon: SB_ANON },
        ad: user && !isPlus(user) && ad.on && ad.video ? { video: ad.video, link: ad.link, minutes: ad.minutes } : null,
      });
    }
    if (!user) return out(401, { error: 'auth' });

    // --- комнаты ---
    if (a === 'rooms' && !b && m === 'POST') {
      const id = rid();
      await db.from('rooms').insert({ id, name: String(body.name || '').slice(0, 60) || 'Киновечер', owner: user.id, pos_at: Date.now(), updated: Date.now() });
      return out(200, { id });
    }
    if (a === 'rooms' && b) {
      const { data: r } = await db.from('rooms').select('*').eq('id', b).maybeSingle();
      if (!r) return out(404, { error: 'room' });
      if (!c && m === 'GET') {
        const { data: msgs } = await db.from('messages').select('name,plus,text,ts').eq('room', b).order('id', { ascending: false }).limit(60);
        const t = r.pos + (r.playing ? (Date.now() - Number(r.pos_at)) / 1000 : 0);
        return out(200, { id: r.id, name: r.name, video: r.video, state: { playing: r.playing, t }, chat: (msgs || []).reverse() });
      }
      if (c === 'video' && m === 'POST') {
        const u = String(body.url || '').trim();
        if (!/^https?:\/\//.test(u) || u.length > 500) return out(400, { error: 'url' });
        await db.from('rooms').update({ video: u, playing: false, pos: 0, pos_at: Date.now(), updated: Date.now() }).eq('id', b);
        await broadcast(b, { type: 'video', video: u, cid: body.cid });
        return out(200, { ok: 1 });
      }
      if (c === 'state' && m === 'POST') { // рассылка идёт напрямую между клиентами; тут только сохраняем
        const t = Number(body.t); if (!isFinite(t)) return out(400, {});
        await db.from('rooms').update({ playing: !!body.playing, pos: t, pos_at: Date.now(), updated: Date.now() }).eq('id', b);
        return out(200, { ok: 1 });
      }
      if (c === 'chat' && m === 'POST') {
        const text = String(body.text || '').trim().slice(0, 500); if (!text) return out(400, {});
        const msg = { room: b, name: user.name, plus: isPlus(user), text, ts: Date.now() };
        await db.from('messages').insert(msg);
        await db.from('rooms').update({ updated: Date.now() }).eq('id', b);
        await broadcast(b, { type: 'chat', msg: { name: msg.name, plus: msg.plus, text, ts: msg.ts } });
        return out(200, { ok: 1 });
      }
    }
    // --- отзыв ---
    if (a === 'review' && m === 'POST') {
      const rating = Math.min(5, Math.max(1, Number(body.rating) || 5)), text = String(body.text || '').slice(0, 1000);
      await db.from('reviews').insert({ uid: user.id, rating, text, room: String(body.room || ''), ts: Date.now() });
      await Promise.all(ADMINS.map(x => say(x, `⭐ Отзыв ${rating}/5\n${text || '(без текста)'}\n\nОт: ${user.name} (${user.id})\nКомната: ${body.room || '-'}`)));
      return out(200, { ok: 1 });
    }
    return out(404, { error: 'not found' });
  } catch (e) {
    console.error(e);
    return out(500, { error: 'server' });
  }
}
