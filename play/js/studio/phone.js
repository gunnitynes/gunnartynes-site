// The playground in a pocket. The same engine as the studio (the stems, the Cloud, instruments made of slices,
// the Process rack, the arrangement), reshaped for a phone: five pages, big touch surfaces, and the phone's own
// motion as a controller — tilt bends what the page is about, a shake does something sudden, face-down freezes.
// There is one place things go: the tape (the arrangement). With ● on, every touch, tilt and change lands on it.
import { AudioEngine } from '../engine/audio.js';
import { wakeSpeaker } from '../lib/speaker.js';
import { CellLoader } from '../engine/loader.js';
import { Player } from '../engine/player.js';
import { Session, initialState } from '../state/session.js';
import { $, h, api } from '../lib/util.js';
import { Params, loadSource, loudestCells, loudestWindow, sliceOf, CloudVoice, SamplerVoice, StringsVoice, buildTextures, Sequencer, srcBar, shiftSrc, isTake, takeName } from './core.js';
import { buildStrips } from './mixer.js';
import { addVoiceStem, Voice, recButton, sourceOf } from './voice.js';
import { Walk, Surround } from './move.js';
import { Mutator } from './mutate.js';
import { loadFeatures } from './features.js';
import { Answer } from './answer.js';
import { Endless } from './endless.js';
import { openAtlas } from './atlas.js';
import { buildStems } from './phone-stems.js';
import { buildCloudPage } from './phone-cloud.js';
import { buildPlay } from './phone-inst.js';
import { buildTape } from './phone-tape.js';
import { Look } from './phone-look.js';
import { EdgeFx } from './phone-fx.js';
import { COLORS, NAMES } from './phone-kit.js';
import { Versions, ago } from './versions.js';
import { Work, loadParams, carry, saveFile, fileField, lastSaved } from './project.js';

const query = new URLSearchParams(location.search);
const S = { slots: [], rooms: {}, phone: true };
window.studio = S;
const MAX_SOUNDS = 4;
const NOTE = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const r3 = (v) => Math.round(v * 1000) / 1000;
const buzz = (ms = 8) => { try { navigator.vibrate?.(ms); } catch { /* none */ } };

boot().catch((e) => { console.error(e); $('#gate-status').textContent = 'Could not load: ' + e.message; });

async function boot() {
  const songId = query.get('song') || (await api.get('/api/songs'))[0]?.id;
  const song = await api.get(`/api/songs/${songId}`);
  addVoiceStem(song);   // "You": an empty stem until you record into it
  document.title = `${song.title} · Playground`;
  $('#title').textContent = song.title; $('#gate-title').textContent = song.title;
  $('#gate-meta').textContent = `${song.artist} · ${song.stems.length - 1} stems · ${song.bpm} bpm`;

  const engine = new AudioEngine({ latency: 'balanced' }); await engine.ready;   // a little more time to make the sound: no gaps when a lot happens
  await engine.ctx.audioWorklet.addModule(new URL('./dsp.js', import.meta.url));
  const loader = new CellLoader(engine.ctx, { max: 44, light: song.light ? song.cellDur : 0 });
  const ids = song.stems.map((s) => s.id);
  const session = new Session(initialState(song, { catalogIds: ids }));
  const player = new Player(engine, loader, session, song);
  player.prefetch = 3; player.ahead = 0.45;
  for (const s of song.stems) player.addSource(s.id, { id: s.id, kind: 'stem', name: s.name, cells: s.cells, gain: s.gain });
  Object.assign(S, { song, engine, ctx: engine.ctx, loader, session, player, params: new Params() });
  const P = S.params, work = (S.work = new Work(S, KEY())), kept = await work.read();

  // the same signal flow as the studio: strips → the Process rack and the dry bus → glue and limiter
  const tex = buildTextures(S); S.tex = tex; S.resFreqs = tex.resFreqs;
  S.dryBus = engine.ctx.createGain(); S.dryBus.connect(engine.lp);
  S.bandGate = engine.ctx.createGain();
  engine.bus.disconnect(); engine.post.disconnect();
  engine.post.connect(tex.input); tex.output.connect(engine.lp);
  // what you hear is always kept for the last half minute, so it can be captured after the fact (phone-tape.js)
  S.retro = new AudioWorkletNode(engine.ctx, 'retro', { numberOfOutputs: 1, outputChannelCount: [1], processorOptions: { seconds: 34 } }); // nothing leaves louder than it can be: rounded off softly instead of clipped
  const soft = engine.ctx.createWaveShaper(), cv = new Float32Array(4097); for (let i = 0; i < 4097; i++) { const x = (i / 2048 - 1) * 2, a = Math.abs(x); cv[i] = Math.sign(x) * (a < 0.75 ? a : 0.75 + 0.22 * Math.tanh((a - 0.75) / 0.22)); } const pre = engine.ctx.createGain(); pre.gain.value = 0.5; soft.curve = cv; engine.limit.disconnect(); engine.limit.connect(pre).connect(soft).connect(engine.master); soft.connect(S.retro); S.retroMute = engine.ctx.createGain(); S.retroMute.gain.value = 0; S.retro.connect(S.retroMute).connect(engine.ctx.destination);
  buildStrips(S, COLORS, NAMES);
  engine.bus.connect(S.bandGate).connect(S.strips.band.input);
  P.define('band.on', true, (v) => S.bandGate.gain.setTargetAtTime(v ? 1 : 0, S.ctx.currentTime, 0.04));
  P.define('band.level', 0.9, (v) => engine.bus.gain.setTargetAtTime(v, S.ctx.currentTime, 0.05));
  P.define('inst.level', 0.9, () => Object.values(S.strips).forEach((st) => st.inst && st.setFader()));
  for (const st of song.stems) for (const [k, d, f] of [['gain', 0.85, (v) => ({ gain: v })], ['mute', false, (v) => ({ mute: v })], ['solo', false, (v) => ({ solo: v })], ['pan', 0, (v) => ({ pan: v })]]) P.define(`band.${st.id}.${k}`, d, (v) => session.dispatch({ t: 'track/set', id: st.id, p: f(v) }, { log: false }));
  // a held beat-repeat as a number, so it can be recorded and replayed like any other move
  P.define('fx.rep.hold', 0, (v) => tex.repeat(v || 0));
  // tempo (Walk moves it; warped, so the pitch stays)
  P.define('song.bpm', song.bpm, (v) => player.setTempo(v, true));
  // the key: set on the computer, heard here too
  P.define('song.key', 0, (v) => player.setKey(v)); for (const st of song.stems) P.define(`band.${st.id}.key`, 0, (v) => player.setKey(v, st.id));
  (P.range ??= {})['fx.rep.hold'] = [0, 0.5, 'Repeat'];
  defineXY(P);

  S.seq = new Sequencer(S);
  P.recorder = (path, v) => S.seq.moveIn(path, v);
  S.voice = new Voice(S); S.walk = new Walk(S); S.surround = new Surround(S);
  // add-ons from the menu: the band answers you, the endless version, the Atlas
  S.mutate = new Mutator(S); S.answer = new Answer(S); S.endless = new Endless(S); S.say = (m) => toast(m);
  const featP = loadFeatures(S);
  S.heard = []; let retuneT = 0;
  S.noteSeen = (note, on) => { if (!on) return; S.heard = [note, ...S.heard.filter((n) => n !== note)].slice(0, 6); if (P.get('fx.res.follow') && !retuneT) retuneT = setTimeout(() => { retuneT = 0; tex.retune(); }, 60); };

  buildCloud(); buildSound(1, 'sampler'); buildSound(2, 'strings'); for (let n = 3; n <= MAX_SOUNDS && kept?.forges?.[n - 1]; n++) buildSound(n, 'sampler');
  const U = { toast, tiltSet, askSensors, Motion, srcAt, barNow, nextBar, bpb }; S.look = new Look(S); S.edge = new EdgeFx(S);
  buildTop(); buildStems(S, U); buildCloudPage(S, U); buildPlay(S, U); buildProcess(); buildTape(S, U); buildMove(); buildTabs();
  try { restore(kept); } catch (e) { console.error(e); work.aside(kept); }
  S.voice.ensureTrack(); S.voice.restore();
  P.set('song.bpm', S.keptBpm || song.bpm, { by: 'load' });   // a walking tempo is not kept: the pocket starts at the song's, or at the one a file from the computer brought
  const q = S.seq;
  if (!q.arr.bars) q.fillFromSong();
  q.mode = 'jam'; q.setMode('song');
  S.cloudInit(); S.sounds.forEach((s) => s.init());
  showPage(query.get('page') || 'stems'); tips();

  const first = ids.map((id) => player.resolve(session.state.tracks[id], 0)).filter(Boolean).map((w) => w.url);
  let n = 0; await Promise.all(first.map((u) => loader.load(u).catch(() => {}).finally(() => { $('#gate-bar').style.width = `${(++n / first.length) * 100}%`; })));
  // straight into the studio once the stems are in: the first touch unlocks the sound (and full screen, and on an
  // iPhone the question about motion), nothing plays until you press play
  $('#gate').classList.add('gone');
  if (query.get('open') === 'atlas') featP.then(() => { const u = new URL(location.href); u.searchParams.delete('open'); history.replaceState(null, '', u); openAtlas(S, { say: toast }); });
  // (an iPhone only counts a FINISHED touch as a touch, for sound and for the motion question)
  const touch1 = () => { for (const t of ['touchend', 'click']) removeEventListener(t, touch1, true); goFull(); wakeSpeaker(engine.ctx); };
  for (const t of ['touchend', 'click']) addEventListener(t, touch1, true);
  addEventListener('touchend', () => { if (engine.ctx.state !== 'running') engine.ctx.resume(); }, true);
  // two fingers belong to the sound, not to the page's own zoom
  for (const t of ['gesturestart', 'gesturechange']) addEventListener(t, (e) => e.preventDefault(), { passive: false });
  // the screen stays on while it plays
  let lock = null; const awake = async () => { try { if (player.playing && !lock && !document.hidden) { lock = await navigator.wakeLock?.request('screen'); lock?.addEventListener('release', () => { lock = null; }); } else if (!player.playing && lock) { lock.release(); lock = null; } } catch { /* not here */ } };
  player.on('transport', awake); document.addEventListener('visibilitychange', awake);
  requestAnimationFrame(frame);
  S.versions = new Versions(S, { pre: 'pocket:' }); S.openField = fileField(S, work, toast); work.start();
}
/** As much screen as the phone allows. Where a page may go full screen (Android, iPad) the first touch does it. An iPhone
 *  does not let a web page do that; opened from its home screen it has no browser around it at all (menu: Full screen). */
