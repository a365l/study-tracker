/* Runs the connector against an in-memory store with the real curriculum and demo data.
   node test/test.mjs */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { route } from '../src/routes.js';

const root = new URL('../../', import.meta.url);
const read = p => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
const curriculum = read('curriculum/manifest.json').files.map(f => read(`curriculum/${f}`));
const demo = read('demo/data.json');

const store = new Map();
const storage = {
  async get(k) { return store.has(k) ? structuredClone(store.get(k)) : undefined; },
  async put(k, v) { if (typeof k === 'object') for (const [a, b] of Object.entries(k)) store.set(a, structuredClone(b)); else store.set(k, structuredClone(v)); },
};
const env = { MCP_KEY: 'mcp-secret', PC_TOKEN: 'pc-secret', TIMEZONE: 'Europe/London' };
const durable = { fetch: req => route(req, storage, env) };
const send = (path, init = {}) => route(new Request(`https://x.workers.dev${path}`, init), null, env, () => durable);
const sync = (path, body) => send(path, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer pc-secret' }, body: body && JSON.stringify(body) });
let rpcId = 0;
async function rpc(method, params) {
  const r = await send('/mcp/mcp-secret', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) });
  return r.json();
}
const tool = async (name, args = {}) => (await rpc('tools/call', { name, arguments: args })).result;
let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; };

// auth: wrong key, no token and unknown paths all look the same
for (const r of [await send('/mcp/wrong', { method: 'POST' }), await send('/sync/ops'), await sync('/nope'), await send('/')]) ok(r.status === 404, 'should 404');
ok((await send('/sync/ops', { headers: { Authorization: 'Bearer wrong' } })).status === 404, 'bad token 404');

// before the PC has pushed anything
ok((await tool('get_overview')).isError, 'overview before push is an error');

// protocol
const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
ok(init.result.protocolVersion === '2025-06-18' && init.result.capabilities.tools, 'initialize');
ok((await rpc('initialize', { protocolVersion: '1999-01-01' })).result.protocolVersion === '2025-06-18', 'falls back to a known version');
ok((await rpc('tools/list')).result.tools.length === 5, 'five tools');
ok((await rpc('nope')).error.code === -32601, 'unknown method');
ok((await send('/mcp/mcp-secret', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) })).status === 202, 'notification 202');
ok((await send('/mcp/mcp-secret')).status === 405, 'GET 405');
const batch = await (await send('/mcp/mcp-secret', { method: 'POST', body: JSON.stringify([{ jsonrpc: '2.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/x' }]) })).json();
ok(Array.isArray(batch) && batch.length === 1, 'batch');

// PC pushes its data
const pushed = await (await sync('/sync/push', { data: demo, curriculum })).json();
ok(pushed.ok && pushed.pending === 0, 'push');

const ov = (await tool('get_overview')).content[0].text;
ok(ov.includes('DUE FOR REVIEW') && ov.includes('CHAPTERS IN PROGRESS') && ov.includes('chapter key: maths/pure/'), 'overview sections');

const found = (await tool('find_topics', { query: 'quadratics square' })).content[0].text;
ok(found.includes('key: maths/pure/y1-quadratics/completing-the-square'), 'find_topics');
ok((await tool('find_topics', { query: 'x', subject: 'chemistry' })).isError, 'unknown subject');

// edits: all-or-nothing validation
const bad = await tool('update_topics', { updates: [{ topic: 'maths/pure/y1-quadratics/completing-the-square', rag: 'green' }, { topic: 'no such topic', rag: 'red' }] });
ok(bad.isError && bad.content[0].text.startsWith('Nothing saved'), 'invalid batch rejected');
ok(((await (await sync('/sync/ops?after=0')).json()).ops.length === 0), 'nothing queued');

const ambiguous = await tool('update_topics', { updates: [{ topic: 'Partial fractions', stage: 2 }] });
ok(ambiguous.isError && ambiguous.content[0].text.includes('matches 2 topics'), 'name used in two chapters needs a key');
const byName = await tool('update_topics', { updates: [{ topic: 'bubble sort', stage: 2 }] });
ok(!byName.isError && byName.content[0].text.includes('key: further/d1/algorithms/bubble-sort'), 'unique name resolves');
const upd2 = await tool('update_topics', { updates: [{ topic: 'maths/pure/y1-quadratics/completing-the-square', rag: 'red', stage: 3, note: 'sign errors' }] });
ok(!upd2.isError && upd2.content[0].text.includes('RED rated 0d ago') && upd2.content[0].text.includes('review in 2d'), 'update applied');

const logged = await tool('log_session', { subject: 'Maths', minutes: 45, kind: 'Questions', chapter: 'Quadratics', note: 'Ex 2C' });
ok(!logged.isError && logged.content[0].text.includes('45m of Maths'), 'log_session');
ok((await tool('log_session', { subject: 'maths', minutes: 30, date: '2999-01-01' })).isError, 'future date rejected');
const scored = await tool('add_score', { subject: 'physics', title: 'Motion test', got: 31, max: 40 });
ok(!scored.isError && scored.content[0].text.includes('78%'), 'add_score');
ok((await tool('add_score', { subject: 'physics', title: 't', got: 5, max: 4 })).isError, 'got > max rejected');

// the view includes queued edits before the PC has applied them
const ov2 = (await tool('get_overview')).content[0].text;
ok(/edits? made here are waiting/.test(ov2) && ov2.includes('Ex 2C') && ov2.includes('Motion test'), 'overview shows pending edits');

// PC pulls, applies, pushes back with appliedSeq
const { ops } = await (await sync('/sync/ops?after=0')).json();
ok(ops.length >= 3 && ops.every((o, i) => i === 0 || o.seq > ops[i - 1].seq), 'ops in order');
ok((await (await sync(`/sync/ops?after=${ops[0].seq}`)).json()).ops.length === ops.length - 1, 'after filter');
const last = ops[ops.length - 1].seq;
const after = await (await sync('/sync/push', { data: { ...demo, sync: { appliedSeq: last } }, curriculum })).json();
ok(after.pending === 0, 'acked ops pruned');

// a stale push (older appliedSeq) keeps unacked ops, and seq keeps counting up
await tool('update_topics', { updates: [{ topic: 'maths/pure/y1-quadratics/completing-the-square', rag: 'green' }] });
const stale = await (await sync('/sync/push', { data: { ...demo, sync: { appliedSeq: last } }, curriculum })).json();
ok(stale.pending === 1, 'unacked op survives a push');
ok((await (await sync(`/sync/ops?after=${last}`)).json()).ops[0].seq === last + 1, 'seq continues');

console.log(`all ${passed} checks passed`);
