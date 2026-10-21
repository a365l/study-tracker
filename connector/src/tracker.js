/* The tracker side of the connector: a copy of data.json pushed by the PC app, a queue of edits
   made through MCP that the PC app hasn't applied yet, and the five tools that read and edit them.
   Edits are applied to the copy straight away (so the next question sees them) and stay queued
   until a push from the PC says it has applied them (data.sync.appliedSeq). */

const STAGES = ['Not started', 'Taught', 'Notes', 'Practised', 'Confident'];
const RAG_DAYS = { red: 2, amber: 7, green: 21 };
const RAG_RANK = { red: 0, amber: 1, green: 2 };
export const ACTIVITIES = ['Class', 'Study session', 'Notes', 'Questions', 'Past paper', 'Flashcards / recall', 'Review', 'Homework', 'Other'];
export const SCORE_KINDS = ['Class test', 'End-of-chapter test', 'Homework', 'Mock', 'Past paper', 'Other'];
const DAY = 864e5;

/* ---------- dates (in the tracker's time zone, so "today" matches the PC) ---------- */
const isoDate = (ms, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
const dayDiff = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY);
const weekStart = iso => addDays(iso, -((new Date(iso + 'T00:00:00Z').getUTCDay() + 6) % 7));
const fmtMins = m => (m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`);
function ago(ms, now) {
  const h = (now - ms) / 36e5;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min ago`;
  if (h < 48) return `${Math.round(h)} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

/* ---------- model: same keys as buildModel() in web/app.js ---------- */
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'topic';
const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function normalise(data) {
  const d = { ...data };
  for (const k of ['units', 'topics']) d[k] = { ...(d[k] || {}) };
  for (const k of ['log', 'scores', 'exams']) d[k] = [...(d[k] || [])];
  d.custom = { units: [], topics: {}, ...(d.custom || {}) };
  return d;
}

function buildModel(curriculum, data) {
  const subjects = [], units = new Map(), topics = new Map();
  for (const s of curriculum) {
    const subject = { id: s.id, name: s.name, units: [] };
    subjects.push(subject);
    for (const c of s.courses) {
      const addUnit = u => {
        const key = `${s.id}/${c.id}/${u.id}`, saved = data.units[key] || {};
        const unit = { key, name: u.name, subject, year: saved.year || u.year || 1, hidden: !!saved.hidden, type: u.type || 'stages', topics: [] };
        const seen = new Set();
        const addTopic = t => {
          const name = typeof t === 'string' ? t : t.name, base = (typeof t === 'object' && t.id) || slug(name);
          let id = base, i = 2;
          while (seen.has(id)) id = `${base}-${i++}`;
          seen.add(id);
          const topic = { key: `${key}/${id}`, name, unit };
          unit.topics.push(topic); topics.set(topic.key, topic);
        };
        (u.topics || []).forEach(addTopic);
        (data.custom.topics[key] || []).forEach(addTopic);
        units.set(key, unit); subject.units.push(unit);
      };
      c.units.forEach(addUnit);
      data.custom.units.filter(u => u.subject === s.id && u.course === c.id).forEach(addUnit);
    }
  }
  return { subjects, units, topics };
}

/* Same effect as clicking the stage / RAG buttons in the app, at the time the edit was made. */
export function applyOp(data, op) {
  if (op.type === 'topic') {
    const cur = { ...(data.topics[op.key] || {}) };
    if ('stage' in op) {
      cur.stage = op.stage; cur.at = op.at;
      if (op.stage > 0) cur.taughtAt = cur.taughtAt || op.at;
    }
    if ('rag' in op) {
      if (op.rag) { cur.rag = op.rag; cur.reviewedAt = op.at; cur.at = op.at; }
      else { delete cur.rag; delete cur.conf; delete cur.reviewedAt; }
    }
    if ('note' in op) { if (op.note) cur.note = op.note; else delete cur.note; }
    if (cur.stage || cur.rag || cur.note) data.topics[op.key] = cur; else delete data.topics[op.key];
  } else if (op.type === 'log' && !data.log.some(e => e.id === op.entry.id)) data.log.push(op.entry);
  else if (op.type === 'score' && !data.scores.some(e => e.id === op.entry.id)) data.scores.push(op.entry);
}

/* ---------- storage ---------- */
async function loadView(storage) {
  const snap = await storage.get('snapshot');
  if (!snap) return null;
  const data = normalise(snap.data), applied = (data.sync && data.sync.appliedSeq) || 0;
  const pending = ((await storage.get('ops')) || []).filter(o => o.seq > applied);
  pending.forEach(op => applyOp(data, op));
  return { data, model: buildModel(snap.curriculum, data), pushedAt: snap.pushedAt, pending: pending.length };
}

async function queue(storage, ops) {
  const list = (await storage.get('ops')) || [];
  let seq = (await storage.get('seq')) || 0;
  for (const op of ops) list.push({ ...op, seq: ++seq });
  await storage.put({ ops: list, seq });
}

export async function push(storage, body, now) {
  if (!body || !body.data || !Array.isArray(body.curriculum)) throw new Error('expected { data, curriculum }');
  const applied = (body.data.sync && body.data.sync.appliedSeq) || 0;
  const ops = ((await storage.get('ops')) || []).filter(o => o.seq > applied);
  await storage.put({ snapshot: { data: body.data, curriculum: body.curriculum, pushedAt: now }, ops });
  return { ok: true, pending: ops.length };
}

export async function pendingOps(storage, after) {
  return { ok: true, ops: ((await storage.get('ops')) || []).filter(o => o.seq > after) };
}

/* ---------- lookups ---------- */
const subjectOf = (model, s) => model.subjects.find(x => x.id === s || norm(x.name) === norm(s || ''));
const label = t => `${t.name} (${t.unit.subject.name} > ${t.unit.name})`;

function topicLine(t, data, today, tz) {
  const p = data.topics[t.key] || {}, bits = [STAGES[p.stage || 0]];
  if (p.rag && p.reviewedAt) {
    const due = dayDiff(today, addDays(isoDate(p.reviewedAt, tz), RAG_DAYS[p.rag] || 7));
    bits.push(`${p.rag.toUpperCase()} rated ${dayDiff(isoDate(p.reviewedAt, tz), today)}d ago`, due <= 0 ? `review due${due < 0 ? ` (${-due}d overdue)` : ''}` : `review in ${due}d`);
  } else bits.push('not rated');
  if (p.note) bits.push(`note: ${p.note.replace(/\s+/g, ' ').trim()}`);
  return `- ${label(t)}: ${bits.join(', ')}\n  key: ${t.key}`;
}

function search(model, query, subject) {
  const words = norm(query).split(' ').filter(Boolean);
  return [...model.topics.values()].filter(t => (!subject || t.unit.subject === subject)
    && words.every(w => norm(`${t.unit.subject.name} ${t.unit.name} ${t.name}`).includes(w)));
}

function resolveTopic(model, ref) {
  if (model.topics.has(ref)) return { topic: model.topics.get(ref) };
  const exact = [...model.topics.values()].filter(t => norm(t.name) === norm(ref));
  const found = exact.length ? exact : search(model, ref);
  if (found.length === 1) return { topic: found[0] };
  return { error: found.length ? `"${ref}" matches ${found.length} topics, e.g. ${found.slice(0, 4).map(t => t.key).join(', ')}. Use a key.` : `No topic matches "${ref}". Use find_topics.` };
}

function resolveUnit(model, ref, subject) {
  if (!ref) return { unit: null };
  if (model.units.has(ref)) return { unit: model.units.get(ref) };
  const found = [...model.units.values()].filter(u => (!subject || u.subject === subject) && norm(u.name).includes(norm(ref)));
  return found.length === 1 ? { unit: found[0] } : { error: `Chapter "${ref}" ${found.length ? 'is ambiguous' : 'not found'}. Use a chapter key from find_topics.` };
}

/* ---------- tools ---------- */
export const TOOLS = [
  {
    name: 'get_overview',
    title: 'Study tracker overview',
    description: 'What is due for review, red and amber topics, topics with notes done but not yet rated, chapters in progress, this week\'s study time, recent sessions and upcoming exams. Call this at the start of a revision session to decide what to test.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'find_topics',
    title: 'Find topics',
    description: 'Search topics by name (words can come from the subject, chapter or topic name, e.g. "quadratics discriminant" or "physics projectile"). Returns each topic\'s key, stage, rating and review date. Use the keys with update_topics and the chapter keys with log_session / add_score.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words to match. Use a chapter name to list all its topics.' },
        subject: { type: 'string', description: 'Optional subject id or name: maths, further, physics.' },
      },
      required: ['query'], additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'update_topics',
    title: 'Update topics',
    description: 'Set the stage, red/amber/green rating and/or note of one or more topics. Rate from evidence of how the student actually did in this conversation, not how it felt: red = could not start the question; amber = got there but needed notes or a worked example, or made slips; green = did an unseen exam-style question correctly with no notes. A rating schedules the next review (red 2 days, amber 7, green 21). Stages: 0 Not started, 1 Taught (covered in class), 2 Notes (made own notes), 3 Practised (done questions), 4 Confident (could answer an exam question cold). All updates are checked first; if any is invalid, nothing is saved.',
    inputSchema: {
      type: 'object',
      properties: {
        updates: {
          type: 'array', minItems: 1, maxItems: 40,
          items: {
            type: 'object',
            properties: {
              topic: { type: 'string', description: 'Topic key from find_topics (or an exact topic name if it is unique).' },
              stage: { type: 'integer', minimum: 0, maximum: 4 },
              rag: { type: 'string', enum: ['red', 'amber', 'green', 'none'], description: '"none" clears the rating.' },
              note: { type: 'string', maxLength: 500, description: 'Replaces the topic note. Empty string clears it.' },
            },
            required: ['topic'], additionalProperties: false,
          },
        },
      },
      required: ['updates'], additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'log_session',
    title: 'Log a study session',
    description: 'Add a study session to the log. Log one session per subject studied, with the time actually spent.',
    inputSchema: {
      type: 'object',
      properties: {
        subject: { type: 'string', description: 'maths, further or physics' },
        minutes: { type: 'integer', minimum: 1, maximum: 720 },
        kind: { type: 'string', enum: ACTIVITIES, description: 'Default "Study session".' },
        chapter: { type: 'string', description: 'Optional chapter key (or unique chapter name).' },
        note: { type: 'string', maxLength: 300, description: 'Short note, e.g. "Ex 2C Q1-12, stuck on Q9".' },
        date: { type: 'string', description: 'YYYY-MM-DD, default today.' },
      },
      required: ['subject', 'minutes'], additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  {
    name: 'add_score',
    title: 'Add a score',
    description: 'Record a mark from a test, homework, mock or past paper.',
    inputSchema: {
      type: 'object',
      properties: {
        subject: { type: 'string', description: 'maths, further or physics' },
        title: { type: 'string', maxLength: 100, description: 'e.g. "June 2023 Paper 1" or "Vectors test"' },
        got: { type: 'number', minimum: 0 },
        max: { type: 'number', exclusiveMinimum: 0 },
        kind: { type: 'string', enum: SCORE_KINDS, description: 'Default "Class test".' },
        chapter: { type: 'string', description: 'Optional chapter key (or unique chapter name).' },
        date: { type: 'string', description: 'YYYY-MM-DD, default today.' },
      },
      required: ['subject', 'title', 'got', 'max'], additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
];

export const INSTRUCTIONS = 'Study Tracker holds the student\'s A-level Maths, Further Maths and Physics revision progress. '
  + 'Start a revision session with get_overview and test due, red and amber topics first. '
  + 'Use find_topics to get keys before update_topics. After the student answers questions, rate the topics from how they actually did, '
  + 'and log the session time with log_session. Edits reach the app on the student\'s PC next time it is open.';

const uid = now => now.toString(36) + Math.random().toString(36).slice(2, 7);

function dateArg(date, today) {
  if (date === undefined || date === '') return { date: today };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return { error: 'date must be YYYY-MM-DD' };
  if (date > today) return { error: 'date is in the future' };
  return { date };
}

export async function callTool(storage, name, args, { now, tz }) {
  const view = await loadView(storage);
  if (!view) return { error: 'The tracker has not synced yet. Open Study Tracker on the PC once so it can upload its data.' };
  const { data, model } = view, today = isoDate(now, tz);
  args = args || {};

  if (name === 'get_overview') return { text: overview(view, now, today, tz) };

  if (name === 'find_topics') {
    const subject = args.subject ? subjectOf(model, args.subject) : null;
    if (args.subject && !subject) return { error: `Unknown subject "${args.subject}". Use maths, further or physics.` };
    const found = search(model, args.query || '', subject);
    if (!found.length) return { text: `No topics match "${args.query}".` };
    const chapters = [...new Set(found.map(t => t.unit))];
    const shown = found.slice(0, 40), lines = [`${found.length} topic${found.length === 1 ? '' : 's'} in ${chapters.length} chapter${chapters.length === 1 ? '' : 's'}${found.length > 40 ? ' (first 40 shown, narrow the search)' : ''}.`];
    for (const u of [...new Set(shown.map(t => t.unit))]) {
      lines.push(`\n${u.subject.name} > ${u.name} (Year ${u.year}${u.hidden ? ', hidden' : ''})  chapter key: ${u.key}`);
      shown.filter(t => t.unit === u).forEach(t => lines.push(topicLine(t, data, today, tz)));
    }
    return { text: lines.join('\n') };
  }

  if (name === 'update_topics') {
    const updates = Array.isArray(args.updates) ? args.updates : [], ops = [], errors = [];
    if (!updates.length) return { error: 'updates is empty' };
    updates.forEach((u, i) => {
      const r = resolveTopic(model, String(u.topic || ''));
      if (r.error) return errors.push(`#${i + 1}: ${r.error}`);
      const op = { type: 'topic', key: r.topic.key, at: now };
      if (u.stage !== undefined) {
        if (!Number.isInteger(u.stage) || u.stage < 0 || u.stage > 4) return errors.push(`#${i + 1}: stage must be 0-4`);
        op.stage = u.stage;
      }
      if (u.rag !== undefined) {
        if (!['red', 'amber', 'green', 'none'].includes(u.rag)) return errors.push(`#${i + 1}: rag must be red, amber, green or none`);
        op.rag = u.rag === 'none' ? '' : u.rag;
      }
      if (u.note !== undefined) op.note = String(u.note).trim().slice(0, 500);
      if (Object.keys(op).length === 3) return errors.push(`#${i + 1}: nothing to change for ${r.topic.key}`);
      ops.push(op);
    });
    if (errors.length) return { error: `Nothing saved.\n${errors.join('\n')}` };
    await queue(storage, ops);
    ops.forEach(op => applyOp(data, op));
    return { text: `Saved ${ops.length} update${ops.length === 1 ? '' : 's'}:\n${ops.map(op => topicLine(model.topics.get(op.key), data, today, tz)).join('\n')}` };
  }

  if (name === 'log_session' || name === 'add_score') {
    const subject = subjectOf(model, args.subject);
    if (!subject) return { error: `Unknown subject "${args.subject}". Use maths, further or physics.` };
    const u = resolveUnit(model, args.chapter, subject);
    if (u.error) return { error: u.error };
    const d = dateArg(args.date, today);
    if (d.error) return { error: d.error };
    const base = { id: uid(now), date: d.date, subject: subject.id, unit: u.unit ? u.unit.key : '', at: now };
    let entry, done;
    if (name === 'log_session') {
      const minutes = Math.round(Number(args.minutes));
      if (!(minutes >= 1 && minutes <= 720)) return { error: 'minutes must be 1-720' };
      const kind = args.kind || 'Study session';
      if (!ACTIVITIES.includes(kind)) return { error: `kind must be one of: ${ACTIVITIES.join(', ')}` };
      entry = { ...base, minutes, kind, note: String(args.note || '').trim().slice(0, 300) };
      done = `Logged ${fmtMins(minutes)} of ${subject.name} (${kind}) on ${d.date}${u.unit ? `, ${u.unit.name}` : ''}.`;
    } else {
      const got = Number(args.got), max = Number(args.max), kind = args.kind || 'Class test';
      if (!(max > 0) || !(got >= 0) || got > max) return { error: 'need 0 <= got <= max and max > 0' };
      if (!SCORE_KINDS.includes(kind)) return { error: `kind must be one of: ${SCORE_KINDS.join(', ')}` };
      const title = String(args.title || '').trim().slice(0, 100);
      if (!title) return { error: 'title is required' };
      entry = { ...base, title, kind, got, max };
      done = `Added ${subject.name} score: ${title}, ${got}/${max} (${Math.round(got / max * 100)}%) on ${d.date}.`;
    }
    await queue(storage, [{ type: name === 'log_session' ? 'log' : 'score', entry, at: now }]);
    return { text: done };
  }

  return { error: `Unknown tool ${name}` };
}

