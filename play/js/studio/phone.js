// The playground in a pocket. The same engine as the studio (the stems, the Cloud, instruments made of slices,
// the Process rack, the arrangement), reshaped for a phone: five pages, big touch surfaces, and the phone's own
// motion as a controller — tilt bends what the page is about, a shake does something sudden, face-down freezes.
// There is one place things go: the tape (the arrangement). With ● on, every touch, tilt and change lands on it.
import { AudioEngine } from '../engine/audio.js';
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

const query = new URLSearchParams(location.search);
const S = { slots: [], rooms: {}, phone: true };
window.studio = S;
const COLORS = ['#e6b450', '#9cc2f4', '#8fd3c5'];
const NAMES = ['Cloud', 'Sound 1', 'Sound 2'];
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
  $('#full').href = `play.html?song=${song.id}&desktop=1`;

  const engine = new AudioEngine(); await engine.ready;
  await engine.ctx.audioWorklet.addModule(new URL('./dsp.js', import.meta.url));
  const loader = new CellLoader(engine.ctx, { max: 110 });
  const ids = song.stems.map((s) => s.id);
  const session = new Session(initialState(song, { catalogIds: ids }));
  const player = new Player(engine, loader, session, song);
  for (const s of song.stems) player.addSource(s.id, { id: s.id, kind: 'stem', name: s.name, cells: s.cells, gain: s.gain });
  Object.assign(S, { song, engine, ctx: engine.ctx, loader, session, player, params: new Params() });
  const P = S.params;

  // the same signal flow as the studio: strips → the Process rack and the dry bus → glue and limiter
  const tex = buildTextures(S); S.tex = tex; S.resFreqs = tex.resFreqs;
  S.dryBus = engine.ctx.createGain(); S.dryBus.connect(engine.lp);
  S.bandGate = engine.ctx.createGain();
  engine.bus.disconnect(); engine.post.disconnect();
  engine.post.connect(tex.input); tex.output.connect(engine.lp);
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

  buildCloud(); buildSound(1, 'sampler'); buildSound(2, 'strings');
  buildTop(); buildStems(); buildCloudPage(); buildPlay(); buildProcess(); buildTape(); buildMove(); buildTabs();
  restore();
  S.voice.ensureTrack(); S.voice.restore();
  P.set('song.bpm', song.bpm, { by: 'load' });   // a walking tempo is not kept: the pocket always starts at the song's
  const q = S.seq;
  if (!q.arr.bars) q.fillFromSong();
  q.mode = 'jam'; q.setMode('song');
  S.cloudInit(); S.sounds.forEach((s) => s.init());
  showPage(query.get('page') || 'stems');

  const first = ids.map((id) => player.resolve(session.state.tracks[id], 0)).filter(Boolean).map((w) => w.url);
  let n = 0; await Promise.all(first.map((u) => loader.load(u).catch(() => {}).finally(() => { $('#gate-bar').style.width = `${(++n / first.length) * 100}%`; })));
  // straight into the studio once the stems are in: the first touch unlocks the sound (and full screen, and on an
  // iPhone the question about motion), nothing plays until you press play
  $('#gate').classList.add('gone');
  if (query.get('open') === 'atlas') featP.then(() => { const u = new URL(location.href); u.searchParams.delete('open'); history.replaceState(null, '', u); openAtlas(S, { say: toast }); });
  const touch1 = () => { removeEventListener('pointerdown', touch1, true); goFull(); engine.ctx.resume(); unlockIOS(); Motion.ask(); };
  addEventListener('pointerdown', touch1, true);
  requestAnimationFrame(frame);
  setInterval(save, 2000);
}
/** As much screen as the phone allows: real full screen where the browser lets a page ask (Android); on iPhone the
 *  page scrolls a little so Safari folds its bars away, and from the home screen it opens with no browser at all. */
function goFull() { const d = document.documentElement; try { if (!document.fullscreenElement && d.requestFullscreen && !/iP(hone|od)/.test(navigator.userAgent)) d.requestFullscreen({ navigationUI: 'hide' }).catch(() => {}); } catch { /* not here */ } }
/** iOS plays Web Audio through the ringer channel unless a media element has played: a silent one fixes that. */
function unlockIOS() { try { const a = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAABErAAABAAgAZGF0YQAAAAA='); a.playsInline = true; a.play().catch(() => {}); } catch { /* fine */ } }

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
    if (m > 15 && now - this.lastShake > 700) { this.lastShake = now; buzz(20); this.subs.shake?.(); }
  },
};
addEventListener('deviceorientation', (e) => Motion.orient(e));
addEventListener('devicemotion', (e) => Motion.motion(e));
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
  const P = S.params, k = `f${n}`, out = S.ctx.createGain(); out.connect(S.addStrip(n).input);
  const voices = { sampler: new SamplerVoice(S, out), strings: new StringsVoice(S, out), grains: new CloudVoice(S, out) };
  const slot = { name: NAMES[n], voices, get voice() { return voices[P.get(`${k}.engine`)]; } };
  S.slots[n] = slot;
  let src = null;
  const reslice = () => { if (!src) return; const [a, b] = P.get(`${k}.sel`).split(':').map(Number); const sl = sliceOf(src, a, b); voices.sampler.setSlice(sl); voices.strings.setSlice(sl); voices.grains.setSource(sl); };
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
  const load = async (stemId, a, b, fresh) => { slot.src = { stemId, a, b }; src = await loadSource(S, stemId, a, b); if (fresh) { const x = loudestWindow(src, 0.06); P.set(`${k}.sel`, `${x.toFixed(4)}:${(x + 0.06).toFixed(4)}`, { by: 'load' }); } reslice(); S.soundChanged?.(); };
  const def = S.song.stems[(n * 5) % S.song.stems.length];
  const sound = {
    n, k, slot,
    init: () => {
      if (slot.src?.rec) { sourceOf(S, slot.src, loadSource).then((s0) => sound.useRec(s0, false)).catch(() => { slot.src = null; sound.init(); }); return; }
      const c = slot.src || { stemId: def.id, ...(([a, b]) => ({ a, b }))(loudestCells(def, 1)) }; load(c.stemId, c.a, c.b, !slot.src);
    },
    /** A sound you recorded becomes this instrument's source. */
    useRec(s0, fresh = true) { slot.src = { rec: s0.rec }; src = s0; if (fresh) { const x = loudestWindow(s0, 0.08); P.set(`${k}.sel`, `${x.toFixed(4)}:${Math.min(1, x + Math.max(0.08, Math.min(0.5, 0.6 / s0.dur))).toFixed(4)}`, { by: 'load' }); } reslice(); S.soundChanged?.(); },
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
  S.sounds.push(sound);
}

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
    const rl = $('#recline'); rl.hidden = !seq.rec; if (seq.rec) rl.textContent = `● recording onto the tape${seq.take ? ` · ${takeName(seq.take.pat)}` : ''} · everything you touch, tilt and shake goes in`;
  };
  seq.addEventListener('change', sync); sync();
  S.seek = (bar) => session.dispatch({ t: 'seek', bar });
  $('#menu').onclick = () => openMenu();
  $('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') closeMenu(); });
}

