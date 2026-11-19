// The studio's moving parts that are not screens: settings that the sequencer can record, the sources cut from the
// stems, the instruments built from them, and the textures rack on the master.

// --------------------------------------------------------------------------------------------- settings
// Every knob in the studio is a path ("cloud.size", "fx.res.mix" …). Setting one updates the sound, every control
// showing it, and — while the sequencer records — the current variation.
export class Params extends EventTarget {
  constructor() { super(); this.v = {}; this.def = {}; this.apply = {}; this.recorder = null; }
  define(path, def, apply) { this.def[path] = def; if (!(path in this.v)) this.v[path] = def; if (apply) this.apply[path] = apply; apply?.(this.v[path]); }
  get(path) { return this.v[path]; }
  set(path, value, { by = 'user', at } = {}) {
    if (this.v[path] === value) return;
    this.v[path] = value;
    this.apply[path]?.(value, at);
    if (by === 'user') this.recorder?.(path, value);
    this.dispatchEvent(new CustomEvent('change', { detail: { path, value, by } }));
  }
  reset(path) { this.set(path, this.def[path]); }
  on(fn) { const h = (e) => fn(e.detail); this.addEventListener('change', h); return h; }
  dump() { return { ...this.v }; }
  load(v) { for (const [k, x] of Object.entries(v || {})) if (k in this.def) this.set(k, x, { by: 'load' }); }
}

// --------------------------------------------------------------------------------------------- sources
// A source is a stretch of one stem, decoded into one stereo buffer (cells are 4 bars each).
export async function loadSource(studio, stemId, fromCell, toCell) {
  const st = studio.song.stems.find((s) => s.id === stemId);
  if (!st) throw new Error('No such stem');
  const cells = [];
  for (let c = fromCell; c < toCell; c++) cells.push(st.cells[c] ? studio.loader.ensure(st.cells[c].url).catch(() => null) : Promise.resolve(null));
  const bufs = await Promise.all(cells);
  const cellLen = Math.round(studio.song.cellDur * studio.ctx.sampleRate), n = cellLen * bufs.length;
  const L = new Float32Array(n), R = new Float32Array(n);
  bufs.forEach((b, i) => { if (!b) return; L.set(b.getChannelData(0).subarray(0, cellLen), i * cellLen); R.set((b.numberOfChannels > 1 ? b.getChannelData(1) : b.getChannelData(0)).subarray(0, cellLen), i * cellLen); });
  return { stemId, name: st.name, fromCell, toCell, L, R, sr: studio.ctx.sampleRate, dur: n / studio.ctx.sampleRate };
}
/** The loudest stretch of a stem — a good first source. */
export function loudestCells(stem, count = 2) {
  let best = 0, bestV = -1e9;
  for (let c = 0; c + count <= stem.cells.length; c++) {
    let v = 0; for (let k = 0; k < count; k++) v += stem.cells[c + k] ? 10 ** (stem.cells[c + k].rms / 20) : 0;
    if (v > bestV) { bestV = v; best = c; }
  }
  return [best, best + count];
}
/** Where in a source the loudest stretch of the given width starts (0..1). */
export function loudestWindow(src, width = 0.08) {
  const n = 400, e = new Float32Array(n), L = src.L, step = L.length / n;
  for (let i = 0; i < n; i++) { let s = 0; for (let j = Math.floor(i * step), k = Math.floor((i + 1) * step); j < k; j += 8) s += L[j] * L[j]; e[i] = s; }
  const w = Math.max(1, Math.round(width * n)); let best = 0, bv = -1, run = 0;
  for (let i = 0; i < n; i++) { run += e[i] - (i >= w ? e[i - w] : 0); if (i >= w - 1 && run > bv) { bv = run; best = i - w + 1; } }
  return best / n;
}
export function sliceOf(src, a, b) {
  const i0 = Math.floor(Math.min(a, b) * src.L.length), i1 = Math.max(i0 + 64, Math.floor(Math.max(a, b) * src.L.length));
  return { L: src.L.slice(i0, i1), R: src.R.slice(i0, i1), sr: src.sr };
}

