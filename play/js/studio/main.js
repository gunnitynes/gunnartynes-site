// The playground studio. The band plays on (the stems, re-arrangeable and switchable off as a whole); around it
// three ways to make new sound out of them — a granular Cloud, a Forge of instruments built from any slice, and a
// Textures rack on the master — all playable from the keys and recordable, as notes and moves, into four variations.
import { AudioEngine } from '../engine/audio.js';
import { CellLoader } from '../engine/loader.js';
import { Player } from '../engine/player.js';
import { Session, initialState } from '../state/session.js';
import { $, h, api } from '../lib/util.js';
import { Params, loadSource, loudestCells, loudestWindow, sliceOf, CloudVoice, SamplerVoice, StringsVoice, buildTextures, Sequencer, PATS, isTake, takeName, srcBar } from './core.js';
import { Wave, Keys, knob, group } from './ui.js';
import { buildStrips, buildMixRoom } from './mixer.js';
import { buildSong } from './song.js';
import { buildTexturesRoom } from './textures.js';
import { addVoiceStem, Voice } from './voice.js';
import { Mutator } from './mutate.js';

const params = new URLSearchParams(location.search);
const S = { slots: [], rooms: {} };
window.studio = S;
const NOTE = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const COLORS = ['#e6b450', '#9cc2f4', '#8fd3c5', '#f29ba0', '#c3a6f0', '#f0c08f', '#a8d68a', '#7fc9e8', '#e8a0d0'];
const NAMES = ['Cloud', 'Instrument 1', 'Instrument 2', 'Instrument 3', 'Instrument 4', 'Instrument 5', 'Instrument 6', 'Instrument 7', 'Instrument 8'];
const MAX_FORGE = 8;
const short = (n) => n.replace('Instrument ', 'Inst ');
const sec = (v) => (v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(1)} s`);

boot().catch((e) => { console.error(e); $('#gate-status').textContent = 'Could not load: ' + e.message; });

async function boot() {
  const songId = params.get('song') || (await api.get('/api/songs'))[0]?.id;
  const song = await api.get(`/api/songs/${songId}`);
  addVoiceStem(song);   // "You": a stem that is empty until you record into it
  document.title = `${song.title} · Playground · Gunnar Tynes`;
  $('#song').textContent = song.title; $('#gate-title').textContent = song.title;
  $('#gate-meta').textContent = `${song.artist} · ${song.stems.length - 1} stems · ${song.bpm} bpm`;

  const engine = new AudioEngine(); await engine.ready;
  await engine.ctx.audioWorklet.addModule(new URL('./dsp.js', import.meta.url));
  const loader = new CellLoader(engine.ctx, { max: 160 });
  const ids = song.stems.map((s) => s.id);
  const session = new Session(initialState(song, { catalogIds: ids }));
  const player = new Player(engine, loader, session, song);
  for (const s of song.stems) player.addSource(s.id, { id: s.id, kind: 'stem', name: s.name, cells: s.cells, gain: s.gain });
  Object.assign(S, { song, engine, ctx: engine.ctx, loader, session, player, params: new Params() });

  // the master: every source is a channel strip (mixer.js); each strip feeds the textures rack and/or straight to
  // the engine's glue and limiter. The band reaches its strip through its own on/off switch.
  const tex = buildTextures(S);
  S.tex = tex; S.resFreqs = tex.resFreqs;
  S.dryBus = engine.ctx.createGain(); S.dryBus.connect(engine.lp);
  S.bandGate = engine.ctx.createGain();
  engine.bus.disconnect(); engine.post.disconnect();
  engine.post.connect(tex.input); tex.output.connect(engine.lp);   // post now carries only the space and echo returns
  buildStrips(S, COLORS, NAMES);
  engine.bus.connect(S.bandGate).connect(S.strips.band.input);
  S.seq = new Sequencer(S);
  S.params.recorder = (path, v) => S.seq.moveIn(path, v);
  S.voice = new Voice(S); S.mutate = new Mutator(S); S.flash = flash;
  S.heard = [];
  let retuneT = 0;
  S.noteSeen = (note, on) => { if (!on) return; S.heard = [note, ...S.heard.filter((n) => n !== note)].slice(0, 6); if (S.params.get('fx.res.follow') && !retuneT) retuneT = setTimeout(() => { retuneT = 0; S.tex.retune(); }, 60); };

  let savedN = 3; try { savedN = Math.max(3, Math.min(MAX_FORGE, JSON.parse(localStorage.getItem(KEY()))?.forges?.length || 3)); } catch { /* none */ }
  buildDeck(); buildHeader(); buildArrange(); buildCloud(); buildForge(savedN);
  buildTexturesRoom(S, { seg, sw, recBtn }); buildMixRoom(S, { recBtn }); buildSong(S, { COLORS, NAMES });
  const had = restore();
  S.voice.ensureTrack(); S.mutate.drift(true); S.voice.restore();
  if (!S.seq.arr.bars) S.seq.fillFromSong();
  if (!had) S.seq.setMode('song');
  S.seq.emit();
  S.rooms.cloud.init(); S.forges.forEach((f) => f.init());
  S.selectSlot(0);
  showRoom(params.get('room') || 'song');

  const first = ids.map((id) => player.resolve(session.state.tracks[id], 0)).filter(Boolean).map((w) => w.url);
  let n = 0; await Promise.all(first.map((u) => loader.load(u).catch(() => {}).finally(() => { $('#gate-bar').style.width = `${(++n / first.length) * 100}%`; })));
  // straight into the studio once the stems are in; sound is unlocked by the first touch or key (nothing plays until you press play)
  $('#gate').classList.add('gone');
  const unlock = () => { engine.ctx.resume(); removeEventListener('pointerdown', unlock, true); removeEventListener('keydown', unlock, true); };
  addEventListener('pointerdown', unlock, true); addEventListener('keydown', unlock, true);
  requestAnimationFrame(frame);
  setInterval(save, 2000);
}

// ------------------------------------------------------------------------------------------------ header
function buildHeader() {
  const { player, params: P, session } = S;
  P.define('band.on', true, (v) => { S.bandGate.gain.setTargetAtTime(v ? 1 : 0, S.ctx.currentTime, 0.04); $('#band-sw').setAttribute('aria-pressed', v); document.body.classList.toggle('band-off', !v); });
  P.define('band.level', 0.9, (v) => S.engine.bus.gain.setTargetAtTime(v, S.ctx.currentTime, 0.05));
  $('#band-sw').onclick = () => P.set('band.on', !P.get('band.on'));
  $('#band-knob').append(knob(P, 'band.level', 'Stems'));
  P.define('inst.level', 0.9, () => Object.values(S.strips).forEach((st) => st.inst && st.setFader()));
  $('#inst-knob').append(knob(P, 'inst.level', 'Instruments'));
  $('#t-play').onclick = () => (player.playing ? player.stop() : player.play());
  $('#t-rec').onclick = () => toggleRec();
  // tempo: the stems are warped to it (pitch kept) or played like tape (pitch follows); saved with everything else
  const orig = S.song.bpm;
  P.define('song.bpm', orig, (v) => player.setTempo(v, P.get('song.warp') ?? true));
  P.define('song.warp', true, (v) => player.setTempo(P.get('song.bpm') ?? orig, v));
  const bpmIn = h('input', { type: 'number', min: 40, max: 240, step: 1, class: 'num', 'aria-label': 'Tempo in BPM', title: `Tempo · the song is ${orig} BPM · double-click for that`, onchange: (e) => setBpm(+e.target.value), ondblclick: () => setBpm(orig) });
  const setBpm = (v) => { P.set('song.bpm', Math.max(40, Math.min(240, Math.round(v) || orig)), { by: 'ui' }); };
  const warpB = h('button', { type: 'button', class: 'warp', title: 'Warp: the stems are stretched to the tempo and keep their pitch · Tape: they play faster or slower, and the pitch goes with them', onclick: () => P.set('song.warp', !P.get('song.warp'), { by: 'ui' }) });
  const tempo = h('div', { class: 'tempo' }, h('button', { type: 'button', title: 'Slower', onclick: () => setBpm(P.get('song.bpm') - 1) }, '−'), bpmIn, h('span', { class: 'u' }, 'bpm'), h('button', { type: 'button', title: 'Faster', onclick: () => setBpm(P.get('song.bpm') + 1) }, '+'), warpB);
  $('.transport').append(tempo);
  const showTempo = () => { const b = P.get('song.bpm'); bpmIn.value = b; tempo.classList.toggle('moved', b !== orig); warpB.textContent = P.get('song.warp') ? 'warp' : 'tape'; warpB.setAttribute('aria-pressed', !P.get('song.warp')); };
  P.on(({ path }) => (path === 'song.bpm' || path === 'song.warp') && showTempo()); showTempo();
  // You: the microphone records onto your own stem while the song plays (voice.js)
  const mic = $('#t-mic'), V = S.voice;
  mic.onclick = async (e) => {
    if (e.shiftKey) { if (V.has && confirm('Take your voice out of the song? (Undo brings it back.)')) V.clear(); return; }
    if (V.recording) { mic.disabled = true; const r = await V.stop(); mic.disabled = false; flash(r ? `Your voice is in the song: ${r.bars} bar${r.bars > 1 ? 's' : ''} on the stem “You”, from bar ${r.from + 1} of the song · Undo takes it back` : 'Nothing was heard, so nothing was kept'); return; }
    try { await V.start(); flash('Recording you from the next bar: sing or play along · press again to stop · headphones keep the band out of it'); } catch (err) { flash(err.message); }
  };
  const showMic = () => { mic.classList.toggle('on', V.recording); mic.classList.toggle('has', V.has); mic.title = V.recording ? 'Stop recording your voice' : `Record yourself into the song as one more stem, “You” (sing or play along; the bars you fill are kept)${V.has ? ' · shift-click takes your voice out' : ''}`; };
  V.addEventListener('change', showMic); showMic();
  const cap = $('#t-cap');
  cap.onclick = () => { const r = S.seq.capture(); if (!r) return; flash(`Captured ${r.len} bar${r.len > 1 ? 's' : ''} as ${takeName(r.k)} at bar ${r.bar + 1} of the arrangement`); };
  const recNote = h('div', { id: 'recnote', hidden: true }); document.body.append(recNote);
  const showRec = () => {
    const q = S.seq; $('#t-rec').classList.toggle('on', q.rec && q.mode === 'song'); cap.disabled = q.rec || !q.canCapture();
    recNote.hidden = !q.rec && !S.voice.recording;
    if (S.voice.recording && !q.rec) { recNote.textContent = `● Recording you · bar ${S.voice.bars + 1} · it lands on the song's own bars, on the stem “You”`; return; }
    recNote.textContent = q.mode === 'song' ? `● Recording onto the arrangement${q.take ? ` as ${takeName(q.take.pat)}` : ''} · keys, Cloud touches, every knob, the mix and Re-arrange clicks all go in` : `● Recording into Pattern ${q.cur} · it loops, and each pass adds to it`;
  };
  S.seq.addEventListener('change', showRec); S.voice.addEventListener('change', showRec); showRec();
  $('#t-rew').onclick = () => session.dispatch({ t: 'seek', bar: S.seq.mode === 'song' && S.seq.arr.cycle ? S.seq.arr.cycle[0] : 0 });
  const modeBtns = [['jam', 'Pattern', 'Loop one pattern over the stems as they are in Re-arrange · Record goes into the pattern'], ['song', 'Arrangement', 'Play the arrangement timeline · Record goes straight onto it']].map(([m, l, t]) => h('button', { type: 'button', title: t, onclick: () => S.seq.setMode(m) }, l));
  $('#mode').append(...modeBtns);
  const showMode = () => { modeBtns.forEach((b, i) => b.setAttribute('aria-pressed', ['jam', 'song'][i] === S.seq.mode)); document.body.classList.toggle('songmode', S.seq.mode === 'song'); };
  S.seq.addEventListener('change', showMode); showMode();
  player.on('transport', ({ playing }) => { $('#t-play').classList.toggle('on', playing); $('#t-play').setAttribute('aria-label', playing ? 'Stop' : 'Play'); });
  document.querySelectorAll('#rooms button').forEach((b) => { b.onclick = () => showRoom(b.dataset.room); });
  addEventListener('keydown', (e) => {
    if (e.target.closest('input,select,textarea') || e.metaKey || e.ctrlKey) return;
    if (e.code === 'Space') { e.preventDefault(); player.playing ? player.stop() : player.play(); }
    else if (e.key === 'r' || e.key === 'R') toggleRec();
    else if (e.key === 'b' || e.key === 'B') P.set('band.on', !P.get('band.on'));
    else if ((e.key === 'k' || e.key === 'K') && S.mutate.on) { const n = S.mutate.keep(); if (n) flash(`Kept ${n === 1 ? 'that change' : `${n} changes`} in the arrangement`); }
    else if (e.key === 'Home') session.dispatch({ t: 'seek', bar: 0 });
    else if (/^[1-9]$/.test(e.key) && S.slots[+e.key - 1]) S.selectSlot(+e.key - 1);
    else if (e.key === 'Enter' && !e.target.closest('button')) S.seq.setMode(S.seq.mode === 'song' ? 'jam' : 'song');
  });
}
/** Record (R, the header's ●, every room's Record) goes onto the arrangement; the deck's "Pattern" button records into a pattern. */
function toggleRec() { const q = S.seq; if (q.rec) { q.arm(false); return; } q.setMode('song'); q.arm(true); if (!S.player.playing) S.player.play(); }
function flash(msg) { let t = $('#toast'); if (!t) { t = h('div', { id: 'toast' }); document.body.append(t); } t.textContent = msg; t.classList.add('on'); clearTimeout(flash.t); flash.t = setTimeout(() => t.classList.remove('on'), 3200); }

