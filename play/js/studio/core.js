import { onTick } from '../lib/ticker.js';

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
    const g = c.createGain(); g.gain.value = 0; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vel * p.level, t + p.attack);
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
// gate → filter (with a tempo LFO) → tape (with age) → resonators → shimmer (parallel) → echo → repeat → crush → width
export function buildTextures(studio) {
  const c = studio.ctx, eng = studio.engine, P = studio.params, player = studio.player;
  const g = (v = 1) => { const n = c.createGain(); n.gain.value = v; return n; };
  const t = () => c.currentTime;
  const input = g(), output = g();
  // gate
  const gate = new AudioWorkletNode(c, 'gate', { outputChannelCount: [2] });
  // filter + LFO
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 20000;
  const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 18;
  const lfoG = g(0); lfoG.connect(lp.detune); let lfo = null;
  // tape: wow and flutter on a short delay, saturation, age (darker, with hiss)
  const tapeDly = c.createDelay(0.1); tapeDly.delayTime.value = 0.012;
  const wow = c.createOscillator(), wowG = g(0), flut = c.createOscillator(), flutG = g(0); wow.frequency.value = 0.55; flut.frequency.value = 6.3;
  wow.connect(wowG).connect(tapeDly.delayTime); flut.connect(flutG).connect(tapeDly.delayTime); wow.start(); flut.start();
  const sat = c.createWaveShaper(); const curve = (k) => { const n = 2048, cv = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; cv[i] = Math.tanh(x * (1 + k * 6)) / Math.tanh(1 + k * 6); } return cv; };
  sat.curve = curve(0); sat.oversample = '2x';
  const age = c.createBiquadFilter(); age.type = 'lowpass'; age.frequency.value = 18000;
  const tapeDry = g(1), tapeWet = g(0), tapeSum = g();
  const noise = c.createBuffer(2, c.sampleRate * 2, c.sampleRate); for (let ch = 0; ch < 2; ch++) { const d = noise.getChannelData(ch); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  const hiss = c.createBufferSource(); hiss.buffer = noise; hiss.loop = true; const hissF = c.createBiquadFilter(); hissF.type = 'bandpass'; hissF.frequency.value = 4200; hissF.Q.value = 0.4; const hissG = g(0);
  hiss.connect(hissF).connect(hissG).connect(tapeSum); hiss.start();
  // resonators
  const res = new AudioWorkletNode(c, 'resonators', { outputChannelCount: [2] });
  // shimmer: reverb whose tail is pitched up and fed back in
  const halls = { 3: makeHall(c, 3), 7: makeHall(c, 7), 14: makeHall(c, 14) };
  const shIn = g(0), shOut = g(0), shFb = g(0), shift = new AudioWorkletNode(c, 'shifter', { outputChannelCount: [2] });
  const shLong = c.createConvolver(); shLong.buffer = halls[7];
  const shTone = c.createBiquadFilter(); shTone.type = 'lowpass'; shTone.frequency.value = 9000;
  const mid = g();
  // echo: ping-pong, filtered feedback, spin = how far apart the two sides sit
  const eIn = g(0), eL = c.createDelay(4), eR = c.createDelay(4), eFb = g(0.45), eLo = c.createBiquadFilter(), eHi = c.createBiquadFilter(), eOut = g(0.9);
  eLo.type = 'lowpass'; eHi.type = 'highpass'; eHi.frequency.value = 160;
  const panL = c.createStereoPanner(), panR = c.createStereoPanner();
  const post = g();
  // ensemble: three slowly drifting delay voices spread across the stereo field (chorus; vibrato when dry is off)
  const ensIn = g(), ensDry = g(1), ensWet = g(0), ensOut = g();
  const ens = [0, 1, 2].map((i) => { const d = c.createDelay(0.1); d.delayTime.value = 0.011 + i * 0.0065; const o = c.createOscillator(); o.frequency.value = 0.5; const og = g(0.002); o.connect(og).connect(d.delayTime); o.start(c.currentTime + i * 0.37); const pn = c.createStereoPanner(); pn.pan.value = (i - 1) * 0.7; ensIn.connect(d).connect(pn).connect(ensWet); return { d, o, og, pn }; });
  ensIn.connect(ensDry).connect(ensOut); ensWet.connect(ensOut);
  // repeat, crush, width
  const rep = new AudioWorkletNode(c, 'repeat', { outputChannelCount: [2] });
  const crush = new AudioWorkletNode(c, 'crusher', { outputChannelCount: [2] });
  const split = c.createChannelSplitter(2), merge = c.createChannelMerger(2), wLL = g(1), wRL = g(0), wLR = g(0), wRR = g(1);

  input.connect(gate).connect(hp).connect(lp);
  lp.connect(tapeDry).connect(tapeSum); lp.connect(tapeDly).connect(sat).connect(age).connect(tapeWet).connect(tapeSum);
  tapeSum.connect(res);
  res.connect(mid); res.connect(shIn).connect(shLong); shLong.connect(shTone).connect(shOut).connect(mid); shLong.connect(shift).connect(shFb).connect(shLong);
  mid.connect(post); mid.connect(eIn).connect(eL); eL.connect(eR); eR.connect(eLo).connect(eHi).connect(eFb).connect(eL);
  eL.connect(panL).connect(eOut); eR.connect(panR).connect(eOut); eOut.connect(post);
  post.connect(ensIn); ensOut.connect(rep).connect(crush).connect(split);
  split.connect(wLL, 0); split.connect(wRL, 1); split.connect(wLR, 0); split.connect(wRR, 1);
  wLL.connect(merge, 0, 0); wRL.connect(merge, 0, 0); wLR.connect(merge, 0, 1); wRR.connect(merge, 0, 1);
  merge.connect(output);

  // anything locked to the bar grid follows the transport
  const restartLfo = () => {
    try { lfo?.stop(); } catch { /* not started */ } lfo = c.createOscillator(); lfo.type = P.get('fx.filter.shape') || 'sine';
    lfo.frequency.value = 1 / ((P.get('fx.filter.rate') || 4) * player.beatDur); lfo.connect(lfoG);
    const B = Math.ceil(player.beatNow() - 1e-6); lfo.start(player.playing ? Math.max(t(), player.timeOfBeat(B)) : t());
  };
  const sync = () => { gate.port.postMessage({ bar0: player.bar0, beatDur: player.beatDur, playing: player.playing }); restartLfo(); };
  player.on('transport', sync); player.on('seek', sync);
  player.on('tempo', () => { sync(); P.apply['fx.echo.time']?.(P.get('fx.echo.time')); });

  const resFreqs = () => { if (P.get('fx.res.follow') && studio.heard?.length) return studio.heard.map((m) => { let f = midiHz(m); while (f > 700) f /= 2; while (f < 70) f *= 2; return f; }); const root = midiHz(36 + P.get('fx.res.root')), ch = CHORDS[P.get('fx.res.chord')] || CHORDS.fifths; return ch.map((s) => root * 2 ** (s / 12)); };
  const retune = () => res.port.postMessage({ p: { freqs: resFreqs() } });
  P.define('fx.gate.depth', 0, (v) => gate.port.postMessage({ depth: v }));
  P.define('fx.gate.steps', '1011011010110110', (v) => gate.port.postMessage({ steps: [...v].map(Number) }));
  P.define('fx.gate.rate', 4, (v) => gate.port.postMessage({ rate: v }));
  P.define('fx.gate.smooth', 0.25, (v) => gate.port.postMessage({ smooth: v }));
  P.define('fx.gate.pluck', 0, (v) => gate.port.postMessage({ pluck: v }));
  P.define('fx.filter.lp', 1, (v) => lp.frequency.setTargetAtTime(60 * 333 ** v, t(), 0.03));
  P.define('fx.filter.hp', 0, (v) => hp.frequency.setTargetAtTime(18 * 120 ** v, t(), 0.03));
  P.define('fx.filter.q', 0.15, (v) => { lp.Q.setTargetAtTime(0.5 + v * 16, t(), 0.03); hp.Q.setTargetAtTime(0.5 + v * 10, t(), 0.03); });
  P.define('fx.filter.lfo', 0, (v) => lfoG.gain.setTargetAtTime(v * 3600, t(), 0.05));
  P.define('fx.filter.rate', 4, () => restartLfo());
  P.define('fx.filter.shape', 'sine', () => restartLfo());
  // tape hiss: only on old tape (Age past a quarter), only as much as the Tape amount lets through, only while it rolls —
  // and recomputed whenever any of those change (it used to follow Age alone, and stayed on with the Tape amount at 0)
  const hissLevel = () => { const a = Math.max(0, (P.get('fx.tape.age') ?? 0) - 0.25) / 0.75, m = P.get('fx.tape.mix') ?? 0; hissG.gain.setTargetAtTime(player.playing ? a * a * 0.006 * m : 0, t(), 0.05); };
  player.on('transport', hissLevel);
  P.define('fx.tape.mix', 0, (v) => { tapeWet.gain.setTargetAtTime(v, t(), 0.05); tapeDry.gain.setTargetAtTime(1 - v, t(), 0.05); hissLevel(); });
  P.define('fx.tape.wow', 0.4, (v) => wowG.gain.setTargetAtTime(v * 0.004, t(), 0.05));
  P.define('fx.tape.flutter', 0.25, (v) => flutG.gain.setTargetAtTime(v * 0.0006, t(), 0.05));
  P.define('fx.tape.drive', 0.35, (v) => { sat.curve = curve(v); });
  P.define('fx.tape.age', 0, (v) => { age.frequency.setTargetAtTime(18000 * (1 - v) ** 2.2 + 1800, t(), 0.05); hissLevel(); });
  P.define('fx.res.mix', 0, (v) => res.port.postMessage({ p: { mix: v } }));
  P.define('fx.res.decay', 0.6, (v) => res.port.postMessage({ p: { decay: 0.9 + v * 0.0995 } }));
  P.define('fx.res.bright', 0.5, (v) => res.port.postMessage({ p: { bright: v } }));
  P.define('fx.res.root', 9, retune); P.define('fx.res.chord', 'fifths', retune); P.define('fx.res.follow', false, retune);
  P.define('fx.shim.mix', 0, (v) => { shIn.gain.setTargetAtTime(P.get('fx.shim.freeze') ? 0 : v * 0.8, t(), 0.05); shOut.gain.setTargetAtTime(v * 0.9, t(), 0.05); });
  P.define('fx.shim.rise', 0.35, (v) => { if (!P.get('fx.shim.freeze')) shFb.gain.setTargetAtTime(v * 0.55, t(), 0.05); });
  P.define('fx.shim.interval', 12, (v) => shift.port.postMessage({ ratio: 2 ** (v / 12) }));
  P.define('fx.shim.tone', 0.7, (v) => shTone.frequency.setTargetAtTime(400 * 45 ** v, t(), 0.05));
  P.define('fx.shim.size', 7, (v) => { shLong.buffer = halls[v] || halls[7]; });
  P.define('fx.shim.freeze', false, (v) => { shIn.gain.setTargetAtTime(v ? 0 : (P.get('fx.shim.mix') ?? 0) * 0.8, t(), 0.08); shFb.gain.setTargetAtTime(v ? 0.97 : (P.get('fx.shim.rise') ?? 0.35) * 0.55, t(), 0.08); });
  P.define('fx.echo.mix', 0, (v) => eIn.gain.setTargetAtTime(v, t(), 0.05));
  P.define('fx.echo.time', 0.75, (v) => { const d = Math.min(3.9, v * player.beatDur); eL.delayTime.setTargetAtTime(d, t(), 0.08); eR.delayTime.setTargetAtTime(d, t(), 0.08); });
  P.define('fx.echo.fb', 0.45, (v) => eFb.gain.setTargetAtTime(v * 0.98, t(), 0.05));
  P.define('fx.echo.tone', 0.6, (v) => eLo.frequency.setTargetAtTime(500 * 30 ** v, t(), 0.05));
  P.define('fx.echo.spin', 0.6, (v) => { panL.pan.setTargetAtTime(-v, t(), 0.05); panR.pan.setTargetAtTime(v, t(), 0.05); });
  const ensMix = () => { const m = P.get('fx.ens.mix') ?? 0, vib = P.get('fx.ens.vib'); ensWet.gain.setTargetAtTime(vib ? m * 1.1 : m * 0.75, t(), 0.05); ensDry.gain.setTargetAtTime(vib ? 1 - m : 1 - m * 0.3, t(), 0.05); };
  P.define('fx.ens.mix', 0, ensMix); P.define('fx.ens.vib', false, ensMix);
  P.define('fx.ens.rate', 0.3, (v) => ens.forEach((x, i) => x.o.frequency.setTargetAtTime((0.08 + 6 * v * v) * (1 + i * 0.31), t(), 0.05)));
  P.define('fx.ens.depth', 0.4, (v) => ens.forEach((x) => x.og.gain.setTargetAtTime(0.0002 + v * v * 0.006, t(), 0.05)));
  P.define('fx.ens.spread', 0.7, (v) => ens.forEach((x, i) => x.pn.pan.setTargetAtTime((i - 1) * v, t(), 0.05)));
  P.define('fx.rep.pitch', 0, (v) => rep.port.postMessage({ p: { rate: 2 ** (v / 12) } }));
  P.define('fx.rep.decay', 0.85, (v) => rep.port.postMessage({ p: { decay: 0.55 + v * 0.45 } }));
  P.define('fx.rep.steps', '0000000000000000');
  P.define('fx.rep.len', 0.25);
  P.define('fx.crush.mix', 0, (v) => crush.parameters.get('mix').setValueAtTime(v, t()));
  P.define('fx.crush.bits', 0.5, (v) => crush.parameters.get('bits').setValueAtTime(16 - v * 13, t()));
  P.define('fx.crush.down', 0.3, (v) => crush.parameters.get('down').setValueAtTime(1 + v * 30, t()));
  P.define('fx.width', 1, (v) => { const a = (1 + v) / 2, b = (1 - v) / 2; for (const [n, x] of [[wLL, a], [wRR, a], [wRL, b], [wLR, b]]) n.gain.setTargetAtTime(x, t(), 0.05); });
  let thrown = null;
  return {
    input, output, lp, hp, retune, resFreqs,
    repeat: (div, at) => rep.port.postMessage(div ? { on: true, len: player.beatDur * div, at } : { off: true, at }),
    // a dub throw: everything into the echo, harder, while held
    throw: (on) => { const now = t(); if (on) { thrown = [eIn.gain.value, eFb.gain.value]; eIn.gain.setTargetAtTime(1, now, 0.01); eFb.gain.setTargetAtTime(0.82, now, 0.02); } else if (thrown) { eIn.gain.setTargetAtTime(P.get('fx.echo.mix'), now, 0.08); eFb.gain.setTargetAtTime(P.get('fx.echo.fb') * 0.98, now + 0.3, 0.6); thrown = null; } },
  };
}
export const CHORDS = { fifths: [0, 7, 12, 19, 24, 31], major: [0, 4, 7, 12, 16, 19], minor: [0, 3, 7, 12, 15, 19], sus: [0, 5, 7, 12, 17, 19], cluster: [0, 2, 3, 7, 10, 14], open: [0, 7, 14, 21, 28, 35] };
function makeHall(ctx, seconds) {
  const len = Math.round(seconds * ctx.sampleRate), ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); let lp = 0; for (let i = 0; i < len; i++) { const tt = i / ctx.sampleRate; lp += (Math.random() * 2 - 1 - lp) * (0.25 + 0.6 * (1 - tt / seconds)); d[i] = lp * Math.exp(-tt * 5 / seconds) * Math.min(1, i / (0.03 * ctx.sampleRate)); } }
  return ir;
}

