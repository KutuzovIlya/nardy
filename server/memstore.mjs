/* Хранилище в памяти с записью в JSON-файл. Для запуска под Node
   и для проверок: то же устройство, что у Deno KV, — get, set,
   update (атомарно), wait (ждать перемен), list. */
import fs from 'node:fs';

export function memStore(file) {
  /* db[key] = { v: значение, exp: когда истекает (0 — никогда) } */
  let db = {};
  if (file) { try { db = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { db = {}; } }

  let dirty = null;
  const flush = () => {
    if (!file || dirty) return;
    dirty = setTimeout(() => { dirty = null; fs.writeFileSync(file, JSON.stringify(db)); }, 200);
  };
  const copy = (v) => (v == null ? null : JSON.parse(JSON.stringify(v)));

  function read(key) {
    const e = db[key];
    if (!e) return null;
    if (e.exp && e.exp < Date.now()) { delete db[key]; flush(); return null; }
    return copy(e.v);
  }

  /* кто ждёт перемен по ключу */
  const waiters = new Map();

  function write(key, val, ttl) {
    db[key] = { v: copy(val), exp: ttl ? Date.now() + ttl : 0 };
    flush();
    const set = waiters.get(key);
    if (set) for (const f of [...set]) f();
  }

  /* Node однопоточный, а fn синхронная — чтение и запись идут
     без разрыва, так что обновление и так атомарное. */
  return {
    async get(key) { return read(key); },
    async set(key, val, ttl) { write(key, val, ttl); },
    async update(key, fn, ttl) {
      const cur = read(key);
      const next = fn(cur);
      if (next === undefined) return { value: cur, changed: false };
      write(key, next, ttl);
      return { value: copy(next), changed: true };
    },
    wait(key, pred, ms) {
      return new Promise((resolve) => {
        const now = read(key);
        if (pred(now)) { resolve(now); return; }
        let set = waiters.get(key);
        if (!set) waiters.set(key, (set = new Set()));
        const done = () => {
          clearTimeout(timer);
          set.delete(check);
          if (!set.size) waiters.delete(key);
          resolve(read(key));
        };
        const check = () => { if (pred(read(key))) done(); };
        const timer = setTimeout(done, ms);
        set.add(check);
      });
    },
    async list(prefix) {
      return Object.keys(db).filter((k) => k.startsWith(prefix)).map(read).filter(Boolean);
    }
  };
}
