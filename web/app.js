'use strict';
/* =========================================================
   Study Tracker front end.
   D = your data (saved to data/data.json by app.py).
   Curriculum comes from /curriculum/*.json and is never edited here.
   ========================================================= */

/* ---------- helpers ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DAY = 864e5;
const pad2 = n => String(n).padStart(2, '0');
const isoDate = t => { const d = new Date(t); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const todayISO = () => isoDate(Date.now());
const parseISO = s => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
const dayDiff = (a, b) => Math.round((parseISO(b) - parseISO(a)) / DAY);
const addDays = (iso, n) => { const d = parseISO(iso); d.setDate(d.getDate() + n); return isoDate(d); };
const weekStart = (iso = todayISO()) => addDays(iso, -((parseISO(iso).getDay() + 6) % 7));
const fmtDate = (iso, o = { day: 'numeric', month: 'short' }) => parseISO(iso).toLocaleDateString('en-GB', o);
const fmtMins = m => { m = Math.round(m); if (m < 60) return `${m}m`; const h = Math.floor(m / 60), r = m % 60; return r ? `${h}h ${r}m` : `${h}h`; };
const fmtClock = ms => { const s = Math.floor(ms / 1000); return `${pad2(Math.floor(s / 3600))}:${pad2(Math.floor(s / 60) % 60)}:${pad2(s % 60)}`; };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'topic';
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const col = Visuals.col;
function ago(t) {
  if (!t) return '';
  const d = dayDiff(isoDate(t), todayISO());
  if (d <= 0) return 'today'; if (d === 1) return 'yesterday';
  if (d < 14) return `${d} days ago`; if (d < 60) return `${Math.round(d / 7)} weeks ago`;
  return `${Math.round(d / 30)} months ago`;
}

const svg = p => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const ICON = {
  today: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>'),
  overview: svg('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'),
  log: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  scores: svg('<path d="M3 20h18M6 16v-5M11 16V6M16 16v-8M21 16v-3"/>'),
  settings: svg('<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>'),
};

/* ---------- constants ---------- */
const STAGES = [
  { n: 0, label: 'Not started', short: '', color: '#3b4354' },
  { n: 1, label: 'Taught', short: 'Taught', color: '#ff8f5c', hint: 'Covered in class' },
  { n: 2, label: 'Notes', short: 'Notes', color: '#ffcf4d', hint: 'Made your own notes' },
  { n: 3, label: 'Practised', short: 'Practised', color: '#5ab8ff', hint: 'Done questions on it' },
  { n: 4, label: 'Confident', short: 'Confident', color: '#3ddc84', hint: 'Could answer an exam question cold' },
];
const ACTIVITIES = ['Class', 'Study session', 'Notes', 'Questions', 'Past paper', 'Flashcards / recall', 'Review', 'Homework', 'Other'];
const SCORE_KINDS = ['Class test', 'End-of-chapter test', 'Homework', 'Mock', 'Past paper', 'Other'];
const RAG = {
  red: { label: 'Red', color: '#ff5c7a', days: 2, v: 0.2, hint: "Can't start the question" },
  amber: { label: 'Amber', color: '#ffc14d', days: 7, v: 0.6, hint: 'Gets there, but needs notes or a worked example, or makes slips' },
  green: { label: 'Green', color: '#3ddc84', days: 21, v: 1, hint: 'Can do an unseen exam question correctly with no notes' },
};
const RAG_ORDER = ['red', 'amber', 'green'];
const REVIEW_DAYS = rag => (RAG[rag] ? RAG[rag].days : 7);
const ragFromNumber = n => (n >= 7 ? 'green' : n >= 4 ? 'amber' : n > 0 ? 'red' : '');
const LOOKAHEAD = 2;                 /* chapters shown ahead of what you've been taught */
const OTHER = { id: 'other', name: 'Other', color: '#8a93a8', papers: {}, courses: [] };
const DATA_VERSION = 1;
const EXAM_LABEL = { maths: 'Edexcel A level maths', further: 'Edexcel A level further maths', physics: 'OCR A level physics' };

/* ---------- state ---------- */
let CUR = [];                  // raw curriculum files
let SUBJ = {};                 // id -> subject model
const UNITS = new Map();       // unit key -> unit model
const TOPICS = new Map();      // topic key -> topic model
let D = null;                  // saved data
let RES = { units: {}, topics: {} };   // checked links from curriculum/resources.json
const UI = { todayQ: '', palQ: '', pal: null, lastView: null, logPrefill: null, logLimit: 60, consMore: false,
  orbitSel: 'all', backups: null, warning: null, dataPath: '', lastLogSubject: null, lastKind: 'Questions', lastScoreSubject: null,
  openNotes: new Set() };

function freshData() {
  return {
    version: DATA_VERSION, created: Date.now(),
    units: {}, topics: {}, custom: { units: [], topics: {} },
    log: [], scores: [], trend: [], activity: {}, trash: [], links: {},
    exams: [{ id: uid(), name: 'A-level exams start (estimate, update when the timetable is out)', date: '2028-05-15' }],
    settings: { view: 'today', year: 1, scope: 'current', open: {}, collapsed: {}, timer: null, hideIntro: false, dueMode: 'chapter' },
  };
}
function migrate(d) {
  const f = freshData(), out = { ...f, ...d };
  out.custom = { units: [], topics: {}, ...(d.custom || {}) };
  out.settings = { ...f.settings, ...(d.settings || {}) };
  out.settings.open = out.settings.open || {};
  out.settings.collapsed = out.settings.collapsed || {};
  for (const k of ['log', 'scores', 'exams', 'trend', 'trash']) if (!Array.isArray(out[k])) out[k] = [];
  for (const k of ['units', 'topics', 'activity', 'links']) if (!out[k] || typeof out[k] !== 'object') out[k] = {};
  /* 1-10 ratings become RAG: 1-3 red, 4-6 amber, 7-10 green. The old number is left in place, unused. */
  for (const t of Object.values(out.topics)) if (t && t.conf && !t.rag) t.rag = ragFromNumber(t.conf);
  for (const u of Object.values(out.units)) if (u && u.conf && !u.rag) u.rag = ragFromNumber(u.conf);
  out.version = DATA_VERSION;
  return out;
}

/* Demo data ends on a fixed day. Move every date and timestamp by the same number of days so it ends today. */
function shiftDays(v, n) {
  if (typeof v === 'string') return /^\d{4}-\d{2}-\d{2}$/.test(v) ? addDays(v, n) : v;
  if (typeof v === 'number') return v > 1e12 ? v + n * DAY : v;
  if (Array.isArray(v)) return v.map(x => shiftDays(x, n));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [shiftDays(k, n), shiftDays(x, n)]));
  return v;
}

/* ---------- backend bridge (app.py over local HTTP, or localStorage + demo data in a plain browser) ---------- */
const Backend = {
  native: false,
  token: '',
  async connect() {
    this.token = decodeURIComponent(location.hash.slice(1));
    try { if (this.token) sessionStorage.setItem('st-token', this.token); else this.token = sessionStorage.getItem('st-token') || ''; } catch { /* ignore */ }
    if (!this.token) return false;
    try {
      const r = await fetch('/api/ping', { method: 'POST', headers: { 'X-Token': this.token }, body: '{}' });
      this.native = r.ok;
    } catch { this.native = false; }
    if (this.native) setInterval(() => { this.call('ping').catch(() => {}); }, 5000);
    return this.native;
  },
  async call(name, ...args) {
    if (!this.native) return null;
    const r = await fetch(`/api/${name}`, {
      method: 'POST', headers: { 'X-Token': this.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ args }),
    });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(out.error || `HTTP ${r.status}`);
    return out;
  },
  async load() {
    if (this.native) return this.call('load');
    const man = await (await fetch('../curriculum/manifest.json')).json();
    const curriculum = await Promise.all(man.files.map(f => fetch('../curriculum/' + f).then(r => r.json())));
    let resources = {};
    try { resources = await (await fetch('../curriculum/resources.json')).json(); } catch { /* optional */ }
    let data = null;
    try { data = JSON.parse(localStorage.getItem('study-tracker-preview')); } catch { /* none */ }
    if (!data) {
      try {
        const demo = await (await fetch('../demo/data.json')).json();
        const end = demo.trend.length ? demo.trend[demo.trend.length - 1].d : todayISO();
        data = shiftDays(demo, dayDiff(end, todayISO()));
      } catch { /* no demo, start empty */ }
    }
    return { curriculum, resources, data, warning: null, dataPath: 'browser preview (localStorage)' };
  },
  async save(data) {
    if (this.native) return this.call('save', data);
    try { localStorage.setItem('study-tracker-preview', JSON.stringify(data)); } catch { /* ignore */ }
    return { ok: true };
  },
  /* last-chance save while the window is closing */
  beacon(data) {
    if (this.native) navigator.sendBeacon(`/api/save?t=${encodeURIComponent(this.token)}`, new Blob([JSON.stringify({ args: [data] })], { type: 'text/plain' }));
    else this.save(data);
  },
};

