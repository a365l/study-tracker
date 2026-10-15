'use strict';
/* Canvas visuals: mastery orbit + confidence landscape (animated), line and bar charts (static). */
const Visuals = (() => {
  const FONT = '"Segoe UI", -apple-system, system-ui, sans-serif';
  const col = v => v <= 0 ? '#3b4354' : `hsl(${5 + (v - 1) * 9.6} 90% ${56 + (v - 1) * 0.7}%)`;
  const parseD = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const fmtD = s => parseD(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

  function fit(c) {
    const r = c.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    const W = Math.max(1, Math.round(r.width * dpr)), H = Math.max(1, Math.round(r.height * dpr));
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, r.width, r.height);
    return { g, w: r.width, h: r.height };
  }

  function emptyText(g, w, h, text) {
    g.fillStyle = '#6b7385'; g.font = `13px ${FONT}`; g.textAlign = 'center';
    g.fillText(text, w / 2, h / 2);
  }

  /* ---------- animated ---------- */
  const disp = new Map();              // unit key -> displayed confidence 0..1 (eases toward target)
  let T = 0, stars = null, mouse = null, hovKey = null, running = false;
  let getItems = () => [], onPick = () => {};
  let ry = 0.7, rx = 0.5, drag = null;

  function drawOrbit(cv, items) {
    const { g, w, h } = fit(cv), n = items.length;
    const cx = w / 2, cy = h / 2, R = Math.max(40, Math.min(w / 2 - 34, (h / 2 - 24) / 0.54));
    if (!stars || stars.w !== w || stars.h !== h) {
      stars = { w, h, p: Array.from({ length: 120 }, () => ({
        x: Math.random() * w, y: Math.random() * h, r: Math.random() * 1.2 + 0.2, a: Math.random() * 0.45 + 0.12, s: Math.random() * 6 })) };
    }
    for (const q of stars.p) {
      g.globalAlpha = q.a * (0.55 + 0.45 * Math.sin(T * 3 + q.s));
      g.fillStyle = '#c9d2e4'; g.beginPath(); g.arc(q.x, q.y, q.r, 0, 7); g.fill();
    }
    g.globalAlpha = 1;
    for (let v = 0; v <= 10; v += 2) {
      const rr = R * (1 - 0.76 * v / 10);
      g.beginPath(); g.ellipse(cx, cy, rr, rr * 0.54, 0, 0, 7);
      g.strokeStyle = v ? 'rgba(255,255,255,.055)' : 'rgba(255,255,255,.11)'; g.lineWidth = 1; g.stroke();
    }

    const P = items.map((it, i) => {
      const v = disp.get(it.key) ?? 0, rad = R * (1 - 0.76 * v);
      const ang = i * 2.3999 + T * (0.3 / Math.pow(Math.max(rad / R, 0.22), 1.4));
      const d = (Math.sin(ang) + 1) / 2;
      return { it, rad, ang, d, x: cx + Math.cos(ang) * rad, y: cy + Math.sin(ang) * rad * 0.54,
        sz: (4 + it.cov * 5) * (0.72 + d * 0.56), c: it.v > 0 ? col(v * 10) : '#4a5263' };
    });

    hovKey = null; let hovP = null;
    if (mouse && mouse.cv === cv) {
      let best = 1e9;
      for (const p of P) {
        const dd = Math.hypot(p.x - mouse.x, p.y - mouse.y);
        if (dd < Math.max(p.sz + 8, 14) && dd < best) { best = dd; hovKey = p.it.key; hovP = p; }
      }
    }
    cv.style.cursor = hovKey ? 'pointer' : 'default';

    const planet = p => {
      g.beginPath(); g.ellipse(cx, cy, p.rad, p.rad * 0.54, 0, p.ang - 0.6, p.ang);
      g.strokeStyle = p.c; g.globalAlpha = 0.28 * (0.35 + p.d * 0.65); g.lineWidth = 1.6; g.stroke(); g.globalAlpha = 1;
      g.beginPath(); g.arc(p.x, p.y, p.sz, 0, 7); g.fillStyle = p.c;
      g.shadowColor = p.c; g.shadowBlur = hovP === p ? 28 : 15; g.fill(); g.shadowBlur = 0;
      g.beginPath(); g.arc(p.x, p.y, p.sz + 2.6, 0, 7); g.strokeStyle = p.it.color; g.globalAlpha = 0.55; g.lineWidth = 1.2; g.stroke(); g.globalAlpha = 1;
      if (hovP === p) { g.beginPath(); g.arc(p.x, p.y, p.sz + 6, 0, 7); g.strokeStyle = '#fff'; g.lineWidth = 1.3; g.stroke(); }
    };
    P.filter(p => Math.sin(p.ang) < 0).sort((a, b) => a.d - b.d).forEach(planet);

    const rated = items.filter(it => it.v > 0);
    const m = rated.length ? rated.reduce((t, it) => t + (disp.get(it.key) ?? 0), 0) / rated.length : 0;
    const pr = 15 + m * 16 + Math.sin(T * 4) * 1.6;
    const gr = g.createRadialGradient(cx, cy, 0, cx, cy, pr * 2.6);
    gr.addColorStop(0, 'rgba(255,255,255,.97)'); gr.addColorStop(0.28, rated.length ? col(m * 10) : '#6b7385');
    gr.addColorStop(0.55, 'rgba(200,255,77,.18)'); gr.addColorStop(1, 'rgba(200,255,77,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, pr * 2.6, 0, 7); g.fill();
    g.fillStyle = '#080a0c'; g.textAlign = 'center'; g.font = `700 ${Math.round(pr * 0.85)}px ${FONT}`;
    g.fillText(rated.length ? (m * 10).toFixed(1) : '–', cx, cy + pr * 0.3);

    P.filter(p => Math.sin(p.ang) >= 0).sort((a, b) => a.d - b.d).forEach(planet);

    if (hovP) {
      const it = hovP.it, l1 = it.name;
      const l2 = `${it.subj}  ·  ${it.v > 0 ? Math.round(it.v * 10) + '/10' : 'not rated'}  ·  ${Math.round(it.cov * 100)}% of topic stages`;
      g.font = `600 13px ${FONT}`; const w1 = g.measureText(l1).width;
      g.font = `11px ${FONT}`; const w2 = g.measureText(l2).width;
      const bw = Math.max(w1, w2) + 22, bh = 46;
      const bx = Math.min(Math.max(hovP.x - bw / 2, 6), w - bw - 6), by = hovP.y - bh - 16 < 6 ? hovP.y + 16 : hovP.y - bh - 16;
      g.beginPath(); if (g.roundRect) g.roundRect(bx, by, bw, bh, 10); else g.rect(bx, by, bw, bh);
      g.fillStyle = 'rgba(12,14,20,.95)'; g.fill(); g.strokeStyle = 'rgba(255,255,255,.16)'; g.lineWidth = 1; g.stroke();
      g.textAlign = 'left'; g.fillStyle = '#fff'; g.font = `600 13px ${FONT}`; g.fillText(l1, bx + 11, by + 20);
      g.fillStyle = '#8b93a8'; g.font = `11px ${FONT}`; g.fillText(l2, bx + 11, by + 35);
    }
    if (!n) emptyText(g, w, h, 'No units to show for this selection');
  }

  function drawLandscape(cv, items) {
    const { g, w, h } = fit(cv), n = items.length;
    if (!n) { emptyText(g, w, h, 'No units to show'); return; }
    const cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols), k = 4.4 / Math.max(cols, rows), fov = 520;
    const P = (X, Y, Z) => {
      const c1 = Math.cos(ry), s1 = Math.sin(ry), a = X * c1 - Z * s1, b = X * s1 + Z * c1;
      const c2 = Math.cos(rx), s2 = Math.sin(rx), Yv = Y * c2 - b * s2, Zv = Y * s2 + b * c2;
      const f = fov / (13 + Zv);
      return [a * f, -Yv * f, Zv];
    };
    const gx = i => ((i % cols) - (cols - 1) / 2) * k, gz = i => (Math.floor(i / cols) - (rows - 1) / 2) * k;
    const ext = Math.max(cols, rows) * k / 2 + k * 0.4, s = k * 0.33, hm = 1.9 * k;
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    const acc = p => { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); };
    for (let i = 0; i < n; i++) {
      const X = gx(i), Z = gz(i);
      [[X - s, 0, Z - s], [X + s, 0, Z - s], [X + s, 0, Z + s], [X - s, 0, Z + s], [X - s, hm, Z - s], [X + s, hm, Z - s], [X + s, hm, Z + s], [X - s, hm, Z + s]]
        .forEach(q => acc(P(q[0], q[1], q[2])));
    }
    [[-ext, 0, -ext], [ext, 0, -ext], [ext, 0, ext], [-ext, 0, ext]].forEach(q => acc(P(q[0], q[1], q[2])));
    const pad = 12, sc = Math.min((w - pad * 2) / (x1 - x0), (h - pad * 2) / (y1 - y0));
    g.save(); g.translate(w / 2 - (x0 + x1) / 2 * sc, h / 2 - (y0 + y1) / 2 * sc); g.scale(sc, sc);
    g.strokeStyle = 'rgba(255,255,255,.07)'; g.lineWidth = 1 / sc;
    for (let i = 0; i <= Math.max(cols, rows); i++) {
      const t = -ext + i * k;
      let q = P(t, 0, -ext), r = P(t, 0, ext); g.beginPath(); g.moveTo(q[0], q[1]); g.lineTo(r[0], r[1]);
      q = P(-ext, 0, t); r = P(ext, 0, t); g.moveTo(q[0], q[1]); g.lineTo(r[0], r[1]); g.stroke();
    }
    items.map((_, i) => i).sort((a, b) => P(gx(b), 0, gz(b))[2] - P(gx(a), 0, gz(a))[2]).forEach(i => {
      const X = gx(i), Z = gz(i), v = disp.get(items[i].key) ?? 0, H = Math.max(v, 0.012) * hm;
      const c = items[i].v > 0 ? col(v * 10) : '#3b4354';
      const b = [[X - s, 0, Z - s], [X + s, 0, Z - s], [X + s, 0, Z + s], [X - s, 0, Z + s]].map(q => P(q[0], q[1], q[2]));
      const t = [[X - s, H, Z - s], [X + s, H, Z - s], [X + s, H, Z + s], [X - s, H, Z + s]].map(q => P(q[0], q[1], q[2]));
      g.save(); g.shadowColor = c; g.shadowBlur = 14 / sc;
      [[0, 1], [1, 2], [2, 3], [3, 0]].map(([u, vv]) => ({ p: [b[u], b[vv], t[vv], t[u]], d: (b[u][2] + b[vv][2]) / 2 }))
        .sort((m, q) => q.d - m.d)
        .forEach((q, idx) => {
          g.beginPath(); q.p.forEach((r, j) => j ? g.lineTo(r[0], r[1]) : g.moveTo(r[0], r[1])); g.closePath();
          g.fillStyle = idx < 2 ? 'rgba(20,24,42,.75)' : c; g.globalAlpha = idx < 2 ? 1 : 0.55; g.fill(); g.globalAlpha = 1;
        });
      g.beginPath(); t.forEach((q, j) => j ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1])); g.closePath();
      g.fillStyle = c; g.fill(); g.restore();
      if (n <= 40 && sc > 0.35) {
        const mid = [(t[0][0] + t[2][0]) / 2, (t[0][1] + t[2][1]) / 2];
        g.fillStyle = 'rgba(255,255,255,.9)'; g.font = `600 ${10 / sc}px ${FONT}`; g.textAlign = 'center';
        g.fillText(String(i + 1), mid[0], mid[1] + 3 / sc);
      }
    });
    g.restore();
  }

  function frame() {
    const o = document.getElementById('cv-orbit'), l = document.getElementById('cv-land'), big = document.getElementById('cv-land-big');
    if (!o && !l && !big) { running = false; return; }
    const items = getItems();
    for (const it of items) { const cur = disp.get(it.key) ?? 0; disp.set(it.key, cur + (it.v - cur) * 0.11); }
    T += 0.0055;
    if (o) drawOrbit(o, items);
    if (l) drawLandscape(l, items);
    if (big) drawLandscape(big, items);
    if (!drag) ry += 0.0035;
    requestAnimationFrame(frame);
  }

  function start(itemsFn, pickFn) {
    getItems = itemsFn; onPick = pickFn;
    if (!running) { running = true; requestAnimationFrame(frame); }
  }

  window.addEventListener('pointermove', e => {
    const cv = document.getElementById('cv-orbit');
    if (cv) {
      const r = cv.getBoundingClientRect();
      mouse = e.clientX > r.left && e.clientX < r.right && e.clientY > r.top && e.clientY < r.bottom
        ? { cv, x: e.clientX - r.left, y: e.clientY - r.top } : null;
    } else mouse = null;
    if (drag) {
      ry += (e.clientX - drag.x) * 0.01;
      rx = Math.max(0.12, Math.min(1.2, rx + (e.clientY - drag.y) * 0.006));
      drag = { x: e.clientX, y: e.clientY };
    }
  });
  window.addEventListener('click', e => { if (e.target.id === 'cv-orbit' && hovKey) onPick(hovKey); });
  window.addEventListener('pointerdown', e => {
    if (e.target.id === 'cv-land' || e.target.id === 'cv-land-big') drag = { x: e.clientX, y: e.clientY };
  });
  window.addEventListener('pointerup', () => { drag = null; });

  /* ---------- static charts ---------- */
  function lineChart(cv, { series, yMax = 100, suffix = '%', empty = 'Not enough data yet' }) {
    const { g, w, h } = fit(cv);
    const days = [...new Set(series.flatMap(s => s.points.map(p => p.d)))].sort();
    if (days.length < 2) { emptyText(g, w, h, empty); return; }
    const L = 38, Rm = 14, Tm = 10, B = 22;
    const t0 = +parseD(days[0]), t1 = +parseD(days[days.length - 1]);
    const X = d => L + ((+parseD(d) - t0) / (t1 - t0)) * (w - L - Rm);
    const Y = v => Tm + (1 - Math.min(v, yMax) / yMax) * (h - Tm - B);
    g.lineWidth = 1; g.font = `10.5px ${FONT}`;
    [0, yMax / 2, yMax].forEach(v => {
      g.strokeStyle = 'rgba(255,255,255,.07)'; g.beginPath(); g.moveTo(L, Y(v)); g.lineTo(w - Rm, Y(v)); g.stroke();
      g.fillStyle = '#6b7385'; g.textAlign = 'right'; g.fillText(v + suffix, L - 6, Y(v) + 3);
    });
    g.textAlign = 'center'; g.fillStyle = '#6b7385';
    g.fillText(fmtD(days[0]), X(days[0]), h - 5);
    g.fillText(fmtD(days[days.length - 1]), X(days[days.length - 1]), h - 5);
    for (const s of series) {
      const pts = [...s.points].sort((a, b) => a.d < b.d ? -1 : a.d > b.d ? 1 : 0);
      if (!pts.length) continue;
      g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(X(p.d), Y(p.y)) : g.moveTo(X(p.d), Y(p.y)));
      g.strokeStyle = s.color; g.lineWidth = 2; g.shadowColor = s.color; g.shadowBlur = 8; g.stroke(); g.shadowBlur = 0;
      if (pts.length <= 60) pts.forEach(p => { g.beginPath(); g.arc(X(p.d), Y(p.y), 2.6, 0, 7); g.fillStyle = s.color; g.fill(); });
    }
  }

  function stackedBars(cv, { labels, stacks, fmt = v => v.toFixed(1) }) {
    const { g, w, h } = fit(cv), n = labels.length;
    const totals = labels.map((_, i) => stacks.reduce((a, s) => a + s.values[i], 0));
    const max = Math.max(1, ...totals), L = 8, Rm = 8, Tm = 20, B = 22, bw = (w - L - Rm) / n;
    g.strokeStyle = 'rgba(255,255,255,.08)'; g.beginPath(); g.moveTo(L, h - B + 0.5); g.lineTo(w - Rm, h - B + 0.5); g.stroke();
    totals.forEach((tot, i) => {
      const x = L + i * bw + bw * 0.22, ww = bw * 0.56; let y = h - B;
      for (const s of stacks) {
        const v = s.values[i]; if (!v) continue;
        const hh = v / max * (h - Tm - B);
        g.fillStyle = s.color; g.fillRect(x, y - hh, ww, Math.max(hh - 1, 1)); y -= hh;
      }
      g.textAlign = 'center'; g.font = `10.5px ${FONT}`;
      g.fillStyle = i === n - 1 ? '#cfd5e1' : '#6b7385'; g.fillText(labels[i], x + ww / 2, h - 6);
      if (tot) { g.fillStyle = '#cfd5e1'; g.fillText(fmt(tot), x + ww / 2, y - 6); }
    });
  }

  return { start, lineChart, stackedBars, col };
})();