// --------------------------------------------------------------------------------------------- instruments
export const midiHz = (m) => 440 * 2 ** ((m - 69) / 12);

/** Granular cloud over a source; every held note is its own stream of grains, transposed. */
export class CloudVoice {
  constructor(studio, out) {
    this.node = new AudioWorkletNode(studio.ctx, 'granulator', { numberOfInputs: 0, outputChannelCount: [2] });
    this.node.connect(out); this.root = 60; this.view = { pos: 0, grains: [], voices: 0 };
    this.node.port.onmessage = (e) => { this.view = e.data; };
  }
  setSource(src) { this.node.port.postMessage({ buf: [src.L, src.R] }); }
  set(p) { this.node.port.postMessage({ p }); }
  noteOn(id, note, vel, at) { this.node.port.postMessage({ on: id, semis: note - this.root, vel, at }); }
  noteOff(id, at) { this.node.port.postMessage({ off: id, at }); }
  panic() { this.node.port.postMessage({ panic: true }); }
}

/** A slice played as a sampler: pitched across the keys, a sustain loop, envelope and a filter. */
export class SamplerVoice {
  constructor(studio, out) { this.ctx = studio.ctx; this.out = out; this.buf = null; this.notes = new Map(); this.root = 60;
    this.p = { attack: 0.005, release: 0.4, loop: true, cutoff: 0.8, res: 0.2, env: 0.3, level: 0.8, glide: 0, reverse: false }; }
  setSlice(sl) {
    const make = (rev) => { const b = this.ctx.createBuffer(2, sl.L.length, sl.sr); const L = b.getChannelData(0), R = b.getChannelData(1);
      if (rev) for (let i = 0, n = sl.L.length; i < n; i++) { L[i] = sl.L[n - 1 - i]; R[i] = sl.R[n - 1 - i]; } else { L.set(sl.L); R.set(sl.R); } return b; };
    this.buf = make(false); this.rbuf = make(true);
  }
  set(p) { Object.assign(this.p, p); }
  noteOn(id, note, vel, at) {
    if (!this.buf) return; const c = this.ctx, t = Math.max(at ?? 0, c.currentTime), p = this.p;
    const src = c.createBufferSource(); src.buffer = p.reverse ? this.rbuf : this.buf; src.playbackRate.value = 2 ** ((note - this.root) / 12);
    if (p.loop) { src.loop = true; src.loopStart = src.buffer.duration * 0.25; src.loopEnd = src.buffer.duration * 0.92; }
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 0.5 + p.res * 14;
    const base = 60 * 330 ** p.cutoff; f.frequency.setValueAtTime(base, t); f.frequency.setTargetAtTime(Math.min(20000, base * (1 + p.env * 8)), t, 0.01); f.frequency.setTargetAtTime(base, t + 0.05, 0.25);
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vel * p.level, t + p.attack);
    src.connect(f).connect(g).connect(this.out); src.start(t);
    if (!p.loop) src.onended = () => { g.disconnect(); };
    this.notes.set(id, { src, g });
  }
  noteOff(id, at) {
    const v = this.notes.get(id); if (!v) return; this.notes.delete(id);
    const t = Math.max(at ?? 0, this.ctx.currentTime), r = this.p.release;
    v.g.gain.cancelScheduledValues(t); v.g.gain.setValueAtTime(v.g.gain.value, t); v.g.gain.setTargetAtTime(0, t, r / 4); v.src.stop(t + r * 1.6 + 0.05);
  }
  panic() { for (const id of [...this.notes.keys()]) this.noteOff(id); }
}

/** Strings: a slice of the stem is the bow/pluck; tuned delay lines are the strings it sets ringing. */
export class StringsVoice {
  constructor(studio, out) { this.node = new AudioWorkletNode(studio.ctx, 'strings', { numberOfInputs: 0, outputChannelCount: [2] }); this.node.connect(out); }
  setSlice(sl) { const n = Math.min(sl.L.length, sl.sr * 1.5), ex = new Float32Array(n); for (let i = 0; i < n; i++) ex[i] = (sl.L[i] + sl.R[i]) * 0.5; let pk = 0; for (const x of ex) pk = Math.max(pk, Math.abs(x)); if (pk > 1e-4) for (let i = 0; i < n; i++) ex[i] /= pk; this.node.port.postMessage({ ex }); }
  set(p) { this.node.port.postMessage({ p }); }
  noteOn(id, note, vel, at) { this.node.port.postMessage({ on: id, freq: midiHz(note), vel, at }); }
  noteOff(id, at) { this.node.port.postMessage({ off: id, at }); }
  panic() { this.node.port.postMessage({ panic: true }); }
}

