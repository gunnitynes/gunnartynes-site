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

// ------------------------------------------------------------------------------------------------ motion that goes on
/** A finger's path, kept and played round in time with the song (or the clock, when nothing plays). */
export class MotionLoop {
  constructor(S) { this.S = S; this.pts = null; this.len = 4; }
  beat() { const p = this.S.player; return p.playing ? p.beatNow() : (performance.now() / 1000) / this.S.song.beatDur; }
  start(x, y) { this.rec = [[0, x, y]]; this.t0 = performance.now(); this.pts = null; }
  add(x, y) { this.rec?.push([performance.now() - this.t0, x, y]); }
  /** → true when there was enough of a movement to keep. Its length is the nearest of ½ 1 2 4 8 16 beats. */
  end() {
    const r = this.rec; this.rec = null; if (!r || r.length < 6) return false; const d = r[r.length - 1][0]; if (d < 220) return false;
    const beats = d / 1000 / this.S.player.beatDur; this.len = [0.5, 1, 2, 4, 8, 16].reduce((a, b) => (Math.abs(Math.log(b / beats)) < Math.abs(Math.log(a / beats)) ? b : a));
    this.pts = r.map(([t, x, y]) => [t / d, x, y]); this.b0 = this.beat(); return true;
  }
  clear() { this.pts = this.rec = null; }
  now() { if (!this.pts) return null; const u = (((this.beat() - this.b0) / this.len) % 1 + 1) % 1, p = this.pts; let i = 1; while (i < p.length - 1 && p[i][0] < u) i++; const a = p[i - 1], b = p[i], k = clamp((u - a[0]) / Math.max(1e-6, b[0] - a[0]), 0, 1); let x = a[1] + (b[1] - a[1]) * k, y = a[2] + (b[2] - a[2]) * k;
    // the last tenth leads back to the beginning, so it goes round without a jump
    if (u > 0.9) { const e = (u - 0.9) / 0.1, s = e * e * (3 - 2 * e); x += (p[0][1] - x) * s; y += (p[0][2] - y) * s; } return [x, y]; }
}
// ------------------------------------------------------------------------------------------------ faders you draw across
/** arms() → [[path, name, say(v), min, max]]. One finger on a fader moves it; slid sideways it draws across them all. */
export function faderField(S, arms, { rows = 1, color = () => '#e6b450' } = {}) {
  const P = S.params, el = h('div', { class: 'faders', style: { '--rows': rows } }), C = surface(el), g = C.g, f = new Map(); let word = null, wt = 0, tap = [0, -1];
  const geo = () => { const n = Math.ceil(arms().length / rows); return { n, cw: C.W / n, rh: C.H / rows }; };
  const val = ([p, , , a = 0, b = 1]) => clamp(((P.get(p) ?? a) - a) / (b - a), 0, 1);
  const put = (i, u) => { const A = arms()[i]; if (!A) return; const [p, nm, say, a = 0, b = 1, step] = A; let v = a + clamp(u, 0, 1) * (b - a); if (a < 0 && Math.abs(v) < (b - a) * 0.025) v = 0; v = step ? Math.round(v / step) * step : r3(v); if (P.get(p) !== v) P.set(p, v); word = [nm, say(v), i]; wt = performance.now(); };
  const at = (e) => { const r = el.getBoundingClientRect(), { n, cw, rh } = geo(), x = e.clientX - r.left, y = e.clientY - r.top, row = clamp(Math.floor(y / rh), 0, rows - 1); return { x, y, i: clamp(Math.floor(x / cw), 0, n - 1) + row * n, row, u: 1 - (y - row * rh - 13) / (rh - 30) }; };
  el.addEventListener('pointerdown', (e) => { if (!C.W) return; e.preventDefault(); try { el.setPointerCapture(e.pointerId); } catch { /* fine */ } const q = at(e), n = performance.now(); if (q.i === tap[1] && n - tap[0] < 280) { const A = arms()[q.i]; if (A) { P.reset(A[0]); word = [A[1], A[2](P.get(A[0])), q.i]; wt = n; buzz(14); } tap = [0, -1]; return; } tap = [n, q.i]; f.set(e.pointerId, { ...q }); put(q.i, q.u); buzz(4); });
  el.addEventListener('pointermove', (e) => { const l = f.get(e.pointerId); if (!l) return; const r = el.getBoundingClientRect(), { n, rh } = geo(), x = e.clientX - r.left, y = clamp(e.clientY - r.top, l.row * rh, (l.row + 1) * rh), i = clamp(Math.floor(x / geo().cw), 0, n - 1) + l.row * n, u = 1 - (y - l.row * rh - 13) / (rh - 30); if (Math.abs(u - l.u) > 0.04 || i !== l.i) tap[1] = -1; const s = Math.sign(i - l.i); for (let k = l.i + s; s && k !== i; k += s) put(k, l.u + ((u - l.u) * (k - l.i)) / (i - l.i)); put(i, u); l.i = i; l.u = u; });
  for (const t of ['pointerup', 'pointercancel']) el.addEventListener(t, (e) => f.delete(e.pointerId)); el.addEventListener('contextmenu', (e) => e.preventDefault());
  el.draw = () => {
    if (!C.W) return; const { n, cw, rh } = geo(), A = arms(), now = performance.now(), col = color(), live = word && now - wt < 900; g.clearRect(0, 0, C.W, C.H); g.textAlign = 'center'; g.textBaseline = 'middle';
    A.forEach((a, i) => { const x = (i % n) * cw, y = Math.floor(i / n) * rh, h0 = rh - 30, v = val(a), on = live && word[2] === i, bi = (a[3] ?? 0) < 0; g.fillStyle = '#ffffff0b'; g.beginPath(); g.roundRect(x + 2.5, y + 13, cw - 5, h0, 5); g.fill(); g.fillStyle = on ? col : col + '99'; const top = y + 13 + (1 - v) * h0, mid = y + 13 + h0 / 2; g.beginPath(); if (bi) g.roundRect(x + 2.5, Math.min(top, mid), cw - 5, Math.max(2, Math.abs(top - mid)), 3); else g.roundRect(x + 2.5, top, cw - 5, Math.max(2, v * h0), 5); g.fill(); g.fillStyle = '#fff'; g.fillRect(x + 4, clamp(top - 1, y + 13, y + 11 + h0), cw - 8, 2); g.font = '500 8.6px "IBM Plex Mono", monospace'; g.fillStyle = on ? '#fff' : '#a9adb6'; g.fillText(a[1].toUpperCase(), x + cw / 2, y + rh - 8, cw - 2); if (on) { g.font = '9.5px "IBM Plex Mono", monospace'; g.fillText(word[1], clamp(x + cw / 2, 22, C.W - 22), y + 6); } });
  };
  return el;
}
// ------------------------------------------------------------------------------------------------ the morph pad
/** Four sounds in four corners and a finger between them. corners() → [[name, values in arms order] ×4]; hold a corner to
 *  keep the sound as it is there. loop() → is a movement to go on by itself when the finger lifts. */
