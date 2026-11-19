// The playground studio. The band plays on (the stems, re-arrangeable); around it three ways to make new sound out
// of them — a granular Cloud, a Forge that turns any slice into a playable instrument, and a Textures rack on the
// master — all playable from the keys and recordable, as notes and moves, into four variations.
import { AudioEngine } from '../engine/audio.js';
import { CellLoader } from '../engine/loader.js';
import { Player } from '../engine/player.js';
import { Session, initialState } from '../state/session.js';
import { $, h, api } from '../lib/util.js';
import { Params, loadSource, loudestCells, loudestWindow, sliceOf, CloudVoice, SamplerVoice, StringsVoice, buildTextures, Sequencer, CHORDS } from './core.js';
import { fader, choice, toggle, panel, Wave, Keys } from './ui.js';

const params = new URLSearchParams(location.search);
const S = { slots: [], rooms: {} };
window.studio = S;
const NOTE = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const pct = (v) => Math.round(v * 100);

boot().catch((e) => { console.error(e); $('#gate-status').textContent = 'Could not load: ' + e.message; });

async function boot() {
  const songId = params.get('song') || (await api.get('/api/songs'))[0]?.id;
  const song = await api.get(`/api/songs/${songId}`);
  document.title = `${song.title} · Playground · Gunnar Tynes`;
  $('#song').textContent = song.title; $('#gate-title').textContent = song.title;
  $('#gate-meta').textContent = `${song.artist} · ${song.stems.length} stems · ${song.bpm} bpm`;

  const engine = new AudioEngine(); await engine.ready;
  await engine.ctx.audioWorklet.addModule(new URL('./dsp.js', import.meta.url));
  const loader = new CellLoader(engine.ctx, { max: 160 });
  const ids = song.stems.map((s) => s.id);
  const session = new Session(initialState(song, { catalogIds: ids }));
  const player = new Player(engine, loader, session, song);
  for (const s of song.stems) player.addSource(s.id, { id: s.id, kind: 'stem', name: s.name, cells: s.cells, gain: s.gain });
  Object.assign(S, { song, engine, ctx: engine.ctx, loader, session, player, params: new Params() });

  // the master: band + instruments → textures → the engine's own glue and limiter
  const tex = buildTextures(S);
  engine.post.disconnect(); engine.post.connect(tex.input); tex.output.connect(engine.lp);
  S.tex = tex;
  S.instBus = engine.ctx.createGain(); S.instBus.connect(tex.input);

  S.seq = new Sequencer(S);
  S.params.recorder = (path, v) => S.seq.moveIn(path, v);

  buildBand(); buildCloud(); buildForge(); buildTextureRoom(); buildArrange(); buildDeck(); buildTransport();
  restore();
  for (const r of ['cloud', 'forge']) { S.rooms[r].ready = true; S.rooms[r].init(); }
  S.selectSlot(0);
  showRoom(params.get('room') || 'cloud');

  // first sound: the first phrase of every stem
  const first = ids.map((id) => player.resolve(session.state.tracks[id], 0)).filter(Boolean).map((w) => w.url);
  let n = 0; await Promise.all(first.map((u) => loader.load(u).catch(() => {}).finally(() => { $('#gate-bar').style.width = `${(++n / first.length) * 100}%`; })));
  $('#gate-status').textContent = 'ready';
  const go = $('#gate-go'); go.disabled = false;
  go.onclick = async () => { await engine.ctx.resume(); $('#gate').classList.add('gone'); player.play(0); };
  requestAnimationFrame(frame);
  setInterval(save, 2000);
}

// ------------------------------------------------------------------------------------------------ band
function buildBand() {
  const { song, session, params: P } = S, list = $('#band-list');
  S.meters = [];
  for (const st of song.stems) {
    const id = st.id;
    P.define(`band.${id}.gain`, 0.85, (v) => session.dispatch({ t: 'track/set', id, p: { gain: v } }, { log: false }));
    P.define(`band.${id}.mute`, false, (v) => session.dispatch({ t: 'track/set', id, p: { mute: v } }, { log: false }));
    P.define(`band.${id}.solo`, false, (v) => session.dispatch({ t: 'track/set', id, p: { solo: v } }, { log: false }));
    const meter = h('i', { class: 'meter' });
    S.meters.push([id, meter]);
    list.append(h('li', {}, h('div', { class: 'row1' }, h('span', { class: 'nm' }, st.name), toggle(P, `band.${id}.mute`, 'M'), toggle(P, `band.${id}.solo`, 'S')),
      h('div', { class: 'row2' }, meter, fader(P, `band.${id}.gain`, '', { fmt: (v) => pct(v) }))));
  }
  P.define('band.level', 0.9, (v) => S.engine.bus.gain.setTargetAtTime(v, S.ctx.currentTime, 0.05));
  $('#band-master').append(fader(P, 'band.level', 'Band'));
}