const FULL = document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen, standalone = () => navigator.standalone || matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches, isFull = () => document.fullscreenElement || document.webkitFullscreenElement;
function goFull() { try { if (FULL && !isFull() && !standalone()) FULL.call(document.documentElement, { navigationUI: 'hide' })?.catch?.(() => {}); } catch { /* not here */ } }
function fullMenu() { if (FULL) { if (isFull()) (document.exitFullscreen || document.webkitExitFullscreen).call(document); else goFull(); return; } const inn = $('#sheet').firstElementChild; setTimeout(() => { inn.replaceChildren(h('div', { class: 'mhead' }, h('span', { class: 'eyebrow' }, 'Full screen'), h('button', { type: 'button', class: 'mclose', 'aria-label': 'Close', onclick: closeMenu }, '×')), h('h3', {}, 'On an iPhone'), h('ul', { class: 'help' }, h('li', {}, 'Tap the Share button in Safari’s bar.'), h('li', {}, 'Choose “Add to Home Screen”, then Add.'), h('li', {}, 'Open Playground from your home screen: the whole screen is yours.'))); $('#sheet').hidden = false; requestAnimationFrame(() => $('#sheet').classList.add('on')); }, 260); }

// ------------------------------------------------------------------------------------------------ motion
// Tilt is measured from how you held the phone when motion was switched on (so any comfortable angle is "centre").
// x: tilt left (−1) … right (+1) · y: tilt towards you (−1) … away (+1). Shake and face-down are events.
const Motion = {
  on: false, got: false, x: 0, y: 0, b0: null, g0: null, down: false, lastShake: 0, subs: { tilt: null, shake: null, face: null },
  async ask() {
    try { if (typeof DeviceOrientationEvent?.requestPermission === 'function') { const r = await DeviceOrientationEvent.requestPermission(); if (r !== 'granted') return; } } catch { return; }
    try { if (typeof DeviceMotionEvent?.requestPermission === 'function') await DeviceMotionEvent.requestPermission(); } catch { /* tilt still works */ }
    this.set(true);
  },
  set(on) { this.on = on; this.b0 = null; this.x = this.y = 0; $('#motion').setAttribute('aria-pressed', on); document.body.classList.toggle('moving', on); },
  orient(e) {
    if (e.beta == null) return; this.got = true; document.body.classList.add('has-motion');
    const down = Math.abs(e.beta) > 125;
    if (down !== this.down) { this.down = down; if (this.on) this.subs.face?.(down); }
    if (!this.on || down) return;
    if (this.b0 === null) { this.b0 = e.beta; this.g0 = e.gamma; }
    const tx = clamp((e.gamma - this.g0) / 32, -1, 1), ty = clamp((this.b0 - e.beta) / 32, -1, 1);
    this.x += (tx - this.x) * 0.3; this.y += (ty - this.y) * 0.3;
    if (!S.walk?.on && !S.surround?.on) this.subs.tilt?.(this.x, this.y);   // walking or turning: the body is busy
  },
  motion(e) {
    if (!this.on) return; const a = e.acceleration; let m = 0;
    if (a && a.x != null) m = Math.hypot(a.x, a.y, a.z);
    else if (e.accelerationIncludingGravity) { const g = e.accelerationIncludingGravity, mm = Math.hypot(g.x, g.y, g.z); m = Math.abs(mm - 9.81) * 1.2; }
    const now = performance.now();
    if (S.walk?.on) return;
    // a knock: one short jolt out of stillness, and not from a finger on the glass
    const quiet = this.q ?? 0; this.q = quiet + (m - quiet) * 0.18;
    if (this.subs.knock && m > 2.6 && quiet < 0.7 && now - (this.lastKnock || 0) > 160 && now - (this.lastTouch || 0) > 260) { this.lastKnock = now; this.subs.knock(Math.min(1, m / 9)); }
    if (m > 15 && now - this.lastShake > 700) { this.lastShake = now; buzz(20); this.subs.shake?.(); }
  },
};
addEventListener('deviceorientation', (e) => Motion.orient(e));
addEventListener('devicemotion', (e) => Motion.motion(e));
for (const t of ['pointerdown', 'pointerup']) addEventListener(t, () => { Motion.lastTouch = performance.now(); }, true);
/** Set a param from motion only when it really changed (tilt is noisy, and every change is a recorded move). */
const tiltSet = (path, v, step = 0.01) => { v = Math.round(v / step) * step; if (Math.abs((S.params.get(path) ?? 0) - v) >= step * 0.99) S.params.set(path, +v.toFixed(4)); };

