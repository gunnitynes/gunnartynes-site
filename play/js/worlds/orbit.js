// ORBIT — the mixer as a small solar system, with you as the sun. Distance is loudness AND air: far orbs get
// quieter, darker and wetter, the way a real sound does across a room. Left/right is pan; sinking below the
// horizon drops a sound into the echo valley. Fling an orb and gravity takes it — a mix that keeps moving on its
// own. Drop one into the pond and it falls asleep (muted) until you wake it.
import { h, canvasIn, clamp, hexA } from '../lib/util.js';

const RING = 0.5;          // where an orb sits at its original mix level
const POND_R = 46;

export function orbMix(x, y) {
  const d = Math.hypot(x, y);
  const gain = d <= RING ? 1 + (RING - d) * 0.8 : clamp((1.05 - d) / (1.05 - RING), 0, 1) ** 1.8;
  return {
    gain: +gain.toFixed(3),
    lp: +(d < 0.6 ? 1 : clamp(1 - ((d - 0.6) / 0.45) * 0.6, 0.35, 1)).toFixed(3),
    rev: +(d <= RING ? 0.03 + 0.03 * (d / RING) : 0.06 + (Math.min(d, 1.15) - RING) * 0.6).toFixed(3),
    dly: +(y > 0.15 ? Math.min(0.45, (y - 0.15) * 0.55) : 0).toFixed(3),
    pan: +clamp(x * 1.1, -1, 1).toFixed(3),
  };
}

export default class Orbit {
  constructor(app, el) {
    this.app = app; this.el = el;
    this.G = 0.22;
    el.append(
      h('div', { class: 'world-head' }, h('h2', {}, 'Orbit'), h('p', {}, 'You are the sun. Pull a sound close to hear it louder, push it out into the dark, fling it and let gravity mix for you. Drop one in the pond to put it to sleep.')),
      h('div', { class: 'world-tools' },
        h('button', { class: 'btn small', onclick: () => this.swirl() }, '◎ Swirl'),
        h('button', { class: 'btn small', onclick: () => this.home() }, '○ Home ring'),
        h('button', { class: 'btn small', onclick: () => this.scatter() }, '✺ Scatter'),
        h('button', { class: 'btn small ghost', onclick: () => this.still() }, '■ Still')),
    );
    this.fill = h('div', { class: 'fill' }); el.append(this.fill);
    this.c = canvasIn(this.fill);
    this.bodies = new Map(); // id → { x, y, vx, vy, trail[] }
    this.drag = null; this.lastPush = 0;
    const cv = this.c.cv;
    cv.addEventListener('pointerdown', (e) => this.down(e));
    cv.addEventListener('pointermove', (e) => this.move(e));
    cv.addEventListener('pointerup', (e) => this.up(e));
    cv.addEventListener('pointercancel', (e) => this.up(e));
  }

  geom() {
    const { w, h: H } = this.c;
    if (w < 640) return { cx: w / 2, cy: H * 0.45, R: Math.max(50, Math.min(w - 50, H - 220) * 0.46), pond: { x: w / 2, y: H - 120 } };
    return { cx: w / 2 + 40, cy: H / 2 + 30, R: Math.max(60, Math.min(w - 120, H - 130) * 0.46), pond: { x: 80, y: H - 90 } };
  }
  ids() { return this.app.session.state.order.filter((id) => { const c = this.app.catalog.get(id); return c && !c.locked; }); }

  body(id, i, n) {
    let b = this.bodies.get(id);
    const tr = this.app.session.state.tracks[id];
    if (!b) {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      b = { x: tr.orb?.x ?? Math.cos(a) * RING, y: tr.orb?.y ?? Math.sin(a) * RING, vx: 0, vy: 0, trail: [] };
      this.bodies.set(id, b);
    }
    return b;
  }
  toScreen(b) { const { cx, cy, R } = this.geom(); return [cx + b.x * R, cy + b.y * R]; }
  pt(e) { const r = this.c.cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }

  down(e) {
    const [px, py] = this.pt(e), { session } = this.app;
    let best = null, bd = 30;
    const ids = this.ids();
    ids.forEach((id, i) => {
      const tr = session.state.tracks[id];
      const [sx, sy] = tr.mute && tr.orb?.asleep ? this.pondSpot(id) : this.toScreen(this.body(id, i, ids.length));
      const d = Math.hypot(px - sx, py - sy); if (d < bd) { bd = d; best = id; }
    });
    if (!best) return;
    if (session.replaying) return;
    this.c.cv.setPointerCapture(e.pointerId);
    this.drag = { id: best, hist: [[px, py, performance.now()]] };
    this.bodies.get(best).touched = true;
  }
  move(e) {
    if (!this.drag) { const [px, py] = this.pt(e); this.c.cv.style.cursor = this.near(px, py) ? 'grab' : 'default'; return; }
    const [px, py] = this.pt(e), { cx, cy, R } = this.geom();
    const b = this.bodies.get(this.drag.id);
    b.x = clamp((px - cx) / R, -1.25, 1.25); b.y = clamp((py - cy) / R, -1.25, 1.25); b.vx = b.vy = 0;
    this.drag.hist.push([px, py, performance.now()]); if (this.drag.hist.length > 6) this.drag.hist.shift();
    this.c.cv.style.cursor = 'grabbing';
    const tr = this.app.session.state.tracks[this.drag.id];
    if (tr.mute && tr.orb?.asleep) this.app.session.dispatch({ t: 'track/set', id: this.drag.id, p: { mute: false, orb: { x: b.x, y: b.y } } });
  }
  up(e) {
    if (!this.drag) return;
    const { id, hist } = this.drag; this.drag = null;
    const [px, py] = this.pt(e), { pond, R } = this.geom(), b = this.bodies.get(id);
    if (Math.hypot(px - pond.x, py - pond.y) < POND_R + 10) {
      b.vx = b.vy = 0;
      this.app.session.dispatch({ t: 'track/set', id, p: { mute: true, orb: { x: b.x, y: b.y, asleep: true } } });
      this.app.chime('tick');
      return;
    }
    const [x0, y0, t0] = hist[0], [x1, y1, t1] = hist[hist.length - 1], dt = Math.max(16, t1 - t0) / 1000;
    b.vx = clamp((x1 - x0) / dt / R, -3, 3); b.vy = clamp((y1 - y0) / dt / R, -3, 3);
    if (Math.hypot(b.vx, b.vy) > 0.6) this.app.profile.award('gravity');
    this.push(true);
  }
  near(px, py) { const ids = this.ids(); return ids.some((id, i) => { const [sx, sy] = this.toScreen(this.body(id, i, ids.length)); return Math.hypot(px - sx, py - sy) < 26; }); }
  pondSpot(id) { const { pond } = this.geom(); const k = this.ids().indexOf(id); const a = k * 2.4; return [pond.x + Math.cos(a) * 18 * ((k % 3) / 2), pond.y + Math.sin(a) * 16 * ((k % 3) / 2)]; }

  swirl() { for (const b of this.bodies.values()) { b.touched = true; const r = Math.max(0.15, Math.hypot(b.x, b.y)), v = Math.sqrt(this.G / r) * (0.8 + Math.random() * 0.4); b.vx = (-b.y / r) * v; b.vy = (b.x / r) * v; } this.app.profile.award('gravity'); }
  still() { for (const b of this.bodies.values()) { b.vx = b.vy = 0; } }
  home() {
    const ids = this.ids();
    ids.forEach((id, i) => { const b = this.body(id, i, ids.length), a = (i / ids.length) * Math.PI * 2 - Math.PI / 2; Object.assign(b, { x: Math.cos(a) * RING, y: Math.sin(a) * RING, vx: 0, vy: 0, touched: true }); });
    const p = {}; for (const id of ids) p[id] = { mute: false }; this.app.session.dispatch({ t: 'tracks/set', p });
    this.push(true);
  }
  scatter() { for (const b of this.bodies.values()) { const a = Math.random() * 7, r = 0.2 + Math.random() * 0.85; Object.assign(b, { x: Math.cos(a) * r, y: Math.sin(a) * r, vx: (Math.random() - 0.5) * 0.6, vy: (Math.random() - 0.5) * 0.6, touched: true }); } this.push(true); }

  /** Write orb positions into the session (and so into the mix and the take), ~20 times a second. */
  push(force = false) {
    const now = performance.now();
    if (!force && now - this.lastPush < 50) return;
    this.lastPush = now;
    const { session } = this.app, p = {};
    for (const [id, b] of this.bodies) {
      const tr = session.state.tracks[id]; if (!tr || (tr.mute && tr.orb?.asleep)) continue;
      const o = tr.orb;
      if (!o && !b.touched) continue; // an orb nobody has moved leaves the record's own mix alone
      if (o && Math.abs(o.x - b.x) < 0.004 && Math.abs(o.y - b.y) < 0.004) continue;
      p[id] = { orb: { x: +b.x.toFixed(3), y: +b.y.toFixed(3) }, ...orbMix(b.x, b.y) };
    }
    if (Object.keys(p).length) session.dispatch({ t: 'tracks/set', p, g: 'orbit' });
  }