// ------------------------------------------------------------------------------------------------ source picker
function sourcePicker(onPick) {
  const { song } = S;
  const stemSel = h('select', { 'aria-label': 'Stem' }, ...song.stems.map((s) => h('option', { value: s.id }, s.name)));
  const partSel = h('select', { 'aria-label': 'Part of the song' });
  const parts = (stem) => {
    const out = [['loud', 'Its loudest 8 bars']];
    for (const sec of song.sections) {
      const a = sec.startCell, b = Math.min(sec.endCell, a + 6);
      if (stem.cells.slice(a, b).some(Boolean)) out.push([`${a}-${b}`, `Part ${sec.name} · bars ${a * song.barsPerCell + 1}–${b * song.barsPerCell}`]);
    }
    partSel.replaceChildren(...out.map(([v, l]) => h('option', { value: v }, l)));
  };
  const fire = () => { const st = song.stems.find((s) => s.id === stemSel.value); const v = partSel.value; const [a, b] = v === 'loud' ? loudestCells(st, 2) : v.split('-').map(Number); onPick(st.id, a, b); };
  stemSel.onchange = () => { parts(song.stems.find((s) => s.id === stemSel.value)); fire(); };
  partSel.onchange = fire;
  parts(song.stems[0]);
  const el = h('div', { class: 'picker' }, h('span', { class: 'lab' }, 'Source'), stemSel, partSel);
  el.set = (stemId, a, b) => { stemSel.value = stemId; const st = song.stems.find((s) => s.id === stemId); parts(st); const key = `${a}-${b}`; partSel.value = [...partSel.options].some((o) => o.value === key) ? key : 'loud'; };
  return el;
}

// ------------------------------------------------------------------------------------------------ Cloud
function buildCloud() {
  const P = S.params, room = $('#room-cloud'), voice = new CloudVoice(S, S.instBus);
  S.slots[0] = { name: 'Cloud', voice, kind: 'cloud' };
  const send = (k) => (v) => voice.set({ [k]: v });
  P.define('cloud.pos', 0.3, send('pos')); P.define('cloud.size', 0.35, (v) => voice.set({ size: 10 + 990 * v ** 2 }));
  P.define('cloud.density', 0.4, (v) => voice.set({ density: 1 + 119 * v ** 1.6 })); P.define('cloud.spread', 0.08, send('spread'));
  P.define('cloud.pitch', 0, send('pitch')); P.define('cloud.jitter', 0, send('jitter')); P.define('cloud.reverse', 0, send('reverse'));
  P.define('cloud.width', 0.7, send('width')); P.define('cloud.scan', 0, (v) => voice.set({ scan: v * v * Math.sign(v) * 2 }));
  P.define('cloud.shape', 0.2, send('shape')); P.define('cloud.attack', 0.1, (v) => voice.set({ attack: 0.002 + v * v * 4 }));
  P.define('cloud.release', 0.35, (v) => voice.set({ release: 0.02 + v * v * 8 })); P.define('cloud.level', 0.75, send('level'));
  P.define('cloud.freeze', false, send('freeze')); P.define('cloud.drone', false, send('drone'));
  P.define('cloud.sizejit', 0.3, (v) => voice.set({ sizeJit: v }));

  const waveBox = h('div', { class: 'wave big' }), wave = new Wave(waveBox, { xy: true });
  wave.onPoint = (x, y) => { S.cloudPicked = true; P.set('cloud.pos', +x.toFixed(4)); P.set('cloud.spread', +(0.5 * y ** 1.5).toFixed(4)); };
  const picker = sourcePicker(async (stemId, a, b) => { const fresh = !S.cloudSrc || S.cloudSrc.stemId !== stemId || S.cloudSrc.a !== a; S.cloudSrc = { stemId, a, b }; status.textContent = 'loading…'; const src = await loadSource(S, stemId, a, b); voice.setSource(src); wave.setSource(src); if (fresh || !S.cloudPicked) P.set('cloud.pos', +(loudestWindow(src, 0.1) + 0.05).toFixed(4), { by: 'load' }); status.textContent = `${src.name} · ${Math.round(src.dur)} s`; });
  const status = h('span', { class: 'faint mono' });
  S.rooms.cloud = { wave, picker, voice, draw: () => wave.draw((g, w, hh) => {
    const v = voice.view, pos = P.get('cloud.pos'), sp = P.get('cloud.spread');
    g.fillStyle = '#e6b45014'; g.fillRect((pos - sp) * w, 0, sp * 2 * w, hh);
    g.fillStyle = '#e6b450'; g.fillRect((v.pos ?? pos) * w - 0.5, 0, 1.5, hh);
    for (const x of v.grains || []) { g.globalAlpha = 0.7; g.fillRect(x * w - 1.5, hh * (0.15 + Math.random() * 0.7), 3, 3); }
    g.globalAlpha = 1; g.fillStyle = '#6f747f'; g.font = '11px "IBM Plex Mono", monospace'; g.fillText(`${v.voices || 0} voice${v.voices === 1 ? '' : 's'} · drag across the sound: left–right where, up–down how wide`, 10, hh - 10);
  }) };
  room.append(
    h('div', { class: 'room-head' }, h('div', {}, h('h2', {}, 'Cloud'), h('p', {}, 'A granular instrument. The stem is broken into grains, a few milliseconds to a second long, and scattered again: hold a key and the sound becomes a note, freeze it and it becomes a room.')), h('div', { class: 'srcline' }, picker, status)),
    waveBox,
    h('div', { class: 'grid4' },
      panel('Grains', fader(P, 'cloud.size', 'Size', { fmt: (v) => `${Math.round(10 + 990 * v ** 2)} ms` }), fader(P, 'cloud.density', 'Density', { fmt: (v) => `${Math.round(1 + 119 * v ** 1.6)}/s` }), fader(P, 'cloud.sizejit', 'Size drift'), fader(P, 'cloud.shape', 'Shape', { fmt: (v) => (v < 0.5 ? 'soft' : 'struck') })),
      panel('Place', fader(P, 'cloud.pos', 'Position'), fader(P, 'cloud.spread', 'Spray'), fader(P, 'cloud.scan', 'Scan', { min: -1, max: 1, fmt: (v) => (Math.abs(v) < 0.02 ? 'still' : (v > 0 ? '→ ' : '← ') + pct(Math.abs(v))) }), h('div', { class: 'togs' }, toggle(P, 'cloud.freeze', 'Freeze'), toggle(P, 'cloud.drone', 'Drone'))),
      panel('Pitch', fader(P, 'cloud.pitch', 'Transpose', { min: -24, max: 24, step: 1, fmt: (v) => `${v > 0 ? '+' : ''}${v} st` }), fader(P, 'cloud.jitter', 'Scatter', { min: 0, max: 12, fmt: (v) => `±${v.toFixed(1)} st` }), fader(P, 'cloud.reverse', 'Reverse'), fader(P, 'cloud.width', 'Width')),
      panel('Shape of a note', fader(P, 'cloud.attack', 'Attack', { fmt: (v) => `${(0.002 + v * v * 4).toFixed(2)} s` }), fader(P, 'cloud.release', 'Release', { fmt: (v) => `${(0.02 + v * v * 8).toFixed(1)} s` }), fader(P, 'cloud.level', 'Level'))));
  // default source: the piano's loudest stretch
  const st = S.song.stems.find((s) => /piano/i.test(s.name)) || S.song.stems[0];
  S.rooms.cloud.init = () => { const c = S.cloudSrc || { stemId: st.id, ...(([a, b]) => ({ a, b }))(loudestCells(st, 2)) }; picker.set(c.stemId, c.a, c.b); picker.querySelector('select:last-of-type').dispatchEvent(new Event('change')); };
}

