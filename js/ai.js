/* ============================================================
   Длинные нарды — оценка позиции и выбор хода компьютером
   ============================================================ */
(function (global) {
  'use strict';

  var N = global.Nardy;
  var NP = N.NP;

  /* Оценка позиции глазами игрока p. Больше — лучше. */
  function side(st, p) {
    var i, c, r, progress = 0, head = 0, spots = 0, stack = 0, homeCnt = 0;
    for (i = 0; i < NP; i++) {
      c = N.cnt(st, i, p);
      if (!c) continue;
      r = N.rel(p, i);
      progress += r * c;
      spots++;
      if (i === N.HEAD[p]) head = c;
      if (r >= 18) homeCnt += c;
      if (c > 4) stack += (c - 4);
    }
    var s = 0;
    s += st.off[p] * 34;          /* снятая шашка дороже любого продвижения */
    s += progress * 0.85;
    s -= head * head * 0.30;      /* куча на голове — потерянные темпы */
    s += spots * 2.2;             /* занятые пункты: пространство и выбор */
    s -= stack * 1.4;             /* башни выше четырёх бесполезны */
    s += homeCnt * 0.7;
    s += blocks(st, p);
    return s;
  }

  /* Непрерывные цепочки своих пунктов; ценнее, если запирают соперника */
  function blocks(st, p) {
    var q = N.opp(p), occ = [], k, total = 0;
    for (k = 0; k < NP; k++) occ.push(N.cnt(st, N.absOf(p, k), p) > 0);
    k = 0;
    while (k < NP) {
      if (!occ[k]) { k++; continue; }
      var a = k;
      while (k < NP && occ[k]) k++;
      var len = k - a;
      if (len < 2) continue;
      var front = -1, m, r;
      for (m = a; m < a + len; m++) {
        r = N.rel(q, N.absOf(p, m));
        if (r > front) front = r;
      }
      var behind = 0, j;
      for (j = 0; j < NP; j++) {
        var c = N.cnt(st, j, q);
        if (c && N.rel(q, j) < front) behind += c;
      }
      total += len * len * (behind ? 0.85 : 0.2);
      if (len >= 4) total += behind * 0.8;
    }
    return total;
  }

  function evaluate(st, p) {
    return side(st, p) - side(st, N.opp(p)) * 0.92;
  }

  /* Быстрый «жадный» ответ соперника — для перебора на уровне «мастер» */
  function greedyPlay(st) {
    var s = N.clone(st), guard = 0;
    while (s.dice.length && !s.winner && guard++ < 6) {
      var mv = N.rawMoves(s);
      if (!mv.length) break;
      var best = null, bestV = -1e9, i, ns, v;
      for (i = 0; i < mv.length; i++) {
        ns = N.clone(s); N.applyTo(ns, mv[i]);
        v = evaluate(ns, s.turn);
        if (v > bestV) { bestV = v; best = mv[i]; }
      }
      N.applyTo(s, best);
    }
    return s;
  }

  var ROLLS = (function () {
    var r = [], a, b;
    for (a = 1; a <= 6; a++) for (b = a; b <= 6; b++) r.push([a, b, a === b ? 1 : 2]);
    return r;
  })();

  /* Матожидание оценки после ответа соперника */
  function afterReply(st, p, deadline) {
    var total = 0, weight = 0, i;
    for (i = 0; i < ROLLS.length; i++) {
      if (Date.now() > deadline) break;
      var s = N.clone(st);
      N.endTurn(s);
      N.setRoll(s, ROLLS[i][0], ROLLS[i][1]);
      var after = greedyPlay(s);
      total += evaluate(after, p) * ROLLS[i][2];
      weight += ROLLS[i][2];
    }
    return weight ? total / weight : evaluate(st, p);
  }

  /* Выбор полного хода. level: 'easy' | 'normal' | 'hard' */
  function choose(st, level) {
    var seqs = N.sequences(st);
    if (!seqs.length) return [];
    var p = st.turn, i;
    for (i = 0; i < seqs.length; i++) {
      seqs[i].score = evaluate(seqs[i].state, p);
    }

    if (level === 'easy') {
      for (i = 0; i < seqs.length; i++) seqs[i].score += (Math.random() - 0.5) * 55;
      seqs.sort(byScore);
      /* иногда новичок просто ошибается */
      var pick = Math.random() < 0.22 ? Math.floor(Math.random() * seqs.length) : 0;
      return seqs[pick].path;
    }

    seqs.sort(byScore);
    if (level !== 'hard' || seqs.length === 1) return seqs[0].path;

    var top = seqs.slice(0, Math.min(7, seqs.length));
    var deadline = Date.now() + 900;
    for (i = 0; i < top.length; i++) {
      top[i].score = top[i].score * 0.25 + afterReply(top[i].state, p, deadline) * 0.75;
    }
    top.sort(byScore);
    return top[0].path;
  }

  function byScore(a, b) { return b.score - a.score; }

  global.NardyAI = { choose: choose, evaluate: evaluate };
})(typeof window !== 'undefined' ? window : globalThis);