// ------------------------------------------------------------------------------------------------ menu and help
// The pages carry as little text as they can; how each one works is here, one tap away.
const HELP = {
  stems: ['Tap a stem to mute it, hold it to hear it alone. Tap a family’s name to mute the whole family.', 'Tap the song map to go there.', 'The buttons at the bottom change the next four bars: hold one bar, play backwards, at half speed, stutter, or shuffle every stem to another place.', 'Shake the phone to shuffle.'],
  cloud: ['The sound is broken into grains. Touch and drag: across is where in the sound, up is bigger grains.', '‹ › picks another stem. Record audio makes the grains from a sound you record.', 'Drone keeps it sounding, Freeze stops it drifting.', 'With motion on: tilt left and right bends the pitch, towards and away sprays the grains, a shake scatters them.'],
  play: ['Pads in a scale. Slide between them; higher on a pad is louder.', 'Choose the Cloud or a sound; a sound can be a sampler, strings or a pad, made of a slice of the stems. New sound picks another slice; Record audio makes it from a sound you record.', 'The key and scale are next to it.', 'With motion on: tilt for darker or brighter and for echo, shake for a run of notes.'],
  process: ['One gesture moves the filter, tape, resonators and shimmer together.', 'Hold the buttons for an echo throw or a repeat; the others switch on and off.', 'With motion on: tilt moves the dot, a shake throws everything into the echo.', 'On any page: lay the phone face down and everything freezes into a shimmer.'],
  tape: ['Everything you make lands on the tape. Press ● and play: touches, tilts and changes are written where the playhead is.', 'Tap the tape to go there. Drag across it to choose bars, then Loop, Repeat, Reverse, Half, Stutter, Silence, put the Song back, or Clear them. Hold on a piece to remove it.', 'Record audio records from the microphone onto the lane Audio, on the song’s own bars.', 'Forgot ●? Capture keeps what you just played. ↶ undoes anything.'],
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
      item('Open the full studio', () => { location.href = `play.html?song=${S.song.id}&desktop=1`; }),
      item('Start again', () => { if (confirm('Clear everything and start from the song again?')) { localStorage.removeItem(KEY()); location.reload(); } }, 'faint'),
      item('gunnar tynes', () => { location.href = '/'; }, 'faint')));
  sh.hidden = false; requestAnimationFrame(() => sh.classList.add('on'));
}
function closeMenu() { const sh = $('#sheet'); sh.classList.remove('on'); setTimeout(() => { sh.hidden = true; }, 220); }
function buildTabs() { document.querySelectorAll('#tabs button').forEach((b) => { b.onclick = () => { showPage(b.dataset.p); buzz(5); }; }); }
function showPage(id) {
  if (!S.rooms[id]) id = 'stems';
  S.page = id;
  document.querySelectorAll('.page').forEach((p) => { p.hidden = p.id !== `p-${id}`; });
  document.querySelectorAll('#tabs button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.p === id));
  const r = S.rooms[id]; Motion.subs = { tilt: r.tilt || null, shake: r.shake || null, face: r.face || faceFreeze };
  const u = new URL(location.href); u.searchParams.set('page', id); history.replaceState(null, '', u);
  requestAnimationFrame(() => r.show?.());
}
/** On every page: lay the phone face down and everything freezes into a shimmer; pick it up and it lets go. */
function faceFreeze(down) {
  const P = S.params;
  if (down) { faceFreeze.was = [P.get('fx.shim.mix'), P.get('fx.shim.freeze')]; P.set('fx.shim.mix', Math.max(0.7, P.get('fx.shim.mix'))); P.set('fx.shim.freeze', true); P.set('band.on', false); toast('Face down: frozen'); buzz(30); }
  else if (faceFreeze.was) { P.set('band.on', true); P.set('fx.shim.freeze', faceFreeze.was[1]); P.set('fx.shim.mix', faceFreeze.was[0]); faceFreeze.was = null; }
}
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2600); }
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

