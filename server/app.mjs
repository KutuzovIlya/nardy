/* ============================================================
   Сервер нард: вход через Telegram, профили, рейтинг.

   Логика написана на веб-стандартах (Request/Response, Web Crypto),
   поэтому один и тот же файл работает и на Deno Deploy, и под Node.
   Хранилище передаётся снаружи: {get, set, list}.

   Кто выиграл — решают оба игрока. Партия засчитывается только
   когда обе стороны сообщили одинаковый исход: так подделать
   победу в одиночку нельзя.
   ============================================================ */

var enc = new TextEncoder();

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
  if (!initData || !botToken) return null;
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

function blankUser(who) {
  return {
    id: who.id, name: who.name, photo: who.photo,
    w: 0, l: 0, mars: 0, marsLost: 0, foes: {}, updated: Date.now()
  };
}

async function loadUser(store, who) {
  var u = await store.get('user:' + who.id);
  if (!u) u = blankUser(who);
  if (who.name) u.name = who.name;
  if (who.photo) u.photo = who.photo;
  return u;
}

function json(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign({ 'content-type': 'application/json; charset=utf-8' }, cors)
  });
}

/* Партия засчитывается, когда оба сообщили один и тот же исход */
async function commit(store, game) {
  var a = game.a, b = game.b;
  if (!a || !b || game.done) return false;
  if (a.foeId !== b.id || b.foeId !== a.id) return false;
  if (a.win === b.win) return false;                 /* оба «выиграли» — не верим никому */

  var ua = await loadUser(store, { id: a.id, name: a.name, photo: a.photo });
  var ub = await loadUser(store, { id: b.id, name: b.name, photo: b.photo });
  var pairs = [[ua, a, b], [ub, b, a]];
  for (var i = 0; i < pairs.length; i++) {
    var u = pairs[i][0], mine = pairs[i][1], foe = pairs[i][2];
    if (mine.win) { u.w++; if (mine.mars) u.mars++; }
    else { u.l++; if (mine.mars) u.marsLost++; }
    var f = u.foes[foe.id] || { name: foe.name, w: 0, l: 0 };
    f.name = foe.name || f.name;
    if (mine.win) f.w++; else f.l++;
    f.games = f.w + f.l;
    f.last = Date.now();
    u.foes[foe.id] = f;
    u.updated = Date.now();
    await store.set('user:' + u.id, u);
  }
  game.done = true;
  return true;
}

export async function handle(req, store, cfg) {
  var cors = {
    'access-control-allow-origin': cfg.origin || '*',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET,POST,OPTIONS'
  };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  var url = new URL(req.url);
  var path = url.pathname.replace(/\/+$/, '') || '/';

  if (path === '/' || path === '/api') return json({ ok: true, service: 'nardy' }, 200, cors);

  var body = {};
  if (req.method === 'POST') {
    try { body = await req.json(); } catch (e) { body = {}; }
  }

  /* вход: клиент присылает initData, сервер проверяет подпись */
  if (path === '/api/login' && req.method === 'POST') {
    var who = await checkInitData(body.initData, cfg.botToken, 86400);
    if (!who) return json({ error: 'bad_init_data' }, 401, cors);
    var u = await loadUser(store, who);
    await store.set('user:' + u.id, u);
    return json({ user: pub(u) }, 200, cors);
  }

  if (path === '/api/profile' && req.method === 'GET') {
    var id = url.searchParams.get('id') || '';
    var p = await store.get('user:' + id);
    if (!p) return json({ error: 'not_found' }, 404, cors);
    return json({ user: pub(p) }, 200, cors);
  }

  if (path === '/api/top' && req.method === 'GET') {
    var all = await store.list('user:');
    all.sort(function (x, y) { return (y.w - y.l) - (x.w - x.l) || y.w - x.w; });
    return json({
      top: all.slice(0, 50).map(function (u) {
        return { id: u.id, name: u.name, photo: u.photo, w: u.w, l: u.l };
      })
    }, 200, cors);
  }

  /* итог партии: пишем свою половину и ждём вторую */
  if (path === '/api/result' && req.method === 'POST') {
    var me = await checkInitData(body.initData, cfg.botToken, 86400);
    if (!me) return json({ error: 'bad_init_data' }, 401, cors);
    if (!body.gameId || !body.foeId) return json({ error: 'bad_request' }, 400, cors);

    var key = 'game:' + String(body.gameId).slice(0, 64);
    var g = (await store.get(key)) || { id: key, a: null, b: null, done: false, at: Date.now() };
    var mine = {
      id: me.id, name: me.name, photo: me.photo,
      foeId: String(body.foeId).slice(0, 40),
      foeName: String(body.foeName || 'Игрок').slice(0, 24),
      win: !!body.win, mars: !!body.mars
    };
    if (g.a && g.a.id === me.id) g.a = mine;
    else if (g.b && g.b.id === me.id) g.b = mine;
    else if (!g.a) g.a = mine;
    else if (!g.b) g.b = mine;
    else return json({ error: 'game_full' }, 409, cors);

    /* имя соперника из его же половины отчёта надёжнее */
    if (g.a && g.b) {
      g.a.name = g.a.name || g.b.foeName;
      g.b.name = g.b.name || g.a.foeName;
    }
    var counted = await commit(store, g);
    await store.set(key, g);
    var mineUser = await store.get('user:' + me.id);
    return json({ counted: counted, user: mineUser ? pub(mineUser) : null }, 200, cors);
  }

  return json({ error: 'not_found' }, 404, cors);
}

function pub(u) {
  var foes = [], id;
  for (id in u.foes) {
    var f = u.foes[id];
    foes.push({ id: id, name: f.name, w: f.w, l: f.l, games: f.games || (f.w + f.l), last: f.last || 0 });
  }
  foes.sort(function (a, b) { return b.games - a.games || b.last - a.last; });
  return {
    id: u.id, name: u.name, photo: u.photo,
    w: u.w, l: u.l, mars: u.mars, marsLost: u.marsLost,
    foes: foes.slice(0, 20),
    bros: foes.filter(function (f) { return f.games >= 3; }).slice(0, 3).map(function (f) { return f.id; })
  };
}
