/* ============================================================
   Статистика на самом телефоне. У игроков из Telegram партии
   с людьми ещё и в общей базе (js/fb.js) — это главный счёт;
   здесь то, что есть всегда: игры с компьютером, последние
   партии и счёт гостя. Копим сводку, а не список всех партий —
   она не растёт со временем.
   ============================================================ */
(function (global) {
  'use strict';

  var KEY = 'nardy.stats';
  var data = null;

  function side() { return { w: 0, l: 0, mars: 0, marsLost: 0 }; }

  function blank() {
    return { v: 1, total: side(), foes: {}, kinds: { net: side(), ai: side() }, recent: [], streak: 0, best: 0, badges: {} };
  }

  function load() {
    if (data) return data;
    try {
      data = JSON.parse(localStorage.getItem(KEY) || 'null');
    } catch (e) { data = null; }
    if (!data || data.v !== 1 || !data.foes) data = blank();
    /* старые записи: счёт по видам восстанавливаем по соперникам */
    if (!data.kinds) {
      data.kinds = { net: side(), ai: side() };
      for (var id in data.foes) {
        var f = data.foes[id], k = data.kinds[f.kind === 'net' ? 'net' : 'ai'];
        k.w += f.w; k.l += f.l;
      }
    }
    data.recent = data.recent || [];
    data.badges = data.badges || {};
    data.streak = data.streak || 0;
    data.best = data.best || 0;
    return data;
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) {}
  }

  /* foe: {id, name, kind}, kind — 'net' | 'ai'.
     extra: {six — сколько раз я выбросил 6-6 за партию, shutout — матч всухую} */
  function record(foe, win, mars, extra) {
    load();
    extra = extra || {};
    var now = Date.now();
    [data.total, data.kinds[foe.kind === 'net' ? 'net' : 'ai']].forEach(function (t) {
      if (win) { t.w++; if (mars) t.mars++; }
      else { t.l++; if (mars) t.marsLost++; }
    });

    var id = (foe.kind === 'net' ? 'n:' : foe.kind === 'ai' ? 'a:' : 'd:') + (foe.id || foe.name || '?');
    var f = data.foes[id];
    if (!f) f = data.foes[id] = { id: id, name: foe.name || 'Соперник', kind: foe.kind, w: 0, l: 0 };
    f.name = foe.name || f.name;
    f.kind = foe.kind;
    f.acc = foe.acc || f.acc || null;
    if (win) f.w++; else f.l++;
    f.last = now;

    data.recent.unshift({ at: now, win: !!win, mars: !!mars, kind: foe.kind, name: foe.name || 'Соперник', acc: foe.acc || null });
    data.recent = data.recent.slice(0, 10);

    /* серии и наколки — только за людей */
    if (foe.kind === 'net') {
      data.streak = win ? Math.max(0, data.streak) + 1 : Math.min(0, data.streak) - 1;
      if (data.streak > data.best) data.best = data.streak;
      var k = data.kinds.net;
      if (win && mars) mark('mars1', now);
      if (k.mars >= 10) mark('mars10', now);
      if ((extra.six || 0) >= 3) mark('six3', now);
      if (win && extra.shutout) mark('shutout', now);
      if (k.w + k.l >= 100) mark('game100', now);
    }
    save();
  }

  function mark(name, now) { if (!data.badges[name]) data.badges[name] = now; }

  function summary() {
    load();
    var list = [], id;
    for (id in data.foes) {
      var f = data.foes[id];
      list.push({ id: id, acc: f.acc || null, name: f.name, kind: f.kind, w: f.w, l: f.l, games: f.w + f.l, last: f.last || 0 });
    }
    /* братишки — живые соперники, с кем сыграно больше всего,
       и не всякий встречный: нужно сыграть хотя бы три партии */
    var live = list.filter(function (f) { return f.kind === 'net'; })
      .sort(function (a, b) { return b.games - a.games || b.last - a.last; });
    var bros = {};
    live.slice(0, 3).forEach(function (f) { if (f.games >= 3) bros[f.id] = true; });
    list.sort(function (a, b) { return b.games - a.games || b.last - a.last; });
    return {
      total: data.total, people: data.kinds.net, ai: data.kinds.ai,
      foes: list, bros: bros, recent: data.recent,
      streak: data.streak, best: data.best, badges: data.badges
    };
  }

  function reset() { data = blank(); save(); }

  global.NardyStats = { record: record, summary: summary, reset: reset };
})(window);