// ------------------------------------------------------------------------------------------------ small controls
function sourcePicker(onPick) {
  const { song } = S;
  const stemSel = h('select', { 'aria-label': 'Which musician', title: 'Which musician' }, ...song.stems.map((s) => h('option', { value: s.id }, s.name)));
  const partSel = h('select', { 'aria-label': 'Which part of the song', title: 'Which part of the song' });
  const parts = (stem) => {
    const out = [['loud', 'loudest 8 bars']];
    for (const s of song.sections) { const a = s.startCell, b = Math.min(s.endCell, a + 6); if (stem.cells.slice(a, b).some(Boolean)) out.push([`${a}-${b}`, `part ${s.name} · bar ${a * song.barsPerCell + 1}`]); }
    partSel.replaceChildren(...out.map(([v, l]) => h('option', { value: v }, l)));
  };
  const fire = () => { const st = song.stems.find((s) => s.id === stemSel.value), v = partSel.value, [a, b] = v === 'loud' ? loudestCells(st, 2) : v.split('-').map(Number); onPick(st.id, a, b); };
  stemSel.onchange = () => { parts(song.stems.find((s) => s.id === stemSel.value)); fire(); };
  partSel.onchange = fire; parts(song.stems[0]);
  const el = h('div', { class: 'picker' }, stemSel, partSel);
  el.set = (stemId, a, b) => { stemSel.value = stemId; parts(song.stems.find((s) => s.id === stemId)); const key = `${a}-${b}`; partSel.value = [...partSel.options].some((o) => o.value === key) ? key : 'loud'; fire(); };
  return el;
}
const seg = (P, path, options, title) => { const b = options.map(([v, l]) => h('button', { type: 'button', onclick: () => P.set(path, v) }, l)); const show = () => b.forEach((x, i) => x.setAttribute('aria-pressed', options[i][0] === P.get(path))); P.on(({ path: p }) => p === path && show()); show(); return h('div', { class: 'seg', title }, ...b); };
const sw = (P, path, label, title) => { const b = h('button', { type: 'button', class: 'sw', title, onclick: () => P.set(path, !P.get(path)) }, h('i'), label); const show = () => b.setAttribute('aria-pressed', !!P.get(path)); P.on(({ path: p }) => p === path && show()); show(); return b; };
const pick = (P, path, options, title) => { const s = h('select', { title, 'aria-label': title, onchange: (e) => P.set(path, isNaN(+e.target.value) ? e.target.value : +e.target.value) }, ...options.map(([v, l]) => h('option', { value: v }, l))); const show = () => { s.value = P.get(path); }; P.on(({ path: p }) => p === path && show()); show(); return s; };
const recBtn = (label) => { const b = h('button', { type: 'button', class: 'rec', title: 'Record every note and move onto the arrangement, where the playhead is (R)', onclick: toggleRec }, h('i'), label); const s = () => b.classList.toggle('on', S.seq.rec && S.seq.mode === 'song'); S.seq.addEventListener('change', s); s(); return b; };

