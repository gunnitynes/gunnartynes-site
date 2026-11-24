// The way in. One moment of the song (four bars that loop), every musician who plays in it as a light: touch one and
// it joins in on the beat, touch again and it rests. Drag a light towards the middle and it comes closer (louder,
// brighter), out to the edge and it goes away; left and right is left and right. Nothing sounds until you touch.
// What you woke goes with you: the studio keeps it as a Re-arrange snapshot (see `hello` in studio/main.js).
import { api, h, $ } from './lib/util.js';

const STILL = matchMedia('(prefers-reduced-motion: reduce)').matches;
const PHONE = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const stage = $('#stage'), sky = $('#sky'), g = sky.getContext('2d'), box = $('#lights'), hint = $('#hint');

let ctx = null, master = null, song = null, moments = [], moment = 0, lights = [], t0 = null, token = 0, W = 0, H = 0;
const bufs = new Map();   // url → Promise<AudioBuffer>

// ---------------------------------------------------------------- sound
function audio() {
  if (ctx) return ctx;
  ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
  master = ctx.createGain(); master.gain.value = 0.8;
  const glue = ctx.createDynamicsCompressor(); glue.threshold.value = -14; glue.ratio.value = 3; glue.attack.value = 0.01; glue.release.value = 0.2;
  const lim = ctx.createDynamicsCompressor(); lim.threshold.value = -3; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.1; lim.knee.value = 0;
  master.connect(glue).connect(lim).connect(ctx.destination);
  return ctx;
}
/** Phones let sound start only from a finished touch; iPhones also need a media element once (the ringer switch). */
function unlock() {
  const c = audio(); if (c.state !== 'running') c.resume();
  if (unlock.done) return; unlock.done = true;
  try { const a = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAABErAAABAAgAZGF0YQAAAAA='); a.playsInline = true; a.play().catch(() => {}); } catch { /* fine */ }
}
function load(url) {
  if (!bufs.has(url)) bufs.set(url, fetch(url).then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); }).then((ab) => audio().decodeAudioData(ab)).catch((e) => { bufs.delete(url); throw e; }));
  return bufs.get(url);
}
/** Does this stem really play in this cell (at least three of its bars, the first among them)? So a touch is heard at once. */
const plays = (st, c) => { const x = st.cells[c]; if (!x || x.rms < -42) return false; const cb = song.barsPerCell, db = st.barDb?.slice(c * cb, (c + 1) * cb); return !db?.length || (db[0] > -44 && db.filter((v) => v > -46).length >= Math.min(3, db.length)); };
const urlOf = (l, m = moment) => l.st.cells[moments[m].cell]?.url;
/** The next beat, on the clock the first light started. */
function nextBeat() { const c = ctx.currentTime + 0.04; if (t0 === null) { t0 = c + 0.03; return t0; } return t0 + Math.ceil((c - t0) / song.beatDur) * song.beatDur; }
function place(l, t = ctx.currentTime, tc = 0.06) {
  if (!l.v) return; const near = clamp((1.25 - l.r) / 0.85, 0, 1);
  l.v.lp.frequency.setTargetAtTime(1500 * 13 ** near, t, tc); l.v.g.gain.setTargetAtTime(0.28 + 0.95 * near ** 1.4, t, tc); l.v.pan?.pan.setTargetAtTime(clamp(Math.sin(l.a) * l.r * 0.8, -1, 1), t, tc);
}
/** A quiet instrument is lifted a little here, so waking it alone is heard. */
const vol = (l) => (l.st.gain ?? 1) * clamp(10 ** ((-21 - (l.st.cells[moments[moment].cell]?.rms ?? -21)) / 40), 1, 2.4);
function start(l, buf, t) {
  const c = ctx, src = c.createBufferSource(); src.buffer = buf; src.loop = true; src.loopEnd = Math.min(buf.duration, song.cellDur);
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.4; const gn = c.createGain(), env = c.createGain(), an = c.createAnalyser(); an.fftSize = 512;
  const pan = c.createStereoPanner ? c.createStereoPanner() : null;
  src.connect(lp).connect(gn).connect(env); if (pan) env.connect(pan).connect(master); else env.connect(master); env.connect(an);
  env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(vol(l), t + 0.02);
  src.start(t, (((t - t0) % song.cellDur) + song.cellDur) % song.cellDur);
  l.v = { vol: vol(l), src, lp, g: gn, env, an, pan, data: new Float32Array(512), at: t }; place(l, c.currentTime, 0.001);
}
function stop(l, t = ctx?.currentTime ?? 0, fade = 0.2) {
  const v = l.v; l.v = null; if (!v) return;
  v.env.gain.cancelScheduledValues(t); v.env.gain.setValueAtTime(t > ctx.currentTime + 0.01 ? v.vol : v.env.gain.value, t); v.env.gain.linearRampToValueAtTime(0, t + fade); v.src.stop(t + fade + 0.02);
  v.src.onended = () => { for (const n of [v.src, v.lp, v.g, v.env, v.an, v.pan]) n?.disconnect(); };
}

