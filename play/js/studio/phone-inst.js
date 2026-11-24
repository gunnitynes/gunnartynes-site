// Instruments: a sound you shape with one hand while the other plays it.
//  the strip  — the slice the sound is made of: drag to move it, pinch to make it longer or shorter
//  the body   — eight arms, one for each thing the sound does: pull one out, push it in. Two fingers take the whole
//               body: pinch makes it short and plucked, spread makes it long and swelling, twisting darkens or opens it
//  the pads   — a scale under the thumb; turn the phone on its side and they fill the screen
//  Breath: blow into the microphone and the sound follows. Knock: knock on the phone and it plays. Shake: another body.
import { h, $ } from '../lib/util.js';
import { clamp, r3, buzz, surface, gestures, memories, zoomPeaks, COLORS, NAMES, NOTE } from './phone-kit.js';
import { loudestWindow } from './core.js';
import { recButton } from './voice.js';

const SCALES = { 'minor pent.': [0, 3, 5, 7, 10], 'major pent.': [0, 2, 4, 7, 9], minor: [0, 2, 3, 5, 7, 8, 10], major: [0, 2, 4, 5, 7, 9, 11], dorian: [0, 2, 3, 5, 7, 9, 10] };
const sec = (v) => (v < 0.9995 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(1)} s`), pct = (v) => Math.round(v * 100);
/** The eight arms of each kind of sound: [param, name, how to say it, role (t: time, o: opens, '' neither)]. */
const ARMS = {
  sampler: (k) => [[`${k}.s.attack`, 'Attack', (v) => sec(0.002 + v * v * 3), 't'], [`${k}.s.cutoff`, 'Tone', pct, 'o'], [`${k}.s.res`, 'Peak', pct, ''], [`${k}.s.env`, 'Bite', pct, 'o'], [`mix.${k}.heat`, 'Heat', pct, ''], [`mix.${k}.echo`, 'Echo', pct, ''], [`mix.${k}.space`, 'Space', pct, ''], [`${k}.s.release`, 'Release', (v) => sec(0.02 + v * v * 6), 't']],
  strings: (k) => [[`${k}.t.decay`, 'Sustain', pct, 't'], [`${k}.t.bright`, 'Bright', pct, 'o'], [`${k}.t.excite`, 'Strike', (v) => sec(0.005 + v * v * 1.2), ''], [`${k}.t.body`, 'Source', pct, 'o'], [`${k}.t.detune`, 'Detune', pct, ''], [`mix.${k}.echo`, 'Echo', pct, ''], [`mix.${k}.space`, 'Space', pct, ''], [`${k}.t.release`, 'Release', (v) => sec(0.02 + v * 3), 't']],
  grains: (k) => [[`${k}.g.attack`, 'Swell', (v) => sec(0.005 + v * v * 4), 't'], [`${k}.g.size`, 'Grain', (v) => sec((20 + 980 * v * v) / 1000), 'o'], [`${k}.g.density`, 'Density', pct, 'o'], [`${k}.g.spread`, 'Spray', pct, ''], [`${k}.g.jitter`, 'Shimmer', pct, ''], [`mix.${k}.echo`, 'Echo', pct, ''], [`mix.${k}.space`, 'Space', pct, ''], [`${k}.g.release`, 'Release', (v) => sec(0.05 + v * v * 9), 't']],
  cloud: () => [['cloud.attack', 'Attack', (v) => sec(0.002 + v * v * 4), 't'], ['cloud.size', 'Grain', (v) => sec((10 + 990 * v * v) / 1000), 'o'], ['cloud.density', 'Density', pct, 'o'], ['cloud.spray', 'Spray', pct, ''], ['cloud.shape', 'Shape', pct, ''], ['mix.cloud.echo', 'Echo', pct, ''], ['mix.cloud.space', 'Space', pct, ''], ['cloud.release', 'Release', (v) => sec(0.02 + v * v * 8), 't']],
};
export function buildPlay(S, U) {
  const room = $('#p-play'), P = S.params, { toast, tiltSet, askSensors, Motion } = U;
  P.define('pocket.slot', 1); P.define('pocket.root', 9); P.define('pocket.scale', 'minor pent.'); P.define('pocket.oct', 0);
  const slot = () => P.get('pocket.slot'), sound = () => S.sounds[slot() - 1], kind = () => (slot() ? P.get(`f${slot()}.engine`) : 'cloud'), arms = () => ARMS[kind()](`f${slot()}`);

  // ---- who, what kind, where from
  const chips = [0, 1, 2].map((i) => h('button', { type: 'button', class: 'chip who', style: { '--c': COLORS[i] }, onclick: () => { P.set('pocket.slot', i, { by: 'ui' }); buzz(6); } }, h('i'), ['Cloud', '1', '2'][i]));
  const engines = h('div', { class: 'seg' }, ...[['sampler', 'Sampler'], ['strings', 'Strings'], ['grains', 'Pad']].map(([v, l]) => { const x = h('button', { type: 'button', onclick: () => { if (slot()) P.set(`f${slot()}.engine`, v); buzz(6); } }, l); x.dataset.v = v; return x; }));
  const srcName = h('button', { type: 'button', class: 'srcpick', title: 'Another sound from the song' }), micB = recButton(S, { onDone: (src) => { if (slot()) sound().useRec(src); else S.useCloudSource(src, { rec: src.rec }); show(); }, say: toast, cls: 'chip' });
  srcName.onclick = async () => { const s = sound(); if (!s) { const st = S.song.stems.filter((x) => x.cells.filter(Boolean).length > 2); await S.setCloudSource(...(() => { const t = st[Math.floor(Math.random() * st.length)], live = t.cells.map((c, i) => (c ? i : -1)).filter((i) => i >= 0), c = live[Math.floor(Math.random() * live.length)]; return [t.id, c, c + 1]; })()); show(); return; } srcName.textContent = '…'; await s.surprise(); show(); buzz(10); };

  // ---- the strip
  const strip = h('div', { class: 'slice' }), Z = surface(strip), zg = Z.g; let zk = '', zp = null;
  const sel = () => (slot() ? P.get(`f${slot()}.sel`).split(':').map(Number) : [P.get('cloud.va'), P.get('cloud.vb')]), source = () => (slot() ? sound()?.src : S.cloud.src);
  const setSel = (a, b) => { if (!isFinite(a) || !isFinite(b) || !Z.W) return; const w = clamp(b - a, 0.002, 1); a = clamp(a, 0, 1 - w); b = a + w; if (slot()) { const now = performance.now(); pendingSel = `${a.toFixed(4)}:${b.toFixed(4)}`; if (now - selT > 70) flushSel(); } else { P.set('cloud.va', r3(a)); P.set('cloud.vb', r3(b)); P.set('cloud.spread', r3(clamp((P.get('cloud.spray') * w) / 2, 0, 0.5))); P.set('cloud.pos', r3(clamp(P.get('cloud.pos'), a, b))); } };
  let pendingSel = null, selT = 0; const flushSel = () => { if (!pendingSel || !slot()) return; selT = performance.now(); P.set(`f${slot()}.sel`, pendingSel); pendingSel = null; };
  const shownSel = () => (pendingSel ? pendingSel.split(':').map(Number) : sel());
  let grab = null;
  const audition = () => { flushSel(); const v = S.slots[slot()]?.voice; if (!v) return; const id = 'aud' + Math.random(); v.noteOn(id, 60, 0.8); setTimeout(() => v.noteOff(id), 420); };
  gestures(strip, {
    down: (p) => { const [a, b] = sel(), x = p.x / Z.W; grab = x >= a - 0.03 && x <= b + 0.03 ? { off: x - a, w: b - a } : { off: (b - a) / 2, w: b - a }; if (x < a - 0.03 || x > b + 0.03) setSel(x - grab.off, x - grab.off + grab.w); },
    move: (p) => { if (!grab) return; const x = p.x / Z.W; setSel(x - grab.off, x - grab.off + grab.w); }, up: () => { grab = null; audition(); },
    twoStart: () => { grab = null; }, two: (e) => { const [a, b] = shownSel(), c = (a + b) / 2 + e.dx / Z.W, w = clamp((b - a) * e.ds, 0.002, 1); setSel(c - w / 2, c + w / 2); }, allUp: audition,
  });

  // ---- the body
  const body = h('div', { class: 'body' }), B = surface(body), g = B.g, shape = new Array(8).fill(0.4); let held = new Map(), word = null, wordT = 0, wob = 0, pull = null;
  const geo = () => ({ cx: B.W / 2, cy: B.H / 2, r0: Math.min(B.W, B.H) * 0.13, r1: Math.min(B.W / 2 - 40, B.H / 2 - 20) });
  const ang = (i) => (i / 8) * Math.PI * 2 - Math.PI / 2, say = (t, v) => { word = [t, v]; wordT = performance.now(); };
  const val = (i) => { const [p, , , role] = arms()[i]; void role; return clamp(P.get(p) ?? 0, 0, 1); };
  const put = (i, v) => { const [p, nm, f] = arms()[i]; v = r3(clamp(v, 0, 1)); P.set(p, v); say(nm, f(v)); };
  const armAt = (x, y) => { const { cx, cy } = geo(); const t = Math.atan2(y - cy, x - cx) + Math.PI / 2; return ((Math.round((t / (Math.PI * 2)) * 8) % 8) + 8) % 8; };
  let tapT = 0, tapI = -1;
  gestures(body, {
    down: (p) => { if (!B.W) return; const { cx, cy, r0 } = geo(), d = Math.hypot(p.x - cx, p.y - cy); if (d < r0 * 0.7) { pull = { c: true }; return; } const i = armAt(p.x, p.y), n = performance.now(); if (i === tapI && n - tapT < 300) { P.reset(arms()[i][0]); say(arms()[i][1], arms()[i][2](val(i))); buzz(15); pull = null; tapI = -1; return; } tapT = n; tapI = i; pull = { i, v: val(i), d }; buzz(4); say(arms()[i][1], arms()[i][2](val(i))); },
    move: (p) => { if (!pull || pull.c) return; const { cx, cy, r0, r1 } = geo(), a = ang(pull.i), along = (p.x - cx) * Math.cos(a) + (p.y - cy) * Math.sin(a); if (Math.abs(along - pull.d) > 6) tapI = -1; put(pull.i, pull.v + (along - pull.d) / (r1 - r0)); },
    up: () => { if (pull?.c) audition(); pull = null; },
    twoStart: () => { pull = null; },
    two: (e) => { const A = arms(); A.forEach(([p, , , role]) => { if (role === 't') P.set(p, r3(clamp((P.get(p) ?? 0) + Math.log(e.ds) * 0.55, 0, 1))); if (role === 'o') P.set(p, r3(clamp((P.get(p) ?? 0) + e.da * 0.36, 0, 1))); }); say(Math.abs(Math.log(e.s)) * 1.4 > Math.abs(e.a) ? (e.s > 1 ? 'longer' : 'shorter') : e.a > 0 ? 'opening' : 'darker', ''); },
  });

  // ---- the pads
  const grid = h('div', { class: 'pads' }); let pads = [], COLS = 4, ROWS = 3;
  const notes = () => { const sc = SCALES[P.get('pocket.scale')], root = 48 + P.get('pocket.root') + 12 * P.get('pocket.oct'); return Array.from({ length: COLS * ROWS }, (_, i) => root + 12 * Math.floor(i / sc.length) + sc[i % sc.length]); };
  const build = () => {
    const land = document.body.classList.contains('land'); COLS = land ? 8 : 4; ROWS = 3; grid.style.gridTemplateColumns = `repeat(${COLS},1fr)`;
    const ns = notes(); grid.replaceChildren(); pads = [];
    for (let r = ROWS - 1; r >= 0; r--) for (let c = 0; c < COLS; c++) { const n = ns[r * COLS + c], p = h('div', { class: 'pad' + (n % 12 === P.get('pocket.root') ? ' root' : '') }, h('span', {}, `${NOTE[n % 12]}${Math.floor(n / 12) - 1}`)); p.dataset.n = n; pads.push(p); grid.append(p); }
  };
  const on = (pid, el, vel) => { const s = S.slots[slot()]; if (!s || !el) return; const n = +el.dataset.n; s.voice.noteOn(`pd${pid}`, n, vel); S.seq.noteIn(slot(), n, vel, true); S.noteSeen?.(n, true); el.classList.add('on'); held.set(pid, { el, n, slot: slot() }); wob = 1; lastPad = el; };
  const off = (pid) => { const x = held.get(pid); if (!x) return; S.slots[x.slot]?.voice.noteOff(`pd${pid}`); S.seq.noteIn(x.slot, x.n, 0, false); held.delete(pid); if (![...held.values()].some((y) => y.el === x.el)) x.el.classList.remove('on'); };
  let lastPad = null; const velOf = (e, el) => { const r = el.getBoundingClientRect(); return clamp(0.45 + 0.55 * (1 - (e.clientY - r.top) / r.height), 0.3, 1); };
  grid.addEventListener('pointerdown', (e) => { const el = e.target.closest('.pad'); if (!el) return; e.preventDefault(); try { grid.setPointerCapture(e.pointerId); } catch { /* fine */ } on(e.pointerId, el, velOf(e, el)); buzz(4); });
  grid.addEventListener('pointermove', (e) => { const x = held.get(e.pointerId); if (!x) return; const el = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.pad'); if (el && el !== x.el) { off(e.pointerId); on(e.pointerId, el, velOf(e, el)); } });
  const up = (e) => off(e.pointerId); grid.addEventListener('pointerup', up); grid.addEventListener('pointercancel', up); grid.addEventListener('contextmenu', (e) => e.preventDefault());
  const mq = matchMedia('(orientation: landscape) and (max-height: 520px)'), turn = () => { document.body.classList.toggle('land', mq.matches && S.page === 'play'); for (const id of [...held.keys()]) off(id); build(); }; mq.addEventListener('change', turn);

  // ---- breath, knock, key
  let breath = null;
  const breathB = h('button', { type: 'button', class: 'sw', title: 'Blow into the microphone: the sound follows your breath' }, h('i'), 'Breath');
  const breathOff = () => { clearInterval(breath?.t); breath = null; for (const s of S.sounds) s.breath.gain.setTargetAtTime(1, S.ctx.currentTime, 0.05); breathB.setAttribute('aria-pressed', 'false'); };
  breathB.onclick = async () => {
    if (breath) { breathOff(); return; } if (!slot()) { toast('Breath plays Sound 1 and Sound 2'); return; }
    let mic; try { mic = await S.engine.openMic(); } catch (e) { toast(e?.name === 'NotAllowedError' ? 'The microphone was not allowed' : 'No microphone here'); return; }
    const buf = new Float32Array(mic.monitor.fftSize); let lv = 0, floor = 0.01; breathB.setAttribute('aria-pressed', 'true'); toast('Hold a pad and blow'); buzz(12);
    breath = { t: setInterval(() => { mic.monitor.getFloatTimeDomainData(buf); let s = 0; for (const v of buf) s += v * v; const r = Math.sqrt(s / buf.length); floor += (Math.min(r, floor * 1.5 + 0.0005) - floor) * 0.01; lv += (clamp((r - floor * 1.6) * 9, 0, 1) - lv) * (r > lv ? 0.5 : 0.22); breath.lv = lv; S.sounds.forEach((x) => x.breath.gain.setTargetAtTime(x.n === slot() ? 0.02 + lv * 1.25 : 1, S.ctx.currentTime, 0.02)); wob = Math.max(wob, lv); }, 25), lv: 0 };
  };
  let knock = false; const knockB = h('button', { type: 'button', class: 'sw', title: 'Knock on the phone, or on the table it lies on: the last note plays' }, h('i'), 'Knock');
  knockB.onclick = async () => { if (!knock && !Motion.got) { await askSensors(); Motion.set(true); await new Promise((r) => setTimeout(r, 350)); } if (!knock && !Motion.got) { toast('Knock needs the phone’s motion sensors'); return; } knock = !knock; knockB.setAttribute('aria-pressed', knock); if (knock) toast('Knock on the phone'); };
  const keyB = h('button', { type: 'button', class: 'chip', onclick: () => P.set('pocket.root', (P.get('pocket.root') + 7) % 12, { by: 'ui' }) }), scaleB = h('button', { type: 'button', class: 'chip', onclick: () => { const k = Object.keys(SCALES); P.set('pocket.scale', k[(k.indexOf(P.get('pocket.scale')) + 1) % k.length], { by: 'ui' }); } }), octB = h('button', { type: 'button', class: 'chip', onclick: () => P.set('pocket.oct', P.get('pocket.oct') >= 1 ? -1 : P.get('pocket.oct') + 1, { by: 'ui' }) });
  const revB = h('button', { type: 'button', class: 'chip tog', onclick: () => { P.set(`f${slot()}.s.reverse`, !P.get(`f${slot()}.s.reverse`)); show(); buzz(6); } }, 'Reverse'), holdB = h('button', { type: 'button', class: 'chip tog', onclick: () => { P.set(`f${slot()}.s.loop`, !P.get(`f${slot()}.s.loop`)); show(); buzz(6); } }, 'Loop');
  const mems = memories(S, () => `${slot()}.${kind()}`, () => [...arms().map((x) => x[0]), ...(slot() ? [`f${slot()}.sel`] : ['cloud.pos'])], { say: toast }); S.memRows = [...(S.memRows || []), mems];

  const show = () => {
    const s = slot(); chips.forEach((c, i) => c.setAttribute('aria-pressed', i === s)); room.style.setProperty('--c', COLORS[s]); engines.hidden = !s; breathB.hidden = !s; revB.hidden = holdB.hidden = kind() !== 'sampler';
    srcName.textContent = `${s ? sound().srcName : S.cloudSrc?.rec ? 'your recording' : S.song.stems.find((x) => x.id === S.cloudSrc?.stemId)?.name || '…'}  ↻`;
    if (s) { engines.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x.dataset.v === kind())); revB.setAttribute('aria-pressed', !!P.get(`f${s}.s.reverse`)); holdB.setAttribute('aria-pressed', !!P.get(`f${s}.s.loop`)); }
    keyB.textContent = NOTE[P.get('pocket.root')]; scaleB.textContent = P.get('pocket.scale'); octB.textContent = `oct ${P.get('pocket.oct') > 0 ? '+' : ''}${P.get('pocket.oct')}`; mems.show(); zk = '';
  };
  P.on(({ path }) => { if (/^pocket\./.test(path) || /\.engine$/.test(path)) { pendingSel = null; if (path === 'pocket.slot' && breath) breathOff(); for (const id of [...held.keys()]) off(id); if (path !== 'pocket.slot') build(); show(); } });
  build(); show(); S.soundChanged = show;
  room.append(
    h('div', { class: 'head row ins-top' }, ...chips, h('span', { class: 'sp' }), engines),
    h('div', { class: 'row ins-src' }, srcName, h('span', { class: 'sp' }), micB), strip, body,
    h('div', { class: 'row ins-row' }, mems, h('span', { class: 'sp' }), breathB, knockB), grid, h('div', { class: 'row ins-key' }, keyB, scaleB, octB, holdB, revB));

  // ---- drawing
  const cur = new Array(8).fill(0.4);
  function draw() {
    if (document.body.classList.contains('land')) return; const now = performance.now();
    if (Z.W) {
      const { W, H } = Z, src = source(), [a, b] = shownSel(), key = `${src?.stemId}:${src?.fromCell}:${W}`; if (src && key !== zk) { zk = key; zp = zoomPeaks(src, 0, 1, Math.floor(W / 1.5)); }
      zg.clearRect(0, 0, W, H); if (zp && src) { const n = zp.length / 2, pk = Math.max(0.02, ...zp.map(Math.abs)); for (let i = 0; i < n; i++) { const u = i / n, inn = u >= a && u <= b; zg.fillStyle = inn ? COLORS[slot()] : '#ece8dc3c'; const y0 = H / 2 - (zp[2 * i + 1] / pk) * H * 0.42, y1 = H / 2 - (zp[2 * i] / pk) * H * 0.42; zg.fillRect(u * W, y0, 1.2, Math.max(1, y1 - y0)); } }
      zg.fillStyle = COLORS[slot()] + '22'; zg.fillRect(a * W, 0, Math.max(2, (b - a) * W), H); zg.fillStyle = COLORS[slot()]; zg.fillRect(a * W, 0, 2, H); zg.fillRect(b * W - 2, 0, 2, H);
      if (src) { zg.font = '10px "IBM Plex Mono", monospace'; zg.textBaseline = 'top'; zg.textAlign = a > 0.7 ? 'right' : 'left'; zg.fillStyle = '#fff'; zg.fillText(sec((b - a) * src.dur), a > 0.7 ? a * W - 5 : Math.min(W - 50, b * W + 5), 5); }
    }
    if (!B.W) return; const { W, H } = B, { cx, cy, r0, r1 } = geo(), A = arms(), col = COLORS[slot()], t = now / 1000; g.clearRect(0, 0, W, H); wob *= held.size ? 0.985 : 0.95; if (held.size) wob = Math.max(wob, 0.5);
    for (const k of [0.33, 0.66, 1]) { g.strokeStyle = '#ffffff0e'; g.lineWidth = 1; g.beginPath(); g.arc(cx, cy, r0 + (r1 - r0) * k, 0, 7); g.stroke(); }
    for (let i = 0; i < 8; i++) { cur[i] += (val(i) - cur[i]) * 0.35; shape[i] = r0 + (r1 - r0) * cur[i]; }
    // a closed curve through the eight arms, breathing with what it plays
    const M = 96, pt = []; for (let j = 0; j < M; j++) { const u = (j / M) * 8, i = Math.floor(u), f = u - i, e = (1 - Math.cos(f * Math.PI)) / 2, r = shape[i % 8] * (1 - e) + shape[(i + 1) % 8] * e, w = Math.sin(j * 0.6 + t * 7) * 2.4 * wob + Math.sin(j * 1.9 - t * 11) * 1.8 * wob + Math.sin(j * 0.26 + t * 1.2) * 1.2, an = (j / M) * Math.PI * 2 - Math.PI / 2; pt.push([cx + Math.cos(an) * (r + w), cy + Math.sin(an) * (r + w)]); }
    g.beginPath(); pt.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); const gr = g.createRadialGradient(cx, cy, r0 * 0.3, cx, cy, r1); gr.addColorStop(0, col + '88'); gr.addColorStop(1, col + '18'); g.fillStyle = gr; g.fill(); g.strokeStyle = col; g.lineWidth = 2; g.stroke();
    g.font = '10px "IBM Plex Mono", monospace'; g.textBaseline = 'middle';
    A.forEach(([, nm], i) => { const a = ang(i), x = cx + Math.cos(a) * shape[i], y = cy + Math.sin(a) * shape[i], act = pull?.i === i; g.fillStyle = act ? '#fff' : col; g.beginPath(); g.arc(x, y, act ? 10 : 6.5, 0, 7); g.fill(); const lx = cx + Math.cos(a) * (r1 + 11), ly = cy + Math.sin(a) * (r1 + 11); g.textAlign = Math.abs(Math.cos(a)) < 0.3 ? 'center' : Math.cos(a) > 0 ? 'left' : 'right'; g.fillStyle = act ? '#fff' : '#a3a6ad'; g.fillText(nm, clamp(lx, 4, W - 4), clamp(ly, 7, H - 7)); });
    if (word && now - wordT < 1100) { g.textAlign = 'center'; g.globalAlpha = Math.min(1, (1100 - (now - wordT)) / 300); g.fillStyle = '#fff'; g.font = 'italic 19px Newsreader, serif'; g.fillText(word[0], cx, cy - (word[1] !== '' ? 8 : 0)); g.font = '11px "IBM Plex Mono", monospace'; g.fillText(String(word[1]), cx, cy + 11); g.globalAlpha = 1; }
    if (breath) { g.strokeStyle = '#fff'; g.lineWidth = 2; g.globalAlpha = 0.2 + breath.lv * 0.8; g.beginPath(); g.arc(cx, cy, r0 * (0.5 + breath.lv), 0, 7); g.stroke(); g.globalAlpha = 1; }
  }
  const echo = () => `mix.${slot() ? 'f' + slot() : 'cloud'}.echo`, play = (el, ms, vel = 0.8) => { if (!el) return; const id = 9000 + Math.random(); on(id, el, vel); setTimeout(() => off(id), ms); };
  S.rooms.play = {
    tilt: (x, y) => { if (!held.size) return; tiltSet(slot() ? (kind() === 'sampler' ? `f${slot()}.s.cutoff` : kind() === 'strings' ? `f${slot()}.t.bright` : `f${slot()}.g.jitter`) : 'cloud.pitch', slot() ? clamp(0.6 + x * 0.4, 0, 1) : Math.round(x * 7), slot() ? 0.02 : 1); tiltSet(echo(), clamp(y, 0, 1) * 0.8, 0.02); },
    shake: () => { arms().forEach(([p]) => P.set(p, r3(clamp((P.get(p) ?? 0.4) + (Math.random() - 0.5) * 0.7, 0.02, 1)))); wob = 1; say('another body', ''); buzz([10, 40, 20]); play(lastPad || pads[COLS * 2], 500); },
    knock: (v) => { if (knock) play(lastPad || pads[0], 220, clamp(v, 0.3, 1)); },
    draw, show: () => { turn(); show(); }, hide: () => { document.body.classList.remove('land'); for (const id of [...held.keys()]) off(id); if (breath) breathOff(); },
  };
  S.inst = { arms, put, get pads() { return pads; } };
}
