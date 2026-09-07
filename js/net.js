/* ============================================================
   Сетевой стол. Два транспорта под одним интерфейсом:

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

    /* последнее состояние стола: берём самое свежее сообщение темы */
    function poll(code) {
      return fetch(RELAY + '/' + topic(code) + '/json?poll=1&since=12h', { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.text() : ''; })
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

    function send(body) {
      return fetch(RELAY + '/' + topic(body.code), {
        method: 'POST',
        body: JSON.stringify(body)
      }).then(function (r) {
        if (!r.ok) throw new Error('relay ' + r.status);
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

        return function () {
          dead = true;
          clearInterval(timer);
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

  /* ---------- выбор транспорта ---------- */

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
    watchLobby: api('watchLobby'),
    create: api('create'),
    sit: api('sit'),
    watchTable: api('watchTable'),
    write: api('write'),
    peek: api('peek'),
    here: api('here'),
    watchPeers: api('watchPeers'),
    leave: function () { if (T) T.here(null, null); }
  };
})(window);
