// STARS — the song as a night sky. Each row is a musician, each star a four-bar phrase they played; its size is
// how loud it was. Click a star and that musician loops it from the next bar; click the sky above a column and
// the whole band jumps there (a scene). Leave a row alone and it follows the record. The lines between the
// stars that are sounding right now are your constellation.
import { h, canvasIn, clamp, hexA } from '../lib/util.js';

const LW = 168, TOP = 92, BOTTOM = 64, HEAD = 26;
const energy = (c) => (c ? clamp((c.rms + 58) / 46, 0.05, 1) : 0);

export default class Stars {
  constructor(app, el) {
    this.app = app; this.el = el;
    el.append(
      h('div', { class: 'world-head' }, h('h2', {}, 'Stars'), h('p', {}, 'Click a star to loop that phrase. Click above a column to move the whole band there. Right-click to silence a row.')),
      h('div', { class: 'world-tools' },
        h('button', { class: 'btn small', onclick: () => this.all({ mode: 'follow' }) }, '↺ Follow the record'),
        h('button', { class: 'btn small', onclick: () => this.surprise() }, '⚂ Surprise me'),
        h('button', { class: 'btn small ghost', onclick: () => this.all({ mode: 'off' }) }, '✕ Silence')),
    );
    this.fill = h('div', { class: 'fill' }); el.append(this.fill);
    this.c = canvasIn(this.fill);
    this.hover = null;
    this.twinkle = Array.from({ length: 90 }, () => [Math.random(), Math.random(), Math.random()]);
    const cv = this.c.cv;
    cv.addEventListener('pointermove', (e) => { this.hover = this.hit(e); cv.style.cursor = this.hover ? 'pointer' : 'default'; });
    cv.addEventListener('pointerleave', () => { this.hover = null; });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('pointerdown', (e) => this.click(this.hit(e), e));
  }

  rows() { const s = this.app.session.state; return s.order.filter((id) => this.app.catalog.get(id)); }
  geom() {
    const { w, h: H } = this.c, n = this.app.song.numCells, rows = this.rows().length;
    const cw = (w - LW - 24) / n, rh = clamp((H - TOP - HEAD - BOTTOM) / Math.max(1, rows), 16, 46);
    return { cw, rh, n, x0: LW, y0: TOP + HEAD };
  }
  hit(e) {
    const r = this.c.cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const { cw, rh, n, x0, y0 } = this.geom(), rows = this.rows();
    if (y >= TOP && y < y0 && x >= x0) { const col = Math.floor((x - x0) / cw); return col < n ? { kind: 'col', col } : null; }
    const row = Math.floor((y - y0) / rh);
    if (row < 0 || row >= rows.length) return null;
    const id = rows[row];
    if (x < x0) return { kind: 'label', id, row, part: x > x0 - 30 ? 'solo' : x > x0 - 58 ? 'mute' : 'name' };
    const col = Math.floor((x - x0) / cw);
    return col < n ? { kind: 'star', id, row, col } : null;
  }
  click(t, e) {
    if (!t) return;
    const { session, catalog, profile, song, toast } = this.app;
    if (t.kind === 'col') {
      if (e.shiftKey) { this.all({ mode: 'follow' }); session.dispatch({ t: 'seek', bar: t.col * song.barsPerCell }); return; }
      const p = {}; for (const id of this.rows()) p[id] = { mode: 'loop', cell: t.col };
      session.dispatch({ t: 'tracks/set', p, g: 'scene' });
      return;
    }
    const src = catalog.get(t.id), tr = session.state.tracks[t.id];
    if (src.locked) return toast({ icon: '🔒', title: 'A hidden sound', text: `To hear it: ${profile.lockHint(src.lock)}.` });
    if (t.kind === 'label') {
      if (t.part === 'mute') return session.dispatch({ t: 'track/set', id: t.id, p: { mute: !tr.mute } });
      if (t.part === 'solo') return session.dispatch({ t: 'track/set', id: t.id, p: { solo: !tr.solo } });
      return session.dispatch({ t: 'track/set', id: t.id, p: { mode: tr.mode === 'off' ? 'follow' : 'off' } });
    }
    if (e.button === 2 || e.altKey) return session.dispatch({ t: 'track/set', id: t.id, p: { mode: tr.mode === 'off' ? 'follow' : 'off' } });
    if (!src.cells[t.col]) return;
    if (tr.mode === 'loop' && tr.cell === t.col) session.dispatch({ t: 'track/set', id: t.id, p: { mode: 'follow' } });
    else session.dispatch({ t: 'track/set', id: t.id, p: { mode: 'loop', cell: t.col } });
  }
  all(p) { const all = {}; for (const id of this.rows()) all[id] = p; this.app.session.dispatch({ t: 'tracks/set', p: all, g: 'all' }); }
  surprise() {
    const { song, catalog } = this.app, secs = song.sections.filter((s) => s.density > 2);
    const p = {};
    for (const id of this.rows()) {
      const src = catalog.get(id);
      const sec = secs[Math.floor(Math.random() * secs.length)] ?? { startCell: 0, endCell: song.numCells };
      const opts = []; for (let c = sec.startCell; c < sec.endCell; c++) if (src.cells[c]) opts.push(c);
      p[id] = opts.length && Math.random() < 0.7 ? { mode: 'loop', cell: opts[Math.floor(Math.random() * opts.length)] } : { mode: 'off' };
    }
    this.app.session.dispatch({ t: 'tracks/set', p, g: 'scene' });
  }

