/* ============================================================
   Сетевой стол на сервере.

   Пишет стол только сервер: бросает кости, проверяет каждый ход
   теми же правилами, что и игра в браузере, следит за временем
   и сам записывает итог. Игроки лишь просят: «вот мой ход»,
   «давай заново». Подделать бросок, ход или победу со своего
   телефона нельзя — поэтому и подтверждать итог вдвоём больше
   не нужно.

   Место за столом закреплено секретным ключом. Его получает
   только севший, соперник ключа не видит.
   ============================================================ */
import { N, AI } from './rules.mjs';

const ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TTL = 3 * 24 * 3600 * 1000;      /* стол без движения живёт трое суток */
const LATE_MAX = 3;                    /* три просрочки подряд — поражение */

/* Сроки. Меняются только в проверках, чтобы не ждать по минуте */
export const LIMITS = {
  move: 60 * 1000,                     /* время на ход, если стол с таймером */
  grace: 1500,                         /* запас на дорогу по сети */
  toss: 3000,                          /* пока идёт жеребьёвка, часы стоят */
  wait: 25 * 1000                      /* сколько держим запрос в ожидании перемен */
};

/* ---------- мелочи ---------- */

function rnd(n) {
  /* равномерно: хвост байта, который на n не делится, отбрасываем */
  const lim = 256 - (256 % n), b = new Uint8Array(1);
  do crypto.getRandomValues(b); while (b[0] >= lim);
  return b[0] % n;
}
const die = () => 1 + rnd(6);

function code6() {
  let s = '';
  for (let i = 0; i < 6; i++) s += ABC[rnd(ABC.length)];
  return s;
}

function secret() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

function clean(s, n) {
  return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, n);
}

function codeOf(v) {
  const c = clean(v, 8).toUpperCase();
  return /^[A-Z0-9]{4,8}$/.test(c) ? c : null;
}

/* Кто садится. Если вход через Telegram подтверждён — имя и фото
   берём оттуда, а не из того, что прислал телефон. */
function person(who, acc) {
  who = who && typeof who === 'object' ? who : {};
  const photo = clean(acc && acc.photo ? acc.photo : who.photo, 400);
  return {
    id: clean(who.id, 40) || 'p' + secret().slice(0, 8),
    name: clean(acc ? acc.name : who.name, 24) || 'Игрок',
    photo: /^https:\/\//.test(photo) ? photo : '',
    acc: acc ? acc.id : null
  };
}

function seatOf(t, key) {
  if (!t || !t.keys || typeof key !== 'string' || !key) return null;
  if (t.keys.w === key) return 'w';
  if (t.keys.b === key) return 'b';
  return null;
}

function bump(t, now) {
  t.seq += 1;
  t.updatedAt = now;
  return t;
}

/* Что уходит игрокам: всё, кроме ключей */
function view(t, seen) {
  const out = Object.assign({}, t);
  delete out.keys;
  out.seen = seen || {};
  out.now = Date.now();
  return out;
}

/* ---------- ход партии ---------- */

function countSix(t, st) {
  if (st.roll[0] === 6 && st.roll[1] === 6) t.six[st.turn] += 1;
}

function startGame(t, now) {
  const st = N.create();
  let a, b;
  do { a = die(); b = die(); } while (a === b);
  st.turn = a > b ? 'w' : 'b';
  N.setRoll(st, die(), die());
  t.game += 1;
  t.gid = t.code + '-' + t.game + '-' + now.toString(36);
  t.toss = { a, b, n: now, turn: st.turn };
  t.state = st;
  t.offer = null;
  t.end = null;
  t.last = null;
  t.late = { w: 0, b: 0 };
  t.six = { w: 0, b: 0 };
  countSix(t, st);
  t.deadline = t.opts.timer ? now + LIMITS.move + LIMITS.toss : 0;
}

/* Прогоняем присланные шашки через правила по одной. Ход обязан
   быть полным: пока по правилам можно ходить, передавать нельзя. */
function play(st, moves) {
  const cur = N.clone(st);
  for (const m of moves) {
    if (cur.winner) return 'extra';
    const ok = N.legalMoves(cur).find((x) => x.from === m.from && x.to === m.to && x.die === m.die);
    if (!ok) return 'illegal';
    N.applyTo(cur, ok);
  }
  if (!cur.winner && N.legalMoves(cur).length) return 'unfinished';
  return cur;
}

