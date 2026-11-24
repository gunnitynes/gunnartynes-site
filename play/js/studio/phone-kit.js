// What the phone pages share: multi-touch gestures, a canvas that fits its box, and memories you glide between.
import { h } from '../lib/util.js';
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const r3 = (v) => Math.round(v * 1000) / 1000;
export const buzz = (ms = 8) => { try { navigator.vibrate?.(ms); } catch { /* none */ } };
export const COLORS = ['#e6b450', '#9cc2f4', '#8fd3c5'];
export const NAMES = ['Cloud', 'Sound 1', 'Sound 2'];
export const NOTE = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

/** A canvas filling a box, sharp on any screen. → { cv, g, W, H } (W and H follow the box). */
export function surface(box) {
  const cv = h('canvas'), o = { cv, g: cv.getContext('2d'), W: 0, H: 0, on: null }; box.append(cv);
  new ResizeObserver(() => { const r = box.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1); if (!r.width) return; o.W = r.width; o.H = r.height; cv.width = r.width * d; cv.height = r.height * d; cv.style.width = r.width + 'px'; cv.style.height = r.height + 'px'; o.g.setTransform(d, 0, 0, d, 0, 0); o.on?.(); }).observe(box);
  return o;
}
/**
 * Fingers on an element. One finger: down / move / up. Two: twoStart / two / twoEnd, with what they do since the
 * last event (ds scale, da angle, dx, dy of the middle) and since they landed (s, a, x, y). Once a second finger
 * has come down, it stays a two-finger gesture until every finger is lifted.
 */