// ------------------------------------------------------------------------------------------------ page: stems
const GROUPS = [['rhythm', 'Rhythm'], ['bass', 'Bass'], ['keys', 'Keys'], ['guitar', 'Guitar'], ['synth', 'Synths'], ['other', 'Other'], ['voice', 'Audio']];
function buildStems() {
  const room = $('#p-stems'), { song, params: P } = S, cb = song.barsPerCell;
  // the song as a map: how many stems play in each bar of the tape, its parts, the playhead; tap to go there
  const map = h('div', { class: 'songmap' }), mcv = h('canvas'), mg = mcv.getContext('2d'); map.append(mcv);
  let MW = 0, MH = 0; new ResizeObserver(() => { const r = map.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1); MW = r.width; MH = r.height; mcv.width = MW * d; mcv.height = MH * d; mcv.style.width = MW + 'px'; mcv.style.height = MH + 'px'; mg.setTransform(d, 0, 0, d, 0, 0); }).observe(map);
  map.addEventListener('pointerdown', (e) => { const r = map.getBoundingClientRect(); S.seek(Math.floor(((e.clientX - r.left) / r.width) * S.seq.arr.bars)); buzz(6); });
  const busy = (bar) => { const c = Math.floor(srcAt(bar) / cb); let n = 0; for (const st of song.stems) if (st.cells[c] && st.cells[c].rms > -45) n++; return n; };
  // the stems, in their families, each in its own colour: tap mutes, hold plays it alone; a family's name mutes the family
  const tiles = [];
  const fam = GROUPS.map(([g, label]) => {
    const sts = song.stems.filter((st) => (st.voice ? 'voice' : GROUPS.some((x) => x[0] === st.group) ? st.group : 'other') === g); if (!sts.length) return null;
    const col = sts.find((x) => x.color)?.color || '#ece8dc';
    const head = h('button', { type: 'button', class: 'famname', style: { '--c': col }, onclick: () => { const all = sts.every((st) => P.get(`band.${st.id}.mute`)); for (const st of sts) P.set(`band.${st.id}.mute`, !all); buzz(8); } }, h('i'), label);
    const box = h('div', { class: 'famtiles' });
    for (const st of sts) {
      const lvl = h('i', { class: 'lvl' }), t = h('button', { type: 'button', class: 'tile', style: { '--c': st.color || col } }, lvl, h('span', { class: 'nm' }, st.name));
      let timer = null, long = false;
      t.addEventListener('pointerdown', () => { long = false; timer = setTimeout(() => { long = true; P.set(`band.${st.id}.solo`, !P.get(`band.${st.id}.solo`)); buzz(25); }, 450); });
      const up = () => clearTimeout(timer); t.addEventListener('pointerup', up); t.addEventListener('pointercancel', up); t.addEventListener('pointerleave', up);
      t.addEventListener('click', () => { if (long) return; P.set(`band.${st.id}.mute`, !P.get(`band.${st.id}.mute`)); buzz(6); });
      t.addEventListener('contextmenu', (e) => e.preventDefault());
      const show = () => { t.classList.toggle('off', !!P.get(`band.${st.id}.mute`)); t.classList.toggle('solo', !!P.get(`band.${st.id}.solo`)); };
      P.on(({ path }) => path.startsWith(`band.${st.id}.`) && show()); show();
      tiles.push({ st, t, lvl, box }); box.append(t);
    }
    const el = h('section', { class: 'fam' }, head, box); el.sts = sts; return el;
  }).filter(Boolean);
  const act = (label, title, fn) => h('button', { type: 'button', class: 'act', title, onclick: fn }, label);
  const shuffle = () => {
    const q = S.seq, at = nextBar(); q.snapshot();
    for (const st of song.stems) {
      if (P.get(`band.${st.id}.mute`)) continue;
      const live = st.cells.map((c, i) => (c && c.rms > -45 ? i : -1)).filter((i) => i >= 0); if (!live.length) continue;
      const c = live[Math.floor(Math.random() * live.length)];
      q.place({ lane: 'stem:' + st.id, start: at, len: 4, src: c * cb, loop: 4, name: `${c * cb + 1}` });
    }
    if (at + 4 > q.arr.bars) q.arr.bars = at + 4; q.changed();
    toast(`Shuffled · bars ${at + 1}–${at + 4} · ↶ undoes`); buzz(25);
  };
  room.append(
    h('div', { class: 'head' }, h('h2', {}, 'Stems')),
    map,
    h('div', { class: 'fams' }, ...fam),
    h('div', { class: 'dock' },
      h('p', { class: 'docklabel' }, 'Next four bars'),
      h('div', { class: 'acts' },
        act('Hold', 'Repeat the bar playing now', () => writeBand((at) => ({ src: srcAt(at - (S.player.playing ? 1 : 0)), loop: 1, name: 'hold' }), 'Held')),
        act('Reverse', 'Every bar backwards', () => writeBand((at) => ({ src: srcAt(at), fx: { r: 1 } }), 'Reversed')),
        act('Half', 'Half speed, an octave down', () => writeBand((at) => ({ src: srcAt(at), fx: { s: 0.5 } }), 'Half speed')),
        act('Stutter', 'The start of each bar, over and over', () => writeBand((at) => ({ src: srcAt(at), fx: { u: 8 } }), 'Stuttered')),
        act('Shuffle', 'Every stem jumps to another place in the song', shuffle))));
  S.rooms.stems = {
    shake: shuffle,
    draw: () => {
      for (const x of tiles) { const ch = S.engine.channels.get(x.st.id); x.lvl.style.transform = `scaleY(${ch ? Math.min(1, ch.readLevel() * 3.2) : 0})`; }
      for (const f of fam) f.hidden = f.sts.every((st) => st.voice && !st.cells.some(Boolean));
      if (!MW) return; const q = S.seq, n = Math.max(1, q.arr.bars), bw = MW / n, top = 14, hh = MH - top - 2; mg.clearRect(0, 0, MW, MH);
      for (let b = 0; b < n; b++) { const v = busy(b) / 14; mg.fillStyle = '#ece8dc30'; const y = hh * Math.min(1, v); mg.fillRect(b * bw, top + hh - y, Math.max(1, bw - 0.6), y); }
      mg.font = '9.5px "IBM Plex Mono", monospace'; mg.textBaseline = 'top';
      for (const c of q.arr.clips) if (c.lane === 'band') { mg.fillStyle = '#ffffff30'; mg.fillRect(c.start * bw, 0, 1, MH); if (c.name && c.len * bw > 14) { mg.fillStyle = '#a3a6ad'; mg.fillText(c.name, c.start * bw + 3, 1); } }
      if (q.arr.cycle) { mg.fillStyle = '#e6b45024'; mg.fillRect(q.arr.cycle[0] * bw, 0, (q.arr.cycle[1] - q.arr.cycle[0]) * bw, MH); }
      const pb = q.tl(q.nowBeat()) / bpb(); mg.fillStyle = q.rec ? '#df8a74' : '#e6b450'; mg.fillRect(pb * bw - 1, 0, 2, MH);
    },
  };
}

