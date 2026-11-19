// CHOP — any phrase of any musician, cut into 16 beats and laid out as arcade pads under your fingers
// (1 2 3 4 / q w e r / a s d f / z x c v). Play them live, or write them into the 16-step lane and let the
// machine play. With REC on, whatever you hit lands on the nearest step.
import { h, clamp, hexA } from '../lib/util.js';

const KEYS = ['1', '2', '3', '4', 'q', 'w', 'e', 'r', 'a', 's', 'd', 'f', 'z', 'x', 'c', 'v'];
const energy = (c) => (c ? clamp((c.rms + 58) / 46, 0.1, 1) : 0);

export default class Chop {
  constructor(app, el) {
    this.app = app; this.el = el; this.sel = 0; this.write = false; this.quant = true;
    const { session, player } = app;
    this.trackSel = h('select', { onchange: () => this.pick(this.trackSel.value, null) });
    this.strip = h('div', { class: 'cellstrip' });
    this.pitch = h('input', { type: 'range', min: -12, max: 12, step: 1, value: 0, oninput: () => this.set({ pitch: +this.pitch.value }) });
    this.len = h('select', { onchange: () => this.set({ len: +this.len.value }) },
      [['0.25', '1/16'], ['0.5', '1/8'], ['1', '1 beat'], ['2', '2 beats'], ['4', '1 bar']].map(([v, l]) => h('option', { value: v }, l)));
    this.vol = h('input', { type: 'range', min: 0, max: 1.5, step: 0.01, value: 1, oninput: () => this.set({ gain: +this.vol.value }) });
    this.btn = {
      reverse: h('button', { class: 'btn small', onclick: () => this.set({ reverse: !session.state.chop.reverse }) }, '⇄ Reverse'),
      choke: h('button', { class: 'btn small', onclick: () => this.set({ choke: !session.state.chop.choke }) }, '✂ Choke'),
      seq: h('button', { class: 'btn small', onclick: () => this.set({ seq: !session.state.chop.seq }) }, '▶ Steps'),
      write: h('button', { class: 'btn small rec', onclick: () => { this.write = !this.write; this.paint(); } }, '● Write'),
      quant: h('button', { class: 'btn small', onclick: () => { this.quant = !this.quant; this.paint(); } }, '⌗ Quantise'),
      clear: h('button', { class: 'btn small ghost', onclick: () => this.set({ steps: Array(16).fill(-1) }) }, 'Clear'),
      dice: h('button', { class: 'btn small ghost', onclick: () => this.dice() }, '⚂ Pattern'),
      mute: h('button', { class: 'btn small ghost', onclick: () => this.muteSource() }, 'Mute source'),
    };
    this.pads = KEYS.map((k, i) => {
      const cv = h('canvas', { width: 220, height: 220 });
      const b = h('button', { class: 'pad', onpointerdown: (e) => { e.preventDefault(); this.hit(i); } }, cv, h('span', { class: 'k' }, k.toUpperCase()));
      return { b, cv };
    });
    this.steps = Array.from({ length: 16 }, (_, i) => h('button', { class: 'step', onclick: () => this.toggleStep(i), oncontextmenu: (e) => { e.preventDefault(); this.setStep(i, -1); } }));
    el.append(
      h('div', { class: 'world-head' }, h('h2', {}, 'Chop'), h('p', {}, 'Pick a musician and a phrase; its 16 beats become pads. Keys 1–4, Q–R, A–F, Z–V. Write them into the steps and let it run.')),
      h('div', { class: 'chop' },
        h('div', { class: 'chop-side' },
          h('div', { class: 'tiny faint' }, 'musician'), this.trackSel,
          h('div', { class: 'tiny faint' }, 'phrase'), this.strip,
          h('div', { class: 'chop-row', style: { justifyContent: 'flex-start' } }, this.btn.reverse, this.btn.choke, this.btn.mute),
          h('label', { class: 'dim' }, 'pitch ', this.pitch), h('label', { class: 'dim' }, 'length ', this.len), h('label', { class: 'dim' }, 'volume ', this.vol)),
        h('div', { class: 'chop-main' },
          h('div', { class: 'pads' }, this.pads.map((p) => p.b)),
          h('div', { class: 'chop-row' }, this.btn.seq, this.btn.write, this.btn.quant, this.btn.dice, this.btn.clear),
          h('div', { class: 'steps' }, this.steps))),
    );
    this.onKey = (e) => {
      if (e.target.closest('input, select, textarea') || e.metaKey || e.ctrlKey || e.repeat) return;
      const i = KEYS.indexOf(e.key.toLowerCase());
      if (i >= 0) { e.preventDefault(); this.hit(i); }
    };
    session.on(({ a, prev, state }) => { if (prev.chop !== state.chop || a.t === 'track/add' || a.t === 'unlock' || a.t === 'state/load') this.paint(); });
    player.on('pad', ({ pad, time }) => {
      if (!this.el.classList.contains('active')) return;
      setTimeout(() => { const b = this.pads[pad]?.b; if (!b) return; b.classList.add('hit'); setTimeout(() => b.classList.remove('hit'), 90); }, Math.max(0, (time - app.engine.ctx.currentTime) * 1000));
    });
    app.loader.onload = () => this.drawPads();
    if (!session.state.chop.track) {
      const first = session.state.order.find((id) => { const c = app.catalog.get(id); return c && !c.locked && c.group === 'rhythm'; }) ?? session.state.order[0];
      const src = app.catalog.get(first);
      const best = src.cells.reduce((b, c, i) => (c && (!src.cells[b] || c.rms > src.cells[b].rms) ? i : b), 0);
      this.pick(first, best, { log: false });
    }
    this.paint();
  }

