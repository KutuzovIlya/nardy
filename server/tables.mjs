/* ============================================================
   Сетевой стол на сервере.

   Пишет стол только сервер: бросает кости, проверяет каждый ход
   теми же правилами, что и игра в браузере, следит за временем
   и сам записывает итог. Игроки лишь просят: «вот мой ход»,
   «давай заново». Подделать бросок, ход или победу со своего
   телефона нельзя — поэтому и подтверждать итог вдвоём больше
   не нужно.

   Само ведение партии — в js/table.js, общем с браузером.
   Здесь — только запросы, ключи мест и хранилище.
   Место за столом закреплено секретным ключом. Его получает
   только севший, соперник ключа не видит.
   ============================================================ */
import { N, T } from './rules.mjs';

const TTL = 3 * 24 * 3600 * 1000;      /* стол без движения живёт трое суток */
export const LIMITS = T.LIMITS;
const { codeOf, person, settle } = T;

function secret() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
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
  const opts = body.opts && typeof body.opts === 'object' ? body.opts : {};
  for (let i = 0; i < 6; i++) {
    const code = T.code6();
    const key = secret();
    const t = T.freshTable(code, opts, now);
    t.keys = { w: null, b: null };
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
    t.keys[seat] = key;
    T.seat(t, seat, person(body.who, acc), now);
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
  if (!t || !T.overdue(t, Date.now())) return t;
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
    why = fn(t, seat, body, now);
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

export const turn = (store, body) => act(store, body, T.ask.turn);
export const offer = (store, body) => act(store, body, T.ask.offer);
export const answer = (store, body) => act(store, body, T.ask.answer);
export const again = (store, body) => act(store, body, T.ask.again);

/* ---------- итог партии в профили ---------- */

async function record(store, t) {
  const e = t.end;
  if (!e) return;
  for (const p of ['w', 'b']) {
    const me = t.seats[p];
    if (!me || !me.acc || !t.seats[N.opp(p)]) continue;
    await store.update('user:' + me.acc, (u) => {
      u = u || T.blankUser({ id: me.acc, name: me.name, photo: me.photo }, e.at);
      return T.recordInto(u, t, p) ? u : undefined;
    });
  }
}
