// The Song room: a timeline in the manner of a DAW's arrangement. The band lane holds pieces of the original song
// (drag the song's parts around, repeat them, cut them; open the lane up to give each musician their own pieces);
// the instrument lanes hold pattern clips; the moves lane holds recorded and drawn knob moves. Below it, the
// pattern editor: a piano roll for notes (drawn, played in step by step, or recorded live) and a pencil for moves.
import { $, h } from '../lib/util.js';
import { PATS, isTake, takeName, srcBar, shiftSrc } from './core.js';

const NOTE = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const nn = (m) => `${NOTE[m % 12]}${Math.floor(m / 12) - 1}`;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
function sizer(box, cv, g, on) { new ResizeObserver(() => { const r = box.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1); cv.width = Math.max(1, r.width * d); cv.height = Math.max(1, r.height * d); cv.style.width = r.width + 'px'; cv.style.height = r.height + 'px'; g.setTransform(d, 0, 0, d, 0, 0); on(r.width, r.height); }).observe(box); }

export function buildSong(S, { COLORS, NAMES }) {
  const room = $('#room-song'), seq = S.seq, song = S.song, P = S.params, bpb = song.beatsPerBar, cb = song.barsPerCell;
  const LANE = 34, STEM = 24;
  let expanded = false, sel = null, pxb = 0, x0 = 0, fit = true, W = 0;
  const level = (cell) => (cell ? clamp((cell.rms + 50) / 40, 0.08, 1) : 0);
  const bandAt = (bar) => { const c = Math.floor((((bar % song.numBars) + song.numBars) % song.numBars) / cb); let m = 0; for (const st of song.stems) m = Math.max(m, level(st.cells[c])); return m; };
  const lanes = () => {
    const L = [{ id: 'band', name: 'Stems', color: '#ece8dc', h: LANE }];
    if (expanded) for (const st of song.stems) L.push({ id: 'stem:' + st.id, name: st.name, color: '#a3a6ad', h: STEM, stem: st });
    for (let i = 0; i < S.slots.length; i++) L.push({ id: i, name: NAMES[i], color: COLORS[i], h: LANE });
    L.push({ id: 'm', name: 'Moves', color: '#a3a6ad', h: LANE });
    let y = 0; for (const l of L) { l.y = y; y += l.h; } L.total = y; return L;
  };
  let L = lanes();
  const isBandLane = (id) => id === 'band' || String(id).startsWith('stem:');
  const isOwn = (stemId) => !!seq.arr.own?.[stemId];
  // a stem that follows the Stems lane shows those pieces on its own lane, faintly ("ghosts"): what it really plays
  const ghostsOf = (stemId) => (isOwn(stemId) ? [] : seq.arr.clips.filter((c) => c.lane === 'band' && !c.mute?.includes(stemId)));
  const ghostAt = (lane, bar) => lane.stem && !clipAt(lane.id, bar) && ghostsOf(lane.stem.id).find((c) => bar >= c.start && bar < c.start + c.len);
  /** Turn a ghost into a real piece on the stem's own lane (the stem stops following the Stems lane). */
  const realize = (g, bar) => { seq.detach(g.stemId); seq.applyBand(); buildHeads(); return clipAt('stem:' + g.stemId, bar ?? g.at) || null; };
  const laneColor = (id) => (typeof id === 'number' ? COLORS[id] : id === 'm' ? '#a3a6ad' : '#ece8dc');

  // ---------------------------------------------------------------- toolbar
  const btn = (label, title, onclick, cls = 'pill') => h('button', { type: 'button', class: cls, title, onclick }, label);
  const cycle = h('button', { type: 'button', class: 'sw', title: 'Loop one stretch of the arrangement (drag across the ruler to choose it)', onclick: () => { seq.snapshot(); if (seq.arr.cycle) { seq.lastCycle = seq.arr.cycle; seq.arr.cycle = null; } else { const b = Math.floor(seq.tl(seq.nowBeat()) / bpb / 4) * 4; seq.arr.cycle = seq.lastCycle || [b, Math.min(seq.arr.bars, b + 4)]; } seq.changed(); } }, h('i'), 'Loop');
  const lenIn = h('input', { type: 'number', min: 1, max: 999, class: 'num', title: 'Length of the arrangement in bars', onchange: (e) => { seq.snapshot(); seq.arr.bars = clamp(Math.round(+e.target.value || 1), 1, 999); seq.changed(); } });
  const zoom = (f, at) => { const ph = seq.tl(seq.nowBeat()) / bpb, ox = at ?? (xOf(ph) >= 0 && xOf(ph) <= W ? xOf(ph) : 0), bar = x0 + ox / pxb; fit = false; pxb = clamp(pxb * f, 2, 160); x0 = Math.max(0, bar - ox / pxb); };
  const undo = btn('Undo', 'Undo (⌘Z)', () => seq.undo()), redo = btn('Redo', 'Redo (⇧⌘Z)', () => seq.redo());
  const bounceB = btn('Bounce .wav', 'Play the whole arrangement (or the loop) once and save it as a sound file', () => bounce());
  const fileIn = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: async (e) => { const f = e.target.files[0]; if (!f) return; try { S.loadProject(JSON.parse(await f.text())); } catch (err) { alert('That file could not be opened: ' + err.message); } e.target.value = ''; } });
  room.append(h('div', { class: 'bar2' },
    h('span', { class: 'cap' }, 'Arrangement'), lenIn, h('span', { class: 'cap' }, 'bars'), cycle,
    btn('Reset stems', 'Put the original stems back on the Stems lanes', () => { if (!confirm('Reset the stems?\n\nThis puts the original stems back in the arrangement and replaces every change you made on the Stems lanes (moved, repeated or cut parts, and each stem\'s own lane). Your instrument clips and moves stay.\n\nYou can undo this.')) return; seq.snapshot(); seq.fillFromSong(); seq.arr.clips = seq.arr.clips.filter((c) => !String(c.lane).startsWith('stem:')); seq.arr.own = {}; seq.changed(); buildHeads(); }),
    h('div', { class: 'seg' }, btn('−', 'Zoom out', () => zoom(1 / 1.4), ''), btn('Fit', 'Show the whole song', () => { fit = true; x0 = 0; }, ''), btn('+', 'Zoom in', () => zoom(1.4), '')),
    h('span', { class: 'sp' }), undo, redo,
    btn('Save', 'Save everything as a file on this computer', () => download(new Blob([JSON.stringify(S.projectData())], { type: 'application/json' }), `${song.title} · playground.json`)),
    btn('Open', 'Open a saved playground file', () => fileIn.click()), fileIn,
    btn('New', 'Start again from nothing', () => { if (confirm('Start again? Everything here will be cleared.')) S.reset(); }), bounceB));

  // ---------------------------------------------------------------- palette (drag onto the timeline)
  const parts = h('div', { class: 'pal' }), pats = h('div', { class: 'pal' });
  for (const s of song.sections) {
    const len = (s.endCell - s.startCell) * cb, src = s.startCell * cb;
    const c = h('button', { type: 'button', class: 'pchip part', draggable: 'true', title: `Part ${s.name}: bars ${src + 1}–${src + len} of the original · drag it onto the Stems lane` }, s.name, h('small', {}, `${len}`));
    c.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', JSON.stringify({ src, len, name: s.name })); e.dataTransfer.effectAllowed = 'copy'; drag = { kind: 'part', len }; });
    c.addEventListener('dragend', () => { drag = null; });
    parts.append(c);
  }
  const showPats = () => {
    const shown = PATS.filter((k, i) => seq.used(k) || k === seq.cur || i < 4), firstFree = PATS.find((k) => !seq.used(k) && !shown.includes(k));
    if (firstFree) shown.push(firstFree);
    pats.replaceChildren(...shown.map((k) => {
      const ev = seq.vars[k], dots = [...S.slots.keys()].filter((s) => ev.some((e) => e.k === 'n' && e.slot === s)).map((s) => h('i', { style: { background: COLORS[s] } }));
      if (ev.some((e) => e.k === 'm')) dots.push(h('i', { style: { background: '#a3a6ad' } }));
      const c = h('button', { type: 'button', class: 'pchip pat', draggable: 'true', 'aria-pressed': k === seq.cur, title: `Pattern ${k} · ${seq.lens[k]} bars · click to edit, drag onto an instrument lane` , onclick: () => { seq.cur = k; seq.emit(); } }, k, h('span', { class: 'dots' }, ...dots), h('small', {}, `${seq.lens[k]}`));
      c.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', JSON.stringify({ pat: k })); e.dataTransfer.effectAllowed = 'copy'; drag = { kind: 'pat', len: seq.lens[k] }; });
      c.addEventListener('dragend', () => { drag = null; });
      return c;
    }));
  };
  let drag = null;
  room.append(h('div', { class: 'palette' }, h('span', { class: 'cap' }, 'Parts of the song'), parts, h('span', { class: 'cap' }, 'Patterns'), pats, h('span', { class: 'sp' }), h('span', { class: 'hintline' }, 'drag onto a lane · double-click a lane to add · drag edges to resize · ⌥-drag copies')));

  // ---------------------------------------------------------------- the timeline
  const ruler = h('div', { class: 'tl-ruler' }), rcv = h('canvas'), rg = rcv.getContext('2d'); ruler.append(rcv);
  const heads = h('div', { class: 'tl-heads' });
  const box = h('div', { class: 'tl-box' }), cv = h('canvas'), g = cv.getContext('2d'); box.append(cv);
  const jamNote = h('div', { class: 'tl-jam' }, h('span', {}, 'Looping one pattern — the arrangement is resting'), h('button', { type: 'button', class: 'pill on', onclick: () => seq.setMode('song') }, 'Play the arrangement'));
  const scroll = h('div', { class: 'tl-scroll' }, h('div', { class: 'tl-inner' }, heads, box));
  const corner = h('div', { class: 'tl-corner' }, h('span', { class: 'cap' }, 'bar'));
  room.append(h('div', { class: 'tl' }, corner, ruler, scroll, jamNote));
  let RW = 0, H = 0;
  sizer(ruler, rcv, rg, (w) => { RW = w; });
  sizer(box, cv, g, (w, hh) => { W = w; H = hh; });
  const fitNow = () => {
    if (fit && W) { pxb = W / Math.max(4, seq.arr.bars); x0 = 0; return; }
    // while playing, the view turns the page when the playhead runs off it
    if (seq.mode === 'song' && S.player.playing && !act && W) { const ph = seq.tl(seq.nowBeat()) / bpb, vis = W / pxb; if (ph < x0 || ph > x0 + vis * 0.97) x0 = Math.max(0, ph - vis * 0.05); }
  };
  const xOf = (bar) => (bar - x0) * pxb, barOf = (x) => x0 + x / pxb;

  const buildHeads = () => {
    L = lanes(); box.style.height = L.total + 'px'; room.classList.toggle('stems-open', expanded);
    heads.replaceChildren(...L.map((l) => {
      const row = h('div', { class: 'lh' + (l.stem ? ' stem' : ''), style: { height: l.h + 'px', '--c': l.color } });
      if (l.id === 'band') row.append(h('button', { type: 'button', class: 'exp', title: expanded ? 'Close the stems' : 'Open the stems up: a lane for every stem', onclick: () => { expanded = !expanded; buildHeads(); } }, expanded ? '▾' : '▸'), h('i'), h('span', { class: 'ln' }, 'Stems'), sw2('band.on', 'On', 'All the stems on or off (B)'));
      else if (l.stem) {
        const mine = isOwn(l.stem.id);
        row.classList.toggle('own', mine);
        row.append(h('span', { class: 'ln', title: mine ? `${l.name} has its own lane: the Stems lane above no longer moves it` : `${l.name} follows the Stems lane above · drag, cut or change any piece and it gets a lane of its own` }, l.name),
          mine ? h('button', { type: 'button', class: 'mini', title: `Let ${l.name} follow the Stems lane again (its own pieces go; you can undo)`, onclick: () => { seq.snapshot(); seq.attach(l.stem.id); sel = null; seq.changed(); buildHeads(); showEd(); } }, '↺') : '',
          ms2(`band.${l.stem.id}.mute`, 'M'));
      }
      else {
        const m = h('button', { type: 'button', class: 'ms mute', title: 'Mute this lane in the song', onclick: () => { seq.mute.has(l.id) ? seq.mute.delete(l.id) : seq.mute.add(l.id); seq.emit(); } }, 'M');
        m.setAttribute('aria-pressed', seq.mute.has(l.id));
        row.append(h('i'), h('button', { type: 'button', class: 'ln', title: l.id === 'm' ? 'Moves of every knob' : `Play and edit ${l.name}`, onclick: () => { if (l.id !== 'm') S.selectSlot(l.id); ed.part = l.id; showEd(); } }, l.name), m);
      }
      return row;
    }));
  };
  const sw2 = (path, label, title) => { const b = h('button', { type: 'button', class: 'mini', title, onclick: () => P.set(path, !P.get(path)) }, label); const s = () => b.setAttribute('aria-pressed', !!P.get(path)); P.on(({ path: p }) => p === path && s()); s(); return b; };
  const ms2 = (path, label) => { const b = h('button', { type: 'button', class: 'ms mute', title: 'Mute', onclick: () => P.set(path, !P.get(path)) }, label); const s = () => b.setAttribute('aria-pressed', !!P.get(path)); P.on(({ path: p }) => p === path && s()); s(); return b; };
  buildHeads();

  const laneAtY = (y) => L.find((l) => y >= l.y && y < l.y + l.h);
  const clipsOn = (id) => seq.arr.clips.filter((c) => c.lane === id);
  const clipAt = (id, bar) => clipsOn(id).reverse().find((c) => bar >= c.start && bar < c.start + c.len);
  const newClip = (lane, bar) => {
    bar = Math.max(0, Math.floor(bar));
    if (isBandLane(lane)) return { lane, start: bar, len: 4, src: bar % song.numBars };
    const k = seq.cur, part = lane === 'm' ? 'm' : partFor(k, lane);
    return { lane, part, start: bar, len: seq.lens[k], pat: k };
  };
  const partFor = (k, lane) => { const ev = seq.vars[k]; if (ev.some((e) => e.k === 'n' && e.slot === lane) || !ev.length) return lane; const s = ev.find((e) => e.k === 'n'); return s ? s.slot : lane; };

  // pointer: move / resize / trim clips; double-click adds; ⌥ copies
  let act = null;
  box.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const r = box.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, lane = laneAtY(y); if (!lane) return;
    const bar = barOf(x), gh = ghostAt(lane, bar);
    if (gh) {   // a piece the stem plays from the Stems lane: select it; dragging it gives the stem its own lane
      sel = { ghost: true, stemId: lane.stem.id, band: gh, lane: lane.id, at: bar, name: lane.name }; showEd();
      const xl = xOf(gh.start), xr = xOf(gh.start + gh.len);
      act = { mode: x > xr - 7 && xr - xl > 14 ? 'resize' : x < xl + 6 && xr - xl > 14 ? 'trim' : 'move', ghost: sel, bar0: bar, lane0: lane, moved: false };
      box.setPointerCapture(e.pointerId); return;
    }
    const c = clipAt(lane.id, bar);
    if (!c) { sel = null; showEd(); return; }
    let clip = c;
    if (e.altKey) { clip = { ...c, id: undefined }; seq.snapshot(); seq.place(clip); }
    sel = clip; if (clip.pat) { seq.cur = clip.pat; if (clip.lane !== 'm') { ed.part = clip.part ?? clip.lane; sel0(clip.lane); } else ed.part = 'm'; seq.emit(); } showEd();
    const xl = xOf(c.start), xr = xOf(c.start + c.len);
    const mode = x > xr - 7 && xr - xl > 14 ? 'resize' : x < xl + 6 && xr - xl > 14 ? 'trim' : 'move';
    act = { mode, clip, orig: { ...clip }, bar0: bar, lane0: lane, moved: !!e.altKey };
    box.setPointerCapture(e.pointerId);
  });
  box.addEventListener('pointermove', (e) => {
    const r = box.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (!act) { const lane = laneAtY(y), c = lane && clipAt(lane.id, barOf(x)); box.style.cursor = !c ? 'default' : (x > xOf(c.start + c.len) - 7 || x < xOf(c.start) + 6) ? 'ew-resize' : 'grab'; return; }
    const d = Math.round(barOf(x) - act.bar0);
    if (!act.moved && (d !== 0 || laneAtY(y) !== act.lane0)) {
      act.moved = true; seq.snapshot();
      if (act.ghost) { const c = realize(act.ghost, act.bar0); if (!c) { act = null; return; } act.clip = c; act.orig = { ...c }; sel = c; showEd(); }
    }
    if (!act.moved) return;
    const { clip, orig } = act;
    if (act.mode === 'move') {
      clip.start = Math.max(0, orig.start + d);
      const to = laneAtY(y); if (to && to.id !== clip.lane && isBandLane(to.id) === isBandLane(orig.lane) && (to.id === 'm') === (orig.lane === 'm')) clip.lane = to.id;
    } else if (act.mode === 'resize') clip.len = Math.max(1, orig.len + d);
    else { const dd = Math.min(orig.len - 1, Math.max(-orig.start, d)); clip.start = orig.start + dd; clip.len = orig.len - dd; if (orig.src !== undefined) { Object.assign(clip, shiftSrc({ ...orig }, dd), { start: clip.start, len: clip.len, id: clip.id, lane: clip.lane }); clip.src = ((clip.src % song.numBars) + song.numBars) % song.numBars; } else clip.off = Math.max(0, (orig.off || 0) + dd); }
  });
  const end = () => { if (act?.moved) { seq.place(act.clip); seq.changed(); } act = null; };
  box.addEventListener('pointerup', end); box.addEventListener('pointercancel', end);
  box.addEventListener('dblclick', (e) => {
    const r = box.getBoundingClientRect(), x = e.clientX - r.left, lane = laneAtY(e.clientY - r.top); if (!lane) return;
    if (ghostAt(lane, barOf(x))) return;
    const c = clipAt(lane.id, barOf(x));
    if (c) { if (c.pat) { seq.cur = c.pat; ed.part = c.lane === 'm' ? 'm' : c.part ?? c.lane; if (typeof c.lane === 'number') S.selectSlot(c.lane); } sel = c; showEd(); seq.emit(); return; }
    seq.snapshot(); sel = seq.place(newClip(lane.id, barOf(x))); seq.changed(); showEd();
  });
  box.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); const r = box.getBoundingClientRect(); zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left); }
    else if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) { e.preventDefault(); fit = false; x0 = clamp(x0 + (e.shiftKey ? e.deltaY : e.deltaX) / pxb, 0, Math.max(0, seq.arr.bars - W / pxb + 2)); }
  }, { passive: false });
  // dropping parts and patterns from the palette
  let hoverDrop = null;
  box.addEventListener('dragover', (e) => { if (!drag) return; const r = box.getBoundingClientRect(), lane = laneAtY(e.clientY - r.top); if (!lane || (drag.kind === 'part') !== isBandLane(lane.id) || (drag.kind === 'part' && false)) { hoverDrop = null; return; } e.preventDefault(); hoverDrop = { lane: lane.id, bar: Math.max(0, Math.floor(barOf(e.clientX - r.left))), len: drag.len }; });
  box.addEventListener('dragleave', () => { hoverDrop = null; });
  box.addEventListener('drop', (e) => {
    e.preventDefault(); const r = box.getBoundingClientRect(), lane = laneAtY(e.clientY - r.top); hoverDrop = null; if (!lane) return;
    let d; try { d = JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return; }
    const bar = Math.max(0, Math.floor(barOf(e.clientX - r.left)));
    seq.snapshot();
    if (d.src !== undefined && isBandLane(lane.id)) sel = seq.place({ lane: lane.id, start: bar, len: d.len, src: d.src, name: d.name });
    else if (d.pat && !isBandLane(lane.id)) sel = seq.place({ lane: lane.id, part: lane.id === 'm' ? 'm' : partFor(d.pat, lane.id), start: bar, len: seq.lens[d.pat], pat: d.pat });
    else return;
    if (bar + (sel.len || 0) > seq.arr.bars) seq.arr.bars = bar + sel.len;
    seq.changed(); showEd();
  });
  // the ruler: click to go there, drag to choose the cycle
  let rdrag = null;
  ruler.addEventListener('pointerdown', (e) => { const r = ruler.getBoundingClientRect(); rdrag = { x: e.clientX - r.left, bar: barOf(e.clientX - r.left), moved: false }; ruler.setPointerCapture(e.pointerId); });
  ruler.addEventListener('pointermove', (e) => { if (!rdrag) return; const r = ruler.getBoundingClientRect(), x = e.clientX - r.left; if (Math.abs(x - rdrag.x) > 4) { if (!rdrag.moved) seq.snapshot(); rdrag.moved = true; const a = Math.floor(Math.min(rdrag.bar, barOf(x))), b = Math.ceil(Math.max(rdrag.bar, barOf(x))); seq.arr.cycle = [Math.max(0, a), Math.max(a + 1, b)]; } });
  ruler.addEventListener('pointerup', () => {
    if (!rdrag) return; const was = rdrag; rdrag = null;
    if (was.moved) { seq.changed(); return; }
    const bar = Math.max(0, Math.floor(was.bar)), c = seq.arr.cycle;
    if (c && (bar < c[0] || bar >= c[1])) { seq.lastCycle = c; seq.arr.cycle = null; seq.changed(); }
    if (seq.mode !== 'song') seq.setMode('song');
    S.session.dispatch({ t: 'seek', bar });
  });

  // ---------------------------------------------------------------- the editor / inspector
  const ed = { part: 0, sel: null, path: null, cursor: 0, step: false };
  const edTabs = h('div', { class: 'seg' });
  const buildTabs = () => edTabs.replaceChildren(...[...S.slots.keys(), 'm'].map((p) => { const b = h('button', { type: 'button', onclick: () => { ed.part = p; if (p !== 'm') S.selectSlot(p); showEd(); } }, p === 'm' ? 'Moves' : p === 0 ? 'Cloud' : `Inst ${p}`); b.dataset.p = p; return b; }));
  buildTabs();
  const sc0 = S.slotsChanged; S.slotsChanged = () => { sc0?.(); buildTabs(); buildHeads(); if (typeof ed.part === 'number' && ed.part >= S.slots.length) ed.part = 0; showEd(); };
  const patSel = h('select', { title: 'Which pattern (or recorded take) the editor shows', 'aria-label': 'Pattern', onchange: (e) => { seq.cur = e.target.value; seq.emit(); } });
  const fillPats = () => { const takes = Object.keys(seq.vars).filter((k) => isTake(k) && seq.vars[k].length).sort((a, b) => +a.slice(1) - +b.slice(1)); patSel.replaceChildren(h('optgroup', { label: 'Patterns' }, ...PATS.map((k) => h('option', { value: k }, `Pattern ${k}`))), ...(takes.length ? [h('optgroup', { label: 'Recorded on the arrangement' }, ...takes.map((k) => h('option', { value: k }, takeName(k))))] : [])); };
  const lenSel = h('select', { title: 'Length of this pattern', 'aria-label': 'Pattern length', onchange: (e) => { seq.snapshot(); seq.bars = +e.target.value; seq.emit(); } }, ...[1, 2, 3, 4, 6, 8, 12, 16].map((b) => h('option', { value: b }, `${b} bar${b > 1 ? 's' : ''}`)));
  const snapSel = h('select', { title: 'Grid', 'aria-label': 'Grid', onchange: (e) => { seq.quant = +e.target.value; seq.emit(); } }, ...[[0.125, '1/32'], [0.25, '1/16'], [0.5, '1/8'], [1, '1/4'], [1 / 3, '1/8 triplet'], [0, 'free']].map(([v, l]) => h('option', { value: v }, l)));
  const stepB = h('button', { type: 'button', class: 'sw', title: 'Play notes one at a time into the pattern: each key (or chord) lands on the cursor, which then steps on', onclick: () => { ed.step = !ed.step; stepB.setAttribute('aria-pressed', ed.step); } }, h('i'), 'Step input');
  const restB = btn('Rest', 'Step the cursor on without a note', () => { ed.cursor = (ed.cursor + stepLen()) % seq.beats; });
  const pathSel = h('select', { class: 'path', title: 'Which knob to draw', 'aria-label': 'Which knob', onchange: (e) => { ed.path = e.target.value; } });
  const clearB = btn('Clear part', 'Empty this part of the pattern', () => { seq.clearLane(ed.part); });
  const clipBar = h('div', { class: 'clipbar' });
  const edHead = h('div', { class: 'bar2 ed-bar' }, edTabs, patSel, lenSel, snapSel, stepB, restB, pathSel, clearB, h('span', { class: 'sp' }), clipBar);
  const eruler = h('div', { class: 'ed-ruler' }), ercv = h('canvas'), erg = ercv.getContext('2d'); eruler.append(ercv);
  const escroll = h('div', { class: 'ed-scroll' }), einner = h('div', { class: 'ed-inner' }), ecv = h('canvas'), eg = ecv.getContext('2d'); einner.append(ecv); escroll.append(einner);
  const insp = h('div', { class: 'insp' });
  const edBody = h('div', { class: 'ed-body' }, eruler, escroll);
  room.append(h('section', { class: 'ed' }, edHead, edBody, insp));
  let EW = 0, EH = 0, ERW = 0;
  sizer(einner, ecv, eg, (w, hh) => { EW = w; EH = hh; });
  sizer(eruler, ercv, erg, (w) => { ERW = w; });
  const KEYW = 40, RH = 10, TOP = 108, BOT = 24, rows = TOP - BOT + 1;
  const stepLen = () => seq.quant || 0.25;
  const ppb = () => (EW - KEYW) / seq.beats;
  const snap = (b) => (seq.quant ? Math.round(b / seq.quant) * seq.quant : b);
  const snapDown = (b) => (seq.quant ? Math.floor(b / seq.quant + 1e-6) * seq.quant : b);
  const partNotes = () => seq.vars[seq.cur].filter((e) => e.k === 'n' && e.slot === ed.part);
  const audition = (note) => { const s = S.slots[ed.part]; if (!s) return; const id = `ed${note}`; s.voice.noteOn(id, note, 0.8); setTimeout(() => s.voice.noteOff(id), 220); };

  const fillPaths = () => {
    const rec = [...new Set(seq.vars[seq.cur].filter((e) => e.k === 'm').map((e) => e.path))];
    const label = (p) => {
      const r = P.range?.[p], lab = r?.[2] || p.split('.').pop(), f = /^f(\d)\./.exec(p);
      if (p.startsWith('mix.')) { const k = p.split('.')[1], nm = S.strips[k]?.name || ({ space: 'Space', echo: 'Echo', master: 'Master' })[k] || k; return `Mix · ${String(lab).startsWith(nm) ? lab : `${nm} ${String(lab).toLowerCase()}`}`; }
      if (p.startsWith('band.')) return `Mix · ${p === 'band.level' ? 'all stems' : lab}`;
      return `${p.startsWith('cloud') ? 'Cloud' : f ? `Inst ${f[1]}` : p.startsWith('fx') ? 'Process' : p === 'inst.level' ? 'Mix' : 'Other'} · ${lab}`;
    };
    const all = Object.keys(P.range || {}).filter((p) => typeof P.get(p) === 'number' && P.def[p] !== undefined && (!/^f\d\./.test(p) || S.slots[+p[1]])).sort((a, b) => label(a).localeCompare(label(b)));
    pathSel.replaceChildren(...(rec.length ? [h('optgroup', { label: 'Moved in this pattern' }, ...rec.map((p) => h('option', { value: p }, label(p))))] : []), h('optgroup', { label: 'Any knob' }, ...all.filter((p) => !rec.includes(p)).map((p) => h('option', { value: p }, label(p)))));
    if (!ed.path || ![...pathSel.options].some((o) => o.value === ed.path)) ed.path = rec[0] || 'fx.filter.lp';
    pathSel.value = ed.path;
  };
  function showEd() {
    const band = sel && (sel.ghost || (sel.src !== undefined && seq.arr.clips.includes(sel)));
    edBody.hidden = !!band; insp.hidden = !band; edHead.querySelectorAll(':scope > :not(.clipbar)').forEach((n) => { n.hidden = !!band; });
    edTabs.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(ed.part) === b.dataset.p));
    const moves = ed.part === 'm';
    pathSel.hidden = band || !moves; stepB.hidden = restB.hidden = band || moves;
    einner.style.height = moves ? '100%' : rows * RH + 'px';
    if (moves) fillPaths();
    clipBar.replaceChildren();
    if (band) showInspector();
    else if (sel && seq.arr.clips.includes(sel) && sel.pat) {
      const c = sel, tr = h('span', { class: 'mono' }, `${c.tr > 0 ? '+' : ''}${c.tr || 0}`);
      const setTr = (d) => { seq.snapshot(); c.tr = clamp((c.tr || 0) + d, -24, 24); tr.textContent = `${c.tr > 0 ? '+' : ''}${c.tr}`; seq.emit(); };
      clipBar.append(h('span', { class: 'cap' }, `Clip at bar ${c.start + 1}`),
        h('div', { class: 'seg' }, btn('−', 'Transpose this clip down', () => setTr(-1), ''), tr, btn('+', 'Transpose this clip up', () => setTr(1), '')),
        c.lane !== 'm' ? btn(`plays ${NAMES[c.part ?? c.lane].replace('Instrument ', 'Inst ')}'s part`, 'Which instrument\'s notes this clip plays (it always sounds as its own lane)', () => { seq.snapshot(); const order = [...S.slots.keys()]; c.part = order[(order.indexOf(c.part ?? c.lane) + 1) % 4]; seq.emit(); showEd(); }) : '',
        btn(isTake(c.pat) ? 'Make it a pattern' : 'Own copy', isTake(c.pat) ? 'Copy this recording into a free pattern, to reuse it anywhere' : 'Give this clip a pattern of its own, so editing it changes nothing else', () => { const free = PATS.find((k) => !seq.used(k)); if (!free) return; seq.snapshot(); seq.vars[free] = structuredClone(seq.vars[c.pat]); seq.lens[free] = seq.lens[c.pat]; c.pat = free; seq.cur = free; seq.emit(); }),
        btn('Delete', 'Remove this clip (Delete)', () => delSel()));
    }
  }
  function showInspector() {
    // a ghost (a piece a stem plays from the Stems lane) shows that piece; changing anything gives the stem its own lane
    let c = sel.ghost ? sel.band : sel;
    const ghost = sel.ghost ? sel : null, stemName = ghost ? ghost.name : String(c.lane).startsWith('stem:') ? song.stems.find((st) => 'stem:' + st.id === c.lane)?.name : null;
    const edit = (f) => { seq.snapshot(); if (ghost) { const r = realize(ghost); if (!r) return; sel = c = r; } f(c); seq.changed(); showInspector(); };
    const title = h('div', { class: 'insp-t' });
    const strip = h('div', { class: 'srcmap', title: 'Click or drag: which bars of the original this piece plays' }), scv = h('canvas'), sg = scv.getContext('2d'); strip.append(scv);
    let SW = 0; sizer(strip, scv, sg, (w) => { SW = w; drawMap(); });
    const stemObj = song.stems.find((st) => st.name === stemName);
    const lvlAt = (b) => (stemObj ? level(stemObj.cells[Math.floor(b / cb)]) : bandAt(b));
    const drawMap = () => {
      if (!SW) return; const n = song.numBars, bw = SW / n; sg.clearRect(0, 0, SW, 60);
      for (let b = 0; b < n; b++) { const v = lvlAt(b); sg.fillStyle = '#ece8dc'; sg.globalAlpha = 0.15 + v * 0.5; sg.fillRect(b * bw, 60 - 8 - v * 38, Math.max(1, bw - 1), 8 + v * 38); }
      sg.globalAlpha = 1; for (const s of song.sections) { sg.fillStyle = '#6f747f'; sg.font = '10px "IBM Plex Mono", monospace'; sg.fillText(s.name, s.startCell * cb * bw + 3, 10); sg.fillRect(s.startCell * cb * bw, 0, 1, 60); }
      const span = c.loop || Math.ceil(c.len * (c.fx?.s || 1)), x0 = Math.floor(c.src); sg.fillStyle = '#e6b45040'; sg.fillRect(x0 * bw, 0, span * bw, 60); sg.fillStyle = '#e6b450'; sg.fillRect(x0 * bw, 0, 1.5, 60); sg.fillRect((x0 + span) * bw, 0, 1.5, 60);
      const who = stemName || (c.mute?.length ? `${song.stems.length - c.mute.length} of the stems` : 'all the stems');
      title.textContent = `${who}: bars ${x0 + 1}–${x0 + span} of the original${c.loop ? ', repeated' : ''} · ${c.len} bars at bar ${c.start + 1}${ghost ? ' · following the Stems lane' : ''}`;
    };
    let mdown = false;
    const setSrc = (e) => { const r = strip.getBoundingClientRect(); c.src = clamp(Math.floor((e.clientX - r.left) / r.width * song.numBars), 0, song.numBars - 1); drawMap(); };
    strip.addEventListener('pointerdown', (e) => { seq.snapshot(); if (ghost) { const r = realize(ghost); if (!r) return; sel = c = r; } mdown = true; strip.setPointerCapture(e.pointerId); setSrc(e); });
    strip.addEventListener('pointermove', (e) => mdown && setSrc(e));
    strip.addEventListener('pointerup', () => { if (!mdown) return; mdown = false; seq.changed(); if (ghost) showInspector(); });
    const segOf = (opts, cur, set, title) => h('div', { class: 'seg', title }, ...opts.map(([v, l]) => h('button', { type: 'button', 'aria-pressed': cur === v, onclick: () => edit((cc) => set(cc, v)) }, l)));
    const fx = c.fx || {}, setFx = (cc, k, v) => { cc.fx = { ...(cc.fx || {}), [k]: v }; if (!cc.fx.r && (cc.fx.s || 1) === 1 && !cc.fx.u && (cc.fx.g ?? 1) === 1) delete cc.fx; };
    const loops = segOf([[0, 'Plays on'], [1, '1'], [2, '2'], [4, '4'], [8, '8']], c.loop || 0, (cc, v) => { cc.loop = v || undefined; if (!v) delete cc.off; }, 'Repeat the first bars of this piece');
    const treat = h('div', { class: 'bar2 treat' },
      h('span', { class: 'cap' }, 'Treat it'),
      h('button', { type: 'button', class: 'sw', 'aria-pressed': !!fx.r, title: 'Play every bar of it backwards', onclick: () => edit((cc) => setFx(cc, 'r', fx.r ? 0 : 1)) }, h('i'), 'Reverse'),
      h('span', { class: 'cap' }, 'speed'), segOf([[0.5, '½ · octave down'], [1, '1'], [2, '2× · octave up']], fx.s || 1, (cc, v) => setFx(cc, 's', v), 'Half speed: slower and an octave down. Double: an octave up, each bar twice'),
      h('span', { class: 'cap' }, 'stutter'), segOf([[0, 'off'], [2, '½'], [4, '¼'], [8, '⅛'], [16, '1/16']], fx.u || 0, (cc, v) => setFx(cc, 'u', v), 'Repeat the start of every bar: a half, a quarter, an eighth or a sixteenth of it, over and over'),
      h('span', { class: 'cap' }, 'level'), segOf([[0.35, '−9'], [0.5, '−6'], [0.7, '−3'], [1, '0'], [1.4, '+3']], fx.g ?? 1, (cc, v) => setFx(cc, 'g', v), 'How loud this piece is (dB)'));
    const who = c.lane === 'band' && !ghost ? h('div', { class: 'who' }, ...song.stems.map((st) => { const b = h('button', { type: 'button', class: 'pchip', 'aria-pressed': !(c.mute || []).includes(st.id), title: `${st.name} plays in this clip`, onclick: () => { seq.snapshot(); const m = new Set(c.mute || []); m.has(st.id) ? m.delete(st.id) : m.add(st.id); c.mute = [...m]; b.setAttribute('aria-pressed', !m.has(st.id)); seq.changed(); } }, st.name); return b; })) : '';
    const note = ghost ? h('p', { class: 'insp-note' }, `${stemName} plays this piece because it follows the Stems lane. Drag it, cut it or change anything below and ${stemName} gets a lane of its own, which the Stems lane no longer moves (↺ on its name brings it back).`) : '';
    insp.replaceChildren(title, note, strip,
      h('div', { class: 'bar2' }, h('span', { class: 'cap' }, 'Repeat the first'), loops, h('span', { class: 'cap' }, 'bars'), h('span', { class: 'sp' }),
        ghost ? btn('Silence it here', `Take ${stemName} out of this piece`, () => { seq.snapshot(); const r = realize(ghost); if (r) { seq.arr.clips = seq.arr.clips.filter((x) => x !== r); sel = null; seq.changed(); showEd(); } }) : btn('Delete', 'Remove this piece (Delete)', () => delSel())),
      treat, c.lane === 'band' && !ghost ? h('span', { class: 'cap' }, 'Which stems play in this piece') : '', who);
  }
  const delSel = () => { if (!sel || sel.ghost) return; seq.snapshot(); seq.arr.clips = seq.arr.clips.filter((c) => c !== sel); sel = null; seq.changed(); showEd(); };

  // piano roll / pencil
  let eact = null;
  const evAt = (x, y) => { const p = ppb(); return partNotes().find((e) => { const ex = KEYW + e.b * p, ey = (TOP - e.note) * RH; return x >= ex && x <= ex + Math.max(4, e.d * p) && y >= ey && y < ey + RH; }); };
  ecv.addEventListener('contextmenu', (e) => e.preventDefault());
  ecv.addEventListener('pointerdown', (e) => {
    const r = ecv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, p = ppb(), beat = (x - KEYW) / p;
    ecv.setPointerCapture(e.pointerId);
    if (ed.part === 'm') { seq.snapshot(); eact = { mode: e.altKey ? 'erase' : 'draw', last: beat }; drawMove(beat, y, beat, e.altKey); return; }
    const note = clamp(TOP - Math.floor(y / RH), BOT, TOP);
    if (x < KEYW) { audition(note); return; }
    const hit = evAt(x, y);
    if (hit && (e.button === 2 || e.altKey)) { seq.snapshot(); seq.vars[seq.cur].splice(seq.vars[seq.cur].indexOf(hit), 1); ed.sel = null; seq.emit(); return; }
    seq.snapshot();
    if (hit) { ed.sel = hit; const xr = KEYW + (hit.b + hit.d) * p; eact = { mode: x > xr - 6 ? 'resize' : 'move', e: hit, o: { ...hit }, beat, note }; if (eact.mode === 'move') audition(hit.note); return; }
    const ev = { k: 'n', slot: ed.part, note, vel: 0.8, b: clamp(snapDown(beat), 0, seq.beats - stepLen()), d: stepLen(), p: 0 };
    seq.vars[seq.cur].push(ev); ed.sel = ev; audition(note); eact = { mode: 'resize', e: ev, o: { ...ev }, beat, note }; seq.emit();
  });
  ecv.addEventListener('pointermove', (e) => {
    if (!eact) return; const r = ecv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, p = ppb(), beat = (x - KEYW) / p;
    if (eact.mode === 'draw' || eact.mode === 'erase') { drawMove(eact.last, y, beat, eact.mode === 'erase'); eact.last = beat; return; }
    const { e: ev, o } = eact;
    if (eact.mode === 'move') { const nb = clamp(snap(o.b + beat - eact.beat), 0, seq.beats - 0.01), nt = clamp(o.note + (TOP - Math.floor(y / RH)) - eact.note, BOT, TOP); if (nt !== ev.note) audition(nt); ev.b = +nb.toFixed(3); ev.note = nt; }
    else ev.d = +Math.max(seq.quant || 0.05, (seq.quant ? Math.ceil((beat - ev.b) / seq.quant - 1e-6) * seq.quant : beat - ev.b)).toFixed(3);
    seq.emit();
  });
  const eup = () => { eact = null; }; ecv.addEventListener('pointerup', eup); ecv.addEventListener('pointercancel', eup);
  ecv.addEventListener('dblclick', (e) => { if (ed.part === 'm') return; const r = ecv.getBoundingClientRect(), hit = evAt(e.clientX - r.left, e.clientY - r.top); if (hit) { seq.vars[seq.cur].splice(seq.vars[seq.cur].indexOf(hit), 1); ed.sel = null; seq.emit(); } });
  ecv.addEventListener('wheel', (e) => { if (ed.part === 'm') return; const r = ecv.getBoundingClientRect(), hit = evAt(e.clientX - r.left, e.clientY - r.top); if (!hit) return; e.preventDefault(); hit.vel = +clamp(hit.vel - Math.sign(e.deltaY) * 0.05, 0.05, 1).toFixed(2); seq.emit(); }, { passive: false });
  eruler.addEventListener('pointerdown', (e) => { const r = eruler.getBoundingClientRect(); ed.cursor = clamp(snapDown((e.clientX - r.left - KEYW) / ppb()), 0, seq.beats - stepLen()); });
  function drawMove(fromB, y, toB, erase) {
    const path = ed.path, [mn, mx] = P.range?.[path] || [0, 1], list = seq.vars[seq.cur];
    const a = clamp(Math.min(fromB, toB), 0, seq.beats), b = clamp(Math.max(fromB, toB), 0, seq.beats), res = 0.0625;
    for (let i = list.length - 1; i >= 0; i--) { const e = list[i]; if (e.k === 'm' && e.path === path && e.b >= a - res / 2 && e.b <= b + res / 2) list.splice(i, 1); }
    if (!erase) { const v = mn + clamp(1 - y / EH, 0, 1) * (mx - mn); for (let t = Math.round(a / res) * res; t <= b + 1e-9; t += res) if (t < seq.beats) list.push({ k: 'm', path, v: +v.toFixed(4), b: +t.toFixed(4), p: 0 }); }
    seq.emit();
  }
  // step input from the keys
  const stepHeld = new Set(); let stepAt = 0;
  S.stepNote = (note, vel, on) => {
    if (!ed.step || ed.part === 'm' || S.room !== 'song') return;
    if (on) { if (!stepHeld.size) { stepAt = ed.cursor; seq.snapshot(); } stepHeld.add(note); seq.vars[seq.cur].push({ k: 'n', slot: ed.part, note, vel: +vel.toFixed(2), b: stepAt, d: stepLen(), p: 0 }); seq.emit(); }
    else { stepHeld.delete(note); if (!stepHeld.size) ed.cursor = (stepAt + stepLen()) % seq.beats; }
  };
  const sel0 = S.selectSlot; S.selectSlot = (i) => { sel0(i); if (ed.part !== 'm' && ed.part !== i) { ed.part = i; showEd(); } };
  S.openEditor = (part) => { ed.part = part; sel = null; showEd(); };

  // keys: delete, duplicate, undo
  addEventListener('keydown', (e) => {
    if (e.target.closest('input,select,textarea')) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? seq.redo() : seq.undo(); return; }
    if (S.room !== 'song') return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && ed.sel && !sel) { const i = seq.vars[seq.cur].indexOf(ed.sel); if (i >= 0) { seq.snapshot(); seq.vars[seq.cur].splice(i, 1); ed.sel = null; seq.emit(); } e.preventDefault(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); delSel(); }
    else if (mod && e.key.toLowerCase() === 'd' && sel && !sel.ghost) { e.preventDefault(); seq.snapshot(); sel = seq.place({ ...sel, id: undefined, start: sel.start + sel.len }); if (sel.start + sel.len > seq.arr.bars) seq.arr.bars = sel.start + sel.len; seq.changed(); showEd(); }
    else if (e.key === 'Escape') { sel = null; ed.sel = null; showEd(); }
  });

  // ---------------------------------------------------------------- bounce
  let bouncing = null;
  async function bounce() {
    if (bouncing) { bouncing.cancel = true; return; }
    const p = S.player; if (seq.rec) seq.arm(false);
    seq.setMode('song');
    const c = seq.arr.cycle, start = c ? c[0] : 0, bars = c ? c[1] - c[0] : seq.arr.bars;
    if (p.playing) p.stop();
    S.session.dispatch({ t: 'seek', bar: start });
    await S.ctx.resume(); p.play(start);
    const sr = S.ctx.sampleRate, t0 = p.timeOfBar(start), t1 = p.timeOfBar(start + bars) + 3;
    const rec = S.engine.recordMaster(Math.round(t0 * sr));
    bouncing = { cancel: false };
    await new Promise((res) => { const step = () => { const k = (S.ctx.currentTime - t0) / (t1 - t0); bounceB.textContent = `Bouncing ${Math.round(clamp(k, 0, 1) * 100)}% · stop`; if (bouncing.cancel || !p.playing || S.ctx.currentTime >= t1) res(); else requestAnimationFrame(step); }; step(); });
    const r = await rec.stop(Math.round(Math.min(t1, S.ctx.currentTime) * sr));
    const cancelled = bouncing.cancel; bouncing = null; p.stop(); bounceB.textContent = 'Bounce .wav';
    if (!cancelled && r.seconds > 1) download(r.wav(), `${song.title} · playground.wav`);
  }
  function download(blob, name) { const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000); }

  // ---------------------------------------------------------------- sync + draw
  const sync = () => {
    lenIn.value = seq.arr.bars; cycle.setAttribute('aria-pressed', !!seq.arr.cycle);
    undo.disabled = !seq.undos.length; redo.disabled = !seq.redos.length;
    fillPats(); patSel.value = seq.cur; lenSel.value = seq.bars; snapSel.value = seq.quant;
    jamNote.hidden = seq.mode === 'song';
    if (sel?.ghost) { if (!seq.arr.clips.includes(sel.band) || isOwn(sel.stemId)) sel = null; }
    else if (sel && !seq.arr.clips.includes(sel)) { sel = seq.arr.clips.find((c) => c.id === sel.id) || null; }
    showPats();
  };
  seq.addEventListener('change', sync); sync(); showEd();
  let lastMuteKey = '';
  const draw = () => {
    fitNow();
    const mk = [...seq.mute].join(); if (mk !== lastMuteKey) { lastMuteKey = mk; buildHeads(); }
    // ruler
    if (RW) {
      rg.clearRect(0, 0, RW, 24); rg.font = '10px "IBM Plex Mono", monospace'; rg.textBaseline = 'middle';
      const every = pxb > 40 ? 1 : pxb > 16 ? 2 : pxb > 7 ? 4 : 8;
      const c = seq.arr.cycle; if (c) { rg.fillStyle = '#e6b45033'; rg.fillRect(xOf(c[0]), 0, (c[1] - c[0]) * pxb, 24); rg.fillStyle = '#e6b450'; rg.fillRect(xOf(c[0]), 20, (c[1] - c[0]) * pxb, 3); }
      for (let b = Math.floor(x0); b <= x0 + RW / pxb; b++) { if (b % every) continue; const x = xOf(b); rg.fillStyle = b % 4 ? '#ffffff22' : '#ffffff44'; rg.fillRect(x, 14, 1, 10); rg.fillStyle = '#6f747f'; rg.fillText(String(b + 1), x + 3, 8); }
      rg.fillStyle = '#ffffff30'; rg.fillRect(xOf(seq.arr.bars), 0, 1, 24);
      if (seq.mode === 'song') { const pb = seq.tl(seq.nowBeat()) / bpb; rg.fillStyle = seq.rec ? '#df8a74' : '#ece8dc'; rg.beginPath(); rg.moveTo(xOf(pb) - 5, 12); rg.lineTo(xOf(pb) + 5, 12); rg.lineTo(xOf(pb), 22); rg.fill(); }
    }
    if (!W) return;
    g.clearRect(0, 0, W, H);
    for (const l of L) { g.fillStyle = l.stem ? '#ffffff04' : (L.indexOf(l) % 2 ? '#ffffff05' : '#ffffff02'); g.fillRect(0, l.y, W, l.h); g.fillStyle = '#ffffff0a'; g.fillRect(0, l.y + l.h - 1, W, 1); }
    for (let b = Math.floor(x0); b <= x0 + W / pxb; b++) { g.fillStyle = b % 4 ? '#ffffff06' : '#ffffff12'; if (pxb > 5 || b % 4 === 0) g.fillRect(xOf(b), 0, 1, H); }
    g.fillStyle = '#0b0d12aa'; g.fillRect(xOf(seq.arr.bars), 0, W, H);
    const c = seq.arr.cycle; if (c) { g.fillStyle = '#e6b45008'; g.fillRect(xOf(c[0]), 0, (c[1] - c[0]) * pxb, H); }
    // ghosts: on a stem's lane, the pieces it plays from the Stems lane, and how loud it is in each bar
    if (expanded) for (const l of L) {
      if (!l.stem || isOwn(l.stem.id)) continue;
      for (const gc of ghostsOf(l.stem.id)) {
        const x = xOf(gc.start), w = gc.len * pxb, y = l.y + 2, hh = l.h - 4; if (x > W || x + w < 0) continue;
        const on = sel?.ghost && sel.band === gc && sel.stemId === l.stem.id;
        g.fillStyle = on ? '#ece8dc22' : '#ece8dc0a'; g.fillRect(x + 1, y, w - 2, hh);
        g.fillStyle = '#ece8dc44'; g.fillRect(x + 1, y, 1, hh);
        for (let k = 0; k < gc.len; k++) { const v = level(l.stem.cells[Math.floor(srcBar(gc, k, song.numBars).bar / cb)]); if (!v) continue; g.fillStyle = '#ece8dc40'; const bh = (hh - 4) * v; g.fillRect(xOf(gc.start + k) + 2, y + hh - 2 - bh, Math.max(1, pxb - 3), bh); }
        if (on) { g.strokeStyle = '#ece8dc'; g.setLineDash([3, 3]); g.strokeRect(x + 1.5, y + 0.5, w - 3, hh - 1); g.setLineDash([]); }
      }
    }
    for (const cl of seq.arr.clips) {
      const l = L.find((x) => x.id === cl.lane); if (!l) continue;
      const x = xOf(cl.start), w = cl.len * pxb, y = l.y + 2, hh = l.h - 4; if (x > W || x + w < 0) continue;
      const col = laneColor(cl.lane), on = cl === sel;
      g.globalAlpha = seq.mute.has(cl.lane) ? 0.35 : 1;
      if (l.stem) { g.fillStyle = '#151820'; g.fillRect(x + 1, y, w - 2, hh); }
      g.fillStyle = col + (on ? '38' : '1c'); g.fillRect(x + 1, y, w - 2, hh);
      g.fillStyle = col; g.fillRect(x + 1, y, 2, hh);
      if (on) { g.strokeStyle = '#ece8dc'; g.lineWidth = 1; g.strokeRect(x + 1.5, y + 0.5, w - 3, hh - 1); }
      g.save(); g.beginPath(); g.rect(x + 3, y, w - 5, hh); g.clip();
      if (cl.src !== undefined) {
        const st = l.stem;
        for (let k = 0; k < cl.len; k++) { const sb = srcBar(cl, k, song.numBars).bar, v = st ? level(st.cells[Math.floor(sb / cb)]) : bandAt(sb); if (cl.mute?.length === song.stems.length) continue; g.fillStyle = col + '55'; const bh = (hh - 6) * v; g.fillRect(xOf(cl.start + k) + 2, y + hh - 2 - bh, Math.max(1, pxb - 3), bh); }
        if (cl.loop) { g.fillStyle = col + '88'; for (let k = cl.loop; k < cl.len; k += cl.loop) g.fillRect(xOf(cl.start + k), y + 2, 1, hh - 4); }
        if (l.h > 20 && w > 40) { g.fillStyle = '#ece8dc'; g.font = '10px "IBM Plex Mono", monospace'; g.textBaseline = 'top'; const f = cl.fx || {}, tag = `${f.r ? ' ◂rev' : ''}${f.s === 0.5 ? ' ½' : f.s === 2 ? ' 2×' : ''}${f.u ? ` stut/${f.u}` : ''}${(f.g ?? 1) !== 1 ? ` ${f.g > 1 ? '+3' : f.g >= 0.7 ? '−3' : f.g >= 0.5 ? '−6' : '−9'}dB` : ''}`; g.fillText(`${cl.name && !cl.loop ? cl.name + ' · ' : ''}${Math.floor(cl.src) + 1}${cl.loop ? `×${cl.loop}` : ''}${cl.mute?.length ? ` · ${song.stems.length - cl.mute.length} play` : ''}${tag}`, x + 6, y + 3); }
      } else {
        const pb = seq.pb(cl.pat), ev = seq.vars[cl.pat], base = (cl.start - (cl.off || 0)) * bpb, endB = (cl.start + cl.len) * bpb, part = cl.part ?? cl.lane;
        const notes = ev.filter((e) => (cl.lane === 'm' ? e.k === 'm' : e.k === 'n' && e.slot === part));
        let lo = 127, hi = 0; for (const e of notes) if (e.k === 'n') { lo = Math.min(lo, e.note); hi = Math.max(hi, e.note); }
        for (let k = 0; base + k * pb < endB; k++) {
          if (k) { g.fillStyle = col + '44'; g.fillRect(xOf((base + k * pb) / bpb), y + 3, 1, hh - 6); }
          if (cl.lane === 'm') {
            const by = {}; for (const e of notes) (by[e.path] ??= []).push(e);
            g.strokeStyle = col; g.lineWidth = 1; g.globalAlpha *= 0.8;
            for (const pts of Object.values(by)) { const [mn, mx] = P.range?.[pts[0].path] || [0, 1]; pts.sort((a, b) => a.b - b.b); g.beginPath(); pts.forEach((e, i) => { const t = base + k * pb + e.b; const px = xOf(t / bpb), py = y + hh - 3 - (hh - 6) * clamp((e.v - mn) / (mx - mn || 1), 0, 1); i ? g.lineTo(px, py) : g.moveTo(px, py); }); g.stroke(); }
            g.globalAlpha = seq.mute.has(cl.lane) ? 0.35 : 1;
          } else for (const e of notes) {
            const t = base + k * pb + e.b; if (t < cl.start * bpb || t >= endB) continue;
            const py = y + hh - 4 - (hh - 9) * (hi > lo ? (e.note - lo) / (hi - lo) : 0.5);
            g.fillStyle = col; g.fillRect(xOf(t / bpb), py, Math.max(1.5, Math.min(e.d, endB - t) / bpb * pxb - 1), 2.5);
          }
        }
        if (w > 26) { g.fillStyle = '#ece8dc'; g.font = '500 10px "IBM Plex Mono", monospace'; g.textBaseline = 'top'; g.fillText(`${isTake(cl.pat) ? '● ' + takeName(cl.pat) : cl.pat}${cl.part !== undefined && cl.part !== cl.lane && cl.lane !== 'm' ? `·${cl.part + 1}` : ''}${cl.tr ? ` ${cl.tr > 0 ? '+' : ''}${cl.tr}` : ''}`, x + 6, y + 3); }
      }
      g.restore(); g.globalAlpha = 1;
    }
    if (hoverDrop) { const l = L.find((x) => x.id === hoverDrop.lane); if (l) { g.strokeStyle = '#e6b450'; g.setLineDash([4, 3]); g.strokeRect(xOf(hoverDrop.bar) + 0.5, l.y + 1.5, hoverDrop.len * pxb - 1, l.h - 3); g.setLineDash([]); } }
    if (seq.mode === 'song') { const pb = seq.tl(seq.nowBeat()) / bpb; g.fillStyle = seq.rec ? '#df8a74' : '#ece8dc'; g.fillRect(xOf(pb), 0, 1.5, H); }
    if (seq.take) { const t = seq.take, l1 = seq.take.len || Math.max(1, (seq.tl(seq.nowBeat()) / bpb) - t.start); g.fillStyle = '#df8a7422'; g.fillRect(xOf(t.start), 0, l1 * pxb, H); }
    drawEditor();
  };
  function drawEditor() {
    if (!EW || edBody.hidden) return;
    const p = ppb(), B = seq.beats, col = ed.part === 'm' ? '#a3a6ad' : COLORS[ed.part], step = stepLen();
    // ruler
    erg.clearRect(0, 0, ERW, 18); erg.font = '10px "IBM Plex Mono", monospace'; erg.textBaseline = 'middle';
    for (let b = 0; b < B; b++) { const x = KEYW + b * p; erg.fillStyle = b % bpb ? '#ffffff22' : '#ffffff55'; erg.fillRect(x, b % bpb ? 11 : 4, 1, 14); if (b % bpb === 0) { erg.fillStyle = '#6f747f'; erg.fillText(String(b / bpb + 1), x + 3, 8); } }
    erg.fillStyle = '#6f747f'; erg.fillText(isTake(seq.cur) ? `T${seq.cur.slice(1)}` : `${seq.cur}`, 6, 9);
    const lb = seq.loopBeat(); if (lb !== null) { erg.fillStyle = seq.rec ? '#df8a74' : '#ece8dc'; erg.fillRect(KEYW + lb * p, 0, 1.5, 18); }
    if (ed.step && ed.part !== 'm') { erg.fillStyle = '#e6b450'; erg.fillRect(KEYW + ed.cursor * p, 0, Math.max(2, step * p), 3); }
    eg.clearRect(0, 0, EW, EH);
    if (ed.part === 'm') {
      for (let b = 0; b <= B; b += 0.25) { eg.fillStyle = b % bpb === 0 ? '#ffffff22' : b % 1 === 0 ? '#ffffff10' : '#ffffff05'; eg.fillRect(KEYW + b * p, 0, 1, EH); }
      for (let i = 1; i < 4; i++) { eg.fillStyle = '#ffffff08'; eg.fillRect(KEYW, (EH * i) / 4, EW, 1); }
      const by = {}; for (const e of seq.vars[seq.cur]) if (e.k === 'm') (by[e.path] ??= []).push(e);
      for (const [path, pts] of Object.entries(by)) {
        const [mn, mx] = P.range?.[path] || [0, 1], me = path === ed.path; pts.sort((a, b) => a.b - b.b);
        eg.strokeStyle = me ? '#e6b450' : '#ffffff30'; eg.lineWidth = me ? 1.5 : 1; eg.beginPath();
        pts.forEach((e, i) => { const x = KEYW + e.b * p, y = EH - 4 - (EH - 8) * clamp((e.v - mn) / (mx - mn || 1), 0, 1); i ? eg.lineTo(x, y) : eg.moveTo(x, y); }); eg.stroke();
        if (me) { eg.fillStyle = '#e6b450'; for (const e of pts) eg.fillRect(KEYW + e.b * p - 1, EH - 4 - (EH - 8) * clamp((e.v - mn) / (mx - mn || 1), 0, 1) - 1, 2, 2); }
      }
      const [mn, mx, lab] = P.range?.[ed.path] || [0, 1, ed.path];
      eg.fillStyle = '#6f747f'; eg.font = '10px "IBM Plex Mono", monospace'; eg.textBaseline = 'top'; eg.fillText(String(+mx.toFixed(2)), 4, 4); eg.textBaseline = 'bottom'; eg.fillText(String(+mn.toFixed(2)), 4, EH - 3);
      if (!by[ed.path]) { eg.fillStyle = '#a3a6ad'; eg.textBaseline = 'middle'; eg.fillText(`draw ${String(lab).toLowerCase()} here · ⌥-drag erases`, KEYW + 12, EH / 2); }
      if (lb !== null) { eg.fillStyle = '#ece8dc'; eg.fillRect(KEYW + lb * p, 0, 1, EH); }
      return;
    }
    const top = escroll.scrollTop, vis = escroll.clientHeight;
    for (let n = BOT; n <= TOP; n++) {
      const y = (TOP - n) * RH; if (y + RH < top || y > top + vis) continue;
      const black = [1, 3, 6, 8, 10].includes(n % 12);
      eg.fillStyle = black ? '#ffffff03' : '#ffffff07'; eg.fillRect(KEYW, y, EW - KEYW, RH);
      if (n % 12 === 0) { eg.fillStyle = '#ffffff16'; eg.fillRect(KEYW, y + RH - 1, EW - KEYW, 1); }
      eg.fillStyle = black ? '#1a1e28' : '#d9d5c9'; eg.fillRect(0, y, black ? 24 : KEYW - 2, RH - 1);
      if (n % 12 === 0) { eg.fillStyle = '#6f747f'; eg.font = '8px "IBM Plex Mono", monospace'; eg.textBaseline = 'middle'; eg.fillText(nn(n), 25, y + RH / 2); }
    }
    for (let b = 0; b <= B + 1e-9; b += step) { eg.fillStyle = Math.abs(b % bpb) < 1e-6 ? '#ffffff2a' : Math.abs(b % 1) < 1e-6 ? '#ffffff12' : '#ffffff06'; eg.fillRect(KEYW + b * p, top, 1, vis); }
    for (const e of seq.vars[seq.cur]) {
      if (e.k !== 'n') continue; const mine = e.slot === ed.part;
      const x = KEYW + e.b * p, y = (TOP - e.note) * RH, w = Math.max(3, e.d * p - 1);
      if (!mine) { eg.fillStyle = COLORS[e.slot] + '30'; eg.fillRect(x, y + 3, w, RH - 6); continue; }
      eg.globalAlpha = 0.45 + 0.55 * e.vel; eg.fillStyle = col; eg.fillRect(x, y + 1, w, RH - 2); eg.globalAlpha = 1;
      if (e === ed.sel) { eg.strokeStyle = '#fff'; eg.lineWidth = 1; eg.strokeRect(x + 0.5, y + 1.5, w - 1, RH - 3); }
    }
    if (lb !== null) { eg.fillStyle = '#ece8dc'; eg.fillRect(KEYW + lb * p, top, 1, vis); }
    if (ed.step) { eg.fillStyle = '#e6b45022'; eg.fillRect(KEYW + ed.cursor * p, top, Math.max(2, step * p), vis); }
  }
  // open the roll near the notes
  let centred = false;
  S.rooms.song = { draw, show: () => { if (!centred && escroll.clientHeight) { const ns = partNotes(); const mid = ns.length ? ns.reduce((a, e) => a + e.note, 0) / ns.length : 62; escroll.scrollTop = (TOP - mid) * RH - escroll.clientHeight / 2; centred = true; } } };
}
