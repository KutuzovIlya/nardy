/* Запуск на Deno Deploy. Хранилище — встроенный Deno KV,
   подключать ничего не нужно. Токен бота кладётся в переменную
   окружения BOT_TOKEN прямо в панели Deno Deploy.

   Ключи вида «user:tg111» раскладываются в ['user','tg111'],
   чтобы выборка шла по префиксу, а не перебором всей базы. */
import { handle } from './app.mjs';

const kv = await Deno.openKv();

function split(key: string): string[] {
  const i = key.indexOf(':');
  return i < 0 ? [key] : [key.slice(0, i), key.slice(i + 1)];
}

const store = {
  async get(key: string) {
    const r = await kv.get(split(key));
    return r.value ?? null;
  },
  async set(key: string, val: unknown) {
    await kv.set(split(key), val);
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