// --------------------------------------------------------------------------------------------- sequencer
// Sixteen patterns (A–P), each a loop of N bars holding notes and moves — never audio. Two ways to play them:
//  jam  : the current pattern loops (or "chain" walks through the ones with something in them)
//  song : an arrangement on a timeline. Band clips choose which bars of the original song each musician plays;
//         pattern clips play one instrument's part (or the moves) of a pattern, looped to the clip's length.
// Recording in song mode makes a take: a fresh pattern, laid on the timeline as clips when you stop.
export const PATS = 'ABCDEFGHIJKLMNOP'.split('');
/** Which bar of the original a stem clip plays, `rel` bars into it, and how (the clip's treatment). */
export function srcBar(cl, rel, N) {
  const fx = cl.fx, sp = fx?.s || 1;
  let pos = ((cl.loop ? cl.off || 0 : 0) + rel) * sp;                 // half speed walks through the source at half the pace
  if (cl.loop) pos = ((pos % cl.loop) + cl.loop) % cl.loop;
  const total = cl.src + pos, whole = Math.floor(total + 1e-6), o = total - whole > 1e-3 ? +(total - whole).toFixed(3) : 0;
  const bar = ((whole % N) + N) % N;
  if (!o && (!fx || (!fx.r && sp === 1 && !fx.u && (fx.g ?? 1) === 1))) return { bar };
  return { bar, fx: { r: fx?.r ? 1 : 0, s: sp, u: fx?.u || 0, g: fx?.g ?? 1, o } };
}
/** Shift where a stem clip starts in its source by d timeline bars (after a trim or a split). */
export function shiftSrc(cl, d) { if (cl.loop) cl.off = (cl.off || 0) + d; else cl.src = +(cl.src + d * (cl.fx?.s || 1)).toFixed(3); return cl; }
export const isTake = (k) => !PATS.includes(k);
export const takeName = (k) => `take ${String(k).slice(1)}`;
export class Sequencer extends EventTarget {
  constructor(studio) {
    super(); this.s = studio;
    this.vars = Object.fromEntries(PATS.map((k) => [k, []])); this.lens = Object.fromEntries(PATS.map((k) => [k, 4]));
    this.cur = 'A'; this.rec = false; this.on = true; this.chain = false; this.quant = 0.25;
    this.touched = new Set(); this.last = -1; this.held = new Map(); this.pass = 0; this.mute = new Set();
    this.mode = 'jam'; this.arr = { bars: 0, clips: [], cycle: null }; this.take = null; this.uid = 1; this.jamTracks = null;
    this.undos = []; this.redos = [];
    onTick(() => this.tick());
  }
  get bpb() { return this.s.song.beatsPerBar; }
  get bars() { return this.lens[this.cur]; }
  set bars(v) { this.lens[this.cur] = v; }
  get beats() { return this.bars * this.bpb; }
  pb(k) { return this.lens[k] * this.bpb; }
  /** The patterns on show: four to begin with, then as many as have been added or used. */
  shownPats() { let n = Math.max(4, this.npat || 4); PATS.forEach((k, i) => { if (this.used(k) || k === this.cur) n = Math.max(n, i + 1); }); return PATS.slice(0, n); }
  addPat() { const n = this.shownPats().length; if (n >= PATS.length) return null; this.npat = n + 1; this.cur = PATS[n]; this.emit(); return this.cur; }
  used(k) { return this.vars[k].length > 0 || this.arr.clips.some((c) => c.pat === k); }
  /** Where on the song timeline (in beats) an absolute player beat falls. */
  tl(abs) {
    const bpb = this.bpb, c = this.arr.cycle;
    if (c) { const a = c[0] * bpb, n = (c[1] - c[0]) * bpb; return a + (((abs - a) % n) + n) % n; }
    const n = Math.max(1, this.arr.bars) * bpb; return ((abs % n) + n) % n;
  }
  nowBeat() { const p = this.s.player; return p.playing ? p.beatNow() : p.pausedBar * this.bpb; }
  /** Where a recorded event lands in the pattern being recorded into. */
  recBeat() {
    const p = this.s.player; if (!p.playing) return null;
    const ab = p.beatNow();
    if (this.take) {
      const T = this.take; let r = this.tl(ab) - T.start * this.bpb;
      if (T.len) { const n = T.len * this.bpb; r = ((r % n) + n) % n; } else if (r < 0) r = r > -1 ? 0 : r + this.arr.bars * this.bpb;
      return r;
    }
    return ((ab % this.beats) + this.beats) % this.beats;
  }
  /** The playhead inside the current pattern, for drawing. */
  loopBeat() {
    const p = this.s.player; if (!p.playing) return null;
    if (this.mode === 'jam') return this.recBeat();
    if (this.take) return this.take.pat === this.cur ? this.recBeat() % this.beats : null;
    const tb = this.tl(p.beatNow()), bpb = this.bpb;
    const cl = this.arr.clips.find((c) => c.pat === this.cur && tb >= c.start * bpb && tb < (c.start + c.len) * bpb);
    if (!cl) return null; const r = tb - (cl.start - (cl.off || 0)) * bpb; return ((r % this.beats) + this.beats) % this.beats;
  }
  get list() { return this.vars[this.take ? this.take.pat : this.cur]; }
  wrap() { return this.take ? (this.take.len ? this.take.len * this.bpb : 1e9) : this.beats; }
  q(b) { return this.quant ? (Math.round(b / this.quant) * this.quant) % this.wrap() : b; }
  noteIn(slot, note, vel, on) {
    this.s.noteSeen?.(note, on);
    if (!this.rec) this.remember({ k: 'n', slot, note, vel, on });
    if (!this.rec || !this.s.player.playing) return;
    const b = this.recBeat(), key = slot + ':' + note;
    if (on) this.held.set(key, { k: 'n', slot, note, vel: +vel.toFixed(2), b: +this.q(b).toFixed(3), d: this.quant || 0.25, start: b, p: this.pass });
    else { const e = this.held.get(key); if (!e) return; this.held.delete(key); let d = b - e.start; if (d <= 0) d += this.wrap() < 1e8 ? this.wrap() : 0; e.d = +Math.max(this.quant || 0.1, this.quant ? Math.round(d / this.quant) * this.quant : d).toFixed(3); delete e.start; this.list.push(e); this.emit(); }
  }
  moveIn(path, value) {
    if (!this.rec && (typeof value === 'number' || typeof value === 'boolean')) this.remember({ k: 'm', path, v: typeof value === 'number' ? +value.toFixed(4) : value });
    if (!this.rec || !this.s.player.playing || (typeof value !== 'number' && typeof value !== 'boolean')) return;
    const b = +this.recBeat().toFixed(3), list = this.list, val = typeof value === 'number' ? +value.toFixed(4) : value;
    this.touched.add(path);
    // the gesture being drawn now replaces what earlier passes left on this path, here; its own points all stay
    const last = this.lastMove?.[path];
    for (let i = list.length - 1; i >= 0; i--) { const e = list[i]; if (e.k !== 'm' || e.path !== path || e.p === this.pass) continue; const lo = last && last.p === this.pass ? last.b : b - 0.25; if (lo <= b ? e.b >= lo && e.b <= b + 0.01 : e.b >= lo || e.b <= b + 0.01) list.splice(i, 1); }
    // thin a fast gesture to about 1/32 of a beat
    if (last && last.p === this.pass && Math.abs(b - last.b) < 0.03) { last.v = val; this.emit(); return; }
    const ev = { k: 'm', path, v: val, b, p: this.pass }; list.push(ev); (this.lastMove ??= {})[path] = ev;
    this.emit();
  }
  clear(which = this.cur) { this.snapshot(); this.vars[which] = []; this.emit(); }
  clearLane(lane) { this.snapshot(); this.vars[this.cur] = this.vars[this.cur].filter((e) => (lane === 'm' ? e.k !== 'm' : !(e.k === 'n' && e.slot === lane))); this.emit(); }
  arm(on) {
    if (on === this.rec) return;
    this.rec = on;
    if (on) { this.pass++; this.lastMove = {}; this.snapshot(); if (this.mode === 'song') this.startTake(); }
    else { this.held.clear(); this.touched.clear(); if (this.take) this.endTake(); }
    this.emit();
  }
  startTake() {
    let n = 1; while (this.vars['T' + n]) n++;
    const free = 'T' + n; this.vars[free] = []; this.lens[free] = 4;
    const c = this.arr.cycle, bar = c ? c[0] : Math.floor((this.tl(this.nowBeat()) + 0.25) / this.bpb);   // just before a bar line counts as on it
    this.take = { pat: free, start: bar, len: c ? c[1] - c[0] : 0 }; this.prevCur = this.cur; this.cur = free;
  }
  endTake() {
    const T = this.take; this.take = null;
    const ev = this.vars[T.pat]; if (!ev.length) { delete this.vars[T.pat]; delete this.lens[T.pat]; this.cur = this.prevCur || 'A'; return; }
    let end = 0; for (const e of ev) end = Math.max(end, e.b + (e.d || 0.01));
    const len = T.len || Math.max(1, Math.ceil(end / this.bpb - 1e-6));
    this.lens[T.pat] = len;
    // on the phone, recording adds to the timeline: notes join the notes already there, and moves replace only their own kind
    if (this.s.phone) for (const lane of new Set(ev.map((e) => (e.k === 'n' ? e.slot : 'm')))) { const mine = new Set(ev.filter((e) => e.k === 'm').map((e) => e.path)); for (const e of this.flat(lane, T.start, len)) if (lane !== 'm' || !mine.has(e.path)) ev.push(e); }
    for (const lane of new Set(ev.map((e) => (e.k === 'n' ? e.slot : 'm')))) this.place({ lane, part: lane, start: T.start, len, pat: T.pat });
    this.changed();
  }