export function morphPad(S, { arms, corners, key, color, loop, say }) {
  const P = S.params, el = h('div', { class: 'morph' }), C = surface(el), g = C.g, M = new Map(), L = (k = key()) => { if (!M.has(k)) M.set(k, { p: null, ml: new MotionLoop(S), from: null }); return M.get(k); };
  const store = () => ((S.mem ??= {})['morph.' + key()] ??= corners().map(([n, v]) => ({ n, v: [...v] })));
  let down = null, hold = 0, flash = [0, -1], last = 0;
  const apply = (x, y, quick) => { const now = performance.now(); if (!quick && now - last < 35) return; last = now; const cs = store(), w = [(1 - x) * (1 - y), x * (1 - y), (1 - x) * y, x * y], st = L(), k = st.from ? clamp((now - st.t) / 260, 0, 1) : 1; arms().forEach(([p, , , a = 0, b = 1], i) => { let v = 0; for (let c = 0; c < 4; c++) v += w[c] * (cs[c].v[i] ?? 0); if (st.from) v = st.from[i] + (v - st.from[i]) * k; v = r3(a + clamp(v, 0, 1) * (b - a)); if (Math.abs((P.get(p) ?? 0) - v) > 0.004) P.set(p, v); }); if (k === 1) st.from = null; };
  const cur = () => arms().map(([p, , , a = 0, b = 1]) => clamp(((P.get(p) ?? a) - a) / (b - a), 0, 1));
  const xy = (e) => { const r = el.getBoundingClientRect(); return [clamp((e.clientX - r.left - 14) / (r.width - 28), 0, 1), clamp((e.clientY - r.top - 14) / (r.height - 28), 0, 1)]; };
  el.addEventListener('pointerdown', (e) => { if (down || !C.W) return; e.preventDefault(); try { el.setPointerCapture(e.pointerId); } catch { /* fine */ } const [x, y] = xy(e), st = L(), c = (x > 0.78 ? 1 : x < 0.22 ? 0 : -1) < 0 || (y > 0.3 && y < 0.7) ? -1 : (x > 0.5 ? 1 : 0) + (y > 0.5 ? 2 : 0);
    down = { id: e.pointerId, x, y, moved: false, c }; st.from = cur(); st.t = performance.now(); st.ml.clear(); st.ml.start(x, y); if (c >= 0) hold = setTimeout(() => { if (!down || down.moved) return; down.kept = true; st.from = null; store()[c].v = down.vals; store()[c].n = 'yours'; flash = [performance.now(), c]; buzz([20, 30, 20]); say?.('This sound is in that corner now'); }, 620); down.vals = [...st.from]; st.p = [x, y]; if (c < 0) apply(x, y); buzz(5); });
  el.addEventListener('pointermove', (e) => { if (down?.id !== e.pointerId || down.kept) return; const [x, y] = xy(e); if (!down.moved && Math.hypot(x - down.x, y - down.y) > 0.035) { down.moved = true; clearTimeout(hold); } const st = L(); st.p = [x, y]; st.ml.add(x, y); if (down.moved || down.c < 0) apply(x, y); });
  const up = (e) => { if (down?.id !== e.pointerId) return; clearTimeout(hold); const st = L(), d = down; down = null; if (d.kept) { st.p = [d.c % 2, d.c > 1 ? 1 : 0]; st.ml.clear(); return; } if (loop?.() && d.moved) { if (st.ml.end()) { buzz(12); say?.(`It goes round by itself · ${st.ml.len} beat${st.ml.len === 1 ? '' : 's'}`); } } else st.ml.clear(); };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('contextmenu', (e) => e.preventDefault());
  /** Four new corners: variations around what each was. */
  el.shuffle = () => { for (const c of store()) { c.v = c.v.map((v) => clamp(v + (Math.random() - 0.5) * 0.9, 0.02, 1)); c.n = ['odd', 'raw', 'thin', 'wide', 'slow', 'blur', 'sharp', 'far', 'bent', 'soft'][Math.floor(Math.random() * 10)]; } const st = L(); st.p ??= [0.5, 0.5]; st.from = cur(); st.t = performance.now(); apply(...st.p, true); };
  el.tick = () => { const st = L(), q = !down && st.ml.now(); if (q) { st.p = q; apply(...q); } else if (st.from && st.p && !down?.kept && (!down || down.moved || down.c < 0)) apply(...st.p); else if (st.from && down && !down.moved && down.c >= 0 && performance.now() - st.t > 170 && performance.now() - st.t < 560) apply(...st.p); };
  el.draw = () => {
    if (!C.W) return; const { W, H } = C, col = color(), cs = store(), st = L(), now = performance.now(), px = (u) => 14 + u * (W - 28), py = (v) => 14 + v * (H - 28); g.clearRect(0, 0, W, H);
    const [x, y] = st.p || [0.5, 0.5], w = [(1 - x) * (1 - y), x * (1 - y), (1 - x) * y, x * y];
    // each corner a colour; the field between them is what you hear
    const hue = ['#e6b450', '#9cc2f4', '#df8a74', '#8fd3c5']; for (let c = 0; c < 4; c++) { const cx = c % 2 ? W : 0, cy = c > 1 ? H : 0, gr = g.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(W, H) * 0.72); gr.addColorStop(0, hue[c] + (st.p ? Math.round(34 + w[c] * 110).toString(16).padStart(2, '0') : '30')); gr.addColorStop(1, 'transparent'); g.fillStyle = gr; g.fillRect(0, 0, W, H); }
    g.strokeStyle = '#ffffff10'; g.lineWidth = 1; for (let i = 1; i < 6; i++) { g.beginPath(); g.moveTo((W * i) / 6, 0); g.lineTo((W * i) / 6, H); g.stroke(); } for (let i = 1; i < 3; i++) { g.beginPath(); g.moveTo(0, (H * i) / 3); g.lineTo(W, (H * i) / 3); g.stroke(); }
    g.textBaseline = 'middle'; for (let c = 0; c < 4; c++) { const r = c % 2, b = c > 1, k = flash[1] === c ? clamp(1 - (now - flash[0]) / 700, 0, 1) : 0; g.textAlign = r ? 'right' : 'left'; g.font = `italic ${16 + k * 5}px Newsreader, serif`; g.fillStyle = k ? '#fff' : hue[c]; g.fillText(cs[c].n, r ? W - 12 : 12, b ? H - 16 : 17); // the corner's sound, as a little profile
      const vs = cs[c].v, bw = 4; vs.forEach((v, i) => { g.globalAlpha = 0.5; g.fillStyle = hue[c]; const bx = r ? W - 12 - (vs.length - i) * bw : 12 + i * bw, hh = 2 + v * 15; g.fillRect(bx, b ? H - 30 - hh : 30, bw - 1, hh); }); g.globalAlpha = 1; }
    if (st.ml.pts) { g.strokeStyle = col; g.globalAlpha = 0.65; g.lineWidth = 1.5; g.setLineDash([4, 4]); g.beginPath(); st.ml.pts.forEach(([, u, v], i) => (i ? g.lineTo(px(u), py(v)) : g.moveTo(px(u), py(v)))); g.stroke(); g.setLineDash([]); g.globalAlpha = 1; }
    if (st.p) { g.fillStyle = '#fff'; g.shadowColor = col; g.shadowBlur = 22; g.beginPath(); g.arc(px(x), py(y), down ? 15 : 11, 0, 7); g.fill(); g.shadowBlur = 0; } else { g.textAlign = 'center'; g.font = 'italic 16px Newsreader, serif'; g.fillStyle = '#d6d2c6'; g.fillText('slide between four sounds', W / 2, H / 2); }
  };
  return el;
}