// ------------------------------------------------------------------------------------------------ Re-arrange (the band: map + mixer)
function buildArrange() {
  const room = $('#room-arrange'), { song, session, player, params: P } = S;
  const mixer = h('div', { class: 'mix' }), box = h('div', { class: 'map' }), cv = h('canvas'); box.append(cv);
  S.meters = [];
  mixer.append(h('div', { class: 'strip head' }, h('span', { class: 'nm' }, 'Musician'), h('span', {}, ''), h('span', {}, ''), h('span', { class: 'cap' }, 'Level')));
  for (const st of song.stems) {
    const id = st.id;
    P.define(`band.${id}.gain`, 0.85, (v) => session.dispatch({ t: 'track/set', id, p: { gain: v } }, { log: false }));
    P.define(`band.${id}.mute`, false, (v) => session.dispatch({ t: 'track/set', id, p: { mute: v } }, { log: false }));
    P.define(`band.${id}.solo`, false, (v) => session.dispatch({ t: 'track/set', id, p: { solo: v } }, { log: false }));
    P.define(`band.${id}.pan`, 0, (v) => session.dispatch({ t: 'track/set', id, p: { pan: v } }, { log: false }));
    P.define(`band.${id}.rev`, 0, (v) => session.dispatch({ t: 'track/set', id, p: { rev: v * v * 0.8 } }, { log: false }));
    const lvl = h('i', { class: 'lvl' }), bar = h('div', { class: 'gain', title: `${st.name} level · drag` }, lvl);
    const meter = h('i', { class: 'meter' }); S.meters.push([id, meter]);
    const showG = () => { lvl.style.width = `${P.get(`band.${id}.gain`) * 100}%`; }; P.on(({ path }) => path === `band.${id}.gain` && showG()); showG();
    let drag = false; const at = (e) => { const r = bar.getBoundingClientRect(); P.set(`band.${id}.gain`, +Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)).toFixed(3)); };
    bar.addEventListener('pointerdown', (e) => { drag = true; bar.setPointerCapture(e.pointerId); at(e); }); bar.addEventListener('pointermove', (e) => drag && at(e)); bar.addEventListener('pointerup', () => { drag = false; });
    const ms = (k, l, t) => { const b = h('button', { type: 'button', class: `ms ${k}`, title: t, onclick: () => P.set(`band.${id}.${k}`, !P.get(`band.${id}.${k}`)) }, l); const show = () => b.setAttribute('aria-pressed', !!P.get(`band.${id}.${k}`)); P.on(({ path }) => path === `band.${id}.${k}` && show()); show(); return b; };
    mixer.append(h('div', { class: 'strip' }, h('span', { class: 'nm', title: st.name }, st.name), ms('mute', 'M', 'Mute'), ms('solo', 'S', 'Solo'), h('div', { class: 'gw' }, bar, meter)));
  }
  const jam = () => S.seq.setMode('jam'), cb = song.barsPerCell, bpb = song.beatsPerBar;
  // Re-arrange is played live. Its own Record button writes what each stem played, bar by bar, into the
  // Arrangement at the same bars (only where it differs from what the Arrangement already plays there).
  const help = h('p', { class: 'roomhelp' }, h('b', {}, 'Play the stems live. '), 'Each row is a stem, cut into 4-bar blocks from the start of the song (left) to the end (right). Click a block and that stem loops it while the others carry on; click it again and it goes back to the song. Each stem has its own playhead, so you can see where every one of them is. Press ', h('b', { class: 'r' }, '● Record into the Arrangement'), ' and what you play is written onto the stems’ lanes in the Arrangement when you stop.');
  const recB = h('button', { type: 'button', class: 'rec big', title: 'Play live and write it into the Arrangement when you stop' }, h('i'), 'Record into the Arrangement');
  const recInfo = h('span', { class: 'cap recinfo' });
  const tools = h('div', { class: 'bar2' }, recB, recInfo,
    h('button', { type: 'button', class: 'pill', title: 'Let every stem play the song as written', onclick: () => { jam(); session.dispatch({ t: 'tracks/set', p: Object.fromEntries(session.state.order.map((id) => [id, { mode: 'follow' }])) }); } }, 'Everyone follows the song'),
    h('button', { type: 'button', class: 'pill', title: 'Keep every stem on the four bars playing now', onclick: () => { jam(); const c = Math.floor(Math.max(0, player.barNow()) / cb) % song.numCells; session.dispatch({ t: 'tracks/set', p: Object.fromEntries(session.state.order.map((id) => [id, { mode: 'loop', cell: c }])) }); } }, 'Hold this moment'),
    h('span', { class: 'sp' }), h('span', { class: 'legend' }, h('i', { class: 'lf' }), 'plays the song', h('i', { class: 'lh' }), 'looping this block', h('i', { class: 'lp' }), 'playhead'));
  const songNote = h('div', { class: 'arr-song' }, h('span', {}, 'The Arrangement is playing. Click a block, or press Record, to play the stems live here.'));
  room.append(help, tools, h('div', { class: 'arr' }, mixer, box, songNote));
  const g = cv.getContext('2d'); let W = 0, H = 0;
  new ResizeObserver(() => { const r = box.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1); W = r.width; H = r.height; cv.width = W * d; cv.height = H * d; cv.style.width = W + 'px'; cv.style.height = H + 'px'; g.setTransform(d, 0, 0, d, 0, 0); }).observe(box);
  const top = 22, geom = () => ({ cols: song.numCells, cw: W / song.numCells, rh: (H - top) / song.stems.length });
  S.arrTop = top;
  /** Leaving the Arrangement for live play: the live stems start where the Arrangement playhead was. */
  const goLive = () => { if (S.seq.mode !== 'song') return; const bar = Math.floor(S.seq.tl(S.seq.nowBeat()) / bpb) % song.numBars, was = player.playing; jam(); session.dispatch({ t: 'seek', bar }); if (was && !player.playing) player.play(); };
  cv.addEventListener('pointerdown', (e) => {
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, { cw, rh } = geom(), c = Math.floor(x / cw);
    if (y < top) { goLive(); session.dispatch({ t: 'seek', bar: c * cb }); return; }
    const st = song.stems[Math.floor((y - top) / rh)]; if (!st || !st.cells[c]) return;
    if (S.seq.mode === 'song' && S.seq.rec) { writeHold(st, c); return; }   // the Arrangement's own Record also takes clicks
    goLive();
    const tr = session.state.tracks[st.id];
    session.dispatch({ t: 'track/set', id: st.id, p: tr.mode === 'loop' && tr.cell === c ? { mode: 'follow' } : { mode: 'loop', cell: c } });
  });

  // ---- recording live play into the Arrangement: what every stem resolved to, bar by bar
  let take = null;
  player.on('bar', ({ bar }) => {
    if (!take || S.seq.mode !== 'jam') return;
    for (const st of song.stems) { const tr = session.state.tracks[st.id], w = player.resolve(tr, bar); (take.bars[st.id] ??= {})[bar] = w ? { cell: w.cell, bar: w.bar, loop: tr.mode === 'loop' } : null; }
    take.last = bar; recInfo.textContent = `recording · bar ${(take.first ?? bar) % song.numBars + 1} to ${bar % song.numBars + 1}`; take.first ??= bar;
  });
  const startLive = () => { goLive(); S.seq.mode === 'song' && jam(); take = { bars: {}, first: null, last: null }; recB.classList.add('on'); box.classList.add('rec'); recInfo.textContent = 'recording'; if (!player.playing) player.play(); };
  const stopLive = () => {
    const t = take; take = null; recB.classList.remove('on'); box.classList.remove('rec'); recInfo.textContent = '';
    if (!t || t.first === null) return;
    const q = S.seq, N = song.numBars, at = (B) => B - t.first + (t.first % N);   // the take lands where it was played in the song
    const bandSrc = (bar) => { const cl = q.arr.clips.find((c) => c.lane === 'band' && bar >= c.start && bar < c.start + c.len); return cl && !cl.mute?.length ? srcBar(cl, bar - cl.start, N).bar : null; };
    q.snapshot(); let wrote = 0, endBar = 0;
    for (const st of song.stems) {
      const rec = t.bars[st.id] || {}; let run = null;
      const flush = () => { if (!run) return; q.place(run.clip); wrote++; endBar = Math.max(endBar, run.clip.start + run.clip.len); run = null; };
      for (let B = t.first; B <= t.last; B++) {
        const r = rec[B], pos = at(B); if (!r) { flush(); continue; }
        const src = r.cell * cb + r.bar;
        // following the song where the Arrangement already plays the same bar: nothing to write
        if (!r.loop && !q.arr.own?.[st.id] && bandSrc(pos) === src) { flush(); continue; }
        const same = run && run.next === pos && (r.loop ? run.loop && run.cell === r.cell : !run.loop && run.src === src);
        if (same) { run.clip.len++; run.next++; run.src = src + 1; continue; }
        flush();
        run = r.loop ? { loop: true, cell: r.cell, next: pos + 1, clip: { lane: 'stem:' + st.id, start: pos, len: 1, src: r.cell * cb, loop: cb, off: r.bar, name: `${r.cell * cb + 1}` } }
          : { loop: false, src: src + 1, next: pos + 1, clip: { lane: 'stem:' + st.id, start: pos, len: 1, src, name: `${src + 1}` } };
      }
      flush();
    }
    if (endBar > q.arr.bars) q.arr.bars = endBar;
    q.changed();
    const a = at(t.first) + 1, z = at(t.last) + 1;
    flash(wrote ? `Written into the Arrangement: bars ${a}–${z}, ${wrote} piece${wrote > 1 ? 's' : ''} on the stems’ lanes` : `Nothing to write: bars ${a}–${z} already sound like this in the Arrangement`);
    if (!wrote) q.undos.pop();
  };
  recB.onclick = () => (take ? stopLive() : startLive());
  player.on('transport', ({ playing }) => { if (!playing && take) stopLive(); });
  S.seq.addEventListener('change', () => { songNote.hidden = S.seq.mode !== 'song' || !!take; if (take && S.seq.mode === 'song') stopLive(); });
  songNote.hidden = S.seq.mode !== 'song';

  // Arrangement mode with its Record on: a click writes a held block onto the stem's own lane, growing until released
  S.liveHolds = new Map();
  const writeHold = (st, c) => {
    const q = S.seq, lane = 'stem:' + st.id;
    const now = Math.floor(q.tl(q.nowBeat()) / bpb) + (player.playing ? 1 : 0), cur = S.liveHolds.get(st.id);
    if (cur) { S.liveHolds.delete(st.id); if (cur.src === c * cb) { q.changed(); return; } }
    const clip = q.place({ lane, start: now, len: 1, src: c * cb, loop: cb, name: `${c * cb + 1}` });
    if (clip.start + clip.len > q.arr.bars) q.arr.bars = clip.start + clip.len;
    S.liveHolds.set(st.id, clip);
    q.changed();
  };
  S.growHolds = () => {
    if (!S.liveHolds.size) return; const q = S.seq;
    if (!q.rec || q.mode !== 'song') { S.liveHolds.clear(); return; }
    const bar = Math.floor(q.tl(q.nowBeat()) / bpb); let grew = false;
    for (const [id, cl] of S.liveHolds) { if (!q.arr.clips.includes(cl)) { S.liveHolds.delete(id); continue; } const want = Math.max(cl.len, bar - cl.start + 2); if (want !== cl.len && bar >= cl.start) { cl.len = want; grew = true; } }
    if (grew) { const bars = Math.max(...[...S.liveHolds.values()].map((c) => c.start + c.len)); if (bars > q.arr.bars) q.arr.bars = bars; q.changed(); }
  };
  let hover = null; cv.addEventListener('pointermove', (e) => { const r = cv.getBoundingClientRect(); hover = [e.clientX - r.left, e.clientY - r.top]; }); cv.addEventListener('pointerleave', () => { hover = null; });
  S.rooms.arrange = { draw: () => {
    if (!W) return; const { cols, cw, rh } = geom(); g.clearRect(0, 0, W, H);
    g.font = '10px "IBM Plex Mono", monospace'; g.textBaseline = 'middle';
    for (let c = 0; c < cols; c += 4) { g.fillStyle = '#6f747f'; g.fillText(String(c * cb + 1), c * cw + 2, 10); }
    for (const s of song.sections) { g.fillStyle = '#ffffff22'; g.fillRect(s.startCell * cw, top, 1, H - top); g.fillStyle = '#a3a6ad'; if (s.startCell % 4) g.fillText(s.name, s.startCell * cw + 2, 10); }
    // no single song playhead: every stem shows where it is, which (looping) may be anywhere in the song
    const bn = Math.max(0, player.beatNow()), B = Math.floor(bn / bpb), frac = (bn / bpb) - B, live = player.playing || S.seq.mode === 'song';
    song.stems.forEach((st, r) => {
      const tr = session.state.tracks[st.id], y = top + r * rh;
      const w = live ? player.resolve(tr, B) : null;
      for (let c = 0; c < cols; c++) {
        const cell = st.cells[c]; if (!cell) continue;
        const a = Math.max(0.12, Math.min(1, (cell.rms + 50) / 40)), held = tr.mode === 'loop' && tr.cell === c;
        g.fillStyle = held ? '#e6b450' : `rgba(236,232,220,${(w && w.cell === c ? 0.75 : tr.mode === 'loop' ? 0.12 : 0.4) * a})`;
        g.fillRect(c * cw + 1, y + 1, cw - 2, rh - 2);
      }
      if (w) { const x = (w.cell + (w.bar + frac) / cb) * cw; g.fillStyle = take || S.liveHolds.has(st.id) ? '#df8a74' : tr.mode === 'loop' ? '#11141b' : '#ece8dc'; g.fillRect(x - 1, y + 1, 2, rh - 2); }
    });
    if (hover) { const c = Math.floor(hover[0] / cw); g.strokeStyle = '#ece8dc'; g.lineWidth = 1; if (hover[1] > top) { const r = Math.floor((hover[1] - top) / rh); g.strokeRect(c * cw + 0.5, top + r * rh + 0.5, cw - 1, rh - 1); } else { g.strokeRect(c * cw + 0.5, 1, cw - 1, top - 3); } }
  } };
}