// ------------------------------------------------------------------------------------------------ sounds
function defineXY(P) {
  const apply = () => {
    const x = P.get('fx.xy.x'), y = P.get('fx.xy.y'); if (x === undefined || y === undefined) return;
    P.set('fx.filter.lp', x < 0.5 ? 0.35 + x * 1.3 : 1, { by: 'macro' }); P.set('fx.filter.hp', x > 0.5 ? (x - 0.5) * 1.3 : 0, { by: 'macro' });
    P.set('fx.res.mix', Math.max(0, y - 0.2) * 0.9, { by: 'macro' }); P.set('fx.shim.mix', y * 0.75, { by: 'macro' }); P.set('fx.tape.mix', Math.min(1, y * 1.4), { by: 'macro' });
  };
  P.define('fx.xy.mode', 'gesture'); P.define('fx.xy.x', 0.5, apply); P.define('fx.xy.y', 0, apply);
  P.range['fx.xy.x'] = [0, 1, 'Process across']; P.range['fx.xy.y'] = [0, 1, 'Process up'];
}
function buildCloud() {
  const P = S.params, voice = new CloudVoice(S, S.strips.cloud.input);
  S.slots[0] = { name: 'Cloud', voice };
  const send = (k) => (v) => voice.set({ [k]: v });
  P.define('cloud.pos', 0.3, send('pos')); P.define('cloud.size', 0.35, (v) => voice.set({ size: 10 + 990 * v ** 2 }));
  P.define('cloud.density', 0.4, (v) => voice.set({ density: 1 + 119 * v ** 1.6 })); P.define('cloud.spread', 0.08, send('spread'));
  P.define('cloud.pitch', 0, send('pitch')); P.define('cloud.jitter', 0, send('jitter')); P.define('cloud.reverse', 0, send('reverse'));
  P.define('cloud.width', 0.7, send('width')); P.define('cloud.scan', 0, (v) => voice.set({ scan: v * v * Math.sign(v) * 2 }));
  P.define('cloud.shape', 0.2, send('shape')); P.define('cloud.attack', 0.1, (v) => voice.set({ attack: 0.002 + v * v * 4 }));
  P.define('cloud.release', 0.35, (v) => voice.set({ release: 0.02 + v * v * 8 })); P.define('cloud.level', 0.75, send('level'));
  P.define('cloud.freeze', false, send('freeze')); P.define('cloud.drone', false, send('drone')); P.define('cloud.sizejit', 0.3, (v) => voice.set({ sizeJit: v }));
  Object.assign(P.range, { 'cloud.pos': [0, 1, 'Where'], 'cloud.size': [0, 1, 'Size'], 'cloud.pitch': [-24, 24, 'Pitch'], 'cloud.spread': [0, 0.5, 'Spray'], 'cloud.jitter': [0, 12, 'Scatter'] });
  S.cloud = { voice, src: null };
  /** Grains from a source: a stretch of a stem, or a sound you recorded ({ rec }). */
  S.useCloudSource = (src, ref, fresh = true) => {
    S.cloudSrc = ref; S.cloud.src = src; voice.setSource(src); S.cloud.peaks = peaks(src);
    if (fresh) P.set('cloud.pos', +(loudestWindow(src, 0.1) + (ref.rec ? 0.02 : 0.05)).toFixed(4), { by: 'load' });
    S.cloud.changed?.();
  };
  S.setCloudSource = async (stemId, a, b) => { const ref = { stemId, a, b }; S.useCloudSource(await loadSource(S, stemId, a, b), ref); };
  const st0 = S.song.stems.find((s) => /piano/i.test(s.name)) || S.song.stems[0];
  S.cloudInit = () => {
    const c = S.cloudSrc || { stemId: st0.id, ...(([a, b]) => ({ a, b }))(loudestCells(st0, 2)) };
    if (c.rec) { sourceOf(S, c, loadSource).then((src) => S.useCloudSource(src, c, false)).catch(() => { S.cloudSrc = null; S.cloudInit(); }); return; }
    S.setCloudSource(c.stemId, c.a, c.b);
  };
}
const peaks = (src, n = 300) => { const out = new Float32Array(n), step = src.L.length / n; for (let i = 0; i < n; i++) { let m = 0; for (let j = Math.floor(i * step), k = Math.floor((i + 1) * step); j < k; j += 16) m = Math.max(m, Math.abs(src.L[j])); out[i] = m; } let mx = 0; for (const v of out) mx = Math.max(mx, v); if (mx > 0) for (let i = 0; i < n; i++) out[i] /= mx; return out; };

