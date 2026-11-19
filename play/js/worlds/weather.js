// WEATHER — the master bus as a sky. Left is cold (the song freezes behind a lowpass), right is warm (it thins
// into a highpass haze), up is storm (echoes, a fjord of reverb, and at the very top the signal breaks into
// bit-crushed hail). It is a drawer, not a world, because weather happens over every other game.
import { $, h, canvasIn, clamp } from '../lib/util.js';

export class Weather {
  constructor(app, el) {
    this.app = app; this.el = el;
    const pad = h('div', { class: 'weather-pad' });
    this.freezeBtn = h('button', { class: 'btn', onclick: () => this.set({ freeze: !app.session.state.weather.freeze }) }, '❄ Freeze');
    el.append(
      h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '10px' } },
        h('h3', {}, 'Weather'), h('span', { class: 'tiny faint' }, 'drag the sky')),
      pad,
      h('div', { class: 'weather-labels tiny faint' }, h('span', {}, '← cold'), h('span', {}, 'storm ↑'), h('span', {}, 'warm →')),
      h('div', { class: 'weather-btns' },
        h('button', { class: 'btn', onclick: () => app.session.dispatch({ t: 'fx', fx: 'thunder' }) }, 'ϟ Thunder'),
        this.freezeBtn,
        h('button', { class: 'btn', onclick: () => this.set({ x: 0, y: 0, freeze: false }) }, '☀ Clear')),
    );
    this.c = canvasIn(pad);
    this.parts = Array.from({ length: 140 }, () => ({ x: Math.random(), y: Math.random(), s: Math.random() }));
    let drag = false;
    const move = (e) => {
      const r = pad.getBoundingClientRect();
      this.set({ x: clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1, 1), y: clamp(1 - (e.clientY - r.top) / r.height, 0, 1) });
    };
    pad.addEventListener('pointerdown', (e) => { drag = true; pad.setPointerCapture(e.pointerId); move(e); });
    pad.addEventListener('pointermove', (e) => drag && move(e));
    pad.addEventListener('pointerup', () => { drag = false; });
    $('#weather-toggle').onclick = () => this.toggle();
    app.session.on(({ state }) => this.freezeBtn.classList.toggle('on', state.weather.freeze));
  }
  set(p) { this.app.session.dispatch({ t: 'weather/set', p }); }
  toggle() { this.el.classList.toggle('open'); }
  frame(t, dt) {
    if (!this.el.classList.contains('open')) return;
    const { g, w, h: H } = this.c, { x, y, freeze } = this.app.session.state.weather;
    const cold = Math.max(0, -x), warm = Math.max(0, x);
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, `rgb(${18 + warm * 90 + y * 10}, ${20 + cold * 40}, ${44 + cold * 60 - y * 20})`);
    sky.addColorStop(1, `rgb(${10 + warm * 60}, ${13 + cold * 20}, ${28 + cold * 30})`);
    g.fillStyle = sky; g.fillRect(0, 0, w, H);
    if (warm > 0.05) { // sun haze
      const sx = w * (0.5 + x * 0.4), rg = g.createRadialGradient(sx, H * 0.85, 4, sx, H * 0.85, 40 + warm * 140);
      rg.addColorStop(0, `rgba(255,214,150,${0.6 * warm})`); rg.addColorStop(1, 'rgba(255,214,150,0)'); g.fillStyle = rg; g.fillRect(0, 0, w, H);
    }
    const n = Math.round(20 + 120 * Math.max(y, cold));
    for (let i = 0; i < n; i++) {
      const p = this.parts[i];
      const speed = freeze ? 0 : (0.04 + y * 0.9 + cold * 0.05) * (0.5 + p.s);
      p.y += speed * dt; p.x += (y * 0.25 - 0.02) * dt * (0.5 + p.s);
      if (p.y > 1) { p.y = 0; p.x = Math.random(); } if (p.x > 1) p.x = 0;
      const px = p.x * w, py = p.y * H;
      if (y > 0.4 && cold < 0.5) { g.strokeStyle = `rgba(168,216,255,${0.25 + p.s * 0.4})`; g.lineWidth = 1; g.beginPath(); g.moveTo(px, py); g.lineTo(px - y * 6, py - 8 - y * 14); g.stroke(); }
      else { g.fillStyle = `rgba(245,240,255,${0.3 + p.s * 0.5})`; g.beginPath(); g.arc(px, py, 0.8 + p.s * (1.2 + cold), 0, 7); g.fill(); }
    }
    if (y > 0.72 && Math.random() < (y - 0.72) * 0.5) { g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(0, 0, w, H); }
    // the cursor
    const cx = (x + 1) / 2 * w, cy = (1 - y) * H;
    g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, 11 + Math.sin(t * 4) * 1.5, 0, 7); g.stroke();
    g.fillStyle = freeze ? '#a8d8ff' : '#ffe59a'; g.beginPath(); g.arc(cx, cy, 5, 0, 7); g.fill();
  }
}
