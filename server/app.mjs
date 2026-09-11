/* ============================================================
   Сервер нард: вход через Telegram, профили, рейтинг и сетевые
   столы (сами столы — в tables.mjs).

   Логика написана на веб-стандартах (Request/Response, Web Crypto),
   поэтому один и тот же файл работает и на Deno Deploy, и под Node.
   Хранилище передаётся снаружи: {get, set, update, wait, list}.
   ============================================================ */
import * as tables from './tables.mjs';
import { T } from './rules.mjs';

var enc = new TextEncoder();
var MAX_BODY = 32 * 1024;

async function hmac(keyBytes, msg) {
  var key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  var sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  return new Uint8Array(sig);
}

function hex(bytes) {
  return Array.from(bytes).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
}

/* Проверка подписи Telegram: секрет выводится из токена бота,
   им подписывается строка из отсортированных полей initData. */
export async function checkInitData(initData, botToken, maxAgeSec) {
  if (!initData || typeof initData !== 'string' || !botToken) return null;
  var q;
  try { q = new URLSearchParams(initData); } catch (e) { return null; }
  var hash = q.get('hash');
  if (!hash) return null;
  q.delete('hash');
  var pairs = [];
  q.forEach(function (v, k) { pairs.push(k + '=' + v); });
  pairs.sort();
  var secret = await hmac(enc.encode('WebAppData'), botToken);
  var mine = hex(await hmac(secret, pairs.join('\n')));
  if (mine !== hash) return null;

  var age = Date.now() / 1000 - Number(q.get('auth_date') || 0);
  if (maxAgeSec && age > maxAgeSec) return null;

  var user;
  try { user = JSON.parse(q.get('user') || 'null'); } catch (e) { user = null; }
  if (!user || !user.id) return null;
  return {
    id: 'tg' + user.id,
    name: (user.first_name || user.username || 'Игрок').slice(0, 24),
    photo: user.photo_url || ''
  };
}

function json(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, cors)
  });
}

/* Тело запроса. Клиент шлёт JSON как обычный текст — так браузер
   не делает лишний предварительный запрос на каждый ход. */
async function readBody(req) {
  var txt = await req.text();
  if (txt.length > MAX_BODY) return null;
  if (!txt) return {};
  try {
    var o = JSON.parse(txt);
    return o && typeof o === 'object' && !Array.isArray(o) ? o : null;
  } catch (e) { return null; }
}

var TABLE_ROUTES = {
  '/api/table/watch': tables.watch,
  '/api/table/turn': tables.turn,
  '/api/table/offer': tables.offer,
  '/api/table/answer': tables.answer,
  '/api/table/again': tables.again
};

export async function handle(req, store, cfg) {
  var cors = {
    'access-control-allow-origin': cfg.origin || '*',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-max-age': '86400'
  };
  try {
    return await route(req, store, cfg, cors);
  } catch (e) {
    console.error(e);
    return json({ error: 'server' }, 500, cors);
  }
}

async function route(req, store, cfg, cors) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  var url = new URL(req.url);
  var path = url.pathname.replace(/\/+$/, '') || '/';

  if (path === '/' || path === '/api') return json({ ok: true, service: 'nardy', v: 2 }, 200, cors);

  if (req.method === 'GET' && path === '/api/profile') {
    var p = await store.get('user:' + (url.searchParams.get('id') || '').slice(0, 40));
    if (!p) return json({ error: 'not_found' }, 404, cors);
    return json({ user: pub(p) }, 200, cors);
  }

  if (req.method === 'GET' && path === '/api/top') {
    var all = await store.list('user:');
    all.sort(function (x, y) { return y.w - x.w || x.l - y.l; });
    return json({
      top: all.slice(0, 50).map(function (u) {
        return { id: u.id, name: u.name, photo: u.photo, w: u.w, l: u.l };
      })
    }, 200, cors);
  }

  if (req.method !== 'POST') return json({ error: 'not_found' }, 404, cors);

  var body = await readBody(req);
  if (!body) return json({ error: 'bad_request' }, 400, cors);

  /* вход: клиент присылает initData, сервер проверяет подпись */
  if (path === '/api/login') {
    var who = await checkInitData(body.initData, cfg.botToken, 86400);
    if (!who) return json({ error: 'bad_init_data' }, 401, cors);
    var r = await store.update('user:' + who.id, function (u) {
      u = u || T.blankUser(who, Date.now());
      u.name = who.name || u.name;
      if (who.photo && !u.custom) u.photo = who.photo;
      u.seen = Date.now();
      return u;
    });
    return json({ user: pub(r.value) }, 200, cors);
  }

  /* сесть за стол или создать его. Вход через Telegram необязателен:
     без него играть можно, но в общий профиль партия не пойдёт. */
  if (path === '/api/table' || path === '/api/table/sit') {
    var acc = await checkInitData(body.initData, cfg.botToken, 7 * 86400);
    var out = path === '/api/table'
      ? await tables.create(store, body, acc)
      : await tables.sit(store, body, acc);
    return json(out.data, out.status, cors);
  }

  var fn = TABLE_ROUTES[path];
  if (fn) {
    var res = await fn(store, body);
    return json(res.data, res.status, cors);
  }

  return json({ error: 'not_found' }, 404, cors);
}

function pub(u) { return T.pub(u); }