// ---------------------------------------------------------------- lights
async function wake(l) {
  if (l.on) return; l.on = true; unlock();
  l.el.setAttribute('aria-pressed', 'true'); l.el.classList.add('arming'); ripple(l); tell();
  const my = ++l.n, tk = token;
  try {
    const buf = await load(urlOf(l));
    if (!l.on || my !== l.n || tk !== token) return;
    const t = nextBeat(); start(l, buf, t); setTimeout(() => ripple(l), Math.max(0, (t - ctx.currentTime) * 1000));
    l.el.classList.remove('arming');
  } catch { l.on = false; l.el.classList.remove('arming'); l.el.setAttribute('aria-pressed', 'false'); tell(); }
}
function rest(l) { if (!l.on) return; l.on = false; l.n++; l.el.classList.remove('arming'); l.el.setAttribute('aria-pressed', 'false'); stop(l); if (!lights.some((x) => x.on)) t0 = null; tell(); }
const awake = () => lights.filter((l) => l.on);
function tell() {
  const n = awake().length;
  hint.textContent = n === 0 ? 'Touch a light' : n === 1 ? 'Wake another' : n === 2 ? 'And another' : n < 5 ? 'Drag one closer' : n === lights.length ? 'All of them' : 'It’s yours';
  document.body.classList.toggle('ready', n >= 3);
}
const ripples = [];
function ripple(l) { if (!STILL) ripples.push({ l, t: performance.now() }); }

function makeLights() {
  for (const l of lights) stop(l);
  box.replaceChildren();
  const sts = song.stems.filter((st) => plays(st, moments[moment].cell));
  const keep = new Map(lights.map((l) => [l.st.id, l]));
  // neighbours on the ring come from different families, so any few lights in a row already make music together
  const fam = {}; for (const s of sts) (fam[s.group] ??= []).push(s);
  const order = []; const qs = Object.values(fam).sort((a, b) => b.length - a.length); while (order.length < sts.length) for (const q of qs) if (q.length) order.push(q.shift());
  lights = order.map((st, i) => {
    const was = keep.get(st.id), a = (i / order.length) * Math.PI * 2 + 0.25, r = 0.8 + (i % 2 ? 0.12 : -0.1);
    const l = { st, a: was?.moved ? was.a : a, r: was?.moved ? was.r : r, moved: was?.moved, on: false, n: 0, lv: 0, ph: i * 1.7, x: 0, y: 0 };
    l.el = h('button', { type: 'button', class: 'light', 'aria-pressed': 'false', 'aria-label': `${st.name}: wake or rest`, style: { '--c': st.color || '#ece8dc' } }, h('i'), h('span', {}, st.name));
    let d = null, dragged = false;
    l.el.addEventListener('pointerdown', (e) => { if (e.button) return; d = { x: e.clientX, y: e.clientY }; dragged = false; try { l.el.setPointerCapture(e.pointerId); } catch { /* fine */ } });
    l.el.addEventListener('pointermove', (e) => {
      if (!d) return; if (!dragged && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 9) return;
      dragged = true; l.held = l.moved = true; l.el.classList.add('held');
      const b = stage.getBoundingClientRect(), { cx, cy, rx, ry } = geo(), dx = (e.clientX - b.left - cx) / rx, dy = (e.clientY - b.top - cy) / ry;
      l.a = Math.atan2(dx, -dy); l.r = clamp(Math.hypot(dx, dy), 0.34, 1.06); place(l);
    });
    const up = () => { if (!d) return; d = null; l.held = false; l.el.classList.remove('held'); if (dragged) { unlock(); wake(l); } };
    l.el.addEventListener('pointerup', up); l.el.addEventListener('pointercancel', () => { d = null; l.held = false; l.el.classList.remove('held'); });
    l.el.addEventListener('click', () => { if (dragged) { dragged = false; return; } unlock(); l.on ? rest(l) : wake(l); });
    l.el.addEventListener('contextmenu', (e) => e.preventDefault());
    box.append(l.el);
    return l;
  });
  tell();
}
/** Another moment of the song: whoever is awake carries on there, on the next bar line. */
async function goTo(i) {
  if (i === moment) return;
  const was = awake().map((l) => l.st.id), old = lights.filter((l) => l.v), my = ++token, bar = song.barDur;
  showMoments(i);
  const cell = moments[i].cell, next = song.stems.filter((st) => was.includes(st.id) && plays(st, cell));
  try { await Promise.all(next.map((st) => load(st.cells[cell].url))); } catch { showMoments(moment); return; }
  if (my !== token) return;
  moment = i; token++;
  const c = ctx, T = c && t0 !== null ? t0 + Math.ceil((c.currentTime + 0.08 - t0) / bar) * bar : null;
  const ringing = old.filter((l) => l.v);
  for (const l of ringing) { stop(l, T ?? c.currentTime, 0.03); }
  makeLights();
  if (T !== null) t0 = T; else if (next.length) { t0 = null; nextBeat(); }
  for (const l of lights) if (next.some((st) => st.id === l.st.id)) { const buf = await load(urlOf(l)); l.on = true; l.n++; l.el.setAttribute('aria-pressed', 'true'); start(l, buf, Math.max(T ?? t0, c.currentTime + 0.02)); ripple(l); }
  if (!lights.some((l) => l.on)) t0 = null;
  tell(); preload();
}
function showMoments(i) { [...document.querySelectorAll('#moments button')].forEach((b, k) => b.setAttribute('aria-pressed', String(k === i))); }