// ------------------------------------------------------------------------------------------------ Forge
const ENGINES = [['sampler', 'Sampler'], ['strings', 'Strings'], ['grains', 'Grain pad']];
function buildForge() {
  const P = S.params, room = $('#room-forge');
  const forges = [1, 2, 3].map((n) => makeForge(n));
  let cur = 1;
  const tabs = h('div', { class: 'seg slots' }, ...forges.map((f, i) => h('button', { type: 'button', onclick: () => pick(i + 1) }, `Instrument ${i + 1}`)));
  const body = h('div', { class: 'forge-body' });
  const pick = (n) => { cur = n; [...tabs.children].forEach((b, i) => b.setAttribute('aria-pressed', i + 1 === n)); body.replaceChildren(forges[n - 1].el); forges[n - 1].wave.peaks = null; S.selectSlot?.(n); };
  room.append(h('div', { class: 'room-head' }, h('div', {}, h('h2', {}, 'Forge'), h('p', {}, 'Build an instrument out of any moment in the band. Choose a source, drag across the part you want, and decide what it becomes: a sampler, a set of strings it bows and plucks, or a pad of frozen grains.')), tabs), body);
  S.rooms.forge = { draw: () => forges[cur - 1].wave.draw(), init: () => { forges.forEach((f) => f.init()); pick(1); }, pick };
  S.forges = forges;

  function makeForge(n) {
    const k = `f${n}`, out = S.ctx.createGain(); out.connect(S.instBus);
    let engineBox = null;
    const voices = { sampler: new SamplerVoice(S, out), strings: new StringsVoice(S, out), grains: new CloudVoice(S, out) };
    const slot = { name: `Instrument ${n}`, kind: 'forge', voices, get voice() { return voices[P.get(`${k}.engine`)]; } };
    S.slots[n] = slot;
    const waveBox = h('div', { class: 'wave' }), wave = new Wave(waveBox, { select: true });
    const status = h('span', { class: 'faint mono' });
    let src = null;
    const reslice = () => {
      if (!src) return; const [a, b] = P.get(`${k}.sel`) ? P.get(`${k}.sel`).split(':').map(Number) : [0.2, 0.3]; wave.sel = [a, b];
      const sl = sliceOf(src, a, b); voices.sampler.setSlice(sl); voices.strings.setSlice(sl); voices.grains.setSource(sl);
      status.textContent = `${src.name} · ${((b - a) * src.dur).toFixed(2)} s slice`;
    };
    wave.onPick = (a, b) => { slot.picked = true; P.set(`${k}.sel`, `${a.toFixed(4)}:${b.toFixed(4)}`); };
    const picker = sourcePicker(async (stemId, a, b) => { const same = slot.src && slot.src.stemId === stemId && slot.src.a === a && slot.src.b === b; slot.src = { stemId, a, b }; status.textContent = 'loading…'; src = await loadSource(S, stemId, a, b); wave.setSource(src);
      // a new source starts on its loudest moment; reloading the same one keeps the slice you chose
      if (!same || !slot.picked) { const x = loudestWindow(src, 0.06); P.set(`${k}.sel`, `${x.toFixed(4)}:${(x + 0.06).toFixed(4)}`, { by: 'load' }); } reslice(); });
    P.define(`${k}.sel`, '0.2:0.3', reslice);
    P.define(`${k}.engine`, ['sampler', 'strings', 'grains'][n - 1], () => { for (const v of Object.values(voices)) v.panic(); if (engineBox) showEngine(); if (P.get(`${k}.level`) !== undefined) lvl(); });
    // each engine has its own natural loudness; this evens them out so switching never jumps
    const COMP = { sampler: 1, strings: 5, grains: 4.5 }, lvl = () => out.gain.setTargetAtTime(P.get(`${k}.level`) * COMP[P.get(`${k}.engine`)], S.ctx.currentTime, 0.03);
    P.define(`${k}.level`, 0.8, lvl);
    // sampler
    const sm = (p) => (v) => voices.sampler.set({ [p]: v });
    P.define(`${k}.s.attack`, 0.02, (v) => voices.sampler.set({ attack: 0.002 + v * v * 3 })); P.define(`${k}.s.release`, 0.3, (v) => voices.sampler.set({ release: 0.02 + v * v * 6 }));
    P.define(`${k}.s.cutoff`, 0.8, sm('cutoff')); P.define(`${k}.s.res`, 0.15, sm('res')); P.define(`${k}.s.env`, 0.3, sm('env'));
    P.define(`${k}.s.loop`, true, sm('loop')); P.define(`${k}.s.reverse`, false, sm('reverse'));
    // strings
    const sp = (p, f) => (v) => voices.strings.set({ [p]: f ? f(v) : v });
    P.define(`${k}.t.decay`, 0.7, sp('decay', (v) => 0.97 + v * 0.0295)); P.define(`${k}.t.bright`, 0.5, sp('bright')); P.define(`${k}.t.excite`, 0.25, sp('excite', (v) => 0.005 + v * v * 1.2));
    P.define(`${k}.t.detune`, 0.2, sp('detune', (v) => v * 0.012)); P.define(`${k}.t.body`, 0.15, sp('body')); P.define(`${k}.t.release`, 0.3, sp('release', (v) => 0.02 + v * 3));
    // grain pad
    const gp = (p, f) => (v) => voices.grains.set({ [p]: f ? f(v) : v });
    voices.grains.set({ pos: 0.5, freeze: true, density: 40, size: 380, spread: 0.2, width: 0.9, attack: 0.6, release: 2.5 });
    P.define(`${k}.g.size`, 0.6, gp('size', (v) => 20 + 980 * v * v)); P.define(`${k}.g.spread`, 0.25, gp('spread', (v) => v * 0.5));
    P.define(`${k}.g.density`, 0.55, gp('density', (v) => 2 + 100 * v * v)); P.define(`${k}.g.jitter`, 0.05, gp('jitter', (v) => v * 7));
    P.define(`${k}.g.attack`, 0.35, gp('attack', (v) => 0.005 + v * v * 4)); P.define(`${k}.g.release`, 0.5, gp('release', (v) => 0.05 + v * v * 9));
    const sec = (v) => `${v.toFixed(2)} s`;
    const sets = {
      sampler: [panel('Envelope', fader(P, `${k}.s.attack`, 'Attack', { fmt: (v) => sec(0.002 + v * v * 3) }), fader(P, `${k}.s.release`, 'Release', { fmt: (v) => sec(0.02 + v * v * 6) })),
        panel('Filter', fader(P, `${k}.s.cutoff`, 'Cutoff'), fader(P, `${k}.s.res`, 'Resonance'), fader(P, `${k}.s.env`, 'Envelope')),
        panel('Playback', h('div', { class: 'togs' }, toggle(P, `${k}.s.loop`, 'Sustain loop'), toggle(P, `${k}.s.reverse`, 'Reverse')))],
      strings: [panel('Strings', fader(P, `${k}.t.decay`, 'Sustain'), fader(P, `${k}.t.bright`, 'Brightness'), fader(P, `${k}.t.detune`, 'Detune')),
        panel('Exciter', fader(P, `${k}.t.excite`, 'Length', { fmt: (v) => `${Math.round((0.005 + v * v * 1.2) * 1000)} ms` }), fader(P, `${k}.t.body`, 'Source in the mix'), fader(P, `${k}.t.release`, 'Release'))],
      grains: [panel('Grains', fader(P, `${k}.g.size`, 'Size', { fmt: (v) => `${Math.round(20 + 980 * v * v)} ms` }), fader(P, `${k}.g.density`, 'Density'), fader(P, `${k}.g.spread`, 'Spray'), fader(P, `${k}.g.jitter`, 'Shimmer')),
        panel('Shape of a note', fader(P, `${k}.g.attack`, 'Attack'), fader(P, `${k}.g.release`, 'Release'))],
    };
    engineBox = h('div', { class: 'grid4' });
    function showEngine() { if (!engineBox) return; engineBox.replaceChildren(...sets[P.get(`${k}.engine`)], panel('Output', fader(P, `${k}.level`, 'Level'))); }
    showEngine();
    const el = h('div', {}, h('div', { class: 'srcline' }, picker, status), waveBox,
      h('div', { class: 'engine-row' }, choice(P, `${k}.engine`, 'Becomes', ENGINES), h('span', { class: 'faint' }, 'Drag across the waveform to choose the slice. Play it from the keys below.')), engineBox);
    const def = S.song.stems[(n * 5) % S.song.stems.length];
    return { el, wave, slot, picker, init: () => { const c = slot.src || { stemId: def.id, ...(([a, b]) => ({ a, b }))(loudestCells(def, 1)) }; picker.set(c.stemId, c.a, c.b); picker.querySelector('select:last-of-type').dispatchEvent(new Event('change')); } };
  }
}