S.sounds = [];
function buildSound(n, engine) {
  const P = S.params, k = `f${n}`, out = S.ctx.createGain(), breath = S.ctx.createGain(); out.connect(breath).connect(S.addStrip(n).input);
  const voices = { sampler: new SamplerVoice(S, out), strings: new StringsVoice(S, out), grains: new CloudVoice(S, out) };
  const slot = { name: NAMES[n], voices, get voice() { return voices[P.get(`${k}.engine`)]; } };
  S.slots[n] = slot; P.set(`mix.${k}.mute`, false, { by: 'load' });
  P.define(`${k}.tune`, 0, (v) => { voices.sampler.root = voices.grains.root = 60 - v; voices.strings.tune = v; });
  Object.assign(P.range ??= {}, { [`${k}.tune`]: [-24, 24, 'Pitch'] });
  let src = null;
  const reslice = () => { if (!src) return; let [a, b] = P.get(`${k}.sel`).split(':').map(Number); if (!isFinite(a) || !isFinite(b)) [a, b] = [0.2, 0.3]; const sl = sliceOf(src, a, b); voices.sampler.setSlice(sl); voices.strings.setSlice(sl); voices.grains.setSource(sl); };
  P.define(`${k}.sel`, '0.2:0.3', reslice);
  const COMP = { sampler: 1, strings: 5, grains: 4.5 }, lvl = () => out.gain.setTargetAtTime((P.get(`${k}.level`) ?? 0.8) * COMP[P.get(`${k}.engine`)], S.ctx.currentTime, 0.03);
  P.define(`${k}.engine`, engine, () => { for (const v of Object.values(voices)) v.panic(); lvl(); });
  P.define(`${k}.level`, 0.8, lvl);
  const sm = (p, f) => (v) => voices.sampler.set({ [p]: f ? f(v) : v });
  P.define(`${k}.s.attack`, 0.02, sm('attack', (v) => 0.002 + v * v * 3)); P.define(`${k}.s.release`, 0.3, sm('release', (v) => 0.02 + v * v * 6));
  P.define(`${k}.s.cutoff`, 0.8, sm('cutoff')); P.define(`${k}.s.res`, 0.15, sm('res')); P.define(`${k}.s.env`, 0.3, sm('env'));
  P.define(`${k}.s.loop`, true, sm('loop')); P.define(`${k}.s.reverse`, false, sm('reverse'));
  const sp = (p, f) => (v) => voices.strings.set({ [p]: f ? f(v) : v });
  P.define(`${k}.t.decay`, 0.7, sp('decay', (v) => 0.97 + v * 0.0295)); P.define(`${k}.t.bright`, 0.5, sp('bright')); P.define(`${k}.t.excite`, 0.25, sp('excite', (v) => 0.005 + v * v * 1.2));
  P.define(`${k}.t.detune`, 0.2, sp('detune', (v) => v * 0.012)); P.define(`${k}.t.body`, 0.15, sp('body')); P.define(`${k}.t.release`, 0.3, sp('release', (v) => 0.02 + v * 3));
  const gp = (p, f) => (v) => voices.grains.set({ [p]: f ? f(v) : v });
  voices.grains.set({ pos: 0.5, freeze: true, width: 0.9 });
  P.define(`${k}.g.size`, 0.6, gp('size', (v) => 20 + 980 * v * v)); P.define(`${k}.g.spread`, 0.25, gp('spread', (v) => v * 0.5));
  P.define(`${k}.g.density`, 0.55, gp('density', (v) => 2 + 100 * v * v)); P.define(`${k}.g.jitter`, 0.05, gp('jitter', (v) => v * 7));
  P.define(`${k}.g.attack`, 0.35, gp('attack', (v) => 0.005 + v * v * 4)); P.define(`${k}.g.release`, 0.5, gp('release', (v) => 0.05 + v * v * 9));
  let asked = 0; const load = async (stemId, a, b, fresh) => { const t = ++asked, s0 = await loadSource(S, stemId, a, b); if (t !== asked) return; slot.src = { stemId, a, b }; src = s0; if (fresh) { const x = loudestWindow(src, 0.06); P.set(`${k}.sel`, `${x.toFixed(4)}:${(x + 0.06).toFixed(4)}`, { by: 'load' }); } reslice(); S.soundChanged?.(); };
  const def = S.song.stems[(n * 5) % S.song.stems.length];
  const sound = {
    n, k, slot, breath, get src() { return src; },
    init: () => {
      if (slot.src?.rec) { sourceOf(S, slot.src, loadSource).then((s0) => sound.useRec(s0, false)).catch(() => { slot.src = null; sound.init(); }); return; }
      const c = slot.src || { stemId: def.id, ...(([a, b]) => ({ a, b }))(loudestCells(def, 1)) }; load(c.stemId, c.a, c.b, !slot.src);
    },
    /** A sound you recorded becomes this instrument's source. */
    useRec(s0, fresh = true) { asked++; slot.src = { rec: s0.rec }; src = s0; if (fresh) { const x = loudestWindow(s0, 0.08); P.set(`${k}.sel`, `${x.toFixed(4)}:${Math.min(1, x + Math.max(0.08, Math.min(0.5, 0.6 / s0.dur))).toFixed(4)}`, { by: 'load' }); } reslice(); S.soundChanged?.(); },
    /** Made from this stem: its loudest four bars, or those from cell `a` on. */
    async use(stemId, a) { const st = S.song.stems.find((x) => x.id === stemId), c = a ?? loudestCells(st, 1)[0]; await load(stemId, c, c + 1, true); },
    drop() { for (const v of Object.values(voices)) v.panic?.(); for (const v of [voices.strings, voices.grains]) v.node.disconnect(); out.disconnect(); breath.disconnect(); },
    /** A new sound: a random stem, a random loud-ish moment of it, a short slice of that. */
    async surprise() {
      const st = S.song.stems.filter((x) => x.cells.filter(Boolean).length > 3)[Math.floor(Math.random() * S.song.stems.length)] || def;
      const live = st.cells.map((c, i) => (c && c.rms > -40 ? i : -1)).filter((i) => i >= 0), c = live.length ? live[Math.floor(Math.random() * live.length)] : loudestCells(st, 1)[0];
      await load(st.id, c, c + 1, false);
      const x = clamp(loudestWindow(src, 0.06) + (Math.random() - 0.5) * 0.3, 0, 0.9); P.set(`${k}.sel`, `${x.toFixed(4)}:${(x + 0.04 + Math.random() * 0.08).toFixed(4)}`);
      return st.name;
    },
    get srcName() { return slot.src?.rec ? 'your recording' : S.song.stems.find((x) => x.id === slot.src?.stemId)?.name || '…'; },
  };
  S.sounds.push(sound); return sound;
}
/** One more instrument (its stem is chosen next), and the last one away again. */
S.canAdd = () => S.sounds.length < MAX_SOUNDS;
S.addSound = () => { if (!S.canAdd()) return null; const s = buildSound(S.sounds.length + 1, 'sampler'); S.moreForges = (S.moreForges || []).slice(1); s.init(); S.soundsChanged?.(); return s; };
S.removeSound = () => {
  const n = S.sounds.length; if (n <= 2 || !confirm(`Remove ${NAMES[n]}? What it plays leaves the timeline too (undo brings that back).`)) return false;
  S.seq.snapshot(); S.seq.arr.clips = S.seq.arr.clips.filter((c) => c.lane !== n); S.seq.changed();
  S.sounds.pop().drop(); S.slots.length = n; S.params.set(`mix.f${n}.mute`, true, { by: 'load' }); S.params.set('pocket.slot', n - 1, { by: 'ui' }); S.soundsChanged?.(); return true;
};

// ------------------------------------------------------------------------------------------------ top bar
function buildTop() {
  const { player, seq, session } = S;
  $('#play').onclick = () => (player.playing ? player.stop() : player.play());
  $('#rec').onclick = () => { seq.arm(!seq.rec); if (seq.rec && !player.playing) player.play(); buzz(15); };
  $('#undo').onclick = () => { if (seq.undo()) toast('Undone'); };
  $('#motion').onclick = () => { if (!Motion.on && !Motion.got) { Motion.ask().then(() => { if (!Motion.got) toast('No motion sensors here — on a phone, tilt and shake work'); }); return; } Motion.set(!Motion.on); toast(Motion.on ? 'Motion on: hold the phone comfortably, that is the centre' : 'Motion off'); };
  player.on('transport', ({ playing }) => { $('#play').classList.toggle('on', playing); });
  const sync = () => {
    $('#rec').classList.toggle('on', seq.rec); document.body.classList.toggle('recording', seq.rec);
    $('#undo').disabled = !seq.undos.length;
  };
  seq.addEventListener('change', sync); sync();
  S.seek = (bar) => session.dispatch({ t: 'seek', bar });
  $('#menu').onclick = () => openMenu();
  $('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') closeMenu(); });
}