// ---------------------------------------------------------------- drawing
function geo() { const small = W < 560; return { cx: W / 2, cy: H / 2 - (small ? 22 : 18), rx: Math.max(90, W / 2 - (small ? 46 : 86)), ry: Math.max(100, H / 2 - (small ? 74 : 92)) }; }
new ResizeObserver(() => { const r = stage.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1); W = r.width; H = r.height; sky.width = W * d; sky.height = H * d; g.setTransform(d, 0, 0, d, 0, 0); const { cx, cy } = geo(), core = $('#core'); core.style.left = cx + 'px'; core.style.top = cy + 'px'; }).observe(stage);
const stars = Array.from({ length: 90 }, () => [Math.random(), Math.random(), Math.random()]);
let seen = true; new IntersectionObserver((e) => { seen = e[0].isIntersecting; }).observe(stage);
function frame(now) {
  requestAnimationFrame(frame); if (!seen || !W || !song) return;
  const { cx, cy, rx, ry } = geo(), s = now / 1000; g.clearRect(0, 0, W, H);
  for (const [u, v, k] of stars) { g.globalAlpha = 0.1 + 0.16 * (STILL ? 0.5 : 0.5 + 0.5 * Math.sin(s * (0.3 + k) + k * 9)); g.fillStyle = '#ece8dc'; g.beginPath(); g.arc(u * W, v * H, 0.6 + k, 0, 7); g.fill(); }
  g.globalAlpha = 1;
  let sum = 0;
  for (const l of lights) {
    let lv = 0;
    if (l.v) { l.v.an.getFloatTimeDomainData(l.v.data); for (const x of l.v.data) lv += x * x; lv = Math.min(1, (Math.sqrt(lv / 512) * 5) ** 0.6); }
    l.lv = Math.max(lv, l.lv * 0.9); sum += l.lv;
    const dr = STILL || l.held ? 0 : 1, a = l.a + dr * Math.sin(s * 0.21 + l.ph) * 0.035, r = l.r + dr * Math.sin(s * 0.33 + l.ph * 2) * 0.02;
    l.x = cx + Math.sin(a) * rx * r; l.y = cy - Math.cos(a) * ry * r;
    l.el.style.transform = `translate(${l.x.toFixed(1)}px,${l.y.toFixed(1)}px) scale(${(1 + l.lv * 0.22).toFixed(3)})`;
  }
  // threads between everyone awake, and to the middle
  const on = lights.filter((l) => l.on); g.lineWidth = 1;
  for (let i = 0; i < on.length; i++) {
    const l = on[i]; g.strokeStyle = l.st.color || '#ece8dc'; g.globalAlpha = 0.16 + l.lv * 0.6; g.beginPath(); g.moveTo(cx, cy); g.quadraticCurveTo((cx + l.x) / 2 + Math.sin(s + l.ph) * 14, (cy + l.y) / 2 + Math.cos(s + l.ph) * 14, l.x, l.y); g.stroke();
    if (on.length > 1) { const m = on[(i + 1) % on.length]; g.globalAlpha = 0.1 + (l.lv + m.lv) * 0.18; g.beginPath(); g.moveTo(l.x, l.y); g.lineTo(m.x, m.y); g.stroke(); }
  }
  for (const l of on) { const R = 40 + l.lv * 70, gr = g.createRadialGradient(l.x, l.y, 0, l.x, l.y, R); gr.addColorStop(0, l.st.color || '#ece8dc'); gr.addColorStop(1, 'transparent'); g.globalAlpha = 0.16 + l.lv * 0.42; g.fillStyle = gr; g.beginPath(); g.arc(l.x, l.y, R, 0, 7); g.fill(); }
  for (let i = ripples.length - 1; i >= 0; i--) { const q = ripples[i], k = (now - q.t) / 1100; if (k >= 1 || k < 0) { if (k >= 1) ripples.splice(i, 1); continue; } g.globalAlpha = (1 - k) * 0.6; g.strokeStyle = q.l.st.color || '#ece8dc'; g.beginPath(); g.arc(q.l.x, q.l.y, 20 + k * 110, 0, 7); g.stroke(); }
  // the middle: the loop going round, and how much is sounding
  const R = W < 560 ? 48 : 70; g.globalAlpha = 0.22; g.strokeStyle = '#ece8dc'; g.beginPath(); g.arc(cx, cy, R, 0, 7); g.stroke();
  if (ctx && t0 !== null && ctx.currentTime >= t0) {
    const p = ((ctx.currentTime - t0) % song.cellDur) / song.cellDur, beat = ((ctx.currentTime - t0) / song.beatDur) % 1; g.globalAlpha = 1; g.strokeStyle = '#e6b450'; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2); g.stroke();
    g.globalAlpha = 0.05 + 0.1 * (1 - beat); g.fillStyle = '#e6b450'; g.beginPath(); g.arc(cx, cy, R + 4 + Math.min(1, sum / 3) * 26, 0, 7); g.fill();
  } else if (!STILL) { const k = (s % 2.6) / 2.6; g.globalAlpha = (1 - k) * 0.3; g.strokeStyle = '#e6b450'; g.beginPath(); g.arc(cx, cy, R + k * 60, 0, 7); g.stroke(); }
  g.globalAlpha = 1;
}