function endGame(t, winner, why, now) {
  const loser = N.opp(winner);
  t.state.winner = winner;
  t.tally[winner] += 1;                          /* марс — такое же одно очко */
  t.end = {
    winner, why, at: now, gid: t.gid,
    mars: why === 'off' && t.state.off[loser] === 0,
    six: { w: t.six.w, b: t.six.b },
    shutout: false
  };
  t.deadline = 0;
  t.offer = null;
  if (t.opts.to && t.tally[winner] >= t.opts.to) {
    t.match = { over: true, winner, score: { w: t.tally.w, b: t.tally.b } };
    t.end.shutout = t.tally[loser] === 0;
  }
}

/* После хода: либо победа, либо следующему игроку сразу бросаем кости */
function advance(t, cur, by, moves, auto, now) {
  t.last = { by, moves: moves.map((m) => ({ from: m.from, to: m.to, die: m.die })), auto: !!auto };
  t.state = cur;
  if (cur.winner) { endGame(t, cur.winner, 'off', now); return; }
  N.endTurn(cur);
  N.setRoll(cur, die(), die());
  countSix(t, cur);
  t.deadline = t.opts.timer ? now + LIMITS.move : 0;
}

/* Время вышло: за игрока ходит компьютер. Третья просрочка подряд — поражение. */
function settle(t, now) {
  if (t.status !== 'live' || !t.deadline || t.state.winner || now < t.deadline + LIMITS.grace) return false;
  const p = t.state.turn;
  t.late[p] += 1;
  if (t.late[p] >= LATE_MAX) {
    t.last = { by: p, moves: [], auto: true };
    endGame(t, N.opp(p), 'time', now);
    return true;
  }
  const path = AI.choose(N.clone(t.state), 'normal');
  const cur = N.clone(t.state);
  for (const m of path) N.applyTo(cur, m);
  advance(t, cur, p, path, true, now);
  return true;
}

function freshTable(code, opts, now) {
  return {
    v: 2, seq: 1, code, status: 'open', createdAt: now, updatedAt: now,
    opts,
    seats: { w: null, b: null },
    keys: { w: null, b: null },
    state: N.create(),
    tally: { w: 0, b: 0 },
    toss: null, gid: null, game: 0,
    offer: null, declined: 0,
    deadline: 0, late: { w: 0, b: 0 }, six: { w: 0, b: 0 },
    last: null, end: null, match: null
  };
}

/* ---------- запросы ---------- */

function fail(status, error) { return { status, data: { error } }; }

async function seenOf(store, code) {
  const [w, b] = await Promise.all([store.get('seen:' + code + ':w'), store.get('seen:' + code + ':b')]);
  return { w: w || 0, b: b || 0 };
}

async function reply(store, t, seat, status, error) {
  const out = { table: view(t, await seenOf(store, t.code)), seat };
  if (error) out.error = error;
  return { status: status || 200, data: out };
}

export async function create(store, body, acc) {
  const now = Date.now();
  const seat = body.seat === 'b' ? 'b' : 'w';
  const o = body.opts && typeof body.opts === 'object' ? body.opts : {};
  const opts = {
    timer: !!o.timer,
    to: Math.max(0, Math.min(21, Math.floor(Number(o.to) || 0)))
  };
  for (let i = 0; i < 6; i++) {
    const code = code6();
    const key = secret();
    const t = freshTable(code, opts, now);
    t.seats[seat] = person(body.who, acc);
    t.keys[seat] = key;
    const r = await store.update('table:' + code, (cur) => (cur ? undefined : t), TTL);
    if (r.changed) return reply(store, t, seat).then((x) => { x.data.key = key; return x; });
  }
  return fail(503, 'busy');
}