// ------------------------------------------------------------------------------------------------ menu and help
// The pages carry as little text as they can; how each one works is here, one tap away.
const HELP = {
  stems: ['Every disc is an instrument. In the middle the song is as it is. Each edge is an effect: the nearer a disc lies to it, the more it takes on, and between two edges it takes on both. The line on top says what the disc in your hand is getting.', 'Tap an edge to choose its effect. Slide the handle along it to change the effect’s character.', 'Pinch a disc: bigger is louder. Tap it: off and on. Hold it: alone. Two fingers on the bare table gather, spread or turn everyone.', 'Drop one into a pool and it is held, reversed, halved, stuttered or sent wandering for as long as it lies there.', 'Orbit: a disc keeps making the movement you made with it, in time. Roll: tilt the phone and they roll. Shake: they scatter. Line up puts everything back.'],
  cloud: ['One finger on the wave plays it: across is where in the sound, up and down is what the ↕ button says.', 'The strip under it is the whole sound. Drag its two handles, or what lies between them, to choose the buffer; pinching the wave does the same. “8 bars” makes the sound longer or shorter.', 'Eight characters, far apart: tap one and the cloud glides there. Controls has all sixteen settings: put a finger on one and slide. Two taps put it back. The name on top chooses another stem.', 'Harmony sends grains a fifth or an octave away; Rhythm locks them to the beat.', 'A to D keep a cloud and glide back to it. With motion on, tilt moves through the sound, a shake picks another character.'],
  play: ['Cloud, 1 and 2 are your instruments; + makes another. The pads at the bottom always play the one you are on, in all three windows.', 'Source: tap the name to choose which stem it is made from. The line of bars is that stem through the song: slide along it for another place. The wave is the slice itself: drag it, drag its ends, or pinch.', 'Field: four sounds in its corners, your finger between them. Hold a corner to keep the sound as it is there; Corners (or a shake) makes four others. Auto moves the point by itself, round the last movement you made; the button next to it is how long once round takes.', 'Controls: put a finger anywhere on one and slide, across or up and down. Two taps put it back.', 'Breath: hold a pad and blow into the microphone. Knock: knock on the phone and the last note plays. While a pad is held, tilt bends its tone and adds echo. On its side, the pads fill the screen.'],
  process: ['One gesture moves the filter, tape, resonators and shimmer together.', 'Look: the song takes the colour of what the camera sees. Light brightens it, colour makes it ring. The picture stays on the phone.', 'Hold the buttons for an echo throw or a repeat; the others switch on and off.', 'With motion on: tilt moves the dot, a shake throws everything into the echo. On any page: lay the phone face down and everything freezes.'],
  tape: ['Timeline is the tape itself. Press ● anywhere and what you do is written here, where the playhead is: notes join those already there, moves replace only their own kind, pools write what each stem played.', 'Drag on the numbers to move the playhead. Pinch to zoom, drag a lane to look around. Tap a lane’s name to switch it off and on.', 'Tap a part, then drag it, drag its ends, or use the row below: split, again, loop, backwards, delete. ↶ undoes.', 'Pieces: the phone always listens to itself. The strip is the last half minute: swipe across a part to keep it, or press 1, 2, 4 or 8 for the last bars. Paint tools over its slices; ½ and ×2 change its length, ÷ how fine it is cut, Mix finds a new order. → Timeline puts it on the tape.', 'Mic records the microphone onto the timeline.'],
  move: ['Walk: press it and walk. Your pace becomes the tempo; the stems stretch to it and keep their pitch. Stand still and they sink back while the Cloud holds a drone. No sensors? Tap your steps on the pad.', 'Turn: headphones on, stand up. The stems are in a circle around you; turn and the band turns. The one you face comes forward; keep facing it and you hear it almost alone. Or drag the circle.'],
};
function openMenu() {
  const sh = $('#sheet'), inn = sh.firstElementChild, page = S.page;
  const titles = { stems: 'Stems', cloud: 'Cloud', play: 'Instruments', process: 'Process', tape: 'Tape', move: 'Move' };
  const item = (label, fn, cls = '') => h('button', { type: 'button', class: 'mitem ' + cls, onclick: () => { closeMenu(); fn(); } }, label);
  const bounceB = h('button', { type: 'button', class: 'mitem', onclick: () => bounce(bounceB) }, 'Save the tape as a sound');
  inn.replaceChildren(
    h('div', { class: 'mhead' }, h('span', { class: 'eyebrow' }, 'Playground'), h('button', { type: 'button', class: 'mclose', 'aria-label': 'Close', onclick: closeMenu }, '×')),
    h('h3', {}, titles[page] || ''),
    h('ul', { class: 'help' }, ...(HELP[page] || []).map((t) => h('li', {}, t))),
    h('div', { class: 'mlist' },
      ...(S.feat ? [
        item(S.answer.on ? 'The band answers you: on' : 'The band answers you', () => { S.answer.set(!S.answer.on); if (S.answer.on && !S.player.playing) S.player.play(); toast(S.answer.on ? 'Play a phrase on Instruments, then leave a bar of quiet' : 'Answers off'); }, S.answer.on ? 'on' : ''),
        item(S.endless.on ? 'Endless version: on' : 'Endless version', () => { S.endless.set(!S.endless.on); toast(S.endless.on ? 'The song keeps going and never repeats' : 'Back to your arrangement'); }, S.endless.on ? 'on' : ''),
        ...(S.mutate.live.length ? [item('Keep what is changing now', () => { const n = S.mutate.keep(); toast(n ? `Kept ${n} on the tape` : 'Nothing to keep'); })] : []),
        item('Open the Atlas', () => openAtlas(S, { say: toast })),
      ] : []),
      item(Motion.on ? 'Motion off' : 'Motion on (tilt and shake)', () => $('#motion').click()),
      bounceB,
      ...(S.seq.canCapture() ? [item('Keep the last notes and moves', () => { const r = S.seq.capture(); toast(r ? `Kept at bar ${r.bar + 1} of the tape` : 'Nothing to keep'); })] : []),
      ...(standalone() ? [] : [item(FULL && isFull() ? 'Leave full screen' : 'Full screen', fullMenu)]),
      item('Open the full studio', () => { location.href = `play.html?song=${S.song.id}&desktop=1`; }),
      h('p', { class: 'mkept' }, 'Your work is kept in this browser. ', lastSaved(S) ? `Last saved as a file ${ago(lastSaved(S))}.` : 'A file keeps it safe, and opens in the full studio on a computer too.'),
      item('Save the project as a file', saveProject), item('Open a project file', () => S.openField.click()), ...(S.versions.list.length ? [item('Earlier versions', versionSheet)] : []),
      item('Start again', () => { if (confirm('Start from the song again? What is here now stays under Earlier versions.')) S.work.replace(null, 'before starting again').catch((e) => toast('It could not be cleared: ' + e.message)); }, 'faint'),
      item('gunnar tynes', () => { location.href = '/'; }, 'faint')));
  sh.hidden = false; requestAnimationFrame(() => sh.classList.add('on'));
}
async function saveProject() { try { await saveFile(S, 'phone'); } catch (e) { toast('The project could not be saved: ' + e.message); } }
function versionSheet() {
  setTimeout(() => {
    const sh = $('#sheet');
    sh.firstElementChild.replaceChildren(h('div', { class: 'mhead' }, h('span', { class: 'eyebrow' }, 'Earlier versions'), h('button', { type: 'button', class: 'mclose', 'aria-label': 'Close', onclick: closeMenu }, '×')),
      h('p', { class: 'mkept' }, 'Put aside every few minutes. Going back to one keeps what you have now as a version too.'),
      h('div', { class: 'mlist' }, ...S.versions.list.slice(0, 20).map((v) => h('button', { type: 'button', class: 'mitem ver', onclick: () => S.work.replace(v.data, 'before going back').catch((e) => toast('It could not be opened: ' + e.message)) }, h('b', {}, ago(v.ts)), h('small', {}, v.summary)))));
    sh.hidden = false; requestAnimationFrame(() => sh.classList.add('on'));
  }, 240);
}
function closeMenu() { const sh = $('#sheet'); sh.classList.remove('on'); setTimeout(() => { sh.hidden = true; }, 220); }
function buildTabs() { document.querySelectorAll('#tabs button').forEach((b) => { b.onclick = () => { showPage(b.dataset.p); buzz(5); }; }); }
/** The first time on a page, one line says where to begin; it is gone for good once that place has been touched. */
function tips() {
  const key = 'playground.tips', seen = new Set(), mark = (k) => { if (seen.has(k)) return; seen.add(k); try { localStorage.setItem(key, JSON.stringify([...seen])); } catch { /* private browsing: shown again next time */ } };
  try { for (const k of JSON.parse(localStorage.getItem(key)) || []) seen.add(k); } catch { /* none yet */ }
  for (const [k, where, text] of [
    ['stems', '#p-stems .table', 'Press ▶\uFE0E, then drag one to an edge'],
    ['cloud', '#p-cloud .surface', 'Touch the wave and hold'],
    ['play', '#p-play .slice', 'Tap the name to choose a stem'],
    ['process', '#p-process .xy', 'Drag the dot: the whole song follows'],
    ['tape', '#p-tape .tline', 'Press ● and what you do is written here'],
  ]) {
    const box = document.querySelector(where); if (!box || seen.has(k)) continue;
    const t = h('p', { class: 'tip', 'aria-hidden': 'true' }, ...text.split('●').flatMap((x, i) => (i ? [h('i', {}, '●'), x] : [x]))); box.append(t);
    const gone = () => { t.classList.add('gone'); setTimeout(() => t.remove(), 500); mark(k); box.removeEventListener('pointerdown', gone); };
    box.addEventListener('pointerdown', gone);
    if (k === 'tape') S.seq.addEventListener('change', () => { if (S.seq.rec && t.isConnected) gone(); });
  }
  // until the song has been played once, the play button draws the eye
  if (!seen.has('played')) { const b = $('#play'); b.classList.add('first'); S.player.on('transport', ({ playing }) => { if (playing) { b.classList.remove('first'); mark('played'); } }); }
}
function showPage(id) {
  if (!S.rooms[id]) id = 'stems';
  if (S.page !== id) S.rooms[S.page]?.hide?.();
  S.page = id;
  document.querySelectorAll('.page').forEach((p) => { p.hidden = p.id !== `p-${id}`; });
  document.querySelectorAll('#tabs button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.p === id));
  const r = S.rooms[id]; Motion.subs = { tilt: r.tilt || null, shake: r.shake || null, knock: r.knock || null, face: r.face || faceFreeze };
  const u = new URL(location.href); u.searchParams.set('page', id); history.replaceState(null, '', u);
  requestAnimationFrame(() => r.show?.());
}
/** On every page: lay the phone face down and everything freezes into a shimmer; pick it up and it lets go. */
function faceFreeze(down) {
  const P = S.params;
  if (down) { faceFreeze.was = [P.get('fx.shim.mix'), P.get('fx.shim.freeze')]; P.set('fx.shim.mix', Math.max(0.7, P.get('fx.shim.mix'))); P.set('fx.shim.freeze', true); P.set('band.on', false); toast('Face down: frozen'); buzz(30); }
  else if (faceFreeze.was) { P.set('band.on', true); P.set('fx.shim.freeze', faceFreeze.was[1]); P.set('fx.shim.mix', faceFreeze.was[0]); faceFreeze.was = null; }
}
/** Only what you could not know otherwise (something is not allowed, missing, or failed) is worth a message. */
const WORTH = /not allowed|no microphone|no camera|nothing was heard|silence|sensors|needs|could not|is gone|stopped:|half minute|first whole bar/i;
function toast(msg) { if (!WORTH.test(msg)) return; const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2600); }
const cap = (t) => h('p', { class: 'cap' }, t);
const tiltLine = (t) => h('p', { class: 'tilt' }, h('i'), t);