/* ---------- overview ---------- */
function overview(view, now, today, tz) {
  const { data, model } = view, out = [];
  const live = [...model.topics.values()].filter(t => !t.unit.hidden && t.unit.type !== 'checklist');
  const rated = live.filter(t => (data.topics[t.key] || {}).rag && data.topics[t.key].reviewedAt);
  const dueOf = t => addDays(isoDate(data.topics[t.key].reviewedAt, tz), RAG_DAYS[data.topics[t.key].rag] || 7);
  const byRag = (a, b) => RAG_RANK[data.topics[a.key].rag] - RAG_RANK[data.topics[b.key].rag];

  out.push(`Today is ${today}. Data from the PC is from ${ago(view.pushedAt, now)}${view.pending ? `; ${view.pending} edit${view.pending === 1 ? '' : 's'} made here are waiting for the PC app to open (already included below)` : ''}.`);

  const due = rated.filter(t => dueOf(t) <= today).sort((a, b) => byRag(a, b) || dueOf(a).localeCompare(dueOf(b)));
  out.push(`\nDUE FOR REVIEW (${due.length})`);
  due.slice(0, 25).forEach(t => out.push(topicLine(t, data, today, tz)));
  if (due.length > 25) out.push(`...and ${due.length - 25} more`);
  if (!due.length) out.push('- nothing due');

  const weak = rated.filter(t => data.topics[t.key].rag !== 'green' && dueOf(t) > today).sort(byRag);
  out.push(`\nRED AND AMBER, NOT DUE YET (${weak.length})`);
  weak.slice(0, 20).forEach(t => out.push(topicLine(t, data, today, tz)));
  if (weak.length > 20) out.push(`...and ${weak.length - 20} more`);

  const unrated = live.filter(t => !(data.topics[t.key] || {}).rag && ((data.topics[t.key] || {}).stage || 0) >= 2);
  if (unrated.length) {
    out.push(`\nNOTES DONE BUT NOT RATED (${unrated.length})`);
    unrated.slice(0, 15).forEach(t => out.push(topicLine(t, data, today, tz)));
  }

  out.push('\nCHAPTERS IN PROGRESS');
  for (const s of model.subjects) {
    const units = s.units.filter(u => !u.hidden && u.topics.some(t => data.topics[t.key] && (data.topics[t.key].stage || data.topics[t.key].rag)));
    if (!units.length) continue;
    out.push(`${s.name}:`);
    for (const u of units) {
      const c = { red: 0, amber: 0, green: 0 };
      let stages = 0;
      u.topics.forEach(t => { const p = data.topics[t.key] || {}; stages += p.stage || 0; if (c[p.rag] !== undefined) c[p.rag]++; });
      out.push(`- ${u.name}: ${Math.round(stages / (u.topics.length * 4) * 100)}% of stages, ${c.green} green, ${c.amber} amber, ${c.red} red, ${u.topics.length} topics  chapter key: ${u.key}`);
    }
  }

  const ws = weekStart(today), week = data.log.filter(e => e.date >= ws && e.date <= today), per = {};
  week.forEach(e => { per[e.subject] = (per[e.subject] || 0) + (e.minutes || 0); });
  out.push(`\nTHIS WEEK (from ${ws}): ${fmtMins(week.reduce((a, e) => a + (e.minutes || 0), 0))} in ${week.length} sessions${Object.keys(per).length ? `, ${Object.entries(per).map(([k, m]) => `${(subjectOf(model, k) || { name: k }).name} ${fmtMins(m)}`).join(', ')}` : ''}`);
  const recent = [...data.log].sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 5);
  if (recent.length) {
    out.push('RECENT SESSIONS');
    recent.forEach(e => out.push(`- ${e.date} ${(subjectOf(model, e.subject) || { name: e.subject }).name}, ${fmtMins(e.minutes || 0)}, ${e.kind}${e.note ? `: ${e.note}` : ''}`));
  }
  const scores = [...data.scores].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  if (scores.length) {
    out.push('RECENT SCORES');
    scores.forEach(e => out.push(`- ${e.date} ${(subjectOf(model, e.subject) || { name: e.subject }).name}: ${e.title} ${e.got}/${e.max} (${Math.round(e.got / e.max * 100)}%)`));
  }
  const exams = data.exams.filter(e => e.date >= today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 3);
  if (exams.length) out.push(`\nUPCOMING: ${exams.map(e => `${e.name} on ${e.date} (${dayDiff(today, e.date)} days)`).join('; ')}`);
  return out.join('\n');
}