  show() { addEventListener('keydown', this.onKey); this.paint(); }
  hide() { removeEventListener('keydown', this.onKey); }
  set(p) { this.app.session.dispatch({ t: 'chop/set', p }); }

  pick(trackId, cell, opts) {
    const src = this.app.catalog.get(trackId);
    if (cell === null) cell = src.cells.findIndex(Boolean);
    this.app.session.dispatch({ t: 'chop/set', p: { track: trackId, cell: Math.max(0, cell) } }, opts);
  }

  hit(i) {
    const { session, player, engine } = this.app;
    this.sel = i;
    const c = session.state.chop;
    let at, atBeat;
    if (this.quant && player.playing) {
      const songBeat = (engine.ctx.currentTime + 0.01 - player.bar0) / player.beatDur;
      const step = Math.ceil(songBeat * 4 - 0.25);   // within a 1/16 behind → right now; otherwise the next step
      at = Math.max(engine.ctx.currentTime + 0.003, player.bar0 + step * player.stepDur);
      atBeat = (at - player.clockOrigin) / player.beatDur;
      if (this.write) this.setStep(((step % 16) + 16) % 16, i);
    } else if (this.write && player.playing) {
      const step = Math.round((engine.ctx.currentTime - player.bar0) / player.stepDur);
      this.setStep(((step % 16) + 16) % 16, i);
    }
    session.dispatch({ t: 'pad', i, at, atBeat });
    if (!c.track) return;
    this.paintSel();
  }
  setStep(i, v) { const steps = [...this.app.session.state.chop.steps]; steps[i] = v; this.set({ steps }); }
  toggleStep(i) { const s = this.app.session.state.chop.steps[i]; this.setStep(i, s === this.sel ? -1 : this.sel); }
  dice() {
    // a groove, not noise: downbeats favour the low pads, offbeats the high ones, with space left in
    const steps = Array.from({ length: 16 }, (_, i) => {
      const strong = i % 4 === 0, p = strong ? 0.85 : i % 2 === 0 ? 0.45 : 0.28;
      if (Math.random() > p) return -1;
      return strong ? Math.floor(Math.random() * 6) : 4 + Math.floor(Math.random() * 12);
    });
    this.set({ steps, seq: true });
  }
  muteSource() {
    const { session } = this.app, id = session.state.chop.track, tr = session.state.tracks[id];
    if (tr) session.dispatch({ t: 'track/set', id, p: { mute: !tr.mute } });
  }