// ------------------------------------------------------------------------------------------------ helpers on the tape
const bpb = () => S.song.beatsPerBar;
/** The bar the playhead is on (on the tape), and the next bar line (where a change can start without a jump). */
const barNow = () => Math.floor(S.seq.tl(S.seq.nowBeat()) / bpb());
const nextBar = () => barNow() + (S.player.playing ? 1 : 0);
/** Which bar of the original the stems play at a tape bar. */
function srcAt(bar) { const cl = S.seq.arr.clips.find((c) => c.lane === 'band' && bar >= c.start && bar < c.start + c.len); return cl ? srcBar(cl, bar - cl.start, S.song.numBars).bar : bar % S.song.numBars; }
function writeBand(make, label) {
  const q = S.seq, at = nextBar(), clip = { lane: 'band', start: at, len: 4, ...make(at) };
  q.snapshot(); q.place(clip); if (at + 4 > q.arr.bars) q.arr.bars = at + 4; q.changed();
  toast(`${label} · bars ${at + 1}–${at + 4} · ↶ undoes`); buzz(12);
}

// ------------------------------------------------------------------------------------------------ page: process
function buildProcess() {
  const room = $('#p-process'), P = S.params;
  const pad = h('div', { class: 'xy' }, h('span', { class: 'ax l' }, 'darker'), h('span', { class: 'ax r' }, 'brighter'), h('span', { class: 'ax t' }, 'ringing'), h('span', { class: 'ax b' }, 'dry'), h('i', { class: 'dot' }));
  const dot = pad.querySelector('.dot');
  let touching = false;
  const at = (e) => { const r = pad.getBoundingClientRect(); P.set('fx.xy.x', r3(clamp((e.clientX - r.left) / r.width, 0, 1))); P.set('fx.xy.y', r3(clamp(1 - (e.clientY - r.top) / r.height, 0, 1))); };
  pad.addEventListener('pointerdown', (e) => { e.preventDefault(); touching = true; pad.setPointerCapture(e.pointerId); at(e); });
  pad.addEventListener('pointermove', (e) => touching && at(e));
  const lift = () => { touching = false; }; pad.addEventListener('pointerup', lift); pad.addEventListener('pointercancel', lift);
  const showDot = () => { dot.style.left = `${P.get('fx.xy.x') * 100}%`; dot.style.top = `${(1 - P.get('fx.xy.y')) * 100}%`; };
  P.on(({ path }) => path.startsWith('fx.xy') && showDot()); showDot();
  // hold buttons: act while a finger is on them; toggles: tap on, tap off
  const hold = (label, title, down, upFn) => { const b = h('button', { type: 'button', class: 'fxb hold', title }, h('b', {}, label), h('small', {}, 'hold')); b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.classList.add('on'); down(); buzz(8); }); const u = () => { if (!b.classList.contains('on')) return; b.classList.remove('on'); upFn(); }; b.addEventListener('pointerup', u); b.addEventListener('pointercancel', u); b.addEventListener('pointerleave', u); b.addEventListener('contextmenu', (e) => e.preventDefault()); return b; };
  const tog = (label, path, onV, offV) => { const b = h('button', { type: 'button', class: 'fxb', onclick: () => { P.set(path, P.get(path) === onV ? offV : onV); buzz(6); } }, h('b', {}, label), h('small', {}, 'on / off')); const s = () => b.classList.toggle('on', P.get(path) === onV); P.on(({ path: p }) => p === path && s()); s(); return b; };
  // Look: the camera's picture behind the pad, and its light and colour moving the dot
  const L = S.look, lookB = h('button', { type: 'button', class: 'sw', title: 'The song takes the colour of what the camera sees', onclick: () => { L.set(!L.on); buzz(8); } }, h('i'), 'Look'), lcv = h('canvas', { class: 'look' }), lg = lcv.getContext('2d'); lcv.width = L.W; lcv.height = L.H; pad.prepend(lcv); lcv.hidden = true;
  L.addEventListener('change', () => { lookB.setAttribute('aria-pressed', L.on); lcv.hidden = !L.on; if (L.on) toast('Point the phone at something'); }); lookB.setAttribute('aria-pressed', false);
  let echoWas = null;
  const throwOn = () => { echoWas = [P.get('fx.echo.mix'), P.get('fx.echo.fb')]; P.set('fx.echo.mix', 0.9); P.set('fx.echo.fb', 0.78); };
  const throwOff = () => { if (!echoWas) return; P.set('fx.echo.mix', echoWas[0]); P.set('fx.echo.fb', echoWas[1]); echoWas = null; };
  room.append(
    h('div', { class: 'head row' }, h('h2', {}, 'Process'), h('span', { class: 'sp' }), lookB),
    pad,
    h('div', { class: 'fxgrid' },
      hold('Echo throw', 'Everything into the echo while held', throwOn, throwOff),
      hold('Repeat ⅛', 'Repeat the last eighth note while held', () => P.set('fx.rep.hold', 0.5), () => P.set('fx.rep.hold', 0)),
      hold('Repeat 1/16', 'Repeat the last sixteenth while held', () => P.set('fx.rep.hold', 0.25), () => P.set('fx.rep.hold', 0)),
      tog('Gate', 'fx.gate.depth', 0.9, 0), tog('Crush', 'fx.crush.mix', 0.7, 0), tog('Ensemble', 'fx.ens.mix', 0.75, 0)));
  S.rooms.process = {
    draw: () => { if (L.on && L.img) lg.drawImage(L.img, 0, 0); }, hide: () => L.set(false),
    tilt: (x, y) => { if (touching || L.on) return; tiltSet('fx.xy.x', clamp(0.5 + x * 0.5, 0, 1), 0.01); tiltSet('fx.xy.y', clamp(0.5 + y * 0.5, 0, 1), 0.01); },
    shake: () => { throwOn(); setTimeout(throwOff, S.player.beatDur * 1000 * 2); toast('Thrown into the echo'); },
  };
}