let saveTimer = null, saving = null, dirty = false;
function persist() { dirty = true; setSaveState('saving'); clearTimeout(saveTimer); saveTimer = setTimeout(flush, 350); }
async function flush() {
  clearTimeout(saveTimer);
  if (saving) await saving;
  if (!dirty) return;
  dirty = false;
  saving = (async () => {
    try {
      D.savedAt = Date.now();
      await Backend.save(D);
      setSaveState('saved');
      try { localStorage.removeItem('st-unsaved'); } catch { /* ignore */ }
    } catch (err) {
      console.error(err); dirty = true; setSaveState('error');
      /* keep a copy inside the window so the next launch can recover it */
      try { localStorage.setItem('st-unsaved', JSON.stringify({ at: Date.now(), data: D })); } catch { /* ignore */ }
      saveTimer = setTimeout(flush, 3000);
    }
  })();
  await saving; saving = null;
}
function setSaveState(s) {
  const el = $('#saveState'); if (!el) return;
  el.classList.toggle('err', s === 'error');
  el.textContent = s === 'saving' ? 'Saving…' : s === 'error' ? 'Not saved yet, retrying. Keep this window open.'
    : `Saved ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}
window.addEventListener('pagehide', () => { if (dirty && D) Backend.beacon(D); });

/* ---------- curriculum model ---------- */
function buildModel() {
  SUBJ = {}; UNITS.clear(); TOPICS.clear();
  for (const s of CUR) {
    const subject = { id: s.id, name: s.name, board: s.board, color: s.color, source: s.source || '', papers: s.papers || {}, courses: [] };
    SUBJ[s.id] = subject;
    for (const c of s.courses) {
      const course = { id: c.id, name: c.name, subject, units: [] };
      subject.courses.push(course);
      const addUnit = (u, custom) => {
        const key = `${s.id}/${c.id}/${u.id}`;
        const unit = { key, id: u.id, name: u.name, defaultYear: u.year || 1, papers: u.papers || [], spec: u.spec || '',
          type: u.type || 'stages', unverified: u.unverified || '', custom, subject, course, topics: [] };
        const seen = new Set();
        const addTopic = (t, customTopic) => {
          const name = typeof t === 'string' ? t : t.name;
          const base = (typeof t === 'object' && t.id) || slug(name);
          let id = base, i = 2;
          while (seen.has(id)) id = `${base}-${i++}`;
          seen.add(id);
          const topic = { key: `${key}/${id}`, id, name, unit, custom: customTopic };
          unit.topics.push(topic); TOPICS.set(topic.key, topic);
        };
        (u.topics || []).forEach(t => addTopic(t, false));
        (D.custom.topics[key] || []).forEach(t => addTopic(t, true));
        UNITS.set(key, unit); course.units.push(unit);
      };
      c.units.forEach(u => addUnit(u, false));
      D.custom.units.filter(u => u.subject === s.id && u.course === c.id).forEach(u => addUnit(u, true));
    }
  }
}

/* ---------- accessors + stats ---------- */
const subj = id => SUBJ[id] || OTHER;
const U = key => D.units[key] || {};
const uw = key => (D.units[key] = D.units[key] || {});
const stageOf = tkey => (D.topics[tkey] && D.topics[tkey].stage) || 0;
const yearOf = u => U(u.key).year || u.defaultYear;
const isHidden = u => !!U(u.key).hidden;
const legacyRag = u => U(u.key).rag || '';           /* old chapter-level rating, used until its topics are rated */
const ragOf = tkey => (D.topics[tkey] && D.topics[tkey].rag) || '';
const ragRank = r => (r === 'red' ? 0 : r === 'amber' ? 1 : r === 'green' ? 2 : 3);
const ratedTopics = u => u.topics.filter(t => ragOf(t.key));
function ragCounts(topics) {
  const c = { red: 0, amber: 0, green: 0, none: 0 };
  for (const t of topics) c[ragOf(t.key) || 'none']++;
  return c;
}
/* 0-1 "how solid is this chapter", used by the orbit and landscape visuals */
function confOf(u) {
  const r = ratedTopics(u);
  if (r.length) return r.reduce((a, t) => a + RAG[ragOf(t.key)].v, 0) / r.length;
  return legacyRag(u) ? RAG[legacyRag(u)].v : 0;
}
const taughtUnit = u => u.topics.some(t => stageOf(t.key) >= 1 || ragOf(t.key));
/* "Current" = chapters you've been taught, plus the next few ahead, so there's always something to learn into. */
function inScope(list) {
  if (D.settings.scope === 'all') return list;
  let ahead = 0;
  return list.filter(u => taughtUnit(u) || ahead++ < LOOKAHEAD);
}
function scopeKeys() {
  if (D.settings.scope === 'all') return null;
  const yr = D.settings.year, keys = new Set();
  for (const s of Object.values(SUBJ)) {
    for (const c of s.courses) {
      inScope(c.units.filter(u => !isHidden(u) && (!yr || yearOf(u) === yr))).forEach(u => keys.add(u.key));
    }
  }
  return keys;
}
const topicsOf = units => units.flatMap(u => u.topics);
const unitsFor = (subjectId, year = D.settings.year) =>
  [...UNITS.values()].filter(u => u.subject.id === subjectId && !isHidden(u) && (!year || yearOf(u) === year));
function stageCounts(topics) {
  const c = [0, 0, 0, 0, 0];
  for (const t of topics) { const s = stageOf(t.key); c[t.unit.type === 'checklist' ? (s >= 4 ? 4 : 0) : s]++; }
  return c;
}
function progressPct(topics) {
  if (!topics.length) return 0;
  return Math.round(topics.reduce((a, t) => a + stageOf(t.key), 0) / (topics.length * 4) * 100);
}
function greenPct(units) {
  const rated = topicsOf(units.filter(u => u.type !== 'checklist')).filter(t => ragOf(t.key));
  return rated.length ? Math.round(rated.filter(t => ragOf(t.key) === 'green').length / rated.length * 100) : 0;
}
function topicReview(t) {
  const p = D.topics[t.key];
  if (!p || !p.rag || !p.reviewedAt || t.unit.type === 'checklist') return null;
  const dueISO = addDays(isoDate(p.reviewedAt), REVIEW_DAYS(p.rag));
  const diff = dayDiff(todayISO(), dueISO);
  return { t, dueISO, diff, due: diff <= 0 };
}
function reviewState(u) {
  if (u.type === 'checklist') return null;
  const rs = u.topics.map(topicReview).filter(Boolean);
  if (rs.length) {
    const soonest = rs.reduce((a, b) => (a.diff <= b.diff ? a : b));
    return { diff: soonest.diff, dueISO: soonest.dueISO, due: soonest.due, dueCount: rs.filter(r => r.due).length };
  }
  const d = U(u.key);                                  /* falls back to the old chapter rating */
  if (!d.rag || !d.reviewedAt) return null;
  const dueISO = addDays(isoDate(d.reviewedAt), REVIEW_DAYS(d.rag));
  const diff = dayDiff(todayISO(), dueISO);
  return { diff, dueISO, due: diff <= 0, dueCount: diff <= 0 ? 1 : 0, legacy: true };
}
function reviewText(u) {
  const r = reviewState(u); if (!r) return '';
  if (r.due) return `<span class="due">${r.dueCount > 1 ? `${r.dueCount} topics due` : 'due for review'}</span>`;
  return `next review in ${r.diff}d`;
}
function lastReviewed(u) {
  const ts = u.topics.map(t => D.topics[t.key]).filter(p => p && p.rag && p.reviewedAt).map(p => p.reviewedAt);
  return ts.length ? Math.max(...ts) : U(u.key).reviewedAt || 0;
}
function consolidateList() {
  return [...TOPICS.values()]
    .filter(t => t.unit.type !== 'checklist' && !isHidden(t.unit) && stageOf(t.key) === 1)
    .sort((a, b) => D.topics[a.key].at - D.topics[b.key].at);
}
function dueList() {
  return [...UNITS.values()].filter(u => !isHidden(u)).map(u => ({ u, r: reviewState(u) }))
    .filter(x => x.r && x.r.due).sort((a, b) => confOf(a.u) - confOf(b.u) || a.r.diff - b.r.diff).map(x => x.u);
}
function legacyDueUnits() {
  return [...UNITS.values()].filter(u => { const r = !isHidden(u) && reviewState(u); return r && r.legacy && r.due; });
}
function dueTopics() {
  return [...UNITS.values()].filter(u => !isHidden(u))
    .flatMap(u => u.topics.map(topicReview).filter(r => r && r.due))
    .sort((a, b) => ragRank(ragOf(a.t.key)) - ragRank(ragOf(b.t.key)) || a.diff - b.diff);
}
function dueCount() { return dueTopics().length + legacyDueUnits().length; }
function unratedTopics() {
  return [...TOPICS.values()]
    .filter(t => t.unit.type !== 'checklist' && !isHidden(t.unit) && !ragOf(t.key) && stageOf(t.key) >= 2)
    .sort((a, b) => stageOf(b.key) - stageOf(a.key));
}
function activeDays() { return new Set([...Object.keys(D.activity), ...D.log.map(e => e.date)]); }
function streak() {
  const days = activeDays(); let d = todayISO(), n = 0;
  if (!days.has(d)) d = addDays(d, -1);
  while (days.has(d)) { n++; d = addDays(d, -1); }
  return n;
}
function weekSummary() {
  const ws = weekStart(), we = addDays(ws, 6), days = activeDays();
  const entries = D.log.filter(e => e.date >= ws && e.date <= we), per = {};
  entries.forEach(e => { const k = SUBJ[e.subject] ? e.subject : 'other'; per[k] = (per[k] || 0) + e.minutes; });
  return {
    total: entries.reduce((a, e) => a + e.minutes, 0), per, sessions: entries.length,
    days: Array.from({ length: 7 }, (_, i) => { const d = addDays(ws, i); return { d, active: days.has(d) }; }),
  };
}

/* ---------- mutations ---------- */
function markActivity(date = todayISO()) { D.activity[date] = (D.activity[date] || 0) + 1; }
function snapshotTrend() {
  const d = todayISO(), s = {};
  for (const subject of Object.values(SUBJ)) {
    const all = [...UNITS.values()].filter(u => u.subject === subject && !isHidden(u));
    s[subject.id] = [
      progressPct(topicsOf(all.filter(u => yearOf(u) === 1))),
      progressPct(topicsOf(all.filter(u => yearOf(u) === 2))),
      progressPct(topicsOf(all)),
      greenPct(all),
    ];
  }
  const last = D.trend[D.trend.length - 1];
  if (last && last.d === d) last.s = s; else D.trend.push({ d, s });
  if (D.trend.length > 1500) D.trend.splice(0, D.trend.length - 1500);
}
function setStage(tkey, stage) {
  const cur = D.topics[tkey] || {};
  if (stage <= 0) {
    if (cur.note || cur.rag) D.topics[tkey] = { ...cur, stage: 0, at: Date.now() };
    else delete D.topics[tkey];
  } else D.topics[tkey] = { ...cur, stage, at: Date.now(), taughtAt: cur.taughtAt || Date.now() };
  autoTouch(tkey, false); recordStudied(tkey); markActivity(); snapshotTrend(); persist();
}
function setTopicRag(tkey, rag) {
  const cur = D.topics[tkey] || {};
  if (RAG[rag]) D.topics[tkey] = { ...cur, rag, reviewedAt: Date.now(), at: Date.now() };
  else {
    const next = { ...cur }; delete next.rag; delete next.conf; delete next.reviewedAt;
    if (next.stage || next.note) D.topics[tkey] = next; else delete D.topics[tkey];
  }
  autoTouch(tkey, true); recordStudied(tkey); markActivity(); snapshotTrend(); persist();
}
/* Study mode. While it runs, updating a topic counts as actually studying it: the review clock
   resets and the time is logged against the chapters you touched. Off, edits are silent tidying. */
function recordStudied(tkey) {
  const s = D.settings.timer, t = TOPICS.get(tkey);
  if (!s || !t) return;
  s.touched = s.touched || {};
  const list = s.touched[t.unit.key] = s.touched[t.unit.key] || [];
  if (!list.includes(tkey)) list.push(tkey);
  const p = D.topics[tkey];
  if (p && p.conf) p.reviewedAt = Date.now();
}
/* A time field that stays locked until you deliberately press "Change time…". */
function timeLockHTML(mins) {
  return `<div class="tlock"><div class="tlock-v"><span class="lbl">Time</span><b data-tl-show>${fmtMins(mins)}</b><small data-tl-was></small></div>
    <button type="button" class="sm ghost" data-tl-unlock>Change time…</button>
    <label class="tlock-in" data-tl-edit hidden><input type="number" min="1" max="900" step="1" value="${mins}" data-tl-input> minutes</label></div>`;
}
function wireTimeLock(root, mins) {
  const show = root.querySelector('[data-tl-show]'), was = root.querySelector('[data-tl-was]');
  const unlock = root.querySelector('[data-tl-unlock]'), edit = root.querySelector('[data-tl-edit]'), inp = root.querySelector('[data-tl-input]');
  let unlocked = false;
  unlock.addEventListener('click', () => { unlocked = true; unlock.hidden = true; edit.hidden = false; inp.focus(); inp.select(); });
  inp.addEventListener('input', () => {
    const v = Math.round(+inp.value);
    show.textContent = v > 0 ? fmtMins(v) : '–';
    was.textContent = v > 0 && v !== mins ? `was ${fmtMins(mins)}` : '';
  });
  return () => {
    if (!unlocked) return { ok: true, mins, changed: false };
    const v = Math.round(+inp.value);
    return v >= 1 && v <= 900 ? { ok: true, mins: v, changed: v !== mins } : { ok: false };
  };
}
function finishStudy() {
  const s = D.settings.timer; if (!s) return;
  const recorded = Math.max(1, Math.round((Date.now() - s.start) / 60000));
  const touched = Object.entries(s.touched || {}).filter(([k]) => UNITS.has(k));
  const sid = touched.length ? UNITS.get(touched[0][0]).subject.id : (UI.lastLogSubject || Object.keys(SUBJ)[0]);
  const m = openModal(`<div class="mcap">Finish study session</div>
    <h3>Save this session</h3>
    <label class="lbl" for="sessName">Name <small>(optional)</small></label>
    <input class="minput" id="sessName" maxlength="80" placeholder="e.g. Quadratics Ex 2C" autocomplete="off">
    ${timeLockHTML(recorded)}
    ${touched.length
      ? `<p class="mtext">Logged against ${touched.length > 1 ? `${plural(touched.length, 'chapter')}, split evenly: ` : ''}${touched.map(([k, ts]) => `<b>${esc(UNITS.get(k).name)}</b> (${plural(ts.length, 'topic')} updated)`).join(', ')}.</p>`
      : `<p class="mtext">You didn't update any topics, so pick what this was.</p>
        <div class="form"><label>Subject<select id="sessSubj" data-units-for="sessUnit">${subjectOptions(sid)}</select></label>
        <label>Unit <small>(optional)</small><select id="sessUnit">${unitOptions(sid)}</select></label></div>`}
    <div class="mfoot"><button class="ghost dangertext" data-m="discard">Discard…</button><div class="grow"></div>
      <button data-m="cancel">Keep studying</button><button class="primary" data-m="save">Save session</button></div>`);
  const getTime = wireTimeLock(m.el, recorded);
  m.el.querySelector('#sessName').focus();
  m.el.querySelector('[data-m=save]').addEventListener('click', () => {
    const t = getTime();
    if (!t.ok) return toast('Enter a time between 1 and 900 minutes');
    const title = m.el.querySelector('#sessName').value.trim();
    const base = { date: todayISO(), kind: 'Study session', at: Date.now(),
      ...(title ? { title } : {}), ...(t.changed ? { edited: true, recordedMinutes: recorded } : {}) };
    if (touched.length) {
      const n = touched.length, each = Math.floor(t.mins / n);
      touched.forEach(([key, topics], i) => {
        const u = UNITS.get(key);
        D.log.push({ id: uid(), ...base, subject: u.subject.id, unit: key,
          minutes: Math.max(1, each + (i < t.mins % n ? 1 : 0)), note: `${plural(topics.length, 'topic')} updated` });
      });
    } else {
      const subject = m.el.querySelector('#sessSubj').value, unit = m.el.querySelector('#sessUnit').value;
      D.log.push({ id: uid(), ...base, subject, unit, minutes: t.mins, note: '' });
      UI.lastLogSubject = subject;
    }
    D.settings.timer = null;
    markActivity(); m.close(); persist(); render();
    toast(`Saved ${title ? `“${title}” · ` : ''}${fmtMins(t.mins)}${t.changed ? ` (changed from ${fmtMins(recorded)})` : ''}`);
  });
  m.el.querySelector('[data-m=discard]').addEventListener('click', async () => {
    m.close();
    const ok = await confirmTyped({ title: 'Discard this study session?', word: 'discard', button: 'Discard session',
      body: `${fmtMins(recorded)} of study won’t be logged. Topic stages and ratings you changed stay as they are.` });
    if (ok) { D.settings.timer = null; persist(); render(); toast('Session discarded'); }
    else finishStudy();
  });
}
function editLog(id) {
  const e = D.log.find(x => x.id === id); if (!e) return;
  const u = UNITS.get(e.unit);
  const m = openModal(`<div class="mcap">Edit session</div>
    <h3>${esc(e.title || (u ? u.name : 'General'))}</h3>
    <p class="mtext">${esc(subj(e.subject).name)}${u ? ` · ${esc(u.name)}` : ''} · ${fmtDate(e.date, { weekday: 'short', day: 'numeric', month: 'short' })} · ${esc(e.kind)}${e.recordedMinutes ? ` · originally ${fmtMins(e.recordedMinutes)}` : ''}</p>
    <label class="lbl" for="editName">Name</label>
    <input class="minput" id="editName" maxlength="80" value="${esc(e.title || '')}" placeholder="e.g. Quadratics Ex 2C" autocomplete="off">
    ${timeLockHTML(e.minutes)}
    <div class="mfoot"><button data-m="cancel">Cancel</button><button class="primary" data-m="save">Save</button></div>`);
  const getTime = wireTimeLock(m.el, e.minutes);
  const name = m.el.querySelector('#editName');
  name.focus(); name.select();
  m.el.querySelector('[data-m=save]').addEventListener('click', () => {
    const t = getTime();
    if (!t.ok) return toast('Enter a time between 1 and 900 minutes');
    const title = name.value.trim(), before = e.minutes;
    if (title) e.title = title; else delete e.title;
    if (t.changed) { if (!e.recordedMinutes) e.recordedMinutes = before; e.minutes = t.mins; e.edited = true; }
    m.close(); persist(); render();
    toast(t.changed ? `Time changed from ${fmtMins(before)} to ${fmtMins(t.mins)}` : 'Session updated');
  });
}
/* ---------- automatic sessions ----------
   Rating a topic starts one on its own. Anything else you touch within AUTO_GAP minutes joins it,
   and it's written to the log once you've stopped for that long (or next time the app opens). */
const AUTO_GAP = 45, AUTO_PAD = 5, AUTO_MIN = 5;   // minutes
const autoOn = () => D.settings.autoLog !== false;
function autoTouch(tkey, starts) {
  if (!autoOn() || D.settings.timer) return;       // a manual session is already counting the time
  const now = Date.now(), open = D.settings.auto;
  if (open && now - open.lastAt > AUTO_GAP * 60000) closeAuto(true);
  if (!D.settings.auto) {
    if (!starts) return;                           // stage changes join a session but never start one
    D.settings.auto = { startedAt: now, lastAt: now, touched: {} };
  }
  const s = D.settings.auto, t = TOPICS.get(tkey);
  s.lastAt = now;
  if (!t) return;
  const list = s.touched[t.unit.key] = s.touched[t.unit.key] || [];
  if (!list.includes(tkey)) list.push(tkey);
}
function closeAuto(silent) {
  const a = D.settings.auto;
  if (!a) return 0;
  D.settings.auto = null;
  const touched = Object.entries(a.touched || {}).filter(([k]) => UNITS.has(k));
  if (!touched.length) return 0;
  const mins = Math.max(AUTO_MIN, Math.round((a.lastAt - a.startedAt) / 60000) + AUTO_PAD);
  const per = Math.floor(mins / touched.length), date = isoDate(a.startedAt);
  touched.forEach(([key, topics], i) => {
    const u = UNITS.get(key);
    D.log.push({
      id: uid(), date, subject: u.subject.id, unit: key, kind: 'Study session', auto: true,
      minutes: Math.max(1, per + (i < mins % touched.length ? 1 : 0)),
      note: `${plural(topics.length, 'topic')} updated`, at: a.lastAt,
    });
  });
  markActivity(date);
  if (!silent) toast(`Logged ${fmtMins(mins)} automatically across ${plural(touched.length, 'chapter')}`);
  return mins;
}
function autoChip() {
  const a = D.settings.auto;
  if (!a || D.settings.timer) return '';
  const n = Object.values(a.touched || {}).reduce((x, l) => x + l.length, 0);
  return `<div class="timer auto" title="Started when you rated a topic. It saves itself once you've stopped for ${AUTO_GAP} minutes.">
    <i></i><span>logging ${plural(n, 'topic')}</span><button class="sm" data-action="auto-save">Save now</button></div>`;
}
function studyButton() {
  const s = D.settings.timer;
  return s
    ? `<div class="timer"><span data-timer>${fmtClock(Date.now() - s.start)}</span><button class="sm primary" data-action="study-stop">Stop &amp; log</button></div>`
    : `${autoChip()}<button class="${D.settings.auto ? 'sm ghost' : 'primary'}" data-action="study-start">▶ Start studying</button>`;
}
function toTrash(kind, payload, label) {
  const id = uid();
  D.trash.unshift({ id, kind, payload, label, at: Date.now() });
  return id;
}

/* ---------- modals, menus, toast ---------- */
const MODALS = [];
function openModal(html, { wide = false, top = false, onClose } = {}) {
  const wrap = document.createElement('div');
  wrap.className = `modal${top ? ' top' : ''}`;
  wrap.innerHTML = `<div class="mbox${wide ? ' wide' : ''}" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(wrap);
  const m = {
    el: wrap,
    close() {
      if (!wrap.isConnected) return;
      wrap.remove(); MODALS.splice(MODALS.indexOf(m), 1);
      if (onClose) onClose();
    },
  };
  MODALS.push(m);
  wrap.addEventListener('mousedown', e => { if (e.target === wrap) m.close(); });
  wrap.querySelectorAll('[data-m=close],[data-m=cancel]').forEach(b => b.addEventListener('click', () => m.close()));
  return m;
}
function confirmTyped({ title, body = '', word = 'delete', button = 'Delete' }) {
  return new Promise(resolve => {
    let ok = false;
    const m = openModal(`<h3>${esc(title)}</h3>${body ? `<p class="mtext">${body}</p>` : ''}
      <label class="lbl" for="cfmIn">Type <b>${esc(word)}</b> to confirm</label>
      <input class="minput" id="cfmIn" autocomplete="off" spellcheck="false">
      <div class="mfoot"><button data-m="cancel">Cancel</button><button class="danger" data-m="ok" disabled>${esc(button)}</button></div>`,
      { onClose: () => resolve(ok) });
    const inp = m.el.querySelector('#cfmIn'), btn = m.el.querySelector('[data-m=ok]');
    const valid = () => inp.value.trim().replace(/\s+/g, ' ').toLowerCase() === word;
    inp.focus();
    inp.addEventListener('input', () => { btn.disabled = !valid(); });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter' && valid()) { ok = true; m.close(); } });
    btn.addEventListener('click', () => { ok = true; m.close(); });
  });
}
function confirmPlain({ title, body = '', button = 'OK' }) {
  return new Promise(resolve => {
    let ok = false;
    const m = openModal(`<h3>${esc(title)}</h3>${body ? `<p class="mtext">${body}</p>` : ''}
      <div class="mfoot"><button data-m="cancel">Cancel</button><button class="danger" data-m="ok">${esc(button)}</button></div>`,
      { onClose: () => resolve(ok) });
    m.el.querySelector('[data-m=ok]').addEventListener('click', () => { ok = true; m.close(); });
  });
}
function askText({ title, value = '', placeholder = '', button = 'Save' }) {
  return new Promise(resolve => {
    let result = null;
    const m = openModal(`<h3>${esc(title)}</h3>
      <input class="minput" id="askIn" maxlength="120" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off">
      <div class="mfoot"><button data-m="cancel">Cancel</button><button class="primary" data-m="ok">${esc(button)}</button></div>`,
      { onClose: () => resolve(result) });
    const inp = m.el.querySelector('#askIn');
    const done = () => { const v = inp.value.trim(); if (!v) { inp.focus(); return; } result = v; m.close(); };
    inp.focus(); inp.select();
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') done(); });
    m.el.querySelector('[data-m=ok]').addEventListener('click', done);
  });
}

