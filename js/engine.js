/* ============================================================
   Длинные нарды — движок правил
   Кольцо из 24 пунктов. Оба игрока идут в сторону возрастания
   индекса. Голова белых — пункт 0, голова чёрных — пункт 12.
   Дом белых — 18..23, дом чёрных — 6..11.
   В points[] белые хранятся положительным числом, чёрные —
   отрицательным.
   ============================================================ */
(function (global) {
  'use strict';

  var WHITE = 'w', BLACK = 'b', OFF = -1, NP = 24, NC = 15;
  var HEAD = { w: 0, b: 12 };

  function opp(p) { return p === WHITE ? BLACK : WHITE; }
  function rel(p, i) { return (i - HEAD[p] + NP) % NP; }
  function absOf(p, r) { return (HEAD[p] + r) % NP; }
  function cnt(st, i, p) { var v = st.points[i]; return p === WHITE ? (v > 0 ? v : 0) : (v < 0 ? -v : 0); }
  function ownerOf(v) { return v > 0 ? WHITE : (v < 0 ? BLACK : null); }
  /* Номер пункта глазами игрока: голова — 24, последний перед выходом — 1 */
  function label(p, i) { return i === OFF ? 'вне' : String(NP - rel(p, i)); }

  function create() {
    var pts = [], i;
    for (i = 0; i < NP; i++) pts.push(0);
    pts[HEAD.w] = NC;
    pts[HEAD.b] = -NC;
    return {
      points: pts,
      off: { w: 0, b: 0 },
      turn: WHITE,
      roll: [],
      dice: [],
      headUsed: 0,
      turnNo: { w: 0, b: 0 },
      moves: [],
      winner: null
    };
  }

  function clone(st) {
    return {
      points: st.points.slice(),
      off: { w: st.off.w, b: st.off.b },
      turn: st.turn,
      roll: st.roll.slice(),
      dice: st.dice.slice(),
      headUsed: st.headUsed,
      turnNo: { w: st.turnNo.w, b: st.turnNo.b },
      moves: st.moves.slice(),
      winner: st.winner
    };
  }

  function setRoll(st, d1, d2) {
    st.roll = [d1, d2];
    st.dice = (d1 === d2) ? [d1, d1, d1, d1] : [d1, d2];
    st.headUsed = 0;
    st.moves = [];
    return st;
  }

  function endTurn(st) {
    st.turnNo[st.turn]++;
    st.turn = opp(st.turn);
    st.roll = [];
    st.dice = [];
    st.headUsed = 0;
    st.moves = [];
    return st;
  }

  /* Со скольких шашек можно снять с головы за этот ход.
     Первый ход игрока при дубле 3-3, 4-4, 6-6 — две шашки. */
  function headLimit(st, p) {
    if (st.turnNo[p] === 0 && st.roll.length === 2 && st.roll[0] === st.roll[1] &&
        (st.roll[0] === 3 || st.roll[0] === 4 || st.roll[0] === 6)) return 2;
    return 1;
  }

  function allHome(st, p) {
    for (var i = 0; i < NP; i++) {
      if (cnt(st, i, p) > 0 && rel(p, i) < 18) return false;
    }
    return true;
  }

  /* Самая дальняя от выхода своя шашка (минимальный rel) */
  function tailRel(st, p) {
    var m = 99;
    for (var i = 0; i < NP; i++) {
      if (cnt(st, i, p) > 0) { var r = rel(p, i); if (r < m) m = r; }
    }
    return m;
  }

  function pips(st, p) {
    var s = 0;
    for (var i = 0; i < NP; i++) {
      var c = cnt(st, i, p);
      if (c) s += (NP - rel(p, i)) * c;
    }
    return s;
  }

  /* Правило шести: нельзя запереть все 15 шашек соперника
     непрерывным блоком из шести своих пунктов. */
  function blockLegal(st, p) {
    var q = opp(p), start, k, j, ok, front, ahead, r;
    /* если все шашки соперника уже в его доме — блок ему не мешает выйти */
    var allQHome = true;
    for (j = 0; j < NP; j++) if (cnt(st, j, q) > 0 && rel(q, j) < 18) { allQHome = false; break; }
    if (allQHome || st.off[q] > 0) return true;

    for (start = 0; start < NP; start++) {
      ok = true;
      for (k = 0; k < 6; k++) {
        if (cnt(st, (start + k) % NP, p) === 0) { ok = false; break; }
      }
      if (!ok) continue;
      front = -1;
      for (k = 0; k < 6; k++) {
        r = rel(q, (start + k) % NP);
        if (r > front) front = r;
      }
      ahead = false;
      for (j = 0; j < NP; j++) {
        if (cnt(st, j, q) > 0 && rel(q, j) > front) { ahead = true; break; }
      }
      if (!ahead) return false;
    }
    return true;
  }

  function applyTo(st, mv) {
    var p = st.turn, sgn = (p === WHITE ? 1 : -1);
    st.points[mv.from] -= sgn;
    if (mv.to === OFF) st.off[p]++;
    else st.points[mv.to] += sgn;
    if (mv.from === HEAD[p]) st.headUsed++;
    var k = st.dice.indexOf(mv.die);
    if (k >= 0) st.dice.splice(k, 1);
    st.moves.push(mv);
    if (st.off[p] === NC) st.winner = p;
    return st;
  }

  /* Все ходы, законные по «локальным» правилам: занятость пункта,
     голова, снятие с поля, правило шести. Без учёта обязательного
     использования максимума костей. */
  function rawMoves(st) {
    var p = st.turn, res = [], used = {}, i, d, di, c, r, nr, to, mv, ns;
    if (st.winner || !st.dice.length) return res;
    var hl = headLimit(st, p);
    var home = allHome(st, p);
    var tail = home ? tailRel(st, p) : -1;
    var seenDie = {};
    for (di = 0; di < st.dice.length; di++) {
      d = st.dice[di];
      if (seenDie[d]) continue;
      seenDie[d] = 1;
      for (i = 0; i < NP; i++) {
        c = cnt(st, i, p);
        if (!c) continue;
        if (i === HEAD[p] && st.headUsed >= hl) continue;
        r = rel(p, i);
        nr = r + d;
        if (nr < NP) {
          to = absOf(p, nr);
          if (ownerOf(st.points[to]) === opp(p)) continue;
          mv = { from: i, to: to, die: d };
        } else {
          if (!home) continue;
          /* точный бросок — всегда можно; больший — только с самой дальней шашки */
          if (nr > NP && r !== tail) continue;
          mv = { from: i, to: OFF, die: d };
        }
        ns = clone(st);
        applyTo(ns, mv);
        if (!blockLegal(ns, p)) continue;
        res.push(mv);
      }
    }
    return res;
  }

  function stKey(st) {
    return st.points.join(',') + '|' + st.dice.slice().sort().join('') + '|' + st.headUsed;
  }

  /* Максимальное число костей, которое ещё можно разыграть */
  function maxDepth(st, memo) {
    if (!st.dice.length || st.winner) return 0;
    var k = stKey(st);
    if (memo[k] !== undefined) return memo[k];
    memo[k] = 0;
    var mv = rawMoves(st), best = 0, i, ns, d;
    for (i = 0; i < mv.length; i++) {
      ns = clone(st);
      applyTo(ns, mv[i]);
      d = 1 + maxDepth(ns, memo);
      if (d > best) best = d;
      if (best === st.dice.length) break;
    }
    memo[k] = best;
    return best;
  }

  /* Законные ходы с учётом обязанности разыграть максимум костей
     и старшую кость, если играется только одна. */
  function legalMoves(st, memo) {
    memo = memo || {};
    var raw = rawMoves(st);
    if (!raw.length) return raw;
    var depths = [], best = 0, i, ns, d;
    for (i = 0; i < raw.length; i++) {
      ns = clone(st);
      applyTo(ns, raw[i]);
      d = 1 + maxDepth(ns, memo);
      depths.push(d);
      if (d > best) best = d;
    }
    var res = [];
    for (i = 0; i < raw.length; i++) if (depths[i] === best) res.push(raw[i]);
    if (best === 1 && st.dice.length === 2 && st.dice[0] !== st.dice[1]) {
      var big = Math.max(st.dice[0], st.dice[1]), f = [];
      for (i = 0; i < res.length; i++) if (res[i].die === big) f.push(res[i]);
      if (f.length) res = f;
    }
    return res;
  }

  /* Все возможные полные ходы (последовательности), без повторов позиции */
  function sequences(st, cap) {
    var memo = {}, out = [], seen = {}, nodes = 0;
    cap = cap || 60000;
    function dfs(s, path) {
      if (nodes++ > cap) return;
      var mv = s.winner ? [] : legalMoves(s, memo);
      if (!mv.length) {
        var k = s.points.join(',') + '|' + s.off.w + '|' + s.off.b;
        if (!seen[k]) { seen[k] = 1; out.push({ state: s, path: path }); }
        return;
      }
      for (var i = 0; i < mv.length; i++) {
        var ns = clone(s);
        applyTo(ns, mv[i]);
        dfs(ns, path.concat([mv[i]]));
      }
    }
    dfs(clone(st), []);
    return out;
  }

  /* Куда может дойти одна шашка за весь ход, включая сумму костей:
     при 6-4 это и +6, и +4, и +10. Каждый шаг обязан быть законным
     сам по себе — перепрыгнуть занятый пункт нельзя. */
  function chains(st, from) {
    var out = {}, memo = {}, seen = {};

    function walk(s, at, path) {
      if (path.length > 4) return;
      var key = s.points.join(',') + '|' + at + '|' + s.dice.slice().sort().join('');
      if (seen[key]) return;
      seen[key] = 1;
      var mv = legalMoves(s, memo), i, m, ns, p;
      for (i = 0; i < mv.length; i++) {
        m = mv[i];
        if (m.from !== at) continue;
        ns = clone(s);
        applyTo(ns, m);
        p = path.concat([m]);
        if (!out[m.to] || out[m.to].length > p.length) out[m.to] = p;
        if (m.to !== OFF) walk(ns, m.to, p);
      }
    }

    walk(clone(st), from, []);
    return out;
  }

  function rollDie() { return 1 + Math.floor(Math.random() * 6); }

  global.Nardy = {
    WHITE: WHITE, BLACK: BLACK, OFF: OFF, NP: NP, NC: NC, HEAD: HEAD,
    opp: opp, rel: rel, absOf: absOf, cnt: cnt, ownerOf: ownerOf, label: label,
    create: create, clone: clone, setRoll: setRoll, endTurn: endTurn,
    headLimit: headLimit, allHome: allHome, pips: pips, blockLegal: blockLegal,
    applyTo: applyTo, rawMoves: rawMoves, legalMoves: legalMoves,
    maxDepth: maxDepth, sequences: sequences, chains: chains, rollDie: rollDie
  };
})(window);