// ------------------------------------------------------------------------------------------------ Textures
function buildTextureRoom() {
  const P = S.params, room = $('#room-textures');
  const st = (v) => `${v > 0 ? '+' : ''}${v} st`;
  const hold = (label, div) => { const b = h('button', { type: 'button', class: 'hold' }, label); const on = () => { b.classList.add('on'); S.tex.repeat(div); }, off = () => { b.classList.remove('on'); S.tex.repeat(0); }; b.addEventListener('pointerdown', (e) => { b.setPointerCapture(e.pointerId); on(); }); b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); return b; };
  // a macro pad: one gesture moves several textures at once, and records as two moves
  P.define('fx.xy.x', 0.5, (v) => { P.set('fx.filter.lp', v < 0.5 ? 0.35 + v * 1.3 : 1, { by: 'macro' }); P.set('fx.filter.hp', v > 0.5 ? (v - 0.5) * 1.3 : 0, { by: 'macro' }); });
  P.define('fx.xy.y', 0, (v) => { P.set('fx.res.mix', Math.max(0, v - 0.2) * 0.9, { by: 'macro' }); P.set('fx.shim.mix', v * 0.75, { by: 'macro' }); P.set('fx.tape.mix', Math.min(1, v * 1.4), { by: 'macro' }); });
  const pad = h('div', { class: 'xy' }, h('i', { class: 'dot' }), h('span', { class: 'ax ax-x' }, 'darker · brighter'), h('span', { class: 'ax ax-y' }, 'dry · ringing'));
  const dot = pad.querySelector('.dot');
  const showDot = () => { dot.style.left = `${P.get('fx.xy.x') * 100}%`; dot.style.top = `${(1 - P.get('fx.xy.y')) * 100}%`; };
  P.on(({ path }) => { if (path.startsWith('fx.xy')) showDot(); }); showDot();
  let drag = false; const at = (e) => { const r = pad.getBoundingClientRect(); P.set('fx.xy.x', +Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)).toFixed(4)); P.set('fx.xy.y', +Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height)).toFixed(4)); };
  pad.addEventListener('pointerdown', (e) => { drag = true; pad.setPointerCapture(e.pointerId); at(e); }); pad.addEventListener('pointermove', (e) => drag && at(e)); pad.addEventListener('pointerup', () => { drag = false; });
  room.append(h('div', { class: 'room-head' }, h('div', {}, h('h2', {}, 'Textures'), h('p', {}, 'Everything you hear passes through here: the band and the instruments. Tune the whole mix into a set of resonating strings, let it rise an octave into a shimmer, wear it in on tape, or hold a beat and repeat it.'))),
    h('div', { class: 'tex-top' }, pad,
      panel('Repeat · hold', h('div', { class: 'holds' }, hold('1 beat', 1), hold('½', 0.5), hold('¼', 0.25), hold('⅛', 0.125), hold('1⁄16', 0.0625), hold('2 beats', 2))),
      panel('Tape', fader(P, 'fx.tape.mix', 'Amount'), fader(P, 'fx.tape.wow', 'Wow'), fader(P, 'fx.tape.flutter', 'Flutter'), fader(P, 'fx.tape.drive', 'Drive'), h('button', { type: 'button', class: 'tog', onclick: () => S.player.stop({ tape: true }) }, 'Tape stop'))),
    h('div', { class: 'grid4' },
      panel('Resonators', fader(P, 'fx.res.mix', 'Amount'), fader(P, 'fx.res.decay', 'Ring'), fader(P, 'fx.res.bright', 'Brightness'),
        choice(P, 'fx.res.root', 'Root', NOTE.map((n, i) => [i, n])), choice(P, 'fx.res.chord', 'Chord', Object.keys(CHORDS).map((c) => [c, c]))),
      panel('Shimmer', fader(P, 'fx.shim.mix', 'Amount'), fader(P, 'fx.shim.rise', 'Rise'), choice(P, 'fx.shim.interval', 'Interval', [[7, '5th'], [12, 'oct'], [19, '12th'], [24, '2 oct'], [-12, '−oct']])),
      panel('Filter', fader(P, 'fx.filter.lp', 'Low pass'), fader(P, 'fx.filter.hp', 'High pass'), fader(P, 'fx.filter.q', 'Resonance')),
      panel('Crush', fader(P, 'fx.crush.mix', 'Amount'), fader(P, 'fx.crush.bits', 'Bits', { fmt: (v) => `${Math.round(16 - v * 13)} bit` }), fader(P, 'fx.crush.down', 'Rate'))));
  S.rooms.textures = { draw: () => {} };
}

