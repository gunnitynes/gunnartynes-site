// The endless version. From the next bar on, the song keeps going and never repeats: every few bars it carries on
// as written, or jumps to another phrase of the song that follows well from here (the band's notes, rhythm and
// colour, measured bar by bar), Mutate adds a few changes of its own, and the colours of the Process rack drift
// slowly. Nothing is lost: switch it off and the arrangement is as it was — except what you kept on the way
// (Keep, Q, or Record on), which stays where it was played.
import { srcBar } from './core.js';
import { bandBar, cos } from './features.js';

export class Endless extends EventTarget {
  constructor(S) {
    super(); this.S = S; this.on = false; this.recent = [];
    S.player.on('bar', ({ bar }) => this.onBar(bar));
  }
  get ready() { return !!this.S.feat; }
  set(on) {
    const S = this.S, q = S.seq, p = S.player, P = S.params;
    if (on === this.on) return;
    if (on) {
      if (!this.ready) return;
      if (q.mode !== 'song') q.setMode('song');
      const bpb = S.song.beatsPerBar, T = Math.floor(q.tl(q.nowBeat()) / bpb) + (p.playing ? 1 : 0);
      this.saved = JSON.stringify({ clips: q.arr.clips, bars: q.arr.bars, cycle: q.arr.cycle });
      this.ids = new Set(q.arr.clips.map((c) => c.id));
      this.next = this.srcAt(Math.max(0, T - 1)) + 1;   // the song bar that would naturally come next
      q.arr.cycle = null; q.arr.bars = Math.max(1, T); this.from = T; this.bars = 0;
      this.colours = Object.fromEntries(['fx.shim.mix', 'fx.echo.mix', 'fx.filter.lp', 'fx.ens.mix'].map((k) => [k, P.get(k)]));
      this.on = true; S.mutate.also = true;
      this.fill(p.barNow());
      if (!p.playing) p.play(T);
    } else {
      this.on = false; S.mutate.also = false;
      for (const [k, v] of Object.entries(this.colours || {})) P.set(k, v, { by: 'ui' });
      // what you kept stays, on top of the arrangement as it was; everything else goes
      const kept = q.arr.clips.filter((c) => !c.mut && !this.ids.has(c.id));
      const was = JSON.parse(this.saved); q.arr.clips = was.clips; q.arr.bars = was.bars; q.arr.cycle = was.cycle;
      for (const c of kept) { delete c.gen; q.place(c); if (c.start + c.len > q.arr.bars) q.arr.bars = c.start + c.len; }
      S.mutate.drift(true); q.changed();
      const bpb = S.song.beatsPerBar; if (Math.floor(q.tl(q.nowBeat()) / bpb) >= q.arr.bars) S.session.dispatch({ t: 'seek', bar: 0 });
      this.kept = kept.length;
    }
    this.emit();
  }
  srcAt(bar) { const cl = this.S.seq.arr.clips.find((c) => c.lane === 'band' && bar >= c.start && bar < c.start + c.len); return cl ? srcBar(cl, bar - cl.start, this.S.song.numBars).bar : bar; }
  onBar(B) {
    if (!this.on) return; const S = this.S, q = S.seq, P = S.params;
    if (q.mode !== 'song') { this.set(false); return; }
    this.fill(B);
    // the colours drift, slowly, each on its own long cycle (not recorded: they are the version's, not yours)
    const t = ++this.bars, c = this.colours, w = (per, ph = 0) => 0.5 + 0.5 * Math.sin((t / per) * 2 * Math.PI + ph);
    P.set('fx.shim.mix', +Math.min(1, (c['fx.shim.mix'] || 0) + 0.22 * w(37)).toFixed(3), { by: 'ui' });
    P.set('fx.echo.mix', +Math.min(1, (c['fx.echo.mix'] || 0) + 0.16 * w(53, 2)).toFixed(3), { by: 'ui' });
    P.set('fx.ens.mix', +Math.min(1, (c['fx.ens.mix'] || 0) + 0.25 * w(71, 4)).toFixed(3), { by: 'ui' });
    P.set('fx.filter.lp', +Math.min(c['fx.filter.lp'] ?? 1, 0.72 + 0.28 * w(29, 1)).toFixed(3), { by: 'ui' });
  }
  /** Keep at least eight bars written ahead of the playhead. */
  fill(B) {
    const S = this.S, q = S.seq, bpb = S.song.beatsPerBar, T = Math.floor(q.tl(B * bpb) / bpb);
    while (q.arr.bars - T < 8) {
      const len = Math.random() < 0.3 ? 8 : 4, start = q.arr.bars, src = this.choose();
      const clip = { lane: 'band', start, len, src, name: '∞', gen: true };
      q.place(clip); q.arr.bars = start + len; this.next = src + len;
      if (!q.rec) S.mutate.adopt(clip, B + (start - T) + len + 1); else delete clip.gen;
    }
    q.changed();
  }
  /** Where the song goes next: on as written, or a phrase elsewhere that follows well from here. */
  choose() {
    const S = this.S, N = S.song.numBars, cb = S.song.barsPerCell, n = this.next;
    const sounds = (b) => (bandBar(S, b)?.n || 0) >= 2;
    if (n + 4 <= N && sounds(n) && Math.random() < 0.5) return this.mark(n);
    const here = bandBar(S, Math.min(N - 1, n)) || bandBar(S, Math.max(0, n - 1)), prev = bandBar(S, Math.max(0, n - 1));
    const cands = [];
    for (let c = 0; c * cb + 4 <= N; c++) {
      const b = c * cb; if (!sounds(b) || this.recent.includes(b)) continue;
      const x = bandBar(S, b), y = b > 0 ? bandBar(S, b - 1) : x;
      const sc = 0.5 * cos(here.c, x.c) + 0.2 * cos(here.o, x.o) + 0.3 * cos(prev.c, y.c) - Math.abs(here.n - x.n) * 0.03;
      cands.push([sc, b]);
    }
    cands.sort((a, b) => b[0] - a[0]);
    const pick = cands.slice(0, 6); if (!pick.length) return this.mark(n % N);
    let tot = 0; for (const [s] of pick) tot += Math.exp(s * 6); let r = Math.random() * tot;
    for (const [s, b] of pick) { r -= Math.exp(s * 6); if (r <= 0) return this.mark(b); }
    return this.mark(pick[0][1]);
  }
  mark(b) { this.recent = [b, ...this.recent].slice(0, 5); return b; }
  emit() { this.dispatchEvent(new Event('change')); }
}
