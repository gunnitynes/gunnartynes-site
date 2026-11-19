// The mixer. Every sound source in the studio is a channel strip: three-band EQ, heat (saturation), pump (ducking
// on every beat), pan, level, mute/solo, sends to the space (reverb) and echo, and how much of it goes through the
// Textures rack. The band is one strip as well, with every musician also on a slim strip of their own.
import { $, h } from '../lib/util.js';
import { knob } from './ui.js';

const db = (g) => (g <= 0.0001 ? '−∞' : `${(20 * Math.log10(g)).toFixed(1)}`);
export const faderGain = (v) => v * v * 1.5625;   // 0.8 → 0 dB

export class Strip {
  constructor(S, key, name, color, { inst = false } = {}) {
    const c = S.ctx, P = S.params, g = (v = 1) => { const n = c.createGain(); n.gain.value = v; return n; };
    Object.assign(this, { S, key, name, color, inst });
    this.input = g();
    const bq = (type, f, q = 0.7) => { const n = c.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q; return n; };
    this.lo = bq('lowshelf', 180); this.mid = bq('peaking', 1100, 0.8); this.hi = bq('highshelf', 5200);
    this.heat = c.createWaveShaper(); this.heat.oversample = '2x';
    this.pump = g(1); this.pumpDepth = g(0); this.pumpDepth.connect(this.pump.gain);
    this.pan = c.createStereoPanner(); this.fader = g(1); this.gate = g(1);
    this.meter = c.createAnalyser(); this.meter.fftSize = 512; this.buf = new Float32Array(512); this.level = 0;
    this.tex = g(1); this.dry = g(0); this.rev = g(0); this.dly = g(0);
    this.input.connect(this.lo).connect(this.mid).connect(this.hi).connect(this.heat).connect(this.pump).connect(this.pan).connect(this.fader).connect(this.gate);
    this.gate.connect(this.meter); this.gate.connect(this.tex).connect(S.tex.input); this.gate.connect(this.dry).connect(S.dryBus);
    this.gate.connect(this.rev).connect(S.engine.revIn); this.gate.connect(this.dly).connect(S.engine.dlyIn);
    const t = () => c.currentTime, k = `mix.${key}`;
    const shelf = (node) => (v) => node.gain.setTargetAtTime(v * 12, t(), 0.03);
    P.define(`${k}.level`, 0.8, () => this.setFader());
    P.define(`${k}.pan`, 0, (v) => this.pan.pan.setTargetAtTime(v, t(), 0.03));
    P.define(`${k}.low`, 0, shelf(this.lo)); P.define(`${k}.mid`, 0, shelf(this.mid)); P.define(`${k}.high`, 0, shelf(this.hi));
    P.define(`${k}.heat`, 0, (v) => { this.heat.curve = v < 0.01 ? null : heatCurve(v); });
    P.define(`${k}.pump`, 0, (v) => this.pumpDepth.gain.setTargetAtTime(v * 0.92, t(), 0.03));
    P.define(`${k}.space`, 0, (v) => this.rev.gain.setTargetAtTime(v * v, t(), 0.03));
    P.define(`${k}.echo`, 0, (v) => this.dly.gain.setTargetAtTime(v * v, t(), 0.03));
    P.define(`${k}.tex`, 1, (v) => { this.tex.gain.setTargetAtTime(v, t(), 0.03); this.dry.gain.setTargetAtTime(1 - v, t(), 0.03); });
    P.define(`${k}.mute`, false, () => S.mixGates?.()); P.define(`${k}.solo`, false, () => S.mixGates?.());
  }
  setFader() { const P = this.S.params, v = faderGain(P.get(`mix.${this.key}.level`) ?? 0.8) * (this.inst ? (P.get('inst.level') ?? 0.9) / 0.9 : 1); this.fader.gain.setTargetAtTime(v, this.S.ctx.currentTime, 0.03); }
  readLevel() { this.meter.getFloatTimeDomainData(this.buf); let pk = 0; for (const x of this.buf) pk = Math.max(pk, Math.abs(x)); this.level = Math.max(pk, this.level * 0.9); return this.level; }
}
function heatCurve(k) { const n = 1024, cv = new Float32Array(n), d = 1 + k * 9; for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; cv[i] = (Math.tanh(x * d) / Math.tanh(d)) * (1 - k * 0.25) + x * k * 0.05; } return cv; }