// ------------------------------------------------------------------------------------------------ page: move (walk, turn)
/** iPhone asks once for the motion sensors; this asks without switching the tilt controls on. */
async function askSensors() {
  try { if (typeof DeviceMotionEvent?.requestPermission === 'function') await DeviceMotionEvent.requestPermission(); } catch { /* tap the steps instead */ }
  try { if (typeof DeviceOrientationEvent?.requestPermission === 'function') await DeviceOrientationEvent.requestPermission(); } catch { /* drag the ring instead */ }
}
function buildMove() {
  const room = $('#p-move'), W = S.walk, T = S.surround;
  // walk
  const walkB = h('button', { type: 'button', class: 'bigsw', onclick: async () => { await askSensors(); await S.ctx.resume(); wakeSpeaker(S.ctx); W.set(!W.on); buzz(15); } }, h('i'), h('b', {}, 'Walk'), h('small', {}, 'the song follows your steps'));
  const spm = h('b', { class: 'num' }, '–'), bpm = h('b', { class: 'num' }, '–'), wst = h('p', { class: 'cap' });
  const tap = h('button', { type: 'button', class: 'steppad', onpointerdown: (e) => { e.preventDefault(); if (!W.on) return; W.step(); buzz(6); tap.classList.add('hit'); setTimeout(() => tap.classList.remove('hit'), 90); } }, 'tap your steps here');
  const showWalk = () => {
    walkB.setAttribute('aria-pressed', W.on); tap.hidden = !W.on;
    spm.textContent = W.on && W.spm ? Math.round(W.spm) : '–'; bpm.textContent = Math.round(S.params.get('song.bpm'));
    wst.textContent = !W.on ? 'Your pace becomes the tempo.' : W.still ? 'Standing still · the stems wait, the Cloud holds a drone · walk on' : 'Walking · the song follows you';
  };
  W.addEventListener('change', showWalk); S.params.on(({ path }) => path === 'song.bpm' && showWalk()); showWalk();
  // turn
  const turnB = h('button', { type: 'button', class: 'bigsw', onclick: async () => { await askSensors(); await S.ctx.resume(); wakeSpeaker(S.ctx); T.set(!T.on); buzz(15); } }, h('i'), h('b', {}, 'Turn'), h('small', {}, 'stand inside the band'));
  const ring = h('div', { class: 'ring' }), cv = h('canvas'), g = cv.getContext('2d'); ring.append(cv);
  let R = 0; new ResizeObserver(() => { const r = ring.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1); R = r.width; cv.width = R * d; cv.height = R * d; cv.style.width = cv.style.height = R + 'px'; g.setTransform(d, 0, 0, d, 0, 0); }).observe(ring);
  const tst = h('p', { class: 'cap' });
  // no compass (or sitting down): drag round the ring to turn
  let drag = null;
  const ang = (e) => { const r = ring.getBoundingClientRect(); return Math.atan2(e.clientX - r.left - r.width / 2, -(e.clientY - r.top - r.height / 2)); };
  ring.addEventListener('pointerdown', (e) => { if (!T.on) return; e.preventDefault(); try { ring.setPointerCapture(e.pointerId); } catch { /* fine */ } drag = { a: ang(e), h: T.target }; });
  ring.addEventListener('pointermove', (e) => { if (drag) T.turn(drag.h + (ang(e) - drag.a)); });
  const end = () => { drag = null; }; ring.addEventListener('pointerup', end); ring.addEventListener('pointercancel', end);
  const name = (id) => S.song.stems.find((s) => s.id === id)?.name || '';
  const showTurn = () => {
    turnB.setAttribute('aria-pressed', T.on); ring.classList.toggle('off', !T.on);
    tst.textContent = !T.on ? 'Headphones on, then turn around.' : T.alone ? `Alone: ${name(T.alone)} · turn away and the band comes back` : `In front of you: ${name(T.face)}`;
  };
  T.addEventListener('change', showTurn); showTurn();
  room.append(
    h('div', { class: 'head' }, h('h2', {}, 'Move')),
    h('section', { class: 'movecard' }, walkB, h('div', { class: 'readout' }, h('span', {}, spm, h('small', {}, 'steps / min')), h('span', {}, bpm, h('small', {}, 'bpm'))), tap, wst),
    h('section', { class: 'movecard' }, turnB, ring, tst));
  S.rooms.move = {
    draw: () => {
      if (!R) return; const c = R / 2, rr = R / 2 - 58; g.clearRect(0, 0, R, R);
      g.strokeStyle = '#ffffff22'; g.lineWidth = 1; g.beginPath(); g.arc(c, c, rr, 0, 7); g.stroke();
      const hd = T.heading;
      // where you face: a soft wedge, pointing up the screen
      g.fillStyle = '#e6b4501c'; g.beginPath(); g.moveTo(c, c); g.arc(c, c, rr + 26, -Math.PI / 2 - 0.3, -Math.PI / 2 + 0.3); g.closePath(); g.fill();
      if (T.on && T.face && !T.alone) { const p = T.progress; g.strokeStyle = '#e6b450'; g.lineWidth = 2; g.beginPath(); g.arc(c, c, 12, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2); g.stroke(); }
      g.fillStyle = '#ece8dc'; g.beginPath(); g.arc(c, c, 5, 0, 7); g.fill();
      g.font = '10px "IBM Plex Mono", monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
      const ring2 = T.on && T.az ? [...T.az] : S.song.stems.filter((s) => s.cells.some(Boolean)).map((s, i, a) => [s.id, (i / a.length) * Math.PI * 2]);
      for (const [id, a] of ring2) {
        const x = c + Math.sin(a - hd) * rr, y = c - Math.cos(a - hd) * rr, ch = S.engine.channels.get(id), lv = ch ? Math.min(1, ch.readLevel() * 3) : 0;
        const on = id === T.face, alone = id === T.alone;
        g.fillStyle = alone ? '#e6b450' : on ? '#ece8dc' : '#a3a6ad'; g.globalAlpha = T.on ? (T.alone && !alone ? 0.3 : 1) : 0.4;
        g.beginPath(); g.arc(x, y, 4 + lv * 7, 0, 7); g.fill();
        g.fillText(name(id).slice(0, 9), c + Math.sin(a - hd) * (rr + 20), c - Math.cos(a - hd) * (rr + 20));
      }
      g.globalAlpha = 1;
    },
  };
}

