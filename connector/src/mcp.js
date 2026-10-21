/* Minimal MCP server over Streamable HTTP, stateless: every POST carries one JSON-RPC message
   (or a batch) and gets a plain JSON reply. No SSE stream, so GET is refused with 405. */
import { TOOLS, INSTRUCTIONS, callTool } from './tracker.js';

const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const fail = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

async function answer(msg, storage, ctx) {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return fail(msg && msg.id, -32600, 'Invalid request');
  if (msg.id === undefined) return null;                       // a notification: nothing to send back
  const { id, method, params = {} } = msg;
  switch (method) {
    case 'initialize':
      return { jsonrpc: '2.0', id, result: {
        protocolVersion: VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : VERSIONS[1],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'study-tracker', title: 'Study Tracker', version: '1.0.0' },
        instructions: INSTRUCTIONS,
      } };
    case 'ping':
      return { jsonrpc: '2.0', id, result: {} };
    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
    case 'tools/call': {
      if (!TOOLS.some(t => t.name === params.name)) return fail(id, -32602, `Unknown tool: ${params.name}`);
      try {
        const r = await callTool(storage, params.name, params.arguments, ctx);
        return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: r.error || r.text }], isError: !!r.error } };
      } catch (err) {
        return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `Tracker error: ${err.message}` }], isError: true } };
      }
    }
    default:
      return fail(id, -32601, `Method not found: ${method}`);
  }
}

export async function handleMcp(request, storage, ctx) {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
  let body;
  try { body = await request.json(); } catch { return json(fail(null, -32700, 'Parse error'), 400); }
  if (Array.isArray(body)) {
    const replies = (await Promise.all(body.map(m => answer(m, storage, ctx)))).filter(Boolean);
    return replies.length ? json(replies) : new Response(null, { status: 202 });
  }
  const reply = await answer(body, storage, ctx);
  return reply ? json(reply) : new Response(null, { status: 202 });
}
