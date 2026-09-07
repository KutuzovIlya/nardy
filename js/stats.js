/* ============================================================
   Профиль игрока. Сервера нет, поэтому история лежит на самом
   устройстве: это своя статистика для себя, подделывать её
   некому и незачем. Копим не список партий, а сводку —
   она не растёт со временем.
   ============================================================ */
(function (global) {
  'use strict';

  var KEY = 'nardy.stats';
  var data = null;

  function blank() {
    return { v: 1, total: { w: 0, l: 0, mars: 0, marsLost: 0 }, foes: {} };
  }

  function load() {
    if (data) return data;
    try {
      data = JSON.parse(localStorage.getItem(KEY) || 'null');
    } catch (e) { data = null; }
    if (!data || data.v !== 1 || !data.foes) data = blank();
    return data;
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) {}
  }

  /* foe: {id, name, kind}, kind — 'net' | 'ai' | 'duo' */
  function record(foe, win, mars) {
    load();
    var t = data.total;
    if (win) { t.w++; if (mars) t.mars++; }
    else { t.l++; if (mars) t.marsLost++; }

    var id = (foe.kind === 'net' ? 'n:' : foe.kind === 'ai' ? 'a:' : 'd:') + (foe.id || foe.name || '?');
    var f = data.foes[id];
    if (!f) f = data.foes[id] = { id: id, name: foe.name || 'Соперник', kind: foe.kind, w: 0, l: 0 };
    f.name = foe.name || f.name;
    f.kind = foe.kind;
    if (win) f.w++; else f.l++;
    f.last = Date.now();
    save();
  }

  function summary() {
    load();
    var list = [], id;
    for (id in data.foes) {
      var f = data.foes[id];
      list.push({ id: id, name: f.name, kind: f.kind, w: f.w, l: f.l, games: f.w + f.l, last: f.last || 0 });
    }
    /* братишки — живые соперники, с кем сыграно больше всего */
    var live = list.filter(function (f) { return f.kind === 'net'; })
      .sort(function (a, b) { return b.games - a.games || b.last - a.last; });
    /* братишка — не всякий встречный: нужно сыграть хотя бы три партии */
    var bros = {};
    live.slice(0, 3).forEach(function (f) { if (f.games >= 3) bros[f.id] = true; });
    list.sort(function (a, b) { return b.games - a.games || b.last - a.last; });
    return { total: data.total, foes: list, bros: bros };
  }

  function reset() { data = blank(); save(); }

  global.NardyStats = { record: record, summary: summary, reset: reset };
})(window);