// ------------------------------------------------------------------------------------------------ page: cloud
function buildCloudPage() {
  const room = $('#p-cloud'), P = S.params, voice = S.cloud.voice;
  const surf = h('div', { class: 'surface' }), cv = h('canvas'), g = cv.getContext('2d'); surf.append(cv);
  const hint = h('div', { class: 'surf-hint' }, h('b', {}, 'Touch and drag to play'), h('span', {}, 'across: where in the sound · up: bigger grains'));
  surf.append(hint);
  let W = 0, H = 0; new ResizeObserver(() => { const r = surf.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1); W = r.width; H = r.height; cv.width = W * d; cv.height = H * d; cv.style.width = W + 'px'; cv.style.height = H + 'px'; g.setTransform(d, 0, 0, d, 0, 0); }).observe(surf);
  let touching = 0;
  const at = (e) => { const r = surf.getBoundingClientRect(); P.set('cloud.pos', r3(clamp((e.clientX - r.left) / r.width, 0, 1))); P.set('cloud.size', r3(clamp(1 - (e.clientY - r.top) / r.height, 0.02, 1))); };
  surf.addEventListener('pointerdown', (e) => { e.preventDefault(); surf.setPointerCapture(e.pointerId); touching++; hint.classList.add('gone'); at(e); if (touching === 1 && !P.get('cloud.drone')) { voice.noteOn('touch', 60, 0.85); S.seq.noteIn(0, 60, 0.85, true); } });
  surf.addEventListener('pointermove', (e) => { if (touching) at(e); });
  const lift = () => { if (!touching) return; touching = 0; if (!P.get('cloud.drone')) { voice.noteOff('touch'); S.seq.noteIn(0, 60, 0, false); } };
  surf.addEventListener('pointerup', lift); surf.addEventListener('pointercancel', lift);
  const name = h('span', { class: 'src' });
  const stems = S.song.stems.filter((s) => s.cells.filter(Boolean).length > 2);
  const next = async (d) => { const i = stems.findIndex((s) => s.id === S.cloudSrc?.stemId), st = stems[(i + d + stems.length) % stems.length]; name.textContent = '…'; const [a, b] = loudestCells(st, 2); await S.setCloudSource(st.id, a, b); buzz(6); };
  S.cloud.changed = () => { name.textContent = S.cloudSrc?.rec ? 'your recording' : S.song.stems.find((s) => s.id === S.cloudSrc?.stemId)?.name || ''; };
  const micB = recButton(S, { onDone: (src) => S.useCloudSource(src, { rec: src.rec }), say: toast, cls: 'chip' });
  const sw = (path, label) => { const b = h('button', { type: 'button', class: 'sw', onclick: () => { P.set(path, !P.get(path)); buzz(6); } }, h('i'), label); const s = () => b.setAttribute('aria-pressed', !!P.get(path)); P.on(({ path: p }) => p === path && s()); s(); return b; };
  const pitchOut = h('span', { class: 'mono val' });
  room.append(
    h('div', { class: 'head' }, h('h2', {}, 'Cloud'), h('div', { class: 'srcrow' }, h('button', { type: 'button', class: 'chip', 'aria-label': 'Previous stem', onclick: () => next(-1) }, '‹'), name, h('button', { type: 'button', class: 'chip', 'aria-label': 'Next stem', onclick: () => next(1) }, '›'))),
    surf,
    h('div', { class: 'row' }, sw('cloud.drone', 'Drone'), sw('cloud.freeze', 'Freeze'), h('span', { class: 'sp' }), pitchOut),
    h('div', { class: 'row' }, micB));
  let scatterT = 0;
  S.rooms.cloud = {
    tilt: (x, y) => { tiltSet('cloud.pitch', x * 12, 0.25); tiltSet('cloud.spread', clamp(0.06 + Math.max(0, y) * 0.44, 0, 0.5), 0.01); },
    shake: () => { P.set('cloud.jitter', 12); clearInterval(scatterT); scatterT = setInterval(() => { const v = P.get('cloud.jitter') * 0.82; if (v < 0.3) { clearInterval(scatterT); P.set('cloud.jitter', 0); } else P.set('cloud.jitter', +v.toFixed(2)); }, 120); toast('Scattered'); },
    draw: () => {
      if (!W) return; g.clearRect(0, 0, W, H);
      const pk = S.cloud.peaks, mid = H / 2;
      if (pk) { g.fillStyle = '#ece8dc22'; const bw = W / pk.length; for (let i = 0; i < pk.length; i++) { const a = pk[i] * H * 0.42; g.fillRect(i * bw, mid - a, Math.max(1, bw - 0.5), a * 2); } }
      const v = voice.view || {}, pos = v.pos ?? P.get('cloud.pos'), sp = P.get('cloud.spread');
      g.fillStyle = '#e6b45020'; g.fillRect((pos - sp) * W, 0, sp * 2 * W, H);
      g.fillStyle = '#e6b450'; g.fillRect(pos * W - 1, 0, 2, H);
      for (const x of v.grains || []) { g.globalAlpha = 0.9; g.beginPath(); g.arc(x * W, H * (0.1 + Math.random() * 0.8), 2.4, 0, 7); g.fill(); }
      g.globalAlpha = 1;
      const p = P.get('cloud.pitch'); pitchOut.textContent = `${p > 0 ? '+' : ''}${p.toFixed(p % 1 ? 1 : 0)} st`;
    },
  };
}