// ------------------------------------------------------------------------------------------------ Re-arrange
function buildArrange() {
  const room = $('#room-arrange'), { song, session, player } = S;
  const box = h('div', { class: 'arr' }), cv = h('canvas'); box.append(cv);
  room.append(h('div', { class: 'room-head' }, h('div', {}, h('h2', {}, 'Re-arrange'), h('p', {}, 'The song as a map: one row for each musician, one square for each four bars. Click a square to keep that player on those four bars; click it again to let them follow the song. Click the numbers on top to move the whole band there.')),
    h('div', { class: 'tools' }, h('button', { type: 'button', class: 'tog', onclick: () => session.dispatch({ t: 'tracks/set', p: Object.fromEntries(session.state.order.map((id) => [id, { mode: 'follow' }])) }) }, 'Everyone follows'),
      h('button', { type: 'button', class: 'tog', onclick: () => { const c = Math.floor(Math.max(0, player.barNow()) / song.barsPerCell); session.dispatch({ t: 'tracks/set', p: Object.fromEntries(session.state.order.map((id) => [id, { mode: 'loop', cell: c }])) }); } }, 'Hold this moment'))), box);
  const g = cv.getContext('2d'); let W = 0, H = 0;
  const top = 22, left = 120;
  new ResizeObserver(() => { const r = box.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1); W = r.width; H = r.height; cv.width = W * d; cv.height = H * d; cv.style.width = W + 'px'; cv.style.height = H + 'px'; g.setTransform(d, 0, 0, d, 0, 0); }).observe(box);
  const geom = () => { const rows = song.stems.length, cols = song.numCells; return { rows, cols, cw: (W - left) / cols, rh: (H - top) / rows }; };
  cv.addEventListener('click', (e) => {
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, { cw, rh } = geom(), c = Math.floor((x - left) / cw);
    if (y < top) { session.dispatch({ t: 'seek', bar: c * song.barsPerCell }); return; }
    const st = song.stems[Math.floor((y - top) / rh)]; if (!st || !st.cells[c]) return;
    const tr = session.state.tracks[st.id];
    session.dispatch({ t: 'track/set', id: st.id, p: tr.mode === 'loop' && tr.cell === c ? { mode: 'follow' } : { mode: 'loop', cell: c } });
  });
  S.rooms.arrange = { draw: () => {
    if (!W) return; const { cols, cw, rh } = geom(); g.clearRect(0, 0, W, H);
    const playing = Math.floor(Math.max(0, player.barNow()) / song.barsPerCell) % cols;
    g.font = '10px "IBM Plex Mono", monospace'; g.textBaseline = 'middle';
    for (const sec of song.sections) { g.fillStyle = '#a3a6ad'; g.fillText(sec.name, left + sec.startCell * cw + 3, 9); g.fillStyle = '#ffffff1c'; g.fillRect(left + sec.startCell * cw, 0, 1, H); }
    song.stems.forEach((st, r) => {
      const tr = session.state.tracks[st.id], y = top + r * rh;
      for (let c = 0; c < cols; c++) {
        const cell = st.cells[c]; if (!cell) continue;
        const a = Math.max(0.08, Math.min(1, (cell.rms + 50) / 40));
        const looped = tr.mode === 'loop' && tr.cell === c, follow = tr.mode === 'follow';
        g.fillStyle = looped ? '#e6b450' : `rgba(236,232,220,${(follow ? 0.55 : 0.18) * a})`;
        g.fillRect(left + c * cw + 1, y + 1, cw - 2, rh - 2);
      }
      g.fillStyle = tr.mute ? '#6f747f' : tr.mode === 'loop' ? '#e6b450' : '#ece8dc'; g.globalAlpha = 0.9; g.fillText(st.name.length > 16 ? st.name.slice(0, 15) + '…' : st.name, 6, y + rh / 2); g.globalAlpha = 1;
    });
    g.fillStyle = '#e6b450'; g.fillRect(left + playing * cw, top - 4, cw, 2);
    const bx = (player.beatNow() / song.beatsPerBar / song.barsPerCell) % cols; g.fillStyle = '#ffffff55'; g.fillRect(left + bx * cw, top, 1, H - top);
  } };
}