/** Creates the strips (before the instruments exist, so they can plug in) and the pump clock. */
export function buildStrips(S, COLORS, NAMES) {
  S.strips = {
    cloud: new Strip(S, 'cloud', NAMES[0], COLORS[0], { inst: true }),
    band: new Strip(S, 'band', 'Stems', '#ece8dc'),
  };
  // instrument strips come and go with the Forge's instruments (f1 … f7)
  S.addStrip = (n) => { const k = `f${n}`; if (!S.strips[k]) { S.strips[k] = new Strip(S, k, NAMES[n], COLORS[n], { inst: true }); S.mixAddStrip?.(S.strips[k]); restart(); S.mixGates(); } return S.strips[k]; };
  S.stripOrder = () => ['cloud', ...Object.keys(S.strips).filter((k) => /^f\d$/.test(k)).sort(), 'band'];
  S.mixGates = () => { const P = S.params, all = Object.values(S.strips), any = all.some((s) => P.get(`mix.${s.key}.solo`)); for (const s of all) { const on = !P.get(`mix.${s.key}.mute`) && (!any || P.get(`mix.${s.key}.solo`)); s.gate.gain.setTargetAtTime(on ? 1 : 0, S.ctx.currentTime, 0.01); } };
  // pump: one envelope per beat, started on the beat, feeding every strip's depth
  const c = S.ctx, p = S.player; let src = null;
  const restart = () => {
    try { src?.stop(); } catch { /* fine */ } src = null; if (!p.playing) return;
    const n = Math.round(c.sampleRate * p.beatDur), b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) { const t = i / c.sampleRate; d[i] = -Math.min(1, t / 0.004) * Math.exp(-t / (p.beatDur * 0.32)); }
    src = c.createBufferSource(); src.buffer = b; src.loop = true;
    for (const s of Object.values(S.strips)) src.connect(s.pumpDepth);
    src.start(Math.max(c.currentTime + 0.01, p.timeOfBeat(Math.ceil(p.beatNow() + 0.02))));
  };
  p.on('transport', restart); p.on('seek', restart);
  S.mixGates();
}

// ------------------------------------------------------------------------------------------- a vertical fader
function vfader(P, path, { fmt = (v) => db(faderGain(v)), color, label = 'Level' } = {}) {
  (P.range ??= {})[path] = [0, 1, label];
  const fill = h('i', { class: 'vf-fill' }), cap = h('i', { class: 'vf-cap' }), meter = h('i', { class: 'vf-meter' }), val = h('span', { class: 'vf-val' });
  const track = h('div', { class: 'vf-track' }, fill, meter, cap);
  const el = h('div', { class: 'vf', tabindex: 0, role: 'slider', 'aria-label': path, title: 'Level · drag, double-click for 0 dB', style: color ? { '--c': color } : {} }, track, val);
  const show = () => { const v = P.get(path); fill.style.height = `${v * 100}%`; cap.style.bottom = `${v * 100}%`; val.textContent = fmt(v); };
  let y0 = null, v0 = 0;
  track.addEventListener('pointerdown', (e) => { track.setPointerCapture(e.pointerId); const r = track.getBoundingClientRect(); if (!e.target.classList.contains('vf-cap')) P.set(path, +Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height)).toFixed(4)); y0 = e.clientY; v0 = P.get(path); el.classList.add('on'); });
  track.addEventListener('pointermove', (e) => { if (y0 === null) return; const r = track.getBoundingClientRect(); P.set(path, +Math.max(0, Math.min(1, v0 + (y0 - e.clientY) / r.height * (e.shiftKey ? 0.25 : 1))).toFixed(4)); });
  const up = () => { y0 = null; el.classList.remove('on'); }; track.addEventListener('pointerup', up); track.addEventListener('pointercancel', up);
  el.addEventListener('dblclick', () => P.reset(path));
  el.addEventListener('wheel', (e) => { e.preventDefault(); P.set(path, +Math.max(0, Math.min(1, P.get(path) - Math.sign(e.deltaY) * 0.02)).toFixed(4)); }, { passive: false });
  el.addEventListener('keydown', (e) => { const d = { ArrowUp: 1, ArrowDown: -1 }[e.key]; if (!d) return; e.preventDefault(); e.stopPropagation(); P.set(path, +Math.max(0, Math.min(1, P.get(path) + d * 0.02)).toFixed(4)); });
  P.on(({ path: p }) => p === path && show()); show();
  el.meter = meter;
  return el;
}
const msBtn = (P, path, label, cls, title) => { const b = h('button', { type: 'button', class: `ms ${cls}`, title, onclick: () => P.set(path, !P.get(path)) }, label); const s = () => b.setAttribute('aria-pressed', !!P.get(path)); P.on(({ path: p }) => p === path && s()); s(); return b; };