// ------------------------------------------------------------------------------------------------ Cloud
const YAXES = { spray: ['Spray', 'cloud.spread', (y) => +(0.5 * y ** 1.5).toFixed(4)], size: ['Grain size', 'cloud.size', (y) => +y.toFixed(4)], pitch: ['Pitch', 'cloud.pitch', (y) => Math.round(-24 + y * 48)], density: ['Density', 'cloud.density', (y) => +y.toFixed(4)] };
function buildCloud() {
  const P = S.params, room = $('#room-cloud'), voice = new CloudVoice(S, S.strips.cloud.input);
  S.slots[0] = { name: 'Cloud', voice };
  const send = (k) => (v) => voice.set({ [k]: v });
  P.define('cloud.pos', 0.3, send('pos')); P.define('cloud.size', 0.35, (v) => voice.set({ size: 10 + 990 * v ** 2 }));
  P.define('cloud.density', 0.4, (v) => voice.set({ density: 1 + 119 * v ** 1.6 })); P.define('cloud.spread', 0.08, send('spread'));
  P.define('cloud.pitch', 0, send('pitch')); P.define('cloud.jitter', 0, send('jitter')); P.define('cloud.reverse', 0, send('reverse'));
  P.define('cloud.width', 0.7, send('width')); P.define('cloud.scan', 0, (v) => voice.set({ scan: v * v * Math.sign(v) * 2 }));
  P.define('cloud.shape', 0.2, send('shape')); P.define('cloud.attack', 0.1, (v) => voice.set({ attack: 0.002 + v * v * 4 }));
  P.define('cloud.release', 0.35, (v) => voice.set({ release: 0.02 + v * v * 8 })); P.define('cloud.level', 0.75, send('level'));
  P.define('cloud.freeze', false, send('freeze')); P.define('cloud.drone', false, send('drone')); P.define('cloud.sizejit', 0.3, (v) => voice.set({ sizeJit: v }));
  P.define('cloud.yaxis', 'spray');

  const waveBox = h('div', { class: 'wave big' }), wave = new Wave(waveBox, { xy: true });
  let touching = false;
  // touching the cloud plays it: the drag is a gesture (and, while recording, becomes moves in the variation)
  wave.onPoint = (x, y) => { if (!touching) { touching = true; if (!P.get('cloud.drone') && !voice.held) { voice.noteOn('touch', 60, 0.85); voice.held = true; S.seq.noteIn(0, 60, 0.85, true); } } S.cloudPicked = true; P.set('cloud.pos', +x.toFixed(4)); const [, path, f] = YAXES[P.get('cloud.yaxis')]; P.set(path, f(y)); };
  const lift = () => { touching = false; if (voice.held) { voice.noteOff('touch'); voice.held = false; S.seq.noteIn(0, 60, 0, false); } };
  waveBox.addEventListener('pointerup', lift); waveBox.addEventListener('pointercancel', lift);
  const status = h('span', { class: 'src-name' });
  const picker = sourcePicker(async (stemId, a, b) => { const fresh = !S.cloudSrc || S.cloudSrc.stemId !== stemId || S.cloudSrc.a !== a; S.cloudSrc = { stemId, a, b }; status.textContent = '…'; const src = await loadSource(S, stemId, a, b); voice.setSource(src); wave.setSource(src); if (fresh || !S.cloudPicked) P.set('cloud.pos', +(loudestWindow(src, 0.1) + 0.05).toFixed(4), { by: 'load' }); status.textContent = `${Math.round(src.dur)} s`; });
  const hint = h('div', { class: 'wave-hint' }, h('b', {}, 'Touch and drag the sound to play the cloud'), h('span', {}, ' · across: where the grains come from · up and down: ', h('span', { class: 'yname' })));
  waveBox.append(hint);
  const showY = () => { hint.querySelector('.yname').textContent = YAXES[P.get('cloud.yaxis')][0].toLowerCase(); }; P.on(({ path }) => path === 'cloud.yaxis' && showY()); showY();
  room.append(
    h('div', { class: 'bar2' }, h('span', { class: 'cap' }, 'Grains from'), picker, status, h('span', { class: 'sp' }),
      h('span', { class: 'cap' }, 'Up and down'), seg(P, 'cloud.yaxis', Object.entries(YAXES).map(([k, v]) => [k, v[0]]), 'What dragging up and down changes'),
      sw(P, 'cloud.drone', 'Drone', 'Keep the cloud sounding without touching it'), sw(P, 'cloud.freeze', 'Freeze', 'Stop the cloud drifting through the sound'), recBtn('Record')),
    waveBox,
    h('div', { class: 'knobs' },
      group('Grains', knob(P, 'cloud.size', 'Size', { fmt: (v) => sec((10 + 990 * v ** 2) / 1000) }), knob(P, 'cloud.density', 'Density', { fmt: (v) => `${Math.round(1 + 119 * v ** 1.6)}/s` }), knob(P, 'cloud.sizejit', 'Drift'), knob(P, 'cloud.shape', 'Shape', { fmt: (v) => (v < 0.5 ? 'soft' : 'struck') })),
      group('Movement', knob(P, 'cloud.spread', 'Spray', { max: 0.5, fmt: (v) => Math.round(v * 200) }), knob(P, 'cloud.scan', 'Scan', { min: -1, max: 1, bipolar: true, fmt: (v) => (Math.abs(v) < 0.02 ? 'still' : (v > 0 ? '→' : '←') + Math.round(Math.abs(v) * 100)) })),
      group('Pitch', knob(P, 'cloud.pitch', 'Transpose', { min: -24, max: 24, step: 1, bipolar: true, fmt: (v) => `${v > 0 ? '+' : ''}${v}` }), knob(P, 'cloud.jitter', 'Scatter', { max: 12, fmt: (v) => `±${v.toFixed(1)}` }), knob(P, 'cloud.reverse', 'Reverse'), knob(P, 'cloud.width', 'Width')),
      group('Each note', knob(P, 'cloud.attack', 'Attack', { fmt: (v) => sec(0.002 + v * v * 4) }), knob(P, 'cloud.release', 'Release', { fmt: (v) => sec(0.02 + v * v * 8) }), knob(P, 'cloud.level', 'Level'))));
  const st0 = S.song.stems.find((s) => /piano/i.test(s.name)) || S.song.stems[0];
  S.rooms.cloud = { init: () => { const c = S.cloudSrc || { stemId: st0.id, ...(([a, b]) => ({ a, b }))(loudestCells(st0, 2)) }; picker.set(c.stemId, c.a, c.b); },
    draw: () => wave.draw((g, w, hh) => {
      const v = voice.view, pos = v.pos ?? P.get('cloud.pos'), sp = P.get('cloud.spread');
      g.fillStyle = '#e6b45018'; g.fillRect((pos - sp) * w, 0, sp * 2 * w, hh);
      g.fillStyle = '#e6b450'; g.fillRect(pos * w - 0.75, 0, 1.5, hh);
      for (const x of v.grains || []) { g.globalAlpha = 0.85; g.beginPath(); g.arc(x * w, hh * (0.12 + Math.random() * 0.76), 1.8, 0, 7); g.fill(); }
      g.globalAlpha = 1;
      hint.classList.toggle('gone', touching || (v.voices || 0) > 0);
    }) };
}