let openMenuEl = null;
function closeMenu() { if (openMenuEl) { openMenuEl.remove(); openMenuEl = null; } }
function openMenu(anchor, items) {
  closeMenu();
  const m = document.createElement('div');
  m.className = 'menu';
  m.innerHTML = items.map((it, i) => it === '-' ? '<hr>' : `<button data-mi="${i}" class="${it.danger ? 'danger' : ''}">${esc(it.label)}</button>`).join('');
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect();
  m.style.left = `${Math.max(8, Math.min(r.right - m.offsetWidth, innerWidth - m.offsetWidth - 8))}px`;
  m.style.top = `${r.bottom + m.offsetHeight + 8 > innerHeight ? r.top - m.offsetHeight - 4 : r.bottom + 4}px`;
  m.addEventListener('click', e => {
    const b = e.target.closest('[data-mi]'); if (!b) return;
    closeMenu(); items[+b.dataset.mi].fn();
  });
  openMenuEl = m;
}
document.addEventListener('mousedown', e => { if (openMenuEl && !openMenuEl.contains(e.target)) closeMenu(); }, true);

function toast(msg, action) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button class="sm">${esc(action.label)}</button>` : ''}`;
  t.classList.add('show');
  if (action) t.querySelector('button').onclick = () => { t.classList.remove('show'); action.fn(); };
  clearTimeout(toast.tm);
  toast.tm = setTimeout(() => t.classList.remove('show'), action ? 7000 : 3000);
}

/* ---------- shared bits of markup ---------- */
function stageBar(counts, cls = '') {
  const total = counts.reduce((a, b) => a + b, 0) || 1;
  return `<div class="sbar ${cls}">${[4, 3, 2, 1].map(s => counts[s] ? `<i style="width:${counts[s] / total * 100}%;background:${STAGES[s].color}"></i>` : '').join('')}</div>`;
}
function stageLegend(counts) {
  return `<div class="legend">${[1, 2, 3, 4].map(s => `<span><i style="background:${STAGES[s].color}"></i>${STAGES[s].label} <b>${counts[s]}</b></span>`).join('')}<span><i style="background:${STAGES[0].color}"></i>Not started <b>${counts[0]}</b></span></div>`;
}
const empty = text => `<div class="empty">${text}</div>`;
const pill = s => `<span class="pill" style="--pc:${s.color}">${esc(s.name)}</span>`;
function scopeSwitch() {
  const s = D.settings.scope === 'all' ? 'all' : 'current';
  return `<div class="seg"><button class="${s === 'current' ? 'on' : ''}" data-action="set-scope" data-scope="current" title="Chapters you've been taught, plus the next ${LOOKAHEAD} ahead in each strand">Current</button><button class="${s === 'all' ? 'on' : ''}" data-action="set-scope" data-scope="all" title="Every chapter in the course">All</button></div>`;
}
function yearSwitch() {
  const y = D.settings.year;
  return `<div class="seg">${[[1, 'Year 1'], [2, 'Year 2'], [0, 'All']].map(([v, l]) =>
    `<button class="${y === v ? 'on' : ''}" data-action="set-year" data-year="${v}">${l}</button>`).join('')}</div>`;
}
function stageButtons(t) {
  const s = stageOf(t.key);
  if (t.unit.type === 'checklist') {
    return `<button class="chk ${s >= 4 ? 'on' : ''}" data-action="toggle-check" data-topic="${esc(t.key)}">${s >= 4 ? '✓ Done' : 'Mark done'}</button>`;
  }
  return `<div class="stages">${STAGES.slice(1).map(st =>
    `<button class="stg${s >= st.n ? ' fill' : ''}${s === st.n ? ' cur' : ''}" style="--sc:${st.color}" data-action="stage" data-topic="${esc(t.key)}" data-stage="${st.n}" title="${esc(st.hint)}${s === st.n ? ' (click again to step back)' : ''}">${st.short}</button>`).join('')}</div>`;
}
function ragButtons(t) {
  const cur = ragOf(t.key);
  return `<div class="rag">${RAG_ORDER.map(r => `<button class="ragb ${r}${cur === r ? ' on' : ''}" data-action="set-rag" data-topic="${esc(t.key)}" data-rag="${r}" title="${RAG[r].label}: ${esc(RAG[r].hint)}${cur === r ? ' · click again to clear' : ''}">${RAG[r].label[0]}</button>`).join('')}</div>`;
}
function ragBar(c, cls = '') {
  const total = c.red + c.amber + c.green + c.none || 1;
  return `<div class="ragbar ${cls}" title="${c.green} green · ${c.amber} amber · ${c.red} red · ${c.none} unrated">${
    [['green', c.green], ['amber', c.amber], ['red', c.red], ['none', c.none]]
      .map(([k, n]) => (n ? `<i class="${k}" style="width:${n / total * 100}%"></i>` : '')).join('')}</div>`;
}
const ragLegend = c => `<div class="legend">${RAG_ORDER.slice().reverse()
  .map(r => `<span><i style="background:${RAG[r].color}"></i>${RAG[r].label} <b>${c[r]}</b></span>`).join('')}<span><i style="background:#2a3040"></i>Unrated <b>${c.none}</b></span></div>`;