  /** What a lane plays between two bars, as one list of events counted from the first. */
  flat(lane, start, len) {
    const bpb = this.bpb, out = [], s = start * bpb, z = (start + len) * bpb;
    for (const cl of this.arr.clips) { if (cl.lane !== lane || cl.pat == null || !this.vars[cl.pat]) continue; const pb = this.pb(cl.pat), cs = cl.start * bpb, ce = cs + cl.len * bpb, base = cs - (cl.off || 0) * bpb, a = Math.max(s, cs), b = Math.min(z, ce);
      for (let k = Math.floor((a - base) / pb); b > a && base + k * pb < b; k++) for (const e of this.vars[cl.pat]) { if (e.b >= pb || (lane === 'm' ? e.k !== 'm' : e.k !== 'n' || e.slot !== (cl.part ?? cl.lane))) continue; const t = base + k * pb + e.b; if (t >= a && t < b) out.push({ ...e, b: +(t - s).toFixed(3), ...(e.k === 'n' ? { slot: lane, note: e.note + (cl.tr || 0), d: Math.min(e.d, z - t) } : {}) }); } }
    return out;
  }

  // ---------------------------------------------------------------- arrangement editing
  /** Put a clip on the timeline; whatever it covers on its lane is trimmed away (the newest clip wins). */
  place(clip) {
    clip.id ??= this.uid++;
    const out = [];
    for (const o of this.arr.clips) {
      if (o === clip || o.lane !== clip.lane) { if (o !== clip) out.push(o); continue; }
      const a = clip.start, b = clip.start + clip.len, oa = o.start, ob = o.start + o.len;
      if (ob <= a || oa >= b) { out.push(o); continue; }
      if (oa < a) out.push({ ...o, len: a - oa });
      if (ob > b) { const d = b - oa, r = o.src !== undefined ? shiftSrc({ ...o }, d) : { ...o, off: (o.off || 0) + d }; out.push(Object.assign(r, { id: o.id === undefined || oa < a ? this.uid++ : o.id, start: b, len: ob - b })); }
    }
    out.push(clip); this.arr.clips = out; return clip;
  }
  changed() { this.applyBand(); this.emit(); }
  snapshot() { this.undos.push(JSON.stringify({ vars: this.vars, lens: this.lens, arr: this.arr })); if (this.undos.length > 80) this.undos.shift(); this.redos = []; }
  restoreSnap(j) { const d = JSON.parse(j); this.vars = d.vars; this.lens = d.lens; this.arr = d.arr; this.changed(); }
  undo() { const j = this.undos.pop(); if (!j) return false; this.redos.push(JSON.stringify({ vars: this.vars, lens: this.lens, arr: this.arr })); this.restoreSnap(j); return true; }
  redo() { const j = this.redos.pop(); if (!j) return false; this.undos.push(JSON.stringify({ vars: this.vars, lens: this.lens, arr: this.arr })); this.restoreSnap(j); return true; }
  fillFromSong() {
    const song = this.s.song, cb = song.barsPerCell;
    this.arr.bars = song.numBars; this.arr.clips = this.arr.clips.filter((c) => c.lane !== 'band');
    for (const s of song.sections) this.arr.clips.push({ id: this.uid++, lane: 'band', start: s.startCell * cb, len: (s.endCell - s.startCell) * cb, src: s.startCell * cb, name: s.name });
  }
  setMode(m) {
    if (m === this.mode) return;
    if (this.rec) this.arm(false);
    const st = this.s.session.state;
    if (m === 'song') {
      if (!this.arr.bars) this.fillFromSong();
      this.jamTracks = Object.fromEntries(st.order.map((id) => { const t = st.tracks[id]; return [id, { mode: t.mode === 'pattern' ? 'follow' : t.mode, cell: t.cell ?? 0 }]; }));
      this.mode = 'song'; this.applyBand();
    } else {
      this.mode = 'jam'; if (isTake(this.cur)) this.cur = PATS.includes(this.prevCur) ? this.prevCur : 'A';
      this.s.session.dispatch({ t: 'tracks/set', p: this.jamTracks || Object.fromEntries(st.order.map((id) => [id, { mode: 'follow' }])) }, { log: false });
    }
    this.last = -1; this.emit();
  }
  /** The band in song mode: for every musician, which bar of the original each timeline bar plays. */
  bandPatterns() {
    const song = this.s.song, cb = song.barsPerCell, N = song.numBars, c = this.arr.cycle;
    const len = c ? c[1] - c[0] : Math.max(1, this.arr.bars), a = c ? c[0] : 0, out = {};
    const band = this.arr.clips.filter((x) => x.lane === 'band'), detached = this.arr.own || {};
    for (const st of song.stems) {
      const own = this.arr.clips.filter((x) => x.lane === 'stem:' + st.id), pat = new Array(len).fill(null), alone = detached[st.id];
      for (let i = 0; i < len; i++) {
        const T = c ? a + (((i - a) % len) + len) % len : i;
        if (T >= this.arr.bars) continue;
        const at = (x) => T >= x.start && T < x.start + x.len, cl = own.find(at) || (alone ? null : band.find(at));
        if (!cl || cl.mute?.includes(st.id)) continue;
        const r = srcBar(cl, T - cl.start, N), cell = Math.floor(r.bar / cb);
        if (st.cells[cell] || st.voice) pat[i] = r.fx ? [cell, r.bar % cb, r.fx] : [cell, r.bar % cb];   // your voice: also where nothing is recorded yet, so a take knows where it lands
      }
      out[st.id] = { mode: 'pattern', pattern: pat };
    }
    return out;
  }
  /** Give a stem its own lane: it stops following the Stems lane, which is copied onto it to start from. */
  detach(stemId) {
    const own = (this.arr.own ??= {}); if (own[stemId]) return false;
    const lane = 'stem:' + stemId, mine = this.arr.clips.filter((c) => c.lane === lane);
    for (const b of this.arr.clips.filter((c) => c.lane === 'band')) {
      if (b.mute?.includes(stemId)) continue;
      // older own clips win where they overlap, as they did when they played
      let segs = [[b.start, b.start + b.len]];
      for (const m of mine) segs = segs.flatMap(([x, y]) => (m.start >= y || m.start + m.len <= x ? [[x, y]] : [[x, Math.max(x, m.start)], [Math.min(y, m.start + m.len), y]].filter(([p, q]) => q > p)));
      for (const [x, y] of segs) { const d = x - b.start; const cl = { id: this.uid++, lane, start: x, len: y - x, src: b.src, name: b.name, loop: b.loop, off: b.off, fx: b.fx ? { ...b.fx } : undefined }; this.arr.clips.push(shiftSrc(cl, d)); }
    }
    own[stemId] = true; return true;
  }
  /** Let a stem follow the Stems lane again; its own clips go. */
  attach(stemId) { if (this.arr.own) delete this.arr.own[stemId]; this.arr.clips = this.arr.clips.filter((c) => c.lane !== 'stem:' + stemId); }
  /** Lay a pattern on the arrangement at a bar: one clip per instrument that has notes in it, and one for its moves. */
  placePattern(k, bar) {
    const ev = this.vars[k]; if (!ev?.length) return [];
    const len = this.lens[k], out = [];
    for (const lane of new Set(ev.map((e) => (e.k === 'n' ? e.slot : 'm')))) out.push(this.place({ lane, part: lane, start: bar, len, pat: k }));
    if (bar + len > this.arr.bars) this.arr.bars = bar + len;
    return out;
  }
  /** The first bar after everything on these lanes (where a new idea can go without covering anything). */
  endOf(lanes) { let e = 0; for (const c of this.arr.clips) if (lanes.includes(c.lane)) e = Math.max(e, c.start + c.len); return e; }