// ---------------------------------------------------------------- the song(s)
function preload() {
  // quietly fetch the lights' sounds, so a touch answers at once (not for people saving data)
  if (navigator.connection?.saveData) return;
  const tk = token, list = lights.map((l) => urlOf(l)); let i = 0;
  const go = () => { if (tk !== token || i >= list.length) return; load(list[i++]).catch(() => {}).then(go); }; go(); go();
}
async function pick(id) {
  for (const l of lights) stop(l); lights = []; t0 = null; token++;
  song = await api.get(`/api/songs/${id}`);
  // the fullest moment of each part of the song, at most four, in the song's own order
  const full = (c) => song.stems.filter((st) => plays(st, c)).length, best = [];
  for (const s of song.sections) { let b = null; for (let c = s.startCell; c < s.endCell; c++) { const n = full(c); if (n >= 3 && (!b || n > b.n)) b = { cell: c, n, name: s.name }; } if (b) best.push(b); }
  if (!best.length) { let c = 0; for (let k = 0; k < song.numCells; k++) if (full(k) > full(c)) c = k; best.push({ cell: c, n: full(c), name: '1' }); }
  const top = [...best].sort((a, b) => b.n - a.n); moments = top.slice(0, 4).sort((a, b) => a.cell - b.cell); moment = moments.indexOf(top[0]);
  const base = PHONE ? 'phone.html' : 'play.html', href = `${base}?song=${song.id}`;
  $('#s-title').textContent = $('#b-title').textContent = song.title; $('#s-meta').textContent = `${song.artist} · ${song.stems.length} stems`;
  for (const a of [$('#cta'), $('#bar')]) a.href = href;
  $('#moments').replaceChildren(...(moments.length > 1 ? [h('small', {}, 'Moment'), ...moments.map((m, i) => h('button', { type: 'button', 'aria-label': `Part ${m.name} of the song`, 'aria-pressed': String(i === moment), onclick: () => goTo(i) }, m.name))] : []));
  makeLights(); preload(); tiles(href);
}
/** What you woke goes with you (the studio keeps it as a Re-arrange snapshot). */
function carry() { const on = awake(); try { if (on.length) sessionStorage.setItem('playground.hello', JSON.stringify({ song: song.id, cell: moments[moment].cell, stems: on.map((l) => l.st.id) })); else sessionStorage.removeItem('playground.hello'); } catch { /* private */ } }
function leave(e) {
  const a = e.currentTarget; if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
  carry(); if (!ctx || !awake().length) return;
  e.preventDefault(); master.gain.setTargetAtTime(0, ctx.currentTime, 0.07); setTimeout(() => { location.href = a.href; }, 240);
}
for (const a of [$('#cta'), $('#bar')]) a.addEventListener('click', leave);
addEventListener('pagehide', () => { for (const l of lights) rest(l); ctx?.suspend(); });
addEventListener('pageshow', (e) => { if (e.persisted && master) { master.gain.cancelScheduledValues(0); master.gain.value = 0.8; } });
document.addEventListener('visibilitychange', () => { if (!ctx) return; document.hidden ? ctx.suspend() : awake().length && ctx.resume(); });