  frame(t, dt) {
    const { g, w, h: H } = this.c, { session, catalog, engine, song } = this.app;
    if (w < 80 || H < 80) return; // not laid out yet
    const { cx, cy, R, pond } = this.geom(), ids = this.ids(), st = session.state;
    g.clearRect(0, 0, w, H);

    // physics (unless a take is being replayed — then the orbs follow the record)
    for (const [i, id] of ids.entries()) {
      const b = this.body(id, i, ids.length), tr = st.tracks[id];
      if (session.replaying || (this.drag?.id === id)) { if (session.replaying && tr.orb) { b.x = tr.orb.x; b.y = tr.orb.y; } continue; }
      if (tr.mute && tr.orb?.asleep) continue;
      if (Math.abs(b.vx) + Math.abs(b.vy) < 1e-4) continue;
      const r = Math.max(0.12, Math.hypot(b.x, b.y)), a = this.G / (r * r);
      b.vx += (-b.x / r) * a * dt; b.vy += (-b.y / r) * a * dt;
      b.vx *= 1 - 0.04 * dt; b.vy *= 1 - 0.04 * dt;
      b.x += b.vx * dt; b.y += b.vy * dt;
      const d = Math.hypot(b.x, b.y);
      if (d > 1.2) { const nx = b.x / d, ny = b.y / d, dot = b.vx * nx + b.vy * ny; b.vx -= 1.8 * dot * nx; b.vy -= 1.8 * dot * ny; b.x = nx * 1.2; b.y = ny * 1.2; }
    }
    if (!session.replaying) this.push();

    // rings of loudness
    const lvl = engine.meterLevel(this.scope ??= new Float32Array(1024));
    for (const [k, a] of [[0.25, 0.1], [RING, 0.16], [0.75, 0.07], [1, 0.12]]) {
      g.strokeStyle = `rgba(245,240,255,${a})`; g.lineWidth = k === RING ? 1.5 : 1; g.setLineDash(k === RING ? [] : [3, 6]);
      g.beginPath(); g.arc(cx, cy, k * R, 0, 7); g.stroke();
    }
    g.setLineDash([]);
    g.fillStyle = 'rgba(245,240,255,0.25)'; g.font = '10px Bricolage Grotesque';
    g.fillText('LOUD', cx - 12, cy - R * 0.25 - 6); g.fillText('AS RECORDED', cx - 30, cy - R * RING - 6); g.fillText('FAR', cx - 8, cy - R - 6);
    g.fillText('echo valley ↓', cx + R * 0.7, cy + R * 0.95);
    g.fillText('L', cx - R - 18, cy + 4); g.fillText('R', cx + R + 10, cy + 4);

    // the sun
    const sr = 18 + lvl * 26 + Math.sin(t * 2) * 1.5;
    const sg = g.createRadialGradient(cx, cy, 0, cx, cy, sr * 3);
    sg.addColorStop(0, hexA(song.color, 0.95)); sg.addColorStop(0.3, hexA(song.color, 0.35)); sg.addColorStop(1, hexA(song.color, 0));
    g.fillStyle = sg; g.beginPath(); g.arc(cx, cy, sr * 3, 0, 7); g.fill();
    g.fillStyle = '#fff6ea'; g.beginPath(); g.arc(cx, cy, sr * 0.55, 0, 7); g.fill();

    // pond
    g.fillStyle = 'rgba(168,216,255,0.07)'; g.strokeStyle = 'rgba(168,216,255,0.3)';
    g.beginPath(); g.ellipse(pond.x, pond.y, POND_R + 8, POND_R, 0, 0, 7); g.fill(); g.stroke();
    g.fillStyle = 'rgba(168,216,255,0.5)'; g.font = '600 10px Bricolage Grotesque'; g.fillText('SLEEP POND', pond.x - 30, pond.y + POND_R + 18);

    for (const [i, id] of ids.entries()) {
      const b = this.body(id, i, ids.length), src = catalog.get(id), tr = st.tracks[id];
      const asleep = tr.mute && tr.orb?.asleep;
      const [x, y] = asleep ? this.pondSpot(id) : this.toScreen(b);
      const level = engine.channels.get(id)?.readLevel() ?? 0;
      if (!asleep) {
        // the trail lives in orbit space, so a resized window never smears it
        b.trail.push([b.x, b.y]); if (b.trail.length > 26) b.trail.shift();
        if (b.trail.length > 2) {
          g.strokeStyle = hexA(src.color, 0.18); g.lineWidth = 2; g.beginPath();
          b.trail.forEach(([tx, ty], k) => { const [sx, sy] = this.toScreen({ x: tx, y: ty }); k ? g.lineTo(sx, sy) : g.moveTo(sx, sy); }); g.stroke();
        }
      }
      const r = asleep ? 7 : 9 + Math.min(26, level * 90);
      g.shadowColor = src.color; g.shadowBlur = asleep ? 0 : 10 + level * 80;
      g.fillStyle = hexA(src.color, asleep ? 0.35 : tr.mode === 'off' ? 0.3 : 0.92);
      g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.shadowBlur = 0;
      if (!asleep) {
        g.fillStyle = 'rgba(245,240,255,0.8)'; g.font = '600 11px Bricolage Grotesque';
        g.fillText(src.name, x + r + 5, y + 4);
      } else { g.fillStyle = 'rgba(245,240,255,0.5)'; g.font = '9px Bricolage Grotesque'; g.fillText('z', x + 6, y - 6 - Math.sin(t * 2 + i) * 2); }
    }
  }
}