  // ---------------------------------------------------------------- capture: what you played without recording
  /** Notes and moves are always remembered for the last 32 bars, so a good idea played with Record off can still be kept. */
  remember(e) {
    const p = this.s.player; if (!p.playing || this.rec) return;
    const ab = p.beatNow(), H = (this.hist ??= []);
    H.push({ ...e, ab }); const cut = ab - 32 * this.bpb; while (H.length && H[0].ab < cut) H.shift();
    if (H.length > 6000) H.splice(0, H.length - 6000);
    // a moving finger is a hundred of these a second; who is listening only needs to know now and then
    if (!this.remT) this.remT = setTimeout(() => { this.remT = 0; this.emit(); }, 300);
  }
  canCapture() { const H = this.hist || []; return H.some((e) => e.k === 'n' && e.on) || H.some((e) => e.k === 'm'); }
  /** Turn the last phrase you played (back to the first pause of two bars or more, at most 16 bars) into a take. */
  capture() {
    const H = this.hist || [], bpb = this.bpb; if (!H.length) return null;
    let i = H.length - 1; while (i > 0 && H[i].ab - H[i - 1].ab < 2 * bpb && H[H.length - 1].ab - H[i - 1].ab < 16 * bpb) i--;
    const part = H.slice(i), startAbs = Math.floor(part[0].ab / bpb) * bpb;
    const notes = [], open = new Map();
    for (const e of part) {
      const b = +(e.ab - startAbs).toFixed(3);
      if (e.k === 'n') { const key = e.slot + ':' + e.note; if (e.on) open.set(key, { k: 'n', slot: e.slot, note: e.note, vel: +e.vel.toFixed(2), b: this.quant ? Math.round(b / this.quant) * this.quant : b, start: b, p: 0 }); else { const n = open.get(key); if (n) { open.delete(key); n.d = +Math.max(this.quant || 0.1, b - n.start).toFixed(3); delete n.start; notes.push(n); } } }
      else notes.push({ k: 'm', path: e.path, v: e.v, b, p: 0 });
    }
    const lastB = part[part.length - 1].ab - startAbs;
    for (const n of open.values()) { n.d = +Math.max(0.25, lastB - n.start).toFixed(3); delete n.start; notes.push(n); }
    if (!notes.length) return null;
    this.snapshot();
    let n = 1; while (this.vars['T' + n]) n++;
    const k = 'T' + n, len = Math.max(1, Math.ceil((lastB + 0.01) / bpb));
    this.vars[k] = notes; this.lens[k] = len;
    // where it goes: where it was played if the arrangement was playing, otherwise after what is already there
    const lanes = [...new Set(notes.map((e) => (e.k === 'n' ? e.slot : 'm')))];
    const bar = this.mode === 'song' ? Math.floor(this.tl(startAbs) / bpb) : this.endOf(lanes);
    this.placePattern(k, bar); this.hist = [];
    this.changed(); return { k, bar, len };
  }
  applyBand() { if (this.mode === 'song') this.s.session.dispatch({ t: 'tracks/set', p: this.bandPatterns() }, { log: false }); }