export function gestures(el, cb) {
  const pts = new Map(); let T = null, multi = false;
  const at = (e) => { const r = el.getBoundingClientRect(); return { id: e.pointerId, x: e.clientX - r.left, y: e.clientY - r.top, w: Math.max(e.width || 0, e.height || 0), t: performance.now() }; };
  const pair = () => { const [a, b] = [...pts.values()]; return { d: Math.max(24, Math.hypot(b.x - a.x, b.y - a.y)), a: Math.atan2(b.y - a.y, b.x - a.x), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
  el.addEventListener('pointerdown', (e) => {
    if (pts.size >= 2) return; e.preventDefault(); try { el.setPointerCapture(e.pointerId); } catch { /* fine */ }
    const p = at(e); pts.set(e.pointerId, p);
    if (pts.size === 1) { multi = false; cb.down?.(p, e); }
    else { multi = true; const q = pair(); T = { ...q, d0: q.d, x0: q.x, y0: q.y, s: 1, rot: 0 }; cb.twoStart?.(q); }
  });
  el.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return; const p = at(e); pts.set(e.pointerId, p);
    if (!multi) { cb.move?.(p, e); return; }
    if (pts.size < 2) return;
    const q = pair(), da = Math.atan2(Math.sin(q.a - T.a), Math.cos(q.a - T.a)), ev = { ds: q.d / T.d, da, dx: q.x - T.x, dy: q.y - T.y, x: q.x, y: q.y };
    T.rot += da; T.s = q.d / T.d0; Object.assign(T, q); cb.two?.({ ...ev, s: T.s, a: T.rot, tx: q.x - T.x0, ty: q.y - T.y0 });
  });
  const up = (e) => {
    if (!pts.has(e.pointerId)) return; const p = at(e); pts.delete(e.pointerId);
    if (multi) { if (pts.size === 1) cb.twoEnd?.({ s: T.s, a: T.rot }); if (!pts.size) { multi = false; cb.allUp?.(); } } else cb.up?.(p, e);
  };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('contextmenu', (e) => e.preventDefault());
}
/** Four memories of some settings: an empty one keeps what is there, a full one glides back to it, holding one replaces it. */
export function memories(S, key, paths, { say, color = '#e6b450' } = {}) {
  const P = S.params, mem = () => (S.mem ??= {})[(typeof key === 'function' ? key() : key)] ??= [null, null, null, null];
  let anim = 0;
  const take = () => Object.fromEntries(paths().map((p) => [p, P.get(p)]).filter(([, v]) => v !== undefined));
  const glide = (to) => {
    cancelAnimationFrame(anim); const from = take(), t0 = performance.now(); let last = 0;
    for (const [p, v] of Object.entries(to)) if (typeof v !== 'number') P.set(p, v);
    const step = (now) => { const k = Math.min(1, (now - t0) / 800), e = k * k * (3 - 2 * k); if (k === 1 || now - last > 40) { last = now; for (const [p, v] of Object.entries(to)) if (typeof v === 'number' && typeof from[p] === 'number') P.set(p, r3(from[p] + (v - from[p]) * e)); } if (k < 1) anim = requestAnimationFrame(step); };
    anim = requestAnimationFrame(step);
  };
  const row = h('div', { class: 'mems', style: { '--c': color } });
  const bs = [0, 1, 2, 3].map((i) => {
    let timer = 0, held = false; const b = h('button', { type: 'button', class: 'mem', 'aria-label': `Memory ${'ABCD'[i]}` }, 'ABCD'[i]);
    const keep = () => { mem()[i] = take(); show(); buzz(25); say?.(`Kept as ${'ABCD'[i]} · tap to glide back to it`); };
    b.addEventListener('pointerdown', () => { held = false; timer = setTimeout(() => { held = true; keep(); }, 500); });
    for (const t of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(t, () => clearTimeout(timer));
    b.addEventListener('click', () => { if (held) return; mem()[i] ? (glide(mem()[i]), buzz(8)) : keep(); }); b.addEventListener('contextmenu', (e) => e.preventDefault());
    row.append(b); return b;
  });
  const show = () => bs.forEach((b, i) => b.classList.toggle('full', !!mem()[i])); row.show = show; show();
  return row;
}
/** The waveform of a stretch [a,b] (0..1) of a source as n min/max pairs. */
export function zoomPeaks(src, a, b, n) {
  const L = src.L, N = L.length, out = new Float32Array(n * 2), s0 = a * N, w = Math.max(1, ((b - a) * N) / n), st = Math.max(1, Math.floor(w / 40));
  for (let i = 0; i < n; i++) { let lo = 1, hi = -1; for (let j = Math.floor(s0 + i * w), e = Math.max(j + 1, Math.floor(s0 + (i + 1) * w)); j < e; j += st) { const v = L[Math.max(0, Math.min(N - 1, j))]; if (v < lo) lo = v; if (v > hi) hi = v; } out[2 * i] = lo; out[2 * i + 1] = hi; }
  return out;
}

// ------------------------------------------------------------------------------------------------ living in a pool
/** Ways a stem can be changed for as long as it stays somewhere. make(S, st, B) → (want, B) → want, pure in B. */
export const POOLS = [
  ['Hold', (S, st, B0, w0) => { const h0 = w0 && songBar(S, w0); return (w) => (h0 == null ? w : pick(S, st, h0) || w); }],
  ['Reverse', () => (w) => w && { ...w, fx: { s: 1, u: 0, g: 1, ...w.fx, r: 1 } }],
  ['Half', (S, st, B0, w0) => { const s0 = w0 ? songBar(S, w0) : null; return (w, B) => { if (s0 == null) return w; const t = s0 + (B - B0) / 2, b = Math.floor(t), x = pick(S, st, b); return x && { ...x, fx: { r: 0, s: 0.5, u: 0, g: 1, o: t - b } }; }; }],
  ['Stutter', () => (w, B) => w && { ...w, fx: { r: 0, s: 1, g: 1, ...w.fx, u: [8, 8, 4, 16][((B % 4) + 4) % 4] } }],
  ['Wander', (S, st) => { const cb = S.song.barsPerCell, live = []; st.cells.forEach((c, i) => { if (c && c.rms > -44) for (let k = 0; k < cb; k++) live.push(i * cb + k); }); return (w, B) => { if (!live.length) return w; const r = Math.sin(B * 12.9898 + st.id.charCodeAt(0) * 78.233) * 43758.5453; return pick(S, st, live[Math.floor((r - Math.floor(r)) * live.length)]) || w; }; }],
];
export const songBar = (S, w) => w.cell * S.song.barsPerCell + w.bar;
function pick(S, st, b) { const cb = S.song.barsPerCell, N = S.song.numBars; b = ((b % N) + N) % N; const c = Math.floor(b / cb), cell = st.cells[c]; return cell ? { cell: c, bar: b % cb, url: cell.url } : null; }
