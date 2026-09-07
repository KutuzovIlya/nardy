/* Запуск под Node: для проверки на своей машине и для тех,
   кто захочет держать сервер сам. Хранилище — обычный JSON-файл.
   BOT_TOKEN=... node server/node.mjs 8787 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { handle } from './app.mjs';

const PORT = Number(process.argv[2]) || 8787;
const FILE = path.join(process.cwd(), 'server', '.data.json');

let db = {};
try { db = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { db = {}; }
const flush = () => fs.writeFileSync(FILE, JSON.stringify(db));

const store = {
  async get(key) { return db[key] ? JSON.parse(JSON.stringify(db[key])) : null; },
  async set(key, val) { db[key] = val; flush(); },
  async list(prefix) {
    return Object.keys(db).filter((k) => k.startsWith(prefix)).map((k) => db[k]);
  }
};

const cfg = { botToken: process.env.BOT_TOKEN || '', origin: process.env.ORIGIN || '*' };

http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const request = new Request('http://localhost' + req.url, {
    method: req.method,
    headers: req.headers,
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : body
  });
  const out = await handle(request, store, cfg);
  res.writeHead(out.status, Object.fromEntries(out.headers));
  res.end(Buffer.from(await out.arrayBuffer()));
}).listen(PORT, () => console.log('нарды-сервер: http://localhost:' + PORT));
