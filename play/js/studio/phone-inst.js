// Instruments: a sound made from a stem, shaped with one hand while the other plays it. The pads are always at the bottom;
// above them one of three windows:
//  Source   — which stem it is made from, which part of the song, and the slice itself
//  Field    — four sounds in its four corners and your finger between them; Auto moves the point by itself, in time
//  Controls — everything the sound is made of, each one the size of a thumb
// Breath: blow into the microphone and the sound follows. Knock: knock on the phone and it plays. Shake: four new corners.
import { h, $ } from '../lib/util.js';
import { clamp, r3, buzz, surface, gestures, tileField, morphPad, zoomPeaks, COLORS, NAMES, NOTE } from './phone-kit.js';
import { recButton } from './voice.js';
import { pickStem } from './phone-pick.js';
import { loudestCells } from './core.js';

const SCALES = { 'minor pent.': [0, 3, 5, 7, 10], 'major pent.': [0, 2, 4, 7, 9], minor: [0, 2, 3, 5, 7, 8, 10], major: [0, 2, 4, 5, 7, 9, 11], dorian: [0, 2, 3, 5, 7, 9, 10] };
const sec = (v) => (v < 0.9995 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(1)} s`), pct = (v) => Math.round(v * 100);
/** The eight things each kind of sound is made of: [param, name, how to say it]. */
const ARMS = {
  sampler: (k) => [[`${k}.s.attack`, 'Attack', (v) => sec(0.002 + v * v * 3)], [`${k}.s.cutoff`, 'Tone', pct], [`${k}.s.res`, 'Peak', pct], [`${k}.s.env`, 'Bite', pct], [`mix.${k}.heat`, 'Heat', pct], [`mix.${k}.echo`, 'Echo', pct], [`mix.${k}.space`, 'Space', pct], [`${k}.s.release`, 'Release', (v) => sec(0.02 + v * v * 6)]],
  strings: (k) => [[`${k}.t.decay`, 'Sustain', pct], [`${k}.t.bright`, 'Bright', pct], [`${k}.t.excite`, 'Strike', (v) => sec(0.005 + v * v * 1.2)], [`${k}.t.body`, 'Source', pct], [`${k}.t.detune`, 'Detune', pct], [`mix.${k}.echo`, 'Echo', pct], [`mix.${k}.space`, 'Space', pct], [`${k}.t.release`, 'Release', (v) => sec(0.02 + v * 3)]],
  grains: (k) => [[`${k}.g.attack`, 'Swell', (v) => sec(0.005 + v * v * 4)], [`${k}.g.size`, 'Grain', (v) => sec((20 + 980 * v * v) / 1000)], [`${k}.g.density`, 'Density', pct], [`${k}.g.spread`, 'Spray', pct], [`${k}.g.jitter`, 'Shimmer', pct], [`mix.${k}.echo`, 'Echo', pct], [`mix.${k}.space`, 'Space', pct], [`${k}.g.release`, 'Release', (v) => sec(0.05 + v * v * 9)]],
  cloud: () => [['cloud.attack', 'Attack', (v) => sec(0.002 + v * v * 4)], ['cloud.size', 'Grain', (v) => sec((10 + 990 * v * v) / 1000)], ['cloud.density', 'Density', pct], ['cloud.spray', 'Spray', pct], ['cloud.shape', 'Shape', pct], ['mix.cloud.echo', 'Echo', pct], ['mix.cloud.space', 'Space', pct], ['cloud.release', 'Release', (v) => sec(0.02 + v * v * 8)]],
};
/** Four sounds to start from, in the arms' order. */
const CORNERS = {
  sampler: [['pluck', [0, 0.78, 0.1, 0.6, 0, 0.12, 0.1, 0.16]], ['swell', [0.62, 0.6, 0.12, 0.2, 0, 0.3, 0.7, 0.72]], ['grit', [0.01, 0.92, 0.5, 0.8, 0.75, 0.1, 0.05, 0.25]], ['deep', [0.12, 0.26, 0.35, 0.12, 0.15, 0.45, 0.5, 0.5]]],
  strings: [['harp', [0.7, 0.62, 0.1, 0.1, 0.1, 0.2, 0.25, 0.4]], ['bow', [0.97, 0.4, 0.9, 0.15, 0.25, 0.15, 0.5, 0.7]], ['wire', [0.92, 0.98, 0.04, 0.3, 0.02, 0.42, 0.1, 0.3]], ['felt', [0.42, 0.1, 0.2, 0.05, 0.45, 0.1, 0.6, 0.2]]],
  grains: [['mist', [0.6, 0.85, 0.5, 0.6, 0.08, 0.1, 0.7, 0.8]], ['choir', [0.4, 0.7, 0.85, 0.1, 0.02, 0.2, 0.5, 0.6]], ['bees', [0.04, 0.12, 0.96, 0.3, 0.25, 0.1, 0.1, 0.3]], ['dust', [0.02, 0.18, 0.15, 0.95, 0.9, 0.6, 0.35, 0.4]]],
  cloud: [['mist', [0.5, 0.62, 0.5, 0.55, 0.1, 0.1, 0.7, 0.65]], ['choir', [0.4, 0.7, 0.85, 0.12, 0.1, 0.15, 0.5, 0.6]], ['spark', [0, 0.1, 0.4, 0.8, 0.95, 0.5, 0.3, 0.15]], ['hum', [0.2, 0.08, 0.97, 0.02, 0.2, 0.1, 0.2, 0.4]]],
};
/** What Controls has besides the eight: how loud, how high, and two tones. */
const st = (v) => `${v > 0 ? '+' : ''}${v}`, tone = (v) => (v ? `${st(Math.round(v * 12))} dB` : 'flat');
const REST = (n) => (n ? [[`f${n}.level`, 'Level', pct], [`f${n}.tune`, 'Pitch', (v) => `${st(v)} st`, -24, 24, 1], [`mix.f${n}.low`, 'Low', tone, -1, 1], [`mix.f${n}.high`, 'High', tone, -1, 1]] : [['cloud.level', 'Level', pct], ['cloud.pitch', 'Pitch', (v) => `${st(v)} st`, -24, 24, 1], ['mix.cloud.low', 'Low', tone, -1, 1], ['mix.cloud.high', 'High', tone, -1, 1]]);
export function buildPlay(S, U) {
  const room = $('#p-play'), P = S.params, { toast, tiltSet, askSensors, Motion } = U;
  P.define('pocket.slot', 1); P.define('pocket.root', 9); P.define('pocket.scale', 'minor pent.'); P.define('pocket.oct', 0); P.define('pocket.view', 'source');
  const slot = () => Math.min(P.get('pocket.slot') || 0, S.sounds.length), sound = () => S.sounds[slot() - 1], kind = () => (slot() ? P.get(`f${slot()}.engine`) : 'cloud'), arms = () => ARMS[kind()](`f${slot()}`);

  // ---- who, what kind, where from
  let chips = []; const who = h('div', { class: 'row ins-top' });
  const addB = h('button', { type: 'button', class: 'chip who add', 'aria-label': 'Another instrument', title: 'Another instrument, made from a stem you choose', onclick: () => { const x = S.addSound(); if (!x) return; P.set('pocket.slot', x.n, { by: 'ui' }); P.set('pocket.view', 'source', { by: 'ui' }); buzz(12); choose(); } }, '+');
  const buildChips = () => { chips = [0, ...S.sounds.map((x) => x.n)].map((i) => h('button', { type: 'button', class: 'chip who', style: { '--c': COLORS[i] }, onclick: () => { P.set('pocket.slot', i, { by: 'ui' }); buzz(6); } }, h('i'), i ? String(i) : 'Cloud')); addB.hidden = !S.canAdd(); who.replaceChildren(...chips, addB); };
  if (slot() > S.sounds.length) P.v['pocket.slot'] = 1;
  const engines = h('div', { class: 'seg' }, ...[['sampler', 'Sampler'], ['strings', 'Strings'], ['grains', 'Pad']].map(([v, l]) => { const x = h('button', { type: 'button', onclick: () => { if (slot()) P.set(`f${slot()}.engine`, v); buzz(6); } }, l); x.dataset.v = v; return x; }));
  const srcName = h('button', { type: 'button', class: 'srcpick', title: 'Choose the stem it is made from' }), micB = recButton(S, { onDone: (src) => { if (slot()) sound().useRec(src); else S.useCloudSource(src, { rec: src.rec }); show(); }, say: toast, cls: 'chip' });
  const stemOf = (id) => S.song.stems.find((x) => x.id === id), ref = () => (slot() ? sound().slot.src : S.cloudSrc);
  const useStem = async (t, a) => { if (slot()) await sound().use(t.id, a); else { const [x, y] = a === undefined ? loudestCells(t, 2) : [a, a + 2]; await S.setCloudSource(t.id, x, Math.min(y, t.cells.length)); P.set('cloud.va', 0, { by: 'ui' }); P.set('cloud.vb', 1, { by: 'ui' }); } show(); };
  const choose = () => pickStem(S, { title: `${slot() ? NAMES[slot()] : 'Cloud'}: made from`, color: COLORS[slot()], current: () => ref()?.stemId, pick: (t) => useStem(t), hear: () => audition(),
    surprise: async () => { if (slot()) await sound().surprise(); else { const ss = S.song.stems.filter((x) => x.cells.filter(Boolean).length > 2); await useStem(ss[Math.floor(Math.random() * ss.length)]); } show(); } });
  srcName.onclick = () => { buzz(6); choose(); };

  // ---- where in the song: the stem's own line, four bars to a step
  const line = h('div', { class: 'stemline' }), N = surface(line), ng = N.g; let nd = null;
  const cellAt = (e) => clamp(Math.floor(((e.clientX - line.getBoundingClientRect().left) / N.W) * S.song.numCells), 0, S.song.numCells - 1);
  const near = (t, c) => { let best = -1; t.cells.forEach((x, i) => { if (x && (best < 0 || Math.abs(i - c) < Math.abs(best - c))) best = i; }); return best; };
  line.addEventListener('pointerdown', (e) => { const t = stemOf(ref()?.stemId); if (!t || !N.W) return; e.preventDefault(); try { line.setPointerCapture(e.pointerId); } catch { /* fine */ } nd = { id: e.pointerId, t, c: near(t, cellAt(e)) }; });
  line.addEventListener('pointermove', (e) => { if (nd?.id === e.pointerId) { const c = near(nd.t, cellAt(e)); if (c !== nd.c) { nd.c = c; buzz(3); } } });
  for (const k of ['pointerup', 'pointercancel']) line.addEventListener(k, async (e) => { if (nd?.id !== e.pointerId) return; const x = nd; nd = null; if (k === 'pointerup' && x.c >= 0 && x.c !== ref()?.a) { pend = x.c; await useStem(x.t, x.c); pend = null; audition(); } });
  let pend = null;

  // ---- the strip
  const strip = h('div', { class: 'slice' }), Z = surface(strip), zg = Z.g; let zk = '', zp = null;
  const sel = () => (slot() ? P.get(`f${slot()}.sel`).split(':').map(Number) : [P.get('cloud.va'), P.get('cloud.vb')]), source = () => (slot() ? sound()?.src : S.cloud.src);
  const setSel = (a, b) => { if (!isFinite(a) || !isFinite(b) || !Z.W) return; const w = clamp(b - a, 0.002, 1); a = clamp(a, 0, 1 - w); b = a + w; if (slot()) { const now = performance.now(); pendingSel = `${a.toFixed(4)}:${b.toFixed(4)}`; if (now - selT > 70) flushSel(); } else { P.set('cloud.va', r3(a)); P.set('cloud.vb', r3(b)); P.set('cloud.spread', r3(clamp((P.get('cloud.spray') * w) / 2, 0, 0.5))); P.set('cloud.pos', r3(clamp(P.get('cloud.pos'), a, b))); } };
  let pendingSel = null, selT = 0; const flushSel = () => { if (!pendingSel || !slot()) return; selT = performance.now(); P.set(`f${slot()}.sel`, pendingSel); pendingSel = null; };
  const shownSel = () => (pendingSel ? pendingSel.split(':').map(Number) : sel());
  let grab = null;
  const audition = () => { flushSel(); const v = S.slots[slot()]?.voice; if (!v) return; const id = 'aud' + Math.random(); v.noteOn(id, 60, 0.8); setTimeout(() => v.noteOff(id), 420); };
  gestures(strip, {
    down: (p) => { const [a, b] = sel(), x = p.x / Z.W, t = Math.min(24 / Z.W, Math.max(9 / Z.W, (b - a) * 0.3)), da = Math.abs(x - a), db = Math.abs(x - b); if (Math.min(da, db) < t) { grab = { end: da <= db ? 'a' : 'b' }; return; } grab = x >= a - 0.03 && x <= b + 0.03 ? { off: x - a, w: b - a } : { off: (b - a) / 2, w: b - a }; if (x < a - 0.03 || x > b + 0.03) setSel(x - grab.off, x - grab.off + grab.w); },
    move: (p) => { if (!grab) return; const x = clamp(p.x / Z.W, 0, 1); if (grab.end) { const [a, b] = shownSel(); if (grab.end === 'a') setSel(Math.min(x, b - 0.002), b); else setSel(a, Math.max(x, a + 0.002)); } else setSel(x - grab.off, x - grab.off + grab.w); }, up: () => { grab = null; audition(); },
    twoStart: () => { grab = null; }, two: (e) => { const [a, b] = shownSel(), c = (a + b) / 2 + e.dx / Z.W, w = clamp((b - a) * e.ds, 0.002, 1); setSel(c - w / 2, c + w / 2); }, allUp: audition,
  });

  // ---- the field and its faders
  let held = new Map(), wob = 0;
  const showAuto = () => { autoB.setAttribute('aria-pressed', field.auto); speedB.hidden = !field.auto; const n = field.beats(); speedB.textContent = n >= 4 ? `${n / 4} bar${n > 4 ? 's' : ''}` : `${n} beat${n > 1 ? 's' : ''}`; };
  const field = morphPad(S, { arms, corners: () => CORNERS[kind()], key: () => `${slot()}.${kind()}`, color: () => COLORS[slot()], onAuto: () => showAuto() }), tiles = tileField(S, () => [...arms(), ...REST(slot())], { cols: 3, color: () => COLORS[slot()] });
  const autoB = h('button', { type: 'button', class: 'chip tog auto', 'aria-pressed': 'false', title: 'The point moves by itself: round the movement you drew last, or in a circle until you draw one', onclick: () => { field.setAuto(!field.auto); buzz(10); } }, h('i'), 'Auto'), speedB = h('button', { type: 'button', class: 'chip tog', title: 'How long once round takes', onclick: () => { field.speed(); buzz(6); } });

  // ---- the pads
  const grid = h('div', { class: 'pads' }); let pads = [], COLS = 4, ROWS = 3;
  const notes = () => { const sc = SCALES[P.get('pocket.scale')], root = 48 + P.get('pocket.root') + 12 * P.get('pocket.oct'); return Array.from({ length: COLS * ROWS }, (_, i) => root + 12 * Math.floor(i / sc.length) + sc[i % sc.length]); };
  const build = () => {
    const land = document.body.classList.contains('land'); COLS = land ? 8 : 4; ROWS = 3; grid.style.gridTemplateColumns = `repeat(${COLS},1fr)`;
    const ns = notes(); grid.replaceChildren(); pads = [];
    for (let r = ROWS - 1; r >= 0; r--) for (let c = 0; c < COLS; c++) { const n = ns[r * COLS + c], p = h('div', { class: 'pad' + (n % 12 === P.get('pocket.root') ? ' root' : '') }, h('span', {}, `${NOTE[n % 12]}${Math.floor(n / 12) - 1}`)); p.dataset.n = n; pads.push(p); grid.append(p); }
  };
  const on = (pid, el, vel) => { const s = S.slots[slot()]; if (!s || !el) return; const n = +el.dataset.n; s.voice.noteOn(`pd${pid}`, n, vel); S.seq.noteIn(slot(), n, vel, true); S.noteSeen?.(n, true); el.classList.add('on'); held.set(pid, { el, n, slot: slot() }); wob = 1; lastPad = el; };
  const off = (pid) => { const x = held.get(pid); if (!x) return; S.slots[x.slot]?.voice.noteOff(`pd${pid}`); S.seq.noteIn(x.slot, x.n, 0, false); held.delete(pid); if (![...held.values()].some((y) => y.el === x.el)) x.el.classList.remove('on'); };
  let lastPad = null; const velOf = (e, el) => { const r = el.getBoundingClientRect(); return clamp(0.45 + 0.55 * (1 - (e.clientY - r.top) / r.height), 0.3, 1); };
  grid.addEventListener('pointerdown', (e) => { const el = e.target.closest('.pad'); if (!el) return; e.preventDefault(); try { grid.setPointerCapture(e.pointerId); } catch { /* fine */ } on(e.pointerId, el, velOf(e, el)); buzz(4); });
  grid.addEventListener('pointermove', (e) => { const x = held.get(e.pointerId); if (!x) return; const el = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.pad'); if (el && el !== x.el) { off(e.pointerId); on(e.pointerId, el, velOf(e, el)); } });
  const up = (e) => off(e.pointerId); grid.addEventListener('pointerup', up); grid.addEventListener('pointercancel', up); grid.addEventListener('contextmenu', (e) => e.preventDefault());
  const mq = matchMedia('(orientation: landscape) and (max-height: 520px)'), turn = () => { document.body.classList.toggle('land', mq.matches && S.page === 'play'); for (const id of [...held.keys()]) off(id); build(); }; mq.addEventListener('change', turn);

  // ---- breath, knock, key
  let breath = null;
  const breathB = h('button', { type: 'button', class: 'sw', title: 'Blow into the microphone: the sound follows your breath' }, h('i'), 'Breath');
  const breathOff = () => { if (breath) S.engine.releaseMic(); clearInterval(breath?.t); breath = null; for (const s of S.sounds) s.breath.gain.setTargetAtTime(1, S.ctx.currentTime, 0.05); breathB.setAttribute('aria-pressed', 'false'); };
  breathB.onclick = async () => {
    if (breath) { breathOff(); return; } if (!slot()) { toast('Breath needs one of the numbered instruments'); return; }
    let mic; try { mic = await S.engine.openMic(); } catch (e) { toast(e?.name === 'NotAllowedError' ? 'The microphone was not allowed' : 'No microphone here'); return; }
    const buf = new Float32Array(mic.monitor.fftSize); let lv = 0, floor = 0.01; breathB.setAttribute('aria-pressed', 'true'); toast('Hold a pad and blow'); buzz(12);
    breath = { t: setInterval(() => { mic.monitor.getFloatTimeDomainData(buf); let s = 0; for (const v of buf) s += v * v; const r = Math.sqrt(s / buf.length); floor += (Math.min(r, floor * 1.5 + 0.0005) - floor) * 0.01; lv += (clamp((r - floor * 1.6) * 9, 0, 1) - lv) * (r > lv ? 0.5 : 0.22); breath.lv = lv; S.sounds.forEach((x) => x.breath.gain.setTargetAtTime(x.n === slot() ? 0.02 + lv * 1.25 : 1, S.ctx.currentTime, 0.02)); wob = Math.max(wob, lv); }, 25), lv: 0 };
  };
  let knock = false; const knockB = h('button', { type: 'button', class: 'sw', title: 'Knock on the phone, or on the table it lies on: the last note plays' }, h('i'), 'Knock');
  knockB.onclick = async () => { if (!knock && !Motion.got) { await askSensors(); Motion.set(true); await new Promise((r) => setTimeout(r, 350)); } if (!knock && !Motion.got) { toast('Knock needs the phone’s motion sensors'); return; } knock = !knock; knockB.setAttribute('aria-pressed', knock); if (knock) toast('Knock on the phone'); };
  const keyB = h('button', { type: 'button', class: 'chip', onclick: () => P.set('pocket.root', (P.get('pocket.root') + 7) % 12, { by: 'ui' }) }), scaleB = h('button', { type: 'button', class: 'chip', onclick: () => { const k = Object.keys(SCALES); P.set('pocket.scale', k[(k.indexOf(P.get('pocket.scale')) + 1) % k.length], { by: 'ui' }); } }), octB = h('button', { type: 'button', class: 'chip', onclick: () => P.set('pocket.oct', P.get('pocket.oct') >= 1 ? -1 : P.get('pocket.oct') + 1, { by: 'ui' }) });
  const revB = h('button', { type: 'button', class: 'chip tog', onclick: () => { P.set(`f${slot()}.s.reverse`, !P.get(`f${slot()}.s.reverse`)); show(); buzz(6); } }, 'Rev'), holdB = h('button', { type: 'button', class: 'chip tog', onclick: () => { P.set(`f${slot()}.s.loop`, !P.get(`f${slot()}.s.loop`)); show(); buzz(6); } }, 'Hold');

  const show = () => {
    const s = slot(); chips.forEach((c, i) => c.setAttribute('aria-pressed', i === s)); room.style.setProperty('--c', COLORS[s]); engines.hidden = !s; breathB.hidden = !s; remB.hidden = s < 3 || s !== S.sounds.length; line.hidden = !stemOf(ref()?.stemId); revB.hidden = holdB.hidden = kind() !== 'sampler';
    srcName.replaceChildren(h('span', {}, s ? sound().srcName : S.cloudSrc?.rec ? 'your recording' : stemOf(S.cloudSrc?.stemId)?.name || '…'), h('i', {}, '▾'));
    if (s) { engines.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x.dataset.v === kind())); revB.setAttribute('aria-pressed', !!P.get(`f${s}.s.reverse`)); holdB.setAttribute('aria-pressed', !!P.get(`f${s}.s.loop`)); }
    keyB.textContent = NOTE[P.get('pocket.root')]; scaleB.textContent = P.get('pocket.scale'); showAuto(); octB.textContent = `oct ${P.get('pocket.oct') > 0 ? '+' : ''}${P.get('pocket.oct')}`; zk = '';
  };
  P.on(({ path }) => { if (path === 'pocket.view') { showView(); return; } if (/^pocket\./.test(path) || /\.engine$/.test(path)) { pendingSel = null; if (path === 'pocket.slot' && breath) breathOff(); for (const id of [...held.keys()]) off(id); if (path !== 'pocket.slot') build(); show(); } });
  // ---- the windows
  const remB = h('button', { type: 'button', class: 'chip', title: 'Remove this instrument', onclick: () => S.removeSound() }, 'Remove');
  const VIEWS = [['source', 'Source'], ['field', 'Field'], ['controls', 'Controls']], tabs = h('div', { class: 'seg views' }, ...VIEWS.map(([k, l]) => { const b = h('button', { type: 'button', onclick: () => { P.set('pocket.view', k, { by: 'ui' }); buzz(6); } }, l); b.dataset.v = k; return b; }));
  const V = {
    source: h('div', { class: 'deck' }, h('div', { class: 'row ins-src' }, srcName, engines), line, strip, h('div', { class: 'row ins-row' }, micB, h('span', { class: 'sp' }), holdB, revB, remB)),
    field: h('div', { class: 'deck' }, field, h('div', { class: 'row ins-row' }, autoB, speedB, h('button', { type: 'button', class: 'chip tog', title: 'Four new sounds in the corners (or shake the phone)', onclick: () => { field.shuffle(); buzz(12); } }, 'Corners'), h('span', { class: 'sp' }), breathB, knockB)),
    controls: h('div', { class: 'deck' }, tiles),
  };
  const view = () => (V[P.get('pocket.view')] ? P.get('pocket.view') : 'source'), showView = () => { const v = view(); for (const k in V) V[k].hidden = k !== v; tabs.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === v)); };
  const sc = S.soundsChanged; S.soundsChanged = () => { sc?.(); buildChips(); show(); };
  buildChips(); build(); show(); showView(); S.soundChanged = show;
  room.append(who, tabs, V.source, V.field, V.controls, grid, h('div', { class: 'row ins-key' }, keyB, scaleB, octB));

  // ---- drawing
  function draw() {
    if (document.body.classList.contains('land')) return; const now = performance.now();
    if (view() === 'source' && N.W) {
      const { W, H } = N, t = stemOf(ref()?.stemId), n = S.song.numCells, cw = W / n, k = ref(), at = nd ? nd.c : pend ?? k?.a ?? -1, wide = slot() ? 1 : 2; ng.clearRect(0, 0, W, H);
      if (t) { const top = Math.max(...t.cells.map((c) => (c ? c.rms : -99))); t.cells.forEach((c, i) => { const v = c && c.rms > -60 ? clamp(1 + (c.rms - top) / 24, 0.1, 1) : 0, inn = i >= at && i < at + wide; if (inn) { ng.fillStyle = COLORS[slot()] + '30'; ng.fillRect(i * cw, 0, cw, H); } if (!v) return; ng.fillStyle = inn ? COLORS[slot()] : '#ece8dc55'; ng.fillRect(i * cw + 0.7, H - 3 - v * (H - 18), cw - 1.4, v * (H - 18)); }); ng.font = '10px "IBM Plex Mono", monospace'; ng.textBaseline = 'top'; ng.textAlign = 'left'; ng.fillStyle = '#c3c4c8'; ng.fillText(at >= 0 ? `BAR ${at * S.song.barsPerCell + 1}–${Math.min(S.song.numBars, (at + wide) * S.song.barsPerCell)}` : '', 7, 4); }
    }
    if (view() === 'source' && Z.W) {
      const { W, H } = Z, src = source(), [a, b] = shownSel(), key = `${src?.stemId}:${src?.fromCell}:${W}`; if (src && key !== zk) { zk = key; zp = zoomPeaks(src, 0, 1, Math.floor(W / 1.5)); }
      zg.clearRect(0, 0, W, H); if (zp && src) { const n = zp.length / 2, pk = Math.max(0.02, ...zp.map(Math.abs)); for (let i = 0; i < n; i++) { const u = i / n, inn = u >= a && u <= b; zg.fillStyle = inn ? COLORS[slot()] : '#ece8dc3c'; const y0 = H / 2 - (zp[2 * i + 1] / pk) * H * 0.42, y1 = H / 2 - (zp[2 * i] / pk) * H * 0.42; zg.fillRect(u * W, y0, 1.2, Math.max(1, y1 - y0)); } }
      zg.fillStyle = COLORS[slot()] + '22'; zg.fillRect(a * W, 0, Math.max(2, (b - a) * W), H); zg.fillStyle = COLORS[slot()]; zg.fillRect(a * W, 0, 2, H); zg.fillRect(b * W - 2, 0, 2, H); for (const u of [a, b]) { zg.beginPath(); zg.roundRect(clamp(u * W - 5, 0, W - 10), H / 2 - 14, 10, 28, 5); zg.fill(); }
      if (src) { zg.font = '10px "IBM Plex Mono", monospace'; zg.textBaseline = 'top'; zg.textAlign = a > 0.7 ? 'right' : 'left'; zg.fillStyle = '#fff'; zg.fillText(sec((b - a) * src.dur), a > 0.7 ? a * W - 5 : Math.min(W - 50, b * W + 5), 5); }
    }
    field.tick(); if (view() === 'field') field.draw(); if (view() === 'controls') tiles.draw(); wob *= 0.95;
  }
  const echo = () => `mix.${slot() ? 'f' + slot() : 'cloud'}.echo`, play = (el, ms, vel = 0.8) => { if (!el) return; const id = 9000 + Math.random(); on(id, el, vel); setTimeout(() => off(id), ms); };
  S.rooms.play = {
    tilt: (x, y) => { if (!held.size) return; tiltSet(slot() ? (kind() === 'sampler' ? `f${slot()}.s.cutoff` : kind() === 'strings' ? `f${slot()}.t.bright` : `f${slot()}.g.jitter`) : 'cloud.pitch', slot() ? clamp(0.6 + x * 0.4, 0, 1) : Math.round(x * 7), slot() ? 0.02 : 1); tiltSet(echo(), clamp(y, 0, 1) * 0.8, 0.02); },
    shake: () => { field.shuffle(); buzz([10, 40, 20]); play(lastPad || pads[COLS * 2], 500); },
    knock: (v) => { if (knock) play(lastPad || pads[0], 220, clamp(v, 0.3, 1)); },
    draw, bg: () => field.tick(), show: () => { turn(); show(); }, hide: () => { document.body.classList.remove('land'); for (const id of [...held.keys()]) off(id); if (breath) breathOff(); },
  };
  S.inst = { arms, field, get pads() { return pads; } };
}
