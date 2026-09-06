/* ============================================================
   Заглушка хранилища для локальной отладки: ?mock=1
   Повторяет ту часть API артефакта, которой пользуется net.js,
   и синхронизирует вкладки одного браузера через BroadcastChannel.
   В собранную версию не попадает.
   ============================================================ */
(function (global) {
  'use strict';
  if (!/[?&]mock=1/.test(global.location.search)) return;

  var KEY = 'nardy.mockdb';
  var chan = ('BroadcastChannel' in global) ? new BroadcastChannel(KEY) : null;
  var subs = [];

  function all() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; }
  }
  function commit(m) {
    localStorage.setItem(KEY, JSON.stringify(m));
    if (chan) chan.postMessage(Date.now());
    fire();
  }
  function fire() { subs.slice().forEach(function (f) { try { f(); } catch (e) {} }); }
  if (chan) chan.onmessage = fire;
  global.addEventListener('storage', function (e) { if (e.key === KEY) fire(); });

  function snap(id, body) {
    return {
      id: id,
      exists: !!body,
      data: function () { return body ? JSON.parse(JSON.stringify(body)) : undefined; },
      metadata: { fromCache: false, hasPendingWrites: false }
    };
  }

  function docRef(path) {
    var id = path.split('/').pop();
    return {
      id: id,
      path: path,
      get: function () { return Promise.resolve(snap(id, all()[path])); },
      set: function (body) {
        var m = all(); m[path] = JSON.parse(JSON.stringify(body)); commit(m);
        return Promise.resolve();
      },
      update: function (body) {
        var m = all();
        if (!m[path]) return Promise.reject({ code: 'invalid_argument', message: 'нет документа' });
        Object.keys(body).forEach(function (k) { m[path][k] = body[k]; });
        commit(m);
        return Promise.resolve();
      },
      delete: function () { var m = all(); delete m[path]; commit(m); return Promise.resolve(); },
      acquire: function (o) {
        var m = all(), k = '__lease/' + path, now = Date.now(), l = m[k];
        if (l && l.until > now && l.holder !== o.holder) {
          return Promise.resolve({ acquired: false, expiresAt: new Date(l.until).toISOString() });
        }
        m[k] = { holder: o.holder, until: now + (o.ttlMs || 30000) };
        commit(m);
        return Promise.resolve({ acquired: true, holder: o.holder });
      },
      onSnapshot: function (next) {
        var last = null;
        function tick() {
          var body = all()[path], s = JSON.stringify(body || null);
          if (s === last) return;
          last = s;
          next(snap(id, body));
        }
        subs.push(tick);
        setTimeout(tick, 0);
        return function () { subs = subs.filter(function (f) { return f !== tick; }); };
      },
      collection: function (sub) { return collRef(path + '/' + sub); }
    };
  }

  function collRef(path, ops) {
    ops = ops || { w: [], o: null, n: 1000 };
    function copy(patch) {
      return collRef(path, { w: ops.w.concat(patch.w || []), o: patch.o || ops.o, n: patch.n || ops.n });
    }
    function rows() {
      var m = all(), out = [], depth = path.split('/').length + 1;
      Object.keys(m).forEach(function (k) {
        if (k.indexOf(path + '/') !== 0 || k.split('/').length !== depth) return;
        out.push({ id: k.split('/').pop(), body: m[k] });
      });
      out = out.filter(function (r) {
        return ops.w.every(function (w) {
          var v = r.body[w[0]];
          if (w[1] === '==') return v === w[2];
          if (w[1] === '!=') return v !== w[2];
          if (w[1] === '>') return v > w[2];
          if (w[1] === '<') return v < w[2];
          if (w[1] === '>=') return v >= w[2];
          if (w[1] === '<=') return v <= w[2];
          return true;
        });
      });
      if (ops.o) {
        out.sort(function (a, b) {
          var x = a.body[ops.o[0]], y = b.body[ops.o[0]];
          return ops.o[1] === 'desc' ? (y > x ? 1 : y < x ? -1 : 0) : (x > y ? 1 : x < y ? -1 : 0);
        });
      } else out.sort(function (a, b) { return a.id < b.id ? -1 : 1; });
      return out.slice(0, ops.n);
    }
    function shot() {
      var docs = rows().map(function (r) { return snap(r.id, r.body); });
      return { docs: docs, size: docs.length, empty: !docs.length, docChanges: function () { return []; },
               metadata: { fromCache: false, hasPendingWrites: false } };
    }
    return {
      path: path,
      doc: function (id) { return docRef(path + '/' + (id || 'x' + Math.random().toString(36).slice(2, 9))); },
      add: function (b) { var d = this.doc(); return d.set(b).then(function () { return d; }); },
      where: function (f, op, v) { return copy({ w: [[f, op, v]] }); },
      orderBy: function (f, d) { return copy({ o: [f, d || 'asc'] }); },
      limit: function (n) { return copy({ n: n }); },
      get: function () { return Promise.resolve(shot()); },
      onSnapshot: function (next) {
        var last = null;
        function tick() {
          var s = shot(), key = JSON.stringify(s.docs.map(function (d) { return [d.id, d.data()]; }));
          if (key === last) return;
          last = key;
          next(s);
        }
        subs.push(tick);
        setTimeout(tick, 0);
        return function () { subs = subs.filter(function (f) { return f !== tick; }); };
      }
    };
  }

  var fake = { doc: docRef, collection: function (p) { return collRef(p); } };
  global.claude = {
    use: function (name) {
      return Promise.resolve(name === 'db' ? fake : null);
    }
  };
  console.info('нарды: включено локальное хранилище-заглушка (?mock=1)');
})(window);
