export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const lerp = (a, b, t) => a + (b - a) * t;

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') for (const [sk, sv] of Object.entries(v)) sk.startsWith('--') ? el.style.setProperty(sk, sv) : (el.style[sk] = sv);
    else if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  return el;
}

import { STATIC, staticGet, staticPost, staticUpload } from './static.js';
export { STATIC };
export const api = {
  async get(url) { if (STATIC) return staticGet(url); const r = await fetch(url); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText); return r.json(); },
  async post(url, body) {
    if (STATIC) return staticPost(url, body);
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText); return r.json();
  },
  async upload(url, form) { if (STATIC) return staticUpload(url, form); const r = await fetch(url, { method: 'POST', body: form }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.statusText); return j; },
};

/** Canvas sized to its CSS box at device pixel ratio. Returns { cv, g, w, h, resize() }. */
export function canvasIn(parent) {
  const cv = h('canvas');
  parent.append(cv);
  const o = { cv, g: cv.getContext('2d'), w: 0, h: 0, dpr: 1 };
  o.resize = () => {
    const r = parent.getBoundingClientRect(); o.dpr = Math.min(2, devicePixelRatio || 1);
    o.w = r.width; o.h = r.height; cv.width = Math.round(r.width * o.dpr); cv.height = Math.round(r.height * o.dpr);
    cv.style.width = r.width + 'px'; cv.style.height = r.height + 'px';
    o.g.setTransform(o.dpr, 0, 0, o.dpr, 0, 0);
  };
  new ResizeObserver(o.resize).observe(parent);
  o.resize();
  return o;
}

export function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
}

/** Seeded RNG (mulberry32) so creatures and layouts are stable per seed. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = a + 0x6d2b79f5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

export const download = (blob, name) => {
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
};

export const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