// ------------------------------------------------------------------------------------------------ deck: keys + sequencer
function buildDeck() {
  const { seq, params: P } = S;
  let slot = 0;
  const slotBtns = h('div', { class: 'seg slots' }, ...['Cloud', 'Instrument 1', 'Instrument 2', 'Instrument 3'].map((l, i) => h('button', { type: 'button', onclick: () => S.selectSlot(i) }, l)));
  S.selectSlot = (i) => { slot = i; [...slotBtns.children].forEach((b, k) => b.setAttribute('aria-pressed', k === i)); };
  S.selectSlot(0);
  const keysEl = h('div', { class: 'keybed' });
  const keys = new Keys(keysEl, (note, vel, on) => {
    const s = S.slots[slot]; if (!s) return; const id = `k${slot}:${note}`;
    if (on) s.voice.noteOn(id, note, vel); else s.voice.noteOff(id);
    seq.noteIn(slot, note, vel, on);
  });
  S.keys = keys;
  S.flashNote = (sl, note, at, dur) => { if (sl !== slot) return; setTimeout(() => keys.flash(note, dur * 1000), Math.max(0, (at - S.ctx.currentTime) * 1000)); };
  const midiBtn = h('button', { type: 'button', class: 'tog', onclick: async () => { try { const names = await keys.midi(); midiBtn.textContent = names.length ? `MIDI · ${names[0]}` : 'MIDI · nothing found'; midiBtn.setAttribute('aria-pressed', true); } catch { midiBtn.textContent = 'MIDI not available'; } } }, 'Connect MIDI');
  const oct = h('div', { class: 'seg' }, h('button', { type: 'button', onclick: () => keys.shift(-12) }, '− oct'), h('button', { type: 'button', onclick: () => keys.shift(12) }, '+ oct'));

  // sequencer controls
  const varBtns = h('div', { class: 'seg vars' }, ...'ABCD'.split('').map((k) => h('button', { type: 'button', onclick: () => { seq.cur = k; seq.emit(); } }, k)));
  const rec = h('button', { type: 'button', class: 'recbtn', onclick: () => { seq.rec = !seq.rec; if (seq.rec && !S.player.playing) S.player.play(); seq.emit(); } }, h('i'), 'Record moves');
  const chain = h('button', { type: 'button', class: 'tog', onclick: () => { seq.chain = !seq.chain; seq.emit(); } }, 'Chain A→D');
  const playMoves = h('button', { type: 'button', class: 'tog', onclick: () => { seq.on = !seq.on; seq.emit(); } }, 'Play moves');
  const bars = h('select', { 'aria-label': 'Loop length', onchange: (e) => { seq.bars = +e.target.value; seq.emit(); } }, ...[1, 2, 4, 8, 16].map((b) => h('option', { value: b }, `${b} bar${b > 1 ? 's' : ''}`)));
  const quant = h('select', { 'aria-label': 'Quantise', onchange: (e) => { seq.quant = +e.target.value; seq.emit(); } }, ...[[0, 'free'], [0.25, '1/16'], [0.5, '1/8'], [1, '1/4']].map(([v, l]) => h('option', { value: v }, l)));
  const clear = h('button', { type: 'button', class: 'tog', onclick: () => seq.clear() }, 'Clear');
  const tl = h('div', { class: 'timeline' }), cv = h('canvas'); tl.append(cv);
  const g = cv.getContext('2d'); let W = 0, H = 0;
  new ResizeObserver(() => { const r = tl.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1); W = r.width; H = r.height; cv.width = W * d; cv.height = H * d; cv.style.width = W + 'px'; cv.style.height = H + 'px'; g.setTransform(d, 0, 0, d, 0, 0); }).observe(tl);
  const sync = () => {
    [...varBtns.children].forEach((b) => { const k = b.textContent; b.setAttribute('aria-pressed', k === seq.cur); b.classList.toggle('has', seq.vars[k].length > 0); });
    rec.classList.toggle('on', seq.rec); chain.setAttribute('aria-pressed', seq.chain); playMoves.setAttribute('aria-pressed', seq.on); bars.value = seq.bars; quant.value = seq.quant;
  };
  seq.addEventListener('change', sync); sync();
  $('#deck').append(
    h('div', { class: 'deck-l' }, h('div', { class: 'deck-row' }, slotBtns), h('div', { class: 'deck-row' }, oct, midiBtn, h('span', { class: 'faint mono hint' }, 'keys A–L · Z/X octave'))),
    keysEl,
    h('div', { class: 'deck-r' }, h('div', { class: 'deck-row' }, varBtns, rec, bars, quant), h('div', { class: 'deck-row' }, playMoves, chain, clear), tl));
  S.rooms.deck = { draw: () => {
    if (!W) return; g.clearRect(0, 0, W, H);
    const B = seq.beats, rows = 5, rh = H / rows, list = seq.vars[seq.cur], bpb = S.song.beatsPerBar;
    for (let b = 0; b <= B; b++) { g.fillStyle = b % bpb ? '#ffffff0d' : '#ffffff26'; g.fillRect((b / B) * W, 0, 1, H); }
    for (let r = 0; r < rows; r++) { g.fillStyle = '#6f747f'; g.font = '9px "IBM Plex Mono", monospace'; g.fillText(['CLOUD', 'INS 1', 'INS 2', 'INS 3', 'MOVES'][r], 3, r * rh + 9); }
    for (const e of list) {
      if (e.k === 'n') { const y = e.slot * rh + rh * (1 - ((e.note % 24) / 24)) * 0.8 + 2; g.fillStyle = '#ece8dc'; g.fillRect((e.b / B) * W, y, Math.max(2, (e.d / B) * W), 2.5); }
      else { g.fillStyle = '#e6b450'; g.fillRect((e.b / B) * W, 4 * rh + rh * (1 - e.v) * 0.8 + 2, 2, 2); }
    }
    const lb = seq.loopBeat(); if (lb !== null) { g.fillStyle = seq.rec ? '#df8a74' : '#e6b450'; g.fillRect((lb / B) * W, 0, 1.5, H); }
  } };
}