// ------------------------------------------------------------------------------------------------ Forge
const ENGINES = [['sampler', 'Sampler'], ['strings', 'Strings'], ['grains', 'Grain pad']];
function buildForge(count) {
  const room = $('#room-forge'), row = h('div', { class: 'forge' });
  const add = h('button', { type: 'button', class: 'card addcard', title: 'Build another instrument from a slice of the stems', onclick: () => S.addInstrument() }, h('span', { class: 'plus' }, '+'), h('span', {}, 'Another instrument'), h('small', { class: 'cap' }, ''));
  S.forges = [];
  S.addInstrument = (init = true) => {
    if (S.forges.length >= MAX_FORGE) return null;
    const n = S.forges.length + 1, f = makeForge(n);
    S.forges.push(f); row.insertBefore(f.el, add);
    if (init) { f.init(); S.selectSlot(n); }
    showAdd(); S.slotsChanged?.(); return f;
  };
  S.removeInstrument = () => {
    const f = S.forges[S.forges.length - 1], n = S.forges.length; if (n <= 3) return;
    if (!confirm(`Remove ${NAMES[n]}? Its clips leave the arrangement (you can undo that).`)) return;
    S.seq.snapshot(); S.seq.arr.clips = S.seq.arr.clips.filter((c) => c.lane !== n); S.seq.changed();
    Object.values(f.slot.voices).forEach((v) => v.panic?.()); f.out.disconnect(); f.el.remove(); S.forges.pop(); S.slots.length = n;
    S.params.set(`mix.f${n}.mute`, true, { by: 'load' });
    if (S.slotNow() >= n) S.selectSlot(0);
    showAdd(); S.slotsChanged?.();
  };
  const showAdd = () => { add.hidden = S.forges.length >= MAX_FORGE; add.querySelector('small').textContent = `${MAX_FORGE - S.forges.length} more possible`; S.forges.forEach((f, i) => { f.rm.hidden = i !== S.forges.length - 1 || i < 3; }); };
  row.append(add); room.append(row);
  for (let i = 0; i < count; i++) S.addInstrument(false);
  S.rooms.forge = { draw: () => S.forges.forEach((f) => f.wave.draw()) };
}
function makeForge(n) {
  const P = S.params, k = `f${n}`, out = S.ctx.createGain(); out.connect(S.addStrip(n).input);
  S.params.set(`mix.${k}.mute`, false, { by: 'load' });
  const voices = { sampler: new SamplerVoice(S, out), strings: new StringsVoice(S, out), grains: new CloudVoice(S, out) };
  const slot = { name: NAMES[n], voices, get voice() { return voices[P.get(`${k}.engine`)]; } };
  S.slots[n] = slot;
  const waveBox = h('div', { class: 'wave' }), wave = new Wave(waveBox, { select: true });
  const hint = h('div', { class: 'wave-hint small' }, 'drag across the sound to choose the slice it plays'); waveBox.append(hint);
  const status = h('span', { class: 'src-name' });
  let src = null, engineBox = null;
  const reslice = () => {
    if (!src) return; const [a, b] = P.get(`${k}.sel`).split(':').map(Number); wave.sel = [a, b];
    const sl = sliceOf(src, a, b); voices.sampler.setSlice(sl); voices.strings.setSlice(sl); voices.grains.setSource(sl);
    status.textContent = `${((b - a) * src.dur).toFixed(2)} s slice`;
  };
  wave.onPick = (a, b) => { slot.picked = true; hint.remove(); P.set(`${k}.sel`, `${a.toFixed(4)}:${b.toFixed(4)}`); S.selectSlot(n); const id = `aud${n}`; slot.voice.noteOn(id, 60, 0.8); setTimeout(() => slot.voice.noteOff(id), 600); };
  const picker = sourcePicker(async (stemId, a, b) => { const same = slot.src && slot.src.stemId === stemId && slot.src.a === a; slot.src = { stemId, a, b }; status.textContent = '…'; src = await loadSource(S, stemId, a, b); wave.setSource(src);
    if (!same || !slot.picked) { const x = loudestWindow(src, 0.06); P.set(`${k}.sel`, `${x.toFixed(4)}:${(x + 0.06).toFixed(4)}`, { by: 'load' }); } reslice(); });
  P.define(`${k}.sel`, '0.2:0.3', reslice);
  const COMP = { sampler: 1, strings: 5, grains: 4.5 }, lvl = () => out.gain.setTargetAtTime((P.get(`${k}.level`) ?? 0.8) * COMP[P.get(`${k}.engine`)], S.ctx.currentTime, 0.03);
  P.define(`${k}.engine`, ['sampler', 'strings', 'grains'][(n - 1) % 3], () => { for (const v of Object.values(voices)) v.panic(); if (engineBox) showEngine(); lvl(); });
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
  const sets = {
    sampler: () => [knob(P, `${k}.s.attack`, 'Attack', { fmt: (v) => sec(0.002 + v * v * 3) }), knob(P, `${k}.s.release`, 'Release', { fmt: (v) => sec(0.02 + v * v * 6) }), knob(P, `${k}.s.cutoff`, 'Tone'), knob(P, `${k}.s.res`, 'Peak'), knob(P, `${k}.s.env`, 'Bite'),
      h('div', { class: 'sws' }, sw(P, `${k}.s.loop`, 'Hold', 'Keep sounding while the key is held'), sw(P, `${k}.s.reverse`, 'Reverse', 'Play the slice backwards'))],
    strings: () => [knob(P, `${k}.t.decay`, 'Sustain'), knob(P, `${k}.t.bright`, 'Bright'), knob(P, `${k}.t.detune`, 'Detune'), knob(P, `${k}.t.excite`, 'Strike', { fmt: (v) => sec(0.005 + v * v * 1.2) }), knob(P, `${k}.t.body`, 'Source'), knob(P, `${k}.t.release`, 'Release')],
    grains: () => [knob(P, `${k}.g.size`, 'Grain', { fmt: (v) => sec((20 + 980 * v * v) / 1000) }), knob(P, `${k}.g.density`, 'Density'), knob(P, `${k}.g.spread`, 'Spray'), knob(P, `${k}.g.jitter`, 'Shimmer'), knob(P, `${k}.g.attack`, 'Swell'), knob(P, `${k}.g.release`, 'Release')],
  };
  engineBox = h('div', { class: 'knobs tight' });
  function showEngine() { engineBox.replaceChildren(...sets[P.get(`${k}.engine`)](), knob(P, `${k}.level`, 'Level')); }
  showEngine();
  const rm = h('button', { type: 'button', class: 'pill rm', title: `Remove ${NAMES[n]}`, onclick: () => S.removeInstrument() }, '×');
  const el = h('section', { class: 'card', style: { '--c': COLORS[n] }, onpointerdown: (e) => { if (!e.target.closest('select,button,.knob,.wave')) S.selectSlot(n); } },
    h('header', {}, h('button', { type: 'button', class: 'slotname', title: `Play ${NAMES[n]} from the keys (${n + 1})`, onclick: () => S.selectSlot(n) }, h('i'), NAMES[n]), h('span', { class: 'sp' }), seg(P, `${k}.engine`, ENGINES, 'What the slice becomes'), rm),
    h('div', { class: 'srcrow' }, picker, status), waveBox, engineBox);
  slot.card = el;
  const def = S.song.stems[(n * 5) % S.song.stems.length];
  return { el, wave, slot, out, rm, init: () => { const c = slot.src || { stemId: def.id, ...(([a, b]) => ({ a, b }))(loudestCells(def, 1)) }; picker.set(c.stemId, c.a, c.b); } };
}

