// What an edge of the table does to a stem. Every stem can have every one of these, by its own amount; a unit is only
// built for a stem the first time it is really used, and sits between its filter and its pan. Nothing is ever unplugged
// while it sounds: the new way is laid beside the old one and faded over to.
//   amount (band.<id>.fx.<name>, 0..1) is how near the disc is to the edge · character (edge.k.<name>, 0..1) is shared:
//   the handle that slides along the edge.
import { clamp } from './phone-kit.js';

const PENT = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24], PRATE = [2, 1, 0.5, 1 / 3, 0.25, 0.125], FRATE = [16, 8, 4, 2, 1, 0.5];
const at = (list, k) => list[clamp(Math.round(k * (list.length - 1)), 0, list.length - 1)], pct = (k) => `${Math.round(k * 100)}`;
/** name → [label, colour, what the handle changes, how to say it] */
export const FX = {
  echo: ['Echo', '#9cc2f4', 'repeats', pct], space: ['Space', '#b9a8f2', 'size', pct], dark: ['Dark', '#7d8bb5', 'peak', pct], thin: ['Thin', '#d8e6f2', 'peak', pct], heat: ['Heat', '#ef7f5f', 'tone', pct], crush: ['Crush', '#e6b450', 'grit', pct],
  ring: ['Ring', '#8fd3c5', 'note', (k) => `${at(PENT, k)} st`], wobble: ['Wobble', '#f0a8c0', 'speed', (k) => `${(0.3 + k * k * 9).toFixed(1)} Hz`], pulse: ['Pulse', '#f2d06b', 'rate', (k) => ({ 2: '1/2', 1: '1/4', 0.5: '1/8', 0.25: '1/16', 0.125: '1/32' }[at(PRATE, k)] || '1/8 t')], fly: ['Fly', '#a5d98b', 'rate', (k) => `${at(FRATE, k)} beats`], far: ['Far', '#8e96a6', 'fog', pct], fade: ['Fade', '#c3c4c8', 'curve', pct],
};
const ORDER = ['dark', 'thin', 'heat', 'crush', 'ring', 'wobble', 'pulse', 'far', 'fade', 'fly'];

