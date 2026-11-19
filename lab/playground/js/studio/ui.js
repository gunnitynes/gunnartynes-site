// Small, quiet controls in the site's language: mono labels, thin rules, one amber accent.
import { h } from '../lib/util.js';

/** A horizontal fader bound to a param path. Drag, arrow keys, double-click to reset. */
export function fader(P, path, label, { fmt = (v) => Math.round(v * 100), min = 0, max = 1, step = 0 } = {}) {
  const fill = h('i', { class: 'fill' }), val = h('span', { class: 'val' });
  const el = h('div', { class: 'fader', tabindex: 0, role: 'slider', 'aria-label': label }, h('span', { class: 'lab' }, label), val, h('div', { class: 'track' }, fill));
  const show = () => { const v = P.get(path), k = (v - min) / (max - min); fill.style.width = `${Math.max(0, Math.min(1, k)) * 100}%`; val.textContent = fmt(v); el.setAttribute('aria-valuenow', v); };
  const setK = (k) => { let v = min + Math.max(0, Math.min(1, k)) * (max - min); if (step) v = Math.round(v / step) * step; P.set(path, +v.toFixed(5)); };
  const tr = el.querySelector('.track');
  let drag = false;
  const at = (e) => { const r = tr.getBoundingClientRect(); setK((e.clientX - r.left) / r.width); };
  el.addEventListener('pointerdown', (e) => { drag = true; el.setPointerCapture(e.pointerId); el.classList.add('on'); at(e); });
  el.addEventListener('pointermove', (e) => { if (drag) at(e); });
  el.addEventListener('pointerup', () => { drag = false; el.classList.remove('on'); });
  el.addEventListener('dblclick', () => P.reset(path));
  el.addEventListener('keydown', (e) => { const d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key]; if (!d) return; e.preventDefault(); e.stopPropagation(); setK((P.get(path) - min) / (max - min) + d * (step ? step / (max - min) : 0.02)); });
  P.on(({ path: p }) => { if (p === path) show(); }); show();
  return el;
}

/** A row of choices bound to a param path. */
export function choice(P, path, label, options) {
  const btns = options.map(([v, l]) => h('button', { type: 'button', onclick: () => P.set(path, v) }, l));
  const show = () => btns.forEach((b, i) => b.setAttribute('aria-pressed', options[i][0] === P.get(path)));
  P.on(({ path: p }) => { if (p === path) show(); }); show();
  return h('div', { class: 'choice' }, label ? h('span', { class: 'lab' }, label) : '', h('div', { class: 'seg' }, ...btns));
}
export function toggle(P, path, label) {
  const b = h('button', { type: 'button', class: 'tog', onclick: () => P.set(path, !P.get(path)) }, label);
  const show = () => b.setAttribute('aria-pressed', !!P.get(path));
  P.on(({ path: p }) => { if (p === path) show(); }); show();
  return b;
}
export const panel = (title, ...kids) => h('section', { class: 'panel' }, h('h3', {}, title), ...kids);

