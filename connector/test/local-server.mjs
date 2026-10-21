/* The connector as a plain Node server with in-memory storage, for testing the PC app's sync
   without deploying. node test/local-server.mjs [port]   (keys: MCP_KEY=local, PC_TOKEN=local) */
import { createServer } from 'node:http';
import { route } from '../src/routes.js';

const port = Number(process.argv[2]) || 8790;
const env = { MCP_KEY: 'local', PC_TOKEN: 'local', TIMEZONE: 'Europe/London' };
const store = new Map();
const storage = {
  async get(k) { return store.has(k) ? structuredClone(store.get(k)) : undefined; },
  async put(k, v) { if (typeof k === 'object') for (const [a, b] of Object.entries(k)) store.set(a, structuredClone(b)); else store.set(k, structuredClone(v)); },
};
const durable = { fetch: req => route(req, storage, env) };

createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const r = await route(new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers: req.headers, body }), null, env, () => durable);
  console.log(req.method, req.url.replace(/\/mcp\/[^/?]+/, '/mcp/*'), r.status);
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(port, '127.0.0.1', () => console.log(`connector on http://127.0.0.1:${port}`));