// ------------------------------------------------------------------------------------------------ page: play (pads)
const SCALES = { 'minor pent.': [0, 3, 5, 7, 10], 'major pent.': [0, 2, 4, 7, 9], minor: [0, 2, 3, 5, 7, 8, 10], major: [0, 2, 4, 5, 7, 9, 11], dorian: [0, 2, 3, 5, 7, 9, 10] };
function buildPlay() {
  const room = $('#p-play'), P = S.params;
  const micB = recButton(S, { onDone: (src) => { const sl = P.get('pocket.slot'); if (sl) S.sounds[sl - 1].useRec(src); else S.useCloudSource(src, { rec: src.rec }); show(); }, say: toast, cls: 'chip' });
  P.define('pocket.slot', 1); P.define('pocket.root', 9); P.define('pocket.scale', 'minor pent.');
  const chips = [0, 1, 2].map((i) => h('button', { type: 'button', class: 'chip who', style: { '--c': COLORS[i] }, onclick: () => { P.set('pocket.slot', i, { by: 'ui' }); buzz(6); } }, h('i'), NAMES[i]));
  const engines = h('div', { class: 'seg' }, ...[['sampler', 'Sampler'], ['strings', 'Strings'], ['grains', 'Pad']].map(([v, l]) => { const b = h('button', { type: 'button', onclick: () => { const s = P.get('pocket.slot'); if (s) P.set(`f${s}.engine`, v); } }, l); b.dataset.v = v; return b; }));
  const srcName = h('span', { class: 'src' });
  const surprise = h('button', { type: 'button', class: 'chip', onclick: async () => { const s = S.sounds[P.get('pocket.slot') - 1]; if (!s) return; srcName.textContent = '…'; const nm = await s.surprise(); srcName.textContent = `from ${nm}`; buzz(10); } }, 'New sound');
  const keyB = h('button', { type: 'button', class: 'chip', onclick: () => { P.set('pocket.root', (P.get('pocket.root') + 7) % 12, { by: 'ui' }); } });
  const scaleB = h('button', { type: 'button', class: 'chip', onclick: () => { const k = Object.keys(SCALES); P.set('pocket.scale', k[(k.indexOf(P.get('pocket.scale')) + 1) % k.length], { by: 'ui' }); } });
  const grid = h('div', { class: 'pads' });
  const COLS = 3, ROWS = 5;
  const notes = () => { const sc = SCALES[P.get('pocket.scale')], root = 48 + P.get('pocket.root'), out = []; for (let i = 0; i < COLS * ROWS; i++) out.push(root + 12 * Math.floor(i / sc.length) + sc[i % sc.length]); return out; };
  let pads = [];
  const build = () => {
    const ns = notes(); grid.replaceChildren(); pads = [];
    for (let r = ROWS - 1; r >= 0; r--) for (let c = 0; c < COLS; c++) { const i = r * COLS + c, n = ns[i]; const p = h('div', { class: 'pad' + (n % 12 === P.get('pocket.root') ? ' root' : '') }, h('span', {}, `${NOTE[n % 12]}${Math.floor(n / 12) - 1}`)); p.dataset.n = n; pads.push(p); grid.append(p); }
  };
  // many fingers, and sliding between pads plays each one it reaches
  const held = new Map();
  const on = (pid, padEl, vel) => { const s = S.slots[P.get('pocket.slot')]; if (!s || !padEl) return; const n = +padEl.dataset.n, id = `pd${pid}`; s.voice.noteOn(id, n, vel); S.seq.noteIn(P.get('pocket.slot'), n, vel, true); S.noteSeen?.(n, true); padEl.classList.add('on'); held.set(pid, { padEl, n, slot: P.get('pocket.slot') }); };
  const off = (pid) => { const x = held.get(pid); if (!x) return; S.slots[x.slot]?.voice.noteOff(`pd${pid}`); S.seq.noteIn(x.slot, x.n, 0, false); x.padEl.classList.remove('on'); held.delete(pid); };
  const velOf = (e, el) => { const r = el.getBoundingClientRect(); return clamp(0.45 + 0.55 * (1 - (e.clientY - r.top) / r.height), 0.3, 1); };
  grid.addEventListener('pointerdown', (e) => { const el = e.target.closest('.pad'); if (!el) return; e.preventDefault(); try { grid.setPointerCapture(e.pointerId); } catch { /* fine */ } on(e.pointerId, el, velOf(e, el)); buzz(4); });
  grid.addEventListener('pointermove', (e) => { const x = held.get(e.pointerId); if (!x) return; const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('.pad'); if (el && el !== x.padEl) { off(e.pointerId); on(e.pointerId, el, velOf(e, el)); } });
  const up = (e) => off(e.pointerId); grid.addEventListener('pointerup', up); grid.addEventListener('pointercancel', up);
  grid.addEventListener('contextmenu', (e) => e.preventDefault());
  const show = () => {
    const s = P.get('pocket.slot'); chips.forEach((c, i) => c.setAttribute('aria-pressed', i === s)); room.style.setProperty('--c', COLORS[s]);
    engines.hidden = surprise.hidden = !s; srcName.textContent = s ? `from ${S.sounds[s - 1].srcName}` : `from ${S.song.stems.find((x) => x.id === S.cloudSrc?.stemId)?.name || 'the Cloud'}`;
    if (s) engines.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === P.get(`f${s}.engine`)));
    keyB.textContent = NOTE[P.get('pocket.root')]; scaleB.textContent = P.get('pocket.scale');
  };
  P.on(({ path }) => { if (/^pocket\./.test(path) || /\.engine$/.test(path)) { if (path !== 'pocket.slot') build(); show(); } });
  build(); show(); S.soundChanged = show;
  room.append(
    h('div', { class: 'head' }, h('h2', {}, 'Instruments'), h('div', { class: 'row' }, ...chips)),
    h('div', { class: 'row wrap' }, engines, surprise, h('span', { class: 'sp' }), keyB, scaleB),
    h('div', { class: 'row' }, srcName, h('span', { class: 'sp' }), micB),
    grid);
  const echoPath = () => `mix.${P.get('pocket.slot') ? 'f' + P.get('pocket.slot') : 'cloud'}.echo`;
  S.rooms.play = {
    tilt: (x, y) => { tiltSet('fx.filter.lp', clamp(0.62 + x * 0.38, 0.25, 1), 0.01); tiltSet(echoPath(), clamp(y, 0, 1) * 0.8, 0.02); },
    shake: () => { const s = S.slots[P.get('pocket.slot')]; if (!s) return; const ns = notes(), base = Math.floor(Math.random() * 6); [0, 2, 4, 7, 9].forEach((d, i) => setTimeout(() => { const el = pads.find((p) => +p.dataset.n === ns[Math.min(ns.length - 1, base + d)]); if (el) { on(9000 + i, el, 0.8); setTimeout(() => off(9000 + i), 160); } }, i * 90)); },
  };
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
  let echoWas = null;
  const throwOn = () => { echoWas = [P.get('fx.echo.mix'), P.get('fx.echo.fb')]; P.set('fx.echo.mix', 0.9); P.set('fx.echo.fb', 0.78); };
  const throwOff = () => { if (!echoWas) return; P.set('fx.echo.mix', echoWas[0]); P.set('fx.echo.fb', echoWas[1]); echoWas = null; };
  room.append(
    h('div', { class: 'head' }, h('h2', {}, 'Process')),
    pad,
    h('div', { class: 'fxgrid' },
      hold('Echo throw', 'Everything into the echo while held', throwOn, throwOff),
      hold('Repeat ⅛', 'Repeat the last eighth note while held', () => P.set('fx.rep.hold', 0.5), () => P.set('fx.rep.hold', 0)),
      hold('Repeat 1/16', 'Repeat the last sixteenth while held', () => P.set('fx.rep.hold', 0.25), () => P.set('fx.rep.hold', 0)),
      tog('Gate', 'fx.gate.depth', 0.9, 0), tog('Crush', 'fx.crush.mix', 0.7, 0), tog('Ensemble', 'fx.ens.mix', 0.75, 0)));
  S.rooms.process = {
    tilt: (x, y) => { if (touching) return; tiltSet('fx.xy.x', clamp(0.5 + x * 0.5, 0, 1), 0.01); tiltSet('fx.xy.y', clamp(0.5 + y * 0.5, 0, 1), 0.01); },
    shake: () => { throwOn(); setTimeout(throwOff, S.player.beatDur * 1000 * 2); toast('Thrown into the echo'); },
  };
}