// ------------------------------------------------------------------------------------------------ transport, rooms, frame
function buildTransport() {
  const { player } = S;
  $('#t-play').onclick = () => (player.playing ? player.stop() : player.play());
  $('#t-rew').onclick = () => S.session.dispatch({ t: 'seek', bar: 0 });
  player.on('transport', ({ playing }) => { $('#t-play').classList.toggle('on', playing); $('#t-play').setAttribute('aria-label', playing ? 'Stop' : 'Play'); });
  document.querySelectorAll('#rooms button').forEach((b) => b.onclick = () => showRoom(b.dataset.room));
  addEventListener('keydown', (e) => {
    if (e.target.closest('input,select,textarea') || e.metaKey || e.ctrlKey) return;
    if (e.code === 'Space') { e.preventDefault(); player.playing ? player.stop() : player.play(); }
    else if (e.key === 'r' || e.key === 'R') { S.seq.rec = !S.seq.rec; if (S.seq.rec && !player.playing) player.play(); S.seq.emit(); }
    else if (e.key === 'Home') S.session.dispatch({ t: 'seek', bar: 0 });
    else if (/^[1-4]$/.test(e.key)) S.selectSlot(+e.key - 1);
  });
}
function showRoom(id) {
  if (!S.rooms[id]) id = 'cloud';
  S.room = id;
  document.querySelectorAll('.room').forEach((r) => r.hidden = r.id !== `room-${id}`);
  document.querySelectorAll('#rooms button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.room === id));
  const u = new URL(location.href); u.searchParams.set('room', id); history.replaceState(null, '', u);
  if (!S.rooms[id].ready) { S.rooms[id].ready = true; S.rooms[id].init?.(); }
  if (id === 'cloud') S.selectSlot(0);
}
const mbuf = new Float32Array(2048);
function frame() {
  const { player, song } = S;
  const beat = Math.max(0, player.beatNow()), bar = Math.floor(beat / song.beatsPerBar);
  $('#pos').textContent = `${String(bar % song.numBars + 1).padStart(3, '0')}.${Math.floor(beat % song.beatsPerBar) + 1}`;
  const sec = song.sections.find((s) => bar / song.barsPerCell >= s.startCell && bar / song.barsPerCell < s.endCell); $('#part').textContent = sec ? `Part ${sec.name}` : '';
  const lv = S.engine.meterLevel(mbuf); $('#master-meter').style.transform = `scaleX(${Math.min(1, lv)})`;
  for (const [id, m] of S.meters) { const ch = S.engine.channels.get(id); m.style.transform = `scaleX(${ch ? Math.min(1, ch.readLevel() * 3) : 0})`; }
  S.rooms[S.room]?.draw(); S.rooms.deck.draw();
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------------------------------------ keeping your work
const KEY = () => `playground.studio.${S.song.id}`;
function save() {
  try { localStorage.setItem(KEY(), JSON.stringify({ v: 1, params: S.params.dump(), seq: S.seq.dump(), cloud: S.cloudSrc, forges: S.forges.map((f) => f.slot.src || null), band: S.session.state })); } catch { /* full or private */ }
}
function restore() {
  let d; try { d = JSON.parse(localStorage.getItem(KEY())); } catch { return; }
  if (!d || d.v !== 1) return;
  S.params.load(d.params); S.seq.load(d.seq);
  if (d.cloud) S.cloudSrc = d.cloud;
  d.forges?.forEach((src, i) => { if (src) S.forges[i].slot.src = src; });
  if (d.band?.songId === S.song.id) S.session.dispatch({ t: 'state/load', state: d.band }, { log: false });
}
S.reset = () => { localStorage.removeItem(KEY()); location.reload(); };