  frame(t) {
    const { g, w, h: H } = this.c, { song, session, player, catalog, engine } = this.app;
    if (w < 80 || H < 80) return; // not laid out yet
    const { cw, rh, n, x0, y0 } = this.geom(), rows = this.rows(), st = session.state;
    g.clearRect(0, 0, w, H);
    for (const [x, y, s] of this.twinkle) { g.fillStyle = `rgba(245,240,255,${0.05 + 0.12 * (0.5 + 0.5 * Math.sin(t * (0.5 + s) + s * 9))})`; g.fillRect(x * w, y * H, 1.2, 1.2); }

    const beat = player.playing ? (engine.ctx.currentTime - player.bar0) / player.beatDur : player.pausedBar * song.beatsPerBar;
    const barF = Math.max(0, beat / song.beatsPerBar), bar = Math.floor(barF), songBar = bar % song.numBars;

    // sections across the top, as a horizon
    for (const s of song.sections) {
      const x = x0 + s.startCell * cw, ww = (s.endCell - s.startCell) * cw;
      g.fillStyle = hexA(song.color, s.name === 'intro' || s.name === 'outro' ? 0.06 : 0.04 + s.density * 0.012);
      g.fillRect(x + 1, TOP, ww - 2, HEAD - 4);
      g.fillStyle = 'rgba(245,240,255,0.6)'; g.font = '600 10px Bricolage Grotesque'; g.fillText(s.name.toUpperCase(), x + 6, TOP + 15);
    }
    if (this.hover?.kind === 'col') { g.fillStyle = 'rgba(255,229,154,0.08)'; g.fillRect(x0 + this.hover.col * cw, TOP, cw, y0 - TOP + rows.length * rh); }

    // follow-the-record playhead
    const px = x0 + (((barF % song.numBars) / song.barsPerCell)) * cw;
    g.strokeStyle = 'rgba(255,229,154,0.35)'; g.lineWidth = 1; g.beginPath(); g.moveTo(px, TOP); g.lineTo(px, y0 + rows.length * rh); g.stroke();

    const lit = [];
    rows.forEach((id, r) => {
      const src = catalog.get(id), tr = st.tracks[id], cy = y0 + r * rh + rh / 2;
      const want = player.resolve(tr, bar);
      const level = engine.channels.get(id)?.readLevel() ?? 0;
      // label
      const isHover = this.hover?.id === id && this.hover.kind === 'label';
      g.globalAlpha = tr.mode === 'off' || tr.mute ? 0.35 : 1;
      g.fillStyle = src.locked ? 'rgba(245,240,255,0.3)' : src.color;
      g.beginPath(); g.arc(14, cy, 4 + Math.min(5, level * 30), 0, 7); g.fill();
      g.fillStyle = isHover && this.hover.part === 'name' ? '#fff' : 'rgba(245,240,255,0.85)';
      g.font = '600 13px Bricolage Grotesque';
      let label = src.locked ? '🔒 ???' : src.name;
      while (label.length > 3 && g.measureText(label).width > x0 - 92) label = label.slice(0, -2) + '…';
      g.fillText(label, 26, cy + 4);
      g.globalAlpha = 1;
      for (const [k, on, x] of [['M', tr.mute, x0 - 52], ['S', tr.solo, x0 - 26]]) {
        g.fillStyle = on ? (k === 'M' ? '#ff8fb1' : '#ffe59a') : 'rgba(245,240,255,0.07)';
        g.beginPath(); g.roundRect(x, cy - 9, 20, 18, 6); g.fill();
        g.fillStyle = on ? '#160f1c' : 'rgba(245,240,255,0.45)'; g.font = '600 10px JetBrains Mono'; g.fillText(k, x + 6.5, cy + 3.5);
      }
      if (r % 2 === 0) { g.fillStyle = 'rgba(255,255,255,0.018)'; g.fillRect(x0, cy - rh / 2, n * cw, rh); }

      // stars
      const ncell = src.kind === 'stem' ? n : src.cells.length;
      for (let c = 0; c < ncell; c++) {
        const cell = src.cells[c]; if (!cell) continue;
        const cx = x0 + c * cw + cw / 2, e = energy(cell);
        const rad = 1.2 + e * Math.min(cw, rh) * 0.36;
        if (src.locked) { g.strokeStyle = 'rgba(245,240,255,0.18)'; g.beginPath(); g.ellipse(cx, cy, rad * 0.7, rad, 0, 0, 7); g.stroke(); continue; }
        const playing = want && want.cell === c && player.playing;
        const queued = tr.mode === 'loop' && tr.cell === c && !playing;
        const hov = this.hover?.kind === 'star' && this.hover.id === id && this.hover.col === c;
        g.fillStyle = hexA(src.color, tr.mode === 'off' ? 0.18 : playing ? 1 : 0.35 + e * 0.35);
        if (playing) { g.shadowColor = src.color; g.shadowBlur = 14 + level * 60; }
        g.beginPath(); star(g, cx, cy, rad * (playing ? 1.25 + level * 1.5 : hov ? 1.3 : 1), playing ? 5 : 4); g.fill();
        g.shadowBlur = 0;
        if (queued) { g.strokeStyle = hexA(src.color, 0.5 + 0.5 * Math.sin(t * 10)); g.lineWidth = 1.5; g.beginPath(); g.arc(cx, cy, rad + 6, 0, 7); g.stroke(); }
        if (tr.mode === 'loop' && tr.cell === c) { g.strokeStyle = hexA(src.color, 0.8); g.lineWidth = 1; g.beginPath(); g.arc(cx, cy, rad + 3.5, 0, 7); g.stroke(); }
        if (playing) lit.push([cx, cy, src.color]);
      }
    });

    // your constellation
    if (lit.length > 1) {
      g.strokeStyle = 'rgba(245,240,255,0.16)'; g.lineWidth = 1; g.beginPath();
      lit.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
    }

    // hover card: the phrase's shape
    const hv = this.hover;
    if (hv?.kind === 'star') {
      const src = catalog.get(hv.id), cell = src.cells[hv.col];
      if (cell && !src.locked) {
        const bx = Math.min(w - 190, x0 + hv.col * cw + cw), by = Math.max(TOP, y0 + hv.row * rh - 70);
        g.fillStyle = 'rgba(17,21,43,0.95)'; g.strokeStyle = 'rgba(245,240,255,0.12)';
        g.beginPath(); g.roundRect(bx, by, 176, 64, 10); g.fill(); g.stroke();
        g.fillStyle = src.color;
        cell.wave.forEach((v, i) => { const a = (v / 99) * 18; g.fillRect(bx + 8 + i * 2.5, by + 40 - a, 1.6, a * 2 + 1); });
        g.fillStyle = 'rgba(245,240,255,0.7)'; g.font = '10px JetBrains Mono';
        g.fillText(`${src.name} · bars ${hv.col * song.barsPerCell + 1}–${(hv.col + 1) * song.barsPerCell}`, bx + 8, by + 14);
      }
    }
    g.fillStyle = 'rgba(245,240,255,0.32)'; g.font = '11px Bricolage Grotesque';
    g.fillText('shift-click above a column: jump the record there · M mute · S solo', x0, H - 24);
  }
}

function star(g, x, y, r, points) {
  const inner = r * 0.45;
  for (let i = 0; i < points * 2; i++) {
    const a = (i * Math.PI) / points - Math.PI / 2, rr = i % 2 ? inner : r;
    i ? g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) : g.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
}
