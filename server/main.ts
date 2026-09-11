/* Запуск на Deno Deploy. Хранилище — встроенный Deno KV.
   Токен бота кладётся в переменную окружения BOT_TOKEN прямо
   в панели Deno Deploy.

   Ключи вида «user:tg111» раскладываются в ['user','tg111'],
   чтобы выборка шла по префиксу, а не перебором всей базы. */
import { handle } from './app.mjs';

const kv = await Deno.openKv();

function split(key: string): string[] {
  const i = key.indexOf(':');
  return i < 0 ? [key] : [key.slice(0, i), key.slice(i + 1)];
}

const opt = (ttl?: number) => (ttl ? { expireIn: ttl } : undefined);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const store = {
  async get(key: string) {
    return (await kv.get(split(key))).value ?? null;
  },
  async set(key: string, val: unknown, ttl?: number) {
    await kv.set(split(key), val, opt(ttl));
  },

  /* Прочитать — изменить — записать, только если никто не успел
     записать раньше нас. Иначе перечитываем и пробуем снова. */
  async update(key: string, fn: (v: any) => any, ttl?: number) {
    const k = split(key);
    for (let i = 0; i < 10; i++) {
      const e = await kv.get(k);
      const cur = e.value ?? null;
      const next = fn(cur === null ? null : structuredClone(cur));
      if (next === undefined) return { value: cur, changed: false };
      const r = await kv.atomic().check(e).set(k, next, opt(ttl)).commit();
      if (r.ok) return { value: next, changed: true };
    }
    throw new Error('store busy: ' + key);
  },

  /* Ждём, пока значение не станет подходящим. Подписка kv.watch
     сама будит нас при записи; если её нет — редкий опрос. */
  async wait(key: string, pred: (v: any) => boolean, ms: number) {
    const k = split(key);
    const end = Date.now() + ms;
    let reader: ReadableStreamDefaultReader<any> | null = null;
    try { reader = kv.watch([k]).getReader(); } catch { reader = null; }

    if (!reader) {
      for (;;) {
        const v = (await kv.get(k)).value ?? null;
        if (pred(v) || Date.now() >= end) return v;
        await sleep(Math.min(2000, end - Date.now()));
      }
    }

    let timer: number | undefined;
    const timeout = new Promise<'timeout'>((r) => { timer = setTimeout(() => r('timeout'), ms); });
    let last: unknown = undefined;
    try {
      for (;;) {
        const res = await Promise.race([reader.read(), timeout]);
        if (res === 'timeout' || res.done) break;
        last = res.value[0].value ?? null;
        if (pred(last)) return last;
      }
    } finally {
      clearTimeout(timer);
      reader.cancel().catch(() => {});
    }
    return last === undefined ? (await kv.get(k)).value ?? null : last;
  },

  async list(prefix: string) {
    const head = split(prefix)[0];
    const out: unknown[] = [];
    for await (const e of kv.list({ prefix: [head] })) out.push(e.value);
    return out;
  }
};

const cfg = {
  botToken: Deno.env.get('BOT_TOKEN') || '',
  origin: Deno.env.get('ORIGIN') || '*'
};

Deno.serve((req: Request) => handle(req, store, cfg));
