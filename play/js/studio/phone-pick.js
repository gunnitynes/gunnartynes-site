// Choosing a stem to make a sound from: every instrument of the song, with how it runs through the song drawn beside its
// name. A tap makes the sound from it and lets you hear it at once; the list stays until it is closed, so several can be tried.
import { h } from '../lib/util.js';
import { buzz } from './phone-kit.js';

/** current(): the stem in use now · pick(stem): make it, resolves when it can be heard · hear(): play it once. */
export function pickStem(S, { title, color = '#e6b450', current, pick, surprise, hear }) {
  const cb = S.song.stems.filter((s) => s.cells.some(Boolean) && !s.voice), N = S.song.numCells;
  const bars = (st) => { const cv = h('canvas', { width: N * 4, height: 36 }), g = cv.getContext('2d'); g.fillStyle = st.color || '#ece8dc'; const top = Math.max(...st.cells.map((c) => (c ? c.rms : -99))); st.cells.forEach((c, i) => { const v = c && c.rms > -60 ? Math.max(0.1, Math.min(1, 1 + (c.rms - top) / 24)) : 0; if (v) g.fillRect(i * 4, 36 - v * 34, 3, v * 34); }); return cv; };
  const close = () => { el.classList.remove('on'); setTimeout(() => el.remove(), 220); };
  const show = () => list.forEach(([st, b]) => b.setAttribute('aria-pressed', st.id === current()));
  let n = 0; const take = async (b, fn) => { const k = ++n; b.classList.add('busy'); try { await fn(); if (k === n) { show(); hear(); } } finally { b.classList.remove('busy'); } };
  const list = cb.map((st) => { const b = h('button', { type: 'button', class: 'pickb', style: { '--s': st.color || '#ece8dc' }, onclick: () => { buzz(6); take(b, () => pick(st)); } }, h('span', {}, st.name), bars(st)); return [st, b]; });
  const sur = surprise && h('button', { type: 'button', class: 'chip', onclick: (e) => { buzz(10); take(e.currentTarget, surprise); } }, 'Surprise me');
  const el = h('div', { class: 'pick', style: { '--c': color } }, h('div', { class: 'pick-in', role: 'dialog', 'aria-label': title }, h('div', { class: 'mhead' }, h('span', { class: 'eyebrow' }, title), h('span', { class: 'sp' }), sur || '', h('button', { type: 'button', class: 'chip done', onclick: close }, 'Done')), h('div', { class: 'picks' }, ...list.map(([, b]) => b))));
  el.addEventListener('click', (e) => { if (e.target === el) close(); });
  document.body.append(el); show(); requestAnimationFrame(() => { el.classList.add('on'); list.find(([st]) => st.id === current())?.[1].scrollIntoView({ block: 'nearest' }); });
}
