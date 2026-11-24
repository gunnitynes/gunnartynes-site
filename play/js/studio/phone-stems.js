// Stems: a table with every instrument on it as a disc, to be pushed about with all ten fingers, thrown, and rolled
// by tilting the phone. In the middle the song is as it is. Left and right is left and right; towards the far edge an
// instrument goes away (quieter, darker, into the room), towards you it comes close. Along the near edge are five
// pools: whatever lies in one is held, reversed, halved, stuttered or sent wandering, from the next bar line, for as
// long as it stays there. With ● on, all of it goes onto the tape: the mix as moves, the pools as pieces.
import { h, $ } from '../lib/util.js';
import { clamp, buzz, surface, POOLS, songBar } from './phone-kit.js';

const ORDER = ['rhythm', 'bass', 'keys', 'guitar', 'synth', 'strings', 'voice', 'other'];
export function buildStems(S, U) {
  const room = $('#p-stems'), { song, params: P, player, seq: q } = S, cb = song.barsPerCell, { toast, askSensors, Motion, srcAt, bpb } = U;
  for (const st of song.stems) P.define(`band.${st.id}.rev`, 0, (v) => S.session.dispatch({ t: 'track/set', id: st.id, p: { rev: 0.06 + v * v * 0.9, lp: 1 - v * 0.34 } }, { log: false }));
  player.over ??= new Map();

  // ---- the song as a strip: tap or drag to go there
  const map = h('div', { class: 'songmap' }), m = surface(map);
  const seekTo = (e) => { const r = map.getBoundingClientRect(), b = clamp(Math.floor(((e.clientX - r.left) / r.width) * q.arr.bars), 0, q.arr.bars - 1); if (b !== seekTo.b) { seekTo.b = b; S.seek(b); buzz(4); } };
  let mapDown = false; map.addEventListener('pointerdown', (e) => { mapDown = true; seekTo.b = -1; try { map.setPointerCapture(e.pointerId); } catch { /* fine */ } seekTo(e); });
  map.addEventListener('pointermove', (e) => mapDown && seekTo(e)); for (const t of ['pointerup', 'pointercancel']) map.addEventListener(t, () => { mapDown = false; });
  const busy = (bar) => { const c = Math.floor(srcAt(bar) / cb); let n = 0; for (const st of song.stems) if (st.cells[c] && st.cells[c].rms > -45) n++; return n; };

  // ---- the table
  const box = h('div', { class: 'table', 'aria-label': 'The instruments on a table' }), T = surface(box), g = T.g, PH = 84;
  let discs = [], R = 25, roll = false, grav = [0, 0], touched = false, tiltAt = 0, stir = 0;
  const TH = () => T.H - PH, poolOf = (d) => (d.y > TH() + 2 ? clamp(Math.floor((d.x / T.W) * POOLS.length), 0, POOLS.length - 1) : -1);
  const words = (n) => { const w = n.split(' '); return (w.length > 1 ? [w[0], w.slice(1).join(' ')] : [n]).map((x) => (x.length > 8 ? x.slice(0, 7) + '…' : x)); };
  function home() {
    // rows by family, in the middle of the table
    const list = [...discs].sort((a, b) => ORDER.indexOf(a.st.group) - ORDER.indexOf(b.st.group) || a.st.order - b.st.order);
    const per = Math.max(3, Math.floor((T.W * 0.58) / (R * 2 + 2))), rows = Math.ceil(list.length / per), gap = Math.min(R * 2 + 4, (TH() * 0.62) / Math.max(1, rows - 1));
    list.forEach((d, i) => { const r = Math.floor(i / per), n = Math.min(per, list.length - r * per), c = i % per; d.hx = T.W / 2 + (c - (n - 1) / 2) * (R * 2 + 3); d.hy = TH() / 2 + (r - (rows - 1) / 2) * gap; });
  }
  function populate() {
    const want = song.stems.filter((st) => !st.voice || st.cells.some(Boolean)), saved = S.tablePos || {};
    R = clamp(T.W / 14.6, 21, 30);
    for (const st of want) if (!discs.some((d) => d.st === st)) discs.push({ st, x: 0, y: 0, vx: 0, vy: 0, pool: -1, held: 0, name: words(st.name), fresh: true, lv: 0 });
    for (const d of discs.filter((x) => !want.includes(x.st))) setPool(d, -1);
    discs = discs.filter((d) => want.includes(d.st)); home();
    for (const d of discs) if (d.fresh) { d.fresh = false; const s = saved[d.st.id]; d.x = s ? s[0] * T.W : d.hx; d.y = s ? s[1] * T.H : d.hy; setPool(d, poolOf(d), true); }
  }
  let lastW = 0, lastH = 0;
  T.on = () => { if (discs.length && lastW && (Math.abs(lastW - T.W) > 1 || Math.abs(lastH - T.H) > 1)) { for (const d of discs) { d.x *= T.W / lastW; d.y *= T.H / lastH; } R = clamp(T.W / 14.6, 21, 30); home(); } lastW = T.W; lastH = T.H; if (!discs.length) populate(); };
  S.tableDump = () => (T.W && discs.length ? Object.fromEntries(discs.map((d) => [d.st.id, [+(d.x / T.W).toFixed(3), +(d.y / T.H).toFixed(3)]])) : S.tablePos);

  /** What a place on the table means: level, left and right, how much room. */
  function mixOf(d) {
    if (d.pool >= 0) return { gain: 0.85, pan: 0, rev: 0 };
    const nx = d.x / T.W - 0.5, ny = d.y / TH(), far = clamp((0.2 - ny) / 0.13, 0, 1), near = clamp((ny - 0.8) / 0.13, 0, 1);
    return { gain: 0.85 * (1 - 0.9 * far) + 0.4 * near, pan: Math.sign(nx) * clamp((Math.abs(nx) - 0.3) / 0.115, 0, 1) * 0.95, rev: far * 0.8 };
  }
  function commit(d, step = 0.025) { for (const [k, v] of Object.entries(mixOf(d))) { const p = `band.${d.st.id}.${k}`, w = +v.toFixed(3); if (Math.abs((P.get(p) ?? 0) - w) >= step || (step === 0 && P.get(p) !== w)) P.set(p, w); } }
  function setPool(d, i, quiet) {
    if (d.pool === i) return; d.pool = i;
    if (i < 0) player.over.delete(d.st.id);
    else { const tr = S.session.state.tracks[d.st.id], B = player.playing ? player.nextBar : player.pausedBar, w = tr && player.resolveSrc(tr, Math.max(0, B - 1)); player.over.set(d.st.id, POOLS[i][1](S, d.st, B, w)); }
    d.run = null; if (!quiet) { buzz(i >= 0 ? [12, 30, 18] : 8); d.splash = performance.now(); }
  }
  // the pools on the tape: what each stem in one really played, bar by bar
  player.on('bar', ({ bar }) => {
    if (!q.rec || q.mode !== 'song') return; const t = Math.floor(q.tl(bar * bpb()) / bpb()); let wrote = false;
    for (const d of discs) {
      if (d.pool < 0) { d.run = null; continue; }
      const w = player.resolve(S.session.state.tracks[d.st.id], bar); if (!w) { d.run = null; continue; }
      const f = w.fx || {}, src = songBar(S, w) + (f.o || 0), fx = w.fx ? { r: f.r ? 1 : 0, s: f.s || 1, u: f.u || 0, g: f.g ?? 1 } : undefined, key = JSON.stringify(fx || 0), sp = fx?.s || 1;
      const run = d.run;
      if (run && q.arr.clips.includes(run.cl) && run.cl.start + run.cl.len === t && run.key === key && Math.abs(run.cl.src + run.cl.len * sp - src) < 1e-3) run.cl.len++;
      else d.run = { key, cl: q.place({ lane: 'stem:' + d.st.id, start: t, len: 1, src, fx, name: POOLS[d.pool][0].toLowerCase() }) };
      if (t + 1 > q.arr.bars) q.arr.bars = t + 1; wrote = true;
    }
    if (wrote) q.changed();
  });

  // ---- fingers: on a disc, drag and throw it (as many at once as you like); on the bare table, a finger pushes; two
  // fingers on the bare table gather, spread and turn everyone
  const fingers = new Map();
  const at = (e) => { const r = box.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const hit = (x, y) => { let best = null, bd = (R + 9) ** 2; for (const d of discs) { if (d.held) continue; const k = (d.x - x) ** 2 + (d.y - y) ** 2; if (k < bd) { bd = k; best = d; } } return best; };
  box.addEventListener('pointerdown', (e) => {
    e.preventDefault(); try { box.setPointerCapture(e.pointerId); } catch { /* fine */ } const [x, y] = at(e), d = hit(x, y), f = { d, x, y, x0: x, y0: y, t0: performance.now(), path: [[performance.now(), x, y]], moved: false };
    touched = true; fingers.set(e.pointerId, f);
    if (d) { d.held = 1; d.vx = d.vy = 0; f.ox = d.x - x; f.oy = d.y - y; f.timer = setTimeout(() => { if (f.moved) return; f.long = true; const p = `band.${d.st.id}.solo`; P.set(p, !P.get(p)); buzz(25); }, 450); buzz(5); }
  });
  box.addEventListener('pointermove', (e) => {
    const f = fingers.get(e.pointerId); if (!f) return; const [x, y] = at(e);
    if (!f.moved && Math.hypot(x - f.x0, y - f.y0) > 8) { f.moved = true; clearTimeout(f.timer); }
    const bare = [...fingers.values()].filter((k) => !k.d);
    if (!f.d && bare.length === 2) {
      const o = bare.find((k) => k !== f), cx = (f.x + o.x) / 2, cy = (f.y + o.y) / 2, d0 = Math.max(30, Math.hypot(f.x - o.x, f.y - o.y)), d1 = Math.max(30, Math.hypot(x - o.x, y - o.y)), a0 = Math.atan2(f.y - o.y, f.x - o.x), a1 = Math.atan2(y - o.y, x - o.x), k = d1 / d0, c = Math.cos(a1 - a0) * k, s = Math.sin(a1 - a0) * k;
      for (const d of discs) { if (d.held || d.pool >= 0) continue; const dx = d.x - cx, dy = d.y - cy; d.x = clamp(cx + dx * c - dy * s, R, T.W - R); d.y = clamp(cy + dx * s + dy * c, R, TH() - R); d.dirty = true; }
      stir = performance.now();
    }
    f.x = x; f.y = y; f.path.push([performance.now(), x, y]); if (f.path.length > 8) f.path.shift();
    if (f.d && f.moved) { f.d.x = clamp(x + f.ox, R, T.W - R); f.d.y = clamp(y + f.oy, R, T.H - R); f.d.dirty = true; }
  });
  const up = (e) => {
    const f = fingers.get(e.pointerId); if (!f) return; fingers.delete(e.pointerId); clearTimeout(f.timer); const d = f.d; if (!d) return;
    d.held = 0; if (f.long) return;
    if (!f.moved) { if (performance.now() - f.t0 < 420) { const p = `band.${d.st.id}.mute`; P.set(p, !P.get(p)); buzz(8); } return; }
    const n = performance.now(), old = f.path.find((k) => n - k[0] < 90); if (old && n - old[0] > 8) { const k = 1000 / (n - old[0]); d.vx = clamp((f.x - old[1]) * k, -2200, 2200); d.vy = clamp((f.y - old[2]) * k, -2200, 2200); }
  };
  box.addEventListener('pointerup', up); box.addEventListener('pointercancel', up); box.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---- physics
  let last = 0, sound = 0;
  function step(now) {
    const dt = Math.min(0.033, (now - last) / 1000 || 0.016); last = now; if (!T.W) return;
    const th = TH(), pw = T.W / POOLS.length, push = [...fingers.values()].filter((f) => !f.d && f.moved), busyT = roll || push.length || now - stir < 400;
    let any = busyT;
    for (const d of discs) {
      if (d.held) { any = true; continue; }
      if (roll) { d.vx += grav[0] * 1500 * dt; d.vy += grav[1] * 1500 * dt; }
      else if (d.y > th + 2) { const i = clamp(Math.floor(d.x / pw), 0, POOLS.length - 1), others = discs.filter((o) => o !== d && o.y > th + 2 && Math.floor(o.x / pw) === i).length; if (!others) { d.vx += ((i + 0.5) * pw - d.x) * 9 * dt; d.vy += (th + PH * 0.46 - d.y) * 9 * dt; } }
      for (const f of push) { const dx = d.x - f.x, dy = d.y - f.y, l = Math.hypot(dx, dy) || 1, o = R + 24 - l; if (o > 0) { d.x += (dx / l) * o; d.y += (dy / l) * o; d.vx += (dx / l) * o * 14; d.vy += (dy / l) * o * 14; d.dirty = true; } }
      const k = Math.exp(-dt * (roll ? 1.1 : 3.4)); d.vx *= k; d.vy *= k;
      if (Math.abs(d.vx) + Math.abs(d.vy) < 4 && !roll) { d.vx = d.vy = 0; continue; }
      any = true; d.dirty = true; d.x += d.vx * dt; d.y += d.vy * dt;
      const wall = (v) => { if (Math.abs(v) > 260 && now - sound > 60) { sound = now; buzz(Math.min(14, Math.abs(v) / 90)); } return -v * 0.55; };
      if (d.x < R) { d.x = R; d.vx = wall(d.vx); } else if (d.x > T.W - R) { d.x = T.W - R; d.vx = wall(d.vx); }
      if (d.y < R) { d.y = R; d.vy = wall(d.vy); } else if (d.y > T.H - R) { d.y = T.H - R; d.vy = wall(d.vy); }
    }
    if (any) for (let i = 0; i < discs.length; i++) for (let j = i + 1; j < discs.length; j++) {
      const a = discs[i], b = discs[j], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy, min = R * 2; if (l2 >= min * min) continue;
      const l = Math.sqrt(l2) || 0.01, nx = dx / l, ny = dy / l, o = (min - l) / (a.held || b.held ? 1 : 2);
      if (!a.held) { a.x -= nx * o; a.y -= ny * o; a.dirty = true; } if (!b.held) { b.x += nx * o; b.y += ny * o; b.dirty = true; }
      const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny; if (rv < 0) { const im = -rv * 0.75; if (!a.held) { a.vx -= im * nx; a.vy -= im * ny; } if (!b.held) { b.vx += im * nx; b.vy += im * ny; } }
    }
    for (const d of discs) { d.x = clamp(d.x, R, T.W - R); d.y = clamp(d.y, R, T.H - R); if (!d.held || d.dirty) setPool(d, poolOf(d)); }
    if (now - tiltAt > 70) { tiltAt = now; for (const d of discs) if (d.dirty) { const still = !d.held && Math.abs(d.vx) + Math.abs(d.vy) < 4; commit(d, still ? 0 : 0.03); if (still) d.dirty = false; } }
  }

  // ---- buttons: roll, line up
  const rollB = h('button', { type: 'button', class: 'chip roll', title: 'Tilt the phone and everything rolls' }, 'Roll');
  rollB.onclick = async () => { if (!Motion.got) { await askSensors(); Motion.set(true); await new Promise((r) => setTimeout(r, 350)); } if (!Motion.got) { toast('Rolling needs the phone’s motion sensors'); return; } if (!Motion.on) Motion.set(true); Motion.b0 = null; roll = !roll; grav = [0, 0]; rollB.setAttribute('aria-pressed', roll); buzz(12); if (roll) toast('Tilt: they roll · throw one into a pool'); };
  const lineB = h('button', { type: 'button', class: 'chip', title: 'Everyone back to the middle: the song as it is', onclick: () => { roll = false; rollB.setAttribute('aria-pressed', false); home(); for (const d of discs) { setPool(d, -1, true); d.line = performance.now(); d.vx = d.vy = 0; } for (const st of song.stems) { P.set(`band.${st.id}.mute`, false); P.set(`band.${st.id}.solo`, false); } buzz(15); } }, 'Line up');
  room.append(h('div', { class: 'head row' }, h('h2', {}, 'Stems'), h('span', { class: 'sp' }), rollB, lineB), map, box);

  // ---- drawing
  const rr = (x, y, w, hh, r) => { g.beginPath(); g.roundRect(x, y, w, hh, r); };
  let voiceHad = false;
  function draw() {
    const now = performance.now(), hasVoice = song.stems.some((x) => x.voice && x.cells.some(Boolean)); if (hasVoice !== voiceHad && T.W) { voiceHad = hasVoice; populate(); }
    for (const d of discs) if (d.line) { const k = Math.min(1, (now - d.line) / 450); d.x += (d.hx - d.x) * (0.1 + k * 0.5); d.y += (d.hy - d.y) * (0.1 + k * 0.5); d.vx = d.vy = 0; d.dirty = true; if (k === 1) { d.x = d.hx; d.y = d.hy; d.line = 0; } }
    step(now); if (!T.W) return; const W = T.W, th = TH(), pw = W / POOLS.length; g.clearRect(0, 0, W, T.H);
    // the far edge (the room) and the near one
    let gr = g.createLinearGradient(0, 0, 0, th); gr.addColorStop(0, '#22304e88'); gr.addColorStop(0.24, '#14192700'); gr.addColorStop(0.8, '#14192700'); gr.addColorStop(1, '#e6b45014'); g.fillStyle = gr; g.fillRect(0, 0, W, th);
    g.strokeStyle = '#ffffff12'; g.lineWidth = 1; rr(W * 0.2, th * 0.2, W * 0.6, th * 0.6, 26); g.stroke();
    g.font = '9.5px "IBM Plex Mono", monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#7f8694'; g.fillText('FAR', W / 2, 12); g.fillText('CLOSE', W / 2, th - 10);
    g.save(); g.translate(10, th / 2); g.rotate(-Math.PI / 2); g.fillText('LEFT', 0, 0); g.restore(); g.save(); g.translate(W - 10, th / 2); g.rotate(Math.PI / 2); g.fillText('RIGHT', 0, 0); g.restore();
    // pools
    POOLS.forEach(([nm], i) => {
      const inside = discs.filter((d) => d.pool === i), x = i * pw, sp = clamp(Math.max(0, ...inside.map((d) => 1 - (now - (d.splash || -1e6)) / 700)), 0, 1), cx = x + pw / 2, cy = th + PH * 0.46;
      g.fillStyle = inside.length ? '#e6b45026' : '#ffffff08'; rr(x + 3, th + 4, pw - 6, PH - 8, 16); g.fill(); g.strokeStyle = inside.length ? '#e6b450' : '#ffffff22'; g.stroke();
      g.save(); rr(x + 3, th + 4, pw - 6, PH - 8, 16); g.clip(); g.strokeStyle = inside.length ? '#e6b45088' : '#ffffff1c'; const t = now / 1000;
      for (let k = 0; k < 4; k++) { g.beginPath(); if (i === 0) { g.arc(cx, cy, 7 + k * 9, 0, 7); } else if (i === 1) { const r = 6 + k * 9; g.arc(cx, cy, r, -t * 1.5 + k, -t * 1.5 + k + 4.2); } else if (i === 2) { for (let u = 0; u <= pw; u += 4) g.lineTo(x + u, cy - 20 + k * 13 + Math.sin(u * 0.06 + t) * 5); } else if (i === 3) { for (let u = 0; u < 6; u++) { g.moveTo(x + 8 + u * 10, cy - 22 + k * 14); g.lineTo(x + 12 + u * 10, cy - 22 + k * 14); } } else { const a = t * 0.7 + k * 1.7; g.moveTo(cx, cy); g.quadraticCurveTo(cx + Math.cos(a) * 30, cy + Math.sin(a * 1.3) * 24, cx + Math.cos(a * 2) * 32, cy + Math.sin(a) * 28); } g.stroke(); }
      if (sp > 0) { g.globalAlpha = sp; g.strokeStyle = '#fff'; g.beginPath(); g.arc(cx, cy, (1 - sp) * 50, 0, 7); g.stroke(); g.globalAlpha = 1; } g.restore();
      g.fillStyle = inside.length ? '#e6b450' : '#a3a6ad'; g.font = '10px "IBM Plex Mono", monospace'; g.fillText(nm.toUpperCase(), cx, th + PH - 14);
    });
    // discs
    const solo = discs.some((d) => P.get(`band.${d.st.id}.solo`));
    for (const d of discs) {
      const ch = S.engine.channels.get(d.st.id); d.lv = ch ? Math.min(1, ch.readLevel() * 3.4) : 0;
      const off = P.get(`band.${d.st.id}.mute`) || (solo && !P.get(`band.${d.st.id}.solo`)), so = P.get(`band.${d.st.id}.solo`), col = d.st.color || '#ece8dc', far = clamp((0.2 - d.y / th) / 0.2, 0, 1), rad = R * (1 - far * 0.22) * (d.held ? 1.1 : 1);
      if (!off && d.lv > 0.02) { const gl = g.createRadialGradient(d.x, d.y, rad * 0.6, d.x, d.y, rad + 8 + d.lv * 20); gl.addColorStop(0, col); gl.addColorStop(1, 'transparent'); g.globalAlpha = 0.14 + d.lv * 0.5; g.fillStyle = gl; g.beginPath(); g.arc(d.x, d.y, rad + 8 + d.lv * 20, 0, 7); g.fill(); g.globalAlpha = 1; }
      g.fillStyle = '#12161f'; g.beginPath(); g.arc(d.x, d.y, rad, 0, 7); g.fill();
      g.globalAlpha = off ? 0.05 : (0.3 + d.lv * 0.55) * (1 - far * 0.45); g.fillStyle = col; g.fill(); g.globalAlpha = off ? 0.3 : 1; g.strokeStyle = so ? '#fff' : col; g.lineWidth = so ? 3 : d.held ? 2.5 : 1.4; g.stroke();
      g.fillStyle = off ? '#a3a6ad' : '#fff'; g.font = '8.6px "Instrument Sans", sans-serif'; d.name.forEach((w, i) => g.fillText(w, d.x, d.y + (i - (d.name.length - 1) / 2) * 10)); g.globalAlpha = 1;
    }
    for (const f of fingers.values()) if (!f.d && f.moved) { g.strokeStyle = '#ffffff55'; g.beginPath(); g.arc(f.x, f.y, 24, 0, 7); g.stroke(); }
    if (!touched) { g.fillStyle = '#d6d2c6'; g.font = 'italic 17px Newsreader, serif'; g.fillText('push them, throw them, drop one in a pool', W / 2, th * 0.895); }
    drawMap();
  }
  function drawMap() {
    const mg = m.g; if (!m.W) return; const n = Math.max(1, q.arr.bars), bw = m.W / n, top = 13, hh = m.H - top - 2; mg.clearRect(0, 0, m.W, m.H);
    for (let b = 0; b < n; b++) { mg.fillStyle = '#ece8dc30'; const y = hh * Math.min(1, busy(b) / 14); mg.fillRect(b * bw, top + hh - y, Math.max(1, bw - 0.6), y); }
    mg.font = '9px "IBM Plex Mono", monospace'; mg.textBaseline = 'top'; for (const c of q.arr.clips) if (c.lane === 'band') { mg.fillStyle = '#ffffff30'; mg.fillRect(c.start * bw, 0, 1, m.H); if (c.name && c.len * bw > 14) { mg.fillStyle = '#a3a6ad'; mg.fillText(c.name, c.start * bw + 3, 1); } }
    if (q.arr.cycle) { mg.fillStyle = '#e6b45024'; mg.fillRect(q.arr.cycle[0] * bw, 0, (q.arr.cycle[1] - q.arr.cycle[0]) * bw, m.H); }
    mg.fillStyle = q.rec ? '#df8a74' : '#e6b450'; mg.fillRect((q.tl(q.nowBeat()) / bpb()) * bw - 1, 0, 2, m.H);
  }
  S.rooms.stems = {
    tilt: (x, y) => { grav = [x, -y]; },
    shake: () => { touched = true; for (const d of discs) { if (d.held) continue; const a = Math.random() * 7, v = 500 + Math.random() * 900; d.vx += Math.cos(a) * v; d.vy += Math.sin(a) * v * 0.7; } toast('Shaken'); },
    draw, show: () => { if (T.W && !discs.length) populate(); }, hide: () => { if (roll) { roll = false; rollB.setAttribute('aria-pressed', false); } },
  };
  S.table = { get discs() { return discs; }, TH, get T() { return T; }, get R() { return R; } };
}
