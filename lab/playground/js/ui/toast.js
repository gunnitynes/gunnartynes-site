import { h } from '../lib/util.js';

export function toast({ icon = '✦', title, text = '', color, ms = 4200 }) {
  const box = document.getElementById('toasts');
  const el = h('div', { class: 'toast' }, h('div', { class: 'ico', style: color ? { background: color } : {} }, String(icon)), h('div', {}, h('b', {}, title), h('small', {}, text)));
  box.append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, ms);
}

// Little celesta-ish chimes for game moments. They go straight to the speakers, never into a recorded take.
const MOTIFS = { achievement: [0, 4, 7, 12], level: [0, 7, 12, 16, 19], unlock: [12, 7, 4, 0, 12], tick: [0] };
export function chime(kind = 'achievement') {
  const ctx = window.playground?.engine?.ctx; if (!ctx) return;
  const notes = MOTIFS[kind] ?? MOTIFS.achievement;
  const t0 = ctx.currentTime + 0.02, base = 880 * 2 ** (2 / 12);
  notes.forEach((n, i) => {
    const t = t0 + i * 0.075, f = base * 2 ** (n / 12);
    const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = f; o2.type = 'sine'; o2.frequency.value = f * 4.01;
    const g2 = ctx.createGain(); g2.gain.value = 0.18;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.07, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.9);
    o.connect(g); o2.connect(g2).connect(g); g.connect(ctx.destination);
    o.start(t); o2.start(t); o.stop(t + 1); o2.stop(t + 1);
  });
}
