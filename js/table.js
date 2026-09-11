/* ============================================================
   Стол нард — правила ведения партии за столом: жеребьёвка,
   ход целиком, часы, матч, итог. Чистые функции над объектом
   стола, без сети и хранилища.

   Один и тот же файл работает и в браузере (стол в Firebase),
   и на сервере (server/tables.mjs), поэтому стол ведётся
   одинаково, кто бы его ни вёл.
   ============================================================ */
(function (global) {
  'use strict';

  var N = global.Nardy, AI = global.NardyAI;
  var ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var LATE_MAX = 3;                    /* три просрочки подряд — поражение */

  /* Сроки. Меняются только в проверках, чтобы не ждать по минуте */
  var LIMITS = {
    move: 60 * 1000,                   /* время на ход, если стол с часами */
    grace: 1500,                       /* запас на дорогу по сети */
    toss: 3000,                        /* пока идёт жеребьёвка, часы стоят */
    wait: 25 * 1000                    /* сколько сервер держит запрос в ожидании */
  };

  /* ---------- случай ---------- */

  function rnd(n) {
    /* равномерно: хвост байта, который на n не делится, отбрасываем */
    var lim = 256 - (256 % n), b = new Uint8Array(1);
    do global.crypto.getRandomValues(b); while (b[0] >= lim);
    return b[0] % n;
  }
  function die() { return 1 + rnd(6); }

  function code6() {
    var s = '';
    for (var i = 0; i < 6; i++) s += ABC[rnd(ABC.length)];
    return s;
  }

  function clean(s, n) {
    return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, n);
  }

  function codeOf(v) {
    var c = clean(v, 8).toUpperCase();
    return /^[A-Z0-9]{4,8}$/.test(c) ? c : null;
  }

  /* Кто садится. acc — аккаунт Telegram, если он известен.
     look — чем показывать лицо: фото из Telegram, своё фото или медальон */
  function person(who, acc) {
    who = who && typeof who === 'object' ? who : {};
    var photo = clean(acc && acc.photo ? acc.photo : who.photo, 400);
    var look = who.look && typeof who.look === 'object' ? who.look : {};
    return {
      id: clean(who.id, 40) || 'p' + code6().toLowerCase(),
      name: clean(acc && acc.name ? acc.name : who.name, 24) || 'Игрок',
      photo: /^https:\/\//.test(photo) ? photo : '',
      acc: acc ? acc.id : null,
      look: {
        pic: /^(tg|photo|medal)$/.test(look.pic) ? look.pic : 'tg',
        medal: /^[a-z]{2,12}$/.test(look.medal) ? look.medal : 'star'
      }
    };
  }

  /* ---------- стол ---------- */

  function freshTable(code, opts, now) {
    return {
      v: 2, seq: 1, code: code, status: 'open', createdAt: now, updatedAt: now,
      opts: {
        timer: !!(opts && opts.timer),
        to: Math.max(0, Math.min(21, Math.floor(Number(opts && opts.to) || 0)))
      },
      seats: { w: null, b: null },
      state: N.create(),
      tally: { w: 0, b: 0 },
      toss: null, gid: null, game: 0,
      offer: null, declined: 0,
      deadline: 0, late: { w: 0, b: 0 }, six: { w: 0, b: 0 },
      last: null, end: null, match: null
    };
  }

  /* Firebase не хранит пустые списки и null — после чтения
     возвращаем столу привычный вид */
  function normalize(t) {
    if (!t) return t;
    t.seats = t.seats || {};
    t.seats.w = t.seats.w || null;
    t.seats.b = t.seats.b || null;
    t.tally = t.tally || { w: 0, b: 0 };
    t.tally.w = t.tally.w || 0;
    t.tally.b = t.tally.b || 0;
    t.late = t.late || { w: 0, b: 0 };
    t.late.w = t.late.w || 0;
    t.late.b = t.late.b || 0;
    t.six = t.six || { w: 0, b: 0 };
    t.six.w = t.six.w || 0;
    t.six.b = t.six.b || 0;
    t.opts = t.opts || { timer: false, to: 0 };
    t.opts.timer = !!t.opts.timer;
    t.opts.to = t.opts.to || 0;
    ['toss', 'gid', 'offer', 'last', 'end', 'match'].forEach(function (k) {
      if (t[k] === undefined) t[k] = null;
    });
    t.game = t.game || 0;
    t.declined = t.declined || 0;
    t.deadline = t.deadline || 0;
    if (t.last) t.last.moves = t.last.moves || [];
    var st = t.state || N.create();
    st.points = st.points || [];
    for (var i = 0; i < 24; i++) st.points[i] = st.points[i] || 0;
    st.off = st.off || { w: 0, b: 0 };
    st.off.w = st.off.w || 0;
    st.off.b = st.off.b || 0;
    st.roll = st.roll || [];
    st.dice = st.dice || [];
    st.moves = st.moves || [];
    st.turnNo = st.turnNo || { w: 0, b: 0 };
    st.turnNo.w = st.turnNo.w || 0;
    st.turnNo.b = st.turnNo.b || 0;
    st.headUsed = st.headUsed || 0;
    st.winner = st.winner || null;
    t.state = st;
    return t;
  }

  function countSix(t, st) {
    if (st.roll[0] === 6 && st.roll[1] === 6) t.six[st.turn] += 1;
  }

  function startGame(t, now) {
    var st = N.create(), a, b;
    do { a = die(); b = die(); } while (a === b);
    st.turn = a > b ? 'w' : 'b';
    N.setRoll(st, die(), die());
    t.game += 1;
    t.gid = t.code + '-' + t.game + '-' + now.toString(36);
    t.toss = { a: a, b: b, n: now, turn: st.turn };
    t.state = st;
    t.offer = null;
    t.end = null;
    t.last = null;
    t.late = { w: 0, b: 0 };
    t.six = { w: 0, b: 0 };
    countSix(t, st);
    t.deadline = t.opts.timer ? now + LIMITS.move + LIMITS.toss : 0;
  }

  /* Второй игрок сел — партия начинается */
  function seat(t, p, who, now) {
    t.seats[p] = who;
    if (t.seats.w && t.seats.b && t.status === 'open') {
      t.status = 'live';
      startGame(t, now);
    }
  }

  /* Прогоняем присланные шашки через правила по одной. Ход обязан
     быть полным: пока по правилам можно ходить, передавать нельзя. */
  function play(st, moves) {
    var cur = N.clone(st), i, m, legal, ok, j;
    for (i = 0; i < moves.length; i++) {
      m = moves[i];
      if (cur.winner) return 'extra';
      legal = N.legalMoves(cur);
      ok = null;
      for (j = 0; j < legal.length; j++) {
        if (legal[j].from === m.from && legal[j].to === m.to && legal[j].die === m.die) { ok = legal[j]; break; }
      }
      if (!ok) return 'illegal';
      N.applyTo(cur, ok);
    }
    if (!cur.winner && N.legalMoves(cur).length) return 'unfinished';
    return cur;
  }

  function endGame(t, winner, why, now) {
    var loser = N.opp(winner);
    t.state.winner = winner;
    t.tally[winner] += 1;                          /* марс — такое же одно очко */
    t.end = {
      winner: winner, why: why, at: now, gid: t.gid,
      mars: why === 'off' && t.state.off[loser] === 0,
      six: { w: t.six.w, b: t.six.b },
      shutout: false
    };
    t.deadline = 0;
    t.offer = null;
    if (t.opts.to && t.tally[winner] >= t.opts.to) {
      t.match = { over: true, winner: winner, score: { w: t.tally.w, b: t.tally.b } };
      t.end.shutout = t.tally[loser] === 0;
    }
  }

  /* После хода: либо победа, либо следующему игроку сразу бросаем кости */
  function advance(t, cur, by, moves, auto, now) {
    t.last = {
      by: by, auto: !!auto,
      moves: moves.map(function (m) { return { from: m.from, to: m.to, die: m.die }; })
    };
    t.state = cur;
    if (cur.winner) { endGame(t, cur.winner, 'off', now); return; }
    N.endTurn(cur);
    N.setRoll(cur, die(), die());
    countSix(t, cur);
    t.deadline = t.opts.timer ? now + LIMITS.move : 0;
  }

  function overdue(t, now) {
    return t.status === 'live' && !!t.deadline && !t.state.winner && now >= t.deadline + LIMITS.grace;
  }

  /* Время вышло: за игрока ходит компьютер. Третья просрочка подряд — поражение. */
  function settle(t, now) {
    if (!overdue(t, now)) return false;
    var p = t.state.turn;
    t.late[p] += 1;
    if (t.late[p] >= LATE_MAX) {
      t.last = { by: p, moves: [], auto: true };
      endGame(t, N.opp(p), 'time', now);
      return true;
    }
    var path = AI.choose(N.clone(t.state), 'normal');
    var cur = N.clone(t.state);
    path.forEach(function (m) { N.applyTo(cur, m); });
    advance(t, cur, p, path, true, now);
    return true;
  }

  function movesOf(list) {
    if (!Array.isArray(list) || list.length > 4) return null;
    var out = [], i, m, from, to, d;
    for (i = 0; i < list.length; i++) {
      m = list[i];
      if (!m || typeof m !== 'object') return null;
      from = Number(m.from); to = Number(m.to); d = Number(m.die);
      if (!isInt(from) || from < 0 || from > 23) return null;
      if (!isInt(to) || to < -1 || to > 23) return null;
      if (!isInt(d) || d < 1 || d > 6) return null;
      out.push({ from: from, to: to, die: d });
    }
    return out;
  }

  function isInt(x) { return typeof x === 'number' && isFinite(x) && Math.floor(x) === x; }

  /* ---------- просьбы игрока ----------
     Каждая меняет стол на месте и возвращает null, если всё прошло,
     или причину отказа. Номер стола (seq) поднимает тот, кто пишет. */

  var ask = {
    /* Ход целиком. Номер хода (game + ply) защищает от повтора: если ответ
       потерялся и ход прислали ещё раз, второй раз он не пройдёт. */
    turn: function (t, p, body, now) {
      var st = t.state, moves = movesOf(body.moves);
      if (!moves) return 'bad_moves';
      if (t.status !== 'live' || st.winner || st.turn !== p) return 'stale';
      if (Number(body.game) !== t.game || Number(body.ply) !== st.turnNo[p]) return 'stale';
      var cur = play(st, moves);
      if (typeof cur === 'string') return cur;
      t.late[p] = 0;
      advance(t, cur, p, moves, false, now);
      return null;
    },

    /* Предложить переиграть — только посреди партии */
    offer: function (t, p, body, now) {
      if (t.status !== 'live' || t.state.winner) return 'stale';
      if (t.offer) return t.offer.by === p ? null : 'busy';
      t.offer = { by: p, ts: now };
      return null;
    },

    answer: function (t, p, body, now) {
      if (!t.offer || t.offer.by === p) return 'stale';
      if (body.yes) startGame(t, now);            /* неоконченная партия в счёт не идёт */
      else { t.offer = null; t.declined = now; }
      return null;
    },

    /* Следующая партия после окончания. Жмут оба — начнётся одна. */
    again: function (t, p, body, now) {
      if (t.status !== 'live') return 'stale';
      if (!t.state.winner) return t.end ? null : 'stale';
      if (t.match && t.match.over) { t.tally = { w: 0, b: 0 }; t.match = null; }
      startGame(t, now);
      return null;
    }
  };

  /* ---------- итог партии в профиль ---------- */

  function blankUser(who, now) {
    return {
      id: who.id, name: who.name || 'Игрок', photo: who.photo || '', about: '',
      w: 0, l: 0, mars: 0, marsLost: 0,
      streak: 0, best: 0,
      foes: {}, recent: [], badges: {},
      created: now, updated: now
    };
  }

  /* Вписать исход партии в профиль игрока за местом p.
     Возвращает false, если эта партия там уже записана. */
  function recordInto(u, t, p) {
    var e = t.end, me = t.seats[p], foe = t.seats[N.opp(p)];
    var win = p === e.winner, now = e.at, i;
    u.recent = u.recent || [];
    u.badges = u.badges || {};
    u.foes = u.foes || {};
    for (i = 0; i < u.recent.length; i++) if (u.recent[i].gid === e.gid) return false;
    u.w = u.w || 0; u.l = u.l || 0; u.mars = u.mars || 0; u.marsLost = u.marsLost || 0;
    if (win) { u.w += 1; if (e.mars) u.mars += 1; }
    else { u.l += 1; if (e.mars) u.marsLost += 1; }
    u.streak = win ? Math.max(0, u.streak || 0) + 1 : Math.min(0, u.streak || 0) - 1;
    if (u.streak > (u.best || 0)) u.best = u.streak;

    var fk = foe.acc || foe.id;
    var f = u.foes[fk] || { name: foe.name, w: 0, l: 0 };
    f.name = foe.name || f.name;
    f.acc = foe.acc || null;
    f.photo = foe.photo || f.photo || '';
    if (win) f.w += 1; else f.l += 1;
    f.games = f.w + f.l;
    f.last = now;
    u.foes[fk] = f;

    u.recent.unshift({
      gid: e.gid, at: now, win: win, mars: !!e.mars, why: e.why,
      foe: { id: fk, name: foe.name, acc: foe.acc || null }
    });
    u.recent = u.recent.slice(0, 10);

    function badge(name) { if (!u.badges[name]) u.badges[name] = now; }
    if (win && e.mars) badge('mars1');
    if (u.mars >= 10) badge('mars10');
    if (e.six && e.six[p] >= 3) badge('six3');
    if (win && e.shutout) badge('shutout');
    if (u.w + u.l >= 100) badge('game100');

    if (me.name) u.name = me.name;
    if (me.photo && !u.custom) u.photo = me.photo;
    u.updated = now;
    return true;
  }

  /* Профиль для показа: соперники списком, трое частых — братишки */
  function pub(u) {
    var foes = [], id, f;
    for (id in u.foes || {}) {
      f = u.foes[id];
      foes.push({
        id: id, acc: f.acc || null, name: f.name, photo: f.photo || '',
        w: f.w || 0, l: f.l || 0, games: f.games || ((f.w || 0) + (f.l || 0)), last: f.last || 0
      });
    }
    foes.sort(function (a, b) { return b.games - a.games || b.last - a.last; });
    return {
      id: u.id, name: u.name, photo: u.photo || '', about: u.about || '',
      w: u.w || 0, l: u.l || 0, mars: u.mars || 0, marsLost: u.marsLost || 0,
      streak: u.streak || 0, best: u.best || 0,
      recent: u.recent || [], badges: u.badges || {},
      foes: foes.slice(0, 20),
      bros: foes.filter(function (x) { return x.games >= 3; }).slice(0, 3).map(function (x) { return x.id; })
    };
  }

  global.NardyTable = {
    LIMITS: LIMITS,
    die: die, code6: code6, clean: clean, codeOf: codeOf, person: person,
    freshTable: freshTable, normalize: normalize, seat: seat, startGame: startGame,
    overdue: overdue, settle: settle, ask: ask,
    blankUser: blankUser, recordInto: recordInto, pub: pub
  };
})(typeof window !== 'undefined' ? window : globalThis);
