// The Textures room: a gesture pad (or a four-corner morph between stored settings) and eight effect modules on
// everything — each with something to look at, something to play, and a dice to throw.
import { $, h } from '../lib/util.js';
import { knob } from './ui.js';
import { CHORDS } from './core.js';

const NOTE = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
function sizer(box, cv, g, on) { new ResizeObserver(() => { const r = box.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1); cv.width = Math.max(1, r.width * d); cv.height = Math.max(1, r.height * d); cv.style.width = r.width + 'px'; cv.style.height = r.height + 'px'; g.setTransform(d, 0, 0, d, 0, 0); on(r.width, r.height); }).observe(box); }
const surface = (cls = '') => { const box = h('div', { class: 'viz ' + cls }), cv = h('canvas'), g = cv.getContext('2d'); box.append(cv); const s = { box, cv, g, w: 0, h: 0 }; sizer(box, cv, g, (w, hh) => { s.w = w; s.h = hh; }); return s; };

export function buildTexturesRoom(S, { seg, sw, recBtn }) {
  const P = S.params, room = $('#room-textures'), player = S.player;
  const segP = (path, opts, title) => seg(P, path, opts, title);

  // ---------------------------------------------------------------- the pad: gesture or morph
  P.define('fx.xy.mode', 'gesture');
  S.morph ??= [null, null, null, null];
  const fxPaths = () => Object.keys(P.def).filter((p) => p.startsWith('fx.') && !p.startsWith('fx.xy') && p !== 'fx.gate.steps' && p !== 'fx.rep.steps');
  const applyXY = () => {
    const x = P.get('fx.xy.x'), y = P.get('fx.xy.y');
    if (x === undefined || y === undefined) return;
    if (P.get('fx.xy.mode') === 'morph') {
      const w = [(1 - x) * (1 - y), x * (1 - y), (1 - x) * y, x * y], have = S.morph.map((m, i) => (m ? w[i] : 0)), tot = have.reduce((a, b) => a + b, 0);
      if (!tot) return;
      const best = have.indexOf(Math.max(...have));
      for (const p of fxPaths()) {
        if (typeof P.get(p) === 'number') { let v = 0; S.morph.forEach((m, i) => { if (m) v += (m[p] ?? P.def[p]) * have[i]; }); P.set(p, +(v / tot).toFixed(4), { by: 'macro' }); }
        else if (S.morph[best]?.[p] !== undefined) P.set(p, S.morph[best][p], { by: 'macro' });
      }
      return;
    }
    P.set('fx.filter.lp', x < 0.5 ? 0.35 + x * 1.3 : 1, { by: 'macro' }); P.set('fx.filter.hp', x > 0.5 ? (x - 0.5) * 1.3 : 0, { by: 'macro' });
    P.set('fx.res.mix', Math.max(0, y - 0.2) * 0.9, { by: 'macro' }); P.set('fx.shim.mix', y * 0.75, { by: 'macro' }); P.set('fx.tape.mix', Math.min(1, y * 1.4), { by: 'macro' });
  };
  P.define('fx.xy.x', 0.5, applyXY); P.define('fx.xy.y', 0, applyXY);
  const axes = { gesture: ['darker', 'brighter', 'ringing', 'dry'], morph: ['', '', '', ''] };
  const ax = ['l', 'r', 't', 'b'].map((k) => h('span', { class: 'ax ' + k }));
  const corners = [0, 1, 2, 3].map((i) => h('button', { type: 'button', class: 'corner c' + i, title: 'Keep the effects as they are now in this corner', onclick: (e) => { e.stopPropagation(); S.morph[i] = Object.fromEntries(fxPaths().map((p) => [p, P.get(p)])); showPad(); } }, String(i + 1)));
  const pad = h('div', { class: 'xy', title: 'Drag' }, ...ax, ...corners, h('i', { class: 'dot' }));
  const dot = pad.querySelector('.dot');
  const showPad = () => {
    const m = P.get('fx.xy.mode'); pad.classList.toggle('morph', m === 'morph');
    axes[m].forEach((t, i) => { ax[i].textContent = t; });
    corners.forEach((c, i) => c.classList.toggle('has', !!S.morph[i]));
    dot.style.left = `${P.get('fx.xy.x') * 100}%`; dot.style.top = `${(1 - P.get('fx.xy.y')) * 100}%`;
  };
  P.on(({ path }) => path.startsWith('fx.xy') && showPad()); showPad();
  let pdrag = false; const at = (e) => { const r = pad.getBoundingClientRect(); P.set('fx.xy.x', +clamp((e.clientX - r.left) / r.width, 0, 1).toFixed(4)); P.set('fx.xy.y', +clamp(1 - (e.clientY - r.top) / r.height, 0, 1).toFixed(4)); };
  pad.addEventListener('pointerdown', (e) => { if (e.target.closest('.corner')) return; pdrag = true; pad.setPointerCapture(e.pointerId); at(e); }); pad.addEventListener('pointermove', (e) => pdrag && at(e)); pad.addEventListener('pointerup', () => { pdrag = false; });
  const padHint = h('span', { class: 'cap' });
  const showHint = () => { padHint.textContent = P.get('fx.xy.mode') === 'morph' ? 'set the modules, press a corner to keep them there · then drag between' : 'one gesture: filter, tape, resonators and shimmer'; };
  P.on(({ path }) => path === 'fx.xy.mode' && showHint()); showHint();

  // ---------------------------------------------------------------- modules
  const dice = (paths) => h('button', { type: 'button', class: 'dice', title: 'Throw the dice: new settings for this module', onclick: () => { for (const p of paths) { const [mn, mx] = P.range?.[p] || [0, 1], r = Math.random(); const v = /mix|depth|amount|lfo$/.test(p) ? 0.25 + r * 0.55 : r; P.set(p, +(mn + v * (mx - mn)).toFixed(3)); } } }, '⚄');
  const mod = (title, amount, paths, ...kids) => {
    const el = h('section', { class: 'mod' }, h('header', {}, h('h3', {}, title), h('span', { class: 'sp' }), dice(paths)), ...kids);
    if (amount) { const s = () => el.classList.toggle('idle', !(P.get(amount) > 0.001)); P.on(({ path }) => path === amount && s()); s(); }
    return el;
  };
  const row = (...k) => h('div', { class: 'gk' }, ...k);
  const draws = [];

  // repeat
  const holds = [['2', 2], ['1', 1], ['½', 0.5], ['¼', 0.25], ['⅛', 0.125], ['1⁄16', 0.0625]].map(([label, div]) => {
    const b = h('button', { type: 'button', class: 'hold', title: `Hold to repeat the last ${label} beat${div > 1 ? 's' : ''}` }, label);
    const on = () => { b.classList.add('on'); S.tex.repeat(div); }, off = () => { b.classList.remove('on'); S.tex.repeat(0); };
    b.addEventListener('pointerdown', (e) => { b.setPointerCapture(e.pointerId); on(); }); b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); return b;
  });
  const stepRow = (path, title) => {
    const btns = [...Array(16)].map((_, i) => h('button', { type: 'button', class: 'st' + (i % 4 === 0 ? ' beat' : ''), 'data-i': i }));
    let paint = null;
    const set = (i, v) => { const s = [...P.get(path)]; if (s[i] === v) return; s[i] = v; P.set(path, s.join('')); };
    const el = h('div', { class: 'steps', title }, ...btns);
    el.addEventListener('pointerdown', (e) => { const b = e.target.closest('.st'); if (!b) return; el.setPointerCapture(e.pointerId); paint = P.get(path)[b.dataset.i] === '1' ? '0' : '1'; set(+b.dataset.i, paint); });
    el.addEventListener('pointermove', (e) => { if (!paint) return; const b = document.elementFromPoint(e.clientX, e.clientY)?.closest('.st'); if (b && el.contains(b)) set(+b.dataset.i, paint); });
    el.addEventListener('pointerup', () => { paint = null; });
    const show = () => { const s = P.get(path); btns.forEach((b, i) => b.classList.toggle('on', s[i] === '1')); };
    P.on(({ path: p }) => p === path && show()); show();
    el.tick = (i) => btns.forEach((b, k) => b.classList.toggle('now', k === i));
    return el;
  };
  const repSteps = stepRow('fx.rep.steps', 'Steps where the repeat fires by itself, every bar');
  // auto-repeat rides the player's 16th-note clock, so it lands exactly on the step
  player.on('step', ({ step, time }) => { const s = P.get('fx.rep.steps'); if (!s.includes('1')) return; const i = step % 16, now = s[i] === '1', was = s[(i + 15) % 16] === '1'; if (now && !was) S.tex.repeat(P.get('fx.rep.len'), time); else if (!now && was) S.tex.repeat(0, time); });
  const repeatMod = mod('Repeat · hold a beat', null, ['fx.rep.pitch', 'fx.rep.decay'],
    h('div', { class: 'holds' }, ...holds),
    h('div', { class: 'subcap' }, h('span', { class: 'cap' }, 'By itself on'), segP('fx.rep.len', [[0.0625, '1/64'], [0.125, '1/32'], [0.25, '1/16'], [0.5, '1/8']], 'How short each automatic repeat is')),
    repSteps,
    row(knob(P, 'fx.rep.pitch', 'Pitch', { min: -12, max: 12, step: 1, bipolar: true, fmt: (v) => `${v > 0 ? '+' : ''}${v}` }), knob(P, 'fx.rep.decay', 'Hold on', { fmt: (v) => `${Math.round((0.55 + v * 0.45) * 100)}%` })));
  draws.push(() => { const b = player.playing ? player.beatNow() : -1; repSteps.tick(b < 0 ? -1 : Math.floor(b * 4) % 16); gateSteps.tick(b < 0 ? -1 : Math.floor(b * P.get('fx.gate.rate')) % 16); });

  // gate
  const gateSteps = stepRow('fx.gate.steps', 'Open and shut steps · drag to paint');
  const gviz = surface();
  const PRESETS = { Straight: '1010101010101010', Offbeat: '0101010101010101', Gallop: '1011101110111011', Broken: '1001001010010010', Trance: '1101101101101101', Stutter: '1111000011001010' };
  const gateMod = mod('Gate · a rhythm cut into everything', 'fx.gate.depth', ['fx.gate.depth', 'fx.gate.smooth', 'fx.gate.pluck'],
    gviz.box, gateSteps,
    h('div', { class: 'chipsrow' }, ...Object.entries(PRESETS).map(([n, s]) => h('button', { type: 'button', class: 'pchip', onclick: () => P.set('fx.gate.steps', s) }, n)),
      h('button', { type: 'button', class: 'pchip', title: 'A new random rhythm', onclick: () => P.set('fx.gate.steps', [...Array(16)].map((_, i) => (i % 4 === 0 || Math.random() < 0.5 ? 1 : 0)).join('')) }, 'Random'),
      h('button', { type: 'button', class: 'pchip', title: 'Swap open and shut', onclick: () => P.set('fx.gate.steps', [...P.get('fx.gate.steps')].map((c) => (c === '1' ? 0 : 1)).join('')) }, 'Invert')),
    row(knob(P, 'fx.gate.depth', 'Depth'), knob(P, 'fx.gate.smooth', 'Soften'), knob(P, 'fx.gate.pluck', 'Pluck')),
    h('div', { class: 'subcap' }, h('span', { class: 'cap' }, 'Steps of'), segP('fx.gate.rate', [[2, '1/8'], [4, '1/16'], [8, '1/32']], 'Step length')));
  // the gate's volume over one cycle of its steps
  draws.push(() => {
    const { g, w, h: hh } = gviz; if (!w) return; g.clearRect(0, 0, w, hh);
    const st = P.get('fx.gate.steps'), d = Math.max(0.12, P.get('fx.gate.depth')), sm = P.get('fx.gate.smooth'), pl = P.get('fx.gate.pluck'), n = 16, sw = w / n;
    let lv = 1; g.beginPath();
    for (let x = 0; x <= w; x += 1) { const i = Math.min(n - 1, Math.floor(x / sw)), ph = (x % sw) / sw, tgt = st[i] === '1' ? 1 - d * pl * ph : 1 - d; lv += (tgt - lv) * (1 - Math.exp(-1 / (0.4 + sm * sm * sw * 0.7))); const y = hh - 4 - lv * (hh - 8); x ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.strokeStyle = '#e6b450'; g.lineWidth = 1.4; g.stroke(); g.lineTo(w, hh); g.lineTo(0, hh); g.fillStyle = '#e6b45016'; g.fill();
    const rate = P.get('fx.gate.rate'), i = player.playing ? Math.floor(player.beatNow() * rate) % n : -1; if (i >= 0) { g.fillStyle = '#ece8dc'; g.fillRect(i * sw, 0, 1.5, hh); }
  });

  // filter: a response curve you can grab
  const fviz = surface('curve');
  const freqs = new Float32Array(160).map((_, i) => 20 * 1000 ** (i / 159)), mL = new Float32Array(160), mH = new Float32Array(160), ph = new Float32Array(160);
  let fdrag = null;
  const fset = (e) => { const r = fviz.box.getBoundingClientRect(), x = clamp((e.clientX - r.left) / r.width, 0, 1), y = clamp(1 - (e.clientY - r.top) / r.height, 0, 1), hz = 20 * 1000 ** x;
    if (fdrag === 'lp') P.set('fx.filter.lp', +clamp(Math.log(hz / 60) / Math.log(333), 0, 1).toFixed(4)); else P.set('fx.filter.hp', +clamp(Math.log(hz / 18) / Math.log(120), 0, 1).toFixed(4));
    P.set('fx.filter.q', +clamp((y - 0.35) / 0.6, 0, 1).toFixed(3)); };
  fviz.box.addEventListener('pointerdown', (e) => { const r = fviz.box.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, lx = Math.log(60 * 333 ** P.get('fx.filter.lp') / 20) / Math.log(1000), hx = Math.log(18 * 120 ** P.get('fx.filter.hp') / 20) / Math.log(1000); fdrag = Math.abs(x - lx) <= Math.abs(x - hx) ? 'lp' : 'hp'; fviz.box.setPointerCapture(e.pointerId); fset(e); });
  fviz.box.addEventListener('pointermove', (e) => fdrag && fset(e)); fviz.box.addEventListener('pointerup', () => { fdrag = null; });
  const filterMod = mod('Filter · drag the curve', null, ['fx.filter.lp', 'fx.filter.hp', 'fx.filter.q', 'fx.filter.lfo'], fviz.box,
    row(knob(P, 'fx.filter.lp', 'Low pass'), knob(P, 'fx.filter.hp', 'High pass'), knob(P, 'fx.filter.q', 'Peak'), knob(P, 'fx.filter.lfo', 'Sweep')),
    h('div', { class: 'subcap' }, h('span', { class: 'cap' }, 'Sweep every'), segP('fx.filter.rate', [[1, '1'], [2, '2'], [4, 'bar'], [8, '2 bars'], [16, '4 bars']], 'How long one sweep takes (beats)'), segP('fx.filter.shape', [['sine', '∿'], ['triangle', '⋀'], ['sawtooth', '⩘'], ['square', '⊓']], 'Sweep shape')));
  draws.push(() => {
    const { g, w, h: hh } = fviz; if (!w) return; g.clearRect(0, 0, w, hh);
    S.tex.lp.getFrequencyResponse(freqs, mL, ph); S.tex.hp.getFrequencyResponse(freqs, mH, ph);
    for (const f of [100, 1000, 10000]) { const x = Math.log(f / 20) / Math.log(1000) * w; g.fillStyle = '#ffffff10'; g.fillRect(x, 0, 1, hh); g.fillStyle = '#6f747f'; g.font = '9px "IBM Plex Mono", monospace'; g.fillText(f >= 1000 ? `${f / 1000}k` : String(f), x + 3, hh - 4); }
    const y = (m) => hh * 0.62 - (20 * Math.log10(Math.max(1e-4, m))) / 24 * hh * 0.5;
    g.beginPath(); for (let i = 0; i < 160; i++) { const x = (i / 159) * w; i ? g.lineTo(x, y(mL[i] * mH[i])) : g.moveTo(x, y(mL[i] * mH[i])); } g.strokeStyle = '#e6b450'; g.lineWidth = 1.5; g.stroke();
    g.lineTo(w, hh); g.lineTo(0, hh); g.fillStyle = '#e6b45014'; g.fill();
    for (const [n, f] of [['lp', 60 * 333 ** P.get('fx.filter.lp')], ['hp', 18 * 120 ** P.get('fx.filter.hp')]]) { const x = Math.log(f / 20) / Math.log(1000) * w; g.beginPath(); g.arc(x, hh * 0.62 - P.get('fx.filter.q') * hh * 0.35, n === fdrag ? 6 : 4.5, 0, 7); g.fillStyle = '#ece8dc'; g.fill(); }
  });

  // echo
  const eviz = surface();
  const throwB = h('button', { type: 'button', class: 'hold wide', title: 'Hold: throw everything into the echo' }, 'Throw');
  throwB.addEventListener('pointerdown', (e) => { throwB.setPointerCapture(e.pointerId); throwB.classList.add('on'); S.tex.throw(true); });
  const unthrow = () => { throwB.classList.remove('on'); S.tex.throw(false); }; throwB.addEventListener('pointerup', unthrow); throwB.addEventListener('pointercancel', unthrow);
  const echoMod = mod('Echo · ping-pong', 'fx.echo.mix', ['fx.echo.mix', 'fx.echo.fb', 'fx.echo.tone', 'fx.echo.spin'], eviz.box,
    row(knob(P, 'fx.echo.mix', 'Amount'), knob(P, 'fx.echo.fb', 'Repeats'), knob(P, 'fx.echo.tone', 'Tone'), knob(P, 'fx.echo.spin', 'Spin')),
    h('div', { class: 'subcap' }, segP('fx.echo.time', [[0.25, '1/16'], [0.5, '1/8'], [0.75, '1/8.'], [1, '1/4'], [1.5, '1/4.'], [2, '1/2']], 'Echo time'), throwB));
  draws.push(() => {
    const { g, w, h: hh } = eviz; if (!w) return; g.clearRect(0, 0, w, hh);
    const tm = P.get('fx.echo.time'), fb = P.get('fx.echo.fb') * 0.98, spin = P.get('fx.echo.spin'), amt = 0.45 + 0.55 * P.get('fx.echo.mix'), span = 8, mid = hh / 2;
    g.fillStyle = '#ffffff12'; g.fillRect(0, mid, w, 1);
    for (let b = 0; b <= span; b++) { g.fillStyle = '#ffffff08'; g.fillRect((b / span) * w, 0, 1, hh); }
    g.fillStyle = '#ece8dc'; g.fillRect(2, mid - hh * 0.4, 3, hh * 0.8);
    let a = amt; for (let k = 1; k * tm <= span && a > 0.01; k++) { const x = (k * tm / span) * w, hgt = hh * 0.44 * a; g.fillStyle = '#e6b450'; g.globalAlpha = 0.35 + 0.65 * a; if (spin > 0.05) g.fillRect(x - 1.5, k % 2 ? mid - hgt * (0.4 + spin * 0.6) : mid, 3, hgt * (0.4 + spin * 0.6)); else g.fillRect(x - 1.5, mid - hgt / 2, 3, hgt); a *= fb; }
    g.globalAlpha = 1;
  });

  // tape: reels
  const tviz = surface();
  let reel = 0, last = performance.now();
  const tapeMod = mod('Tape · wow, flutter and age', 'fx.tape.mix', ['fx.tape.mix', 'fx.tape.wow', 'fx.tape.flutter', 'fx.tape.drive', 'fx.tape.age'], tviz.box,
    row(knob(P, 'fx.tape.mix', 'Amount'), knob(P, 'fx.tape.wow', 'Wow'), knob(P, 'fx.tape.flutter', 'Flutter'), knob(P, 'fx.tape.drive', 'Drive'), knob(P, 'fx.tape.age', 'Age')),
    h('div', { class: 'subcap' }, h('button', { type: 'button', class: 'pill', title: 'Slow the whole band to a halt', onclick: () => S.player.stop({ tape: true }) }, 'Tape stop'), h('span', { class: 'cap' }, 'Age darkens it and adds hiss')));
  draws.push(() => {
    const { g, w, h: hh } = tviz; if (!w) return; const now = performance.now(), dt = (now - last) / 1000; last = now;
    const wob = 1 + Math.sin(now / 1000 * 0.55 * 6.28) * P.get('fx.tape.wow') * 0.5 * P.get('fx.tape.mix');
    if (player.playing) reel += dt * 2.4 * wob;
    g.clearRect(0, 0, w, hh); const r = Math.min(hh * 0.42, w * 0.2), cy = hh / 2, xs = [w * 0.3, w * 0.7];
    g.strokeStyle = '#ffffff22'; g.lineWidth = 1; g.beginPath(); g.moveTo(xs[0], cy + r); g.lineTo(xs[1], cy + r); g.stroke();
    xs.forEach((cx, j) => {
      const age = P.get('fx.tape.age'); g.beginPath(); g.arc(cx, cy, r * (j ? 0.62 : 0.95), 0, 7); g.fillStyle = `rgba(${150 - age * 60},${110 - age * 40},${70 - age * 30},0.35)`; g.fill();
      g.beginPath(); g.arc(cx, cy, r, 0, 7); g.strokeStyle = '#ffffff30'; g.stroke();
      for (let k = 0; k < 3; k++) { const a = reel * (j ? 1.4 : 1) + k * 2.094; g.beginPath(); g.moveTo(cx + Math.cos(a) * r * 0.18, cy + Math.sin(a) * r * 0.18); g.lineTo(cx + Math.cos(a) * r * 0.5, cy + Math.sin(a) * r * 0.5); g.strokeStyle = '#ece8dc'; g.lineWidth = 2; g.stroke(); }
      g.beginPath(); g.arc(cx, cy, r * 0.12, 0, 7); g.fillStyle = '#ece8dc'; g.fill();
    });
    g.lineWidth = 1;
  });

  // resonators: strings that ring
  const rviz = surface();
  const chordChips = h('div', { class: 'chipsrow' }, ...Object.keys(CHORDS).map((c) => { const b = h('button', { type: 'button', class: 'pchip', onclick: () => P.set('fx.res.chord', c) }, c); b.dataset.c = c; return b; }));
  const showChord = () => chordChips.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.c === P.get('fx.res.chord') && !P.get('fx.res.follow')));
  P.on(({ path }) => (path === 'fx.res.chord' || path === 'fx.res.follow') && showChord()); showChord();
  const rootSel = h('select', { title: 'Tuned to', 'aria-label': 'Tuned to', onchange: (e) => P.set('fx.res.root', +e.target.value) }, ...NOTE.map((n, i) => h('option', { value: i }, n)));
  P.on(({ path }) => path === 'fx.res.root' && (rootSel.value = P.get('fx.res.root'))); rootSel.value = P.get('fx.res.root');
  const resMod = mod('Resonators · the mix rings on strings', 'fx.res.mix', ['fx.res.mix', 'fx.res.decay', 'fx.res.bright'], rviz.box,
    row(knob(P, 'fx.res.mix', 'Amount'), knob(P, 'fx.res.decay', 'Ring'), knob(P, 'fx.res.bright', 'Tone'), h('div', { class: 'sel2' }, rootSel, sw(P, 'fx.res.follow', 'Follow keys', 'Tune the strings to the notes the instruments play'))),
    chordChips);
  let rph = 0;
  draws.push(() => {
    const { g, w, h: hh } = rviz; if (!w) return; g.clearRect(0, 0, w, hh);
    const fr = S.resFreqs?.() || [], amt = P.get('fx.res.mix'), lvl = Math.min(1, (S.masterLevel || 0) * 1.6); rph += 0.35;
    fr.forEach((f, i) => {
      const y = ((i + 0.7) / (fr.length + 0.4)) * hh, A = amt * lvl * hh / (fr.length * 2.2), k = (Math.log2(f / 55) % 1) * 3 + 1;
      g.beginPath(); for (let x = 0; x <= w; x += 4) { const yy = y + Math.sin((x / w) * Math.PI) * Math.sin(rph * (0.4 + f / 600) + i) * A * Math.sin((x / w) * Math.PI * k); x ? g.lineTo(x, yy) : g.moveTo(x, yy); }
      g.strokeStyle = amt > 0.01 ? '#e6b450' : '#ffffff30'; g.globalAlpha = 0.5 + 0.5 * amt; g.lineWidth = 1; g.stroke(); g.globalAlpha = 1;
      const m = Math.round(12 * Math.log2(f / 440) + 69); g.fillStyle = '#6f747f'; g.font = '9px "IBM Plex Mono", monospace'; g.fillText(NOTE[((m % 12) + 12) % 12], 3, y - 3);
    });
  });

  // shimmer
  const sviz = surface(); const motes = [];
  const shimMod = mod('Shimmer · a rising hall', 'fx.shim.mix', ['fx.shim.mix', 'fx.shim.rise', 'fx.shim.tone'], sviz.box,
    row(knob(P, 'fx.shim.mix', 'Amount'), knob(P, 'fx.shim.rise', 'Rise'), knob(P, 'fx.shim.tone', 'Tone'), h('div', { class: 'sel2' }, sw(P, 'fx.shim.freeze', 'Freeze', 'Hold the hall as it is, forever'))),
    h('div', { class: 'subcap' }, segP('fx.shim.interval', [[7, '+5th'], [12, '+8va'], [19, '+12th'], [24, '+2 oct'], [-12, '−8va']], 'Interval'), segP('fx.shim.size', [[3, 'room'], [7, 'hall'], [14, 'cathedral']], 'Size')));
  draws.push(() => {
    const { g, w, h: hh } = sviz; if (!w) return; g.clearRect(0, 0, w, hh);
    const amt = P.get('fx.shim.mix'), rise = P.get('fx.shim.rise'), frz = P.get('fx.shim.freeze'), up = P.get('fx.shim.interval') > 0 ? 1 : -1;
    if (!frz && Math.random() < amt * 1.2 * Math.min(1, (S.masterLevel || 0) * 3 + 0.2)) motes.push({ x: Math.random() * w, y: up > 0 ? hh : 0, v: 0.3 + Math.random() * (0.4 + rise * 1.5), a: 1 });
    for (let i = motes.length - 1; i >= 0; i--) { const m = motes[i]; if (!frz) { m.y -= m.v * up; m.a *= 0.992 - (1 - rise) * 0.01; } if (m.a < 0.03 || m.y < -4 || m.y > hh + 4) { motes.splice(i, 1); continue; } g.fillStyle = `rgba(230,180,80,${m.a})`; g.fillRect(m.x, m.y, 1.6, 1.6); }
    if (motes.length > 400) motes.splice(0, motes.length - 400);
  });

  // crush and width
  const cviz = surface();
  const crushMod = mod('Crush · and width', 'fx.crush.mix', ['fx.crush.mix', 'fx.crush.bits', 'fx.crush.down', 'fx.width'], cviz.box,
    row(knob(P, 'fx.crush.mix', 'Amount'), knob(P, 'fx.crush.bits', 'Bits', { fmt: (v) => Math.round(16 - v * 13) }), knob(P, 'fx.crush.down', 'Rate'), knob(P, 'fx.width', 'Width', { min: 0, max: 2, fmt: (v) => (v < 0.03 ? 'mono' : `${Math.round(v * 100)}%`) })));
  draws.push(() => {
    const { g, w, h: hh } = cviz; if (!w) return; g.clearRect(0, 0, w, hh);
    const mix = P.get('fx.crush.mix'), levels = 2 ** Math.round(16 - P.get('fx.crush.bits') * 13), hold = 1 + Math.round(P.get('fx.crush.down') * 30), wd = P.get('fx.width');
    g.beginPath(); let held = 0; for (let x = 0; x <= w; x++) { if (x % Math.max(1, Math.round(hold * mix * 0.5 + 1)) === 0) { const s = Math.sin((x / w) * Math.PI * 4); held = mix > 0.01 ? Math.round(s * Math.min(levels, 64) / 2) / (Math.min(levels, 64) / 2) * mix + s * (1 - mix) : s; } const y = hh / 2 - held * hh * 0.32; x ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.strokeStyle = '#e6b450'; g.lineWidth = 1.2; g.stroke();
    g.fillStyle = '#ffffff22'; g.fillRect(w / 2 - (w * 0.22 * wd), hh - 5, w * 0.44 * wd, 2);
  });

  // ensemble: three drifting voices
  const enviz = surface(); let enph = 0;
  const ensMod = mod('Ensemble · chorus and vibrato', 'fx.ens.mix', ['fx.ens.mix', 'fx.ens.rate', 'fx.ens.depth', 'fx.ens.spread'], enviz.box,
    row(knob(P, 'fx.ens.mix', 'Amount'), knob(P, 'fx.ens.rate', 'Speed', { fmt: (v) => `${(0.08 + 6 * v * v).toFixed(1)} Hz` }), knob(P, 'fx.ens.depth', 'Depth'), knob(P, 'fx.ens.spread', 'Spread')),
    h('div', { class: 'subcap' }, sw(P, 'fx.ens.vib', 'Vibrato', 'Only the drifting voices: everything wavers in pitch'), h('span', { class: 'cap' }, 'three voices, each drifting on its own')));
  draws.push(() => {
    const { g, w, h: hh } = enviz; if (!w) return; g.clearRect(0, 0, w, hh);
    const rate = 0.08 + 6 * P.get('fx.ens.rate') ** 2, dep = P.get('fx.ens.depth'), sp = P.get('fx.ens.spread'), amt = P.get('fx.ens.mix');
    enph += rate / 60;
    ['#e6b450', '#ece8dc', '#e6b450'].forEach((col, i) => {
      const cx = w / 2 + (i - 1) * sp * w * 0.32; g.beginPath();
      for (let y = 0; y <= hh; y += 3) { const x = cx + Math.sin((y / hh) * 6.28 * 1.5 + enph * 6.28 * (1 + i * 0.31) + i) * (4 + dep * w * 0.08); y ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.strokeStyle = col; g.globalAlpha = 0.3 + 0.7 * amt; g.lineWidth = 1.3; g.stroke();
    });
    g.globalAlpha = 1;
  });

  // layout
  room.append(h('div', { class: 'tex2' },
    h('div', { class: 'padcol' },
      h('div', { class: 'bar2' }, segP('fx.xy.mode', [['gesture', 'Gesture'], ['morph', 'Morph']], 'What the pad does'), h('span', { class: 'sp' }), recBtn('Record')),
      pad, padHint, repeatMod),
    h('div', { class: 'mods2' }, gateMod, filterMod, echoMod, tapeMod, resMod, shimMod, ensMod, crushMod)));
  S.rooms.textures = { draw: () => draws.forEach((d) => d()) };
}
