// Tape, two views of it. TIMELINE: the tape itself, in lanes, where ● writes what you do (phone-time.js). PIECES: the
// phone always listens to itself; the strip is the last half minute, and a swipe across it (or 1 2 4 8, for the last
// bars) keeps that much as a piece, cut into slices. Choose a tool and paint it over them — off, backwards, repeated, an
// octave up or down, or move them about — and hear it as you do. Then onto the timeline, into the Cloud or an instrument.
import { h, $ } from '../lib/util.js';
import { encodeWav } from '../lib/wav.js';
import { clamp, buzz, surface, gestures, NAMES } from './phone-kit.js';
import { buildTimeline } from './phone-time.js';
import { keepSound } from './voice.js';
import { pieceStore, pieceSound } from './pieces.js';
import { stay } from './project.js';

const LEAD = 0.012;   // the master's own look-ahead: what is heard arrives on the ring this much late

export function buildTape(S, U) {
  const room = $('#p-tape'), q = S.seq, P = S.params, { song, player, ctx } = S, sr = ctx.sampleRate, { toast, nextBar, bpb } = U, V = S.voice, store = pieceStore(song.id);

  // ---- listening: how loud it was, and where the bar lines were
  const past = [], lines = []; let asks = new Map(), askId = 0;
  S.retro.port.onmessage = ({ data: d }) => { if (d.pk !== undefined) { past.push([d.f / sr - LEAD, d.pk]); while (past.length && past[0][0] < d.f / sr - 34) past.shift(); return; } const k = asks.get(d.id); asks.delete(d.id); k?.(d); };
  const grab = (t0, t1) => new Promise((res) => { const id = ++askId; asks.set(id, res); S.retro.port.postMessage({ id, grab: [Math.round((t0 + LEAD) * sr), Math.round((t1 + LEAD) * sr)] }); });
  player.on('bar', ({ bar, time }) => { lines.push([time, player.barDur, bar]); while (lines.length > 60) lines.shift(); });
  const SPAN = 32;

  // ---- pieces
  let pieces = [], cur = null, playing = null;
  const steps = (n) => Array.from({ length: n }, (_, i) => ({ i, r: 0, u: 1, o: 0, m: 0 }));
  const save = (c) => { stay(); return store.put(c).catch(() => toast('This piece could not be kept: there is no room left')); };
  const ready = store.all().then((x) => { pieces = [...pieces, ...x]; cur ??= pieces[0] || null; shelfShow(); show(); });
  async function keep(t0, t1, bars) {
    if (t1 > ctx.currentTime + LEAD) t1 = ctx.currentTime; const want = Math.round((t1 - t0) * sr); if (want < sr * 0.2) return;
    const d = await grab(t0, t1 - 0.001 < t0 ? t1 : t1); let pk = 0; for (let i = 0; i < d.L.length; i += 3) pk = Math.max(pk, Math.abs(d.L[i]), Math.abs(d.R[i])); if (pk < 0.004) { toast('That was silence'); return; }
    const c = { id: Date.now().toString(36), t: Date.now(), bars: bars || 0, bpm: player.bpm, L: d.L, R: d.R, steps: steps(bars ? clamp(Math.round(bars * 8), 4, 32) : 16), hist: [] };
    pieces.unshift(c); for (const x of pieces.splice(16)) { if (!q.arr.clips.some((k) => k.cap === x.id)) store.del(x.id).catch(() => {}); else pieces.push(x); }
    cur = c; save(c); shelfShow(); show(); flash = performance.now(); buzz([14, 30, 14]); toast(`Kept ${bars ? `${bars} bar${bars === 1 ? '' : 's'}` : `${((t1 - t0)).toFixed(1)} s`}`);
  }
  /** The last n whole bars (as they were played), or, with nothing playing, that long in time. */
  function last(n) {
    const now = ctx.currentTime, done = lines.filter(([t, d]) => t + d <= now + 0.02); let k = done.length - 1, m = 0;
    if (player.playing || (done.length && now - (done[k][0] + done[k][1]) < 20)) { const end = done[k] ? done[k][0] + done[k][1] : 0; let st = end; while (m < n && k >= 0 && Math.abs(done[k][0] + done[k][1] - st) < 0.03) { st = done[k][0]; k--; m++; } if (m) { if (now - st > 33) { toast('Only the last half minute is kept'); return; } if (m < n) toast(`Only ${m} bar${m > 1 ? 's' : ''} so far`); keep(st, end, m); return; } }
    if (player.playing) { toast('After the first whole bar'); return; } const d = n * player.barDur; keep(Math.max(0, now - d), now, n);
  }

  const { render, bufOf, len, barsOf } = pieceSound(S, () => pieces);   // a piece as sound, and the ones on the timeline (pieces.js)

  // ---- hearing it: in time with the song when that plays, round and round when it does not
  function stop(t = ctx.currentTime) { const p = playing; playing = null; if (!p) return; p.g.gain.setTargetAtTime(0, t, 0.008); p.s.stop(t + 0.08); listenB.setAttribute('aria-pressed', 'false'); listenB.textContent = '▸ Listen'; }
  function play(c, keepPhase) {
    const b = bufOf(c).b, rate = c.bars ? player.bpm / c.bpm : 1, d = b.duration / rate; let t = ctx.currentTime + 0.03, off = 0;
    if (keepPhase && playing) { off = ((((t - playing.t) % d) + d) % d) * rate; } else if (player.playing) t = player.timeOfBar(player.barNow() + 1);
    const t0 = keepPhase && playing ? playing.t : t, old = playing; playing = null; if (old) { old.g.gain.setTargetAtTime(0, t, 0.006); old.s.stop(t + 0.06); }
    const s = ctx.createBufferSource(), g = ctx.createGain(); s.buffer = b; s.loop = true; s.playbackRate.value = rate; g.gain.value = 0; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + 0.006); s.connect(g).connect(S.dryBus); s.start(t, off); playing = { s, g, c, t: t0, d, rate }; listenB.setAttribute('aria-pressed', 'true'); listenB.textContent = '■ Stop';
  }
  let edT = 0; const edited = (c) => { clearTimeout(edT); edT = setTimeout(() => { if (playing?.c === c) play(c, true); save(c); }, 90); };
  const remember = (c) => { (c.hist ??= []).push(JSON.stringify([c.steps, c.src])); if (c.hist.length > 40) c.hist.shift(); };
  player.on('tempo', () => { if (playing?.c.bars) play(playing.c, false); });

  // ---- the strip of what was just heard
  const strip = h('div', { class: 'past' }), K = surface(strip), kg = K.g; let pick = null, flash = 0;
  const tOf = (x) => ctx.currentTime - SPAN * (1 - x / K.W), snap = (t) => { const b = lines.flatMap(([a, d]) => [0, 1, 2, 3, 4].map((k) => a + (d * k) / 4)).filter((x) => x <= ctx.currentTime + 0.02); let best = t, bd = 0.28; for (const x of b) if (Math.abs(x - t) < bd) { bd = Math.abs(x - t); best = x; } return best; };
  gestures(strip, { down: (p) => { pick = { t0: tOf(p.x), t1: tOf(p.x) }; }, move: (p) => { if (pick) { pick.t1 = tOf(p.x); pick.m = true; } }, up: () => { const k = pick; pick = null; if (!k?.m) return; const a = snap(Math.min(k.t0, k.t1)), b = Math.min(ctx.currentTime, snap(Math.max(k.t0, k.t1))), d = lines.find(([t]) => Math.abs(t - a) < 0.5)?.[1] || player.barDur, n = (b - a) / d; if (b - a < 0.15) return; const beats = Math.round(n * 4); keep(a, b, beats > 0 && Math.abs(n * 4 - beats) < 0.06 ? beats / 4 : 0); } });
  const keepBs = [1, 2, 4, 8].map((n) => h('button', { type: 'button', class: 'keepb', onclick: () => last(n) }, h('b', {}, String(n)), h('small', {}, n > 1 ? 'bars' : 'bar')));

  // ---- the shelf
  const shelf = h('div', { class: 'shelf' });
  const mini = (c, cv) => { const g = cv.getContext('2d'), W = (cv.width = 128), H = (cv.height = 52), x = bufOf(c).L, n = 64; g.clearRect(0, 0, W, H); g.fillStyle = c === cur ? '#e6b450' : '#a3a6ad'; for (let i = 0; i < n; i++) { let m = 0; for (let j = Math.floor((i / n) * x.length), e = Math.floor(((i + 1) / n) * x.length); j < e; j += 64) m = Math.max(m, Math.abs(x[j])); const hh = Math.max(1, m * H * 0.9); g.fillRect(i * 2, (H - hh) / 2, 1.4, hh); } };
  function shelfShow() {
    shelf.replaceChildren(...pieces.map((c, i) => { const cv = h('canvas'), b = h('button', { type: 'button', class: 'pc', 'aria-pressed': c === cur, 'aria-label': `Piece ${pieces.length - i}` }, cv, h('small', {}, c.bars ? `${+barsOf(c).toFixed(2)} bar${barsOf(c) === 1 ? '' : 's'}` : `${len(c).toFixed(1)} s`)); let t = 0, held = false; b.addEventListener('pointerdown', () => { held = false; t = setTimeout(() => { held = true; if (confirm('Throw this piece away?')) { if (playing?.c === c) stop(); q.arr.clips = q.arr.clips.filter((k) => k.cap !== c.id); q.changed(); pieces = pieces.filter((x) => x !== c); idb('readwrite', (s) => s.delete(pre + c.id)).catch(() => {}); if (cur === c) cur = pieces[0] || null; shelfShow(); show(); } }, 600); }); for (const e of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(e, () => clearTimeout(t)); b.addEventListener('contextmenu', (e) => e.preventDefault()); b.onclick = () => { if (held) return; const was = cur; cur = c; if (playing && was !== c) play(c); shelfShow(); show(); buzz(6); }; mini(c, cv); return b; }));
    shelf.hidden = !pieces.length;
  }

  // ---- the editor: slices, and a tool to paint on them
  const TOOLS = { move: ['Move', '↔', 'Drag a slice to another place'], off: ['Off', '✕', 'Silence a slice'], rev: ['Back', '◂', 'Play a slice backwards'], rep: ['Repeat', '≡', 'Repeat a slice: 2, 3, 4, 8 times'], up: ['Up', '↑', 'An octave up'], down: ['Down', '↓', 'An octave down'], fix: ['Clean', '○', 'Put slices back as they were'] };
  let tool = 'off', brush = null, drag = null; const toolB = Object.entries(TOOLS).map(([k, [n, ic, t]]) => h('button', { type: 'button', class: 'tool', title: t, onclick: () => { tool = k; showTools(); buzz(5); } }, h('i', {}, ic), n)), showTools = () => toolB.forEach((b, i) => b.setAttribute('aria-pressed', Object.keys(TOOLS)[i] === tool)); showTools();
  const ed = h('div', { class: 'editor' }), E = surface(ed), g = E.g, rows = () => (cur && cur.steps.length > 16 ? 2 : 1), cell = () => { const n = cur.steps.length, per = Math.ceil(n / rows()); return { per, w: E.W / per, hh: E.H / rows() }; };
  const at = (p) => { const { per, w, hh } = cell(), r = clamp(Math.floor(p.y / hh), 0, rows() - 1), i = r * per + clamp(Math.floor(p.x / w), 0, per - 1); return i < cur.steps.length ? i : -1; };
  function paint(i) {
    const s = cur.steps[i]; if (!s) return;
    if (tool === 'off') s.m = brush.v; else if (tool === 'rev') s.r = brush.v; else if (tool === 'rep') s.u = brush.v; else if (tool === 'up' || tool === 'down') s.o = brush.v; else if (tool === 'fix') cur.steps[i] = { i: i % (cur.src || cur.steps.length), r: 0, u: 1, o: 0, m: 0 };
    edited(cur); buzz(5);
  }
  gestures(ed, {
    down: (p) => { if (!cur || !E.W) return; const i = at(p); if (i < 0) return; const s = cur.steps[i]; if (tool === 'move') { drag = { from: i, x: p.x, y: p.y, to: i }; buzz(8); return; } remember(cur); brush = { last: i, v: tool === 'off' ? (s.m ? 0 : 1) : tool === 'rev' ? (s.r ? 0 : 1) : tool === 'rep' ? ({ 1: 2, 2: 3, 3: 4, 4: 8, 8: 1 })[s.u] : tool === 'up' ? (s.o > 0 ? 0 : 1) : tool === 'down' ? (s.o < 0 ? 0 : -1) : 0 }; paint(i); },
    move: (p) => { if (!cur) return; if (drag) { drag.x = p.x; drag.y = p.y; const i = at(p); if (i >= 0) drag.to = i; return; } if (!brush) return; const i = at(p); if (i >= 0 && i !== brush.last) { brush.last = i; paint(i); } },
    up: () => { if (drag && drag.to !== drag.from) { remember(cur); const a = cur.steps[drag.from]; cur.steps[drag.from] = cur.steps[drag.to]; cur.steps[drag.to] = a; edited(cur); buzz([8, 20, 8]); } else if (drag && playing?.c !== cur) { const x = bufOf(cur), d = x.b.duration / cur.steps.length, s = ctx.createBufferSource(); s.buffer = x.b; s.connect(S.dryBus); s.start(ctx.currentTime, drag.from * d, d); } if (brush || drag) mini2(); drag = brush = null; },
    allUp: () => { drag = brush = null; },
  });
  const mini2 = () => { const i = pieces.indexOf(cur), cv = shelf.children[i]?.querySelector('canvas'); if (cv) mini(cur, cv); };
  const btn = (label, title, fn, cls = 'chip sm') => h('button', { type: 'button', class: cls, title, onclick: fn }, label), change = (fn) => () => { if (!cur) return; remember(cur); fn(cur); edited(cur); shelfShow(); show(); buzz(8); };
  const listenB = btn('▸ Listen', 'Hear the piece, round and round', () => { if (!cur) return; ctx.resume(); playing?.c === cur ? stop() : play(cur); }, 'chip sm listen');
  const undoB = btn('↶', 'Undo in this piece', () => { const x = cur?.hist?.pop(); if (!x) { toast('Nothing to undo in this piece'); return; } [cur.steps, cur.src] = JSON.parse(x); edited(cur); shelfShow(); show(); });
  const half = btn('½', 'Only the first half', change((c) => { if (c.steps.length < 2) return; c.src ??= c.steps.length; c.steps = c.steps.slice(0, Math.ceil(c.steps.length / 2)); })), dbl = btn('×2', 'Twice as long', change((c) => { if (c.steps.length > 32) return; c.src ??= c.steps.length; c.steps = [...c.steps, ...c.steps.map((s) => ({ ...s }))]; }));
  const fine = btn('', 'How fine the slices are', change((c) => { const n = c.src || c.steps.length, f = c.steps.length >= 32 || n >= 32 ? 0.25 : 2; if (f === 2) { c.src = n * 2; c.steps = c.steps.flatMap((s) => (s.r ? [{ ...s, i: s.i * 2 + 1 }, { ...s, i: s.i * 2 }] : [{ ...s, i: s.i * 2 }, { ...s, i: s.i * 2 + 1 }])); } else { const k = Math.max(1, Math.round(n * f)), m = Math.max(1, Math.round(c.steps.length * f)); c.src = k; c.steps = Array.from({ length: m }, (_, i) => ({ i: i % k, r: 0, u: 1, o: 0, m: 0 })); } }));
  const mix = btn('Mix', 'A new order (or shake the phone)', change((c) => { const n = c.src || c.steps.length; c.steps = c.steps.map((s, i) => (Math.random() < 0.45 ? { i: Math.floor(Math.random() * n), r: Math.random() < 0.16 ? 1 : 0, u: Math.random() < 0.18 ? [2, 3, 4][Math.floor(Math.random() * 3)] : 1, o: 0, m: 0 } : { ...s, i: s.m ? i % n : s.i })); }));
  const clean = btn('Reset', 'As it was kept', change((c) => { const n = c.src || c.steps.length; c.steps = steps(n); c.src = undefined; }));

  // ---- where it goes
  const onTape = btn('→ Timeline', 'Put it on the timeline at the playhead', () => { if (!cur) return; const n = Math.max(1, Math.round(barsOf(cur))), a = nextBar(); q.snapshot(); if (q.mode !== 'song') q.setMode('song'); const cl = q.place({ lane: 'cap', start: a, len: n, cap: cur.id, name: 'piece' }); if (a + n > q.arr.bars) q.arr.bars = a + n; q.changed(); if (playing) stop(); view('time'); TL.show(cl); toast(`On the tape at bar ${a + 1} · ↶ undoes`); buzz(14); }, 'dest');
  const mono = () => { const x = bufOf(cur), y = new Float32Array(x.L.length); for (let i = 0; i < y.length; i++) y[i] = (x.L[i] + x.R[i]) * 0.5; return y; };
  const toCloud = btn('Cloud', 'Grains made of this piece', async () => { if (!cur) return; const src = await keepSound(S, mono(), 'your piece'); S.params.set('cloud.va', 0, { by: 'ui' }); S.params.set('cloud.vb', 1, { by: 'ui' }); S.useCloudSource(src, { rec: src.rec, name: 'your piece' }); toast('The Cloud is made of it now'); buzz(14); }, 'dest');
  const toSound = btn('Instrument', 'An instrument made of this piece', async () => { if (!cur) return; const n = S.params.get('pocket.slot') || 1, src = await keepSound(S, mono(), 'your piece'); S.sounds[n - 1].useRec(src); toast(`${NAMES[n]} is made of it now`); buzz(14); }, 'dest');
  const share = btn('Share', 'Keep it as a sound file', async () => { if (!cur) return; const x = bufOf(cur), file = new File([encodeWav([x.L, x.R], sr)], `${song.title} · piece.wav`, { type: 'audio/wav' }); if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file] }); return; } catch (e) { if (e?.name === 'AbortError') return; } } const a = h('a', { href: URL.createObjectURL(file), download: file.name }); document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000); }, 'dest');

  // ---- the two views
  P.define('pocket.tape', 'time'); const TL = buildTimeline(S, U, { openPiece: (id) => { const c = pieces.find((x) => x.id === id); if (c) { cur = c; shelfShow(); show(); view('pieces'); } } });
  const tabs = [['time', 'Timeline'], ['pieces', 'Pieces']].map(([k, l]) => h('button', { type: 'button', onclick: () => { view(k); buzz(6); } }, l)), view = (k) => { P.set('pocket.tape', k, { by: 'ui' }); sync(); };
  const recA = h('button', { type: 'button', class: 'chip sm recaudio' }, h('i'), h('span', {}, 'Mic'));
  recA.onclick = async () => { if (V.recording) { recA.disabled = true; const r = await V.stop(); recA.disabled = false; toast(r ? `Recorded ${r.bars} bar${r.bars > 1 ? 's' : ''} from the microphone · ↶ undoes` : 'Nothing was heard, so nothing was kept'); buzz(20); return; } try { await V.start(); toast('Recording the microphone from the next bar'); buzz(15); } catch (err) { toast(err.message); } };
  const showRec = () => { recA.classList.toggle('on', V.recording); recA.lastChild.textContent = V.recording ? `Stop · ${V.bars + 1}` : 'Mic'; }; V.addEventListener('change', showRec); showRec();
  const V1 = h('div', { class: 'tview' }), V2 = h('div', { class: 'tview' }), sync = () => { const k = P.get('pocket.tape'); V1.hidden = k !== 'time'; V2.hidden = k === 'time'; tabs.forEach((x, n) => x.setAttribute('aria-pressed', ['time', 'pieces'][n] === k)); }; P.on(({ path }) => path === 'pocket.tape' && sync());
  const empty = h('p', { class: 'tape-empty' }, 'Play something, then keep it: swipe across what you just heard, or press 1, 2, 4 or 8 bars.');
  const edit = h('div', { class: 'edit' }, ed, h('div', { class: 'tools' }, ...toolB), h('div', { class: 'row eds' }, listenB, undoB, half, dbl, fine, mix, clean), h('div', { class: 'dests' }, onTape, toCloud, toSound, share));
  V1.append(TL.el, TL.row); V2.append(h('div', { class: 'caprow' }, strip, h('div', { class: 'keepbs' }, h('small', { class: 'keepl' }, 'Keep the last'), ...keepBs)), shelf, empty, edit);
  room.append(h('div', { class: 'head row' }, h('h2', {}, 'Tape'), h('div', { class: 'seg' }, ...tabs), h('span', { class: 'sp' }), recA), V1, V2); sync();
  const show = () => { edit.hidden = !cur; empty.hidden = !!cur; if (cur) { fine.textContent = `÷${cur.src || cur.steps.length}`; } }; show(); void ready;

  // ---- drawing
  function drawPast() {
    const { W, H } = K; if (!W) return; kg.clearRect(0, 0, W, H); const now = ctx.currentTime, x = (t) => W * (1 - (now - t) / SPAN); for (const [t, d] of lines) for (let k = 0; k < 4; k++) { const u = x(t + (d * k) / 4); if (u < 0 || u > W) continue; kg.fillStyle = k ? '#ffffff0c' : '#ffffff30'; kg.fillRect(u, 0, 1, H); }
    const a = pick?.m ? Math.min(pick.t0, pick.t1) : 1e9, b = pick?.m ? Math.max(pick.t0, pick.t1) : 1e9; for (const [t, p] of past) { const u = x(t), hh = Math.max(1, Math.min(1, p * 1.1) * (H - 8)); if (u < -2) continue; kg.fillStyle = t >= a && t <= b ? '#e6b450' : '#ece8dc88'; kg.fillRect(u, (H - hh) / 2, Math.max(1, (W / SPAN) * 0.043 - 0.4), hh); }
    if (pick?.m) { kg.fillStyle = '#e6b45024'; kg.fillRect(x(a), 0, x(b) - x(a), H); kg.strokeStyle = '#e6b450'; kg.strokeRect(x(a), 0.5, x(b) - x(a), H - 1); } const f = clamp(1 - (performance.now() - flash) / 500, 0, 1); if (f) { kg.fillStyle = `rgba(230,180,80,${f * 0.35})`; kg.fillRect(0, 0, W, H); }
    if (past.length < 6) { kg.fillStyle = '#7f8694'; kg.font = '10px "IBM Plex Mono", monospace'; kg.textAlign = 'center'; kg.textBaseline = 'middle'; kg.fillText('LISTENING', W / 2, H / 2); }
  }
  function drawEd() {
    const { W, H } = E; if (!W || !cur) return; g.clearRect(0, 0, W, H); const c = cur, { per, w, hh } = cell(), n = c.src || c.steps.length, N = c.L.length, pk = (c._pk ??= (() => { const M = 512, o = new Float32Array(M); for (let i = 0; i < M; i++) { let m = 0; for (let j = Math.floor((i / M) * N), e = Math.floor(((i + 1) / M) * N); j < e; j += 12) m = Math.max(m, Math.abs(c.L[j])); o[i] = m; } let mx = Math.max(0.05, ...o); return o.map((v) => v / mx); })()), hue = (i) => `hsl(${28 + (i / n) * 190} 62% 66%)`;
    let ph = -1; if (playing?.c === c) ph = ((((ctx.currentTime - playing.t) / playing.d) % 1) + 1) % 1 * c.steps.length;
    c.steps.forEach((s, k) => {
      const x = (k % per) * w, y = Math.floor(k / per) * hh, on = Math.floor(ph) === k && ctx.currentTime >= (playing?.t || 0), gone = drag?.from === k && drag.to !== k; g.globalAlpha = gone ? 0.3 : 1; g.fillStyle = on ? '#e6b45038' : drag?.to === k && drag.to !== drag.from ? '#ffffff2a' : '#ffffff0a'; g.beginPath(); g.roundRect(x + 1, y + 1, w - 2, hh - 2, 4); g.fill();
      if (!s.m) { const M = Math.max(3, Math.floor(w / 2.4)); g.fillStyle = hue(s.i); for (let j = 0; j < M; j++) { let u = j / M; u = (u * s.u) % 1; u *= s.o > 0 ? 1.6 : s.o < 0 ? 0.6 : 1; if (s.r) u = 1 - u; const v = pk[clamp(Math.floor(((s.i + u) / n) * 512), 0, 511)], bh = Math.max(1, v * (hh - 22)); g.fillRect(x + 2 + (j / M) * (w - 4), y + hh / 2 - bh / 2, Math.max(1, (w - 4) / M - 0.8), bh); } } else { g.strokeStyle = '#ffffff22'; g.beginPath(); g.moveTo(x + w * 0.3, y + hh * 0.4); g.lineTo(x + w * 0.7, y + hh * 0.6); g.stroke(); }
      const tag = [s.r ? '◂' : '', s.u > 1 ? `×${s.u}` : '', s.o > 0 ? '↑' : s.o < 0 ? '↓' : ''].filter(Boolean).join(''); if (tag && !s.m) { g.font = '600 9px "IBM Plex Mono", monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff'; g.fillText(tag, x + w / 2, y + hh - 8, w); } g.globalAlpha = 1;
    });
    if (ph >= 0 && ctx.currentTime >= playing.t) { const k = Math.floor(ph); g.fillStyle = '#fff'; g.fillRect((k % per) * w + (ph - k) * w, Math.floor(k / per) * hh, 1.5, hh); }
    if (drag) { g.strokeStyle = '#e6b450'; g.lineWidth = 2; g.beginPath(); g.roundRect(drag.x - w / 2, drag.y - hh / 2 - 6, w, hh, 5); g.stroke(); }
  }
  S.rooms.tape = { draw: () => { if (V.recording) recA.style.setProperty('--lv', Math.min(1, V.level() * 1.4).toFixed(2)); if (P.get('pocket.tape') === 'time') TL.draw(); else { drawPast(); drawEd(); } }, hide: () => { if (!player.playing) stop(); }, shake: () => { if (cur && P.get('pocket.tape') !== 'time') mix.click(); } };
  S.tapeRoom = { last, keep, get pieces() { return pieces; }, get cur() { return cur; }, render, bufOf, play, stop, lines, past };
}