// ------------------------------------------------------------------------------------------------ deck: instruments, keys, sequencer
function buildDeck() {
  const { seq } = S;
  let slot = 0;
  const chipBox = h('div', { class: 'chips' });
  let chips = [];
  const n = () => Math.max(4, S.slots.length);
  const buildChips = () => {
    chips = NAMES.slice(0, n()).map((nm, i) => h('button', { type: 'button', class: 'chip', style: { '--c': COLORS[i] }, title: `Play ${nm} from the keys (${i + 1})`, onclick: () => S.selectSlot(i) }, h('i'), n() > 4 ? short(nm) : nm));
    chipBox.replaceChildren(...chips); chipBox.classList.toggle('many', n() > 4); chips.forEach((c, k) => c.setAttribute('aria-pressed', k === slot));
  };
  S.selectSlot = (i) => { slot = i; chips.forEach((c, k) => c.setAttribute('aria-pressed', k === i)); document.body.style.setProperty('--play', COLORS[i]); S.forges?.forEach((f, k) => f.slot.card?.classList.toggle('playing', k + 1 === i)); };
  const keysEl = h('div', { class: 'keybed' });
  const keys = new Keys(keysEl, (note, vel, on) => { const s = S.slots[slot]; if (!s) return; const id = `k${slot}:${note}`; if (on) s.voice.noteOn(id, note, vel); else s.voice.noteOff(id); S.stepNote?.(note, vel, on); seq.noteIn(slot, note, vel, on); });
  S.slotNow = () => slot;
  S.keys = keys;
  S.flashNote = (sl, note, at, dur) => { if (sl !== slot) return; setTimeout(() => keys.flash(note, dur * 1000), Math.max(0, (at - S.ctx.currentTime) * 1000)); };
  const octl = h('span', { class: 'octl' });
  const showOct = () => { octl.textContent = `C${Math.floor(keys.base / 12)}–C${Math.floor(keys.base / 12) + 2}`; };
  const sh = keys.shift.bind(keys); keys.shift = (d) => { sh(d); showOct(); };
  const midi = h('button', { type: 'button', class: 'pill', title: 'Play with a MIDI keyboard', onclick: async () => { try { const names = await keys.midi(); midi.textContent = names.length ? `MIDI · ${names[0]}` : 'No MIDI found'; } catch { midi.textContent = 'No MIDI here'; } } }, 'MIDI');
  const oct = h('div', { class: 'seg oct' }, h('button', { type: 'button', title: 'Octave down (Z)', onclick: () => keys.shift(-12) }, '−'), octl, h('button', { type: 'button', title: 'Octave up (X)', onclick: () => keys.shift(12) }, '+'));
  const vars = PATS.map((v) => h('button', { type: 'button', title: `Pattern ${v}`, onclick: () => { seq.cur = v; seq.emit(); } }, v));
  const addPat = h('button', { type: 'button', class: 'addpat', title: 'Add a pattern', onclick: () => { if (!seq.addPat()) flash('Sixteen patterns is the most'); } }, '+');
  const barsSel = h('select', { title: 'Length of the pattern', 'aria-label': 'Pattern length', onchange: (e) => { seq.snapshot(); seq.bars = +e.target.value; seq.emit(); } }, ...[1, 2, 3, 4, 6, 8, 12, 16].map((b) => h('option', { value: b }, `${b} bar${b > 1 ? 's' : ''}`)));
  const quant = h('select', { title: 'Snap notes to the grid', 'aria-label': 'Snap', onchange: (e) => { seq.quant = +e.target.value; seq.emit(); } }, ...[[0, 'free'], [0.125, 'snap 1/32'], [0.25, 'snap 1/16'], [0.5, 'snap 1/8'], [1, 'snap 1/4'], [1 / 3, 'snap 1/8 tri']].map(([v, l]) => h('option', { value: v }, l)));
  const chain = h('button', { type: 'button', class: 'sw', title: 'Loop mode: play the patterns that have something in them, one after another', onclick: () => { seq.chain = !seq.chain; seq.emit(); } }, h('i'), 'Chain');
  const clear = h('button', { type: 'button', class: 'pill', title: 'Empty this pattern', onclick: () => seq.clear() }, 'Clear');
  const editB = h('button', { type: 'button', class: 'pill', title: 'Open this pattern in the editor on the Arrangement page', onclick: () => { showRoom('song'); S.openEditor?.(slot); } }, 'Edit');
  const toArr = h('button', { type: 'button', class: 'pill', title: 'Put this pattern on the arrangement: at the playhead in Arrangement mode, otherwise after what is already there', onclick: () => {
    const k = seq.cur; if (!seq.vars[k]?.length) { flash('This pattern is empty: record or draw something into it first'); return; }
    seq.snapshot(); const lanes = [...new Set(seq.vars[k].map((e) => (e.k === 'n' ? e.slot : 'm')))];
    const bar = seq.mode === 'song' ? Math.floor(seq.tl(seq.nowBeat()) / S.song.beatsPerBar) : seq.endOf(lanes);
    seq.placePattern(k, bar); seq.changed(); flash(`${isTake(k) ? takeName(k) : `Pattern ${k}`} is on the arrangement at bar ${bar + 1}`);
  } }, '→ Arrangement');
  const lanes = h('div', { class: 'lanes' });
  const buildLanes = () => { const L = [...Array(n()).keys(), 'm']; lanes.style.gridTemplateRows = `repeat(${L.length},1fr)`; lanes.replaceChildren(...L.map((l) => { const b = h('button', { type: 'button', class: 'lane', style: { '--c': l === 'm' ? '#a3a6ad' : COLORS[l] }, title: 'Click to mute this lane · double-click to empty it', onclick: () => { seq.mute.has(l) ? seq.mute.delete(l) : seq.mute.add(l); seq.emit(); }, ondblclick: () => seq.clearLane(l) }, h('i'), l === 'm' ? 'Moves' : short(NAMES[l])); b.dataset.l = l; return b; })); };
  const slotsChanged0 = S.slotsChanged; S.slotsChanged = () => { slotsChanged0?.(); buildChips(); buildLanes(); sync(); };
  const tl = h('div', { class: 'timeline', title: 'Double-click to edit this pattern' }), cv = h('canvas'); tl.append(cv);
  const recTarget = h('span', { class: 'cap rect' });
  // this button records into the pattern (looping); the header's ● records onto the arrangement
  const patRec = h('button', { type: 'button', class: 'rec', title: 'Record into this pattern: it loops, and each pass adds to it (R records onto the arrangement instead)', onclick: () => { const on = !(seq.rec && seq.mode === 'jam'); if (seq.rec) seq.arm(false); if (on) { seq.setMode('jam'); seq.arm(true); if (!S.player.playing) S.player.play(); } } }, h('i'), 'Pattern');
  const g = cv.getContext('2d'); let W = 0, H = 0;
  new ResizeObserver(() => { const r = tl.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1); W = r.width; H = r.height; cv.width = W * d; cv.height = H * d; cv.style.width = W + 'px'; cv.style.height = H + 'px'; g.setTransform(d, 0, 0, d, 0, 0); }).observe(tl);
  const sync = () => {
    vars.forEach((b) => { const v = b.textContent; b.setAttribute('aria-pressed', v === seq.cur); b.classList.toggle('has', seq.vars[v].length > 0); });
    const shown = seq.shownPats(); vars.forEach((b) => { b.hidden = !shown.includes(b.textContent); }); addPat.hidden = shown.length >= PATS.length;
    patRec.classList.toggle('on', seq.rec && seq.mode === 'jam'); patRec.lastChild.textContent = `Pattern ${isTake(seq.cur) ? (PATS.includes(seq.prevCur) ? seq.prevCur : 'A') : seq.cur}`;
    recTarget.textContent = seq.take ? `recording ${takeName(seq.take.pat)}` : '';
    chain.setAttribute('aria-pressed', seq.chain); barsSel.value = seq.bars; quant.value = seq.quant;
    lanes.querySelectorAll('.lane').forEach((b) => { const l = b.dataset.l === 'm' ? 'm' : +b.dataset.l; b.classList.toggle('muted', seq.mute.has(l)); });
    document.body.classList.toggle('recording', seq.rec);
  };
  seq.addEventListener('change', sync); sync();
  $('#deck').append(
    h('div', { class: 'deck-l' }, h('span', { class: 'cap' }, 'The keys play'), chipBox, h('div', { class: 'row' }, oct, midi)),
    keysEl,
    h('div', { class: 'deck-r' }, h('div', { class: 'row' }, patRec, recTarget, h('span', { class: 'sp' }), chain, toArr, editB, clear), h('div', { class: 'row' }, h('span', { class: 'cap' }, 'Pattern'), h('div', { class: 'seg vars' }, ...vars, addPat), h('span', { class: 'sp' }), barsSel, quant), h('div', { class: 'seqbox' }, lanes, tl)));
  tl.addEventListener('dblclick', () => { showRoom('song'); S.openEditor?.(slot); });
  buildChips(); buildLanes(); sync();
  showOct();
  S.rooms.deck = { draw: () => {
    if (!W) return; g.clearRect(0, 0, W, H);
    const R = n() + 1, B = seq.beats, rh = H / R, list = seq.vars[seq.cur], bpb = S.song.beatsPerBar;
    for (let r = 0; r < R; r++) { g.fillStyle = r % 2 ? '#ffffff06' : '#ffffff00'; g.fillRect(0, r * rh, W, rh); }
    for (let b = 0; b <= B; b++) { g.fillStyle = b % bpb ? '#ffffff0c' : '#ffffff26'; g.fillRect((b / B) * W, 0, 1, H); }
    const moves = {};
    for (const e of list) {
      if (e.k === 'n') { g.globalAlpha = seq.mute.has(e.slot) ? 0.25 : 1; g.fillStyle = COLORS[e.slot]; const y = e.slot * rh + 2 + (rh - 6) * (1 - (((e.note - 36) % 48) + 48) % 48 / 48); g.fillRect((e.b / B) * W, y, Math.max(2, (e.d / B) * W - 1), 3); }
      else (moves[e.path] ??= []).push(e);
    }
    g.globalAlpha = seq.mute.has('m') ? 0.25 : 0.9; g.lineWidth = 1;
    for (const [path, pts] of Object.entries(moves)) { const m = /^(?:mix\.)?f(\d)/.exec(path); g.strokeStyle = /^(mix\.)?cloud/.test(path) ? COLORS[0] : m ? COLORS[+m[1]] : '#a3a6ad'; const [mn, mx] = S.params.range?.[path] || [0, 1]; pts.sort((a, b) => a.b - b.b); g.beginPath(); pts.forEach((e, i) => { const x = (e.b / B) * W, y = (R - 1) * rh + 2 + (rh - 4) * (1 - Math.max(0, Math.min(1, (+e.v - mn) / (mx - mn || 1)))); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); }
    g.globalAlpha = 1;
    const lb = seq.loopBeat(); if (lb !== null) { g.fillStyle = seq.rec ? '#df8a74' : '#ece8dc'; g.fillRect((lb / B) * W, 0, 1.5, H); }
  } };
}

