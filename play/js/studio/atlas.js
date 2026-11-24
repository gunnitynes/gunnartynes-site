// The Atlas: every bar of every stem as one dot on a map of how it sounds — darker to brighter across, still to
// busy upwards, in its musician's colour, as big as it is loud. Touch a dot and you hear that bar (in time with
// the band, looping while you hold); sweep across the map and you play a path through the song's sounds. With
// "Draw onto the tape" on, the path is written on the musicians' lanes in the Arrangement, a bar at a time.
// The bars the band is playing right now glow where they sit on the map.
import { h } from '../lib/util.js';

export function openAtlas(S, { say = () => {} } = {}) {
  if (!S.feat) { say('The Atlas needs this song measured first'); return; }
  if (S.atlasEl) { S.atlasEl.hidden = false; S.atlasEl.open(); return; }
  const f = S.feat, song = S.song, cb = song.barsPerCell, p = S.player, q = S.seq;
  // the dots: placed by rank, so they spread over the whole map instead of crowding in one corner
  const pts = [];
  for (const st of song.stems) { if (st.voice) continue; const rows = f.stems[st.id] || []; rows.forEach((x, b) => { if (x && x.d > -48 && st.cells[Math.floor(b / cb)]) pts.push({ st, b, x, bright: x.b + x.n * 0.15, busy: x.o.reduce((a, v) => a + v, 0) }); }); }
  const rank = (k) => { const s = [...pts].sort((a, b) => a[k] - b[k]); s.forEach((pt, i) => { pt[k + 'R'] = i / Math.max(1, s.length - 1); }); };
  rank('bright'); rank('busy');
  for (const pt of pts) { pt.u = 0.04 + 0.92 * pt.brightR + (Math.random() - 0.5) * 0.01; pt.v = 0.06 + 0.88 * pt.busyR + (Math.random() - 0.5) * 0.01; pt.r = 2 + Math.max(0, Math.min(1, (pt.x.d + 48) / 36)) * 5; }
  const byKey = new Map(pts.map((pt) => [pt.st.id + ':' + pt.b, pt]));

  const cv = h('canvas'), g = cv.getContext('2d'), stat = h('canvas'), sg = stat.getContext('2d');
  const now = h('span', { class: 'atlas-now' }, 'Touch a dot to hear it · sweep to play a path');
  const drawB = h('button', { type: 'button', class: 'atlas-draw', title: 'Write the path you play onto the musicians’ lanes in the Arrangement, a bar at a time' }, h('i'), 'Draw onto the tape');
  const close = h('button', { type: 'button', class: 'atlas-x', 'aria-label': 'Close the Atlas' }, '×');
  const fams = [...new Map(song.stems.filter((s) => !s.voice).map((s) => [s.group, s.color])).entries()];
  const el = h('div', { id: 'atlas' },
    h('div', { class: 'atlas-top' }, h('b', { class: 'atlas-t' }, 'Atlas'), h('span', { class: 'atlas-leg' }, ...fams.map(([gname, col]) => h('span', {}, h('i', { style: { background: col } }), gname))), h('span', { class: 'sp' }), drawB, close),
    h('div', { class: 'atlas-map' }, cv, h('span', { class: 'ax ax-x' }, 'darker  ←  →  brighter'), h('span', { class: 'ax ax-y' }, 'still  ↓  ↑  busy')),
    now);
  document.body.append(el); S.atlasEl = el;
  let W = 0, H = 0, raf = 0;
  const box = el.querySelector('.atlas-map');
  const size = () => { const r = box.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1); W = r.width; H = r.height; for (const c of [cv, stat]) { c.width = W * d; c.height = H * d; } cv.style.width = W + 'px'; cv.style.height = H + 'px'; g.setTransform(d, 0, 0, d, 0, 0); sg.setTransform(d, 0, 0, d, 0, 0); paintStatic(); };
  new ResizeObserver(size).observe(box);
  const X = (pt) => pt.u * W, Y = (pt) => (1 - pt.v) * H;
  function paintStatic() {
    sg.clearRect(0, 0, W, H);
    sg.strokeStyle = '#ffffff0c'; for (let i = 1; i < 4; i++) { sg.beginPath(); sg.moveTo((W * i) / 4, 0); sg.lineTo((W * i) / 4, H); sg.moveTo(0, (H * i) / 4); sg.lineTo(W, (H * i) / 4); sg.stroke(); }
    for (const pt of pts) { sg.globalAlpha = 0.55; sg.fillStyle = pt.st.color || '#ece8dc'; sg.beginPath(); sg.arc(X(pt), Y(pt), pt.r, 0, 7); sg.fill(); }
    sg.globalAlpha = 1;
  }

  // ---- playing a dot: the bar from the beat the band is on, looping while held, through the stem's channel
  let voice = null, held = null, gesture = [];
  const stopVoice = (t = S.ctx.currentTime) => { if (!voice) return; const v = voice; voice = null; v.g.gain.cancelScheduledValues(t); v.g.gain.setValueAtTime(v.g.gain.value, t); v.g.gain.linearRampToValueAtTime(0, t + 0.08); v.src.stop(t + 0.1); };
  async function play(pt) {
    const cell = pt.st.cells[Math.floor(pt.b / cb)]; if (!cell) return;
    const buf = await S.loader.ensure(cell.url); if (!buf || held !== pt) return;
    await S.ctx.resume();
    const c = S.ctx, bd = song.barDur, a0 = (pt.b % cb) * bd, rate = p.r;
    let t = c.currentTime + 0.02, off = 0;
    if (p.playing) { const sd = p.stepDur, k = Math.ceil((t - p.bar0) / sd); t = p.bar0 + k * sd; off = ((k % 16) + 16) % 16 * (bd / 16); }
    stopVoice(t);
    const src = c.createBufferSource(); src.buffer = buf; src.playbackRate.value = rate; src.loop = true; src.loopStart = a0; src.loopEnd = Math.min(buf.duration, a0 + bd);
    const gn = c.createGain(); gn.gain.value = 0; gn.gain.setValueAtTime(0, t); gn.gain.linearRampToValueAtTime(1, t + 0.012);
    src.connect(gn).connect(S.engine.channel(pt.st.id).input); src.start(t, a0 + off);
    voice = { src, g: gn, pt };
    now.textContent = `${pt.st.name} · bar ${pt.b + 1} of the song`;
  }
  const nearest = (mx, my) => { let best = null, bd = 900; for (const pt of pts) { const d = (X(pt) - mx) ** 2 + (Y(pt) - my) ** 2; if (d < bd) { bd = d; best = pt; } } return best; };
  const at = (e) => { const r = cv.getBoundingClientRect(); const pt = nearest(e.clientX - r.left, e.clientY - r.top); if (pt && pt !== held) { held = pt; play(pt); } };
  let down = false;
  cv.addEventListener('pointerdown', (e) => { e.preventDefault(); try { cv.setPointerCapture(e.pointerId); } catch { /* fine */ } down = true; gesture = []; at(e); });
  cv.addEventListener('pointermove', (e) => { if (down) at(e); });
  const lift = () => {
    down = false; held = null; stopVoice();
    // drawn bars were written silent while you heard them here; now they sound from the tape
    if (gesture.length) { for (const cl of gesture) delete cl.fx; q.changed(); say(`${gesture.length} bar${gesture.length > 1 ? 's' : ''} drawn onto the tape · Undo takes ${gesture.length > 1 ? 'them' : 'it'} back`); gesture = []; }
  };
  cv.addEventListener('pointerup', lift); cv.addEventListener('pointercancel', lift);

  // ---- drawing onto the tape: each bar you hold a dot through is written on that musician's lane
  let drawing = false;
  drawB.onclick = () => { drawing = !drawing; drawB.classList.toggle('on', drawing); if (drawing) { if (q.mode !== 'song') q.setMode('song'); if (!p.playing) p.play(); } };
  const offBar = p.on('bar', ({ bar }) => {
    if (!drawing || !held || q.mode !== 'song') return;
    const bpb = song.beatsPerBar, T = Math.floor(q.tl((bar + 1) * bpb) / bpb);
    if (!gesture.length) q.snapshot();
    const cl = q.place({ lane: 'stem:' + held.st.id, start: T, len: 1, src: held.b, fx: { g: 0 }, name: 'atlas' });
    if (T + 1 > q.arr.bars) q.arr.bars = T + 1; gesture.push(cl); q.changed();
  });

  // ---- every frame: what the band plays now glows where it sits
  function frame() {
    if (el.hidden) return; raf = requestAnimationFrame(frame);
    g.clearRect(0, 0, W, H); g.drawImage(stat, 0, 0, W, H);
    if (p.playing) {
      const B = p.barNow();
      for (const st of song.stems) {
        const w = p.resolve(S.session.state.tracks[st.id], B); if (!w) continue;
        const pt = byKey.get(st.id + ':' + (w.cell * cb + w.bar)); if (!pt) continue;
        const ch = S.engine.channels.get(st.id), lv = ch ? Math.min(1, ch.readLevel() * 3) : 0.3;
        g.fillStyle = pt.st.color || '#ece8dc'; g.globalAlpha = 0.25 + lv * 0.6; g.beginPath(); g.arc(X(pt), Y(pt), pt.r + 6 + lv * 10, 0, 7); g.fill();
        g.globalAlpha = 1; g.beginPath(); g.arc(X(pt), Y(pt), pt.r + 1, 0, 7); g.fill();
      }
    }
    if (voice) { const pt = voice.pt; g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.arc(X(pt), Y(pt), pt.r + 9, 0, 7); g.stroke(); }
  }
  el.open = () => { cancelAnimationFrame(raf); requestAnimationFrame(() => { size(); frame(); }); };
  close.onclick = () => { lift(); el.hidden = true; cancelAnimationFrame(raf); };
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !el.hidden) close.onclick(); });
  void offBar;
  el.open();
}
