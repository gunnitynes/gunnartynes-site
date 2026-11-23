// Mutate: the song keeps evolving while it plays. Every couple of bars, maybe, one stem does something else for a
// few bars — jumps to another place in the song, plays backwards, at half or double speed, stutters, repeats a bar,
// answers with what it played a moment ago, or drops out — using the same treatments as the Arrangement's pieces.
// A mutation is a real piece on that stem's lane, marked as passing: when it has played it drifts away again,
// unless you Keep it (Q) or Record is on, and then it stays in the arrangement like anything you placed yourself.
import { srcBar } from './core.js';

const KINDS = [
  ['jump', 3, 'jumps elsewhere in the song'], ['rev', 2, 'plays backwards'], ['half', 2, 'at half speed'], ['double', 1, 'at double speed'],
  ['stutter', 2, 'stutters'], ['hold', 2, 'repeats a bar'], ['answer', 2, 'answers with what it just played'], ['drop', 1, 'drops out'],
];

export class Mutator extends EventTarget {
  constructor(S) {
    super(); this.S = S; this.on = false; this.amount = 0.6; this.live = []; this.last = null;
    S.player.on('bar', ({ bar }) => this.onBar(bar));
    S.player.on('transport', ({ playing }) => { if (!playing) this.drift(true); });
    S.player.on('seek', () => this.drift(true));
  }
  set(on) {
    this.on = on;
    if (on) { const q = this.S.seq; if (q.mode !== 'song') q.setMode('song'); if (!this.S.player.playing) this.S.player.play(); }
    else this.drift(true);
    this.emit();
  }
  /** Passing pieces whose time is up leave (all of them when `all`); so do any left behind by an undo or a reload. */
  drift(all = false, B = Infinity) {
    const q = this.S.seq, keep = new Set(all ? [] : this.live.filter((m) => B < m.until).map((m) => m.clip));
    const before = q.arr.clips.length;
    q.arr.clips = q.arr.clips.filter((c) => !c.mut || keep.has(c));
    this.live = this.live.filter((m) => keep.has(m.clip));
    if (q.arr.clips.length !== before) { q.changed(); this.emit(); }
  }
  /** Keep what is mutating now: it stays in the arrangement (Undo takes it back out). */
  keep() {
    const q = this.S.seq, ms = this.live.filter((m) => q.arr.clips.includes(m.clip)); if (!ms.length) return 0;
    q.snapshot(); for (const m of ms) { delete m.clip.mut; m.clip.name = m.clip.name.replace(/^~ /, ''); }
    this.live = []; q.changed(); this.emit(); return ms.length;
  }
  /** A passing piece made elsewhere (an answer, the endless version): it drifts away after player bar `until`. */
  adopt(clip, until) { clip.mut = true; this.live.push({ clip, until }); this.emit(); }
  onBar(B) {
    const q = this.S.seq;
    if (q.mode !== 'song') { if (this.live.length) this.drift(true); return; }
    this.drift(false, B);
    if (!this.on && !this.also) return;   // `also`: the endless version asks for a few changes of its own
    const bpb = this.S.song.beatsPerBar, T = Math.floor(q.tl(B * bpb) / bpb), start = T + 1;   // B is being scheduled now: changes start on the next bar
    const end = q.arr.cycle ? q.arr.cycle[1] : q.arr.bars;
    if (start % 2 || start >= end) return;
    const amt = this.on ? this.amount : 0.3, max = 1 + Math.floor(amt * 3);
    if (this.live.filter((m) => m.clip.lane !== 'band').length >= max || Math.random() > 0.25 + amt * 0.65) return;
    const m = this.make(start, Math.min(end - start, Math.random() < 0.5 ? 2 : 4));
    if (!m) return;
    m.clip.mut = true; q.place(m.clip);
    if (q.rec) delete m.clip.mut; else this.live.push({ clip: m.clip, until: B + 1 + m.clip.len });
    this.last = { name: m.name, what: m.what, start, len: m.clip.len, kept: q.rec };
    q.changed(); this.emit();
  }
  make(start, len) {
    const { song, seq: q, params: P } = this.S, cb = song.barsPerCell, N = song.numBars;
    if (len < 1) return null;
    const band = (bar) => q.arr.clips.find((c) => c.lane === 'band' && bar >= c.start && bar < c.start + c.len);
    const b0 = band(start); if (!b0) return null;
    const free = (id) => !q.arr.clips.some((c) => c.lane === 'stem:' + id && c.start < start + len && c.start + c.len > start);
    const busy = new Set(this.live.map((m) => m.clip.lane));   // one passing piece per lane at a time
    const stems = song.stems.filter((st) => st.cells.some(Boolean) && !P.get(`band.${st.id}.mute`) && !b0.mute?.includes(st.id) && !busy.has('stem:' + st.id) && free(st.id));
    if (!stems.length) return null;
    const st = stems[Math.floor(Math.random() * stems.length)], now = srcBar(b0, start - b0.start, N).bar;
    // something it really plays (not a bar where it is silent)
    const sounds = (bar) => !!st.cells[Math.floor((((bar % N) + N) % N) / cb)];
    let tot = 0; for (const k of KINDS) tot += k[1];
    let r = Math.random() * tot, kind = KINDS[0]; for (const k of KINDS) { r -= k[1]; if (r <= 0) { kind = k; break; } }
    const clip = { lane: 'stem:' + st.id, start, len, src: now, name: '' };
    switch (kind[0]) {
      case 'jump': { const live = st.cells.map((c, i) => (c && c.rms > -45 ? i : -1)).filter((i) => i >= 0); if (!live.length) return null; const c = live[Math.floor(Math.random() * live.length)]; Object.assign(clip, { src: c * cb, loop: Math.min(cb, len) }); break; }
      case 'rev': clip.fx = { r: 1 }; break;
      case 'half': clip.fx = { s: 0.5 }; break;
      case 'double': clip.fx = { s: 2 }; break;
      case 'stutter': clip.fx = { u: [4, 8, 16][Math.floor(Math.random() * 3)] }; break;
      case 'hold': Object.assign(clip, { src: Math.max(0, now - 1), loop: 1 }); break;
      case 'answer': clip.src = Math.max(0, now - len); break;
      case 'drop': clip.fx = { g: 0 }; break;
    }
    if (kind[0] !== 'drop' && !sounds(clip.src)) return null;
    clip.name = `~ ${kind[0]}`;
    return { clip, name: st.name, what: kind[2] };
  }
  emit() { this.dispatchEvent(new Event('change')); }
}