// ------------------------------------------------------------------------------------------------ page: tape (the arrangement)
function buildTape() {
  const room = $('#p-tape'), q = S.seq, { song } = S, cb = song.barsPerCell, V = S.voice;
  const box = h('div', { class: 'tape' }), cv = h('canvas'), g = cv.getContext('2d'); box.append(cv);
  let W = 0, H = 0; new ResizeObserver(() => { const r = box.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1); W = r.width; H = r.height; cv.width = W * d; cv.height = H * d; cv.style.width = W + 'px'; cv.style.height = H + 'px'; g.setTransform(d, 0, 0, d, 0, 0); }).observe(box);
  const ROWS = [['band', 'Stems', '#ece8dc'], ['own', 'Each stem', '#a3a6ad'], ['audio', 'Audio', '#df8a74'], [0, 'Cloud', COLORS[0]], [1, 'Sound 1', COLORS[1]], [2, 'Sound 2', COLORS[2]], ['m', 'Moves', '#a3a6ad']];
  const rowOf = (cl) => (String(cl.lane).startsWith('stem:') ? 1 : ROWS.findIndex((r) => r[0] === cl.lane));
  const geo = () => { const top = 18, rh = (H - top) / ROWS.length, ppb = W / Math.max(4, q.arr.bars); return { top, rh, ppb }; };
  // tap: go there · drag across: choose bars · hold on a piece: remove it
  let pt = null, sel = null;
  const barAt = (e) => { const r = box.getBoundingClientRect(); return clamp((e.clientX - r.left) / geo().ppb, 0, q.arr.bars); };
  box.addEventListener('pointerdown', (e) => {
    const r = box.getBoundingClientRect(), y = e.clientY - r.top, { top, rh } = geo(), bar = barAt(e), row = Math.floor((y - top) / rh);
    const hit = row > 0 ? [...q.arr.clips].reverse().find((c) => rowOf(c) === row && bar >= c.start && bar < c.start + c.len) : null;
    try { box.setPointerCapture(e.pointerId); } catch { /* fine */ }
    pt = { x: e.clientX, bar, hit, moved: false, t: setTimeout(() => { if (!pt?.hit || pt.moved) return; q.snapshot(); q.arr.clips = q.arr.clips.filter((c) => c !== pt.hit); q.changed(); toast('Removed · ↶ undoes'); buzz(30); pt = null; }, 550) };
  });
  box.addEventListener('pointermove', (e) => {
    if (!pt) return; if (!pt.moved && Math.abs(e.clientX - pt.x) < 10) return;
    pt.moved = true; const b = barAt(e), a0 = Math.floor(Math.min(pt.bar, b)), b0 = Math.max(a0 + 1, Math.ceil(Math.max(pt.bar, b))); sel = [a0, Math.min(q.arr.bars, b0)]; showSel();
  });
  const up = () => { if (!pt) return; clearTimeout(pt.t); if (!pt.moved) { sel = null; showSel(); S.seek(Math.max(0, Math.floor(pt.bar))); } else buzz(6); pt = null; };
  box.addEventListener('pointerup', up); box.addEventListener('pointercancel', () => { if (pt) clearTimeout(pt.t); pt = null; });
  box.addEventListener('contextmenu', (e) => e.preventDefault());

  // what to do with the chosen bars (or, with none chosen, the next four)
  const range = () => sel || [nextBar(), nextBar() + 4];
  const grow = (end) => { if (end > q.arr.bars) q.arr.bars = end; };
  const band = (label, make) => () => { const [a, b] = range(); q.snapshot(); q.place({ lane: 'band', start: a, len: b - a, ...make(a, b) }); grow(b); q.changed(); toast(`${label} · bars ${a + 1}–${b} · ↶ undoes`); buzz(12); };
  const tools = [
    ['Loop', 'Loop these bars', () => { const [a, b] = range(); q.snapshot(); const same = q.arr.cycle && q.arr.cycle[0] === a && q.arr.cycle[1] === b; q.arr.cycle = same ? null : [a, b]; q.changed(); toast(same ? 'Loop off' : `Looping bars ${a + 1}–${b}`); }],
    ['Repeat', 'Play these bars again right after (everything on them)', () => {
      const [a, b] = range(), n = b - a; q.snapshot();
      // every piece on these bars, cut to them, played again right after (treatments and all)
      const copies = q.arr.clips.filter((c) => c.start < b && c.start + c.len > a).map((c) => {
        const s2 = Math.max(a, c.start), e2 = Math.min(b, c.start + c.len), d = s2 - c.start, pc = { ...c, id: undefined, fx: c.fx ? { ...c.fx } : undefined, start: s2 + n, len: e2 - s2 };
        if (c.src !== undefined) shiftSrc(pc, d); else pc.off = (c.off || 0) + d; return pc;
      });
      for (const c of copies) q.place(c); grow(b + n); q.changed();
      sel = [b, b + n]; showSel(); toast(`Repeated · bars ${b + 1}–${b + n}`); buzz(12);
    }],
    ['Reverse', 'Every bar backwards', band('Reversed', (a) => ({ src: srcAt(a), fx: { r: 1 } }))],
    ['Half', 'Half speed, an octave down', band('Half speed', (a) => ({ src: srcAt(a), fx: { s: 0.5 } }))],
    ['Stutter', 'The start of each bar, over and over', band('Stuttered', (a) => ({ src: srcAt(a), fx: { u: 8 } }))],
    ['Silence', 'The stems rest here', band('Silenced', (a) => ({ src: srcAt(a), mute: song.stems.map((x) => x.id) }))],
    ['Song', 'Put the song’s own bars back here', band('The song again', (a) => ({ src: a % song.numBars }))],
    ['Clear', 'Take instruments, moves and stem changes out of these bars', () => {
      const [a, b] = range(); q.snapshot();
      for (const lane of new Set(q.arr.clips.filter((c) => c.lane !== 'band').map((c) => c.lane))) { const d = q.place({ lane, start: a, len: b - a, pat: '·' }); q.arr.clips = q.arr.clips.filter((c) => c !== d); }
      q.changed(); toast(`Cleared bars ${a + 1}–${b} · ↶ undoes`); buzz(12);
    }],
  ].map(([l, t, fn]) => h('button', { type: 'button', class: 'act', title: t, onclick: fn }, l));
  const selLabel = h('p', { class: 'docklabel' });
  const showSel = () => { const [a, b] = range(); selLabel.textContent = sel ? `Bars ${a + 1}–${b}` : `Next four bars · drag across the tape to choose`; };
  S.player.on('bar', () => { if (!sel) showSel(); }); showSel();

  // record audio onto the tape (the lane "Audio": voice.js)
  const recA = h('button', { type: 'button', class: 'chip recaudio' }, h('i'), h('span', {}, 'Record audio'));
  recA.onclick = async () => {
    if (V.recording) { recA.disabled = true; const r = await V.stop(); recA.disabled = false; toast(r ? `Recorded ${r.bars} bar${r.bars > 1 ? 's' : ''} onto “Audio” · ↶ undoes` : 'Nothing was heard, so nothing was kept'); buzz(20); return; }
    try { await V.start(); toast('Recording from the next bar'); buzz(15); } catch (err) { toast(err.message); }
  };
  const showRecA = () => { recA.classList.toggle('on', V.recording); recA.lastChild.textContent = V.recording ? `Stop · bar ${V.bars + 1}` : 'Record audio'; };
  V.addEventListener('change', showRecA); showRecA();
  const takes = h('div', { class: 'takes' });
  const btn = (label, fn, cls = 'chip') => h('button', { type: 'button', class: cls, onclick: fn }, label);
  const capB = btn('Capture', () => { const r = q.capture(); if (r) { toast(`Kept ${r.len} bar${r.len > 1 ? 's' : ''} as ${takeName(r.k)} at bar ${r.bar + 1}`); buzz(20); } else toast('Nothing played yet to capture'); });
  room.append(
    h('div', { class: 'head row' }, h('h2', {}, 'Tape'), h('span', { class: 'sp' }), recA),
    box,
    h('div', { class: 'tapetools' }, selLabel, h('div', { class: 'acts four' }, ...tools)),
    h('div', { class: 'row wrap' }, capB, btn('Redo', () => q.redo())),
    takes);
  const sync = () => {
    capB.disabled = q.rec || !q.canCapture();
    const ks = [...new Set(q.arr.clips.filter((c) => c.pat && isTake(c.pat)).map((c) => c.pat))];
    takes.replaceChildren(...ks.map((k) => { const cl = q.arr.clips.filter((c) => c.pat === k), start = Math.min(...cl.map((c) => c.start)); return h('div', { class: 'take' }, h('button', { type: 'button', class: 'go', onclick: () => S.seek(start) }, `▸ ${takeName(k)}`), h('span', { class: 'mono' }, `bar ${start + 1} · ${q.lens[k]} bars`), h('button', { type: 'button', class: 'x', 'aria-label': `Remove ${takeName(k)}`, onclick: () => { q.snapshot(); q.arr.clips = q.arr.clips.filter((c) => c.pat !== k); q.changed(); toast(`${takeName(k)} removed · ↶ undoes`); } }, '×')); }));
  };
  q.addEventListener('change', sync); sync();
  S.rooms.tape = {
    draw: () => {
      if (V.recording) recA.style.setProperty('--lv', Math.min(1, V.level() * 1.4).toFixed(2));
      if (!W) return; const { top, rh, ppb } = geo(); g.clearRect(0, 0, W, H);
      g.font = '9px "IBM Plex Mono", monospace'; g.textBaseline = 'middle';
      const every = ppb > 14 ? 4 : ppb > 6 ? 8 : 16;
      for (let b = 0; b <= q.arr.bars; b += every) { g.fillStyle = '#ffffff16'; g.fillRect(b * ppb, top, 1, H - top); g.fillStyle = '#6f747f'; g.fillText(String(b + 1), b * ppb + 2, 8); }
      ROWS.forEach((r, i) => { g.fillStyle = i % 2 ? '#ffffff05' : '#ffffff02'; g.fillRect(0, top + i * rh, W, rh); });
      const c = q.arr.cycle; if (c) { g.fillStyle = '#e6b45026'; g.fillRect(c[0] * ppb, 0, (c[1] - c[0]) * ppb, H); }
      for (const cl of q.arr.clips) {
        const row = rowOf(cl); if (row < 0) continue; const col = ROWS[row][2];
        const x = cl.start * ppb, w = Math.max(2, cl.len * ppb), y = top + row * rh + 3, hh = rh - 6;
        g.fillStyle = col + (cl.fx || cl.mute?.length ? '55' : '30'); g.fillRect(x + 0.5, y, w - 1, hh); g.fillStyle = col; g.fillRect(x + 0.5, y, 1.5, hh);
        if (cl.pat && isTake(cl.pat)) { g.fillStyle = '#df8a74'; g.fillRect(x + 0.5, y + hh - 2, w - 1, 2); }
      }
      // your audio plays where the song's bars go: draw it bar by bar
      const vc = S.song.stems.find((x) => x.voice)?.cells || [];
      if (vc.some(Boolean)) for (let b = 0; b < q.arr.bars; b++) if (vc[Math.floor(srcAt(b) / cb)]) { g.fillStyle = '#df8a7466'; g.fillRect(b * ppb + 0.5, top + 2 * rh + 3, Math.max(1, ppb - 1), rh - 6); }
      ROWS.forEach(([, nm], i) => { g.fillStyle = '#a3a6ad'; g.fillText(nm, 4, top + i * rh + 9); });
      if (sel) { g.fillStyle = '#ece8dc1c'; g.fillRect(sel[0] * ppb, top, (sel[1] - sel[0]) * ppb, H - top); g.strokeStyle = '#ece8dc'; g.lineWidth = 1; g.strokeRect(sel[0] * ppb + 0.5, top + 0.5, (sel[1] - sel[0]) * ppb - 1, H - top - 1); }
      const pb = q.tl(q.nowBeat()) / bpb(); g.fillStyle = q.rec ? '#df8a74' : '#ece8dc'; g.fillRect(pb * ppb, 0, 2, H);
      if (q.take) { const t = q.take, l = t.len || Math.max(0, pb - t.start); g.fillStyle = '#df8a7430'; g.fillRect(t.start * ppb, 0, l * ppb, H); }
    },
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
  const walkB = h('button', { type: 'button', class: 'bigsw', onclick: async () => { await askSensors(); await S.ctx.resume(); unlockIOS(); W.set(!W.on); buzz(15); } }, h('i'), h('b', {}, 'Walk'), h('small', {}, 'the song follows your steps'));
  const spm = h('b', { class: 'num' }, '–'), bpm = h('b', { class: 'num' }, '–'), wst = h('p', { class: 'cap' });
  const tap = h('button', { type: 'button', class: 'steppad', onpointerdown: (e) => { e.preventDefault(); if (!W.on) return; W.step(); buzz(6); tap.classList.add('hit'); setTimeout(() => tap.classList.remove('hit'), 90); } }, 'tap your steps here');
  const showWalk = () => {
    walkB.setAttribute('aria-pressed', W.on); tap.hidden = !W.on;
    spm.textContent = W.on && W.spm ? Math.round(W.spm) : '–'; bpm.textContent = Math.round(S.params.get('song.bpm'));
    wst.textContent = !W.on ? 'Your pace becomes the tempo.' : W.still ? 'Standing still · the stems wait, the Cloud holds a drone · walk on' : 'Walking · the song follows you';
  };
  W.addEventListener('change', showWalk); S.params.on(({ path }) => path === 'song.bpm' && showWalk()); showWalk();
  // turn
  const turnB = h('button', { type: 'button', class: 'bigsw', onclick: async () => { await askSensors(); await S.ctx.resume(); unlockIOS(); T.set(!T.on); buzz(15); } }, h('i'), h('b', {}, 'Turn'), h('small', {}, 'stand inside the band'));
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
  S.rooms[S.page]?.draw?.();
  requestAnimationFrame(frame);
}
const KEY = () => `playground.pocket.${S.song.id}`;
function save() { try { localStorage.setItem(KEY(), JSON.stringify({ v: 2, song: S.song.id, params: S.params.dump(), seq: S.seq.dump(), cloud: S.cloudSrc, forges: S.sounds.map((s) => s.slot.src || null), band: S.session.state })); } catch { /* full or private */ } }
function restore() {
  let d; try { d = JSON.parse(localStorage.getItem(KEY())); } catch { return; }
  if (!d || d.v !== 2) return;
  S.params.load(d.params); S.seq.load(d.seq);
  if (d.cloud) S.cloudSrc = d.cloud;
  d.forges?.forEach((src, i) => { if (src && S.sounds[i]) S.sounds[i].slot.src = src; });
  if (d.band?.songId === S.song.id) S.session.dispatch({ t: 'state/load', state: d.band }, { log: false });
}