export async function sit(store, body, acc) {
  const code = codeOf(body.code);
  if (!code) return fail(400, 'bad_code');
  const now = Date.now();
  let seat = null, key = null, why = null;
  const r = await store.update('table:' + code, (t) => {
    seat = key = why = null;
    if (!t) { why = 'gone'; return; }
    seat = seatOf(t, body.key);
    if (seat) { key = body.key; return; }
    /* тот же человек из Telegram, но с другого телефона — пускаем на своё место */
    if (acc) {
      for (const p of ['w', 'b']) {
        if (t.seats[p] && t.seats[p].acc === acc.id) { seat = p; key = t.keys[p]; return; }
      }
    }
    seat = !t.seats.w ? 'w' : (!t.seats.b ? 'b' : null);
    if (!seat) { why = 'full'; return; }
    key = secret();
    t.seats[seat] = person(body.who, acc);
    t.keys[seat] = key;
    if (t.seats.w && t.seats.b) {
      t.status = 'live';
      startGame(t, now);
    }
    return bump(t, now);
  }, TTL);
  if (why === 'gone') return fail(404, 'gone');
  if (why) return fail(409, why);
  const x = await reply(store, r.value, seat);
  x.data.key = key;
  return x;
}

/* Разовая проверка просрочки. Пишем, только если правда пора. */
async function overdue(store, code, t) {
  if (!t || t.status !== 'live' || !t.deadline || t.state.winner) return t;
  if (Date.now() < t.deadline + LIMITS.grace) return t;
  let ended = false;
  const r = await store.update('table:' + code, (cur) => {
    ended = false;
    if (!cur) return;
    const had = !!cur.end;
    if (!settle(cur, Date.now())) return;
    ended = !had && !!cur.end;
    return bump(cur, Date.now());
  }, TTL);
  if (r.changed && ended) await record(store, r.value);
  return r.value;
}

/* Ожидание перемен. Держим запрос, пока номер стола не вырастет,
   но не дольше 25 секунд; просыпаемся и к сроку хода, чтобы
   вовремя сходить за опоздавшего. */
export async function watch(store, body) {
  const code = codeOf(body.code);
  if (!code) return fail(400, 'bad_code');
  const after = Number.isFinite(Number(body.after)) ? Number(body.after) : -1;
  const key = 'table:' + code;
  let t = await store.get(key);
  if (!t) return fail(404, 'gone');
  const seat = seatOf(t, body.key);
  if (seat) await store.set('seen:' + code + ':' + seat, Date.now(), TTL);

  const end = Date.now() + LIMITS.wait;
  for (let guard = 0; guard < 12; guard++) {
    t = await overdue(store, code, t);
    if (!t || t.seq > after) break;
    const left = end - Date.now();
    if (left <= 0) break;
    let ms = left;
    if (t.status === 'live' && t.deadline && !t.state.winner) {
      ms = Math.min(ms, Math.max(200, t.deadline + LIMITS.grace + 150 - Date.now()));
    }
    t = await store.wait(key, (v) => !v || v.seq > after, ms);
  }
  if (!t) return fail(404, 'gone');
  return reply(store, t, seat);
}

/* Общая обёртка для просьб игрока: найти стол, узнать место по ключу,
   сначала отработать просрочку, потом саму просьбу. */
async function act(store, body, fn) {
  const code = codeOf(body.code);
  if (!code) return fail(400, 'bad_code');
  let seat = null, why = null, ended = false;
  const r = await store.update('table:' + code, (t) => {
    seat = why = null;
    ended = false;
    if (!t) { why = 'gone'; return; }
    seat = seatOf(t, body.key);
    if (!seat) { why = 'not_seated'; return; }
    const now = Date.now();
    const had = !!t.end;
    const late = settle(t, now);
    why = fn(t, seat, now);
    ended = !had && !!t.end;
    if (why && !late) return;               /* ничего не поменялось */
    return bump(t, now);
  }, TTL);
  if (r.changed && ended) await record(store, r.value);
  if (why === 'gone') return fail(404, 'gone');
  if (why === 'not_seated') return fail(403, 'not_seated');
  const status = !why ? 200 : (why === 'stale' || why === 'busy' ? 409 : 400);
  return reply(store, r.value, seat, status, why);
}

function movesOf(list) {
  if (!Array.isArray(list) || list.length > 4) return null;
  const out = [];
  for (const m of list) {
    if (!m || typeof m !== 'object') return null;
    const from = Number(m.from), to = Number(m.to), d = Number(m.die);
    if (!Number.isInteger(from) || from < 0 || from > 23) return null;
    if (!Number.isInteger(to) || to < -1 || to > 23) return null;
    if (!Number.isInteger(d) || d < 1 || d > 6) return null;
    out.push({ from, to, die: d });
  }
  return out;
}

