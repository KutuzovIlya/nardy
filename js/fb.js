/* ============================================================
   Firebase: столы и профили без своего сервера.

   Google бесплатно держит базу (Realtime Database) и пускает
   игроков анонимным входом — без регистрации и без карты,
   из России без VPN. Партию ведёт сам телефон теми же
   правилами, что и сервер (js/table.js). База следит за
   порядком (правила — в firebase.rules.json):
     • за стол пишут только двое севших;
     • каждая запись поднимает номер стола ровно на один —
       опоздавшая копия не затрёт свежую, а тот, кто опоздал,
       перечитывает стол и пробует снова.

   Работаем через обычные HTTP-запросы и поток событий
   (EventSource) — без тяжёлой библиотеки Firebase.
   ============================================================ */
(function (global) {
  'use strict';

  var CFG = {
    key: 'AIzaSyA8NB_PgCVCEWaqRVaG2Ei3pHVWhfpL3yY',      /* публичный ключ веб-приложения, не секрет */
    db: 'https://nardy-577d6-default-rtdb.europe-west1.firebasedatabase.app'
  };
  var T = global.NardyTable, N = global.Nardy;

  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

  function fail(status, message) {
    var e = new Error(message || ('http ' + status));
    e.status = status;
    return e;
  }

  function json(r) {
    return r.json().then(function (d) {
      if (!r.ok) throw fail(r.status, d && d.error && (d.error.message || d.error));
      return d;
    }, function () { throw fail(r.status); });
  }

  /* ---------- анонимный вход ----------
     Номер игрока (uid) живёт в памяти телефона и не меняется между
     запусками. Пропуск (token) действует час и обновляется сам. */

  var sess = null, pending = null;
  try { sess = JSON.parse(localStorage.getItem('nardy.fb') || 'null'); } catch (e) { sess = null; }

  function keepSess() {
    try { localStorage.setItem('nardy.fb', JSON.stringify({ uid: sess.uid, rt: sess.rt })); } catch (e) {}
  }

  function signUp() {
    return fetch('https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=' + CFG.key, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ returnSecureToken: true })
    }).then(json).then(function (d) {
      sess = { uid: d.localId, rt: d.refreshToken, tok: d.idToken, exp: Date.now() + (Number(d.expiresIn) - 120) * 1000 };
      keepSess();
      return sess.tok;
    });
  }

  function refresh() {
    return fetch('https://securetoken.googleapis.com/v1/token?key=' + CFG.key, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(sess.rt)
    }).then(json).then(function (d) {
      sess = { uid: d.user_id, rt: d.refresh_token, tok: d.id_token, exp: Date.now() + (Number(d.expires_in) - 120) * 1000 };
      keepSess();
      return sess.tok;
    });
  }

  function token() {
    if (sess && sess.tok && Date.now() < sess.exp) return Promise.resolve(sess.tok);
    if (pending) return pending;
    var p = sess && sess.rt
      ? refresh().then(null, function (e) { if (e.status === 400) return signUp(); throw e; })
      : signUp();
    pending = p.then(function (t) { pending = null; return t; }, function (e) { pending = null; throw e; });
    return pending;
  }

  function uid() { return sess ? sess.uid : null; }

  /* ---------- база ---------- */

  /* Всё игровое лежит в папке v1: поменяется устройство данных —
     заведём v2, и старые записи не помешают новым */
  function url(path, tok, query) {
    return CFG.db + '/v1/' + path + '.json?auth=' + encodeURIComponent(tok) + (query || '');
  }

  function get(path, query) {
    return token().then(function (tok) {
      return fetch(url(path, tok, query), { cache: 'no-store' }).then(json);
    });
  }

  function put(path, val) {
    return token().then(function (tok) {
      return fetch(url(path, tok), { method: 'PUT', body: JSON.stringify(val) }).then(json);
    });
  }

  /* Прочитать — изменить — записать. field — номер записи ('seq' у стола,
     'rev' у профиля): база примет запись, только если он вырос ровно на один.
     fn получает копию и возвращает новое значение или undefined — «не менять». */
  function update(path, fn, field) {
    var tries = 0;
    function once() {
      return get(path).then(function (cur) {
        var next = fn(cur == null ? null : clone(cur));
        if (next === undefined) return { value: cur, changed: false };
        next[field] = (cur ? cur[field] || 0 : 0) + 1;
        return put(path, next).then(function () {
          return { value: next, changed: true };
        }, function (e) {
          if (e.status === 401 && ++tries < 6) return once();     /* кто-то записал раньше нас */
          throw e;
        });
      });
    }
    return once();
  }

  /* Поток событий: база сама говорит, что запись изменилась. Сами
     изменения не собираем по кусочкам — просто перечитываем целиком,
     так надёжнее. Пропуск истёк — переподключаемся с новым. */
  function stream(path, onChange) {
    var es = null, dead = false, timer = null, retry = 0;

    function open() {
      if (dead) return;
      token().then(function (tok) {
        if (dead) return;
        es = new EventSource(url(path, tok));
        es.addEventListener('put', ping);
        es.addEventListener('patch', ping);
        es.addEventListener('auth_revoked', again);
        es.addEventListener('cancel', again);
        es.onerror = function () { if (es && es.readyState === 2) again(); };
      }, later);
    }
    function ping() { retry = 0; onChange(); }
    function again() {
      if (es) es.close();
      es = null;
      if (sess) sess.exp = 0;              /* на всякий случай берём свежий пропуск */
      later();
    }
    function later() {
      if (dead) return;
      clearTimeout(timer);
      timer = setTimeout(open, Math.min(10000, 500 * Math.pow(2, retry++)));
    }

    open();
    return {
      close: function () { dead = true; clearTimeout(timer); if (es) es.close(); es = null; },
      kick: function () { if (es) es.close(); es = null; retry = 0; open(); }
    };
  }

  /* ---------- время ----------
     Часы у телефонов расходятся. Меряем их по часам базы: при каждой
     отметке «я здесь» база вписывает своё время и возвращает его. */

  var skew = 0;
  function now() { return Math.round(Date.now() + skew); }

  /* ---------- профили ---------- */

  function acc() { return global.NardyTG ? NardyTG.account() : null; }

  function record(t) {
    var e = t.end;
    if (!e) return Promise.resolve();
    return ['w', 'b'].reduce(function (chain, p) {
      var me = t.seats[p];
      if (!me || !me.acc || !t.seats[N.opp(p)]) return chain;
      return chain.then(function () {
        return update('users/' + me.acc, function (u) {
          u = u || T.blankUser({ id: me.acc, name: me.name, photo: me.photo }, e.at);
          return T.recordInto(u, t, p) ? u : undefined;
        }, 'rev');
      }).then(null, function () {});
    }, Promise.resolve());
  }

  function profile(id) {
    return get('users/' + encodeURIComponent(id)).then(function (u) { return u ? T.pub(u) : null; });
  }

  /* Своё: имя, «о себе», медальон, чем показывать лицо */
  function saveMe(me, patch) {
    return update('users/' + me.id, function (u) {
      u = u || T.blankUser({ id: me.id, name: me.name, photo: me.photo }, now());
      for (var k in patch) u[k] = patch[k];
      u.updated = now();
      return u;
    }, 'rev');
  }

  /* Своё фото лежит отдельно от профиля — чтобы рейтинг не тянул
     полсотни картинок разом */
  var photos = {};
  function photoOf(acc) {
    if (!acc) return Promise.resolve('');
    if (photos[acc] !== undefined) return Promise.resolve(photos[acc]);
    return get('photos/' + encodeURIComponent(acc)).then(function (p) {
      photos[acc] = typeof p === 'string' ? p : '';
      return photos[acc];
    }, function () { return ''; });
  }
  function putPhoto(acc, data) {
    photos[acc] = data;
    return put('photos/' + encodeURIComponent(acc), data);
  }

  function top() {
    return get('users', '&orderBy=%22w%22&limitToLast=50').then(function (all) {
      var list = [], k;
      for (k in all || {}) {
        list.push({ id: k, name: all[k].name, photo: all[k].photo || '', w: all[k].w || 0, l: all[k].l || 0 });
      }
      list.sort(function (a, b) { return b.w - a.w || a.l - b.l; });
      return list;
    });
  }

  /* ---------- стол ---------- */

  function seatOf(t) {
    if (!t || !t.uids || !uid()) return null;
    if (t.uids.w === uid()) return 'w';
    if (t.uids.b === uid()) return 'b';
    return null;
  }

  /* Что видит игра: стол, кто был в сети и время по часам базы */
  var seenCache = {};
  function view(t) {
    var out = clone(T.normalize(t));
    delete out.uids;
    out.seen = seenCache[t.code] || { w: 0, b: 0 };
    out.now = now();
    return out;
  }

  function transport(myId, myName) {
    var cur = null, clockTimer = null;

    function who(w) {
      var v = global.NardyProfile ? NardyProfile.look() : {};
      return {
        id: myId(), name: (w && w.name) || myName() || 'Игрок', photo: (w && w.photo) || '',
        look: { pic: v.pic || 'tg', medal: v.medal || 'star' }
      };
    }

    function create(body) {
      var p = body.seat === 'b' ? 'b' : 'w', tries = 0;
      function attempt() {
        var code = T.code6(), t = T.freshTable(code, body.opts, now());
        t.uids = {};
        t.uids[p] = uid();
        t.seats[p] = T.person(who(body.who), acc());
        return put('tables/' + code, t).then(function () {
          cur = code;
          return { ok: true, seat: p, table: view(t), code: code };
        }, function (e) {
          if (e.status === 401 && ++tries < 5) return attempt();   /* такой код уже занят */
          throw e;
        });
      }
      return token().then(attempt);
    }

    function sit(code, want, w) {
      var p = null, why = null;
      return token().then(function () {
        return update('tables/' + code, function (t) {
          p = why = null;
          if (!t) { why = 'gone'; return; }
          T.normalize(t);
          t.uids = t.uids || {};
          p = seatOf(t);
          if (p) return;                                   /* уже сидим — просто вернуться */
          p = !t.seats.w ? 'w' : (!t.seats.b ? 'b' : null);
          if (!p) { why = 'full'; return; }
          t.uids[p] = uid();
          t.updatedAt = now();
          T.seat(t, p, T.person(who(w), acc()), now());
          return t;
        }, 'seq');
      }).then(function (r) {
        if (why) return { ok: false, why: why };
        cur = code;
        return { ok: true, seat: p, table: view(r.value), code: code };
      });
    }

    /* Просьба игрока: сперва отработать просрочку, потом саму просьбу.
       Партия кончилась на этой записи — пишем итог в профили. */
    function act(name, body) {
      var why = null, ended = false;
      return update('tables/' + cur, function (t) {
        why = null;
        ended = false;
        if (!t) { why = 'gone'; return; }
        T.normalize(t);
        var p = seatOf(t);
        if (!p) { why = 'not_seated'; return; }
        var at = now(), had = !!t.end;
        var late = T.settle(t, at);
        why = T.ask[name](t, p, body, at);
        ended = !had && !!t.end;
        if (why && !late) return;
        t.updatedAt = at;
        return t;
      }, 'seq').then(function (r) {
        if (r.changed && ended) record(r.value);
        return r.value ? { table: view(r.value), error: why } : { error: why || 'gone' };
      }, function (e) {
        if (!e || !e.status) return { error: 'net' };           /* нет связи — повторим */
        /* база отказала всерьёз — отдаём игре стол как есть, пусть выровняется */
        return get('tables/' + cur).then(function (t) {
          return { table: t ? view(t) : null, error: 'denied' };
        }, function () { return { error: 'net' }; });
      });
    }

    /* Просьбы идут по одной и повторяются, пока связь не вернётся */
    var queue = [], busy = false, tries = 0;
    function pump() {
      if (busy || !queue.length) return;
      busy = true;
      var job = queue[0];
      act(job.name, job.body).then(function (d) {
        busy = false;
        if (d.error === 'net') {
          tries++;
          if (tries === 1 && global.NardyNet && NardyNet.onLost) NardyNet.onLost();
          setTimeout(pump, Math.min(10000, 600 * Math.pow(2, tries - 1)));
          return;
        }
        queue.shift();
        if (tries && global.NardyNet && NardyNet.onBack) NardyNet.onBack();
        tries = 0;
        job.ok(d);
        pump();
      });
    }
    function ask(name, body) {
      return new Promise(function (ok) { queue.push({ name: name, body: body || {}, ok: ok }); pump(); });
    }

    /* Кто в сети: раз в 20 секунд отмечаемся сами и смотрим на соперника */
    function heartbeat(code, p) {
      if (!p) return Promise.resolve();
      var sent = Date.now();
      return put('seen/' + code + '/' + p, { '.sv': 'timestamp' }).then(function (ts) {
        if (typeof ts === 'number') skew = ts - (sent + Date.now()) / 2;
        return get('seen/' + code);
      }).then(function (s) {
        seenCache[code] = { w: (s && s.w) || 0, b: (s && s.b) || 0 };
      }, function () {});
    }

    /* Сходить за опоздавшего, когда выйдет срок. Караулят оба телефона,
       запишет тот, кто успеет, — второй увидит, что уже сделано. */
    function guard(t) {
      clearTimeout(clockTimer);
      if (!t || t.status !== 'live' || !t.deadline || t.state.winner) return;
      var ms = t.deadline + T.LIMITS.grace + 200 - now();
      clockTimer = setTimeout(function () {
        var ended = false;
        update('tables/' + t.code, function (x) {
          ended = false;
          if (!x) return;
          T.normalize(x);
          if (!seatOf(x)) return;
          var had = !!x.end;
          if (!T.settle(x, now())) return;
          ended = !had && !!x.end;
          x.updatedAt = now();
          return x;
        }, 'seq').then(function (r) { if (r.changed && ended) record(r.value); }, function () {});
      }, Math.max(0, ms));
    }

    return {
      kind: 'fb',
      hasLobby: false,
      hasPresence: true,
      authoritative: true,

      watchLobby: function (cb) { cb([]); return function () {}; },
      create: create,
      sit: sit,

      watchTable: function (code, cb, onErr) {
        cur = code;
        var dead = false, busyRead = false, again = false, fails = 0, beat = null, s = null, mine = null;

        function read() {
          if (dead) return;
          if (busyRead) { again = true; return; }
          busyRead = true;
          get('tables/' + code).then(function (t) {
            busyRead = false;
            if (dead) return;
            fails = 0;
            if (!t) { dead = true; cb(null); return; }
            T.normalize(t);
            var first = !mine;
            mine = seatOf(t);
            if (first && mine) heartbeat(code, mine);        /* «в сети» — сразу, не через 20 секунд */
            guard(t);
            cb(view(t));
            if (again) { again = false; read(); }
          }, function (e) {
            busyRead = false;
            if (dead) return;
            if (++fails === 3 && onErr) onErr(e);
            setTimeout(read, Math.min(8000, 500 * Math.pow(2, fails)));
          });
        }

        function beatNow() {
          heartbeat(code, mine).then(function () { if (!dead) read(); });
        }

        s = stream('tables/' + code, read);
        beatNow();
        beat = setInterval(beatNow, 20000);

        /* из фона iOS мог оборвать поток молча — переподключаемся сразу */
        function wake() { if (!document.hidden && !dead) { s.kick(); beatNow(); } }
        document.addEventListener('visibilitychange', wake);

        return function () {
          dead = true;
          clearInterval(beat);
          clearTimeout(clockTimer);
          document.removeEventListener('visibilitychange', wake);
          s.close();
        };
      },

      write: function () { return Promise.resolve(); },

      peek: function (code) {
        return get('tables/' + code).then(function (t) { return t ? view(t) : null; });
      },

      turn: function (game, ply, moves) { return ask('turn', { game: game, ply: ply, moves: moves }); },
      offer: function () { return ask('offer'); },
      answer: function (yes) { return ask('answer', { yes: !!yes }); },
      again: function () { return ask('again'); },

      now: now,
      here: function () {},
      watchPeers: function () { return function () {}; }
    };
  }

  global.NardyFB = {
    transport: transport,
    profile: profile,
    saveMe: saveMe,
    photoOf: photoOf,
    putPhoto: putPhoto,
    top: top,
    now: now,
    ready: function () { return typeof fetch === 'function' && typeof EventSource === 'function'; }
  };
})(window);
