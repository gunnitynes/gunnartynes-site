// Stems: a table with every instrument on it as a disc, to be pushed about with all ten fingers, thrown, and rolled by
// tilting the phone. In the middle the song is as it is. Each of the four edges is an effect you choose: the nearer a
// disc lies to it, the more it takes on, and between two edges it takes on both. The handle on an edge slides along it
// and changes the effect's character for everyone. Pinch a disc and it grows louder or shrinks away. With Orbit on, a
// disc keeps making the movement you made with it, in time. Along the near edge are five pools: whatever lies in one is
// held, reversed, halved, stuttered or sent wandering, for as long as it stays. With ● on it all goes onto the tape.
import { h, $ } from '../lib/util.js';
import { clamp, buzz, surface, POOLS, songBar, MotionLoop } from './phone-kit.js';
import { FX } from './phone-fx.js';

const ORDER = ['rhythm', 'bass', 'keys', 'guitar', 'synth', 'strings', 'voice', 'other'];
export function buildStems(S, U) {
  const room = $('#p-stems'), { song, params: P, player, seq: q } = S, cb = song.barsPerCell, { toast, askSensors, Motion, srcAt, bpb } = U;
  ['dark', 'echo', 'space', 'pulse'].forEach((n, i) => P.define(`edge.${i}`, n));   // 0 left · 1 right · 2 top · 3 bottom
  const edgeFx = (i) => (FX[P.get(`edge.${i}`)] ? P.get(`edge.${i}`) : 'echo');
  player.over ??= new Map();

  // ---- the song as a strip: tap or drag to go there
  const map = h('div', { class: 'songmap' }), m = surface(map);
  const seekTo = (e) => { const r = map.getBoundingClientRect(), b = clamp(Math.floor(((e.clientX - r.left) / r.width) * q.arr.bars), 0, q.arr.bars - 1); if (b !== seekTo.b) { seekTo.b = b; S.seek(b); buzz(4); } };
  let mapDown = false; map.addEventListener('pointerdown', (e) => { mapDown = true; seekTo.b = -1; try { map.setPointerCapture(e.pointerId); } catch { /* fine */ } seekTo(e); });
  map.addEventListener('pointermove', (e) => mapDown && seekTo(e)); for (const t of ['pointerup', 'pointercancel']) map.addEventListener(t, () => { mapDown = false; });
  const busy = (bar) => { const c = Math.floor(srcAt(bar) / cb); let n = 0; for (const st of song.stems) if (st.cells[c] && st.cells[c].rms > -45) n++; return n; };

  // ---- the table
  const box = h('div', { class: 'table', 'aria-label': 'The instruments on a table' }), T = surface(box), g = T.g, PH = 84;
  const E = 25;   // how wide the edges are
  let discs = [], R = 25, roll = false, orbit = false, edgeNow = null, grav = [0, 0], quietAt = 0, tiltAt = 0, stir = 0;
  const TH = () => T.H - PH, rad = (d) => R * d.z, poolOf = (d) => (d.y > TH() + 2 ? clamp(Math.floor((d.x / T.W) * POOLS.length), 0, POOLS.length - 1) : -1);
  const words = (n) => { const w = n.split(' '); return (w.length > 1 ? [w[0], w.slice(1).join(' ')] : [n]).map((x) => (x.length > 8 ? x.slice(0, 7) + '…' : x)); };
  const zOf = (gain) => clamp((gain / 0.85) ** (1 / 2.4), 0.42, 1.34), gainOf = (z) => (z <= 0.43 ? 0 : +(0.85 * z ** 2.4).toFixed(3));
  P.on(({ path, by }) => { if (by === 'user' || !/^band\..+\.gain$/.test(path)) return; const d = discs.find((x) => path === `band.${x.st.id}.gain`); if (d && !d.pinch) d.z = zOf(P.get(path)); });
  function home() {
    // rows by family, in the middle of the table
    const list = [...discs].sort((a, b) => ORDER.indexOf(a.st.group) - ORDER.indexOf(b.st.group) || a.st.order - b.st.order);
    const per = Math.max(3, Math.floor((T.W * 0.58) / (R * 2 + 2))), rows = Math.ceil(list.length / per), gap = Math.min(R * 2 + 4, (TH() * 0.56) / Math.max(1, rows - 1));
    list.forEach((d, i) => { const r = Math.floor(i / per), n = Math.min(per, list.length - r * per), c = i % per; d.hx = T.W / 2 + (c - (n - 1) / 2) * (R * 2 + 3); d.hy = TH() / 2 + (r - (rows - 1) / 2) * gap; });
  }
  function populate() {
    const want = song.stems.filter((st) => !st.voice || st.cells.some(Boolean)), saved = S.tablePos || {};
    R = clamp(T.W / 15, 20, 30);
    for (const st of want) if (!discs.some((d) => d.st === st)) discs.push({ st, x: 0, y: 0, vx: 0, vy: 0, pool: -1, held: 0, z: zOf(P.get(`band.${st.id}.gain`) ?? 0.85), name: words(st.name), fresh: true, lv: 0, ml: new MotionLoop(S) });
    for (const d of discs.filter((x) => !want.includes(x.st))) setPool(d, -1);
    discs = discs.filter((d) => want.includes(d.st)); home();
    for (const d of discs) if (d.fresh) { d.fresh = false; const s = saved[d.st.id]; d.x = s ? s[0] * T.W : d.hx; d.y = s ? s[1] * T.H : d.hy; setPool(d, poolOf(d), true); }
  }
  let lastW = 0, lastH = 0;
  T.on = () => { if (discs.length && lastW && (Math.abs(lastW - T.W) > 1 || Math.abs(lastH - T.H) > 1)) { for (const d of discs) { d.x *= T.W / lastW; d.y *= T.H / lastH; } R = clamp(T.W / 15, 20, 30); home(); stir = performance.now() + 500; } lastW = T.W; lastH = T.H; if (!discs.length) populate(); };
  S.tableDump = () => (T.W && discs.length ? Object.fromEntries(discs.map((d) => [d.st.id, [+(d.x / T.W).toFixed(3), +(d.y / T.H).toFixed(3)]])) : S.tablePos);

  /** What a place on the table means: how much of each edge. Nothing inside the middle; all of it against the edge. */
  function near(d) {
    if (d.pool >= 0 || !T.W) return [0, 0, 0, 0]; const th = TH(), inX = T.W * 0.2, inY = th * 0.2, lim = E + R * 0.6, f = (v, z) => clamp((z - v) / (z - lim), 0, 1);
    return [f(d.x, inX), f(T.W - d.x, inX), f(d.y, inY), f(th - d.y, inY)];
  }
  function commit(d, step = 0.03) {
    const n = near(d), want = {}; for (let i = 0; i < 4; i++) { const e = edgeFx(i); want[e] = Math.max(want[e] || 0, n[i]); }
    for (const e of Object.keys(FX)) { const p = `band.${d.st.id}.fx.${e}`, v = +(want[e] || 0).toFixed(2), c = P.get(p) || 0; if (v !== c && (Math.abs(v - c) >= step || v === 0 || step === 0)) P.set(p, v); }
  }
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
    e.preventDefault(); try { box.setPointerCapture(e.pointerId); } catch { /* fine */ } const [x, y] = at(e), d = hit(x, y);
    const ei = d || y > TH() ? -1 : x < E ? 0 : x > T.W - E ? 1 : y < E ? 2 : y > TH() - E ? 3 : -1;
    if (ei >= 0 && ![...fingers.values()].some((k) => k.d)) { edgeNow = { i: ei, id: e.pointerId, x, y, moved: false }; buzz(5); return; }
    if (!d) { const o = [...fingers.values()].find((k) => k.d && !k.pin && Math.hypot(k.x - x, k.y - y) < 190); if (o) { o.pin = { id: e.pointerId, d0: Math.max(26, Math.hypot(o.x - x, o.y - y)), z0: o.d.z, x, y }; o.d.pinch = true; clearTimeout(o.timer); o.moved = true; buzz(8); return; } }
    const f = { d, x, y, x0: x, y0: y, t0: performance.now(), path: [[performance.now(), x, y]], moved: false };
    fingers.set(e.pointerId, f);
    if (d) { d.held = 1; d.vx = d.vy = 0; d.ml.clear(); d.ml.start(x, y); d.seen = performance.now(); f.ox = d.x - x; f.oy = d.y - y; f.timer = setTimeout(() => { if (f.moved) return; f.long = true; const p = `band.${d.st.id}.solo`; P.set(p, !P.get(p)); buzz(25); }, 450); buzz(5); }
  });
  box.addEventListener('pointermove', (e) => {
    const [x, y] = at(e);
    if (edgeNow?.id === e.pointerId) { const along = edgeNow.i < 2 ? y - edgeNow.y : x - edgeNow.x; if (!edgeNow.moved && Math.abs(along) > 7) edgeNow.moved = true; if (edgeNow.moved) { const n = edgeFx(edgeNow.i), v = clamp(edgeNow.i < 2 ? 1 - (y - 40) / (TH() - 80) : (x - 40) / (T.W - 80), 0, 1), w = Math.round(v * 50) / 50; if (w !== P.get(`edge.k.${n}`)) P.set(`edge.k.${n}`, w); } return; }
    const pf = [...fingers.values()].find((k) => k.pin?.id === e.pointerId || (k.pin && fingers.get(e.pointerId) === k));
    if (pf) { if (pf.pin.id === e.pointerId) { pf.pin.x = x; pf.pin.y = y; } else { pf.x = x; pf.y = y; } const d = pf.d, z = clamp(pf.pin.z0 * (Math.max(20, Math.hypot(pf.x - pf.pin.x, pf.y - pf.pin.y)) / pf.pin.d0), 0.42, 1.34); d.z = z; d.seen = performance.now(); const gn = gainOf(z), gp = `band.${d.st.id}.gain`; if (Math.abs((P.get(gp) ?? 0.85) - gn) > 0.012) P.set(gp, gn); return; }
    const f = fingers.get(e.pointerId); if (!f) return;
    if (!f.moved && Math.hypot(x - f.x0, y - f.y0) > 8) { f.moved = true; clearTimeout(f.timer); }
    const bare = [...fingers.values()].filter((k) => !k.d);
    if (!f.d && bare.length === 2) {
      const o = bare.find((k) => k !== f), cx = (f.x + o.x) / 2, cy = (f.y + o.y) / 2, d0 = Math.max(30, Math.hypot(f.x - o.x, f.y - o.y)), d1 = Math.max(30, Math.hypot(x - o.x, y - o.y)), a0 = Math.atan2(f.y - o.y, f.x - o.x), a1 = Math.atan2(y - o.y, x - o.x), k = d1 / d0, c = Math.cos(a1 - a0) * k, s = Math.sin(a1 - a0) * k;
      for (const d of discs) { if (d.held || d.pool >= 0) continue; const dx = d.x - cx, dy = d.y - cy; d.x = clamp(cx + dx * c - dy * s, R, T.W - R); d.y = clamp(cy + dx * s + dy * c, R, TH() - R); d.dirty = true; }
      stir = performance.now();
    }
    f.x = x; f.y = y; f.path.push([performance.now(), x, y]); if (f.path.length > 8) f.path.shift();
    if (f.d && f.moved) { const q2 = rad(f.d) * 0.7; f.d.x = clamp(x + f.ox, q2, T.W - q2); f.d.y = clamp(y + f.oy, q2, T.H - q2); f.d.dirty = true; f.d.seen = performance.now(); f.d.ml.add(f.d.x, f.d.y); }
  });
  const up = (e) => {
    if (edgeNow?.id === e.pointerId) { const n = edgeNow; edgeNow = null; if (!n.moved) choose(n.i); return; }
    const pf = [...fingers.values()].find((k) => k.pin?.id === e.pointerId); if (pf) { pf.pin = null; pf.pinned = true; pf.d.pinch = false; const [x, y] = at(e); void x; void y; pf.ox = pf.d.x - pf.x; pf.oy = pf.d.y - pf.y; return; }
    const f = fingers.get(e.pointerId); if (!f) return; if (f.pin) { f.d.pinch = false; f.pin = null; f.pinned = true; } fingers.delete(e.pointerId); clearTimeout(f.timer); const d = f.d; if (!d) return;
    d.held = 0; d.seen = performance.now(); if (f.long || f.pinned) { d.ml.clear(); return; }
    if (orbit && f.moved && d.ml.end()) { d.vx = d.vy = 0; buzz(14); toast(`${d.st.name} goes round · touch it to stop`); return; } d.ml.clear();
    if (!f.moved) { if (performance.now() - f.t0 < 420) { const p = `band.${d.st.id}.mute`; P.set(p, !P.get(p)); buzz(8); } return; }
    const n = performance.now(), old = f.path.find((k) => n - k[0] < 90); if (f.pinned) return; if (old && n - old[0] > 8) { const k = 1000 / (n - old[0]); d.vx = clamp((f.x - old[1]) * k, -2200, 2200); d.vy = clamp((f.y - old[2]) * k, -2200, 2200); }
  };
  box.addEventListener('pointerup', up); box.addEventListener('pointercancel', up); box.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---- choosing what an edge does
  function choose(i) {
    const cur = edgeFx(i), sheet = h('div', { class: 'edgepick' }), close = () => { sheet.remove(); };
    sheet.append(h('div', { class: 'edgepick-in' }, h('p', {}, `The ${['left', 'right', 'top', 'bottom'][i]} edge`), h('div', { class: 'edgegrid' }, ...Object.entries(FX).map(([n, [nm, col]]) => h('button', { type: 'button', class: n === cur ? 'on' : '', style: { '--c': col }, onclick: () => { const o = [0, 1, 2, 3].find((k) => k !== i && edgeFx(k) === n); if (o !== undefined) P.set(`edge.${o}`, cur, { by: 'ui' }); P.set(`edge.${i}`, n, { by: 'ui' }); for (const d of discs) commit(d, 0); buzz(12); close(); } }, h('i'), nm)))));
    sheet.addEventListener('click', (e) => { if (e.target === sheet) close(); }); box.append(sheet);
  }

  // ---- physics
  let last = 0, sound = 0;
  function step(now) {
    const dt = Math.min(0.033, (now - last) / 1000 || 0.016); last = now; if (!T.W) return;
    const th = TH(), pw = T.W / POOLS.length, push = [...fingers.values()].filter((f) => !f.d && f.moved), busyT = roll || push.length || now - stir < 400;
    let any = busyT;
    for (const d of discs) {
      if (d.held) { any = true; continue; }
      const lp = d.ml.now(); if (lp) { any = true; d.x = lp[0]; d.y = lp[1]; d.vx = d.vy = 0; d.dirty = true; continue; }
      const R0 = R; void R0;
      if (roll) { d.vx += grav[0] * 1500 * dt; d.vy += grav[1] * 1500 * dt; }
      else if (d.y > th + 2) { const i = clamp(Math.floor(d.x / pw), 0, POOLS.length - 1), others = discs.filter((o) => o !== d && o.y > th + 2 && Math.floor(o.x / pw) === i).length; if (!others) { d.vx += ((i + 0.5) * pw - d.x) * 9 * dt; d.vy += (th + PH * 0.46 - d.y) * 9 * dt; } }
      for (const f of push) { const dx = d.x - f.x, dy = d.y - f.y, l = Math.hypot(dx, dy) || 1, o = rad(d) + 24 - l; if (o > 0) { d.x += (dx / l) * o; d.y += (dy / l) * o; d.vx += (dx / l) * o * 14; d.vy += (dy / l) * o * 14; d.dirty = true; } }
      const k = Math.exp(-dt * (roll ? 1.1 : 3.4)); d.vx *= k; d.vy *= k;
      if (Math.abs(d.vx) + Math.abs(d.vy) < 4 && !roll) { d.vx = d.vy = 0; continue; }
      any = true; d.dirty = true; d.x += d.vx * dt; d.y += d.vy * dt;
      const wall = (v) => { if (Math.abs(v) > 260 && now - sound > 60) { sound = now; buzz(Math.min(14, Math.abs(v) / 90)); } return -v * 0.55; };
      const r = rad(d) * 0.75; if (d.x < r) { d.x = r; d.vx = wall(d.vx); } else if (d.x > T.W - r) { d.x = T.W - r; d.vx = wall(d.vx); }
      if (d.y < r) { d.y = r; d.vy = wall(d.vy); } else if (d.y > T.H - r) { d.y = T.H - r; d.vy = wall(d.vy); }
    }
    if (any) for (let i = 0; i < discs.length; i++) for (let j = i + 1; j < discs.length; j++) {
      const a = discs[i], b = discs[j], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy, min = rad(a) + rad(b); if (l2 >= min * min || a.ml.pts || b.ml.pts) continue;
      const l = Math.sqrt(l2) || 0.01, nx = dx / l, ny = dy / l, o = (min - l) / (a.held || b.held ? 1 : 2);
      if (!a.held) { a.x -= nx * o; a.y -= ny * o; a.dirty = true; } if (!b.held) { b.x += nx * o; b.y += ny * o; b.dirty = true; }
      const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny; if (rv < 0) { const im = -rv * 0.75; if (!a.held) { a.vx -= im * nx; a.vy -= im * ny; } if (!b.held) { b.vx += im * nx; b.vy += im * ny; } }
    }
    for (const d of discs) { const r = rad(d) * 0.7; d.x = clamp(d.x, r, T.W - r); d.y = clamp(d.y, r, T.H - r); if (!d.held || d.dirty) setPool(d, poolOf(d)); }
    if (now - tiltAt > 70) { tiltAt = now; for (const d of discs) if (d.dirty) { const still = !d.held && Math.abs(d.vx) + Math.abs(d.vy) < 4; const run = d.ml.pts; commit(d, still && !run ? 0 : 0.03); if (still && !run) d.dirty = false; } }
  }

  // ---- buttons: roll, line up
  const rollB = h('button', { type: 'button', class: 'chip roll', title: 'Tilt the phone and everything rolls' }, 'Roll');
  rollB.onclick = async () => { if (!Motion.got) { await askSensors(); Motion.set(true); await new Promise((r) => setTimeout(r, 350)); } if (!Motion.got) { toast('Rolling needs the phone’s motion sensors'); return; } if (!Motion.on) Motion.set(true); Motion.b0 = null; roll = !roll; grav = [0, 0]; rollB.setAttribute('aria-pressed', roll); buzz(12); if (roll) toast('Tilt: they roll · throw one into a pool'); };
  const lineB = h('button', { type: 'button', class: 'chip', title: 'Everyone back to the middle: the song as it is', onclick: () => { roll = false; rollB.setAttribute('aria-pressed', false); home(); for (const d of discs) { d.ml.clear(); d.z = 1; P.set(`band.${d.st.id}.gain`, 0.85); setPool(d, -1, true); d.line = performance.now(); d.vx = d.vy = 0; } for (const st of song.stems) { P.set(`band.${st.id}.mute`, false); P.set(`band.${st.id}.solo`, false); } buzz(15); } }, 'Line up');
  const orbitB = h('button', { type: 'button', class: 'chip', 'aria-pressed': 'false', title: 'A disc you let go of keeps making the movement you made with it', onclick: () => { orbit = !orbit; orbitB.setAttribute('aria-pressed', orbit); buzz(10); if (orbit) toast('Move a disc and let go: it keeps going'); } }, 'Orbit');
  room.append(h('div', { class: 'head row' }, h('h2', {}, 'Stems'), h('span', { class: 'sp' }), orbitB, rollB, lineB), map, box);

  // ---- drawing
  const rr = (x, y, w, hh, r) => { g.beginPath(); g.roundRect(x, y, w, hh, r); };
  let voiceHad = false;
  function draw() {
    const now = performance.now(), hasVoice = song.stems.some((x) => x.voice && x.cells.some(Boolean)); if (hasVoice !== voiceHad && T.W) { voiceHad = hasVoice; populate(); }
    for (const d of discs) if (d.line) { const k = Math.min(1, (now - d.line) / 450); d.x += (d.hx - d.x) * (0.1 + k * 0.5); d.y += (d.hy - d.y) * (0.1 + k * 0.5); d.vx = d.vy = 0; d.dirty = true; if (k === 1) { d.x = d.hx; d.y = d.hy; d.line = 0; } }
    step(now); if (!T.W) return; const W = T.W, th = TH(), pw = W / POOLS.length; g.clearRect(0, 0, W, T.H);
    // the four edges: their colour reaches in as far as their effect does
    const ix = W * 0.2, iy = th * 0.2, EG = [[0, 0, ix, th, 0, 0, ix, 0], [W - ix, 0, ix, th, W, 0, W - ix, 0], [0, 0, W, iy, 0, 0, 0, iy], [0, th - iy, W, iy, 0, th, 0, th - iy]];
    const most = [0, 0, 0, 0]; for (const d of discs) near(d).forEach((v, i) => { most[i] = Math.max(most[i], v); });
    EG.forEach(([x, y, w, hh, x0, y0, x1, y1], i) => { const col = FX[edgeFx(i)][1], gr = g.createLinearGradient(x0, y0, x1, y1); gr.addColorStop(0, col + Math.round(46 + most[i] * 70).toString(16).padStart(2, '0')); gr.addColorStop(1, col + '00'); g.fillStyle = gr; g.fillRect(x, y, w, hh); });
    g.strokeStyle = '#ffffff14'; g.lineWidth = 1; g.setLineDash([3, 5]); rr(ix, iy, W - 2 * ix, th - 2 * iy, 24); g.stroke(); g.setLineDash([]);
    g.textAlign = 'center'; g.textBaseline = 'middle'; EG.forEach((_, i) => {
      const n = edgeFx(i), [nm, col] = FX[n], k = P.get(`edge.k.${n}`), act = edgeNow?.i === i, side = i < 2, hx = i === 0 ? 11 : i === 1 ? W - 11 : 40 + k * (W - 80), hy = i === 2 ? 11 : i === 3 ? th - 11 : 40 + (1 - k) * (th - 80);
      g.strokeStyle = col + '55'; g.lineWidth = 2; g.beginPath(); if (side) { g.moveTo(hx, 40); g.lineTo(hx, th - 40); } else { g.moveTo(40, hy); g.lineTo(W - 40, hy); } g.stroke();
      // the name is the handle: it slides along its edge
      g.save(); g.translate(hx, hy); if (side) g.rotate(i ? Math.PI / 2 : -Math.PI / 2); g.font = '700 10px "IBM Plex Mono", monospace'; const tw = g.measureText(nm.toUpperCase()).width + 20; g.fillStyle = act ? '#fff' : col; rr(-tw / 2, -10, tw, 20, 10); g.fill(); g.fillStyle = '#0b0d12'; g.fillText(nm.toUpperCase(), 0, 0.5); g.restore();
      if (act && edgeNow.moved) { const t = `${nm} ${FX[n][2]} ${FX[n][3](k)}`; g.font = '11px "IBM Plex Mono", monospace'; const w = g.measureText(t).width + 18, x = clamp(hx, w / 2 + 6, W - w / 2 - 6), y = clamp(hy + (i === 2 ? 30 : i === 3 ? -30 : -46), 18, th - 18); g.fillStyle = '#fff'; rr(x - w / 2, y - 12, w, 24, 12); g.fill(); g.fillStyle = '#11141b'; g.fillText(t, x, y); }
    });
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
    // who plays at this point of the song; the others are drawn as waiting
    if (now - quietAt > 200) { quietAt = now; const B = S.player.playing ? S.player.barNow() : S.player.pausedBar; for (const d of discs) { const w = S.player.resolve(S.session.state.tracks[d.st.id], B), c = w && d.st.cells[w.cell]; d.quiet = !c || c.rms < -45; } }
    const solo = discs.some((d) => P.get(`band.${d.st.id}.solo`));
    for (const d of discs) {
      const ch = S.engine.channels.get(d.st.id); d.lv = ch ? Math.min(1, ch.readLevel() * 3.4) : 0;
      const off = P.get(`band.${d.st.id}.mute`) || (solo && !P.get(`band.${d.st.id}.solo`)), so = P.get(`band.${d.st.id}.solo`), col = d.st.color || '#ece8dc', far = 0, nb = near(d), rd = rad(d) * (d.held ? 1.08 : 1);
      if (!off && d.lv > 0.02) { const gl = g.createRadialGradient(d.x, d.y, rd * 0.6, d.x, d.y, rd + 8 + d.lv * 20); gl.addColorStop(0, col); gl.addColorStop(1, 'transparent'); g.globalAlpha = 0.14 + d.lv * 0.5; g.fillStyle = gl; g.beginPath(); g.arc(d.x, d.y, rd + 8 + d.lv * 20, 0, 7); g.fill(); g.globalAlpha = 1; }
      g.fillStyle = '#12161f'; g.beginPath(); g.arc(d.x, d.y, rd, 0, 7); g.fill();
      const wait = !off && d.quiet && d.lv < 0.02; g.globalAlpha = off ? 0.05 : wait ? 0.1 : (0.3 + d.lv * 0.55) * (1 - far * 0.45); g.fillStyle = col; g.fill(); g.globalAlpha = off ? 0.3 : wait ? 0.45 : 1; g.strokeStyle = so ? '#fff' : col; g.lineWidth = so ? 3 : d.held ? 2.5 : 1.4; g.stroke();
      nb.forEach((v, i) => { if (v < 0.02) return; const a = [Math.PI, 0, -Math.PI / 2, Math.PI / 2][i], w = 0.25 + v * 0.75; g.globalAlpha = 1; g.strokeStyle = FX[edgeFx(i)][1]; g.lineWidth = 4; g.beginPath(); g.arc(d.x, d.y, rd + 4, a - w, a + w); g.stroke(); });
      if (d.ml.pts) { g.globalAlpha = 0.5; g.strokeStyle = col; g.lineWidth = 1.2; g.setLineDash([3, 4]); g.beginPath(); d.ml.pts.forEach(([, x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.stroke(); g.setLineDash([]); }
      g.globalAlpha = off ? 0.3 : wait ? 0.6 : 1; g.fillStyle = off ? '#a3a6ad' : '#fff'; g.font = `${clamp(8.6 * d.z, 6.5, 11)}px "Instrument Sans", sans-serif`; d.name.forEach((w, i) => g.fillText(w, d.x, d.y + (i - (d.name.length - 1) / 2) * 10)); g.globalAlpha = 1;
    }
    for (const f of fingers.values()) if (!f.d && f.moved) { g.strokeStyle = '#ffffff55'; g.beginPath(); g.arc(f.x, f.y, 24, 0, 7); g.stroke(); }
    // what the disc in hand is getting, in words
    const hot = discs.filter((d) => (d.held || now - (d.seen || -1e6) < 900) && !d.ml.pts).sort((a, b) => b.held - a.held || (b.seen || 0) - (a.seen || 0))[0];
    if (hot) { const nb = near(hot), bits = hot.pool >= 0 ? [POOLS[hot.pool][0]] : nb.map((v, i) => [v, FX[edgeFx(i)][0]]).filter(([v]) => v > 0.02).map(([v, n]) => `${n} ${Math.round(v * 100)}`), lev = Math.round((gainOf(hot.z) / 0.85) * 100), t = `${hot.st.name}  ·  ${hot.pinch ? `level ${lev}` : bits.length ? bits.join('  +  ') : 'as it is'}`; g.font = '600 11.5px "IBM Plex Mono", monospace'; const w = g.measureText(t).width + 24; g.fillStyle = '#11141bee'; rr(W / 2 - w / 2, 32, w, 27, 13); g.fill(); g.strokeStyle = hot.st.color || '#ece8dc'; g.lineWidth = 1.2; g.stroke(); g.fillStyle = '#fff'; g.fillText(t, W / 2, 46); }
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
    shake: () => { for (const d of discs) { if (d.held) continue; const a = Math.random() * 7, v = 500 + Math.random() * 900; d.vx += Math.cos(a) * v; d.vy += Math.sin(a) * v * 0.7; } toast('Shaken'); },
    draw, show: () => { if (T.W && !discs.length) populate(); }, bg: () => { if (discs.some((d) => d.ml.pts)) step(performance.now()); }, hide: () => { if (roll) { roll = false; rollB.setAttribute('aria-pressed', false); } },
  };
  S.table = { near, edgeFx, choose, get discs() { return discs; }, TH, get T() { return T; }, get R() { return R; } };
}