/* Ход целиком. Номер хода (game + ply) защищает от повтора: если ответ
   потерялся и телефон прислал тот же ход ещё раз, второй раз он не пройдёт. */
export function turn(store, body) {
  const moves = movesOf(body.moves);
  if (!moves) return fail(400, 'bad_moves');
  return act(store, body, (t, seat, now) => {
    const st = t.state;
    if (t.status !== 'live' || st.winner || st.turn !== seat) return 'stale';
    if (Number(body.game) !== t.game || Number(body.ply) !== st.turnNo[seat]) return 'stale';
    const cur = play(st, moves);
    if (typeof cur === 'string') return cur;
    t.late[seat] = 0;
    advance(t, cur, seat, moves, false, now);
    return null;
  });
}

/* Предложить переиграть — только посреди партии */
export function offer(store, body) {
  return act(store, body, (t, seat, now) => {
    if (t.status !== 'live' || t.state.winner) return 'stale';
    if (t.offer) return t.offer.by === seat ? null : 'busy';
    t.offer = { by: seat, ts: now };
    return null;
  });
}

export function answer(store, body) {
  return act(store, body, (t, seat, now) => {
    if (!t.offer || t.offer.by === seat) return 'stale';
    if (body.yes) startGame(t, now);            /* неоконченная партия в счёт не идёт */
    else { t.offer = null; t.declined = now; }
    return null;
  });
}

/* Следующая партия после окончания. Жмут оба — начнётся одна. */
export function again(store, body) {
  return act(store, body, (t, seat, now) => {
    if (t.status !== 'live') return 'stale';
    if (!t.state.winner) return t.end ? null : 'stale';
    if (t.match && t.match.over) { t.tally = { w: 0, b: 0 }; t.match = null; }
    startGame(t, now);
    return null;
  });
}

/* ---------- итог партии в профили ---------- */

export function blankUser(who) {
  return {
    id: who.id, name: who.name || 'Игрок', photo: who.photo || '', about: '',
    w: 0, l: 0, mars: 0, marsLost: 0,
    streak: 0, best: 0,
    foes: {}, recent: [], badges: {},
    created: Date.now(), updated: Date.now()
  };
}

function badge(u, name, now) {
  if (!u.badges[name]) u.badges[name] = now;
}

async function record(store, t) {
  const e = t.end;
  if (!e) return;
  const sides = [e.winner, N.opp(e.winner)];
  for (const p of sides) {
    const me = t.seats[p], foe = t.seats[N.opp(p)];
    if (!me || !me.acc || !foe) continue;
    const win = p === e.winner;
    await store.update('user:' + me.acc, (u) => {
      u = u || blankUser({ id: me.acc, name: me.name, photo: me.photo });
      u.recent = u.recent || [];
      u.badges = u.badges || {};
      if (u.recent.some((g) => g.gid === e.gid)) return;     /* уже записано */
      const now = e.at;
      if (win) { u.w += 1; if (e.mars) u.mars += 1; }
      else { u.l += 1; if (e.mars) u.marsLost += 1; }
      u.streak = win ? Math.max(0, u.streak || 0) + 1 : Math.min(0, u.streak || 0) - 1;
      if (u.streak > (u.best || 0)) u.best = u.streak;

      const fk = foe.acc || foe.id;
      const f = u.foes[fk] || { name: foe.name, w: 0, l: 0 };
      f.name = foe.name || f.name;
      f.acc = foe.acc || null;
      f.photo = foe.photo || f.photo || '';
      if (win) f.w += 1; else f.l += 1;
      f.games = f.w + f.l;
      f.last = now;
      u.foes[fk] = f;

      u.recent.unshift({
        gid: e.gid, at: now, win, mars: e.mars, why: e.why,
        foe: { id: fk, name: foe.name, acc: foe.acc || null }
      });
      u.recent = u.recent.slice(0, 10);

      if (win && e.mars) badge(u, 'mars1', now);
      if (u.mars >= 10) badge(u, 'mars10', now);
      if (e.six[p] >= 3) badge(u, 'six3', now);
      if (win && e.shutout) badge(u, 'shutout', now);
      if (u.w + u.l >= 100) badge(u, 'game100', now);

      if (me.name) u.name = me.name;
      if (me.photo && !u.custom) u.photo = me.photo;
      u.updated = now;
      return u;
    });
  }
}