// ------------------------------------------------------------------------------------------- the Mix room
export function buildMixRoom(S, { recBtn }) {
  const P = S.params, room = $('#room-mix'), eng = S.engine, t = () => S.ctx.currentTime;
  const meters = [];
  const strip = (s) => {
    const k = `mix.${s.key}`, bip = { min: -1, max: 1, bipolar: true, fmt: (v) => (Math.abs(v) < 0.02 ? '0' : `${v > 0 ? '+' : ''}${(v * 12).toFixed(0)}`) };
    const vf = vfader(P, `${k}.level`, { color: s.color, label: `${s.name} level` }); meters.push([s, vf.meter]);
    return h('section', { class: 'ch', style: { '--c': s.color } },
      h('header', {}, h('i'), h('span', {}, s.name)),
      h('div', { class: 'ch-k' },
        knob(P, `${k}.high`, 'High', bip), knob(P, `${k}.heat`, 'Heat'),
        knob(P, `${k}.mid`, 'Mid', bip), knob(P, `${k}.pump`, 'Pump'),
        knob(P, `${k}.low`, 'Low', bip), knob(P, `${k}.tex`, 'Textures', { fmt: (v) => `${Math.round(v * 100)}%` }),
        knob(P, `${k}.space`, 'Space'), knob(P, `${k}.echo`, 'Echo')),
      h('div', { class: 'ch-pan' }, knob(P, `${k}.pan`, 'Pan', { min: -1, max: 1, bipolar: true, fmt: (v) => (Math.abs(v) < 0.02 ? 'C' : `${v < 0 ? 'L' : 'R'}${Math.round(Math.abs(v) * 100)}`) })),
      vf,
      h('div', { class: 'ch-ms' }, msBtn(P, `${k}.mute`, 'M', 'mute', 'Mute'), msBtn(P, `${k}.solo`, 'S', 'solo', 'Solo')));
  };
  const chs = h('div', { class: 'chs' });
  S.mixAddStrip = (s) => { const el = strip(s); el.dataset.k = s.key; chs.insertBefore(el, chs.querySelector('[data-k=band]')); };
  // returns and master
  P.define('mix.space.level', 0.8, (v) => eng.revOut.gain.setTargetAtTime(faderGain(v) * 0.85, t(), 0.05));
  P.define('mix.space.tone', 0.7, (v) => { (S.spaceTone ??= (() => { const f = S.ctx.createBiquadFilter(); f.type = 'lowpass'; eng.revOut.disconnect(); eng.revOut.connect(f).connect(eng.post); return f; })()).frequency.setTargetAtTime(600 * 33 ** v, t(), 0.05); });
  P.define('mix.echo.level', 0.8, (v) => eng.dlyOut.gain.setTargetAtTime(faderGain(v) * 0.8, t(), 0.05));
  P.define('mix.echo.fb', 0.45, (v) => eng.fb.gain.setTargetAtTime(v * 0.9, t(), 0.05));
  P.define('mix.echo.time', 0.75, (v) => { const d = Math.min(3.9, v * S.player.beatDur); eng.dL.delayTime.setTargetAtTime(d, t(), 0.08); eng.dR.delayTime.setTargetAtTime(d, t(), 0.08); });
  P.define('mix.master.level', 0.8, (v) => eng.master.gain.setTargetAtTime(faderGain(v) * 0.9, t(), 0.05));
  P.define('mix.master.glue', 0.3, (v) => { eng.glue.threshold.setTargetAtTime(-4 - v * 26, t(), 0.05); eng.glue.ratio.setTargetAtTime(1.5 + v * 4, t(), 0.05); });
  const ret = (key, name, kids) => { const vf = vfader(P, `mix.${key}.level`, { label: `${name} return` }); meters.push([{ readLevel: () => 0, key }, null]); return h('section', { class: 'ch ret' }, h('header', {}, h('i'), h('span', {}, name)), h('div', { class: 'ch-k one' }, ...kids), vf); };
  const mvf = vfader(P, 'mix.master.level', { color: '#e6b450', label: 'Master level' }); S.masterFader = mvf;
  const times = [[0.5, '1/8'], [0.75, '1/8.'], [1, '1/4'], [1.5, '1/4.'], [2, '1/2']];
  const timeSel = h('select', { title: 'Echo time', 'aria-label': 'Echo time', onchange: (e) => P.set('mix.echo.time', +e.target.value) }, ...times.map(([v, l]) => h('option', { value: v }, l)));
  P.on(({ path }) => path === 'mix.echo.time' && (timeSel.value = P.get('mix.echo.time'))); timeSel.value = P.get('mix.echo.time');

  // the musicians, slim
  const band = h('div', { class: 'musicians' });
  for (const st of S.song.stems) {
    const id = st.id, k = `band.${id}`;
    const v = vfader(P, `${k}.gain`, { fmt: (x) => Math.round(x * 100), label: `${st.name} level` }); S.bandMeters ??= []; S.bandMeters.push([id, v.meter]);
    queueMicrotask(() => { P.range[`${k}.pan`][2] = `${st.name} pan`; P.range[`${k}.rev`][2] = `${st.name} space`; });
    band.append(h('div', { class: 'mu' }, h('span', { class: 'mu-n', title: st.name }, st.name),
      knob(P, `${k}.pan`, 'Pan', { min: -1, max: 1, bipolar: true, fmt: (x) => (Math.abs(x) < 0.02 ? 'C' : `${x < 0 ? 'L' : 'R'}${Math.round(Math.abs(x) * 100)}`) }),
      knob(P, `${k}.rev`, 'Space'), v, h('div', { class: 'ch-ms' }, msBtn(P, `${k}.mute`, 'M', 'mute', 'Mute'), msBtn(P, `${k}.solo`, 'S', 'solo', 'Solo'))));
  }

  // mix memories: four snapshots of every level, pan, EQ and send; recalling one glides there
  S.mixMem ??= [null, null, null, null];
  const isMix = (p) => p.startsWith('mix.') || /^band\.[^.]+\.(gain|pan|rev|mute|solo)$/.test(p) || p === 'band.level' || p === 'inst.level';
  let storing = false, glide = null;
  const store = h('button', { type: 'button', class: 'pill', title: 'Then click a number to keep the mix there', onclick: () => { storing = !storing; store.classList.toggle('on', storing); } }, 'Store');
  const mems = [0, 1, 2, 3].map((i) => h('button', { type: 'button', title: 'Click to glide the mix here · Store, then click, to keep the mix here', onclick: () => {
    if (storing || !S.mixMem[i]) { S.mixMem[i] = Object.fromEntries(Object.entries(P.dump()).filter(([p]) => isMix(p))); storing = false; store.classList.remove('on'); showMem(); flash(i); return; }
    const to = S.mixMem[i], from = Object.fromEntries(Object.keys(to).map((p) => [p, P.get(p)])), t0 = performance.now(), dur = 900;
    for (const [p, v] of Object.entries(to)) if (typeof v !== 'number') P.set(p, v);
    cancelAnimationFrame(glide);
    const step = () => { const k = Math.min(1, (performance.now() - t0) / dur), e = k * k * (3 - 2 * k); for (const [p, v] of Object.entries(to)) if (typeof v === 'number' && typeof from[p] === 'number') P.set(p, +(from[p] + (v - from[p]) * e).toFixed(4)); if (k < 1) glide = requestAnimationFrame(step); };
    step(); flash(i);
  } }, String(i + 1)));
  const flash = (i) => { mems[i].classList.add('hit'); setTimeout(() => mems[i].classList.remove('hit'), 300); };
  const showMem = () => mems.forEach((b, i) => b.classList.toggle('has', !!S.mixMem[i]));
  showMem();
  const reset = h('button', { type: 'button', class: 'pill', title: 'Every fader, knob and send back to where it started', onclick: () => { for (const p of Object.keys(P.def)) if (isMix(p)) P.reset(p); } }, 'Reset the mix');

  room.append(
    h('div', { class: 'bar2' }, recBtn('Record mix moves'), h('span', { class: 'cap' }, 'every fader, knob and mute you move is kept, in the pattern or on the arrangement'), h('span', { class: 'sp' }), h('span', { class: 'cap' }, 'Mix memories'), h('div', { class: 'seg mems' }, ...mems), store, reset),
    h('div', { class: 'mixer' },
      h('div', { class: 'chwrap' }, chs,
        ret('space', 'Space', [knob(P, 'mix.space.tone', 'Tone')]),
        ret('echo', 'Echo', [knob(P, 'mix.echo.fb', 'Repeats'), timeSel]),
        h('section', { class: 'ch ret master' }, h('header', {}, h('i'), h('span', {}, 'Master')), h('div', { class: 'ch-k one' }, knob(P, 'mix.master.glue', 'Glue')), mvf)),
      h('div', { class: 'band-mix' }, h('span', { class: 'cap' }, 'Each stem'), band)));
  for (const k of S.stripOrder()) { const el = strip(S.strips[k]); el.dataset.k = k; chs.append(el); }
  S.rooms.mix = { draw: () => {
    for (const [s, m] of meters) if (m && s.readLevel) m.style.transform = `scaleY(${Math.min(1, s.readLevel() * 1.1)})`;
    S.masterFader.meter.style.transform = `scaleY(${Math.min(1, S.masterLevel || 0)})`;
    for (const [id, m] of S.bandMeters) { const ch = S.engine.channels.get(id); m.style.transform = `scaleY(${ch ? Math.min(1, ch.readLevel() * 3) : 0})`; }
  } };
}
