// The band answers you. Play a phrase (keys, pads, a MIDI keyboard, or sing it with "listen to me" on) and leave
// a bar of quiet: the playground looks through every bar every musician played for the one closest to what you
// played — the same notes, the same rhythm — and that musician answers with it, in time, from the next bar line.
// The answer is a real piece on the musician's lane (dashed): it drifts away again, unless you Keep it (K), or
// Record is on.
import { cos } from './features.js';

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export class Answer extends EventTarget {
  constructor(S) {
    super(); this.S = S; this.on = false; this.listening = false; this.notes = []; this.timer = 0; this.last = null; this.lastStem = null;
    // every note played anywhere passes through the sequencer: listen there
    const q = S.seq, noteIn = q.noteIn.bind(q);
    q.noteIn = (slot, note, vel, on) => { noteIn(slot, note, vel, on); if (on) this.hear(note, vel); };
  }
  get ready() { return !!this.S.feat; }
  set(on) {
    this.on = on && this.ready; this.notes = []; clearTimeout(this.timer);
    if (this.on) { const q = this.S.seq; if (q.mode !== 'song') q.setMode('song'); }
    else this.listen(false);
    this.emit();
  }
  hear(note, vel = 0.8) {
    const p = this.S.player; if (!this.on || !p.playing) return;
    this.notes.push({ ab: p.beatNow(), note, vel });
    clearTimeout(this.timer); this.timer = setTimeout(() => this.answer(), p.barDur * 1000);   // a bar of quiet: your turn is over
    this.emit();
  }
  answer() {
    const S = this.S, p = S.player, q = S.seq, f = S.feat, phrase = this.notes; this.notes = [];
    if (!this.on || phrase.length < 2 || !p.playing || q.mode !== 'song') { this.emit(); return; }
    const bpb = S.song.beatsPerBar, a0 = phrase[0].ab, a1 = phrase[phrase.length - 1].ab, len = clamp(Math.ceil((a1 - a0 + 0.5) / bpb), 1, 4);
    const c = new Array(12).fill(0), o = new Array(16).fill(0), base = Math.floor(a0 / bpb) * bpb, semis = p.semis || 0;
    for (const n of phrase) { c[(((n.note - semis) % 12) + 12) % 12] += n.vel; o[Math.floor((n.ab - base) * 4) % 16] += 1; }
    // where it lands: the next bar line (or the one after, if this one is already being played)
    const Tnow = Math.floor(q.tl(p.beatNow()) / bpb), late = p.timeOfBar(p.barNow() + 1) - S.ctx.currentTime < 0.3, start = Tnow + (late ? 2 : 1);
    const free = (id) => !q.arr.clips.some((x) => x.lane === 'stem:' + id && x.start < start + len && x.start + x.len > start);
    let best = null;
    for (const st of S.song.stems) {
      if (st.voice || S.params.get(`band.${st.id}.mute`) || !free(st.id)) continue;
      const rows = f.stems[st.id]; if (!rows) continue;
      for (let b = 0; b + len <= rows.length; b++) {
        const x = rows[b]; if (!x || x.d < -40) continue;
        let sc = 0.6 * cos(c, x.c) + 0.4 * cos(o, x.o) + Math.random() * 0.06 - (st.id === this.lastStem ? 0.08 : 0);
        for (let k = 1; k < len; k++) if (!rows[b + k] || rows[b + k].d < -45) sc -= 0.15;   // an answer that falls silent halfway is no answer
        if (!best || sc > best.sc) best = { sc, st, b };
      }
    }
    if (!best) { this.emit(); return; }
    const clip = { lane: 'stem:' + best.st.id, start, len, src: best.b, fx: { g: 1.35 }, name: '~ answer' };
    q.place(clip); if (start + len > q.arr.bars) q.arr.bars = start + len;
    if (!q.rec) S.mutate.adopt(clip, p.barNow() + (start - Tnow) + len + 1);
    q.changed();
    this.lastStem = best.st.id; this.last = { name: best.st.name, bar: best.b + 1, len, start, kept: q.rec };
    S.say?.(`${best.st.name} answers with bar ${best.b + 1} of the song${q.rec ? ' (kept: Record is on)' : ' · K keeps it'}`);
    this.emit();
  }

  /** "Listen to me": sing or play an instrument into the microphone, and the notes count as a phrase. */
  async listen(on) {
    clearInterval(this.poll); this.listening = false;
    if (on) {
      let mic; try { mic = await this.S.engine.openMic(); } catch (e) { this.S.say?.(e?.name === 'NotAllowedError' ? 'The microphone was not allowed' : 'No microphone here'); this.emit(); return; }
      const an = mic.monitor, buf = new Float32Array(an.fftSize), sr = this.S.ctx.sampleRate;
      let cur = null, cand = null, seen = 0;
      this.listening = true;
      this.poll = setInterval(() => {
        an.getFloatTimeDomainData(buf);
        let rms = 0; for (const v of buf) rms += v * v; rms = Math.sqrt(rms / buf.length);
        const m = rms > 0.015 ? pitch(buf, sr) : null;
        if (m == null) { cur = null; cand = null; return; }
        if (m === cand) seen++; else { cand = m; seen = 1; }
        if (seen === 2 && m !== cur) { cur = m; this.hear(m, clamp(rms * 6, 0.3, 1)); }
      }, 30);
    }
    this.emit();
  }
  emit() { this.dispatchEvent(new Event('change')); }
}

/** A sung or played note from a short stretch of sound (autocorrelation), as a MIDI note, or null. */
function pitch(x, sr) {
  const n = x.length, lo = Math.floor(sr / 1000), hi = Math.min(n >> 1, Math.floor(sr / 75));
  let best = 0, lag = 0, e0 = 0; for (let i = 0; i < n - hi; i++) e0 += x[i] * x[i];
  for (let L = lo; L <= hi; L++) { let s = 0, e1 = 0; for (let i = 0; i < n - hi; i++) { s += x[i] * x[i + L]; e1 += x[i + L] * x[i + L]; } const r = s / Math.sqrt(e0 * e1 + 1e-12); if (r > best) { best = r; lag = L; } }
  if (best < 0.85 || !lag) return null;
  return Math.round(69 + 12 * Math.log2(sr / lag / 440));
}
