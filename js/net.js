/* ============================================================
   Сетевой стол. Главный путь — Firebase (js/fb.js): стол лежит
   в базе Google, партию ведут сами телефоны по общим правилам
   js/table.js. Если когда-нибудь появится свой сервер (адрес
   в js/account.js), стол поведёт он — транспорт «srv» ниже.
   Запасные транспорты под тем же интерфейсом:

   • «db» — общее хранилище опубликованной страницы. Живая
     подписка, список открытых столов, атомарная посадка.
     Работает только внутри организации владельца страницы.

   • «relay» — бесплатный ретранслятор ntfy.sh, ни регистрации,
     ни ключей. Состояние партии летит обычным сообщением в тему
     nardy-<код>, подписка идёт через SSE. Работает откуда угодно,
     в том числе с GitHub Pages, но списка столов нет: соперник
     приходит по коду или по ссылке.

   Состояние партии в обоих случаях одно и то же — целиком, одним
   куском. Переписывает его только тот, чья очередь ходить.
   ============================================================ */
(function (global) {
  'use strict';

  var ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var TABLES = 'tables';
  var STALE = 6 * 60 * 60 * 1000;
  var RELAY = 'https://ntfy.sh';

  var T = null, boot = null;
  var myId = null, myName = '';

  try {
    myId = localStorage.getItem('nardy.id');
    myName = localStorage.getItem('nardy.name') || '';
  } catch (e) {}
  if (!myId) {
    myId = 'p' + Math.random().toString(36).slice(2, 10);
    try { localStorage.setItem('nardy.id', myId); } catch (e) {}
  }

  function code6() {
    var s = '';
    for (var i = 0; i < 6; i++) s += ABC[Math.floor(Math.random() * ABC.length)];
    return s;
  }

  function clone(v) { return v ? JSON.parse(JSON.stringify(v)) : v; }

  /* ---------- транспорт 1: хранилище артефакта ---------- */

  function dbTransport(db, room) {
    var cur = null;
    function ref(code) { return db.collection(TABLES).doc(code); }

    function sweep(code) { try { ref(code).delete(); } catch (e) {} }

    /* раз за сеанс убираем брошенные столы, иначе они копятся */
    try {
      db.collection(TABLES).where('updatedAt', '<', Date.now() - STALE).limit(20).get()
        .then(function (s) { s.docs.forEach(function (d) { sweep(d.id); }); }, function () {});
    } catch (e) {}

    return {
      kind: 'db',
      hasLobby: true,
      hasPresence: !!room,

      watchLobby: function (cb, onErr) {
        var q = db.collection(TABLES).where('status', '==', 'open')
          .orderBy('createdAt', 'desc').limit(12);
        return q.onSnapshot(function (snap) {
          var now = Date.now(), list = [];
          snap.docs.forEach(function (d) {
            var t = d.data();
            if (!t || !t.createdAt) return;
            if (now - t.createdAt > STALE) { sweep(d.id); return; }
            list.push(t);
          });
          cb(list);
        }, onErr);
      },

      create: function (body) {
        var code = code6(), r = ref(code);
        return r.get().then(function (snap) {
          if (snap.exists) return T.create(body);
          body.code = code;
          return r.set(body).then(function () { cur = r; return code; });
        });
      },

      sit: function (code, seat, who, prepare) {
        var r = ref(code);
        return r.acquire({ holder: myId, ttlMs: 4000 }).then(function (lease) {
          if (!lease.acquired) return { ok: false, why: 'busy' };
          return r.get().then(function (snap) {
            if (!snap.exists) return { ok: false, why: 'gone' };
            var t = clone(snap.data());
            if (!t.seats) return { ok: false, why: 'gone' };
            if (!seat) seat = !t.seats.w ? 'w' : (!t.seats.b ? 'b' : null);
            if (!seat) return { ok: false, why: 'full' };
            if (t.seats[seat] && t.seats[seat].id !== myId) return { ok: false, why: 'taken' };
            who = who || {};
            t.seats[seat] = { id: myId, name: who.name || 'Игрок', photo: who.photo || '' };
            t.updatedAt = Date.now();
            t.seq = (t.seq || 0) + 1;
            if (t.seats.w && t.seats.b) {
              t.status = 'live';
              if (prepare) prepare(t);
            }
            return r.set(t).then(function () {
              cur = r;
              return { ok: true, seat: seat, table: t };
            });
          });
        });
      },

      watchTable: function (code, cb, onErr) {
        var r = ref(code);
        cur = r;
        return r.onSnapshot(function (snap) {
          cb(snap.exists ? clone(snap.data()) : null);
        }, onErr);
      },

      write: function (body) {
        if (!cur) return Promise.resolve();
        return cur.set(body);
      },

      peek: function (code) {
        return ref(code).get().then(function (s) { return s.exists ? clone(s.data()) : null; });
      },

      here: function (code, seat) {
        if (!room || !room.presence) return;
        try {
          var p = room.presence({ table: code || null, seat: seat || null, id: myId, name: myName || 'Игрок' });
          if (p && p.catch) p.catch(function () {});
        } catch (e) {}
      },

      watchPeers: function (cb) {
        if (!room || !room.onPeers) return function () {};
        try {
          return room.onPeers(function (ch) { cb(ch && ch.peers ? ch.peers : []); }, function () {}) ||
            function () {};
        } catch (e) { return function () {}; }
      }
    };
  }

  /* ---------- транспорт 2: ретранслятор ---------- */

  function relayTransport() {
    var cur = null;

    function topic(code) { return 'nardy-' + code; }

    /* Последнее состояние стола. Раньше тянулась вся история темы за 12 часов —
       к концу партии это полтора мегабайта на каждый опрос. Теперь только
       последнее сообщение; если ретранслятор так не умеет — по-старому. */
    function poll(code) {
      var base = RELAY + '/' + topic(code) + '/json?poll=1&since=';
      return fetch(base + 'latest', { cache: 'no-store' })
        .then(function (r) {
          if (r.ok) return r.text();
          return fetch(base + '12h', { cache: 'no-store' }).then(function (r2) { return r2.ok ? r2.text() : ''; });
        })
        .then(function (txt) {
          var lines = txt.split('\n'), last = null, i, o;
          for (i = 0; i < lines.length; i++) {
            if (!lines[i]) continue;
            try { o = JSON.parse(lines[i]); } catch (e) { continue; }
            if (o.event !== 'message' || !o.message) continue;
            try { last = JSON.parse(o.message); } catch (e) {}
          }
          return last;
        });
    }

    function sendOnce(body) {
      return fetch(RELAY + '/' + topic(body.code), {
        method: 'POST',
        body: JSON.stringify(body)
      }).then(function (r) {
        if (!r.ok) throw new Error('relay ' + r.status);
      });
    }

    /* Отправка с повтором. Важен только последний вариант стола, поэтому
       держим одну ячейку «к отправке»: новая запись вытесняет старую,
       а неудача не теряет ход — повторяем, пока не уйдёт. */
    var pending = null, waiters = [], busySend = false, tries = 0;

    function flush() {
      if (busySend || !pending) return;
      busySend = true;
      var body = pending;
      sendOnce(body).then(function () {
        busySend = false;
        if (pending === body) {
          pending = null;
          var w = waiters; waiters = [];
          if (tries && global.NardyNet && NardyNet.onBack) NardyNet.onBack();
          tries = 0;
          w.forEach(function (f) { f.ok(); });
        }
        flush();
      }, function () {
        busySend = false;
        tries++;
        if (tries === 1 && global.NardyNet && NardyNet.onLost) NardyNet.onLost();
        setTimeout(flush, Math.min(15000, 800 * Math.pow(2, tries - 1)));
      });
    }

    function send(body) {
      pending = body;
      return new Promise(function (ok, no) {
        waiters.push({ ok: ok, no: no });
        flush();
      });
    }

    return {
      kind: 'relay',
      hasLobby: false,
      hasPresence: false,

      watchLobby: function (cb) { cb([]); return function () {}; },

      create: function (body) {
        body.code = code6();
        return send(body).then(function () { cur = body.code; return body.code; });
      },

      sit: function (code, seat, who, prepare) {
        return poll(code).then(function (t) {
          if (!t || !t.seats) return { ok: false, why: 'gone' };
          t = clone(t);
          if (!seat) seat = !t.seats.w ? 'w' : (!t.seats.b ? 'b' : null);
          if (!seat) return { ok: false, why: 'full' };
          if (t.seats[seat] && t.seats[seat].id !== myId) return { ok: false, why: 'taken' };
          who = who || {};
            t.seats[seat] = { id: myId, name: who.name || 'Игрок', photo: who.photo || '' };
          t.updatedAt = Date.now();
          t.seq = (t.seq || 0) + 1;
          t.code = code;
          if (t.seats.w && t.seats.b) {
            t.status = 'live';
            if (prepare) prepare(t);
          }
          return send(t).then(function () {
            cur = code;
            return { ok: true, seat: seat, table: t };
          });
        });
      },

      watchTable: function (code, cb, onErr) {
        cur = code;
        var dead = false, seen = null, es = null, timer = null;

        function deliver(t) {
          if (dead || !t) return;
          var key = JSON.stringify(t);
          if (key === seen) return;
          seen = key;
          cb(t);
        }

        poll(code).then(deliver, function () {});

        try {
          es = new EventSource(RELAY + '/' + topic(code) + '/sse');
          es.onmessage = function (e) {
            var o;
            try { o = JSON.parse(e.data); } catch (err) { return; }
            if (o.event !== 'message' || !o.message) return;
            try { deliver(JSON.parse(o.message)); } catch (err) {}
          };
          es.onerror = function () { /* EventSource переподключается сам */ };
        } catch (e) {
          if (onErr) onErr({ code: 'unavailable', message: 'нет подписки' });
        }

        /* страховка на случай разрыва: тихо перечитываем тему */
        timer = setInterval(function () {
          poll(code).then(deliver, function () {});
        }, 25000);

        /* вернулись из фона — сразу подтягиваем ходы, не ждём таймера */
        function wake() { if (!document.hidden) poll(code).then(deliver, function () {}); }
        document.addEventListener('visibilitychange', wake);

        return function () {
          dead = true;
          clearInterval(timer);
          document.removeEventListener('visibilitychange', wake);
          if (es) es.close();
        };
      },

      write: function (body) {
        if (!cur) return Promise.resolve();
        body.code = cur;
        return send(body);
      },

      peek: function (code) { return poll(code); },
      here: function () {},
      watchPeers: function () { return function () {}; }
    };
  }

  /* ---------- транспорт 3: свой сервер ---------- */

  /* Стол ведёт сервер: он бросает кости, проверяет ходы, считает время.
     Телефон только просит — «вот мой ход», «давай заново» — и ждёт
     перемен. Место за столом держится секретным ключом стола. */
  function srvTransport(api) {
    var keys = {};
    try { keys = JSON.parse(localStorage.getItem('nardy.keys') || '{}') || {}; } catch (e) { keys = {}; }

    function keep(code, key) {
      if (!code || !key) return;
      delete keys[code];
      keys[code] = key;
      var list = Object.keys(keys);
      while (list.length > 10) delete keys[list.shift()];
      try { localStorage.setItem('nardy.keys', JSON.stringify(keys)); } catch (e) {}
    }

    /* JSON уходит обычным текстом: так браузер не шлёт перед каждым
       ходом предварительный запрос, и ход доходит вдвое быстрее. */
    function post(path, body, signal) {
      return fetch(api + path, { method: 'POST', body: JSON.stringify(body), signal: signal, cache: 'no-store' })
        .then(function (r) {
          return r.json().then(function (d) {
            if (r.status >= 500) { var e = new Error(d.error || 'server'); e.status = r.status; throw e; }
            d.status = r.status;
            if (d.table) clock(d.table.now);
            return d;
          }, function () {
            var e = new Error('bad answer'); e.status = r.status; throw e;
          });
        });
    }

    function clock(now) { if (now) skew = now - Date.now(); }

    function who(w) {
      return {
        id: myId,
        name: (w && w.name) || myName || 'Игрок',
        photo: (w && w.photo) || ''
      };
    }
    function tg() { return global.NardyTG ? NardyTG.initData() : ''; }

    /* Просьбы игрока идут по одной и повторяются, пока связь не вернётся.
       Ответ с ошибкой — тоже ответ: в нём свежий стол, по нему и выравниваемся. */
    var queue = [], sending = false, tries = 0;

    function pump() {
      if (sending || !queue.length) return;
      sending = true;
      var job = queue[0];
      post(job.path, job.body).then(function (d) {
        sending = false;
        queue.shift();
        if (tries && global.NardyNet && NardyNet.onBack) NardyNet.onBack();
        tries = 0;
        job.ok(d);
        pump();
      }, function (e) {
        sending = false;
        if (e && e.status >= 500 && tries >= 4) { queue.shift(); job.ok({ error: 'server' }); tries = 0; pump(); return; }
        tries++;
        if (tries === 1 && global.NardyNet && NardyNet.onLost) NardyNet.onLost();
        setTimeout(pump, Math.min(10000, 600 * Math.pow(2, tries - 1)));
      });
    }

    function ask(path, extra) {
      var body = { code: cur, key: keys[cur] };
      for (var k in extra) body[k] = extra[k];
      return new Promise(function (ok) {
        queue.push({ path: path, body: body, ok: ok });
        pump();
      });
    }

    var cur = null;

    function seated(d) {
      if (d.error) return { ok: false, why: d.error };
      cur = d.table.code;
      keep(cur, d.key);
      return { ok: true, seat: d.seat, table: d.table, code: cur };
    }

    return {
      kind: 'srv',
      hasLobby: false,
      hasPresence: true,
      authoritative: true,

      watchLobby: function (cb) { cb([]); return function () {}; },

      create: function (body) {
        return post('/api/table', { seat: body.seat, opts: body.opts, who: who(body.who), initData: tg() })
          .then(function (d) { return seated(d); });
      },

      sit: function (code, seat, w) {
        return post('/api/table/sit', { code: code, key: keys[code], who: who(w), initData: tg() })
          .then(function (d) { return seated(d); });
      },

      /* Долгое ожидание: сервер держит запрос, пока на столе ничего не
         случилось (до 25 секунд), и отвечает сразу, как только случилось. */
      watchTable: function (code, cb, onErr) {
        cur = code;
        var dead = false, after = -1, ctl = null, fails = 0, timer = null;

        function loop() {
          if (dead) return;
          clearTimeout(timer);
          ctl = typeof AbortController === 'function' ? new AbortController() : null;
          var mine = ctl;
          post('/api/table/watch', { code: code, key: keys[code], after: after }, ctl && ctl.signal)
            .then(function (d) {
              if (dead || mine !== ctl) return;
              if (d.status === 404) { dead = true; cb(null); return; }
              fails = 0;
              if (d.table) { after = d.table.seq; cb(d.table); }
              loop();
            }, function (e) {
              if (dead || mine !== ctl) return;          /* сами оборвали — уже ждём заново */
              fails++;
              if (fails === 3 && onErr) onErr(e);
              timer = setTimeout(loop, Math.min(8000, 400 * Math.pow(2, fails)));
            });
        }

        /* из фона iOS мог оборвать запрос молча — начинаем ждать заново сразу */
        function wake() {
          if (document.hidden || dead) return;
          if (ctl) ctl.abort();
          ctl = null;
          loop();
        }
        document.addEventListener('visibilitychange', wake);
        loop();

        return function () {
          dead = true;
          clearTimeout(timer);
          document.removeEventListener('visibilitychange', wake);
          if (ctl) ctl.abort();
        };
      },

      write: function () { return Promise.resolve(); },

      peek: function (code) {
        return post('/api/table/watch', { code: code, key: keys[code], after: -1 })
          .then(function (d) { return d.table || null; });
      },

      turn: function (game, ply, moves) { return ask('/api/table/turn', { game: game, ply: ply, moves: moves }); },
      offer: function () { return ask('/api/table/offer', {}); },
      answer: function (yes) { return ask('/api/table/answer', { yes: !!yes }); },
      again: function () { return ask('/api/table/again', {}); },

      here: function () {},
      watchPeers: function () { return function () {}; }
    };
  }

  /* ---------- выбор транспорта ---------- */

  var skew = 0;           /* насколько часы сервера впереди наших */

  function connect() {
    if (boot) return boot;
    boot = pickTransport().then(function (t) { T = t; return t; });
    return boot;
  }

  function pickTransport() {
    if (global.claude && typeof global.claude.use === 'function') {
      return global.claude.use('db').then(function (db) {
        if (!db) return relayIfPossible();
        return global.claude.use('room').then(
          function (room) { return dbTransport(db, room || null); },
          function () { return dbTransport(db, null); }
        );
      }, function () { return relayIfPossible(); });
    }
    var api = global.NardyAccount && NardyAccount.api();
    if (api && typeof fetch === 'function') return Promise.resolve(srvTransport(api));
    if (global.NardyFB && NardyFB.ready() && !global.claude) {
      return Promise.resolve(NardyFB.transport(function () { return myId; }, function () { return myName; }));
    }
    return Promise.resolve(relayIfPossible());
  }

  /* Ретранслятор нужен снаружи: со страницы артефакта наружу не пускает
     политика безопасности, а с file:// запросы часто рубит CORS. */
  function relayIfPossible() {
    if (global.claude && typeof global.claude.use === 'function') return null;
    if (global.location.protocol !== 'http:' && global.location.protocol !== 'https:') return null;
    if (typeof fetch !== 'function' || typeof EventSource !== 'function') return null;
    return relayTransport();
  }

  function api(name) {
    return function () {
      if (!T) return name === 'watchLobby' || name === 'watchPeers' || name === 'watchTable'
        ? function () {} : Promise.resolve(null);
      return T[name].apply(T, arguments);
    };
  }

  global.NardyNet = {
    connect: connect,
    id: function () { return myId; },
    name: function () { return myName; },
    rename: function (n) {
      myName = (n || '').slice(0, 18);
      try { localStorage.setItem('nardy.name', myName); } catch (e) {}
    },
    kind: function () { return T ? T.kind : null; },
    hasLobby: function () { return !!(T && T.hasLobby); },
    hasRoom: function () { return !!(T && T.hasPresence); },
    /* стол ведёт сервер — телефон ничего не пишет сам */
    authoritative: function () { return !!(T && T.authoritative); },
    /* время по часам сервера — для отсчёта хода */
    now: function () { return T && T.now ? T.now() : Date.now() + skew; },
    watchLobby: api('watchLobby'),
    create: api('create'),
    sit: api('sit'),
    watchTable: api('watchTable'),
    write: api('write'),
    peek: api('peek'),
    here: api('here'),
    watchPeers: api('watchPeers'),
    turn: api('turn'),
    offer: api('offer'),
    answer: api('answer'),
    again: api('again'),
    leave: function () { if (T) T.here(null, null); }
  };
})(window);