// ---------------------------------------------------------------- what is inside: small moving pictures
const COL = ['#ffb59e', '#ff8fb1', '#ffe59a', '#ffcf8a', '#9ff0d0', '#a8d8ff'];
const TILES = [
  ['Re-arrange', 'Every stem cut into blocks. Make one stay while the others go on.', { room: 'arrange' }, { page: 'stems' }, (c, w, hh, t) => { const n = 12, r = 5, bw = w / n, bh = hh / r; for (let y = 0; y < r; y++) for (let x = 0; x < n; x++) { const hold = Math.floor(t * 0.45 + y * 2.3) % n, play = Math.floor(t * 1.6) % n; c.globalAlpha = x === hold ? 1 : x === play ? 0.55 : 0.16 + ((x * 7 + y * 5) % 5) * 0.03; c.fillStyle = x === hold ? '#e6b450' : '#ece8dc'; c.fillRect(x * bw + 1.5, y * bh + 1.5, bw - 3, bh - 3); } }],
  ['Cloud', 'The sound broken into grains you scatter with a finger.', { room: 'cloud' }, { page: 'cloud' }, (c, w, hh, t) => { const px = w * (0.5 + 0.34 * Math.sin(t * 0.5)); for (let i = 0; i < 90; i++) { const k = (t * 0.5 + i * 0.137) % 1, a = i * 2.4, d = k * (24 + (i % 7) * 9); c.globalAlpha = (1 - k) * 0.9; c.fillStyle = '#e6b450'; c.beginPath(); c.arc(px + Math.cos(a) * d, hh / 2 + Math.sin(a) * d * 0.8, 1.2 + (i % 3), 0, 7); c.fill(); } }],
  ['Instruments', 'Any second of any stem becomes something to play.', { room: 'forge' }, { page: 'play' }, (c, w, hh, t) => { const n = 7, r = 3, bw = w / n, bh = hh / r, seq = [3, 12, 8, 17, 5, 14, 10, 19], cur = Math.floor(t * 2.4); for (let i = 0; i < n * r; i++) { const age = seq.indexOf(i) < 0 ? 9 : (((cur - seq.indexOf(i)) % 8) + 8) % 8 + (t * 2.4) % 1; c.globalAlpha = 0.14 + Math.max(0, 1 - age * 0.6) * 0.86; c.fillStyle = COL[i % 6]; c.beginPath(); c.roundRect((i % n) * bw + 4, ((i / n) | 0) * bh + 4, bw - 8, bh - 8, 6); c.fill(); } }],
  ['Process', 'One touch bends filter, tape, echo and shimmer together.', { room: 'textures' }, { page: 'process' }, (c, w, hh, t) => { const x = (0.5 + 0.36 * Math.sin(t * 0.7)), y = 0.5 + 0.32 * Math.sin(t * 1.1 + 1); for (let k = 0; k < 5; k++) { c.globalAlpha = 0.75 - k * 0.14; c.strokeStyle = k ? '#ece8dc' : '#e6b450'; c.lineWidth = k ? 1 : 2; c.beginPath(); for (let i = 0; i <= w; i += 4) { const v = Math.sin(i * 0.03 * (1 + x * 2) + t * 2 - k * 0.5) * hh * 0.28 * y + Math.sin(i * 0.11 + t * 3) * hh * 0.1 * x; i ? c.lineTo(i, hh / 2 + v + k * 5) : c.moveTo(i, hh / 2 + v + k * 5); } c.stroke(); } }],
  ['Atlas', 'Every bar of the song as a star. Draw a line through them.', { room: 'song', open: 'atlas' }, { page: 'stems', open: 'atlas' }, (c, w, hh, t) => { const f = (v) => v - Math.floor(v), P = (i) => [(f(Math.sin(i * 12.9898) * 43758.5453) * 0.92 + 0.04) * w, (f(Math.sin(i * 78.233) * 12543.123) * 0.84 + 0.08) * hh]; for (let i = 0; i < 90; i++) { const [x, y] = P(i); c.globalAlpha = 0.5; c.fillStyle = COL[Math.floor((x / w) * 5.9)]; c.beginPath(); c.arc(x, y, 1.4 + (i % 4) * 0.7, 0, 7); c.fill(); } const pts = [4, 31, 12, 57, 20, 73]; c.globalAlpha = 1; c.strokeStyle = '#fff'; c.lineWidth = 1.4; const k = (t * 0.7) % 7; c.beginPath(); pts.forEach((p, i) => { if (i > k) return; const [x, y] = P(p); if (!i) c.moveTo(x, y); else c.lineTo(x, y); }); c.stroke(); pts.forEach((p, i) => { if (i > k) return; const [x, y] = P(p); c.fillStyle = '#fff'; c.beginPath(); c.arc(x, y, 3.6, 0, 7); c.fill(); }); }],
  ['The band answers', 'Play a phrase, leave a space, and the band plays back.', { room: 'song', open: 'more' }, { page: 'play' }, (c, w, hh, t) => { const k = (t * 0.22) % 1, A = [0.62, 0.48, 0.3, 0.4, 0.56], B = [0.56, 0.36, 0.5, 0.28, 0.44]; const row = (xs, off, col, from) => xs.forEach((y, i) => { const on = k > from + i * 0.07; c.globalAlpha = on ? 1 : 0.14; c.fillStyle = col; c.beginPath(); c.roundRect(w * (off + i * 0.075), hh * y, w * 0.06, hh * 0.09, 4); c.fill(); }); row(A, 0.07, '#ece8dc', 0.02); row(B, 0.55, '#e6b450', 0.5); c.globalAlpha = 0.25; c.strokeStyle = '#ece8dc'; c.setLineDash([3, 4]); c.beginPath(); c.moveTo(w / 2, hh * 0.14); c.lineTo(w / 2, hh * 0.86); c.stroke(); c.setLineDash([]); }],
];
let drawn = [];
function tiles() {
  drawn = [];
  $('#tiles').replaceChildren(...TILES.map(([name, text, desk, phone, draw]) => {
    const cv = h('canvas', { 'aria-hidden': 'true' }), q = new URLSearchParams({ song: song.id, ...(PHONE ? phone : desk) });
    const a = h('a', { class: 'tile', href: `${PHONE ? 'phone.html' : 'play.html'}?${q}` }, cv, h('div', {}, h('b', {}, name), h('p', {}, text)));
    a.addEventListener('click', leave); const o = { cv, c: cv.getContext('2d'), draw, seen: false }; drawn.push(o);
    new IntersectionObserver((e) => { o.seen = e[0].isIntersecting; if (o.seen && STILL) paint(o, 3); }).observe(cv);
    return a;
  }));
}
function paint(o, t) { const d = Math.min(2, devicePixelRatio || 1), w = o.cv.clientWidth, hh = o.cv.clientHeight; if (!w) return; if (o.cv.width !== Math.round(w * d)) { o.cv.width = Math.round(w * d); o.cv.height = Math.round(hh * d); } o.c.setTransform(d, 0, 0, d, 0, 0); o.c.clearRect(0, 0, w, hh); o.draw(o.c, w, hh, t); o.c.globalAlpha = 1; }
(function loop() { requestAnimationFrame(loop); if (STILL) return; const t = performance.now() / 1000; for (const o of drawn) if (o.seen) paint(o, t); })();

// ---------------------------------------------------------------- go
(async () => {
  const songs = await api.get('/api/songs');
  if (songs.length > 1) $('#songs').append(...songs.map((s, i) => h('button', { type: 'button', 'aria-pressed': String(!i), onclick: (e) => { [...$('#songs').children].forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); pick(s.id); } }, s.title)));
  await pick(songs[0].id); requestAnimationFrame(frame);
})().catch((e) => { console.error(e); hint.textContent = 'The song could not be loaded'; });
window.start = { get lights() { return lights; }, get ctx() { return ctx; }, get t0() { return t0; }, goTo, get moments() { return moments; } };
