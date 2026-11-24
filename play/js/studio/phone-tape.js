// Tape: keep what you just heard, and make something of it. The phone is always listening to itself: the strip on top
// is the last half minute of everything you did, and a swipe across it (or 1 2 4 8, for the last bars) keeps that much
// as a piece. The piece opens below, cut into slices: choose a tool and paint it over the slices — off, backwards,
// repeated, an octave up or down, or move them about — and hear it as you do. Then put it on the tape, in the Cloud,
// in an instrument, or keep it as a sound file.
import { h, $ } from '../lib/util.js';
import { encodeWav } from '../lib/wav.js';
import { clamp, buzz, surface, gestures, COLORS, NAMES } from './phone-kit.js';
import { isTake, takeName } from './core.js';
import { keepSound } from './voice.js';

const DB = 'playground-pieces'; let dbp = null;
const db = () => (dbp ??= new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore('p'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
const idb = async (mode, fn) => { const d = await db(); return new Promise((res, rej) => { const t = d.transaction('p', mode), r = fn(t.objectStore('p')); t.oncomplete = () => res(r?.result); t.onerror = () => rej(t.error); }); };
const LEAD = 0.012;   // the master's own look-ahead: what is heard arrives on the ring this much late

export function buildTape(S, U) {
  const room = $('#p-tape'), q = S.seq, { song, player, ctx } = S, sr = ctx.sampleRate, { toast, srcAt, nextBar, bpb } = U, cb = song.barsPerCell, V = S.voice, pre = `${song.id}:`;

  // ---- listening: how loud it was, and where the bar lines were
  const past = [], lines = []; let asks = new Map(), askId = 0;
  S.retro.port.onmessage = ({ data: d }) => { if (d.pk !== undefined) { past.push([d.f / sr - LEAD, d.pk]); while (past.length && past[0][0] < d.f / sr - 34) past.shift(); return; } const k = asks.get(d.id); asks.delete(d.id); k?.(d); };
  const grab = (t0, t1) => new Promise((res) => { const id = ++askId; asks.set(id, res); S.retro.port.postMessage({ id, grab: [Math.round((t0 + LEAD) * sr), Math.round((t1 + LEAD) * sr)] }); });
  player.on('bar', ({ bar, time }) => { lines.push([time, player.barDur, bar]); while (lines.length > 60) lines.shift(); });
  const SPAN = 32;

  // ---- pieces
  let pieces = [], cur = null, playing = null; const bufs = new Map();
  const steps = (n) => Array.from({ length: n }, (_, i) => ({ i, r: 0, u: 1, o: 0, m: 0 }));
  const save = (c) => idb('readwrite', (s) => s.put({ ...c }, pre + c.id)).catch(() => {});
  const ready = (async () => { try { const keys = (await idb('readonly', (s) => s.getAllKeys())).filter((k) => String(k).startsWith(pre)); pieces = (await Promise.all(keys.map((k) => idb('readonly', (s) => s.get(k))))).filter(Boolean).sort((a, b) => b.t - a.t); cur = pieces[0] || null; shelfShow(); show(); } catch { /* private browsing: pieces last until you leave */ } })();
  async function keep(t0, t1, bars) {
    if (t1 > ctx.currentTime + LEAD) t1 = ctx.currentTime; const want = Math.round((t1 - t0) * sr); if (want < sr * 0.2) return;
    const d = await grab(t0, t1 - 0.001 < t0 ? t1 : t1); let pk = 0; for (let i = 0; i < d.L.length; i += 3) pk = Math.max(pk, Math.abs(d.L[i]), Math.abs(d.R[i])); if (pk < 0.004) { toast('That was silence'); return; }
    const c = { id: Date.now().toString(36), t: Date.now(), bars: bars || 0, bpm: player.bpm, L: d.L, R: d.R, steps: steps(bars ? clamp(Math.round(bars * 8), 4, 32) : 16), hist: [] };
    pieces.unshift(c); for (const x of pieces.splice(16)) { if (!q.arr.clips.some((k) => k.cap === x.id)) idb('readwrite', (s) => s.delete(pre + x.id)).catch(() => {}); else pieces.push(x); }
    cur = c; save(c); shelfShow(); show(); flash = performance.now(); buzz([14, 30, 14]); toast(`Kept ${bars ? `${bars} bar${bars === 1 ? '' : 's'}` : `${((t1 - t0)).toFixed(1)} s`}`);
  }
  /** The last n whole bars (as they were played), or, with nothing playing, that long in time. */
  function last(n) {
    const now = ctx.currentTime, done = lines.filter(([t, d]) => t + d <= now + 0.02); let k = done.length - 1, m = 0;
    if (player.playing || (done.length && now - (done[k][0] + done[k][1]) < 20)) { const end = done[k] ? done[k][0] + done[k][1] : 0; let st = end; while (m < n && k >= 0 && Math.abs(done[k][0] + done[k][1] - st) < 0.03) { st = done[k][0]; k--; m++; } if (m) { if (now - st > 33) { toast('Only the last half minute is kept'); return; } if (m < n) toast(`Only ${m} bar${m > 1 ? 's' : ''} so far`); keep(st, end, m); return; } }
    if (player.playing) { toast('After the first whole bar'); return; } const d = n * player.barDur; keep(Math.max(0, now - d), now, n);
  }

  // ---- a piece as sound
  function render(c) {
    const N = c.L.length, n = c.steps.length, src = c.src || n, sl = N / src, total = Math.round(sl * n), L = new Float32Array(total), R = new Float32Array(total), F = Math.min(140, sl * 0.1);
    c.steps.forEach((s, k) => {
      if (s.m) return; const o = Math.round(k * sl), e = Math.min(total, Math.round((k + 1) * sl)), len = e - o, at = s.i * sl, rate = 2 ** s.o, part = len / s.u, next = c.steps[k + 1], prev = c.steps[k - 1], plain = (a) => a && !a.m && !a.r && a.u === 1 && !a.o, fi = !(plain(s) && plain(prev) && prev.i + 1 === s.i), fo = !(plain(s) && plain(next) && next.i === s.i + 1);
      for (let i = 0; i < len; i++) { const j = i % part, p0 = j * rate, p = s.r ? at + sl - 1 - p0 : at + p0, x = ((p % N) + N) % N, a = x | 0, f = x - a, b = (a + 1) % N; let w = 1; if (fi && i < F) w = i / F; if (fo && i > len - F) w = Math.min(w, (len - i) / F); if (s.u > 1) { if (j < F) w = Math.min(w, j / F); if (j > part - F) w = Math.min(w, (part - j) / F); } L[o + i] = (c.L[a] + (c.L[b] - c.L[a]) * f) * w; R[o + i] = (c.R[a] + (c.R[b] - c.R[a]) * f) * w; }
    });
    return [L, R];
  }
  const bufOf = (c) => { const key = JSON.stringify(c.steps); let x = bufs.get(c.id); if (!x || x.key !== key) { const [L, R] = render(c), b = ctx.createBuffer(2, L.length, sr); b.copyToChannel(L, 0); b.copyToChannel(R, 1); bufs.set(c.id, (x = { key, b, L, R })); if (bufs.size > 6) bufs.delete(bufs.keys().next().value); } return x; };
  const len = (c) => ((c.L.length / sr) * c.steps.length) / (c.src || c.steps.length), barsOf = (c) => (c.bars ? (c.bars * c.steps.length) / (c.src || c.steps.length) : len(c) / player.barDur);

  // ---- hearing it: in time with the song when that plays, round and round when it does not
  function stop(t = ctx.currentTime) { const p = playing; playing = null; if (!p) return; p.g.gain.setTargetAtTime(0, t, 0.008); p.s.stop(t + 0.08); listenB.setAttribute('aria-pressed', 'false'); listenB.textContent = '▸ Listen'; }
  function play(c, keepPhase) {
    const b = bufOf(c).b, rate = c.bars ? player.bpm / c.bpm : 1, d = b.duration / rate; let t = ctx.currentTime + 0.03, off = 0;
    if (keepPhase && playing) { off = ((((t - playing.t) % d) + d) % d) * rate; } else if (player.playing) t = player.timeOfBar(player.barNow() + 1);
    const t0 = keepPhase && playing ? playing.t : t, old = playing; playing = null; if (old) { old.g.gain.setTargetAtTime(0, t, 0.006); old.s.stop(t + 0.06); }
    const s = ctx.createBufferSource(), g = ctx.createGain(); s.buffer = b; s.loop = true; s.playbackRate.value = rate; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + 0.006); s.connect(g).connect(S.dryBus); s.start(t, off); playing = { s, g, c, t: t0, d, rate }; listenB.setAttribute('aria-pressed', 'true'); listenB.textContent = '■ Stop';
  }
  let edT = 0; const edited = (c) => { clearTimeout(edT); edT = setTimeout(() => { if (playing?.c === c) play(c, true); save(c); }, 90); };
  const remember = (c) => { (c.hist ??= []).push(JSON.stringify([c.steps, c.src])); if (c.hist.length > 40) c.hist.shift(); };
  /** On the tape, a piece is bars of sound played by the tape's own clock. */
  player.on('bar', ({ bar, time }) => {
    if (q.mode !== 'song') return; const T = Math.floor(q.tl(bar * bpb()) / bpb());
    for (const cl of q.arr.clips) { if (!cl.cap || T < cl.start || T >= cl.start + cl.len) continue; const c = pieces.find((x) => x.id === cl.cap); if (!c) continue; const b = bufOf(c).b, n = Math.max(1, Math.round(barsOf(c))), rate = b.duration / n / player.barDur, at = (((T - cl.start + (cl.off || 0)) % n) * b.duration) / n, s = ctx.createBufferSource(), g = ctx.createGain(); s.buffer = b; s.playbackRate.value = rate; const first = T === cl.start || T === Math.floor(q.arr.cycle?.[0] ?? -1), end = time + player.barDur; g.gain.setValueAtTime(first ? 0 : 1, time); g.gain.linearRampToValueAtTime(1, time + 0.004); g.gain.setValueAtTime(1, end - 0.0015); g.gain.linearRampToValueAtTime(T === cl.start + cl.len - 1 ? 0 : 1, end); s.connect(g).connect(S.dryBus); s.start(time, at, b.duration / n + 0.002); live.add(s); s.onended = () => live.delete(s); }
  });
  const live = new Set(); const hush = () => { for (const s of live) { try { s.stop(); } catch { /* gone */ } } live.clear(); }; player.on('transport', ({ playing: p }) => { if (!p) hush(); }); player.on('seek', hush); player.on('tempo', () => { if (playing?.c.bars) play(playing.c, false); });

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
  const onTape = btn('On the tape', 'Put it on the tape at the playhead', () => { if (!cur) return; const n = Math.max(1, Math.round(barsOf(cur))), a = nextBar(); q.snapshot(); if (q.mode !== 'song') q.setMode('song'); q.place({ lane: 'cap', start: a, len: n, cap: cur.id, name: 'piece' }); if (a + n > q.arr.bars) q.arr.bars = a + n; q.changed(); toast(`On the tape at bar ${a + 1} · ↶ undoes`); buzz(14); }, 'dest');
  const mono = () => { const x = bufOf(cur), y = new Float32Array(x.L.length); for (let i = 0; i < y.length; i++) y[i] = (x.L[i] + x.R[i]) * 0.5; return y; };
  const toCloud = btn('Cloud', 'Grains made of this piece', async () => { if (!cur) return; const src = await keepSound(S, mono(), 'your piece'); S.params.set('cloud.va', 0, { by: 'ui' }); S.params.set('cloud.vb', 1, { by: 'ui' }); S.useCloudSource(src, { rec: src.rec, name: 'your piece' }); toast('The Cloud is made of it now'); buzz(14); }, 'dest');
  const toSound = btn('Instrument', 'An instrument made of this piece', async () => { if (!cur) return; const n = S.params.get('pocket.slot') || 1, src = await keepSound(S, mono(), 'your piece'); S.sounds[n - 1].useRec(src); toast(`${NAMES[n]} is made of it now`); buzz(14); }, 'dest');
  const share = btn('Share', 'Keep it as a sound file', async () => { if (!cur) return; const x = bufOf(cur), file = new File([encodeWav([x.L, x.R], sr)], `${song.title} · piece.wav`, { type: 'audio/wav' }); if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file] }); return; } catch (e) { if (e?.name === 'AbortError') return; } } const a = h('a', { href: URL.createObjectURL(file), download: file.name }); document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000); }, 'dest');

  // ---- the tape itself
  const box = h('div', { class: 'tape' }), C = surface(box), tg = C.g, ROWS = [['band', 'Stems', '#ece8dc'], ['own', 'Each stem', '#a3a6ad'], ['cap', 'Pieces', '#e6b450'], ['audio', 'Mic', '#df8a74'], [0, 'Cloud', COLORS[0]], [1, 'Sound 1', COLORS[1]], [2, 'Sound 2', COLORS[2]], ['m', 'Moves', '#a3a6ad']];
  const rowOf = (cl) => (String(cl.lane).startsWith('stem:') ? 1 : ROWS.findIndex((r) => r[0] === cl.lane)), geo = () => { const top = 14, rh = (C.H - top) / ROWS.length; return { top, rh, ppb: C.W / Math.max(4, vb() - va()) }; };
  let tv = null, td = null; const va = () => tv?.[0] ?? 0, vb = () => tv?.[1] ?? q.arr.bars, X = (b) => (b - va()) * geo().ppb, barAt = (x) => clamp(va() + x / geo().ppb, 0, q.arr.bars);
  gestures(box, {
    down: (p) => { const { top, rh } = geo(), bar = barAt(p.x), row = Math.floor((p.y - top) / rh), hit = row > 0 ? [...q.arr.clips].reverse().find((c) => rowOf(c) === row && bar >= c.start && bar < c.start + c.len) : null; td = { x: p.x, bar, hit, s0: hit?.start, t: setTimeout(() => { if (!td?.hit || td.moved) return; q.snapshot(); q.arr.clips = q.arr.clips.filter((c) => c !== td.hit); q.changed(); toast('Removed · ↶ undoes'); buzz(30); td = null; }, 550) }; },
    move: (p) => { if (!td) return; if (!td.moved && Math.abs(p.x - td.x) < 9) return; if (!td.moved) { td.moved = true; clearTimeout(td.t); if (td.hit) { q.snapshot(); buzz(8); } } if (td.hit) { const n = Math.max(0, td.s0 + Math.round((p.x - td.x) / geo().ppb)); if (n !== td.hit.start) { td.hit.start = n; buzz(3); } } else S.seek(Math.floor(barAt(p.x))); },
    up: () => { if (!td) return; clearTimeout(td.t); if (!td.moved) { S.seek(Math.floor(td.bar)); if (td.hit?.cap) { const c = pieces.find((x) => x.id === td.hit.cap); if (c) { cur = c; shelfShow(); show(); } } } else if (td.hit) { q.place(td.hit); if (td.hit.start + td.hit.len > q.arr.bars) q.arr.bars = td.hit.start + td.hit.len; q.changed(); } td = null; },
    twoStart: () => { if (td) clearTimeout(td.t); td = null; }, two: (e) => { const n = q.arr.bars, w = vb() - va(), a = va() + ((e.x - e.dx) / C.W) * w, nw = clamp(w / e.ds, 4, n), x = clamp(a - (e.x / C.W) * nw, 0, n - nw); tv = nw >= n ? null : [x, x + nw]; },
  });
  const recA = h('button', { type: 'button', class: 'chip sm recaudio' }, h('i'), h('span', {}, 'Mic'));
  recA.onclick = async () => { if (V.recording) { recA.disabled = true; const r = await V.stop(); recA.disabled = false; toast(r ? `Recorded ${r.bars} bar${r.bars > 1 ? 's' : ''} from the microphone · ↶ undoes` : 'Nothing was heard, so nothing was kept'); buzz(20); return; } try { await V.start(); toast('Recording the microphone from the next bar'); buzz(15); } catch (err) { toast(err.message); } };
  const showRec = () => { recA.classList.toggle('on', V.recording); recA.lastChild.textContent = V.recording ? `Stop · ${V.bars + 1}` : 'Mic'; }; V.addEventListener('change', showRec); showRec();
  const takes = h('div', { class: 'takes' }), sync = () => { const ks = [...new Set(q.arr.clips.filter((c) => c.pat && isTake(c.pat)).map((c) => c.pat))], sig = ks.map((k) => k + q.lens[k]).join(); if (sync.sig === sig) return; sync.sig = sig; takes.replaceChildren(...ks.map((k) => { const s = Math.min(...q.arr.clips.filter((c) => c.pat === k).map((c) => c.start)); return h('div', { class: 'take' }, h('button', { type: 'button', class: 'go', onclick: () => S.seek(s) }, `▸ ${takeName(k)}`), h('span', { class: 'mono' }, `bar ${s + 1} · ${q.lens[k]} bars`), h('button', { type: 'button', class: 'x', 'aria-label': `Remove ${takeName(k)}`, onclick: () => { q.snapshot(); q.arr.clips = q.arr.clips.filter((c) => c.pat !== k); q.changed(); } }, '×')); })); }; q.addEventListener('change', sync); sync();

  const empty = h('p', { class: 'tape-empty' }, 'Play something, then keep it: swipe across what you just heard, or press 1, 2, 4 or 8 bars.');
  const edit = h('div', { class: 'edit' }, ed, h('div', { class: 'tools' }, ...toolB), h('div', { class: 'row eds' }, listenB, undoB, half, dbl, fine, mix, clean), h('div', { class: 'dests' }, onTape, toCloud, toSound, share));
  room.append(h('div', { class: 'head row' }, h('h2', {}, 'Tape'), h('span', { class: 'sp' }), recA), h('div', { class: 'caprow' }, strip, h('div', { class: 'keepbs' }, h('small', { class: 'keepl' }, 'Keep the last'), ...keepBs)), shelf, empty, edit, box, takes);
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
  function drawTape() {
    const { W, H } = C; if (!W) return; const { top, rh, ppb } = geo(); tg.clearRect(0, 0, W, H); tg.font = '8.5px "IBM Plex Mono", monospace'; tg.textBaseline = 'middle'; tg.textAlign = 'left'; const every = ppb > 20 ? 1 : ppb > 12 ? 4 : ppb > 5 ? 8 : 16; for (let b = Math.floor(va() / every) * every; b <= vb(); b += every) { tg.fillStyle = '#ffffff16'; tg.fillRect(X(b), top, 1, H - top); tg.fillStyle = '#6f747f'; tg.fillText(String(b + 1), X(b) + 2, 7); }
    ROWS.forEach((r, i) => { tg.fillStyle = i % 2 ? '#ffffff05' : '#ffffff02'; tg.fillRect(0, top + i * rh, W, rh); }); const cy = q.arr.cycle; if (cy) { tg.fillStyle = '#e6b45026'; tg.fillRect(X(cy[0]), 0, (cy[1] - cy[0]) * ppb, H); }
    for (const cl of q.arr.clips) { const row = rowOf(cl); if (row < 0) continue; const col = ROWS[row][2], x = X(cl.start), w = Math.max(2, cl.len * ppb), y = top + row * rh + 1.5; if (x > W || x + w < 0) continue; tg.fillStyle = col + (cl.cap ? (cl.cap === cur?.id ? 'cc' : '77') : cl.fx || cl.mute?.length ? '66' : '30'); tg.fillRect(x + 0.5, y, w - 1, rh - 3); tg.fillStyle = col; tg.fillRect(x + 0.5, y, 1.5, rh - 3); }
    const vc = song.stems.find((x) => x.voice)?.cells || []; if (vc.some(Boolean)) for (let b = 0; b < q.arr.bars; b++) if (vc[Math.floor(srcAt(b) / cb)]) { tg.fillStyle = '#df8a7466'; tg.fillRect(X(b) + 0.5, top + 3 * rh + 1.5, Math.max(1, ppb - 1), rh - 3); }
    ROWS.forEach(([, nm], i) => { tg.fillStyle = '#c3c4c8'; tg.fillText(nm, 4, top + i * rh + rh / 2); }); const pb = q.tl(q.nowBeat()) / bpb(); tg.fillStyle = q.rec ? '#df8a74' : '#ece8dc'; tg.fillRect(X(pb), 0, 2, H); if (q.take) { const t = q.take, l = t.len || Math.max(0, pb - t.start); tg.fillStyle = '#df8a7430'; tg.fillRect(X(t.start), 0, l * ppb, H); }
  }
  S.rooms.tape = { draw: () => { if (V.recording) recA.style.setProperty('--lv', Math.min(1, V.level() * 1.4).toFixed(2)); drawPast(); drawEd(); drawTape(); }, hide: () => { if (!player.playing) stop(); }, shake: () => { if (cur) mix.click(); } };
  S.tapeRoom = { last, keep, get pieces() { return pieces; }, get cur() { return cur; }, render, bufOf, play, stop, lines, past };
}
