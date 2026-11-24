// The timeline: everything on the tape, in lanes. Press ● anywhere and what you do is written here, where the playhead
// is: notes join the notes already there, moves replace only their own kind, the pools write what each stem played.
//   ruler: drag to go there · a lane: drag to look around, tap to go there · its name: on and off · two fingers: zoom
//   a part: tap it, then drag it, drag its ends, or use the row below (what a part can do depends on what it is)
import { h } from '../lib/util.js';
import { clamp, buzz, surface, gestures, COLORS } from './phone-kit.js';
import { srcBar, shiftSrc } from './core.js';

export function buildTimeline(S, U, { openPiece }) {
  const q = S.seq, { song, params: P, player } = S, { bpb, srcAt } = U, cb = song.barsPerCell, LW = 58, TOP = 24;
  const LANES = [['band', 'Song', '#ece8dc'], ['own', 'Stems', '#a3a6ad'], ['cap', 'Pieces', '#e6b450'], ['audio', 'Mic', '#df8a74'], [0, 'Cloud', COLORS[0]], [1, 'Sound 1', COLORS[1]], [2, 'Sound 2', COLORS[2]], ['m', 'Moves', '#c9b6ff']];
  const el = h('div', { class: 'tline' }), C = surface(el), g = C.g; let a = 0, b = null, sel = null, d = null, lastTouch = 0;
  const B = () => b ?? q.arr.bars, rowH = () => (C.H - TOP) / LANES.length, ppb = () => (C.W - LW) / Math.max(1, B() - a), X = (bar) => LW + (bar - a) * ppb(), barAt = (x) => a + (x - LW) / ppb(), rowOf = (c) => (String(c.lane).startsWith('stem:') ? 1 : LANES.findIndex((l) => l[0] === c.lane));
  const look = (x, w) => { const n = q.arr.bars; w = clamp(w, 2, n); x = clamp(x, 0, n - w); if (w >= n - 0.01) { a = 0; b = null; } else { a = x; b = x + w; } };
  const off = (i) => { const l = LANES[i][0]; return l === 'band' || l === 'own' ? !P.get('band.on') : l === 'audio' ? !!P.get('band.you.mute') : q.mute.has(l); };
  const flip = (i) => { const l = LANES[i][0]; if (l === 'band' || l === 'own') P.set('band.on', !P.get('band.on')); else if (l === 'audio') P.set('band.you.mute', !P.get('band.you.mute')); else { q.mute.has(l) ? q.mute.delete(l) : q.mute.add(l); q.emit(); } buzz(10); };
  const hitAt = (x, y) => { const r = Math.floor((y - TOP) / rowH()), bar = barAt(x); if (r < 0 || x < LW) return null; const m = 9 / ppb(); return [...q.arr.clips].reverse().find((c) => rowOf(c) === r && bar >= c.start - (c === sel ? m : 0) && bar < c.start + c.len + (c === sel ? m : 0)) || null; };
  const touchUp = () => { sel = sel && q.arr.clips.includes(sel) ? sel : null; bar(); };

  gestures(el, {
    down: (p) => { lastTouch = performance.now(); if (!C.W) return; if (p.y < TOP) { d = { m: 'scrub' }; S.seek(Math.max(0, Math.floor(barAt(Math.max(LW, p.x))))); return; } if (p.x < LW) { d = { m: 'name', r: Math.floor((p.y - TOP) / rowH()) }; return; }
      const c = hitAt(p.x, p.y); d = { m: 'lane', x: p.x, y: p.y, a, w: B() - a, c }; if (c && c === sel) { const e0 = X(c.start), e1 = X(c.start + c.len), grip = Math.min(18, (e1 - e0) / 3); d.m = p.x < e0 + grip ? 'left' : p.x > e1 - grip ? 'right' : 'move'; d.o = { start: c.start, len: c.len, src: c.src, off: c.off }; } },
    move: (p) => { if (!d) return; lastTouch = performance.now(); if (d.m === 'scrub') { S.seek(clamp(Math.floor(barAt(p.x)), 0, q.arr.bars - 1)); return; } if (d.m === 'name') return; const dx = p.x - d.x; if (!d.moved) { if (Math.abs(dx) < 8) return; d.moved = true; if (d.m !== 'lane') { q.snapshot(); buzz(6); } }
      if (d.m === 'lane') { if (b !== null) look(d.a - dx / ppb(), d.w); return; }
      const c = d.c, n = Math.round(dx / ppb()), o = d.o; if (d.m === 'move') c.start = Math.max(0, o.start + n); else if (d.m === 'right') c.len = Math.max(1, o.len + n); else { const k = clamp(n, -o.start, o.len - 1), t = { ...c, src: o.src, off: o.off }; c.start = o.start + k; c.len = o.len - k; if (o.src !== undefined) { shiftSrc(t, k); if (t.src !== undefined) t.src = ((t.src % song.numBars) + song.numBars) % song.numBars; c.src = t.src; c.off = t.off; } else c.off = (o.off || 0) + k; } },
    up: (p) => { const k = d; d = null; if (!k) return; if (k.m === 'name') { if (p.x < LW) flip(k.r); return; } if (k.m === 'scrub') return; if (!k.moved) { if (k.c) { sel = sel === k.c ? null : k.c; buzz(6); } else { sel = null; S.seek(clamp(Math.floor(barAt(p.x)), 0, q.arr.bars - 1)); } bar(); return; } if (k.m !== 'lane') { q.place(k.c); if (k.c.start + k.c.len > q.arr.bars) q.arr.bars = k.c.start + k.c.len; q.changed(); bar(); } },
    twoStart: () => { if (d?.moved && d.m !== 'lane' && d.o) { Object.assign(d.c, d.o); q.undos.pop(); } d = null; }, two: (e) => { lastTouch = performance.now(); const w = B() - a, at = barAt(e.x - e.dx), nw = clamp(w / e.ds, 2, q.arr.bars); look(at - ((e.x - LW) / (C.W - LW)) * nw, nw); },
  });

  // ---- what the chosen part can do
  const row = h('div', { class: 'tlbar' }), btn = (label, title, fn, cls = '') => h('button', { type: 'button', class: 'tlb ' + cls, title, onclick: () => { fn(); buzz(8); } }, label);
  const edit = (fn) => () => { if (!sel) return; q.snapshot(); fn(sel); q.changed(); bar(); };
  const fx = (k, v) => edit((c) => { const f = { r: 0, s: 1, u: 0, g: 1, ...c.fx }; f[k] = f[k] === v ? (k === 's' || k === 'g' ? 1 : 0) : v; c.fx = f.r || f.s !== 1 || f.u || f.g !== 1 ? f : undefined; });
  function bar() {
    const c = sel; let k = [];
    if (c) {
      const stem = c.src !== undefined, f = c.fx || {};
      k = [btn('Split', 'Cut it at the playhead, or in half', edit((x) => { if (x.len < 2) return; const pb = Math.round(q.tl(q.nowBeat()) / bpb()) - x.start, at = pb > 0 && pb < x.len ? pb : Math.floor(x.len / 2), r = { ...x, id: q.uid++, start: x.start + at, len: x.len - at, fx: x.fx ? { ...x.fx } : undefined }; if (stem) shiftSrc(r, at); else r.off = (x.off || 0) + at; x.len = at; q.arr.clips.push(r); })),
        btn('Again', 'The same once more, right after', edit((x) => { const r = q.place({ ...x, id: undefined, start: x.start + x.len, fx: x.fx ? { ...x.fx } : undefined }); if (r.start + r.len > q.arr.bars) q.arr.bars = r.start + r.len; sel = r; })),
        btn('Loop', 'Go round this part', () => { q.snapshot(); const same = q.arr.cycle?.[0] === c.start && q.arr.cycle?.[1] === c.start + c.len; q.arr.cycle = same ? null : [c.start, c.start + c.len]; q.changed(); bar(); }, q.arr.cycle?.[0] === c.start && q.arr.cycle?.[1] === c.start + c.len ? 'on' : ''),
        ...(stem ? [btn('◂', 'Backwards', fx('r', 1), f.r ? 'on' : ''), btn('½', 'Half speed', fx('s', 0.5), f.s === 0.5 ? 'on' : ''), btn('×8', 'Stutter', fx('u', 8), f.u ? 'on' : '')] : []),
        ...(typeof c.lane === 'number' ? [btn('−12', 'An octave down', edit((x) => { x.tr = (x.tr || 0) - 12; })), btn('+12', 'An octave up', edit((x) => { x.tr = (x.tr || 0) + 12; }))] : []),
        ...(c.cap ? [btn('Open', 'Edit its slices', () => openPiece(c.cap))] : []),
        btn('Delete', 'Take it off the tape', edit((x) => { q.arr.clips = q.arr.clips.filter((y) => y !== x); sel = null; }), 'del')];
    } else k = [btn('Fit', 'The whole song', () => { a = 0; b = null; }), btn('Near', 'Sixteen bars around the playhead', () => { const p = q.tl(q.nowBeat()) / bpb(); look(p - 4, 16); }), btn(q.arr.cycle ? 'Loop off' : 'Loop 4', 'Go round four bars', () => { q.snapshot(); const p = Math.floor(q.tl(q.nowBeat()) / bpb() / 4) * 4; q.arr.cycle = q.arr.cycle ? null : [p, Math.min(q.arr.bars, p + 4)]; q.changed(); bar(); }, q.arr.cycle ? 'on' : ''), btn('Redo', 'Redo', () => { q.redo(); touchUp(); }), btn('+ 8 bars', 'More room at the end', () => { q.snapshot(); q.arr.bars += 8; q.changed(); })];
    row.replaceChildren(...k);
  }
  bar(); q.addEventListener('change', () => { if (sel && !q.arr.clips.includes(sel)) { sel = null; bar(); } });

  const level = (cl, rel) => { const sb = srcBar(cl, rel, song.numBars).bar, c = Math.floor(sb / cb), one = String(cl.lane).startsWith('stem:') && song.stems.find((s) => 'stem:' + s.id === cl.lane); if (one) { const x = one.cells[c]; return x ? clamp((x.rms + 50) / 40, 0.06, 1) : 0; } let n = 0; for (const s of song.stems) if (s.cells[c]?.rms > -45 && !cl.mute?.includes(s.id)) n++; return Math.min(1, n / 12); };
  const events = (list, x0, y, hh, col, isM, w) => { g.fillStyle = g.strokeStyle = col; if (isM) { const by = {}; for (const e of list) if (e.k === 'm' && typeof e.v === 'number') (by[e.path] ??= []).push(e); g.lineWidth = 1; for (const [p, pts] of Object.entries(by).slice(0, 14)) { const [mn, mx] = P.range?.[p] || [0, 1], st = Math.max(1, Math.floor(pts.length / 80)); pts.sort((m, n) => m.b - n.b); g.beginPath(); for (let i = 0; i < pts.length; i += st) { const px = x0 + (pts[i].b / bpb()) * ppb(), py = y + hh - 2 - (hh - 4) * clamp((pts[i].v - mn) / (mx - mn || 1), 0, 1); if (px > x0 + w) break; i ? g.lineTo(px, py) : g.moveTo(px, py); } g.stroke(); } return; } let lo = 127, hi = 0; for (const e of list) if (e.k === 'n') { lo = Math.min(lo, e.note); hi = Math.max(hi, e.note); } for (const e of list) if (e.k === 'n') { const px = x0 + (e.b / bpb()) * ppb(); if (px > x0 + w) continue; g.fillRect(px, y + hh - 5 - (hh - 9) * (hi > lo ? (e.note - lo) / (hi - lo) : 0.5), Math.max(1.5, (e.d / bpb()) * ppb() - 0.5), 2.6); } };
  function draw() {
    const { W, H } = C; if (!W) return; const rh = rowH(), k = ppb(), pos = q.tl(q.nowBeat()) / bpb(); if (player.playing && b !== null && !d && performance.now() - lastTouch > 1800 && (pos > B() - 0.5 || pos < a)) look(pos - 0.5, B() - a);
    g.clearRect(0, 0, W, H); g.textBaseline = 'middle'; g.textAlign = 'left';
    LANES.forEach((_, i) => { g.fillStyle = i % 2 ? '#ffffff08' : '#ffffff03'; g.fillRect(LW, TOP + i * rh, W - LW, rh); });
    const every = k > 26 ? 1 : k > 13 ? 2 : k > 7 ? 4 : k > 3.4 ? 8 : 16; g.font = '9px "IBM Plex Mono", monospace'; for (let n = Math.ceil(a / every) * every; n <= B(); n += every) { g.fillStyle = n % 4 ? '#ffffff0c' : '#ffffff1c'; g.fillRect(X(n), TOP, 1, H - TOP); g.fillStyle = '#8b909b'; g.fillText(String(n + 1), X(n) + 3, TOP / 2); }
    const cy = q.arr.cycle; if (cy) { g.fillStyle = '#e6b45022'; g.fillRect(X(cy[0]), 0, (cy[1] - cy[0]) * k, H); g.fillStyle = '#e6b450'; g.fillRect(X(cy[0]), TOP - 3, (cy[1] - cy[0]) * k, 3); }
    g.save(); g.beginPath(); g.rect(LW, 0, W - LW, H); g.clip();
    for (const cl of q.arr.clips) {
      const r = rowOf(cl); if (r < 0) continue; const x = X(cl.start), w = Math.max(2, cl.len * k), y = TOP + r * rh + 2, hh = rh - 4; if (x > W || x + w < LW) continue; const col = cl.src !== undefined && r === 1 ? song.stems.find((s) => 'stem:' + s.id === cl.lane)?.color || LANES[1][2] : LANES[r][2], on = cl === sel;
      g.globalAlpha = off(r) ? 0.3 : 1; g.fillStyle = col + (on ? '55' : '26'); g.beginPath(); g.roundRect(x + 0.5, y, w - 1, hh, 4); g.fill(); g.fillStyle = col; g.fillRect(x + 0.5, y + 2, 2, hh - 4);
      g.save(); g.beginPath(); g.rect(Math.max(LW, x), y, w - 1, hh); g.clip();
      if (cl.src !== undefined) { const st = Math.max(1, Math.floor(1.5 / k)); for (let i = 0; i < cl.len; i += st) { const v = cl.mute?.length >= song.stems.length ? 0 : level(cl, i), bh = v * (hh - 6); g.fillStyle = col + '8c'; g.fillRect(x + i * k + 1, y + hh - 2 - bh, Math.max(0.8, k * st - 1.2), bh); } }
      else if (cl.pat != null && q.vars[cl.pat]) { const lane = cl.lane, part = cl.part ?? cl.lane, pb = q.pb(cl.pat) / bpb(), ev = q.vars[cl.pat].filter((e) => (lane === 'm' ? e.k === 'm' : e.k === 'n' && e.slot === part)); for (let n = -(cl.off || 0); n < cl.len; n += pb) if (n + pb > 0) events(ev, x + n * k, y, hh, col, lane === 'm', Math.min(pb, cl.len - n) * k); }
      const f = cl.fx || {}, tag = cl.src !== undefined ? `${f.r ? '◂ ' : ''}${f.s === 0.5 ? '½ ' : ''}${f.u ? `×${f.u} ` : ''}` + (r === 1 ? song.stems.find((s) => 'stem:' + s.id === cl.lane)?.name || '' : cl.name || '') : cl.tr ? `${cl.tr > 0 ? '+' : ''}${cl.tr}` : ''; if (tag && w > 22) { g.font = '9px "IBM Plex Mono", monospace'; g.fillStyle = '#fff'; g.fillText(tag, Math.max(x + 6, LW + 4), y + 8); }
      g.restore(); if (on) { g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.beginPath(); g.roundRect(x + 0.5, y, w - 1, hh, 4); g.stroke(); g.fillStyle = '#fff'; for (const u of [x + 4, x + w - 7]) { g.beginPath(); g.roundRect(u, y + hh / 2 - 8, 3, 16, 1.5); g.fill(); } } g.globalAlpha = 1;
    }
    const vc = song.stems.find((x) => x.voice)?.cells || []; if (vc.some(Boolean)) for (let n = Math.floor(a); n < B(); n++) if (vc[Math.floor(srcAt(n) / cb)]) { g.fillStyle = '#df8a7466'; g.fillRect(X(n) + 0.5, TOP + 3 * rh + 2, Math.max(1, k - 1), rh - 4); }
    // what is being recorded, as it lands
    const t = q.take; if (t) { const list = q.vars[t.pat] || [], x = X(t.start), w = Math.max(3, (t.len || Math.max(0.05, pos - t.start)) * k); for (const lane of new Set(list.map((e) => (e.k === 'n' ? e.slot : 'm')))) { const r = LANES.findIndex((l) => l[0] === lane); if (r < 0) continue; const y = TOP + r * rh + 2; g.fillStyle = '#df8a7440'; g.beginPath(); g.roundRect(x, y, w, rh - 4, 4); g.fill(); g.strokeStyle = '#df8a74'; g.lineWidth = 1; g.stroke(); events(list.filter((e) => (lane === 'm' ? e.k === 'm' : e.k === 'n' && e.slot === lane)), x, y, rh - 4, '#fff', lane === 'm', w); } }
    g.fillStyle = q.rec ? '#df8a74' : '#fff'; g.fillRect(X(pos) - 1, 0, 2, H); g.beginPath(); g.moveTo(X(pos) - 6, 0); g.lineTo(X(pos) + 6, 0); g.lineTo(X(pos), 8); g.fill(); g.restore();
    LANES.forEach(([, nm, col], i) => { const y = TOP + i * rh, o = off(i); g.fillStyle = '#11141b'; g.fillRect(0, y, LW - 2, rh); g.fillStyle = o ? '#ffffff22' : col; g.beginPath(); g.arc(8, y + rh / 2, 3.4, 0, 7); g.fill(); g.font = '10px "IBM Plex Mono", monospace'; g.fillStyle = o ? '#6f747f' : '#d6d2c6'; g.fillText(nm, 16, y + rh / 2, LW - 18); }); g.fillStyle = '#11141b'; g.fillRect(0, 0, LW - 2, TOP);
  }
  S.timeline = { get sel() { return sel; }, set sel(c) { sel = c; bar(); }, look, get range() { return [a, B()]; } };
  return { el, row, draw, show: (c) => { sel = c || sel; bar(); if (c) { const w = B() - a; if (b !== null && (c.start < a || c.start + c.len > B())) look(c.start - 1, w); } } };
}
