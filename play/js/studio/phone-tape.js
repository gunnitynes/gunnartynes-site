// Tape: everything you make, as a thing you can put your hands on. Two reels you can grab and turn: the song stops
// under your finger and runs backwards, slowly, fast, as you turn it. Under them the tape itself: tap to go there,
// drag across to take a piece. And the piece, lying in front of you, to be handled:
//   twist it over: backwards · pinch it: stutter · stretch it: half speed · up: throw it away · down: the song back
//   right: once more after itself · left: wipe what you played on it · hold: loop it · tap: hear it
import { h, $ } from '../lib/util.js';
import { clamp, buzz, surface, gestures, COLORS } from './phone-kit.js';
import { isTake, takeName, srcBar, shiftSrc } from './core.js';

export function buildTape(S, U) {
  const room = $('#p-tape'), q = S.seq, { song, params: P, player } = S, cb = song.barsPerCell, V = S.voice, { toast, srcAt, barNow, nextBar, bpb } = U;

  // ---- the hand on the tape (recordable: where it was held, how it turned)
  P.define('fx.hand.on', false, (v) => S.platter.port.postMessage({ on: !!v })); P.define('fx.hand.rate', 0, (v) => S.platter.port.postMessage({ rate: v })); P.range['fx.hand.rate'] = [-4, 4, 'Reel'];
  const reels = h('div', { class: 'reels' }), Rl = surface(reels), rg = Rl.g; let hand = null, turn = [0, 0], idle = 0, lastT = 0;
  const centre = (i) => [i ? Rl.W - Rl.H / 2 - 4 : Rl.H / 2 + 4, Rl.H / 2];
  reels.addEventListener('pointerdown', (e) => {
    if (hand) return; const r = reels.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, i = [0, 1].find((k) => Math.hypot(x - centre(k)[0], y - centre(k)[1]) < Rl.H / 2 + 12); if (i === undefined) return;
    e.preventDefault(); try { reels.setPointerCapture(e.pointerId); } catch { /* fine */ } const [cx, cy] = centre(i); hand = { id: e.pointerId, i, a: Math.atan2(y - cy, x - cx), t: performance.now(), rate: 0 }; P.set('fx.hand.rate', 0); P.set('fx.hand.on', true); buzz(15);
  });
  reels.addEventListener('pointermove', (e) => {
    if (hand?.id !== e.pointerId) return; const r = reels.getBoundingClientRect(), [cx, cy] = centre(hand.i), a = Math.atan2(e.clientY - r.top - cy, e.clientX - r.left - cx), n = performance.now(), dt = Math.max(6, n - hand.t), da = Math.atan2(Math.sin(a - hand.a), Math.cos(a - hand.a));
    turn[0] += da; turn[1] += da; hand.rate += (clamp(((da / (Math.PI * 2)) * 1800) / dt, -4, 4) - hand.rate) * 0.55; hand.a = a; hand.t = n; idle = 0; const v = Math.round(hand.rate * 20) / 20; if (v !== P.get('fx.hand.rate')) P.set('fx.hand.rate', v);
  });
  const letGo = (e) => { if (hand?.id !== e.pointerId) return; hand = null; P.set('fx.hand.on', false); P.set('fx.hand.rate', 0); buzz(8); };
  reels.addEventListener('pointerup', letGo); reels.addEventListener('pointercancel', letGo); reels.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---- the tape
  const box = h('div', { class: 'tape' }), C = surface(box), g = C.g;
  const ROWS = [['band', 'Stems', '#ece8dc'], ['own', 'Each stem', '#a3a6ad'], ['audio', 'Audio', '#df8a74'], [0, 'Cloud', COLORS[0]], [1, 'Sound 1', COLORS[1]], [2, 'Sound 2', COLORS[2]], ['m', 'Moves', '#a3a6ad']];
  const rowOf = (cl) => (String(cl.lane).startsWith('stem:') ? 1 : ROWS.findIndex((r) => r[0] === cl.lane)), geo = () => { const top = 16, rh = (C.H - top) / ROWS.length; return { top, rh, ppb: C.W / Math.max(4, vb() - va()) }; };
  let view = null; const va = () => view?.[0] ?? 0, vb = () => view?.[1] ?? q.arr.bars, X = (b) => (b - va()) * geo().ppb;
  let pt = null, sel = null; const barAt = (x) => clamp(va() + x / geo().ppb, 0, q.arr.bars), range = () => sel || [nextBar(), nextBar() + 4];
  gestures(box, {
    down: (p) => { const { top, rh } = geo(), bar = barAt(p.x), row = Math.floor((p.y - top) / rh), hit = row > 0 ? [...q.arr.clips].reverse().find((c) => rowOf(c) === row && bar >= c.start && bar < c.start + c.len) : null; pt = { x: p.x, bar, hit, moved: false, t: setTimeout(() => { if (!pt?.hit || pt.moved) return; q.snapshot(); q.arr.clips = q.arr.clips.filter((c) => c !== pt.hit); q.changed(); toast('Removed · ↶ undoes'); buzz(30); pt = null; }, 550) }; },
    move: (p) => { if (!pt) return; if (!pt.moved && Math.abs(p.x - pt.x) < 10) return; pt.moved = true; clearTimeout(pt.t); const b = barAt(p.x), a0 = Math.floor(Math.min(pt.bar, b)); sel = [a0, Math.min(q.arr.bars, Math.max(a0 + 1, Math.ceil(Math.max(pt.bar, b))))]; },
    up: () => { if (!pt) return; clearTimeout(pt.t); if (!pt.moved) S.seek(Math.max(0, Math.floor(pt.bar))); else buzz(6); pt = null; },
    twoStart: () => { if (pt) clearTimeout(pt.t); pt = null; },
    two: (e) => { const n = q.arr.bars, w = vb() - va(), at = va() + ((e.x - e.dx) / C.W) * w, nw = clamp(w / e.ds, 4, n), a = clamp(at - (e.x / C.W) * nw, 0, n - nw); view = nw >= n ? null : [a, a + nw]; },
  });

  // ---- the piece
  const piece = h('div', { class: 'piece' }), K = surface(piece), kg = K.g; let m = { x: 0, y: 0, a: 0, s: 1 }, down = null, two = false, done = null, flash = null;
  const what = () => { if (two) { if (Math.abs(m.a) > 0.95) return 'Backwards'; if (m.s < 0.75) return `Stutter ×${m.s < 0.4 ? 16 : m.s < 0.57 ? 8 : 4}`; if (m.s > 1.32) return 'Half speed'; return ''; } if (m.y < -52 && -m.y > Math.abs(m.x)) return 'Throw away'; if (m.y > 52 && m.y > Math.abs(m.x)) return 'The song back'; if (m.x > 66) return 'Once more'; if (m.x < -66) return 'Wipe'; return ''; };
  const grow = (e) => { if (e > q.arr.bars) q.arr.bars = e; };
  function act(w) {
    const [a, b] = range(), n = b - a, band = (x) => { q.place({ lane: 'band', start: a, len: n, ...x }); grow(b); }; q.snapshot();
    if (w === 'Backwards') band({ src: srcAt(a), fx: { r: 1 } });
    else if (w.startsWith('Stutter')) band({ src: srcAt(a), fx: { u: +w.slice(9) } });
    else if (w === 'Half speed') band({ src: srcAt(a), fx: { s: 0.5 } });
    else if (w === 'Throw away') band({ src: srcAt(a), mute: song.stems.map((x) => x.id) });
    else if (w === 'The song back') { for (const st of song.stems) { const d = q.place({ lane: 'stem:' + st.id, start: a, len: n, src: 0 }); q.arr.clips = q.arr.clips.filter((c) => c !== d); } band({ src: a % song.numBars }); for (const st of song.stems) if (q.arr.own?.[st.id]) q.place({ lane: 'stem:' + st.id, start: a, len: n, src: a % song.numBars }); }
    else if (w === 'Wipe') for (const lane of new Set(q.arr.clips.filter((c) => c.lane !== 'band').map((c) => c.lane))) { const id = String(lane).startsWith('stem:') ? lane.slice(5) : null, d = q.place({ lane, start: a, len: n, ...(id ? { src: srcAt(a) } : { pat: 'A' }) }); if (!(id && q.arr.own?.[id])) q.arr.clips = q.arr.clips.filter((c) => c !== d); }
    else if (w === 'Once more') {
      const cp = q.arr.clips.filter((c) => c.start < b && c.start + c.len > a).map((c) => { const s2 = Math.max(a, c.start), e2 = Math.min(b, c.start + c.len), d = s2 - c.start, x = { ...c, id: undefined, fx: c.fx ? { ...c.fx } : undefined, start: s2 + n, len: e2 - s2 }; if (c.src !== undefined) shiftSrc(x, d); else x.off = (c.off || 0) + d; return x; });
      for (const c of cp) q.place(c); grow(b + n); sel = [b, b + n];
    }
    q.changed(); toast(`${w} · bars ${a + 1}–${b} · ↶ undoes`); buzz([14, 30, 14]); flash = performance.now();
  }
  const loop = () => { const [a, b] = range(); q.snapshot(); const same = q.arr.cycle && q.arr.cycle[0] === a && q.arr.cycle[1] === b; q.arr.cycle = same ? null : [a, b]; if (!same) sel = [a, b]; q.changed(); toast(same ? 'Loop off' : `Looping bars ${a + 1}–${b}`); buzz(25); };
  const commit = () => { const w = what(); const was = { ...m }; m = { x: 0, y: 0, a: 0, s: 1 }; done = { ...was, t: performance.now(), w }; if (w) act(w); two = false; };
  gestures(piece, {
    down: (p) => { two = false; done = null; down = { x: p.x, y: p.y, t: performance.now(), moved: false, hold: setTimeout(() => { if (down && !down.moved) { down.held = true; loop(); } }, 480) }; },
    move: (p) => { if (!down || down.held) return; m.x = p.x - down.x; m.y = p.y - down.y; if (!down.moved && Math.hypot(m.x, m.y) > 9) { down.moved = true; clearTimeout(down.hold); } const w = what(); if (w !== down.w) { down.w = w; if (w) buzz(8); } },
    up: () => { if (!down) return; clearTimeout(down.hold); if (!down.held) { if (down.moved) commit(); else { S.seek(range()[0]); if (!player.playing) player.play(); buzz(6); } } down = null; m = { x: 0, y: 0, a: 0, s: 1 }; },
    twoStart: () => { if (down) clearTimeout(down.hold); down = { moved: true }; two = true; m = { x: 0, y: 0, a: 0, s: 1 }; },
    two: (e) => { m.a = e.a; m.s = e.s; m.x = e.tx * 0.5; m.y = e.ty * 0.5; const w = what(); if (w !== down.w) { down.w = w; if (w) buzz(8); } },
    twoEnd: () => { m.x = m.y = 0; commit(); }, allUp: () => { down = null; two = false; m = { x: 0, y: 0, a: 0, s: 1 }; },
  });

  // ---- recording, capture, takes
  const recA = h('button', { type: 'button', class: 'chip recaudio' }, h('i'), h('span', {}, 'Record audio'));
  recA.onclick = async () => { if (V.recording) { recA.disabled = true; const r = await V.stop(); recA.disabled = false; toast(r ? `Recorded ${r.bars} bar${r.bars > 1 ? 's' : ''} onto “Audio” · ↶ undoes` : 'Nothing was heard, so nothing was kept'); buzz(20); return; } try { await V.start(); toast('Recording from the next bar'); buzz(15); } catch (err) { toast(err.message); } };
  const showRecA = () => { recA.classList.toggle('on', V.recording); recA.lastChild.textContent = V.recording ? `Stop · bar ${V.bars + 1}` : 'Record audio'; }; V.addEventListener('change', showRecA); showRecA();
  const btn = (label, fn, cls = 'chip') => h('button', { type: 'button', class: cls, onclick: fn }, label), takes = h('div', { class: 'takes' });
  const capB = btn('Capture', () => { const r = q.capture(); if (r) { toast(`Kept ${r.len} bar${r.len > 1 ? 's' : ''} as ${takeName(r.k)} at bar ${r.bar + 1}`); buzz(20); } else toast('Nothing played yet to capture'); });
  const sync = () => { capB.disabled = q.rec || !q.canCapture(); const ks = [...new Set(q.arr.clips.filter((c) => c.pat && isTake(c.pat)).map((c) => c.pat))]; const sig = ks.map((k) => k + q.lens[k]).join(); if (sync.sig === sig) return; sync.sig = sig; takes.replaceChildren(...ks.map((k) => { const cl = q.arr.clips.filter((c) => c.pat === k), start = Math.min(...cl.map((c) => c.start)); return h('div', { class: 'take' }, h('button', { type: 'button', class: 'go', onclick: () => S.seek(start) }, `▸ ${takeName(k)}`), h('span', { class: 'mono' }, `bar ${start + 1} · ${q.lens[k]} bars`), h('button', { type: 'button', class: 'x', 'aria-label': `Remove ${takeName(k)}`, onclick: () => { q.snapshot(); q.arr.clips = q.arr.clips.filter((c) => c.pat !== k); q.changed(); toast(`${takeName(k)} removed · ↶ undoes`); } }, '×')); })); };
  q.addEventListener('change', sync); sync();
  room.append(h('div', { class: 'head row' }, h('h2', {}, 'Tape'), h('span', { class: 'sp' }), capB, btn('Redo', () => q.redo()), recA), reels, box, piece, takes);

  // ---- drawing
  function drawReels(now) {
    const { W, H } = Rl; if (!W) return; const dt = Math.min(0.1, (now - lastT) / 1000); lastT = now; if (hand) { if (now - hand.t > 70 && P.get('fx.hand.rate') !== 0) { hand.rate = 0; P.set('fx.hand.rate', 0); } } else { const sp = P.get('fx.hand.on') ? P.get('fx.hand.rate') : player.playing ? 1 : 0; turn[0] += sp * dt * 3.4; turn[1] += sp * dt * 3.0; }
    rg.clearRect(0, 0, W, H); const prog = clamp(q.tl(q.nowBeat()) / bpb() / Math.max(1, q.arr.bars), 0, 1), R = H / 2 - 4, c0 = centre(0), c1 = centre(1), rad = [R * (0.98 - 0.4 * prog), R * (0.58 + 0.4 * prog)];
    rg.strokeStyle = '#6b4a3a'; rg.lineWidth = 2; rg.beginPath(); rg.moveTo(c0[0], c0[1] + rad[0]); rg.lineTo(W / 2 - 20, H - 7); rg.lineTo(W / 2 + 20, H - 7); rg.lineTo(c1[0], c1[1] + rad[1]); rg.stroke();
    rg.fillStyle = hand ? '#e6b450' : '#a3a6ad'; rg.fillRect(W / 2 - 14, H - 14, 28, 9);
    [c0, c1].forEach(([x, y], i) => { const g2 = rg.createRadialGradient(x, y, 4, x, y, rad[i]); g2.addColorStop(0, '#59402f'); g2.addColorStop(1, '#33251d'); rg.fillStyle = g2; rg.beginPath(); rg.arc(x, y, rad[i], 0, 7); rg.fill(); rg.strokeStyle = hand?.i === i ? '#e6b450' : '#ffffff30'; rg.lineWidth = hand?.i === i ? 3 : 1; rg.beginPath(); rg.arc(x, y, R, 0, 7); rg.stroke(); rg.save(); rg.translate(x, y); rg.rotate(turn[i]); rg.fillStyle = '#ece8dc'; rg.beginPath(); rg.arc(0, 0, R * 0.3, 0, 7); rg.fill(); rg.fillStyle = '#11141b'; for (let k = 0; k < 3; k++) { rg.rotate((Math.PI * 2) / 3); rg.beginPath(); rg.arc(0, -R * 0.17, R * 0.07, 0, 7); rg.fill(); } rg.strokeStyle = '#ffffff22'; rg.lineWidth = 1.5; rg.beginPath(); for (let k = 0; k < 3; k++) { rg.rotate((Math.PI * 2) / 3); rg.moveTo(0, -R * 0.36); rg.lineTo(0, -rad[i] * 0.95); } rg.stroke(); rg.restore(); });
    rg.textAlign = 'center'; rg.textBaseline = 'middle'; rg.fillStyle = hand ? '#e6b450' : '#d6d2c6'; rg.font = 'italic 17px Newsreader, serif'; const mid = W - 2 * H - 20; if (mid > 60) { rg.fillText(hand ? `${P.get('fx.hand.rate').toFixed(1)}×` : 'turn a reel', W / 2, H / 2 - 10); }
  }
  function drawTape() {
    const { W, H } = C; if (!W) return; const { top, rh, ppb } = geo(); g.clearRect(0, 0, W, H); g.font = '9px "IBM Plex Mono", monospace'; g.textBaseline = 'middle'; g.textAlign = 'left';
    const every = ppb > 20 ? 1 : ppb > 12 ? 4 : ppb > 5 ? 8 : 16; for (let b = Math.floor(va() / every) * every; b <= vb(); b += every) { g.fillStyle = '#ffffff16'; g.fillRect(X(b), top, 1, H - top); g.fillStyle = '#6f747f'; g.fillText(String(b + 1), X(b) + 2, 8); }
    ROWS.forEach((r, i) => { g.fillStyle = i % 2 ? '#ffffff05' : '#ffffff02'; g.fillRect(0, top + i * rh, W, rh); }); const c = q.arr.cycle; if (c) { g.fillStyle = '#e6b45026'; g.fillRect(X(c[0]), 0, (c[1] - c[0]) * ppb, H); }
    for (const cl of q.arr.clips) { const row = rowOf(cl); if (row < 0) continue; const col = ROWS[row][2], x = X(cl.start), w = Math.max(2, cl.len * ppb), y = top + row * rh + 2, hh = rh - 4; if (x > W || x + w < 0) continue; g.fillStyle = col + (cl.fx || cl.mute?.length ? '66' : '30'); g.fillRect(x + 0.5, y, w - 1, hh); g.fillStyle = col; g.fillRect(x + 0.5, y, 1.5, hh); if (cl.pat && isTake(cl.pat)) { g.fillStyle = '#df8a74'; g.fillRect(x + 0.5, y + hh - 2, w - 1, 2); } }
    const vc = song.stems.find((x) => x.voice)?.cells || []; if (vc.some(Boolean)) for (let b = 0; b < q.arr.bars; b++) if (vc[Math.floor(srcAt(b) / cb)]) { g.fillStyle = '#df8a7466'; g.fillRect(X(b) + 0.5, top + 2 * rh + 2, Math.max(1, ppb - 1), rh - 4); }
    ROWS.forEach(([, nm], i) => { g.fillStyle = '#c3c4c8'; g.fillText(nm, 4, top + i * rh + rh / 2); });
    const [a, b] = range(); g.fillStyle = sel ? '#ece8dc22' : '#ece8dc0c'; g.fillRect(X(a), top, (b - a) * ppb, H - top); if (sel) { g.strokeStyle = '#ece8dc'; g.lineWidth = 1; g.strokeRect(X(a) + 0.5, top + 0.5, (b - a) * ppb - 1, H - top - 1); }
    const pb = q.tl(q.nowBeat()) / bpb(); g.fillStyle = q.rec ? '#df8a74' : '#ece8dc'; g.fillRect(X(pb), 0, 2, H); if (q.take) { const t = q.take, l = t.len || Math.max(0, pb - t.start); g.fillStyle = '#df8a7430'; g.fillRect(X(t.start), 0, l * ppb, H); } void barNow;
  }
  const amp = (bar) => { const out = new Array(16).fill(0), cl = q.arr.clips.find((c) => c.lane === 'band' && bar >= c.start && bar < c.start + c.len); for (const st of song.stems) { const own = q.arr.clips.find((c) => c.lane === 'stem:' + st.id && bar >= c.start && bar < c.start + c.len), k = own || (q.arr.own?.[st.id] ? null : cl); if (!k || k.mute?.includes(st.id) || k.fx?.g === 0 || P.get(`band.${st.id}.mute`)) continue; const sb = srcBar(k, bar - k.start, song.numBars).bar, cell = st.cells[Math.floor(sb / cb)]; if (!cell?.wave) continue; const n = cell.wave.length / cb, o = (sb % cb) * n; for (let i = 0; i < 16; i++) { const v = cell.wave[Math.floor(o + (i / 16) * n)] / 99; out[k.fx?.r ? 15 - i : i] += v * v; } } return out.map((v) => Math.min(1, Math.sqrt(v) / 1.5)); };
  function drawPiece(now) {
    const { W, H } = K; if (!W) return; kg.clearRect(0, 0, W, H); const [a, b] = range(), n = Math.min(b - a, 32), pw = W * 0.6, ph = Math.min(H * 0.42, 92), cur = what(); let t = { ...m };
    if (done) { const k = (now - done.t) / 380; if (k >= 1) done = null; else { const e = 1 - (1 - k) ** 3, f = done.w ? 1 : 0; t = f ? { x: done.x + Math.sign(done.x) * (Math.abs(done.x) > 60 ? 300 * e : 0), y: done.y + Math.sign(done.y) * (Math.abs(done.y) > 50 ? 260 * e : 0), a: done.a > 0.9 ? done.a + (Math.PI - done.a) * e : done.a < -0.9 ? done.a + (-Math.PI - done.a) * e : done.a * (1 - e), s: done.s + (1 - done.s) * e, o: 1 - e } : { x: done.x * (1 - e), y: done.y * (1 - e), a: done.a * (1 - e), s: done.s + (1 - done.s) * e }; } }
    // what each way does, at the edges
    kg.textAlign = 'center'; kg.textBaseline = 'middle'; const lab = (x, y, txt, on, rot = 0) => { kg.save(); kg.translate(x, y); kg.rotate(rot); kg.font = '9.5px "IBM Plex Mono", monospace'; kg.fillStyle = on ? '#e6b450' : '#737a87'; kg.fillText(txt, 0, 0); kg.restore(); };
    lab(W / 2, 12, '↑ THROW AWAY', cur === 'Throw away'); lab(W / 2, H - 12, '↓ THE SONG BACK', cur === 'The song back'); lab(W - 11, H / 2, 'ONCE MORE →', cur === 'Once more', Math.PI / 2); lab(11, H / 2, '← WIPE', cur === 'Wipe', -Math.PI / 2);
    lab(W * 0.2, H - 30, 'PINCH · STUTTER', cur.startsWith('Stutter')); lab(W * 0.8, H - 30, 'STRETCH · HALF', cur === 'Half speed'); lab(W * 0.2, 30, 'TWIST · BACKWARDS', cur === 'Backwards'); lab(W * 0.8, 30, 'HOLD · LOOP', false);
    kg.save(); kg.globalAlpha = t.o ?? 1; kg.translate(W / 2 + t.x, H / 2 + t.y); kg.rotate(t.a); kg.scale(clamp(t.s, 0.3, 1.55), 1);
    kg.fillStyle = '#2a1f19'; kg.strokeStyle = cur ? '#e6b450' : '#8a6a52'; kg.lineWidth = cur ? 2.5 : 1.2; kg.shadowColor = '#000a'; kg.shadowBlur = 18; kg.beginPath(); kg.roundRect(-pw / 2, -ph / 2, pw, ph, 5); kg.fill(); kg.shadowBlur = 0; kg.stroke(); kg.beginPath(); kg.rect(-pw / 2, -ph / 2, pw, ph); kg.clip();
    const bw = pw / n; for (let i = 0; i < n; i++) { const A = amp(a + i); kg.fillStyle = cur === 'Throw away' ? '#8a6a5255' : '#ece8dc'; A.forEach((v, k) => { kg.globalAlpha = (t.o ?? 1) * 0.85; kg.fillRect(-pw / 2 + i * bw + (k / 16) * bw, (-v * ph * 0.8) / 2, Math.max(0.8, bw / 16 - 0.4), Math.max(1, v * ph * 0.8)); }); kg.globalAlpha = 0.25; kg.fillStyle = '#fff'; kg.fillRect(-pw / 2 + i * bw, -ph / 2, 0.7, ph); }
    const pb = q.tl(q.nowBeat()) / bpb(); if (pb >= a && pb < b) { kg.globalAlpha = 1; kg.fillStyle = '#e6b450'; kg.fillRect(-pw / 2 + ((pb - a) / n) * pw - 1, -ph / 2, 2, ph); } kg.restore(); kg.globalAlpha = 1;
    if (flash && now - flash < 500) { kg.strokeStyle = `rgba(230,180,80,${1 - (now - flash) / 500})`; kg.lineWidth = 3; kg.beginPath(); kg.roundRect(W / 2 - pw / 2 - 5, H / 2 - ph / 2 - 5, pw + 10, ph + 10, 8); kg.stroke(); }
    kg.fillStyle = cur ? '#e6b450' : '#d6d2c6'; kg.font = cur ? 'italic 21px Newsreader, serif' : '10px "IBM Plex Mono", monospace'; kg.fillText(cur || `BARS ${a + 1}–${b}${sel ? '' : ' · DRAG ACROSS THE TAPE TO CHOOSE'}`, W / 2, H / 2 + ph / 2 + 18);
  }
  S.rooms.tape = { draw: () => { const now = performance.now(); if (V.recording) recA.style.setProperty('--lv', Math.min(1, V.level() * 1.4).toFixed(2)); drawReels(now); drawTape(); drawPiece(now); }, hide: () => { if (hand) { hand = null; P.set('fx.hand.on', false); P.set('fx.hand.rate', 0); } } };
  S.tapeRoom = { get sel() { return sel; }, set sel(v) { sel = v; }, act, what: () => what() };
}
