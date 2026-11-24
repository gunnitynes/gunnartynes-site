// Cloud: the sound under your fingers. One finger plays it (across: where, up: bigger grains, flatter on the glass:
// more spray). Two fingers hold the sound itself: pinch to zoom the buffer, from half a minute down to a few
// thousandths of a second; move them to travel through it; up and down for more or fewer grains; twist for pitch.
import { h, $ } from '../lib/util.js';
import { clamp, r3, buzz, surface, gestures, memories, zoomPeaks } from './phone-kit.js';
import { loudestCells, loadSource } from './core.js';
import { recButton } from './voice.js';

export function buildCloudPage(S, U) {
  const room = $('#p-cloud'), P = S.params, voice = S.cloud.voice, { toast, tiltSet } = U;
  P.define('cloud.va', 0); P.define('cloud.vb', 1); P.define('cloud.spray', 0.16);
  Object.assign(P.range, { 'cloud.va': [0, 1, 'Buffer from'], 'cloud.vb': [0, 1, 'Buffer to'], 'cloud.density': [0, 1, 'Grains'] });
  const a = () => P.get('cloud.va'), b = () => P.get('cloud.vb'), span = () => Math.max(1e-5, b() - a());
  const spread = () => { const v = r5(clamp((P.get('cloud.spray') * span()) / 2, 0, 0.5)); if (v !== P.get('cloud.spread')) P.set('cloud.spread', v); };
  const r5 = (v) => Math.round(v * 1e5) / 1e5;
  const view = (x, y, by = 'user') => { x = clamp(x, 0, 1 - 1e-5); y = clamp(y, x + 1e-5, 1); P.set('cloud.va', r5(x), { by }); P.set('cloud.vb', r5(y), { by }); spread(); const p = P.get('cloud.pos'); if (p < x || p > y) P.set('cloud.pos', r5(clamp(p, x, y))); };

  const surf = h('div', { class: 'surface' }), C = surface(surf), g = C.g;
  const hint = h('div', { class: 'surf-hint' }, h('b', {}, 'One finger plays, two hold the sound'), h('span', {}, 'pinch: zoom the buffer · twist: pitch')); surf.append(hint);
  let sounding = false, size0 = 0, last = null, ghost = [], out = 1, loading = false, twist0 = 0, twoNow = null;
  const sound = (on) => { if (on === sounding) return; sounding = on; if (P.get('cloud.drone')) return; if (on) { voice.noteOn('touch', 60, 0.85); S.seq.noteIn(0, 60, 0.85, true); } else { voice.noteOff('touch'); S.seq.noteIn(0, 60, 0, false); } };
  const one = (p) => {
    if (!C.W) return;
    P.set('cloud.pos', r5(a() + clamp(p.x / C.W, 0, 1) * span())); P.set('cloud.size', r3(clamp(1 - p.y / C.H, 0.02, 1)));
    if (size0 > 2 && p.w > 2) { const k = clamp((p.w / size0 - 1.25) * 0.9, 0, 1); if (k > 0.02 || one.k) { one.k = k; P.set('cloud.spray', r3(clamp(0.16 + k * 0.84, 0, 1))); spread(); } }
  };
  /** Pinched out past all of it: take in more of the song around it (up to four blocks, half a minute). */
  async function wider() {
    const c = S.cloudSrc; if (loading || !c || c.rec) return; const st = S.song.stems.find((x) => x.id === c.stemId), n = c.b - c.a, N = st.cells.length, want = Math.min(4, n * 2); if (want <= n) return;
    loading = true; const na = clamp(Math.round((c.a + c.b) / 2 - want / 2), 0, Math.max(0, N - want)), nb = Math.min(N, na + want), ref = { stemId: c.stemId, a: na, b: nb }, p = P.get('cloud.pos'), k = (v) => (c.a - na + v * n) / (nb - na), va = k(0), vb = k(1);
    try { S.useCloudSource(await loadSource(S, ref.stemId, na, nb), ref, false); view(va, vb, 'ui'); P.set('cloud.pos', r5(k(p)), { by: 'load' }); buzz(20); toast(`Buffer: ${want * 4} bars`); } catch { /* as it was */ } loading = false;
  }
  gestures(surf, {
    down: (p) => { hint.classList.add('gone'); size0 = p.w; one.k = 0; last = p; sound(true); one(p); },
    move: (p) => { last = p; one(p); },
    up: () => { sound(false); last = null; if (one.k) { P.set('cloud.spray', 0.16); spread(); one.k = 0; } },
    twoStart: () => { hint.classList.add('gone'); last = null; sound(true); out = 1; twist0 = P.get('cloud.pitch'); twoNow = { x: 0, y: 0 }; },
    two: (e) => {
      if (!C.W) return; twoNow = e; const s = span(), at = a() + (e.x / C.W) * s, dur = S.cloud.src?.dur || 16, min = Math.min(1, 0.006 / dur), ns = clamp(s / e.ds, min, 1);
      if (s >= 0.9999 && e.ds < 1) { out *= e.ds; if (out < 0.72) { out = 1; wider(); } }
      let x = at - (e.x / C.W) * ns - (e.dx / C.W) * ns; x = clamp(x, 0, 1 - ns); view(x, x + ns); P.set('cloud.pos', r5(clamp(a() + (e.x / C.W) * span(), 0, 1)));
      P.set('cloud.density', r3(clamp(P.get('cloud.density') - (e.dy / C.H) * 1.1, 0, 1)));
      const st = Math.round(e.a / (Math.PI / 12)); if (Math.abs(e.a) > 0.2) { const v = clamp(twist0 + st, -24, 24); if (v !== P.get('cloud.pitch')) { P.set('cloud.pitch', v); buzz(6); } }
    },
    twoEnd: () => { sound(false); twoNow = null; }, allUp: () => { sound(false); twoNow = null; },
  });
  // double tap: it keeps sounding (the drone)
  let tapT = 0, tapXY = null; surf.addEventListener('pointerup', (e) => { const n = performance.now(); if (tapXY && n - tapT < 300 && Math.hypot(e.clientX - tapXY[0], e.clientY - tapXY[1]) < 24) { P.set('cloud.drone', !P.get('cloud.drone')); buzz(18); toast(P.get('cloud.drone') ? 'It goes on by itself · double tap to stop' : 'Stopped'); tapT = 0; return; } tapT = n; tapXY = [e.clientX, e.clientY]; });

  const name = h('span', { class: 'src' }), stems = S.song.stems.filter((s) => s.cells.filter(Boolean).length > 2);
  const next = async (d) => { const i = stems.findIndex((s) => s.id === S.cloudSrc?.stemId), st = stems[(i + d + stems.length) % stems.length]; name.textContent = '…'; const [x, y] = loudestCells(st, 2); view(0, 1, 'ui'); await S.setCloudSource(st.id, x, y); buzz(6); };
  S.cloud.changed = () => { name.textContent = S.cloudSrc?.rec ? 'your recording' : S.song.stems.find((s) => s.id === S.cloudSrc?.stemId)?.name || ''; peaks = null; };
  const micB = recButton(S, { onDone: (src) => { view(0, 1, 'ui'); S.useCloudSource(src, { rec: src.rec }); }, say: toast, cls: 'chip' });
  const sw = (path, label) => { const x = h('button', { type: 'button', class: 'sw', onclick: () => { P.set(path, !P.get(path)); buzz(6); } }, h('i'), label), s = () => x.setAttribute('aria-pressed', !!P.get(path)); P.on(({ path: p }) => p === path && s()); s(); return x; };
  const mems = memories(S, 'cloud', () => ['va', 'vb', 'pos', 'size', 'density', 'spray', 'spread', 'pitch', 'jitter', 'reverse', 'scan', 'shape', 'attack', 'release'].map((k) => 'cloud.' + k), { say: toast });
  S.memRows = [...(S.memRows || []), mems];
  const revB = h('button', { type: 'button', class: 'sw', onclick: () => { P.set('cloud.reverse', P.get('cloud.reverse') > 0.5 ? 0 : 1); buzz(6); } }, h('i'), 'Reverse'); const showRev = () => revB.setAttribute('aria-pressed', P.get('cloud.reverse') > 0.5); P.on(({ path }) => path === 'cloud.reverse' && showRev()); showRev();
  room.append(
    h('div', { class: 'head row' }, h('h2', {}, 'Cloud'), h('span', { class: 'sp' }), h('button', { type: 'button', class: 'chip sq', 'aria-label': 'Previous stem', onclick: () => next(-1) }, '‹'), name, h('button', { type: 'button', class: 'chip sq', 'aria-label': 'Next stem', onclick: () => next(1) }, '›')),
    surf, h('div', { class: 'row' }, sw('cloud.drone', 'Drone'), sw('cloud.freeze', 'Freeze'), revB), h('div', { class: 'row' }, mems, h('span', { class: 'sp' }), micB));

  let peaks = null, pkKey = '', scatterT = 0;
  const ms = (s) => (s < 0.1 ? `${(s * 1000).toFixed(s < 0.01 ? 1 : 0)} ms` : s < 10 ? `${s.toFixed(2)} s` : `${s.toFixed(0)} s`);
  S.rooms.cloud = {
    tilt: (x, y) => { tiltSet('cloud.scan', Math.abs(x) < 0.18 ? 0 : (x - Math.sign(x) * 0.18) * 0.8, 0.02); if (!sounding) { tiltSet('cloud.spray', clamp(0.16 + Math.max(0, y) * 0.84, 0, 1), 0.02); spread(); } },
    shake: () => { P.set('cloud.jitter', 12); clearInterval(scatterT); scatterT = setInterval(() => { const v = P.get('cloud.jitter') * 0.82; if (v < 0.3) { clearInterval(scatterT); P.set('cloud.jitter', 0); } else P.set('cloud.jitter', +v.toFixed(2)); }, 120); toast('Scattered'); },
    draw: () => {
      const { W, H } = C; if (!W) return; g.clearRect(0, 0, W, H); const src = S.cloud.src, A = a(), s = span(), mid = H / 2, key = `${A}:${s}:${W}:${src?.stemId}:${src?.fromCell}`;
      if (src && key !== pkKey) { pkKey = key; peaks = zoomPeaks(src, A, A + s, Math.floor(W / 1.5)); }
      if (src) for (let i = 1; i < 8; i++) { g.fillStyle = '#ffffff0a'; g.fillRect((W * i) / 8, 0, 1, H); }
      if (peaks) { const n = peaks.length / 2, k = H * 0.44; g.beginPath(); for (let i = 0; i < n; i++) g.lineTo((i / n) * W, mid - peaks[2 * i + 1] * k); for (let i = n - 1; i >= 0; i--) g.lineTo((i / n) * W, mid - peaks[2 * i] * k + 1); g.closePath(); g.fillStyle = '#ece8dc2c'; g.fill(); g.strokeStyle = '#ece8dc55'; g.lineWidth = 0.8; g.stroke(); }
      const v = voice.view || {}, X = (p) => ((p - A) / s) * W, pos = v.pos ?? P.get('cloud.pos'), sp = P.get('cloud.spread') / s;
      g.fillStyle = '#e6b4501c'; g.fillRect(X(pos) - sp * W, 0, Math.max(2, sp * 2 * W), H); g.fillStyle = '#e6b450'; g.fillRect(X(pos) - 1, 0, 2, H);
      const sz = P.get('cloud.size'); for (const x of v.grains || []) ghost.push([X(x), H * (0.14 + Math.random() * 0.72), 1]); ghost = ghost.filter((q) => (q[2] -= 0.045) > 0).slice(-160);
      for (const [x, y, l] of ghost) { if (x < -20 || x > W + 20) continue; g.globalAlpha = l * 0.8; g.fillStyle = '#e6b450'; g.beginPath(); g.arc(x, y, 1.5 + sz * 7 * (1 - l * 0.4), 0, 7); g.fill(); } g.globalAlpha = 1;
      if (last) { g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.beginPath(); g.arc(last.x, last.y, 26 + (one.k || 0) * 44, 0, 7); g.stroke(); }
      // what two fingers hold, written where they are not
      g.font = '10.5px "IBM Plex Mono", monospace'; g.textBaseline = 'top'; const dur = src?.dur || 16, p = P.get('cloud.pitch'), txt = [['BUFFER', ms(s * dur)], ['GRAINS', `${Math.round(1 + 119 * P.get('cloud.density') ** 1.6)}/s`], ['SIZE', ms((10 + 990 * sz ** 2) / 1000)], ['PITCH', `${p > 0 ? '+' : ''}${p % 1 ? p.toFixed(1) : p}`]];
      txt.forEach(([k, val], i) => { const x = 12 + (i * (W - 16)) / 4; g.fillStyle = '#7f8694'; g.textAlign = 'left'; g.fillText(k, x, 11); g.fillStyle = twoNow ? '#e6b450' : '#ece8dc'; g.fillText(val, x, 25); });
      // where the window is in the whole buffer
      g.fillStyle = '#ffffff18'; g.fillRect(10, H - 8, W - 20, 3); g.fillStyle = '#e6b450'; g.fillRect(10 + A * (W - 20), H - 8, Math.max(3, s * (W - 20)), 3);
    },
  };
}