/** A waveform of a source with an optional selection; onPick(a,b) when the user drags a region, onPoint(x,y) for XY use. */
export class Wave {
  constructor(el, { select = false, xy = false } = {}) {
    this.cv = h('canvas'); el.append(this.cv); this.g = this.cv.getContext('2d'); this.src = null; this.peaks = null;
    this.sel = select ? [0.2, 0.3] : null; this.xy = xy; this.point = null; this.grains = []; this.pos = null;
    const r = () => { const b = el.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1); this.w = b.width; this.h = b.height; this.cv.width = b.width * d; this.cv.height = b.height * d; this.cv.style.width = b.width + 'px'; this.cv.style.height = b.height + 'px'; this.g.setTransform(d, 0, 0, d, 0, 0); this.peaks = null; };
    new ResizeObserver(r).observe(el); r();
    let down = null;
    const pos = (e) => { const b = this.cv.getBoundingClientRect(); return [Math.max(0, Math.min(1, (e.clientX - b.left) / b.width)), Math.max(0, Math.min(1, 1 - (e.clientY - b.top) / b.height))]; };
    this.cv.addEventListener('pointerdown', (e) => { try { this.cv.setPointerCapture(e.pointerId); } catch { /* synthetic */ } const [x, y] = pos(e); down = x; if (this.sel) { this.sel = [x, x]; } if (this.xy) this.onPoint?.(x, y); });
    this.cv.addEventListener('pointermove', (e) => { if (down === null) return; const [x, y] = pos(e); if (this.sel) this.sel = [down, x]; if (this.xy) this.onPoint?.(x, y); });
    this.cv.addEventListener('pointerup', () => { if (down === null) return; down = null; if (this.sel) { if (Math.abs(this.sel[1] - this.sel[0]) < 0.004) { const c = this.sel[0]; this.sel = [Math.max(0, c - 0.03), Math.min(1, c + 0.03)]; } this.sel.sort((a, b) => a - b); this.onPick?.(...this.sel); } });
  }
  setSource(src) { this.src = src; this.peaks = null; }
  build() {
    const n = Math.max(1, Math.floor(this.w)), L = this.src.L, R = this.src.R, step = L.length / n, pk = new Float32Array(n);
    for (let x = 0; x < n; x++) { let m = 0; for (let i = Math.floor(x * step), e = Math.floor((x + 1) * step); i < e; i += 3) { const a = Math.abs(L[i]) + Math.abs(R[i]); if (a > m) m = a; } pk[x] = m * 0.5; }
    let top = 0; for (const v of pk) top = Math.max(top, v); if (top > 0) for (let x = 0; x < n; x++) pk[x] /= top;
    this.peaks = pk;
  }
  draw(extra) {
    const g = this.g, w = this.w, hh = this.h; g.clearRect(0, 0, w, hh);
    if (!this.src) { g.fillStyle = '#6f747f'; g.font = '12px "IBM Plex Mono", monospace'; g.fillText('choose a source', 12, hh / 2); return; }
    if (!this.peaks) this.build();
    const mid = hh / 2, pk = this.peaks;
    if (this.sel) { const [a, b] = [...this.sel].sort((x, y) => x - y); g.fillStyle = '#e6b4501a'; g.fillRect(a * w, 0, (b - a) * w, hh); g.fillStyle = '#e6b450'; g.fillRect(a * w, 0, 1, hh); g.fillRect(b * w, 0, 1, hh); }
    g.fillStyle = '#ece8dc'; for (let x = 0; x < pk.length; x++) { const v = pk[x] * mid * 0.86, inSel = this.sel && x / w >= Math.min(...this.sel) && x / w <= Math.max(...this.sel); g.globalAlpha = inSel ? 0.95 : 0.42; g.fillRect(x, mid - v, 1, Math.max(1, v * 2)); }
    g.globalAlpha = 1; extra?.(g, w, hh);
  }
}

/** Two octaves of keys plus the computer keyboard (A row) and MIDI. onNote(note, vel, on). */
export class Keys {
  constructor(el, onNote) {
    this.el = el; this.onNote = onNote; this.base = 48; this.down = new Set(); this.lit = new Map();
    this.render();
    const map = 'awsedftgyhujkolp;'.split(''); this.map = map;
    addEventListener('keydown', (e) => {
      if (e.target.closest('input,textarea,select') || e.metaKey || e.ctrlKey || e.repeat) return;
      if (e.key === 'z') { this.shift(-12); return; } if (e.key === 'x') { this.shift(12); return; }
      const i = map.indexOf(e.key.toLowerCase()); if (i < 0) return; e.preventDefault(); this.press(this.base + 12 + i, 0.8, true);
    });
    addEventListener('keyup', (e) => { const i = map.indexOf(e.key.toLowerCase()); if (i >= 0) this.press(this.base + 12 + i, 0, false); });
    addEventListener('blur', () => { for (const n of [...this.down]) this.press(n, 0, false); });
  }
  shift(d) { for (const n of [...this.down]) this.press(n, 0, false); this.base = Math.max(12, Math.min(84, this.base + d)); this.render(); }
  async midi() {
    const acc = await navigator.requestMIDIAccess();
    const hook = (inp) => { inp.onmidimessage = (m) => { const [s, n, v] = m.data, c = s & 0xf0; if (c === 0x90 && v) this.press(n, v / 127, true); else if (c === 0x80 || (c === 0x90 && !v)) this.press(n, 0, false); }; };
    acc.inputs.forEach(hook); acc.onstatechange = () => acc.inputs.forEach(hook);
    return [...acc.inputs.values()].map((i) => i.name);
  }
  press(note, vel, on) {
    if (on) { if (this.down.has(note)) return; this.down.add(note); } else { if (!this.down.has(note)) return; this.down.delete(note); }
    this.onNote(note, vel, on); this.paint();
  }
  flash(note, ms) { this.lit.set(note, performance.now() + ms); this.paint(); setTimeout(() => this.paint(), ms + 20); }
  render() {
    const n = 25, keys = []; const black = [1, 3, 6, 8, 10];
    for (let i = 0; i < n; i++) { const m = this.base + i, b = black.includes(m % 12); keys.push(h('button', { type: 'button', class: b ? 'k b' : 'k', 'data-n': m, tabindex: -1 }, m % 12 === 0 ? h('small', {}, 'C' + (Math.floor(m / 12) - 1)) : '')); }
    const wrap = h('div', { class: 'keys' }, ...keys);
    let held = null;
    wrap.addEventListener('pointerdown', (e) => { const k = e.target.closest('.k'); if (!k) return; wrap.setPointerCapture(e.pointerId); held = +k.dataset.n; this.press(held, 0.75 + (1 - (e.offsetY / k.offsetHeight)) * 0.2, true); });
    wrap.addEventListener('pointermove', (e) => { if (held === null) return; const k = document.elementFromPoint(e.clientX, e.clientY)?.closest('.k'); if (k && +k.dataset.n !== held) { this.press(held, 0, false); held = +k.dataset.n; this.press(held, 0.8, true); } });
    const up = () => { if (held !== null) { this.press(held, 0, false); held = null; } };
    wrap.addEventListener('pointerup', up); wrap.addEventListener('pointercancel', up);
    this.el.replaceChildren(wrap); this.paint();
  }
  paint() { const now = performance.now(); this.el.querySelectorAll('.k').forEach((k) => { const n = +k.dataset.n; k.classList.toggle('on', this.down.has(n) || (this.lit.get(n) || 0) > now); }); }
}