// --------------------------------------------------------------------------------------------- textures (master rack)
export function buildTextures(studio) {
  const c = studio.ctx, eng = studio.engine, P = studio.params;
  const g = (v = 1) => { const n = c.createGain(); n.gain.value = v; return n; };
  const input = g(), output = g();
  // filter
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 20000;
  const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 18;
  // tape: wow and flutter on a short delay, then saturation
  const tapeDly = c.createDelay(0.1); tapeDly.delayTime.value = 0.012;
  const wow = c.createOscillator(), wowG = g(0), flut = c.createOscillator(), flutG = g(0); wow.frequency.value = 0.55; flut.frequency.value = 6.3;
  wow.connect(wowG).connect(tapeDly.delayTime); flut.connect(flutG).connect(tapeDly.delayTime); wow.start(); flut.start();
  const sat = c.createWaveShaper(); const curve = (k) => { const n = 2048, cv = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; cv[i] = Math.tanh(x * (1 + k * 6)) / Math.tanh(1 + k * 6); } return cv; };
  sat.curve = curve(0); sat.oversample = '2x';
  const tapeDry = g(1), tapeWet = g(0), tapeSum = g();
  // resonators
  const res = new AudioWorkletNode(c, 'resonators', { outputChannelCount: [2] });
  // shimmer: reverb whose tail is pitched up an octave and fed back in
  const shIn = g(0), conv = c.createConvolver(), shOut = g(0), shFb = g(0), shift = new AudioWorkletNode(c, 'shifter', { outputChannelCount: [2] });
  conv.buffer = eng.reverb.buffer;
  const shLong = c.createConvolver(); shLong.buffer = makeHall(c, 7);
  // granular freeze-delay is the Cloud; here: a repeat (hold) and the old crusher
  const rep = new AudioWorkletNode(c, 'repeat', { outputChannelCount: [2] });
  const crush = new AudioWorkletNode(c, 'crusher', { outputChannelCount: [2] });

  input.connect(hp).connect(lp);
  lp.connect(tapeDry).connect(tapeSum); lp.connect(tapeDly).connect(sat).connect(tapeWet).connect(tapeSum);
  tapeSum.connect(res);
  res.connect(rep); res.connect(shIn).connect(shLong); shLong.connect(shOut).connect(rep); shLong.connect(shift).connect(shFb).connect(shLong);
  rep.connect(crush).connect(output);

  const resFreqs = () => { const root = midiHz(36 + P.get('fx.res.root')), ch = CHORDS[P.get('fx.res.chord')] || CHORDS.fifths; return ch.map((s) => root * 2 ** (s / 12)); };
  const t = () => c.currentTime;
  P.define('fx.filter.lp', 1, (v) => lp.frequency.setTargetAtTime(60 * 333 ** v, t(), 0.03));
  P.define('fx.filter.hp', 0, (v) => hp.frequency.setTargetAtTime(18 * 120 ** v, t(), 0.03));
  P.define('fx.filter.q', 0.15, (v) => { lp.Q.setTargetAtTime(0.5 + v * 16, t(), 0.03); hp.Q.setTargetAtTime(0.5 + v * 10, t(), 0.03); });
  P.define('fx.tape.mix', 0, (v) => { tapeWet.gain.setTargetAtTime(v, t(), 0.05); tapeDry.gain.setTargetAtTime(1 - v, t(), 0.05); });
  P.define('fx.tape.wow', 0.4, (v) => wowG.gain.setTargetAtTime(v * 0.004, t(), 0.05));
  P.define('fx.tape.flutter', 0.25, (v) => flutG.gain.setTargetAtTime(v * 0.0006, t(), 0.05));
  P.define('fx.tape.drive', 0.35, (v) => { sat.curve = curve(v); });
  P.define('fx.res.mix', 0, (v) => res.port.postMessage({ p: { mix: v } }));
  P.define('fx.res.decay', 0.6, (v) => res.port.postMessage({ p: { decay: 0.9 + v * 0.0995 } }));
  P.define('fx.res.bright', 0.5, (v) => res.port.postMessage({ p: { bright: v } }));
  P.define('fx.res.root', 9, () => res.port.postMessage({ p: { freqs: resFreqs() } }));
  P.define('fx.res.chord', 'fifths', () => res.port.postMessage({ p: { freqs: resFreqs() } }));
  P.define('fx.shim.mix', 0, (v) => { shIn.gain.setTargetAtTime(v * 0.8, t(), 0.05); shOut.gain.setTargetAtTime(v * 0.9, t(), 0.05); });
  P.define('fx.shim.rise', 0.35, (v) => shFb.gain.setTargetAtTime(v * 0.55, t(), 0.05));
  P.define('fx.shim.interval', 12, (v) => shift.port.postMessage({ ratio: 2 ** (v / 12) }));
  P.define('fx.crush.mix', 0, (v) => crush.parameters.get('mix').setValueAtTime(v, t()));
  P.define('fx.crush.bits', 0.5, (v) => crush.parameters.get('bits').setValueAtTime(16 - v * 13, t()));
  P.define('fx.crush.down', 0.3, (v) => crush.parameters.get('down').setValueAtTime(1 + v * 30, t()));
  return { input, output, repeat: (div) => rep.port.postMessage(div ? { on: true, len: studio.song.beatDur * div, decay: 0.98 } : { off: true }) };
}
export const CHORDS = { fifths: [0, 7, 12, 19, 24, 31], major: [0, 4, 7, 12, 16, 19], minor: [0, 3, 7, 12, 15, 19], sus: [0, 5, 7, 12, 17, 19], cluster: [0, 2, 3, 7, 10, 14], open: [0, 7, 14, 21, 28, 35] };
function makeHall(ctx, seconds) {
  const len = Math.round(seconds * ctx.sampleRate), ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); let lp = 0; for (let i = 0; i < len; i++) { const tt = i / ctx.sampleRate; lp += (Math.random() * 2 - 1 - lp) * (0.25 + 0.6 * (1 - tt / seconds)); d[i] = lp * Math.exp(-tt * 5 / seconds) * Math.min(1, i / (0.03 * ctx.sampleRate)); } }
  return ir;
}

