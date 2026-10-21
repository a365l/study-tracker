/* Auth and routing, kept free of Cloudflare imports so test/test.mjs can run it in plain Node. */
import { handleMcp } from './mcp.js';
import { push, pendingOps } from './tracker.js';

const notFound = () => new Response('Not found', { status: 404 });
const json = body => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* 'mcp', 'sync' or null */
export function caller(request, env) {
  const path = new URL(request.url).pathname;
  if (path.startsWith('/mcp/')) return same(path.slice(5).replace(/\/$/, ''), env.MCP_KEY) ? 'mcp' : null;
  if (path.startsWith('/sync/')) return same((request.headers.get('Authorization') || '').replace(/^Bearer /, ''), env.PC_TOKEN) ? 'sync' : null;
  return null;
}

/* At the edge (storage null): check the caller and pass the request to the Durable Object.
   Inside the Durable Object: do the work. */
export async function route(request, storage, env, stub) {
  const who = caller(request, env);
  if (!who) return notFound();
  if (!storage) return stub().fetch(request);
  const ctx = { now: Date.now(), tz: env.TIMEZONE || 'Europe/London' };
  if (who === 'mcp') return handleMcp(request, storage, ctx);
  const url = new URL(request.url);
  try {
    if (url.pathname === '/sync/push' && request.method === 'POST') return json(await push(storage, await request.json(), ctx.now));
    if (url.pathname === '/sync/ops' && request.method === 'GET') return json(await pendingOps(storage, Number(url.searchParams.get('after')) || 0));
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
  return notFound();
}