/** A ring knob bound to a param path: drag up/down (Shift for fine), wheel, arrows; double-click resets. */
export function knob(P, path, label, { min = 0, max = 1, step = 0, fmt = (v) => Math.round(((v - min) / (max - min)) * 100), bipolar = false } = {}) {
  const NS = 'http://www.w3.org/2000/svg', R = 15, C = 20;
  const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', '0 0 40 40');
  const arc = (a0, a1) => { const p = (a) => [C + R * Math.cos(a), C + R * Math.sin(a)], [x0, y0] = p(a0), [x1, y1] = p(a1); return `M${x0} ${y0}A${R} ${R} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1} ${y1}`; };
  const A0 = Math.PI * 0.75, SPAN = Math.PI * 1.5;
  const mk = (cls) => { const e = document.createElementNS(NS, 'path'); e.setAttribute('class', cls); svg.append(e); return e; };
  const track = mk('kt'); track.setAttribute('d', arc(A0, A0 + SPAN)); const fill = mk('kf');
  const cap = document.createElementNS(NS, 'circle'); cap.setAttribute('r', 2.6); cap.setAttribute('class', 'kc'); svg.append(cap);
  const val = h('span', { class: 'kv' });
  const el = h('div', { class: 'knob', tabindex: 0, role: 'slider', 'aria-label': label, title: `${label} · drag, or double-click to reset` }, svg, val, h('span', { class: 'kl' }, label));
  const k = () => (P.get(path) - min) / (max - min);
  const show = () => {
    const t = Math.max(0, Math.min(1, k())), a = A0 + t * SPAN, from = bipolar ? A0 + SPAN / 2 : A0;
    fill.setAttribute('d', Math.abs(a - from) < 0.01 ? '' : a > from ? arc(from, a) : arc(a, from));
    cap.setAttribute('cx', C + R * Math.cos(a)); cap.setAttribute('cy', C + R * Math.sin(a));
    val.textContent = fmt(P.get(path)); el.setAttribute('aria-valuenow', P.get(path));
  };
  const setK = (t) => { let v = min + Math.max(0, Math.min(1, t)) * (max - min); if (step) v = Math.round(v / step) * step; P.set(path, +v.toFixed(5)); };
  let y0 = null, k0 = 0;
  el.addEventListener('pointerdown', (e) => { el.setPointerCapture(e.pointerId); y0 = e.clientY + e.clientX * 0; k0 = k(); el.classList.add('on'); el.x0 = e.clientX; });
  el.addEventListener('pointermove', (e) => { if (y0 === null) return; const d = (y0 - e.clientY + (e.clientX - el.x0) * 0.5) / (e.shiftKey ? 600 : 160); setK(k0 + d); });
  const up = () => { y0 = null; el.classList.remove('on'); }; el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  el.addEventListener('dblclick', () => P.reset(path));
  el.addEventListener('wheel', (e) => { e.preventDefault(); setK(k() - Math.sign(e.deltaY) * (step ? step / (max - min) : 0.03)); }, { passive: false });
  el.addEventListener('keydown', (e) => { const d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key]; if (!d) return; e.preventDefault(); e.stopPropagation(); setK(k() + d * (step ? step / (max - min) : 0.02)); });
  P.on(({ path: p }) => { if (p === path) show(); }); show();
  return el;
}
/** A labelled group of knobs and switches. */
export const group = (title, ...kids) => h('div', { class: 'grp' }, h('span', { class: 'gl' }, title), h('div', { class: 'gk' }, ...kids));