// ------------------------------------------------------------------------------------------------ rooms, frame
function showRoom(id) {
  if (!S.rooms[id] || id === 'deck') id = 'song';
  S.room = id;
  document.querySelectorAll('.room').forEach((r) => { r.hidden = r.id !== `room-${id}`; });
  document.querySelectorAll('#rooms button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.room === id));
  const u = new URL(location.href); u.searchParams.set('room', id); history.replaceState(null, '', u);
  if (id === 'cloud') S.selectSlot(0);
  requestAnimationFrame(() => S.rooms[id]?.show?.());
}
const mbuf = new Float32Array(2048);
function frame() {
  const { player, song } = S;
  const songMode = S.seq.mode === 'song', raw = Math.max(0, songMode ? S.seq.tl(S.seq.nowBeat()) : player.beatNow()), bar = Math.floor(raw / song.beatsPerBar);
  $('#pos').textContent = `${String((songMode ? bar : bar % song.numBars) + 1).padStart(3, '0')}.${Math.floor(raw % song.beatsPerBar) + 1}`;
  if (songMode) { const c = S.seq.arr.clips.find((x) => x.lane === 'band' && bar >= x.start && bar < x.start + x.len); $('#part').textContent = c ? (c.name && !c.loop ? `part ${c.name}` : `bar ${(c.src + (c.loop ? (bar - c.start) % c.loop : bar - c.start)) % song.numBars + 1} of the song`) : 'no stems here'; }
  else { const s = song.sections.find((x) => bar / song.barsPerCell >= x.startCell && bar / song.barsPerCell < x.endCell); $('#part').textContent = s ? `part ${s.name}` : ''; }
  S.masterLevel = S.engine.meterLevel(mbuf);
  if (S.voice.recording) $('#t-mic').style.setProperty('--lv', Math.min(1, S.voice.level() * 1.4).toFixed(2));
  $('#master-meter').style.transform = `scaleX(${Math.min(1, S.masterLevel)})`;
  if (S.room === 'arrange') for (const [id, m] of S.meters) { const ch = S.engine.channels.get(id); m.style.transform = `scaleX(${ch ? Math.min(1, ch.readLevel() * 3) : 0})`; }
  S.growHolds?.();
  S.rooms[S.room]?.draw(); S.rooms.deck.draw();
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------------------------------------ keeping your work
const KEY = () => `playground.studio.${S.song.id}`;
S.projectData = () => ({ v: 2, song: S.song.id, params: S.params.dump(), seq: S.seq.dump(), cloud: S.cloudSrc, forges: S.forges.map((f) => f.slot.src || null), band: S.session.state, morph: S.morph, mixMem: S.mixMem });
function save() { try { localStorage.setItem(KEY(), JSON.stringify(S.projectData())); } catch { /* full or private */ } }
function applyProject(d) {
  if (!d || (d.v !== 1 && d.v !== 2)) return false;
  S.params.load(d.params); S.seq.load(d.seq);
  if (d.cloud) S.cloudSrc = d.cloud;
  d.forges?.forEach((src, i) => { if (src) S.forges[i].slot.src = src; });
  if (d.morph) S.morph = d.morph; if (d.mixMem) S.mixMem = d.mixMem;
  if (d.band?.songId === S.song.id) S.session.dispatch({ t: 'state/load', state: d.band }, { log: false });
  return true;
}
function restore() {
  let d; try { d = JSON.parse(localStorage.getItem(KEY())); } catch { return false; }
  if (!applyProject(d)) return false;
  const want = S.seq.wantMode; S.seq.mode = 'jam'; if (want === 'song') { const jt = S.seq.jamTracks; S.seq.setMode('song'); if (jt) S.seq.jamTracks = jt; }
  return true;
}
S.loadProject = (d) => { if (d.song && d.song !== S.song.id) { alert('That file belongs to another song.'); return; } try { localStorage.setItem(KEY(), JSON.stringify(d)); } catch { /* fine */ } location.reload(); };
S.reset = () => { localStorage.removeItem(KEY()); location.reload(); };