function topicRow(t, opt = {}) {
  const p = D.topics[t.key], u = t.unit;
  const status = p && p.stage ? (u.type === 'checklist' ? `done ${ago(p.at)}` : `${STAGES[p.stage].label.toLowerCase()} · ${ago(p.at)}`) : '';
  const note = (p && p.note) || '', open = UI.openNotes.has(t.key);
  const rv = topicReview(t);
  const linkCount = (RES.topics[t.key] || []).length + (D.links[t.key] || []).length;
  const line = [status, rv ? (rv.due ? '<b class="due">review due</b>' : `next review in ${rv.diff}d`) : ''].filter(Boolean).join(' · ');
  return `<div class="trow${opt.stack ? ' stack' : ''}" data-topic-row="${esc(t.key)}">
    <div class="tname">${opt.context ? `<button class="tctx" data-action="open-topic" data-topic="${esc(t.key)}" title="Open in ${esc(u.subject.name)}"><i class="dot" style="background:${u.subject.color}"></i>${esc(u.subject.name)} · ${esc(u.name)}</button>` : ''}
      <span>${esc(t.name)}</span>${line ? `<small>${line}</small>` : ''}</div>
    ${stageButtons(t)}
    ${u.type === 'checklist' ? '<span class="icon-spacer"></span>' : ragButtons(t)}
    <button class="icon link-btn${linkCount ? ' on' : ''}" data-action="open-resources" data-key="${esc(t.key)}" title="${linkCount ? `Resources (${linkCount} for this topic, plus chapter links)` : 'Resources for this chapter and search links'}">↗</button>
    <button class="icon note-btn${note ? ' on' : ''}" data-action="toggle-note" data-topic="${esc(t.key)}" title="${note ? 'Edit note' : 'Add a note for this topic'}">✎</button>
    ${t.custom ? `<button class="icon" data-action="topic-menu" data-topic="${esc(t.key)}" title="Topic options">⋯</button>` : '<span class="icon-spacer"></span>'}
    ${open ? `<textarea class="tnote" id="tn:${esc(t.key)}" data-topic="${esc(t.key)}" rows="2" placeholder="Note for “${esc(t.name)}”: what's tricky, textbook page, a question to ask…">${esc(note)}</textarea>`
      : note ? `<div class="tnoteview" data-action="toggle-note" data-topic="${esc(t.key)}" title="Click to edit">${esc(note)}</div>` : ''}
  </div>`;
}
function unitMiniRow(u, mode) {
  const sub = mode === 'stale' ? `last reviewed ${ago(lastReviewed(u))}` : reviewText(u) || `${progressPct(u.topics)}% of topic stages done`;
  return `<div class="mrow">${pill(u.subject)}
    <button class="mname" data-action="open-unit" data-unit="${esc(u.key)}">${esc(u.name)}<small>${esc(u.course.name)} · ${sub}</small></button>
    ${ragBar(ragCounts(u.topics), 'mini')}</div>`;
}
function topicMiniRow(t, sub, opt = {}) {
  return `<div class="mrow">${opt.nopill ? '' : pill(t.unit.subject)}
    <button class="mname" data-action="open-topic" data-topic="${esc(t.key)}">${esc(t.name)}<small>${opt.nopill ? '' : `${esc(t.unit.name)} · `}${sub}</small></button>
    ${ragButtons(t)}</div>`;
}
function subjectOptions(selected, includeOther = true) {
  const list = [...Object.values(SUBJ), ...(includeOther ? [OTHER] : [])];
  return list.map(s => `<option value="${esc(s.id)}" ${s.id === selected ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
}
function unitOptions(subjectId, selected = '') {
  const s = SUBJ[subjectId];
  if (!s) return '<option value="">(no units)</option>';
  return '<option value="">Whole subject / general</option>' + s.courses.map(c => {
    const us = c.units.filter(u => !isHidden(u));
    return us.length ? `<optgroup label="${esc(c.name)}">${us.map(u =>
      `<option value="${esc(u.key)}" ${u.key === selected ? 'selected' : ''}>${esc(u.name)}${yearOf(u) === 2 ? ' (Y2)' : ''}</option>`).join('')}</optgroup>` : '';
  }).join('');
}
function readForm(name) {
  const f = $(`form[data-form="${name}"]`);
  return f ? Object.fromEntries(new FormData(f)) : {};
}

/* =========================================================
   Views
   ========================================================= */
function viewToday() {
  const dateStr = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const cons = consolidateList();
  const shown = UI.consMore ? cons : cons.slice(0, 8);
  return `
  <header class="page-h"><div><h1>Today</h1><div class="sub">${dateStr}</div></div><div class="grow"></div>
    <button class="sm ghost" data-action="nav" data-view="log">+ Log manually</button><button class="primary" data-action="what-now">What now?</button>${studyButton()}</header>
  ${countdowns()}
  ${D.settings.hideIntro ? '' : intro()}
  <div class="grid g-today">
    <section class="card"><div class="card-h"><h2>What did you cover?</h2><span class="hint">Search a topic, then click how far you've got</span></div>
      <input id="todayQ" class="bigsearch" placeholder="e.g. discriminant, suvat, resistivity, matrices…" value="${esc(UI.todayQ)}" autocomplete="off" spellcheck="false">
      <div id="todayResults">${todayResults()}</div></section>
    <section class="card">${weekCard()}</section>
  </div>
  <div class="grid g3">
    <section class="card"><div class="card-h"><h2>Consolidate</h2><span class="count">${cons.length}</span></div>
      <p class="hint">Taught in class but no notes yet. Oldest first.</p>
      ${cons.length ? shown.map(t => topicRow(t, { context: true, stack: true })).join('')
        + (cons.length > shown.length ? `<button class="link" data-action="cons-more">Show all ${cons.length}</button>` : '')
        : empty('Nothing waiting. After a lesson, search what you covered and mark it <b>Taught</b>.')}
    </section>
    <section class="card">${dueCard()}</section>
    <section class="card">${rateCard()}</section>
  </div>`;
}
function intro() {
  return `<section class="card intro"><div class="card-h"><h2>How to use this</h2><div class="grow"></div><button class="sm ghost" data-action="hide-intro">Got it, hide this</button></div>
    <ol>
      <li><b>After every lesson</b>, search what you covered in the box below and click <b>Taught</b>. It then shows up under Consolidate.</li>
      <li>Move each topic along: <b>Notes</b> once you've written it up, <b>Practised</b> after questions, <b>Confident</b> when you could do an exam question cold.</li>
      <li>Rate each topic <b>R</b>, <b>A</b> or <b>G</b> in its row: red if you can't start it, amber if you need notes or make slips, green if you could do an unseen exam question. Red comes back in 2 days, amber 7, green 21.</li>
      <li>Not sure what to revise? Hit <b>What now?</b> and it picks your next session for you.</li>
      <li><b>Time logs itself.</b> Rating a topic starts a session, anything else within 45 minutes joins it, and it saves to your study log once you stop. Hit <b>Start studying</b> if you'd rather watch a timer run.</li>
      <li>Add your <b>mock dates</b> in Settings. Mistakes are safe: deleting needs you to type <b>delete</b>, and a backup is made every day.</li>
    </ol></section>`;
}
function countdowns() {
  const today = todayISO();
  const next = D.exams.filter(e => e.date >= today).sort((a, b) => a.date < b.date ? -1 : 1).slice(0, 4);
  if (!next.length) return `<div class="cds"><button class="sm ghost" data-action="nav" data-view="settings">+ Add exam and mock dates</button></div>`;
  return `<div class="cds">${next.map(e => { const n = dayDiff(today, e.date);
    return `<div class="cd"><b>${n}</b><span>${n === 1 ? 'day' : 'days'}</span><em>${esc(e.name)}</em><small>${fmtDate(e.date, { day: 'numeric', month: 'short', year: 'numeric' })}</small></div>`; }).join('')}</div>`;
}
function searchTopics(q, limit) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const out = [];
  for (const t of TOPICS.values()) {
    if (isHidden(t.unit)) continue;
    const hay = `${t.name} ${t.unit.name} ${t.unit.course.name} ${t.unit.subject.name}`.toLowerCase();
    if (!words.every(w => hay.includes(w))) continue;
    const inName = words.every(w => t.name.toLowerCase().includes(w));
    out.push({ t, score: (inName ? 0 : 10) + (D.settings.year && yearOf(t.unit) !== D.settings.year ? 1 : 0) });
  }
  return out.sort((a, b) => a.score - b.score).slice(0, limit).map(x => x.t);
}
function searchUnits(q, limit) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return [...UNITS.values()].filter(u => !isHidden(u) && words.every(w => `${u.name} ${u.course.name} ${u.subject.name}`.toLowerCase().includes(w))).slice(0, limit);
}
function todayResults() {
  const q = UI.todayQ.trim();
  if (!q) {
    const recent = Object.entries(D.topics).filter(([k]) => TOPICS.has(k)).sort((a, b) => b[1].at - a[1].at).slice(0, 5).map(([k]) => TOPICS.get(k));
    return recent.length ? `<div class="palcap">Recently updated</div>${recent.map(t => topicRow(t, { context: true })).join('')}`
      : empty('Try typing a topic from today’s lesson.');
  }
  const res = searchTopics(q, 12);
  return res.length ? res.map(t => topicRow(t, { context: true })).join('')
    : empty(`No topics match “${esc(q)}”. You can add your own topic inside any unit.`);
}
function weekCard() {
  const w = weekSummary(), st = streak();
  const ids = [...Object.keys(SUBJ), 'other'].filter(id => SUBJ[id] || w.per[id]);
  const max = Math.max(1, ...Object.values(w.per));
  return `<div class="card-h"><h2>This week</h2><div class="grow"></div><span class="kpi-inline">${fmtMins(w.total)}</span></div>
    <div class="weekdots">${w.days.map(x => `<div class="wd${x.active ? ' on' : ''}${x.d === todayISO() ? ' today' : ''}" title="${fmtDate(x.d, { weekday: 'long', day: 'numeric', month: 'short' })}"><i></i><span>${parseISO(x.d).toLocaleDateString('en-GB', { weekday: 'narrow' })}</span></div>`).join('')}</div>
    ${ids.map(id => `<div class="hb"><span>${esc(subj(id).name)}</span><div class="hbt"><i style="width:${(w.per[id] || 0) / max * 100}%;background:${subj(id).color}"></i></div><b>${w.per[id] ? fmtMins(w.per[id]) : '–'}</b></div>`).join('')}
    <div class="streak">${st ? `<b>${st}</b>-day streak` : 'No streak yet. Update or log something today to start one.'} · ${plural(w.sessions, 'session')} logged this week</div>`;
}
function dueCard() {
  const mode = D.settings.dueMode === 'topic' ? 'topic' : 'chapter';
  const topics = dueTopics(), legacy = legacyDueUnits(), total = topics.length + legacy.length;
  const head = `<div class="card-h"><h2>Due for review</h2><span class="count">${total}</span><div class="grow"></div>
    <div class="seg sm"><button class="${mode === 'chapter' ? 'on' : ''}" data-action="due-mode" data-mode="chapter">By chapter</button><button class="${mode === 'topic' ? 'on' : ''}" data-action="due-mode" data-mode="topic">Weakest first</button></div></div>`;
  if (!total) {
    return head + empty('Nothing due. Rate topics as you study and they come back here: red after 2 days, amber after 7, green after 21.');
  }
  const overdue = r => (r.diff < 0 ? `${-r.diff} days overdue` : 'due today');
  if (mode === 'topic') {
    return head + topics.slice(0, 40).map(r => topicMiniRow(r.t, overdue(r))).join('')
      + legacy.map(u => unitMiniRow(u, 'review')).join('')
      + (topics.length > 40 ? `<div class="hint">…and ${topics.length - 40} more</div>` : '');
  }
  const groups = new Map();
  topics.forEach(r => { const k = r.t.unit.key; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); });
  return head + [...groups.entries()].map(([k, rs]) => {
    const u = UNITS.get(k);
    return `<div class="duegrp"><div class="duehead">${pill(u.subject)}
      <button class="mname" data-action="open-unit" data-unit="${esc(k)}">${esc(u.name)}<small>${esc(u.course.name)} · ${plural(rs.length, 'topic')} due</small></button>
      <button class="sm ghost" data-action="chapter-reviewed" data-unit="${esc(k)}" title="Reset the review clock on every rated topic in this chapter">All reviewed</button></div>
      ${rs.map(r => topicMiniRow(r.t, overdue(r), { nopill: true })).join('')}</div>`;
  }).join('') + legacy.map(u => unitMiniRow(u, 'review')).join('');
}
function rateCard() {
  const need = unratedTopics();
  return `<div class="card-h"><h2>Rate these</h2><span class="count">${need.length}</span></div>
    <p class="hint">You've made notes or done questions here, but haven't rated them yet. Rating starts the review clock.</p>
    ${need.length ? need.slice(0, 10).map(t => topicMiniRow(t, STAGES[stageOf(t.key)].label.toLowerCase())).join('')
      : empty('Nothing waiting. Rate a topic any time with the R / A / G buttons in its row.')}`;
}
function markChapterReviewed(key) {
  const u = UNITS.get(key); if (!u) return;
  const rated = ratedTopics(u);
  if (!rated.length) return toast('Rate some topics in this chapter first');
  rated.forEach(t => { D.topics[t.key].reviewedAt = Date.now(); });
  markActivity(); persist(); render();
  toast(`Marked ${plural(rated.length, 'topic')} in “${u.name}” as reviewed`);
}

function viewSubject(id) {
  const s = SUBJ[id], yr = D.settings.year;
  const shown = s.courses.filter(c => c.units.some(u => !isHidden(u) && (!yr || yearOf(u) === yr)));
  const notShown = s.courses.filter(c => !shown.includes(c));
  return `
  <header class="page-h"><div><h1><i class="dot lg" style="background:${s.color}"></i>${esc(s.name)}</h1><div class="sub">${esc(s.board)}</div></div>
    <div class="grow"></div>${scopeSwitch()}${yearSwitch()}</header>
  <section class="card subj-sum">${subjectSummary(s)}</section>
  ${s.source ? `<div class="note-src"><b>Check:</b> ${esc(s.source)}</div>` : ''}
  ${shown.map(courseBlock).join('')}
  ${notShown.length ? `<div class="hidden-note">Not in Year ${yr}: ${notShown.map(c => esc(c.name)).join(', ')}. Switch to ${yr === 1 ? 'Year 2' : 'Year 1'} or All to see ${notShown.length === 1 ? 'it' : 'them'}.</div>` : ''}`;
}
function subjectSummary(s) {
  const units = unitsFor(s.id), topics = topicsOf(units), counts = stageCounts(topics);
  const rateableTopics = topicsOf(units.filter(u => u.type !== 'checklist'));
  const rated = rateableTopics.filter(t => ragOf(t.key)), rc = ragCounts(rateableTopics);
  const due = units.reduce((a, u) => a + ((reviewState(u) || {}).dueCount || 0), 0), yr = D.settings.year;
  return `<div class="sum-main"><div class="big">${progressPct(topics)}<small>%</small></div><div class="sum-bar">${stageBar(counts)}${stageLegend(counts)}</div></div>
    <div class="sum-stats">
      <div><span>Green</span><b style="color:${RAG.green.color}">${rc.green}<small>/${rateableTopics.length}</small></b></div>
      <div><span>Topics rated</span><b>${rated.length}<small>/${rateableTopics.length}</small></b></div>
      <div><span>Reviews due</span><b>${due}</b></div>
      <div><span>Showing</span><b class="txt">${yr ? `Year ${yr}` : 'All years'}</b></div>
    </div>
    <div class="sum-rag">${ragBar(rc)}${ragLegend(rc)}</div>
    <div class="papers">${Object.entries(s.papers).map(([k, v]) => `<span><b>${esc(k)}</b>${esc(v)}</span>`).join('')}</div>`;
}
function courseBlock(c) {
  const yr = D.settings.year, ck = `${c.subject.id}/${c.id}`;
  const all = c.units.filter(u => !isHidden(u) && (!yr || yearOf(u) === yr));
  const units = inScope(all), ahead = all.length - units.length;
  const collapsed = !!D.settings.collapsed[ck], topics = topicsOf(units);
  return `<section class="course${collapsed ? ' collapsed' : ''}">
    <div class="course-h"><button class="course-t" data-action="toggle-course" data-course="${esc(ck)}"><span class="caret">›</span>${esc(c.name)}<small>${plural(units.length, 'unit')} · ${progressPct(topics)}%</small></button>
      ${stageBar(stageCounts(topics), 'mini wide')}
      <button class="sm ghost" data-action="add-unit" data-subject="${esc(c.subject.id)}" data-course="${esc(c.id)}" title="Add your own unit to ${esc(c.name)}">+ Unit</button></div>
    ${collapsed ? '' : units.map(unitCard).join('')}
    ${collapsed || !ahead ? '' : `<button class="link" data-action="set-scope" data-scope="all">Show ${plural(ahead, 'later chapter')} in ${esc(c.name)}</button>`}
  </section>`;
}
function unitCard(u) {
  const d = U(u.key), open = !!D.settings.open[u.key], counts = stageCounts(u.topics), isChk = u.type === 'checklist';
  const rc = ragCounts(u.topics), rated = ratedTopics(u);
  const meta = [
    u.papers.map(p => `<span class="ptag" title="${esc(u.subject.papers[p] || p)}">${esc(p)}</span>`).join(''),
    u.spec ? esc(u.spec) : '',
    plural(u.topics.length, 'topic'),
    yearOf(u) !== u.defaultYear ? `moved to Year ${yearOf(u)}` : '',
    reviewText(u),
  ].filter(Boolean).join('<span class="sep">·</span>');
  return `<div class="unit${open ? ' open' : ''}" data-unit-card="${esc(u.key)}">
    <div class="uhead" data-action="toggle-unit" data-unit="${esc(u.key)}">
      <span class="caret">›</span>
      <div class="utitle"><div class="uname">${esc(u.name)}${u.custom ? '<span class="tag">custom</span>' : ''}${u.unverified ? `<span class="tag warn" title="${esc(u.unverified)}">check</span>` : ''}</div>
        <div class="umeta">${meta}</div></div>
      ${stageBar(counts, 'mini')}
      ${isChk ? `<span class="chkcount">${counts[4]}/${u.topics.length} done</span>`
        : `<div class="uconf" data-action="noop">${ragBar(rc)}<small>${rated.length ? `${rc.green} green · ${rc.amber} amber · ${rc.red} red` : legacyRag(u) ? `old chapter rating: ${RAG[legacyRag(u)].label}` : 'not rated yet'}</small></div>`}
      <button class="icon" data-action="unit-menu" data-unit="${esc(u.key)}" title="More options">⋯</button>
    </div>
    ${open ? `<div class="ubody">
      ${u.unverified ? `<div class="warnline">${esc(u.unverified)}</div>` : ''}
      ${u.topics.map(t => topicRow(t)).join('') || empty('No topics yet.')}
      <div class="uactions">
        <button class="sm ghost" data-action="add-topic" data-unit="${esc(u.key)}">+ Add your own topic</button>
        <button class="sm ghost" data-action="open-resources" data-key="${esc(u.key)}">↗ Resources${(RES.units[u.key] || []).length + (D.links[u.key] || []).length ? ` (${(RES.units[u.key] || []).length + (D.links[u.key] || []).length})` : ''}</button>
        ${isChk || !rated.length ? '' : `<button class="sm ghost" data-action="chapter-reviewed" data-unit="${esc(u.key)}">Mark chapter reviewed</button>`}
        <button class="sm ghost" data-action="log-unit" data-unit="${esc(u.key)}">Log study</button>
      </div>
      <textarea class="notes" data-unit="${esc(u.key)}" rows="2" placeholder="Notes: what's tricky, textbook pages, questions for your teacher…">${esc(d.notes || '')}</textarea>
    </div>` : ''}
  </div>`;
}

function viewOverview() {
  const yr = D.settings.year, subs = Object.values(SUBJ);
  const units = [...UNITS.values()].filter(u => !isHidden(u) && (!yr || yearOf(u) === yr));
  const weak = topicsOf(units).filter(t => ragOf(t.key) && ragOf(t.key) !== 'green')
    .sort((a, b) => ragRank(ragOf(a.key)) - ragRank(ragOf(b.key))).slice(0, 8);
  const stale = units.filter(u => lastReviewed(u) && Date.now() - lastReviewed(u) > 21 * DAY)
    .sort((a, b) => lastReviewed(a) - lastReviewed(b)).slice(0, 7);
  return `
  <header class="page-h"><div><h1>Overview</h1><div class="sub">${yr ? `Year ${yr} content` : 'All content'}${D.settings.scope === 'all' ? '' : ' · current chapters'}</div></div><div class="grow"></div>${scopeSwitch()}${yearSwitch()}</header>
  <div class="grid g3">${subs.map(subjectCard).join('')}</div>
  <section class="card orbit-card"><div class="card-h"><h2>Mastery orbit</h2><span class="hint">Closer to the core = more confident · bigger = more topic stages done · click a planet</span><div class="grow"></div>
    <select id="orbitSel"><option value="all">All subjects</option>${subs.map(s => `<option value="${esc(s.id)}" ${UI.orbitSel === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
    <canvas id="cv-orbit"></canvas></section>
  <div class="grid g2">
    <section class="card"><div class="card-h"><h2>Progress over time</h2><span class="hint">% of topic stages done</span></div>
      <canvas id="cv-progress" class="chart"></canvas>
      <div class="legend">${subs.map(s => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div></section>
    <section class="card"><div class="card-h"><h2>Confidence landscape</h2><span class="hint">height = confidence · drag to spin</span><div class="grow"></div><button class="sm ghost" data-action="expand-land">Expand</button></div>
      <canvas id="cv-land"></canvas></section>
  </div>
  <div class="grid g2">
    <section class="card"><div class="card-h"><h2>Red and amber topics</h2></div>${weak.length ? weak.map(t => topicMiniRow(t, `rated ${ago((D.topics[t.key] || {}).reviewedAt)}`)).join('') : empty('Nothing red or amber. Rate topics as you study them.')}</section>
    <section class="card"><div class="card-h"><h2>Going stale</h2><span class="hint">not reviewed for 3+ weeks</span></div>${stale.length ? stale.map(u => unitMiniRow(u, 'stale')).join('') : empty('Nothing stale.')}</section>
  </div>`;
}
function subjectCard(s) {
  const units = unitsFor(s.id), topics = topicsOf(units), rc = ragCounts(topicsOf(units.filter(u => u.type !== 'checklist')));
  const due = units.reduce((a, u) => a + ((reviewState(u) || {}).dueCount || 0), 0), mins = weekSummary().per[s.id] || 0;
  return `<div class="card scard" data-action="nav" data-view="subject:${esc(s.id)}" style="--sc:${s.color}" role="button" tabindex="0">
    <div class="scard-h"><i class="dot" style="background:${s.color}"></i><b>${esc(s.name)}</b><span class="grow"></span><span class="big">${progressPct(topics)}<small>%</small></span></div>
    ${stageBar(stageCounts(topics))}
    <div class="scard-s"><span>Green <b style="color:${RAG.green.color}">${rc.green}</b></span><span>Red <b style="color:${RAG.red.color}">${rc.red}</b></span><span>Reviews due <b>${due}</b></span><span>This week <b>${mins ? fmtMins(mins) : '–'}</b></span></div>
  </div>`;
}
function orbitItems() {
  const yr = D.settings.year, keys = scopeKeys();
  return [...UNITS.values()]
    .filter(u => !isHidden(u) && u.type !== 'checklist' && (!yr || yearOf(u) === yr)
      && (!keys || keys.has(u.key)) && (UI.orbitSel === 'all' || u.subject.id === UI.orbitSel))
    .map(u => ({ key: u.key, name: u.name, subj: u.subject.name, color: u.subject.color, v: confOf(u), cov: progressPct(u.topics) / 100 }));
}
function progressSeries() {
  const idx = D.settings.year === 1 ? 0 : D.settings.year === 2 ? 1 : 2;
  return Object.values(SUBJ).map(s => ({ color: s.color, points: D.trend.filter(e => e.s && e.s[s.id]).map(e => ({ d: e.d, y: e.s[s.id][idx] })) }));
}

function viewLog() {
  const pre = UI.logPrefill || {};
  const sid = pre.subject || UI.lastLogSubject || Object.keys(SUBJ)[0];
  const kind = pre.kind || UI.lastKind;
  return `
  <header class="page-h"><div><h1>Study log</h1><div class="sub">Every session counts, even 10 minutes of flashcards.</div></div></header>
  <div class="grid g-log">
    <section class="card"><div class="card-h"><h2>Log a session</h2><div class="grow"></div>
      ${studyButton()}</div>
      <form data-form="log" class="form" autocomplete="off">
        <label>Date<input type="date" name="date" value="${esc(pre.date || todayISO())}" max="${todayISO()}" required></label>
        <label>Subject<select name="subject" data-units-for="logUnit">${subjectOptions(sid)}</select></label>
        <label class="wide">Unit <small>(optional)</small><select name="unit" id="logUnit">${unitOptions(sid, pre.unit)}</select></label>
        <label>What did you do?<select name="kind">${ACTIVITIES.map(a => `<option ${a === kind ? 'selected' : ''}>${a}</option>`).join('')}</select></label>
        <label>Minutes<input type="number" name="minutes" id="logMinutes" min="1" max="900" value="${esc(pre.minutes || '')}" placeholder="45" required></label>
        <div class="chips wide">${[15, 30, 45, 60, 90, 120].map(m => `<button type="button" class="chip" data-action="mins" data-m="${m}">${fmtMins(m)}</button>`).join('')}</div>
        <label class="wide">Name <small>(optional)</small><input name="title" maxlength="80" value="${esc(pre.title || '')}" placeholder="e.g. Quadratics Ex 2C"></label>
        <label class="wide">Note <small>(optional)</small><input name="note" maxlength="300" value="${esc(pre.note || '')}" placeholder="e.g. Ex 2C Q1–12, stuck on Q9"></label>
        <div class="wide right"><button class="primary" type="submit">Add session</button></div>
      </form></section>
    <section class="card"><div class="card-h"><h2>Last 8 weeks</h2><span class="hint">hours per week</span></div>
      <canvas id="cv-weeks" class="chart"></canvas>
      <div class="legend">${[...Object.values(SUBJ), OTHER].map(s => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div></section>
  </div>
  <section class="card"><div class="card-h"><h2>Sessions</h2><span class="count">${D.log.length}</span></div>${logList()}</section>`;
}
function logList() {
  if (!D.log.length) return empty('No sessions yet. Log your first one above.');
  const sorted = [...D.log].sort((a, b) => a.date === b.date ? b.at - a.at : a.date < b.date ? 1 : -1);
  const shown = sorted.slice(0, UI.logLimit);
  let html = '', day = null;
  for (const e of shown) {
    if (e.date !== day) {
      day = e.date;
      const tot = D.log.filter(x => x.date === day).reduce((a, x) => a + x.minutes, 0);
      html += `<div class="lday"><span>${fmtDate(day, { weekday: 'short', day: 'numeric', month: 'short' })}</span><span>${fmtMins(tot)}</span></div>`;
    }
    const u = UNITS.get(e.unit);
    const where = u ? u.name : e.unit ? '(removed unit)' : 'General';
    html += `<div class="lrow">${pill(subj(e.subject))}<div class="lmain"><b>${esc(e.title || where)}</b><small>${e.title ? `${esc(where)} · ` : ''}${esc(e.kind)}${e.auto ? ' · auto' : ''}${e.note ? ` · ${esc(e.note)}` : ''}${e.edited ? ` · <span title="Originally ${fmtMins(e.recordedMinutes || e.minutes)}">time edited</span>` : ''}</small></div>
      <span class="lmin">${fmtMins(e.minutes)}</span><button class="icon" data-action="log-menu" data-id="${esc(e.id)}" title="Session options">⋯</button></div>`;
  }
  if (sorted.length > shown.length) html += `<button class="link" data-action="log-more">Show more (${sorted.length - shown.length} older)</button>`;
  return html;
}
function weeksData() {
  const cur = weekStart(), starts = Array.from({ length: 8 }, (_, i) => addDays(cur, (i - 7) * 7));
  const stacks = [...Object.keys(SUBJ), 'other'].map(id => ({
    color: subj(id).color,
    values: starts.map(ws => D.log.filter(e => (SUBJ[e.subject] ? e.subject : 'other') === id && e.date >= ws && e.date <= addDays(ws, 6))
      .reduce((a, e) => a + e.minutes, 0) / 60),
  }));
  return { labels: starts.map(ws => fmtDate(ws)), stacks, fmt: v => v >= 10 ? `${v.toFixed(0)}h` : `${v.toFixed(1)}h` };
}

function viewScores() {
  const sid = UI.lastScoreSubject || Object.keys(SUBJ)[0];
  const subs = Object.values(SUBJ);
  return `
  <header class="page-h"><div><h1>Scores</h1><div class="sub">Tests, homework marks, mocks and past papers</div></div></header>
  <div class="grid g-log">
    <section class="card"><div class="card-h"><h2>Add a score</h2></div>
      <form data-form="score" class="form" autocomplete="off">
        <label class="wide">What was it?<input name="title" required maxlength="100" placeholder="e.g. Quadratics end-of-chapter test"></label>
        <label>Date<input type="date" name="date" value="${todayISO()}" max="${todayISO()}" required></label>
        <label>Type<select name="kind">${SCORE_KINDS.map(k => `<option>${k}</option>`).join('')}</select></label>
        <label>Subject<select name="subject" data-units-for="scoreUnit">${subjectOptions(sid)}</select></label>
        <label>Unit <small>(optional)</small><select name="unit" id="scoreUnit">${unitOptions(sid)}</select></label>
        <label>Marks<input type="number" name="got" min="0" step="0.5" required placeholder="34"></label>
        <label>Out of<input type="number" name="max" min="0.5" step="0.5" required placeholder="50"></label>
        <div class="wide right"><span id="scorePct" class="pctlive"></span><button class="primary" type="submit">Add score</button></div>
      </form></section>
    <section class="card"><div class="card-h"><h2>Over time</h2><span class="hint">percentage</span></div>
      <canvas id="cv-scores" class="chart"></canvas>
      <div class="legend">${subs.map(s => { const list = D.scores.filter(x => x.subject === s.id);
        const avg = list.length ? Math.round(list.reduce((a, x) => a + x.got / x.max, 0) / list.length * 100) : null;
        return `<span><i style="background:${s.color}"></i>${esc(s.name)} ${avg != null ? `<b>avg ${avg}%</b>` : ''}</span>`; }).join('')}</div></section>
  </div>
  <section class="card"><div class="card-h"><h2>All scores</h2><span class="count">${D.scores.length}</span></div>${scoreTable()}</section>`;
}
function scoreTable() {
  if (!D.scores.length) return empty('No scores yet. Add class tests and homework marks as you get them back.');
  const rows = [...D.scores].sort((a, b) => a.date === b.date ? b.at - a.at : a.date < b.date ? 1 : -1);
  return `<div class="tblwrap"><table class="tbl"><thead><tr><th>Date</th><th>Subject</th><th>Title</th><th>Type</th><th class="num">Marks</th><th class="num">%</th><th></th></tr></thead><tbody>
    ${rows.map(s => { const pct = Math.round(s.got / s.max * 100), u = UNITS.get(s.unit);
      return `<tr><td>${fmtDate(s.date, { day: 'numeric', month: 'short', year: '2-digit' })}</td><td>${pill(subj(s.subject))}</td>
        <td>${esc(s.title)}${u ? `<small>${esc(u.name)}</small>` : ''}</td><td>${esc(s.kind)}</td>
        <td class="num">${s.got}/${s.max}</td><td class="num" style="color:${col(pct / 10)}">${pct}%</td>
        <td><button class="icon" data-action="score-menu" data-id="${esc(s.id)}" title="Score options">⋯</button></td></tr>`; }).join('')}
  </tbody></table></div>`;
}
function scoreSeries() {
  return Object.values(SUBJ).map(s => ({ color: s.color, points: D.scores.filter(x => x.subject === s.id).map(x => ({ d: x.date, y: Math.round(x.got / x.max * 100) })) }));
}

function viewSettings() {
  const hidden = [...UNITS.values()].filter(isHidden);
  const today = todayISO();
  const exams = [...D.exams].sort((a, b) => a.date < b.date ? -1 : 1);
  return `
  <header class="page-h"><div><h1>Settings</h1><div class="sub">Exam dates, backups, hidden units and the trash</div></div></header>
  <div class="grid g2">
    <section class="card"><div class="card-h"><h2>Exams and mocks</h2><span class="hint">shown as countdowns on Today</span></div>
      ${exams.length ? exams.map(e => { const n = dayDiff(today, e.date);
        return `<div class="srow"><div class="grow">${esc(e.name)}<small>${fmtDate(e.date, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })} · ${n > 0 ? `in ${plural(n, 'day')}` : n === 0 ? 'today' : 'passed'}</small></div>
          <button class="icon" data-action="exam-menu" data-id="${esc(e.id)}" title="Options">⋯</button></div>`; }).join('') : empty('No dates yet.')}
      <form data-form="exam" class="form inline" autocomplete="off"><input name="name" placeholder="e.g. Maths mock, Paper 1" required maxlength="80"><input type="date" name="date" required><button class="primary" type="submit">Add</button></form>
    </section>
    <section class="card"><div class="card-h"><h2>Data and backups</h2></div>
      <p class="hint" style="margin:0">Everything saves automatically to <code>${esc(UI.dataPath)}</code>. A backup is taken the first time you use the app each day, and the last 30 are kept.</p>
      <div class="btnrow">
        <button class="sm" data-action="backup-now">Back up now</button>
        <button class="sm" data-action="open-folder">Open data folder</button>
        <button class="sm" data-action="export">Export a copy…</button>
        <button class="sm" data-action="import">Import…</button>
      </div>
      <div id="backupList" class="subtle-list">${backupListHTML()}</div>
    </section>
  </div>
  <div class="grid g2">
    <section class="card"><div class="card-h"><h2>Trash</h2><span class="count">${D.trash.length}</span><div class="grow"></div>${D.trash.length ? '<button class="sm danger" data-action="empty-trash">Empty trash</button>' : ''}</div>
      <div class="subtle-list">${D.trash.length ? D.trash.map(t => `<div class="srow"><div class="grow">${esc(t.label)}<small>deleted ${ago(t.at)}</small></div>
        <button class="sm" data-action="restore-trash" data-id="${esc(t.id)}">Restore</button><button class="icon" data-action="trash-menu" data-id="${esc(t.id)}" title="More options">⋯</button></div>`).join('')
        : empty('Deleted sessions, scores, exam dates and your own units and topics end up here.')}</div></section>
    <section class="card"><div class="card-h"><h2>Hidden units</h2><span class="count">${hidden.length}</span></div>
      <div class="subtle-list">${hidden.length ? hidden.map(u => `<div class="srow">${pill(u.subject)}<div class="grow">${esc(u.name)}<small>${esc(u.course.name)}</small></div><button class="sm" data-action="unhide" data-unit="${esc(u.key)}">Unhide</button></div>`).join('')
        : empty('Built-in units can’t be deleted, only hidden (unit menu ⋯). Hidden units show up here.')}</div></section>
  </div>
  <section class="card"><div class="card-h"><h2>How reviews are scheduled</h2></div>
    <p class="hint" style="margin:0">When you rate a topic, it comes back under <b>Due for review</b> after:</p>
    <div class="sched">${RAG_ORDER.map(r => `<div><b>${RAG[r].days} days</b>${RAG[r].label}: ${esc(RAG[r].hint)}</div>`).join('')}</div>
    <div class="h2" style="margin:18px 0 6px">Logging study time</div>
    <div class="srow"><div class="grow">Log automatically when I rate topics<small>Rating a topic starts a session. Anything else within ${AUTO_GAP} minutes joins it, and it saves once you stop for that long. “Start studying” still works and takes priority.</small></div>
      <button class="sm${autoOn() ? ' primary' : ''}" data-action="toggle-auto">${autoOn() ? 'On' : 'Off'}</button></div>
    <div class="h2" style="margin:18px 0 6px">Curriculum sources</div>
    ${Object.values(SUBJ).map(s => `<div class="src"><b>${esc(s.name)}</b> (${esc(s.board)}): ${esc(s.source)}</div>`).join('')}
  </section>`;
}
function backupListHTML() {
  if (!Backend.native) return empty('Backups only work in the desktop app.');
  if (UI.backups === null) return empty('Loading backups…');
  if (!UI.backups.length) return empty('No backups yet. The first one is made tomorrow, or click “Back up now”.');
  return UI.backups.slice(0, 40).map(b => {
    const kind = b.name.split('-')[0];
    const label = { daily: 'Daily', manual: 'Manual', before: 'Automatic (before restore/import)' }[kind] || 'Backup';
    return `<div class="srow"><div class="grow">${label}<small>${new Date(b.modified).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${(b.size / 1024).toFixed(0)} KB</small></div>
      <button class="sm" data-action="restore-backup" data-name="${esc(b.name)}">Restore</button></div>`;
  }).join('');
}
async function loadBackups() {
  if (!Backend.native) return;
  try { UI.backups = await Backend.call('list_backups'); } catch { UI.backups = []; }
  const el = $('#backupList'); if (el) el.innerHTML = backupListHTML();
}

/* ---------- search palette ---------- */
function openSearch() {
  if (UI.pal) { $('#palQ')?.focus(); return; }
  closeMenu();
  UI.pal = openModal(`<input id="palQ" class="bigsearch" placeholder="Search every topic and unit…" autocomplete="off" spellcheck="false" value="${esc(UI.palQ)}">
    <div id="palRes" class="palres">${paletteResults()}</div>
    <div class="palfoot"><span>Click a stage to update a topic · click a name to open it</span><span><kbd>Esc</kbd> to close</span></div>`,
    { wide: true, top: true, onClose: () => { UI.pal = null; } });
  const i = $('#palQ'); i.focus(); i.select();
}
function paletteResults() {
  const q = UI.palQ.trim();
  if (!q) return empty(`Type to search ${TOPICS.size} topics across ${Object.keys(SUBJ).length} subjects.`);
  const units = searchUnits(q, 6), topics = searchTopics(q, 30);
  if (!units.length && !topics.length) return empty(`No matches for “${esc(q)}”.`);
  return (units.length ? '<div class="palcap">Units</div>' + units.map(u => `<div class="trow"><div class="tname">
      <button class="tctx" data-action="open-unit" data-unit="${esc(u.key)}"><i class="dot" style="background:${u.subject.color}"></i>${esc(u.subject.name)} · ${esc(u.course.name)}</button>
      <button class="plain" data-action="open-unit" data-unit="${esc(u.key)}">${esc(u.name)}</button></div>${stageBar(stageCounts(u.topics), 'mini')}<span></span></div>`).join('') : '')
    + (topics.length ? '<div class="palcap">Topics</div>' + topics.map(t => topicRow(t, { context: true })).join('') : '');
}

/* =========================================================
   Render
   ========================================================= */
function renderNav() {
  const v = D.settings.view;
  const item = (view, label, icon, badge) => `<button class="nav-i${v === view ? ' on' : ''}" data-action="nav" data-view="${esc(view)}"><span class="ni">${icon}</span><span class="lbl">${esc(label)}</span>${badge ? `<span class="badge">${badge}</span>` : ''}</button>`;
  $('#nav').innerHTML =
    item('today', 'Today', ICON.today, dueCount() + consolidateList().length)
    + item('overview', 'Overview', ICON.overview)
    + '<div class="nav-cap">Subjects</div>'
    + Object.values(SUBJ).map(s => item(`subject:${s.id}`, s.name, `<i class="dot" style="background:${s.color}"></i>`, unitsFor(s.id, 0).reduce((a, u) => a + ((reviewState(u) || {}).dueCount || 0), 0))).join('')
    + '<div class="nav-cap">Track</div>'
    + item('log', 'Study log', ICON.log) + item('scores', 'Scores', ICON.scores) + item('settings', 'Settings', ICON.settings);
  const t = D.settings.timer;
  $('#sideTimer').innerHTML = t ? `<button class="side-timer" data-action="nav" data-view="today"><i></i><span data-timer>${fmtClock(Date.now() - t.start)}</span><small>studying</small></button>` : '';
}
function render() {
  try {
    renderNow();
  } catch (err) {                                  /* a drawing bug shouldn't lose the window */
    console.error(err);
    $('#view').innerHTML = `<div class="fatal">Something went wrong drawing this page.<br>
      <small>${esc((err && err.message) || err)}</small>
      <div class="btnrow" style="margin-top:14px">
        <button class="sm" data-action="reload-app">Reload</button>
        <button class="sm" data-action="nav" data-view="today">Go to Today</button>
        <button class="sm" data-action="nav" data-view="settings">Open Settings and backups</button>
      </div>
      <p class="hint">Your data is untouched, and a backup is kept in Settings.</p></div>`;
  }
}
function renderNow() {
  let view = D.settings.view;
  if (view.startsWith('subject:') && !SUBJ[view.slice(8)]) view = D.settings.view = 'today';
  const main = $('#main'), sameView = UI.lastView === view, scroll = main.scrollTop;
  const active = document.activeElement, focusId = active && active.id && $('#view').contains(active) ? active.id : null;
  const caret = focusId && typeof active.selectionStart === 'number' ? active.selectionStart : null;
  renderNav();
  const html = view === 'today' ? viewToday() : view === 'overview' ? viewOverview() : view.startsWith('subject:') ? viewSubject(view.slice(8))
    : view === 'log' ? viewLog() : view === 'scores' ? viewScores() : view === 'settings' ? viewSettings() : (D.settings.view = 'today', viewToday());
  const banner = UI.warning ? `<div class="banner"><span>${esc(UI.warning)}</span><button class="sm" data-action="nav" data-view="settings">Open backups</button><button class="icon" data-action="dismiss-warning">✕</button></div>` : '';
  $('#view').innerHTML = banner + html;
  main.scrollTop = sameView ? scroll : 0;
  UI.lastView = view;
  if (focusId) { const f = document.getElementById(focusId); if (f) { f.focus(); if (caret !== null) try { f.setSelectionRange(caret, caret); } catch { /* not a text input */ } } }
  if (UI.pal) { const r = $('#palRes'); if (r) r.innerHTML = paletteResults(); }
  if (view === 'overview') Visuals.start(orbitItems, key => goToUnit(key));
  if (view === 'settings' && UI.backups === null) loadBackups();
  drawStatic();
}
function drawStatic() {
  if (!D) return;
  const v = D.settings.view;
  if (v === 'overview' && $('#cv-progress')) Visuals.lineChart($('#cv-progress'), { series: progressSeries(), empty: 'This fills in as you use the tracker over a few days.' });
  if (v === 'log' && $('#cv-weeks')) Visuals.stackedBars($('#cv-weeks'), weeksData());
  if (v === 'scores' && $('#cv-scores')) Visuals.lineChart($('#cv-scores'), { series: scoreSeries(), empty: 'Add scores on at least two different days to see a chart.' });
}
function goToUnit(key, topicKey) {
  const u = UNITS.get(key); if (!u) return;
  if (UI.pal) UI.pal.close();
  closeMenu();
  if (isHidden(u)) { delete D.units[key].hidden; toast(`“${u.name}” was hidden, so it’s been unhidden`); }
  D.settings.view = `subject:${u.subject.id}`;
  if (D.settings.year && yearOf(u) !== D.settings.year) D.settings.year = yearOf(u);
  D.settings.open[key] = true;
  delete D.settings.collapsed[`${u.subject.id}/${u.course.id}`];
  UI.lastView = null;
  render(); persist();
  requestAnimationFrame(() => {
    const el = document.querySelector(topicKey ? `[data-topic-row="${CSS.escape(topicKey)}"]` : `[data-unit-card="${CSS.escape(key)}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1800);
  });
}

/* =========================================================
   Actions
   ========================================================= */
function rateTopic(tkey) {
  const t = TOPICS.get(tkey); if (!t) return;
  const cur = ragOf(tkey), p = D.topics[tkey] || {};
  const m = openModal(`<div class="mcap">${cur ? 'Review' : 'Rate this topic'}</div>
    <h3>How are you with “${esc(t.name)}”?</h3>
    <p class="mtext">${esc(t.unit.subject.name)} · ${esc(t.unit.name)}${cur ? ` · last rated <b>${RAG[cur].label}</b> ${ago(p.reviewedAt)}` : ''}</p>
    <div class="rag-pick">${RAG_ORDER.slice().reverse().map(r => `<button class="ragpick ${r}${cur === r ? ' cur' : ''}" data-r="${r}">
      <b>${RAG[r].label}</b><span>${esc(RAG[r].hint)}</span><small>comes back in ${RAG[r].days} days</small></button>`).join('')}</div>
    <div class="mfoot">${cur ? '<button data-m="clear">Clear rating</button>' : ''}<button data-m="cancel">Cancel</button></div>`);
  const clear = m.el.querySelector('[data-m=clear]');
  if (clear) clear.addEventListener('click', async () => {
    m.close();
    const ok = await confirmPlain({ title: `Clear the rating for “${t.name}”?`, body: 'It goes back to unrated and its review clock stops.', button: 'Clear rating' });
    if (ok) { setTopicRag(tkey, ''); render(); toast('Rating cleared'); }
  });
  m.el.querySelectorAll('[data-r]').forEach(b => b.addEventListener('click', () => {
    const r = b.dataset.r;
    setTopicRag(tkey, r); m.close(); render();
    toast(`${t.name}: ${RAG[r].label}. Back in ${RAG[r].days} days.`);
  }));
}
/* "What now?": turn the lists into one concrete session. */
function planSession() {
  const due = dueTopics(), picks = [];
  const take = (topic, why, mins) => {
    if (topic && !picks.some(p => p.t.key === topic.key)) picks.push({ t: topic, why, mins });
  };
  take((due.find(r => ragOf(r.t.key) === 'red') || {}).t, 'Red and due, start here', 20);
  take((due.find(r => ragOf(r.t.key) === 'amber') || {}).t, 'Amber and due', 15);
  take(consolidateList()[0], 'Taught in class, not written up yet', 15);
  if (picks.length < 3) take(unratedTopics()[0], 'Practised but never rated', 10);
  if (picks.length < 3) take((due.find(r => !picks.some(p => p.t.key === r.t.key)) || {}).t, 'Due for review', 15);
  /* still short? fill up with the next untaught topics in chapters you're already on */
  for (const t of TOPICS.values()) {
    if (picks.length >= 3) break;
    if (t.unit.type !== 'checklist' && !isHidden(t.unit) && !stageOf(t.key) && !ragOf(t.key) && taughtUnit(t.unit)) {
      take(t, 'Next topic in a chapter you’re on', 20);
    }
  }
  /* nothing taught yet: start at the beginning of the first chapter */
  for (const t of TOPICS.values()) {
    if (picks.length >= 3) break;
    if (t.unit.type !== 'checklist' && !isHidden(t.unit) && !stageOf(t.key) && !ragOf(t.key)) take(t, 'Start here', 20);
  }
  const total = picks.reduce((a, p) => a + p.mins, 0);
  const m = openModal(`<div class="mcap">What now?</div>
    <h3>${picks.length ? `A ${total}-minute session` : 'Nothing waiting'}</h3>
    ${picks.length ? `<p class="mtext">Work down these. Press <b>Start studying</b> first and your updates get logged for you.</p>
      <div class="plan">${picks.map((p, i) => `<button class="planrow" data-action="open-topic" data-topic="${esc(p.t.key)}">
        <span class="plan-n">${i + 1}</span><span class="plan-main"><b>${esc(p.t.name)}</b><small>${esc(p.t.unit.subject.name)} · ${esc(p.t.unit.name)} · ${esc(p.why)}</small></span>
        <span class="plan-mins">${p.mins}m</span></button>`).join('')}</div>`
      : `<p class="mtext">No reviews are due and nothing is waiting to be written up. Good time to learn something new: open a subject and start the next chapter.</p>`}
    <div class="mfoot"><button data-m="cancel">Close</button>${picks.length && !D.settings.timer ? '<button class="primary" data-m="start">Start studying</button>' : ''}</div>`);
  m.el.querySelectorAll('.planrow').forEach(b => b.addEventListener('click', () => m.close()));
  const start = m.el.querySelector('[data-m=start]');
  if (start) start.addEventListener('click', () => { m.close(); ACTIONS['study-start'](); goToUnit(picks[0].t.unit.key, picks[0].t.key); });
}
function unitMenu(anchor, u) {
  if (!u) return;
  const yr = yearOf(u), other = yr === 1 ? 2 : 1, items = [];
  if (u.type !== 'checklist' && ratedTopics(u).length) items.push({ label: 'Mark chapter reviewed today', fn: () => markChapterReviewed(u.key) });
  items.push({ label: 'Log study for this unit', fn: () => ACTIONS['log-unit']({ dataset: { unit: u.key } }) });
  items.push('-');
  items.push({ label: `Move to Year ${other}`, fn: () => {
    if (other === u.defaultYear) delete uw(u.key).year; else uw(u.key).year = other;
    snapshotTrend(); persist(); render();
    toast(`Moved “${u.name}” to Year ${other}`, { label: 'Undo', fn: () => { if (yr === u.defaultYear) delete uw(u.key).year; else uw(u.key).year = yr; snapshotTrend(); persist(); render(); } });
  } });
  if (u.custom) {
    items.push({ label: 'Rename unit…', fn: () => renameUnit(u) });
    items.push('-');
    items.push({ label: 'Delete unit…', danger: true, fn: () => deleteCustomUnit(u.key) });
  } else {
    items.push('-');
    items.push({ label: 'Hide unit', fn: () => {
      uw(u.key).hidden = true; snapshotTrend(); persist(); render();
      toast(`Hid “${u.name}”. Unhide it in Settings.`, { label: 'Undo', fn: () => { delete uw(u.key).hidden; snapshotTrend(); persist(); render(); } });
    } });
  }
  openMenu(anchor, items);
}
async function addTopic(u) {
  const name = await askText({ title: `Add a topic to “${u.name}”`, placeholder: 'Topic name', button: 'Add topic' });
  if (!name) return;
  (D.custom.topics[u.key] = D.custom.topics[u.key] || []).push({ id: `c-${uid()}`, name });
  buildModel(); D.settings.open[u.key] = true; persist(); render(); toast('Topic added');
}
async function addUnit(subjectId, courseId) {
  const course = SUBJ[subjectId]?.courses.find(c => c.id === courseId); if (!course) return;
  const name = await askText({ title: `Add your own unit to ${course.name}`, placeholder: 'Unit name', button: 'Add unit' });
  if (!name) return;
  const def = { id: `c-${uid()}`, subject: subjectId, course: courseId, name, year: D.settings.year || 1 };
  D.custom.units.push(def);
  buildModel();
  const key = `${subjectId}/${courseId}/${def.id}`;
  D.settings.open[key] = true; snapshotTrend(); persist(); render();
  toast('Unit added. Add topics to it with “+ Add your own topic”.');
}
async function renameUnit(u) {
  const def = D.custom.units.find(x => x.subject === u.subject.id && x.course === u.course.id && x.id === u.id); if (!def) return;
  const name = await askText({ title: 'Rename unit', value: def.name, button: 'Rename' });
  if (!name) return;
  def.name = name; buildModel(); persist(); render();
}
async function deleteCustomUnit(key) {
  const u = UNITS.get(key); if (!u || !u.custom) return;
  const withProgress = u.topics.filter(t => D.topics[t.key]).length;
  const ok = await confirmTyped({ title: `Delete unit “${u.name}”?`,
    body: `This removes the unit, its ${plural(u.topics.length, 'topic')}${withProgress ? ` (${withProgress} with progress)` : ''}, its rating and notes.<br>It goes to the Trash in Settings, where you can restore it.` });
  if (!ok) return;
  const def = D.custom.units.find(x => `${x.subject}/${x.course}/${x.id}` === key);
  const topics = {};
  Object.keys(D.topics).filter(k => k.startsWith(`${key}/`)).forEach(k => { topics[k] = D.topics[k]; delete D.topics[k]; });
  const payload = { def, unitData: D.units[key] || null, topics, customTopics: D.custom.topics[key] || null };
  delete D.units[key]; delete D.custom.topics[key]; delete D.settings.open[key];
  D.custom.units = D.custom.units.filter(x => x !== def);
  const id = toTrash('customUnit', payload, `Unit: ${u.name} (${u.subject.name} · ${u.course.name})`);
  buildModel(); snapshotTrend(); persist(); render();
  toast('Unit moved to Trash', { label: 'Undo', fn: () => restoreTrash(id) });
}
async function deleteCustomTopic(tkey) {
  const t = TOPICS.get(tkey); if (!t || !t.custom) return;
  const ok = await confirmTyped({ title: `Delete topic “${t.name}”?`, body: `From ${esc(t.unit.name)}. It goes to the Trash, where you can restore it.` });
  if (!ok) return;
  const list = D.custom.topics[t.unit.key] || [], def = list.find(x => x.id === t.id);
  D.custom.topics[t.unit.key] = list.filter(x => x !== def);
  const payload = { unitKey: t.unit.key, def, topicKey: tkey, progress: D.topics[tkey] || null };
  delete D.topics[tkey];
  const id = toTrash('customTopic', payload, `Topic: ${t.name} (${t.unit.name})`);
  buildModel(); snapshotTrend(); persist(); render();
  toast('Topic moved to Trash', { label: 'Undo', fn: () => restoreTrash(id) });
}
async function deleteItem(kind, id) {
  const list = kind === 'log' ? D.log : kind === 'score' ? D.scores : D.exams;
  const it = list.find(x => x.id === id); if (!it) return;
  const label = kind === 'log' ? `Session: ${it.title ? `“${it.title}”, ` : ''}${fmtMins(it.minutes)} of ${subj(it.subject).name} on ${fmtDate(it.date)}`
    : kind === 'score' ? `Score: ${it.title} (${it.got}/${it.max})` : `Date: ${it.name}, ${fmtDate(it.date, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const noun = kind === 'log' ? 'session' : kind === 'score' ? 'score' : 'date';
  const ok = await confirmTyped({ title: `Delete this ${noun}?`, body: `${esc(label)}<br>It goes to the Trash in Settings, where you can restore it.` });
  if (!ok) return;
  list.splice(list.indexOf(it), 1);
  const tid = toTrash(kind, it, label);
  persist(); render();
  toast('Moved to Trash', { label: 'Undo', fn: () => restoreTrash(tid) });
}
function restoreTrash(id) {
  const i = D.trash.findIndex(t => t.id === id); if (i < 0) return;
  const t = D.trash[i], p = t.payload;
  if (t.kind === 'log') D.log.push(p);
  else if (t.kind === 'score') D.scores.push(p);
  else if (t.kind === 'exam') D.exams.push(p);
  else if (t.kind === 'customUnit') {
    D.custom.units.push(p.def);
    if (p.unitData) D.units[`${p.def.subject}/${p.def.course}/${p.def.id}`] = p.unitData;
    if (p.customTopics) D.custom.topics[`${p.def.subject}/${p.def.course}/${p.def.id}`] = p.customTopics;
    Object.assign(D.topics, p.topics);
  } else if (t.kind === 'customTopic') {
    if (!UNITS.has(p.unitKey)) { toast('Restore the unit this topic belonged to first'); return; }
    (D.custom.topics[p.unitKey] = D.custom.topics[p.unitKey] || []).push(p.def);
    if (p.progress) D.topics[p.topicKey] = p.progress;
  } else if (t.kind === 'link') {
    (D.links[p.key] = D.links[p.key] || []).push(p.link);
  }
  D.trash.splice(i, 1);
  buildModel(); snapshotTrend(); persist(); render(); toast('Restored');
}

/* ---------- resources ---------- */
function searchName(name) { return name.replace(/^\d+(\.\d+)*\.?\s*/, '').split(':')[0].trim(); }
function linkRow(l, opt = {}) {
  return `<div class="lnk"><button class="lnk-main" data-action="open-link" data-url="${esc(l.url)}" title="${esc(l.url)}">
      <span class="lnk-site">${esc(l.site)}</span><span class="lnk-label">${esc(l.label)}</span><span class="lnk-go">↗</span></button>
    ${opt.menuKey ? `<button class="icon" data-action="link-menu" data-key="${esc(opt.menuKey)}" data-id="${esc(l.id)}" title="Link options">⋯</button>` : ''}</div>`;
}
function resourcesHTML(key) {
  const t = TOPICS.get(key), u = t ? t.unit : UNITS.get(key);
  const topicLinks = t ? RES.topics[t.key] || [] : [];
  const unitLinks = RES.units[u.key] || [];
  const own = D.links[key] || [];
  const query = `${EXAM_LABEL[u.subject.id] || u.subject.name} ${searchName(t ? t.name : u.name)}`, q = encodeURIComponent(query);
  const section = (title, rows) => (rows ? `<div class="res-sec"><div class="palcap">${title}</div>${rows}</div>` : '');
  return section('This topic', topicLinks.map(l => linkRow(l)).join(''))
    + section(t ? `Whole chapter · ${esc(u.name)}` : 'This chapter', unitLinks.map(l => linkRow(l)).join(''))
    + section('Search', [
      { site: 'YouTube', label: `“${query}”`, url: `https://www.youtube.com/results?search_query=${q}` },
      { site: 'Google', label: `“${query}”`, url: `https://www.google.com/search?q=${q}` },
    ].map(l => linkRow(l)).join(''))
    + `<div class="res-sec"><div class="palcap">Your links</div>${own.length ? own.map(l => linkRow({ ...l, site: 'Yours' }, { menuKey: key })).join('') : empty('None yet. Add a worksheet, video or anything your teacher shares.')}</div>
    <form data-form="link" data-key="${esc(key)}" class="form inline" autocomplete="off">
      <input name="label" maxlength="80" placeholder="Name, e.g. Teacher's worksheet"><input name="url" maxlength="2000" placeholder="https://…" required>
      <button class="primary" type="submit">Add link</button></form>
    <p class="hint" style="margin:10px 0 0">Links open in your normal browser.${RES.checked ? ` Website links were checked on ${fmtDate(RES.checked, { day: 'numeric', month: 'short', year: 'numeric' })}; sites do occasionally move things.` : ''}</p>`;
}
function openResources(key) {
  const t = TOPICS.get(key), u = t ? t.unit : UNITS.get(key);
  if (!u) return;
  closeMenu();
  const m = openModal(`<div class="mcap">Resources</div><h3>${esc(t ? t.name : u.name)}</h3>
    <p class="mtext">${esc(u.subject.name)} · ${esc(t ? u.name : u.course.name)}</p><div id="resBody"></div>`,
    { wide: true, onClose: () => { UI.resModal = null; } });
  const body = m.el.querySelector('#resBody');
  UI.resModal = { key, draw: () => { body.innerHTML = resourcesHTML(key); } };
  UI.resModal.draw();
}
async function deleteLink(key, id) {
  const list = D.links[key] || [], link = list.find(l => l.id === id);
  if (!link) return;
  const ok = await confirmTyped({ title: `Delete the link “${link.label}”?`, body: `${esc(link.url)}<br>It goes to the Trash in Settings, where you can restore it.` });
  if (!ok) return;
  D.links[key] = list.filter(l => l !== link);
  if (!D.links[key].length) delete D.links[key];
  const tid = toTrash('link', { key, link }, `Link: ${link.label}`);
  persist(); render();
  if (UI.resModal) UI.resModal.draw();
  toast('Link moved to Trash', { label: 'Undo', fn: () => { restoreTrash(tid); if (UI.resModal) UI.resModal.draw(); } });
}

const ACTIONS = {
  noop() {},
  'reload-app'() { location.reload(); },
  nav(el) { D.settings.view = el.dataset.view; UI.logPrefill = null; if (el.dataset.view === 'settings') UI.backups = null; render(); persist(); },
  stage(el) {
    const t = TOPICS.get(el.dataset.topic); if (!t) return;
    const s = +el.dataset.stage;
    setStage(t.key, stageOf(t.key) === s ? s - 1 : s); render();
  },
  'toggle-check'(el) { const k = el.dataset.topic; setStage(k, stageOf(k) >= 4 ? 0 : 4); render(); },
  'toggle-unit'(el) { const k = el.dataset.unit; if (D.settings.open[k]) delete D.settings.open[k]; else D.settings.open[k] = true; render(); persist(); },
  'toggle-course'(el) { const k = el.dataset.course; if (D.settings.collapsed[k]) delete D.settings.collapsed[k]; else D.settings.collapsed[k] = true; render(); persist(); },
  'set-year'(el) { D.settings.year = +el.dataset.year; render(); persist(); },
  'open-unit'(el) { goToUnit(el.dataset.unit); },
  'open-topic'(el) { const t = TOPICS.get(el.dataset.topic); if (t) goToUnit(t.unit.key, t.key); },
  'rate-topic'(el) { rateTopic(el.dataset.topic); },
  'set-rag'(el) {
    const { topic, rag } = el.dataset;
    setTopicRag(topic, ragOf(topic) === rag ? '' : rag);
    render();
  },
  'set-scope'(el) { D.settings.scope = el.dataset.scope; render(); persist(); },
  'auto-save'() { const mins = closeAuto(true); persist(); render(); toast(mins ? `Saved ${fmtMins(mins)} to your study log` : 'Nothing to save yet'); },
  'toggle-auto'() {
    D.settings.autoLog = !autoOn();
    if (!autoOn()) closeAuto(true);
    persist(); render();
    toast(autoOn() ? 'Rating a topic will log the time automatically' : 'Automatic logging off. Use Start studying instead');
  },
  'what-now'() { planSession(); },
  'open-resources'(el) { openResources(el.dataset.key); },
  async 'open-link'(el) {
    const url = el.dataset.url;
    if (!/^https?:\/\//i.test(url)) return toast('That isn’t a web link');
    if (!Backend.native) { window.open(url, '_blank', 'noopener'); return; }
    try {
      const res = await Backend.call('open_url', url);
      toast(res && res.ok ? 'Opened in your browser' : (res && res.error) || 'Couldn’t open that link');
    } catch { toast('Couldn’t open that link'); }
  },
  'link-menu'(el) {
    const { key, id } = el.dataset;
    openMenu(el, [{ label: 'Delete link…', danger: true, fn: () => deleteLink(key, id) }]);
  },
  'due-mode'(el) { D.settings.dueMode = el.dataset.mode; render(); persist(); },
  'chapter-reviewed'(el) { markChapterReviewed(el.dataset.unit); },
  'unit-menu'(el) { unitMenu(el, UNITS.get(el.dataset.unit)); },
  'add-topic'(el) { const u = UNITS.get(el.dataset.unit); if (u) addTopic(u); },
  'add-unit'(el) { addUnit(el.dataset.subject, el.dataset.course); },
  'topic-menu'(el) { const k = el.dataset.topic; openMenu(el, [{ label: 'Delete this topic…', danger: true, fn: () => deleteCustomTopic(k) }]); },
  'toggle-note'(el) {
    const k = el.dataset.topic;
    if (UI.openNotes.has(k)) UI.openNotes.delete(k); else UI.openNotes.add(k);
    render();
    const ta = document.getElementById(`tn:${k}`);
    if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
  },
  'log-unit'(el) {
    const u = UNITS.get(el.dataset.unit); if (!u) return;
    D.settings.view = 'log';
    UI.logPrefill = { subject: u.subject.id, unit: u.key }; render(); persist();
  },
  'open-search'() { openSearch(); },
  'hide-intro'() { D.settings.hideIntro = true; render(); persist(); },
  'cons-more'() { UI.consMore = true; render(); },
  mins(el) { const i = $('#logMinutes'); if (i) i.value = el.dataset.m; },
  'study-start'() {
    closeAuto();                                   // bank anything already logged automatically
    D.settings.timer = { start: Date.now(), touched: {} }; persist(); render();
    toast('Study mode on. Topics you update now count as studied and reset their review clock.');
  },
  'study-stop'() { finishStudy(); },
  'log-more'() { UI.logLimit += 60; render(); },
  'log-menu'(el) {
    const id = el.dataset.id;
    openMenu(el, [{ label: 'Rename or change time…', fn: () => editLog(id) }, '-', { label: 'Delete session…', danger: true, fn: () => deleteItem('log', id) }]);
  },
  'score-menu'(el) { const id = el.dataset.id; openMenu(el, [{ label: 'Delete score…', danger: true, fn: () => deleteItem('score', id) }]); },
  'exam-menu'(el) { const id = el.dataset.id; openMenu(el, [{ label: 'Delete date…', danger: true, fn: () => deleteItem('exam', id) }]); },
  'restore-trash'(el) { restoreTrash(el.dataset.id); },
  'trash-menu'(el) { const id = el.dataset.id; openMenu(el, [{ label: 'Delete forever…', danger: true, fn: () => ACTIONS['purge-trash']({ dataset: { id } }) }]); },
  async 'purge-trash'(el) {
    const t = D.trash.find(x => x.id === el.dataset.id); if (!t) return;
    const ok = await confirmTyped({ title: 'Delete forever?', body: `${esc(t.label)}<br>This can’t be undone, except by restoring an older backup.`, word: 'delete forever', button: 'Delete forever' });
    if (!ok) return;
    D.trash = D.trash.filter(x => x !== t); persist(); render();
  },
  async 'empty-trash'() {
    const ok = await confirmTyped({ title: `Empty the trash (${plural(D.trash.length, 'item')})?`, body: 'Everything in the trash is deleted for good. Older backups still have it.', word: 'delete forever', button: 'Empty trash' });
    if (!ok) return;
    D.trash = []; persist(); render();
  },
  unhide(el) { const d = D.units[el.dataset.unit]; if (d) delete d.hidden; snapshotTrend(); persist(); render(); toast('Unit is visible again'); },
  async 'backup-now'() {
    if (!Backend.native) return toast('Backups only work in the desktop app');
    await flush();
    UI.backups = await Backend.call('backup_now');
    const el = $('#backupList'); if (el) el.innerHTML = backupListHTML();
    toast('Backup saved');
  },
  async 'restore-backup'(el) {
    const name = el.dataset.name;
    const ok = await confirmTyped({ title: 'Restore this backup?', word: 'restore', button: 'Restore',
      body: `All your current data is replaced with <b>${esc(name)}</b>.<br>Your current data is saved as a backup first, so you can undo this.` });
    if (!ok) return;
    await flush();
    const res = await Backend.call('restore_backup', name);
    if (!res || !res.ok) return toast((res && res.error) || 'Restore failed');
    D = migrate(res.data); buildModel(); UI.warning = null; UI.backups = null; render(); toast('Backup restored');
  },
  'open-folder'() { if (!Backend.native) return toast('Only available in the desktop app'); Backend.call('open_data_folder'); },
  async export() {
    if (!Backend.native) return toast('Only available in the desktop app');
    await flush();
    const res = await Backend.call('export_data', D);
    if (res && res.ok) toast(`Exported to ${res.path}`);
  },
  async import() {
    if (!Backend.native) return toast('Only available in the desktop app');
    await flush();
    const res = await Backend.call('pick_import_file');
    if (!res || res.cancelled) return;
    if (!res.ok) return toast(res.error || 'Import failed');
    const ok = await confirmTyped({ title: 'Replace everything with this file?', word: 'import', button: 'Import',
      body: `<b>${esc(res.path)}</b><br>All current data is replaced. A backup of your current data has already been saved.` });
    if (!ok) return;
    D = migrate(res.data); buildModel(); snapshotTrend(); persist(); UI.backups = null; render(); toast('Imported');
  },
  'expand-land'() {
    openModal(`<div class="card-h"><h2>Confidence landscape</h2><span class="hint">height and colour = confidence · drag to spin · numbers follow unit order</span><div class="grow"></div><button class="sm" data-m="close">Close</button></div>
      <canvas id="cv-land-big"></canvas>`, { wide: true });
    Visuals.start(orbitItems, key => goToUnit(key));
  },
  'dismiss-warning'() { UI.warning = null; render(); },
};

const FORMS = {
  link(f) {
    const fd = Object.fromEntries(new FormData(f));
    let url = (fd.url || '').trim();
    if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
    let parsed;
    try { parsed = new URL(url); } catch { return toast('That doesn’t look like a web address'); }
    if (!/^https?:$/.test(parsed.protocol)) return toast('Only web links can be added');
    const key = f.dataset.key;
    (D.links[key] = D.links[key] || []).push({ id: uid(), label: (fd.label || '').trim() || parsed.hostname, url: parsed.href, at: Date.now() });
    persist(); render();
    if (UI.resModal) UI.resModal.draw();
    toast('Link added');
  },
  log(f) {
    const fd = Object.fromEntries(new FormData(f));
    const minutes = Math.round(+fd.minutes);
    if (!(minutes > 0)) return toast('Enter how many minutes');
    const e = { id: uid(), date: fd.date || todayISO(), subject: fd.subject, unit: fd.unit || '', minutes, kind: fd.kind, note: (fd.note || '').trim(), at: Date.now() };
    if ((fd.title || '').trim()) e.title = fd.title.trim();
    D.log.push(e); markActivity(e.date);
    UI.lastLogSubject = fd.subject; UI.lastKind = fd.kind; UI.logPrefill = null;
    persist(); render();
    toast(`Logged ${fmtMins(minutes)} of ${subj(e.subject).name}`);
  },
  score(f) {
    const fd = Object.fromEntries(new FormData(f));
    const got = +fd.got, max = +fd.max;
    if (!(max > 0) || !(got >= 0) || got > max) return toast('Marks must be between 0 and the total');
    D.scores.push({ id: uid(), date: fd.date, subject: fd.subject, unit: fd.unit || '', title: fd.title.trim(), kind: fd.kind, got, max, at: Date.now() });
    UI.lastScoreSubject = fd.subject; markActivity(fd.date);
    persist(); render(); toast(`Added ${Math.round(got / max * 100)}%`);
  },
  exam(f) {
    const fd = Object.fromEntries(new FormData(f));
    if (!fd.name.trim() || !fd.date) return;
    D.exams.push({ id: uid(), name: fd.name.trim(), date: fd.date });
    persist(); render(); toast('Date added');
  },
};

/* ---------- global events ---------- */
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const fn = ACTIONS[el.dataset.action];
  if (!fn) return;
  try { fn(el, e); } catch (err) { console.error(err); toast('That didn’t work. Your data is safe.'); }
});
document.addEventListener('submit', e => {
  const f = e.target.closest('form[data-form]'); if (!f) return;
  e.preventDefault();
  try { FORMS[f.dataset.form]?.(f); } catch (err) { console.error(err); toast('That didn’t work. Your data is safe.'); }
});
const saveNotes = debounce(() => persist(), 400);
document.addEventListener('input', e => {
  const el = e.target;
  if (el.matches('textarea.notes')) {
    const d = uw(el.dataset.unit);
    if (el.value) d.notes = el.value; else delete d.notes;
    saveNotes();
  } else if (el.matches('textarea.tnote')) {
    const k = el.dataset.topic, cur = D.topics[k] || {}, v = el.value;
    if (v.trim()) D.topics[k] = { ...cur, stage: cur.stage || 0, at: cur.at || Date.now(), note: v };
    else if (cur.stage) { delete cur.note; D.topics[k] = cur; }
    else delete D.topics[k];
    saveNotes();
  } else if (el.id === 'todayQ') {
    UI.todayQ = el.value; $('#todayResults').innerHTML = todayResults();
  } else if (el.id === 'palQ') {
    UI.palQ = el.value; $('#palRes').innerHTML = paletteResults();
  } else if (el.closest('form[data-form=score]') && (el.name === 'got' || el.name === 'max')) {
    const f = readForm('score'), out = $('#scorePct');
    out.textContent = +f.max > 0 && f.got !== '' ? `${Math.round(+f.got / +f.max * 100)}%` : '';
    out.style.color = +f.max > 0 ? col(+f.got / +f.max * 10) : '';
  }
});
document.addEventListener('change', e => {
  const el = e.target;
  if (el.matches('select[data-units-for]')) {
    const target = document.getElementById(el.dataset.unitsFor);
    if (target) target.innerHTML = unitOptions(el.value);
  } else if (el.id === 'orbitSel') {
    UI.orbitSel = el.value;
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (openMenuEl) { closeMenu(); return; }
    if (MODALS.length) { e.preventDefault(); MODALS[MODALS.length - 1].close(); return; }
  }
  const typing = e.target.closest && e.target.closest('input, textarea, select');
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openSearch(); }
  else if (!typing && !MODALS.length && e.key === '/') { e.preventDefault(); openSearch(); }
  else if (!typing && e.key === 'Enter' && e.target.matches && e.target.matches('.scard')) e.target.click();
});
window.addEventListener('resize', debounce(drawStatic, 120));
$('#main').addEventListener('scroll', closeMenu, { passive: true });

let autoTick = 0;
setInterval(() => {
  if (!D) return;
  if (D.settings.timer) {
    const txt = fmtClock(Date.now() - D.settings.timer.start);
    document.querySelectorAll('[data-timer]').forEach(el => { el.textContent = txt; });
  }
  if (++autoTick % 30 === 0 && D.settings.auto && Date.now() - D.settings.auto.lastAt > AUTO_GAP * 60000) {
    closeAuto(); persist(); render();            // you've stopped for a while: bank the session
  }
}, 1000);

/* ---------- phone connector ----------
   Edits made through the MCP connector (connector/) wait on the server until this app applies them,
   with the same effect as clicking, timed when they were made. D.sync.appliedSeq goes back with the
   next save, which clears them from the server. */
const typing = () => { const a = document.activeElement; return !!a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName); };
const Sync = {
  on: true, busy: false, stale: false,
  start() {
    if (!Backend.native) return;
    this.pull();
    setInterval(() => this.pull(), 20000);
    window.addEventListener('focus', () => this.pull());
  },
  async pull() {
    if (this.stale && !typing()) { this.stale = false; render(); }
    if (!this.on || this.busy) return;
    this.busy = true;
    try {
      const res = await Backend.call('sync_pull', (D.sync && D.sync.appliedSeq) || 0);
      if (res.disabled) { this.on = false; return; }
      $('#modeNote').textContent = res.ok ? '' : 'Phone connector offline, retrying';
      if (res.ok && res.ops.length) applyRemote(res.ops);
    } catch { /* app.py unreachable: saving shows that already */ }
    finally { this.busy = false; }
  },
};
function applyRemote(ops) {
  D.sync = D.sync || { appliedSeq: 0 };
  let n = 0;
  for (const op of [...ops].sort((a, b) => a.seq - b.seq)) {
    if (op.seq <= D.sync.appliedSeq) continue;
    if (op.type === 'topic') {
      const cur = { ...(D.topics[op.key] || {}) };
      if ('stage' in op) { cur.stage = op.stage; cur.at = op.at; if (op.stage > 0) cur.taughtAt = cur.taughtAt || op.at; }
      if ('rag' in op) {
        if (RAG[op.rag]) { cur.rag = op.rag; cur.reviewedAt = op.at; cur.at = op.at; }
        else { delete cur.rag; delete cur.conf; delete cur.reviewedAt; }
      }
      if ('note' in op) { if (op.note) cur.note = op.note; else delete cur.note; }
      if (cur.stage || cur.rag || cur.note) D.topics[op.key] = cur; else delete D.topics[op.key];
      markActivity(isoDate(op.at));
    } else if (op.type === 'log' || op.type === 'score') {
      const list = op.type === 'log' ? D.log : D.scores;
      if (!list.some(e => e.id === op.entry.id)) list.push(op.entry);
    }
    D.sync.appliedSeq = op.seq; n++;
  }
  if (!n) return;
  snapshotTrend(); persist();
  if (typing()) Sync.stale = true; else render();
  toast(`${plural(n, 'change')} from the phone connector`);
}

/* ---------- start ---------- */
(async function init() {
  await Backend.connect();
  let res;
  try { res = await Backend.load(); }
  catch (err) {
    console.error(err);
    $('#view').innerHTML = `<div class="fatal">Couldn’t load the curriculum files: ${esc(err && err.message || err)}</div>`;
    return;
  }
  CUR = res.curriculum; UI.dataPath = res.dataPath; UI.warning = res.warning;
  RES = { units: {}, topics: {}, ...(res.resources || {}) };
  D = res.data ? migrate(res.data) : freshData();
  let recovered = false;
  if (Backend.native) {
    try {
      const stash = JSON.parse(localStorage.getItem('st-unsaved') || 'null');
      if (stash && stash.data && stash.data.units && (stash.data.savedAt || 0) > ((res.data && res.data.savedAt) || 0)) {
        D = migrate(stash.data); recovered = true;
      }
    } catch { /* ignore */ }
  }
  buildModel();
  if (D.settings.auto && Date.now() - D.settings.auto.lastAt > AUTO_GAP * 60000) closeAuto(true);
  const hadToday = D.trend.length && D.trend[D.trend.length - 1].d === todayISO();
  snapshotTrend();
  $('#modeNote').textContent = Backend.native ? '' : 'Demo · changes stay in this browser';
  render();
  if (!res.data || !hadToday || recovered) persist(); else setSaveState('saved');
  if (recovered) toast('Recovered changes that hadn’t been saved last time');
  Sync.start();
})();