  paint() {
    const { session, catalog } = this.app, c = session.state.chop;
    const ids = session.state.order.filter((id) => { const s = catalog.get(id); return s && !s.locked; });
    if (this.trackSel.options.length !== ids.length) this.trackSel.replaceChildren(...ids.map((id) => h('option', { value: id }, catalog.get(id).name)));
    if (c.track) this.trackSel.value = c.track;
    const src = catalog.get(c.track);
    if (src) {
      this.el.style.setProperty('--tc', src.color);
      this.strip.replaceChildren(...src.cells.map((cell, i) => h('button', {
        class: (cell ? 'has' : '') + (i === c.cell ? ' sel' : ''), style: { '--e': energy(cell), '--tc': src.color }, disabled: !cell,
        title: `bars ${i * this.app.song.barsPerCell + 1}–${(i + 1) * this.app.song.barsPerCell}`, onclick: () => this.pick(c.track, i),
      }, String(i + 1))));
    }
    this.pitch.value = c.pitch; this.len.value = String(c.len); this.vol.value = c.gain;
    this.btn.reverse.classList.toggle('on', c.reverse); this.btn.choke.classList.toggle('on', c.choke); this.btn.seq.classList.toggle('on', c.seq);
    this.btn.write.classList.toggle('on', this.write); this.btn.quant.classList.toggle('on', this.quant);
    this.btn.mute.textContent = session.state.tracks[c.track]?.mute ? 'Unmute source' : 'Mute source';
    this.steps.forEach((s, i) => { const v = c.steps[i]; s.classList.toggle('on', v >= 0); s.textContent = v >= 0 ? KEYS[v].toUpperCase() : ''; });
    this.drawPads();
    this.paintSel();
  }
  paintSel() { this.pads.forEach((p, i) => p.b.classList.toggle('sel', i === this.sel)); }

  drawPads() {
    const { session, catalog, loader } = this.app, c = session.state.chop, src = catalog.get(c.track);
    const url = src?.cells[c.cell]?.url, buf = url && loader.get(url);
    if (url && !buf) loader.load(url);
    const key = `${url}|${c.reverse}|${!!buf}`;
    if (key === this.drawn) return; this.drawn = key;
    const color = src?.color ?? '#ffb59e';
    this.pads.forEach(({ cv }, i) => {
      const g = cv.getContext('2d'); g.clearRect(0, 0, 220, 220);
      if (!buf) return;
      // pad i is always beat i of the phrase; reversed it plays (and is drawn) back to front
      const d = buf.getChannelData(0), n = d.length / 16, s0 = i * n;
      const peaks = new Float32Array(200);
      for (let x = 0; x < 200; x++) {
        let m = 0; for (let k = Math.floor(s0 + (x / 200) * n), e = s0 + ((x + 1) / 200) * n; k < e; k += 4) m = Math.max(m, Math.abs(d[k] ?? 0));
        peaks[c.reverse ? 199 - x : x] = m;
      }
      const pk = Math.max(0.0001, ...peaks);
      g.fillStyle = hexA(color, 0.75);
      peaks.forEach((m, x) => { const hh = (m / pk) * 70; g.fillRect(10 + x, 130 - hh, 1, hh * 2 + 1); });
    });
  }

  frame() {
    const { player, engine } = this.app;
    const step = player.playing ? ((Math.floor((engine.ctx.currentTime - player.bar0) / player.stepDur) % 16) + 16) % 16 : -1;
    if (step !== this.lastStep) { this.steps[this.lastStep]?.classList.remove('now'); this.steps[step]?.classList.add('now'); this.lastStep = step; }
  }
}
