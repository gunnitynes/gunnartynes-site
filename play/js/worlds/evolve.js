// EVOLVE — remixes as creatures. Each creature's DNA is an 8-bar arrangement: for every musician, which bar of
// the song they play in each of the 8 slots (or rest). Tap a creature to hear it, heart the ones you love,
// and BREED: hearts cross over and mutate into the next generation. You never edit a note; you just choose,
// and the remix evolves toward your taste.
import { h, canvasIn, clamp, hexA, rng } from '../lib/util.js';

const L = 8;
const SYL = ['too', 'blee', 'ka', 'mu', 'ni', 'lo', 'fa', 'su', 'mi', 'pa', 'ra', 'vó', 'ey', 'li', 'gu', 'bo'];

export default class Evolve {
  constructor(app, el) {
    this.app = app; this.el = el;
    this.gen = 1; this.playing = -1; this.hearts = new Set(); this.hover = -1; this.mouse = [0, 0];
    this.habitat = h('select', { onchange: () => this.newPool() },
      h('option', { value: 'all' }, 'whole song'),
      app.song.sections.map((s, i) => h('option', { value: i }, `part ${s.name} (bars ${s.startCell * app.song.barsPerCell + 1}–${s.endCell * app.song.barsPerCell})`)));
    const busiest = app.song.sections.reduce((b, s, i, a) => (s.density > a[b].density ? i : b), 0);
    this.habitat.value = String(busiest);
    this.rate = h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: 0.35 });
    this.genLabel = h('b', {}, 'generation 1');
    el.append(
      h('div', { class: 'world-head' }, h('h2', {}, 'Evolve'), h('p', {}, 'Four creatures, four remixes. Tap one to hear it, ♥ the ones you like, then breed. Their children inherit what you loved — and mutate.')),
      h('div', { class: 'world-tools' }, this.genLabel),
      h('div', { class: 'evolve-panel' },
        h('button', { class: 'btn hot', onclick: () => this.breed() }, '❦ Breed'),
        h('label', {}, 'habitat ', this.habitat),
        h('label', {}, 'mutation ', this.rate),
        h('button', { class: 'btn small', onclick: () => this.newPool() }, '⚂ New pool'),
        h('button', { class: 'btn small ghost', onclick: () => this.release() }, '↺ Back to the record')),
    );
    this.fill = h('div', { class: 'fill' }); el.append(this.fill);
    this.c = canvasIn(this.fill);
    const cv = this.c.cv;
    cv.addEventListener('pointermove', (e) => { const p = this.pt(e); this.mouse = p; this.hover = this.cardAt(p); cv.style.cursor = this.hover >= 0 ? 'pointer' : 'default'; });
    cv.addEventListener('pointerdown', (e) => this.click(this.pt(e)));
    this.newPool();
  }

  tracks() { return this.app.session.state.order.filter((id) => { const c = this.app.catalog.get(id); return c && !c.locked; }); }
  bars() {
    const { song } = this.app, v = this.habitat.value;
    const s = v === 'all' ? { startCell: 0, endCell: song.numCells } : song.sections[+v];
    return [s.startCell * song.barsPerCell, Math.min(song.numBars, s.endCell * song.barsPerCell)];
  }
  /** Bars in the habitat where this musician actually plays, as genes [cell, bar]. */
  pool(id) {
    const src = this.app.catalog.get(id), cb = this.app.song.barsPerCell, [a, b] = this.bars(), out = [];
    if (src.kind !== 'stem') { src.cells.forEach((_, c) => { for (let k = 0; k < cb; k++) out.push([c, k]); }); return out; }
    for (let B = a; B < b; B++) { const c = Math.floor(B / cb); if (src.cells[c] && (src.barDb?.[B] ?? 0) > -55) out.push([c, B % cb]); }
    return out;
  }

  randomGenome(r) {
    const genes = {};
    for (const id of this.tracks()) {
      const pool = this.pool(id);
      if (!pool.length || r() < 0.28) { genes[id] = Array(L).fill(null); continue; }
      const density = 0.45 + r() * 0.55, cb = this.app.song.barsPerCell;
      let cur = pool[Math.floor(r() * pool.length)];
      genes[id] = Array.from({ length: L }, (_, k) => {
        if (k > 0) {
          const x = r();
          if (x < 0.55) { const nb = cur[1] + 1; cur = nb < cb ? [cur[0], nb] : [cur[0] + 1, 0]; if (!pool.some((p) => p[0] === cur[0] && p[1] === cur[1])) cur = pool[Math.floor(r() * pool.length)]; }
          else if (x < 0.75) cur = pool[Math.floor(r() * pool.length)];
          // else: repeat the bar — a stutter
        }
        return r() < density ? [...cur] : null;
      });
    }
    return { genes, seed: Math.floor(r() * 1e9) };
  }

  mutate(gm, r) {
    const rate = +this.rate.value, genes = structuredClone(gm.genes);
    for (const id of this.tracks()) {
      const pool = this.pool(id); let g = genes[id] ?? Array(L).fill(null);
      if (!pool.length) continue;
      if (r() < rate * 0.08) g = g.every((x) => !x) ? this.randomGenome(r).genes[id] ?? g : Array(L).fill(null);
      if (r() < rate * 0.12) { const k = 1 + Math.floor(r() * 3); g = [...g.slice(k), ...g.slice(0, k)]; }
      g = g.map((x, k) => {
        const p = r();
        if (p < rate * 0.25) return pool[Math.floor(r() * pool.length)];
        if (p < rate * 0.38) return x ? null : pool[Math.floor(r() * pool.length)];
        if (p < rate * 0.46 && k > 0) return g[k - 1];
        return x;
      });
      genes[id] = g;
    }
    return { genes, seed: Math.floor(r() * 1e9) };
  }

  cross(a, b, r) {
    const genes = {};
    for (const id of this.tracks()) {
      const ga = a.genes[id] ?? Array(L).fill(null), gb = b.genes[id] ?? Array(L).fill(null);
      if (r() < 0.25) { const cut = 1 + Math.floor(r() * (L - 1)); genes[id] = [...ga.slice(0, cut), ...gb.slice(cut)]; }
      else genes[id] = structuredClone(r() < 0.5 ? ga : gb);
    }
    return { genes, seed: Math.floor(r() * 1e9) };
  }

  newPool() {
    const r = rng(Date.now());
    this.creatures = Array.from({ length: 4 }, () => this.randomGenome(r));
    this.gen = 1; this.hearts.clear(); this.playing = -1; this.genLabel.textContent = 'generation 1';
  }

  breed() {
    const r = rng(Date.now() ^ (this.gen * 7919));
    const parents = [...this.hearts].map((i) => this.creatures[i]);
    if (!parents.length) { this.app.toast({ icon: '♥', title: 'Choose first', text: 'Heart at least one creature to breed from.' }); return; }
    const kids = [structuredClone(parents[0])];
    while (kids.length < 4) {
      const a = parents[Math.floor(r() * parents.length)], b = parents[Math.floor(r() * parents.length)];
      kids.push(this.mutate(parents.length > 1 ? this.cross(a, b, r) : a, r));
    }
    this.creatures = kids; this.hearts.clear(); this.gen++;
    this.genLabel.textContent = `generation ${this.gen}`;
    this.app.chime('tick');
    if (this.gen >= 5) this.app.profile.award('darwin');
    this.app.profile.addXp(4, 'evolution');
    this.listen(0);
  }

  listen(i) {
    const gm = this.creatures[i], p = {};
    for (const id of this.tracks()) p[id] = { mode: 'pattern', pattern: gm.genes[id] ?? Array(L).fill(null) };
    this.app.session.dispatch({ t: 'tracks/set', p, g: 'evolve' });
    this.playing = i;
    if (!this.app.player.playing) this.app.player.play();
  }
  release() {
    const p = {}; for (const id of this.tracks()) p[id] = { mode: 'follow' };
    this.app.session.dispatch({ t: 'tracks/set', p }); this.playing = -1;
  }

  pt(e) { const r = this.c.cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  cards() {
    const { w, h: H } = this.c, top = 96, bottom = 76, cols = w > 900 ? 4 : 2, rows = 4 / cols;
    const cw = (w - 44 - (cols - 1) * 14) / cols, ch = (H - top - bottom - (rows - 1) * 14) / rows;
    return Array.from({ length: 4 }, (_, i) => ({ x: 22 + (i % cols) * (cw + 14), y: top + Math.floor(i / cols) * (ch + 14), w: cw, h: ch }));
  }
  cardAt([x, y]) { return this.cards().findIndex((c) => x >= c.x && x < c.x + c.w && y >= c.y && y < c.y + c.h); }
  click(p) {
    const i = this.cardAt(p); if (i < 0) return;
    const c = this.cards()[i];
    if (Math.hypot(p[0] - (c.x + c.w - 30), p[1] - (c.y + 30)) < 22) { this.hearts.has(i) ? this.hearts.delete(i) : this.hearts.add(i); this.app.chime('tick'); return; }
    this.listen(i);
  }

  name(gm) { const r = rng(gm.seed); return Array.from({ length: 2 + Math.floor(r() * 2) }, () => SYL[Math.floor(r() * SYL.length)]).join('').replace(/^./, (c) => c.toUpperCase()); }

  frame(t) {
    const { g, w, h: H } = this.c, { catalog, player, engine, song } = this.app;
    if (w < 80 || H < 80) return; // not laid out yet
    g.clearRect(0, 0, w, H);
    const beat = player.playing ? (engine.ctx.currentTime - player.bar0) / player.beatDur : 0;
    const slot = ((Math.floor(beat / song.beatsPerBar) % L) + L) % L, pulse = player.playing ? Math.exp(-(beat % 1) * 5) : 0;
    const ids = this.tracks();
    this.cards().forEach((c, i) => {
      const gm = this.creatures[i], active = i === this.playing, hov = i === this.hover;
      g.fillStyle = active ? 'rgba(159,240,208,0.08)' : hov ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.02)';
      g.strokeStyle = active ? 'rgba(159,240,208,0.5)' : 'rgba(245,240,255,0.08)'; g.lineWidth = active ? 2 : 1;
      g.beginPath(); g.roundRect(c.x, c.y, c.w, c.h, 22); g.fill(); g.stroke();
      g.save(); g.beginPath(); g.roundRect(c.x, c.y, c.w, c.h, 22); g.clip();
      // water caustics
      const r = rng(gm.seed);
      for (let k = 0; k < 14; k++) { g.fillStyle = 'rgba(168,216,255,0.04)'; g.beginPath(); g.arc(c.x + r() * c.w, c.y + r() * c.h, 6 + r() * 26 + Math.sin(t + k) * 3, 0, 7); g.fill(); }

      const live = ids.filter((id) => gm.genes[id]?.some(Boolean));
      const density = live.reduce((s, id) => s + gm.genes[id].filter(Boolean).length, 0) / Math.max(1, ids.length * L);
      const cx = c.x + c.w / 2, cy = c.y + c.h * 0.52, scale = Math.min(c.w, c.h) / 300;
      const body = (34 + density * 60) * scale * (active ? 1 + pulse * 0.08 : 1);
      // tentacles: one per musician who plays, beads = the 8 genes
      live.forEach((id, k) => {
        const src = catalog.get(id), genes = gm.genes[id];
        const a0 = (k / live.length) * Math.PI * 2 + r() * 0.3 + Math.sin(t * 0.6 + k) * 0.15;
        let px = cx, py = cy;
        for (let s = 0; s < L; s++) {
          const a = a0 + Math.sin(t * 1.6 + s * 0.7 + k) * 0.18 * (s / L);
          const nx = px + Math.cos(a) * (9 + 3 * scale) * scale * 1.6, ny = py + Math.sin(a) * (9 + 3 * scale) * scale * 1.6;
          const d = s === 0 ? body * 0.9 : 0;
          const bx = nx + Math.cos(a) * d, by = ny + Math.sin(a) * d;
          g.strokeStyle = hexA(src.color, 0.4); g.lineWidth = 2 * scale; g.beginPath(); g.moveTo(px + Math.cos(a) * d, py + Math.sin(a) * d); g.lineTo(bx, by); g.stroke();
          const on = genes[s], now = active && s === slot && on;
          g.fillStyle = on ? hexA(src.color, now ? 1 : 0.75) : 'rgba(245,240,255,0.1)';
          if (now) { g.shadowColor = src.color; g.shadowBlur = 16; }
          g.beginPath(); g.arc(bx, by, (on ? 4.2 : 2.2) * scale * (now ? 1.6 : 1), 0, 7); g.fill(); g.shadowBlur = 0;
          px = bx - Math.cos(a) * 0; py = by;
        }
      });
      // body
      const grad = g.createRadialGradient(cx - body * 0.3, cy - body * 0.3, body * 0.1, cx, cy, body);
      const tint = live.length ? catalog.get(live[Math.floor(rng(gm.seed + 1)() * live.length)]).color : '#666';
      grad.addColorStop(0, '#fff8ef'); grad.addColorStop(0.35, tint); grad.addColorStop(1, hexA(tint, 0.6));
      g.fillStyle = grad; g.beginPath();
      for (let k = 0; k <= 40; k++) {
        const a = (k / 40) * Math.PI * 2, wob = 1 + 0.06 * Math.sin(a * 5 + t * 2 + gm.seed) + (active ? pulse * 0.05 * Math.sin(a * 3) : 0);
        const x = cx + Math.cos(a) * body * wob, y = cy + Math.sin(a) * body * wob * 0.92;
        k ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.fill();
      // eyes that follow you
      for (const side of [-1, 1]) {
        const ex = cx + side * body * 0.32, ey = cy - body * 0.18, er = body * 0.2;
        const blink = Math.sin(t * 0.7 + gm.seed) > 0.985 ? 0.15 : 1;
        g.fillStyle = '#fff'; g.beginPath(); g.ellipse(ex, ey, er, er * blink, 0, 0, 7); g.fill();
        const la = Math.atan2(this.mouse[1] - ey, this.mouse[0] - ex);
        g.fillStyle = '#160f1c'; g.beginPath(); g.arc(ex + Math.cos(la) * er * 0.4, ey + Math.sin(la) * er * 0.4 * blink, er * 0.45 * blink, 0, 7); g.fill();
      }
      if (active) { g.strokeStyle = '#160f1c'; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy + body * 0.25, body * 0.18, 0.2, Math.PI - 0.2); g.stroke(); }
      // labels + heart
      g.fillStyle = 'rgba(245,240,255,0.9)'; g.font = '700 16px Bricolage Grotesque'; g.fillText(this.name(gm), c.x + 18, c.y + 32);
      g.fillStyle = 'rgba(245,240,255,0.45)'; g.font = '11px JetBrains Mono';
      g.fillText(`${live.length} musicians · ${Math.round(density * 100)}% dense`, c.x + 18, c.y + 50);
      if (active) { g.fillStyle = '#9ff0d0'; g.font = '600 11px Bricolage Grotesque'; g.fillText('♪ LISTENING', c.x + 18, c.y + c.h - 18); }
      const lov = this.hearts.has(i);
      g.font = '24px Bricolage Grotesque'; g.fillStyle = lov ? '#ff8fb1' : 'rgba(245,240,255,0.3)';
      g.fillText(lov ? '♥' : '♡', c.x + c.w - 42, c.y + 39);
      g.restore();
    });
  }
}