  // ---------------------------------------------------------------- playback
  tick() {
    const p = this.s.player; if (!p.playing || !this.on) { this.last = -1; return; }
    const now = p.ctx.currentTime, beatAbs = (t) => (t - p.bar0) / p.beatDur;
    let from = this.last < 0 ? beatAbs(now) : this.last; const to = beatAbs(now + (this.s.phone ? 0.2 : 0.12));
    if (to - from > 2 || to < from - 0.01) from = beatAbs(now);   // the player jumped (a seek)
    if (to <= from) return;
    if (this.mode === 'song') this.tickSong(from, to); else this.tickJam(from, to);
    this.last = to;
  }
  fire(e, ab, dur, tr = 0, slot = e.slot) {
    const p = this.s.player, at = p.bar0 + ab * p.beatDur;
    if (e.k === 'n') {
      const ins = this.s.slots[slot]; if (!ins) return;
      const id = `q${slot}:${e.note}:${ab.toFixed(3)}`, note = Math.max(0, Math.min(127, e.note + tr));
      ins.voice.noteOn(id, note, e.vel, at); ins.voice.noteOff(id, at + dur * p.beatDur);
      this.s.flashNote?.(slot, note, at, dur * p.beatDur);
      if (this.s.noteSeen) setTimeout(() => this.s.noteSeen(note, true), Math.max(0, (at - p.ctx.currentTime) * 1000));
    } else if (!(this.rec && this.touched.has(e.path))) setTimeout(() => this.s.params.set(e.path, e.v, { by: 'seq' }), Math.max(0, (at - p.ctx.currentTime) * 1000));
  }
  tickJam(from, to) {
    const B = this.beats, loopsFrom = Math.floor(from / B), loopsTo = Math.floor(to / B);
    if (this.chain && loopsTo > loopsFrom && !this.rec) { const order = PATS.filter((k) => this.vars[k].length); if (order.length) { const i = order.indexOf(this.cur); this.cur = order[(i + 1) % order.length]; this.emit(); } }
    const list = this.vars[this.cur], Bn = this.beats;
    for (let loop = Math.floor(from / Bn); loop <= Math.floor(to / Bn); loop++) for (const e of list) {
      const ab = loop * Bn + e.b; if (ab < from || ab >= to || e.b >= Bn) continue;
      if (this.mute.has(e.k === 'n' ? e.slot : 'm')) continue;
      this.fire(e, ab, e.d);
    }
    if (loopsTo > loopsFrom) { this.touched.clear(); if (this.rec) { this.pass++; this.lastMove = {}; } }
  }
  tickSong(from, to) {
    const bpb = this.bpb, c = this.arr.cycle, ws = c ? c[0] * bpb : 0, we = c ? c[1] * bpb : this.arr.bars * bpb;
    if (we <= ws) return;
    let a = this.tl(from), rem = to - from, abs = from;
    while (rem > 1e-9) { const seg = Math.min(rem, we - a); if (seg <= 0) break; this.playRange(a, a + seg, abs - a); rem -= seg; abs += seg; if (rem > 1e-9) { a = ws; if (this.take?.len && this.rec) { this.pass++; this.lastMove = {}; } } }
  }
  playRange(lo, hi, off) {
    const bpb = this.bpb;
    for (const cl of this.arr.clips) {
      if (cl.pat == null || this.mute.has(cl.lane)) continue;
      const cs = cl.start * bpb, ce = (cl.start + cl.len) * bpb, a = Math.max(lo, cs), b = Math.min(hi, ce); if (b <= a) continue;
      const pb = this.pb(cl.pat), base = cs - (cl.off || 0) * bpb, ev = this.vars[cl.pat];
      for (let k = Math.floor((a - base) / pb); base + k * pb < b; k++) for (const e of ev) {
        if (e.b >= pb || (cl.lane === 'm' ? e.k !== 'm' : e.k !== 'n' || e.slot !== (cl.part ?? cl.lane))) continue;
        const t = base + k * pb + e.b; if (t < a || t >= b) continue;
        this.fire(e, t + off, Math.min(e.d || 0, ce - t), cl.tr || 0, cl.lane);
      }
    }
  }
  dump() { return { vars: this.vars, lens: this.lens, cur: this.cur, quant: this.quant, chain: this.chain, mode: this.mode, npat: this.npat, arr: this.arr, uid: this.uid, jamTracks: this.jamTracks, mute: [...this.mute] }; }
  load(d) {
    if (!d) return;
    const vars = { ...Object.fromEntries(PATS.map((k) => [k, []])), ...(d.vars || {}) }, lens = { ...Object.fromEntries(PATS.map((k) => [k, d.bars || 4])), ...(d.lens || {}) };
    Object.assign(this, { vars, lens, cur: d.cur || 'A', quant: d.quant ?? 0.25, chain: !!d.chain, arr: d.arr || { bars: 0, clips: [], cycle: null }, uid: d.uid || 1, jamTracks: d.jamTracks || null, mute: new Set(d.mute || []), npat: d.npat || 4 });
    this.wantMode = d.mode || 'jam';
    this.emit();
  }
  emit() { this.dispatchEvent(new Event('change')); }
}