export class EdgeFx {
  constructor(S) {
    this.S = S; this.ch = new Map(); const P = S.params;
    // the note Ring starts from: the strongest of the song
    this.root = () => { if (this._root !== undefined || !S.feat) return this._root ?? 9; const c = new Array(12).fill(0); for (const rows of Object.values(S.feat.stems)) for (const x of rows) if (x) x.c.forEach((v, i) => { c[i] += v; }); return (this._root = c.indexOf(Math.max(...c))); };
    for (const n of Object.keys(FX)) { P.define(`edge.k.${n}`, { echo: 0.5, space: 0.6, pulse: 0.4, fly: 0.4, ring: 0, wobble: 0.35 }[n] ?? 0.4, () => this.character(n)); (P.range ??= {})[`edge.k.${n}`] = [0, 1, `${FX[n][0]} ${FX[n][2]}`]; }
    for (const st of S.song.stems) for (const n of Object.keys(FX)) P.define(`band.${st.id}.fx.${n}`, 0, (v) => this.set(st.id, n, v));
    for (const st of S.song.stems) this.direct(st.id);
    for (const t of ['transport', 'tempo', 'seek']) S.player.on(t, () => { for (const r of this.ch.values()) for (const u of Object.values(r.units)) u.sync?.(); });
  }
  k(n) { return this.S.params.get(`edge.k.${n}`) ?? 0.4; }
  amount(id, n) { return this.S.params.get(`band.${id}.fx.${n}`) || 0; }
  set(id, n, v) {
    const S = this.S, D = S.session; v = clamp(v || 0, 0, 1);
    if (n === 'echo') { if (D.state.tracks[id]) D.dispatch({ t: 'track/set', id, p: { dly: v * v * 1.1 } }, { log: false }); return; }
    if (n === 'space') { if (D.state.tracks[id]) D.dispatch({ t: 'track/set', id, p: { rev: 0.06 + v * v * 1.2 } }, { log: false }); return; }
    let r = this.ch.get(id); if (v < 0.004 && !r?.units[n]) return;
    if (!r) this.ch.set(id, (r = { units: {} }));
    if (!r.units[n]) { r.units[n] = this.build(n); this.wire(id, r, n); }
    r.units[n].set(v, this.k(n));
  }
  character(n) {
    const P = this.S.params, k = this.k(n);
    if (n === 'echo') { if ('mix.echo.fb' in P.def) P.set('mix.echo.fb', +(0.1 + k * 0.85).toFixed(3), { by: 'ui' }); else this.S.engine.fb.gain.setTargetAtTime(0.1 + k * 0.78, this.S.ctx.currentTime, 0.05); return; }
    if (n === 'space') { if ('mix.space.tone' in P.def) P.set('mix.space.tone', +(0.25 + k * 0.75).toFixed(3), { by: 'ui' }); else this.S.engine.revOut.gain.setTargetAtTime(0.3 + k * 1.1, this.S.ctx.currentTime, 0.05); return; }
    for (const [id, r] of this.ch) r.units[n]?.set(this.amount(id, n), k, true);
  }
  fade(g, v) { const t = this.S.ctx.currentTime + 0.01; g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(v, t + 0.03); }
  gain(v) { const g = this.S.ctx.createGain(); g.gain.value = v; return g; }
  /** The way round: filter → (a gain we can close) → pan. Made before anything sounds. */
  direct(id) {
    const c = this.S.engine.channel(id); if (c.direct) return c;
    c.direct = this.gain(1); c.lp.connect(c.direct).connect(c.pan); c.lp.disconnect(c.pan); return c;
  }
  wire(id, r, n) {
    const c = this.direct(id);
    if (!r.row) {   // a row of places, one per effect in a fixed order, each passing straight through until it is used
      r.row = {}; const inn = this.gain(1), out = this.gain(0); let prev = inn;
      for (const k of ORDER) { const by = this.gain(1), o = this.gain(1); prev.connect(by).connect(o); r.row[k] = { from: prev, by, to: o }; prev = o; }
      prev.connect(out).connect(c.pan); c.lp.connect(inn); this.fade(out, 1); this.fade(c.direct, 0);
    }
    const u = r.units[n], p = r.row[n], wet = this.gain(0);
    p.from.connect(u.in); u.out.connect(wet).connect(p.to); this.fade(wet, 1); this.fade(p.by, 0);
  }
  build(n) {
    const c = this.S.ctx, S = this.S, t = () => c.currentTime, g = (v = 1) => { const x = c.createGain(); x.gain.value = v; return x; }, ramp = (p, v, tc = 0.05) => p.setTargetAtTime(v, t(), tc);
    const mix = (make) => { const i = g(), o = g(), dry = g(), wet = g(0); i.connect(dry).connect(o); wet.connect(o); const u = make(i, wet); return { in: i, out: o, dry, wet, ...u }; };
    const lfo = (type, smooth) => { const o = { osc: null, out: g(0), hz: 1, type }; const f = smooth ? c.createBiquadFilter() : null; if (f) { f.type = 'lowpass'; f.frequency.value = smooth; f.connect(o.out); } o.start = () => { try { o.osc?.stop(); o.osc?.disconnect(); } catch { /* not started */ } o.osc = c.createOscillator(); o.osc.type = type; o.osc.frequency.value = o.hz; o.osc.connect(f || o.out); const p = S.player; o.osc.start(p.playing ? Math.max(t(), p.timeOfBeat(Math.ceil(p.beatNow() - 1e-6))) : t()); }; return o; };
    // every unit starts out doing nothing, so a stem's first touch of an edge is not heard as a jolt
    if (n === 'dark') { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 20000; f.Q.value = 0.5; return { in: f, out: f, set: (v, k) => { ramp(f.frequency, 20000 * 0.0075 ** v); ramp(f.Q, 0.5 + v * k * k * 15); } }; }
    if (n === 'thin') { const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 20; f.Q.value = 0.5; return { in: f, out: f, set: (v, k) => { ramp(f.frequency, 20 * 170 ** v); ramp(f.Q, 0.5 + v * k * k * 12); } }; }
    if (n === 'heat') return mix((i, wet) => { const pre = g(), sh = c.createWaveShaper(), tone = c.createBiquadFilter(), post = g(); tone.type = 'lowpass'; const cv = new Float32Array(1024); for (let j = 0; j < 1024; j++) { const x = (j / 511.5 - 1) * 1.6; cv[j] = Math.tanh(x * 2.2) * 0.8 + Math.tanh(x * x * 1.4) * 0.12; } sh.curve = cv; sh.oversample = '2x'; i.connect(pre).connect(sh).connect(tone).connect(post).connect(wet); return { set(v, k) { const w = Math.min(1, v * 2.2); ramp(this.wet.gain, w); ramp(this.dry.gain, 1 - w); ramp(pre.gain, 1 + v * v * 26); ramp(post.gain, 1 / (1 + v * 2.6)); ramp(tone.frequency, 700 * 24 ** k); } }; });
    if (n === 'crush') { const x = new AudioWorkletNode(c, 'crusher', { outputChannelCount: [2] }); return { in: x, out: x, set: (v, k) => { x.parameters.get('mix').setTargetAtTime(Math.min(1, v * 1.8), t(), 0.05); x.parameters.get('bits').setTargetAtTime(16 - v * 12.5, t(), 0.05); x.parameters.get('down').setTargetAtTime(1 + v * (2 + k * 34), t(), 0.05); } }; }
    if (n === 'ring') return mix((i, wet) => { const d = c.createDelay(0.1), fb = g(0.6), lp = c.createBiquadFilter(), post = g(0.5); lp.type = 'lowpass'; lp.frequency.value = 5200; i.connect(d).connect(lp).connect(fb).connect(d); lp.connect(post).connect(wet); return { set(v, k) { const f = 440 * 2 ** ((33 + ((S.edge?.root() ?? 9) + 3) % 12 + at(PENT, k) - 69) / 12); ramp(d.delayTime, Math.max(0.0027, 1 / f), 0.02); ramp(fb.gain, 0.55 + v * 0.425); ramp(this.wet.gain, v * 0.72); ramp(this.dry.gain, 1 - v * 0.8); } }; });
    if (n === 'wobble') return mix((i, wet) => { const d = c.createDelay(0.06), o = lfo('sine'), o2 = lfo('triangle'); d.delayTime.value = 0.012; o.out.connect(d.delayTime); o2.out.connect(d.delayTime); i.connect(d).connect(wet); o.start(); o2.start(); return { set(v, k) { const hz = 0.3 + k * k * 9, w = Math.min(1, v * 8); o.hz = hz; o2.hz = hz * 2.7; o.osc.frequency.setTargetAtTime(o.hz, t(), 0.1); o2.osc.frequency.setTargetAtTime(o2.hz, t(), 0.1); ramp(o.out.gain, (v * v * 0.0075) / Math.max(0.6, hz * 0.45)); ramp(o2.out.gain, v * 0.0004); ramp(this.wet.gain, w); ramp(this.dry.gain, 1 - w); } }; });
    if (n === 'pulse') { const x = g(), o = lfo('square', 26); o.out.connect(x.gain); let was = 0; const u = { in: x, out: x, set(v, k) { const hz = 1 / (at(PRATE, k) * S.player.beatDur); ramp(x.gain, 1 - v * 0.5); ramp(o.out.gain, v * 0.5); if (Math.abs(hz - was) > 1e-6) { was = hz; o.hz = hz; o.start(); } }, sync() { o.hz = 1 / (at(PRATE, S.edge.k('pulse')) * S.player.beatDur); was = o.hz; o.start(); } }; return u; }
    if (n === 'fly') { const p = c.createStereoPanner(), o = lfo('sine'); o.out.connect(p.pan); let was = 0; return { in: p, out: p, set(v, k) { const hz = 1 / (at(FRATE, k) * S.player.beatDur); ramp(o.out.gain, v); if (Math.abs(hz - was) > 1e-6) { was = hz; o.hz = hz; o.start(); } }, sync() { o.hz = 1 / (at(FRATE, S.edge.k('fly')) * S.player.beatDur); was = o.hz; o.start(); } }; }
    if (n === 'far') { const f = c.createBiquadFilter(), x = g(); f.type = 'lowpass'; f.frequency.value = 20000; f.Q.value = 0.5; f.connect(x); return { in: f, out: x, set: (v, k) => { ramp(f.frequency, 20000 * (0.02 + (1 - k) * 0.2) ** v); ramp(x.gain, (1 - v * 0.94) ** 1.4); } }; }
    const x = g(); return { in: x, out: x, set: (v, k) => ramp(x.gain, Math.max(0, 1 - v) ** (0.6 + k * 2.4)) };   // fade
  }
}
