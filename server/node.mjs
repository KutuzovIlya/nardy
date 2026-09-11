/* Запуск под Node: для проверки на своей машине и для тех,
   кто захочет держать сервер сам. Хранилище — JSON-файл.
   BOT_TOKEN=... node server/node.mjs 8787 */
import http from 'node:http';
import path from 'node:path';
import { handle } from './app.mjs';
import { memStore } from './memstore.mjs';

const PORT = Number(process.argv[2]) || Number(process.env.PORT) || 8787;
const store = memStore(path.join(process.cwd(), 'server', '.store.json'));

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