// --------------------------------------------------------------------------------------------- sequencer
// Variations A–D, each a loop of N bars holding notes and moves (no audio). Recording overdubs onto the current one;
// "chain" plays the variations that have something in them, one loop each, in order.
export class Sequencer extends EventTarget {
  constructor(studio) {
    super(); this.s = studio; this.vars = { A: [], B: [], C: [], D: [] }; this.cur = 'A'; this.bars = 4;
    this.rec = false; this.on = true; this.chain = false; this.quant = 0.25; this.touched = new Set(); this.last = -1; this.held = new Map();
    this.pass = 0; this.mute = new Set();
    setInterval(() => this.tick(), 25);
  }
  get beats() { return this.bars * this.s.song.beatsPerBar; }
  loopBeat() { const p = this.s.player; return p.playing ? ((p.beatNow() % this.beats) + this.beats) % this.beats : null; }
  q(b) { return this.quant ? Math.round(b / this.quant) * this.quant % this.beats : b; }
  noteIn(slot, note, vel, on) {
    if (!this.rec || !this.s.player.playing) return;
    const b = this.loopBeat(), key = slot + ':' + note;
    if (on) this.held.set(key, { k: 'n', slot, note, vel: +vel.toFixed(2), b: +this.q(b).toFixed(3), d: this.quant || 0.25, start: b, p: this.pass });
    else { const e = this.held.get(key); if (!e) return; this.held.delete(key); let d = b - e.start; if (d <= 0) d += this.beats; e.d = +Math.max(this.quant || 0.1, this.quant ? Math.round(d / this.quant) * this.quant : d).toFixed(3); delete e.start; this.vars[this.cur].push(e); this.emit(); }
  }
  moveIn(path, value) {
    if (!this.rec || !this.s.player.playing || typeof value !== 'number') return;
    const b = +this.loopBeat().toFixed(3), list = this.vars[this.cur];
    this.touched.add(path);
    // replace this path's older moves within a beat of here, so a re-recorded gesture overwrites, not stacks
    // the gesture being drawn now replaces what earlier passes left on this path, here; its own points all stay
    const last = this.lastMove?.[path];
    for (let i = list.length - 1; i >= 0; i--) { const e = list[i]; if (e.k !== 'm' || e.path !== path || e.p === this.pass) continue; const lo = last && last.p === this.pass ? last.b : b - 0.25; if (lo <= b ? e.b >= lo && e.b <= b + 0.01 : e.b >= lo || e.b <= b + 0.01) list.splice(i, 1); }
    // thin a fast gesture to about 1/32 of a beat
    if (last && last.p === this.pass && Math.abs(b - last.b) < 0.03) { last.v = +value.toFixed(4); this.emit(); return; }
    const ev = { k: 'm', path, v: +value.toFixed(4), b, p: this.pass }; list.push(ev); (this.lastMove ??= {})[path] = ev;
    this.emit();
  }
  clear(which = this.cur) { this.vars[which] = []; this.emit(); }
  clearLane(lane) { this.vars[this.cur] = this.vars[this.cur].filter((e) => (lane === 'm' ? e.k !== 'm' : !(e.k === 'n' && e.slot === lane))); this.emit(); }
  arm(on) { this.rec = on; if (on) { this.pass = (this.pass || 0) + 1; this.lastMove = {}; } this.emit(); }
  tick() {
    const p = this.s.player; if (!p.playing || !this.on) { this.last = -1; return; }
    const now = p.ctx.currentTime, la = 0.12, B = this.beats;
    const beatAbs = (t) => (t - p.bar0) / p.beatDur;
    const from = this.last < 0 ? beatAbs(now) : this.last, to = beatAbs(now + la);
    if (to <= from) return;
    // chaining: at every loop start move to the next variation that has content
    const loopsFrom = Math.floor(from / B), loopsTo = Math.floor(to / B);
    if (this.chain && loopsTo > loopsFrom && !this.rec) { const order = 'ABCD'.split('').filter((k) => this.vars[k].length); if (order.length) { const i = order.indexOf(this.cur); this.cur = order[(i + 1) % order.length]; this.emit(); } }
    const list = this.vars[this.cur];
    for (let loop = loopsFrom; loop <= loopsTo; loop++) {
      for (const e of list) {
        const ab = loop * B + e.b; if (ab < from || ab >= to) continue;
        const at = p.bar0 + ab * p.beatDur;
        if (e.k === 'n') { const ins = this.s.slots[e.slot]; if (!ins || this.mute.has(e.slot)) continue; const id = `q${e.slot}:${e.note}:${ab}`; ins.voice.noteOn(id, e.note, e.vel, at); ins.voice.noteOff(id, at + e.d * p.beatDur); this.s.flashNote?.(e.slot, e.note, at, e.d * p.beatDur); }
        else if (!this.mute.has('m') && !(this.rec && this.touched.has(e.path))) setTimeout(() => this.s.params.set(e.path, e.v, { by: 'seq' }), Math.max(0, (at - now) * 1000));
      }
    }
    if (loopsTo > loopsFrom) { this.touched.clear(); if (this.rec) { this.pass++; this.lastMove = {}; } }
    this.last = to;
  }
  dump() { return { vars: this.vars, cur: this.cur, bars: this.bars, quant: this.quant, chain: this.chain }; }
  load(d) { if (!d) return; Object.assign(this, { vars: { A: [], B: [], C: [], D: [], ...d.vars }, cur: d.cur || 'A', bars: d.bars || 4, quant: d.quant ?? 0.25, chain: !!d.chain }); this.emit(); }
  emit() { this.dispatchEvent(new Event('change')); }
}