let bouncing = null;
async function bounce(btn) {
  if (bouncing) { bouncing.cancel = true; return; }
  const p = S.player, q = S.seq; if (q.rec) q.arm(false);
  const c = q.arr.cycle, start = c ? c[0] : 0, bars = c ? c[1] - c[0] : q.arr.bars;
  if (p.playing) p.stop();
  S.seek(start); await S.ctx.resume(); p.play(start);
  const sr = S.ctx.sampleRate, t0 = p.timeOfBar(start), t1 = p.timeOfBar(start + bars) + 3;
  const rec = S.engine.recordMaster(Math.round(t0 * sr)); bouncing = { cancel: false };
  await new Promise((res) => { const step = () => { btn.textContent = `Saving ${Math.round(clamp((S.ctx.currentTime - t0) / (t1 - t0), 0, 1) * 100)}% · stop`; if (bouncing.cancel || !p.playing || S.ctx.currentTime >= t1) res(); else requestAnimationFrame(step); }; step(); });
  const r = await rec.stop(Math.round(Math.min(t1, S.ctx.currentTime) * sr)); const cancelled = bouncing.cancel; bouncing = null; p.stop(); btn.textContent = 'Save as sound';
  if (cancelled || r.seconds < 1) return;
  const file = new File([r.wav()], `${S.song.title} · playground.wav`, { type: 'audio/wav' });
  if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: S.song.title }); return; } catch { /* fall through to a download */ } }
  const a = h('a', { href: URL.createObjectURL(file), download: file.name }); document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}

// ------------------------------------------------------------------------------------------------ frame, keeping your work
let lastF = 0;
function frame(now) {
  S.surround?.frame(Math.min(0.1, Math.max(0, (now - lastF) / 1000) || 0)); lastF = now;
  const q = S.seq, raw = Math.max(0, q.tl(q.nowBeat())), bar = Math.floor(raw / bpb());
  $('#pos').textContent = `${String(bar + 1).padStart(3, '0')}.${Math.floor(raw % bpb()) + 1}`;
  try { for (const [k, r] of Object.entries(S.rooms)) if (k !== S.page) r.bg?.(); S.rooms[S.page]?.draw?.(); } catch (e) { if (frame.err !== e.message) { frame.err = e.message; console.error('draw', e); } }
  requestAnimationFrame(frame);
}
const KEY = () => `playground.pocket.${S.song.id}`;
const OWN = ['v', 'song', 'params', 'seq', 'cloud', 'forges', 'band', 'mem', 'table', 'bpm'];
S.projectData = () => ({ v: 2, song: S.song.id, params: S.params.dump(), seq: S.seq.dump(), cloud: S.cloudSrc, forges: [...S.sounds.map((s) => s.slot.src || null), ...(S.moreForges || [])], band: S.session.state, mem: S.mem, table: S.tableDump?.(), ...(S.keptBpm ? { bpm: S.keptBpm } : {}), ...S.carried });
function restore(d) {
  if (!d || (d.v !== 1 && d.v !== 2)) return;
  S.carried = carry(d, OWN); S.keptBpm = d.bpm || 0; S.moreForges = (d.forges || []).slice(S.sounds.length);
  loadParams(S.params, d.params); S.seq.load(d.seq);
  if (d.cloud) S.cloudSrc = d.cloud; if (d.mem) { S.mem = d.mem; S.memRows?.forEach((m) => m.show()); } if (d.table) S.tablePos = d.table;
  d.forges?.forEach((src, i) => { if (src && S.sounds[i]) S.sounds[i].slot.src = src; });
  if (d.band?.songId === S.song.id) S.session.dispatch({ t: 'state/load', state: d.band }, { log: false });
}
