// Cloud: a stretch of sound broken into grains. One finger on the wave plays it (across: where; up and down: what you
// choose). The strip under the wave is the whole sound: drag its two handles, or what lies between them, to choose the
// buffer the wave shows; pinching the wave does the same. Under that either eight characters,
// far apart from one another, or all sixteen controls.
import { h, $ } from '../lib/util.js';
import { clamp, r3, buzz, surface, gestures, tileField, memories, zoomPeaks } from './phone-kit.js';
import { loudestCells, loadSource } from './core.js';
import { recButton } from './voice.js';
import { pickStem } from './phone-pick.js';

const pct = (v) => `${Math.round(v * 100)}`, ms = (s) => (s < 0.1 ? `${(s * 1000).toFixed(s < 0.01 ? 1 : 0)}ms` : s < 10 ? `${s.toFixed(2)}s` : `${s.toFixed(0)}s`), st = (v) => `${v > 0 ? '+' : ''}${v}`;
const DIV = [0.5, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24];
// each: size density spray pitch scatter harmony rhythm tone | peak reverse drift attack release echo space heat
const CHARS = {
  Mist: [0.62, 0.5, 0.55, 0, 0.3, 0.15, 0, 0.62, 0.1, 0.35, 0.04, 0.5, 0.65, 0.1, 0.7, 0],
  Choir: [0.66, 0.78, 0.14, 0, 0.12, 0.85, 0, 0.74, 0.1, 0.1, 0, 0.4, 0.6, 0.15, 0.55, 0],
  Rain: [0.16, 0.34, 0.9, 12, 0, 0.6, 0, 0.94, 0.15, 0, 0, 0, 0.3, 0.55, 0.45, 0],
  Clock: [0.24, 0.36, 0.5, 0, 0, 0.3, 1, 0.85, 0.2, 0, 0.1, 0, 0.12, 0.4, 0.15, 0.1],
  Engine: [0.07, 0.96, 0.02, -12, 0, 0.1, 1, 0.5, 0.55, 0, 0, 0.02, 0.15, 0, 0.15, 0.6],
  Tide: [0.86, 0.36, 0.3, -5, 0, 0.2, 0, 0.5, 0.2, 1, -0.22, 0.6, 0.7, 0.35, 0.6, 0.08],
  Glass: [0.2, 0.6, 0.3, 24, 0, 0.75, 0, 1, 0.35, 0.4, 0, 0.02, 0.4, 0.35, 0.8, 0],
  Dust: [0.04, 0.26, 1, 0, 9, 0.2, 0, 0.82, 0.3, 0.5, 0.35, 0, 0.1, 0.6, 0.35, 0.35],
};
export function buildCloudPage(S, U) {
  const room = $('#p-cloud'), P = S.params, voice = S.cloud.voice, { toast, tiltSet } = U, c = S.ctx;
  // ---- more to turn: harmony, rhythm, a filter of its own
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 20000; voice.node.disconnect(); voice.node.connect(lp).connect(S.strips.cloud.input);
  P.define('cloud.va', 0); P.define('cloud.vb', 1); P.define('cloud.spray', 0.16); P.define('cloud.harm', 0, (v) => voice.set({ harm: v }));
  P.define('cloud.tone', 1, (v) => lp.frequency.setTargetAtTime(70 * 285 ** v, c.currentTime, 0.04)); P.define('cloud.peak', 0.05, (v) => lp.Q.setTargetAtTime(0.4 + v * v * 17, c.currentTime, 0.04));
  // grains up to three seconds long and down to a few thousandths; with Rhythm up, their rate locks to the beat
  // sparse, tiny grains are lifted, so every character is about as loud
  const lift = () => { const o = rate() * (4 + 2996 * (P.get('cloud.size') ?? 0.35) ** 2.6) / 1000; voice.set({ level: (P.get('cloud.level') ?? 0.75) * clamp((0.9 / Math.max(0.02, o)) ** 0.5, 0.9, 5.5) }); };
  P.apply['cloud.level'] = () => lift(); P.apply['cloud.size'] = (v) => { voice.set({ size: 4 + 2996 * v ** 2.6 }); lift(); }; const rate = () => { const d = 1 + 119 * (P.get('cloud.density') ?? 0.4) ** 1.6, s = P.get('cloud.sync') ?? 0; if (s < 0.25) return d; const b = S.player.beatDur; return DIV.reduce((x, y) => (Math.abs(Math.log(y / b / d)) < Math.abs(Math.log(x / b / d)) ? y : x)) / b; };
  P.apply['cloud.density'] = () => { voice.set({ density: rate() }); lift(); }; P.define('cloud.sync', 0, (v) => voice.set({ sync: v, density: rate() })); S.player.on('tempo', () => voice.set({ density: rate() })); P.apply['cloud.size'](P.get('cloud.size'));
  Object.assign(P.range, { 'cloud.scan': [-1, 1, 'Drift'], 'cloud.va': [0, 1, 'Buffer from'], 'cloud.vb': [0, 1, 'Buffer to'] });
  const ARMS = [['cloud.size', 'Size', (v) => ms((4 + 2996 * v ** 2.6) / 1000)], ['cloud.density', 'Density', () => `${rate() < 10 ? rate().toFixed(1) : Math.round(rate())}/s`], ['cloud.spray', 'Spray', pct], ['cloud.pitch', 'Pitch', st, -24, 24, 1], ['cloud.jitter', 'Scatter', (v) => `±${v.toFixed(1)}`, 0, 12], ['cloud.harm', 'Harmony', pct], ['cloud.sync', 'Rhythm', (v) => (v < 0.25 ? 'free' : pct(v))], ['cloud.tone', 'Tone', pct],
    ['cloud.peak', 'Peak', pct], ['cloud.reverse', 'Reverse', pct], ['cloud.scan', 'Drift', (v) => (v ? st(Math.round(v * 100)) : 'still'), -1, 1], ['cloud.attack', 'Attack', (v) => ms(0.002 + v * v * 4)], ['cloud.release', 'Release', (v) => ms(0.02 + v * v * 8)], ['mix.cloud.echo', 'Echo', pct], ['mix.cloud.space', 'Space', pct], ['mix.cloud.heat', 'Heat', pct]];
  const a = () => P.get('cloud.va'), b = () => P.get('cloud.vb'), span = () => Math.max(1e-5, b() - a()), r5 = (v) => Math.round(v * 1e5) / 1e5;
  const spread = () => { const v = r5(clamp((P.get('cloud.spray') * span()) / 2, 0, 0.5)); if (v !== P.get('cloud.spread')) P.set('cloud.spread', v); };
  P.on(({ path }) => path === 'cloud.spray' && spread());
  const view = (x, y, by = 'user') => { x = clamp(x, 0, 1 - 1e-5); y = clamp(y, x + 1e-5, 1); P.set('cloud.va', r5(x), { by }); P.set('cloud.vb', r5(y), { by }); spread(); const p = P.get('cloud.pos'); if (p < x || p > y) P.set('cloud.pos', r5(clamp(p, x, y))); };
  const min = () => 0.006 / (S.cloud.src?.dur || 16);

  // ---- the wave
  const surf = h('div', { class: 'surface' }), C = surface(surf), g = C.g; let sounding = false, last = null, ghost = [], two = false;
  P.define('cloud.up', 'pitch'); const UP = { pitch: ['Pitch', 'cloud.pitch', (u) => Math.round((u - 0.5) * 36)], size: ['Size', 'cloud.size', (u) => r3(u)], tone: ['Tone', 'cloud.tone', (u) => r3(0.12 + u * 0.88)], spray: ['Spray', 'cloud.spray', (u) => r3(u)], density: ['Density', 'cloud.density', (u) => r3(u)] };
  const sound = (on) => { if (on === sounding) return; sounding = on; if (P.get('cloud.drone')) return; if (on) { voice.noteOn('touch', 60, 0.85); S.seq.noteIn(0, 60, 0.85, true); } else { voice.noteOff('touch'); S.seq.noteIn(0, 60, 0, false); } };
  const one = (p) => { if (!C.W) return; P.set('cloud.pos', r5(a() + clamp(p.x / C.W, 0, 1) * span())); const [, path, f] = UP[P.get('cloud.up')] || UP.pitch; const v = f(clamp(1 - p.y / C.H, 0, 1)); if (P.get(path) !== v) P.set(path, v); };
  gestures(surf, {
    down: (p) => { last = p; sound(true); one(p); }, move: (p) => { last = p; one(p); }, up: () => { sound(false); last = null; },
    twoStart: () => { last = null; two = true; sound(true); },
    two: (e) => { if (!C.W) return; const s = span(), ns = clamp(s / e.ds, Math.min(1, min()), 1), x = clamp(a() + ((e.x - e.dx) / C.W) * s - (e.x / C.W) * ns, 0, 1 - ns); view(x, x + ns); P.set('cloud.pos', r5(clamp(a() + (e.x / C.W) * span(), 0, 1))); },
    twoEnd: () => { sound(false); two = false; }, allUp: () => { sound(false); two = false; },
  });

  // ---- the whole sound, with the buffer's two handles
  const over = h('div', { class: 'overview' }), O = surface(over), og = O.g; let od = null;
  over.addEventListener('pointerdown', (e) => { e.preventDefault(); try { over.setPointerCapture(e.pointerId); } catch { /* fine */ } const r = over.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, d0 = Math.abs(x - a()), d1 = Math.abs(x - b()), t = 26 / r.width; od = { id: e.pointerId, m: Math.min(d0, d1) < t ? (d0 < d1 || (d0 === d1 && x < a()) ? 'a' : 'b') : x > a() && x < b() ? 'move' : 'jump', off: x - a() }; if (od.m === 'jump') { const w = span(); od = { id: e.pointerId, m: 'move', off: w / 2 }; view(clamp(x - w / 2, 0, 1 - w), clamp(x - w / 2, 0, 1 - w) + w); } buzz(5); });
  over.addEventListener('pointermove', (e) => { if (od?.id !== e.pointerId) return; const r = over.getBoundingClientRect(), x = clamp((e.clientX - r.left) / r.width, 0, 1), w = span(); if (od.m === 'a') view(Math.min(x, b() - min()), b()); else if (od.m === 'b') view(a(), Math.max(x, a() + min())); else { const n = clamp(x - od.off, 0, 1 - w); view(n, n + w); } });
  for (const t of ['pointerup', 'pointercancel']) over.addEventListener(t, () => { od = null; });
  let loading = false;
  const bars = async (n) => { const k = S.cloudSrc; if (loading || !k || k.rec) return; const stem = S.song.stems.find((x) => x.id === k.stemId), N = stem.cells.length, na = clamp(Math.round((k.a + k.b) / 2 - n / 2), 0, Math.max(0, N - n)), ref = { stemId: k.stemId, a: na, b: Math.min(N, na + n) }; loading = true; try { S.useCloudSource(await loadSource(S, ref.stemId, ref.a, ref.b), ref, true); view(0, 1, 'ui'); } catch { /* as it was */ } loading = false; showBars(); };
  const barB = h('button', { type: 'button', class: 'chip sm', title: 'How much of the song the sound is', onclick: () => { const n = S.cloudSrc?.rec ? 0 : S.cloudSrc.b - S.cloudSrc.a; if (n) bars(n >= 4 ? 1 : n * 2); buzz(6); } }), showBars = () => { const k = S.cloudSrc; barB.hidden = !k || !!k.rec; if (k && !k.rec) barB.textContent = `${(k.b - k.a) * S.song.barsPerCell} bars`; };

  // ---- characters, faders, the rest
  let glide = 0; const become = (name) => { cancelAnimationFrame(glide); const to = CHARS[name], from = ARMS.map(([p]) => P.get(p) ?? 0), t0 = performance.now(); let lt = 0; const step = (now) => { const k = Math.min(1, (now - t0) / 650), e = k * k * (3 - 2 * k); if (k === 1 || now - lt > 40) { lt = now; ARMS.forEach(([p, , , , , sp], i) => { const v = from[i] + (to[i] - from[i]) * e; P.set(p, sp ? Math.round(v) : r3(v)); }); } if (k < 1) glide = requestAnimationFrame(step); }; glide = requestAnimationFrame(step); now = name; showChars(); buzz(10); };
  let now = ''; const charB = Object.keys(CHARS).map((n) => h('button', { type: 'button', class: 'chip sm', onclick: () => become(n) }, n)), showChars = () => charB.forEach((x) => x.setAttribute('aria-pressed', x.textContent === now));
  P.define('pocket.cview', 'chars'); const tiles = tileField(S, () => ARMS, { cols: 4 }), mems = memories(S, 'cloud2', () => [...ARMS.map((x) => x[0]), 'cloud.va', 'cloud.vb', 'cloud.pos'], { say: toast }); S.memRows = [...(S.memRows || []), mems];
  const name = h('button', { type: 'button', class: 'srcpick', title: 'Choose the stem it is made from', onclick: () => choose() }), stems = S.song.stems.filter((s) => s.cells.filter(Boolean).length > 2);
  const hear = () => { const id = 'aud' + Math.random(); voice.noteOn(id, 60, 0.8); setTimeout(() => voice.noteOff(id), 700); }, use = async (t) => { const [x, y] = loudestCells(t, 2); view(0, 1, 'ui'); await S.setCloudSource(t.id, x, y); };
  const choose = () => { buzz(6); pickStem(S, { title: 'Cloud: made from', current: () => S.cloudSrc?.stemId, pick: use, hear, surprise: () => use(stems[Math.floor(Math.random() * stems.length)]) }); };
  S.cloud.changed = () => { name.replaceChildren(h('span', {}, S.cloudSrc?.rec ? (S.cloudSrc.name || 'your recording') : S.song.stems.find((s) => s.id === S.cloudSrc?.stemId)?.name || ''), h('i', {}, '▾')); pkKey = ''; showBars(); };
  const micB = recButton(S, { onDone: (src) => { view(0, 1, 'ui'); S.useCloudSource(src, { rec: src.rec }); }, say: toast, label: 'Rec', cls: 'chip sm' });
  const sw = (path, label) => { const x = h('button', { type: 'button', class: 'chip sm', onclick: () => { P.set(path, !P.get(path)); buzz(6); } }, label), s = () => x.setAttribute('aria-pressed', !!P.get(path)); P.on(({ path: p }) => p === path && s()); s(); return x; };
  const upB = h('button', { type: 'button', class: 'chip sm', title: 'What up and down on the wave changes', onclick: () => { const k = Object.keys(UP); P.set('cloud.up', k[(k.indexOf(P.get('cloud.up')) + 1) % k.length], { by: 'ui' }); showUp(); buzz(6); } }), showUp = () => { upB.textContent = `↕ ${(UP[P.get('cloud.up')] || UP.pitch)[0]}`; }; P.on(({ path }) => path === 'cloud.up' && showUp()); showUp();
  const tabs = h('div', { class: 'seg views' }, ...[['chars', 'Characters'], ['controls', 'Controls']].map(([k, l]) => { const b = h('button', { type: 'button', onclick: () => { P.set('pocket.cview', k, { by: 'ui' }); buzz(6); } }, l); b.dataset.v = k; return b; }));
  const one1 = h('div', { class: 'cdeck' }, h('div', { class: 'chars' }, ...charB), h('div', { class: 'row' }, mems, h('span', { class: 'sp' }), sw('cloud.drone', 'Drone'), sw('cloud.freeze', 'Freeze'))), two2 = h('div', { class: 'cdeck big' }, tiles);
  const showView = () => { const c2 = P.get('pocket.cview') === 'controls'; one1.hidden = c2; two2.hidden = !c2; tabs.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', (b.dataset.v === 'controls') === c2)); }; P.on(({ path }) => path === 'pocket.cview' && showView());
  room.append(h('div', { class: 'head row' }, h('h2', {}, 'Cloud'), h('span', { class: 'sp' }), name, micB), surf, over, tabs, one1, two2); showView();
  const tags = h('div', { class: 'wtags' }, barB, upB); for (const t of ['pointerdown', 'pointermove', 'pointerup']) tags.addEventListener(t, (e) => e.stopPropagation()); surf.append(tags);

  let peaks = null, whole = null, pkKey = '', wKey = '', scatterT = 0;
  const wave = (q, G, W, H, k, f, s) => { const n = q.length / 2, mid = H / 2; G.beginPath(); for (let i = 0; i < n; i++) G.lineTo((i / n) * W, mid - q[2 * i + 1] * k); for (let i = n - 1; i >= 0; i--) G.lineTo((i / n) * W, mid - q[2 * i] * k + 1); G.closePath(); G.fillStyle = f; G.fill(); if (s) { G.strokeStyle = s; G.lineWidth = 0.8; G.stroke(); } };
  S.rooms.cloud = {
    tilt: (x, y) => { tiltSet('cloud.scan', Math.abs(x) < 0.25 ? 0 : (x - Math.sign(x) * 0.25) * 0.7, 0.04); void y; },
    shake: () => { const k = Object.keys(CHARS).filter((n) => n !== now); become(k[Math.floor(Math.random() * k.length)]); toast(now); void scatterT; },
    draw: () => {
      if (!two2.hidden) tiles.draw(); const { W, H } = C, src = S.cloud.src, A = a(), s = span(); if (!W) return; g.clearRect(0, 0, W, H);
      const key = `${A}:${s}:${W}:${src?.stemId}:${src?.fromCell}:${src?.dur}`; if (src && key !== pkKey) { pkKey = key; peaks = zoomPeaks(src, A, A + s, Math.floor(W / 1.5)); }
      if (peaks) wave(peaks, g, W, H, H * 0.44, '#ece8dc2c', '#ece8dc55');
      const v = voice.view || {}, X = (p) => ((p - A) / s) * W, pos = v.pos ?? P.get('cloud.pos'), sp = P.get('cloud.spread') / s; g.fillStyle = '#e6b4501c'; g.fillRect(X(pos) - sp * W, 0, Math.max(2, sp * 2 * W), H); g.fillStyle = '#e6b450'; g.fillRect(X(pos) - 1, 0, 2, H);
      for (const x of v.grains || []) ghost.push([X(x), H * (0.1 + Math.random() * 0.8), 1]); ghost = ghost.filter((q) => (q[2] -= 0.05) > 0).slice(-140); const sz = P.get('cloud.size'); for (const [x, y, l] of ghost) { if (x < -20 || x > W + 20) continue; g.globalAlpha = l * 0.8; g.fillStyle = '#e6b450'; g.beginPath(); g.arc(x, y, 1.4 + sz * 6, 0, 7); g.fill(); } g.globalAlpha = 1;
      if (last) { g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.beginPath(); g.arc(last.x, last.y, 24, 0, 7); g.stroke(); }
      g.font = '10px "IBM Plex Mono", monospace'; g.textBaseline = 'top'; g.textAlign = 'left'; g.fillStyle = two ? '#e6b450' : '#c3c4c8'; g.fillText(`BUFFER ${ms(s * (src?.dur || 16))}`, 9, 8); const [un, up] = UP[P.get('cloud.up')] || UP.pitch, arm = ARMS.find((x) => x[0] === up), lab = `↕ ${un} ${arm ? arm[2](P.get(up)) : ''}`; if (upB.textContent !== lab) upB.textContent = lab;
      // the whole sound
      const w2 = O.W, h2 = O.H; if (!w2) return; og.clearRect(0, 0, w2, h2); const wk = `${src?.stemId}:${src?.fromCell}:${src?.dur}:${w2}`; if (src && wk !== wKey) { wKey = wk; whole = zoomPeaks(src, 0, 1, Math.floor(w2 / 1.5)); } if (whole) wave(whole, og, w2, h2, h2 * 0.42, '#ece8dc40'); const x0 = A * w2, x1 = (A + s) * w2; og.fillStyle = '#0b0d12b0'; og.fillRect(0, 0, x0, h2); og.fillRect(x1, 0, w2 - x1, h2); og.fillStyle = '#e6b45022'; og.fillRect(x0, 0, Math.max(2, x1 - x0), h2); og.strokeStyle = '#e6b450'; og.lineWidth = 1.5; og.strokeRect(x0 + 0.5, 0.75, Math.max(2, x1 - x0 - 1), h2 - 1.5); for (const x of [Math.max(0, x0 - 5), Math.min(w2 - 10, x1 - 5)]) { og.fillStyle = '#e6b450'; og.beginPath(); og.roundRect(x, h2 / 2 - 11, 10, 22, 4); og.fill(); } og.fillStyle = '#fff'; og.fillRect(pos * w2 - 0.5, 0, 1, h2);
    },
  };
  S.cloudRoom = { become, ARMS, rate };
}
