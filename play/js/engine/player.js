// The player turns session state into sound, one BAR at a time. At every bar line each track resolves to
// "which cell, which bar of it" (or silence); if that is simply the next bar of what is already sounding the
// voice runs on untouched — so the original song plays back seamless — otherwise the old voice is faded out
// and a new one cut in on the bar. Launches, scene jumps, genomes and loops are all just different answers to
// that one question, which is why every world can drive the same engine.

const LOOKAHEAD = 0.2;   // seconds scheduled ahead
const TICK = 25;         // ms
const FADE = 0.004;      // seconds — splice fade between discontinuous cells
const XFADE = 0.03;      // seconds — the crossfade where the tempo changes (on a bar line)
const PREFETCH_BARS = 8;

export class Player extends EventTarget {
  constructor(engine, loader, session, song) {
    super();
    Object.assign(this, { engine, loader, session, song });
    this.ctx = engine.ctx;
    this.catalog = new Map();
    this.voices = new Map();     // trackId → voice
    this.chopVoices = [];
    this.playing = false;
    this.bar0 = 0;               // ctx time of song bar 0
    this.pausedBar = 0;
    this.nextBar = 0; this.nextStep = 0;
    this.replay = null;
    // the PERFORMANCE clock counts beats actually played; unlike the song position it never jumps on a seek,
    // so takes and replays stay in time even when the player scrubs around the song
    this.clockOrigin = 0; this.elapsedFrozen = 0;
    this.beatDur = song.beatDur; this.barDur = song.barDur; this.cellBars = song.barsPerCell; this.bpb = song.beatsPerBar;
    this.stepDur = this.beatDur / 4;
    engine.setTempo(song.bpm);
    // tempo: r = new bpm / the song's. "warp" stretches every cell to the new tempo (pitch stays, in a worker);
    // otherwise the cells play faster or slower, like tape (pitch follows)
    this.bpm = song.bpm; this.r = 1; this.warp = true; this.stretcher = new Stretcher(this.ctx);
    // key: semitones for the whole song, and per stem on top (warped copies carry the pitch shift too)
    this.semis = 0; this.stemSemis = {};
    session.clock = () => this.elapsed();
    session.on(({ a, prev, state }) => this.onAction(a, prev, state));
    setInterval(() => this.tick(), TICK);
  }

  // ------------------------------------------------------------ tempo
  setTempo(bpm, warp = this.warp) {
    bpm = Math.max(40, Math.min(240, +bpm || this.song.bpm));
    const cur = this.pendingTempo || { bpm: this.bpm, warp: this.warp };
    if (bpm === cur.bpm && warp === cur.warp) return;
    if (!this.playing) { this.pendingTempo = null; this.retime(bpm, warp); this.emit('tempo', { bpm, warp }); return; }
    // while playing, a new tempo waits for the next bar line and comes in there with a crossfade (no clicks,
    // and in time); meanwhile the warped copies for it are started, so they are usually ready by then
    this.pendingTempo = { bpm, warp };
    for (const [id, v] of this.voices) { const b = this.loader.get(v.url), a = this.alphaFor(id, bpm, warp); if (b && a !== 1) this.stretcher.get(b, a); }
  }
  retime(bpm, warp) {
    this.bpm = bpm; this.r = bpm / this.song.bpm; this.warp = warp;
    this.beatDur = 60 / bpm; this.barDur = this.beatDur * this.bpb; this.stepDur = this.beatDur / 4;
    this.engine.setTempo(bpm);
  }
  /** The tempo change itself, at bar B (called just before B is scheduled). */
  applyTempo(B) {
    const { bpm, warp } = this.pendingTempo; this.pendingTempo = null;
    const T = this.timeOfBar(B), elT = (T - this.clockOrigin) / this.beatDur;
    this.retime(bpm, warp);
    for (const v of this.voices.values()) this.kill(v, T, XFADE);
    this.voices.clear();
    this.bar0 = this.snap(T - B * this.barDur); this.clockOrigin = T - elT * this.beatDur;
    this.nextBar = B; this.nextStep = B * this.bpb * 4; this.xfadeBar = B;
    this.emit('tempo', { bpm, warp });
  }
  /** The buffer to play for a cell at the current tempo (null while its warped copy is still being made). */
  bufFor(url, id) {
    const b = this.loader.get(url), a = this.alphaFor(id); if (!b || a === 1) return b;
    // while the copy for this tempo (and key) is being made, the nearest one already made plays, its speed nudged
    // to fit (a moment of slightly bent pitch instead of a gap: tempo can follow your walking)
    return this.stretcher.get(b, a) || this.stretcher.nearest(b, a) || b;
  }
  /** How much longer a cell's warped copy is: the tempo (with warp) and the key (stretched, then sped back up). */
  alphaFor(id, bpm = this.bpm, warp = this.warp) {
    const p = 2 ** ((this.semis + (this.stemSemis[id] || 0)) / 12), r = bpm / this.song.bpm;
    return Math.round((warp ? p / r : p) * 1e4) / 1e4;
  }
  /** A new key: it comes in on the next bar line, like a tempo change. */
  setKey(semis, id) {
    if (id) { if (semis) this.stemSemis[id] = semis; else delete this.stemSemis[id]; } else this.semis = semis;
    if (this.playing) this.pendingTempo = this.pendingTempo || { bpm: this.bpm, warp: this.warp };
    this.emit('key', { semis, id });
  }
  /** Playback rate for a buffer at the current tempo: a warped copy made for this tempo plays at 1. */
  rateFor(buf) { return this.r * (this.stretcher.alphaOf(buf) ?? 1); }
  get rateMul() { return this.warp ? 1 : this.r; }

  // ------------------------------------------------------------ catalog
  addSource(id, entry) { this.catalog.set(id, entry); this.applyMix(this.session.state); }
  source(id) { return this.catalog.get(id); }

  // ------------------------------------------------------------ clock
  beatNow() { return this.playing ? (this.ctx.currentTime - this.bar0) / this.beatDur : this.pausedBar * this.bpb; }
  elapsed() { return this.playing ? (this.ctx.currentTime - this.clockOrigin) / this.beatDur : this.elapsedFrozen; }
  timeOfElapsed(e) { return this.clockOrigin + e * this.beatDur; }
  barNow() { return Math.floor(this.beatNow() / this.bpb); }
  timeOfBar(b) { return this.bar0 + b * this.barDur; }
  timeOfBeat(beat) { return this.bar0 + beat * this.beatDur; }
  /** Bar lines land on whole sample frames, so consecutive cells meet with no fractional-sample seam. */
  snap(t) { const sr = this.ctx.sampleRate; return Math.round(t * sr) / sr; }
  get songBars() { return this.song.numBars || 1; }

  /** What should track `tr` sound at song bar B?  → { cell, bar, url } | null */
  resolve(tr, B) { const w = this.resolveSrc(tr, B), o = this.over?.get(tr.id); return o ? o(w, B) : w; }   // `over`: a stem living in a pool (phone)
  resolveSrc(tr, B) {
    const src = this.catalog.get(tr.id);
    if (!src || src.locked || !src.cells.length) return null;
    const cb = this.cellBars;
    const pick = (c, b) => { const cell = src.cells[c]; return cell ? { cell: c, bar: b, url: cell.url } : null; };
    switch (tr.mode) {
      case 'follow': {
        const n = src.kind === 'stem' ? this.songBars : src.cells.length * cb;
        const b = ((B % n) + n) % n;
        return pick(Math.floor(b / cb), b % cb);
      }
      case 'loop': return pick(Math.min(tr.cell, src.cells.length - 1), ((B % cb) + cb) % cb);
      case 'pattern': {
        const p = tr.pattern; if (!p?.length) return null;
        const g = p[((B % p.length) + p.length) % p.length];
        const w = g ? pick(g[0], g[1]) : null;
        if (w && g[2]) w.fx = g[2];   // a treatment on this bar: { r: reverse, s: speed, u: stutter slices, g: gain, o: offset in bars }
        return w;
      }
      default: return null;
    }
  }

  // ------------------------------------------------------------ transport
  play(fromBar = this.pausedBar) {
    if (this.playing) return;
    this.ctx.resume();
    this.playing = true;
    this.bar0 = this.snap(this.ctx.currentTime + 0.08 - fromBar * this.barDur);
    this.clockOrigin = this.timeOfBar(fromBar) - this.elapsedFrozen * this.beatDur;
    this.nextBar = fromBar; this.nextStep = fromBar * this.bpb * 4;
    this.emit('transport', { playing: true });
  }
  stop({ tape = false } = {}) {
    if (!this.playing) return;
    const t = this.ctx.currentTime;
    this.pausedBar = Math.max(0, Math.floor((t - this.bar0) / this.barDur));
    this.elapsedFrozen = (t - this.clockOrigin) / this.beatDur;
    this.playing = false;
    const all = [...this.voices.values(), ...this.chopVoices];
    if (tape) {
      // tape stop: every voice decelerates together, pitch and all
      for (const v of all) {
        v.src.playbackRate.cancelScheduledValues(t); v.src.playbackRate.setValueAtTime(1, t);
        v.src.playbackRate.exponentialRampToValueAtTime(0.02, t + 1.1);
        v.g.gain.setTargetAtTime(0, t + 0.8, 0.08);
        v.src.stop(t + 1.3);
      }
    } else for (const v of all) this.kill(v, t);
    this.voices.clear(); this.chopVoices = [];
    if (this.pendingTempo) { const { bpm, warp } = this.pendingTempo; this.pendingTempo = null; this.retime(bpm, warp); this.emit('tempo', { bpm, warp }); }
    this.emit('transport', { playing: false, tape });
  }
  seek(bar) {
    bar = Math.max(0, Math.round(bar));
    if (!this.playing) { this.pausedBar = bar; this.emit('seek', { bar }); return; }
    const t = this.ctx.currentTime;
    for (const v of this.voices.values()) this.kill(v, t + 0.03);
    this.voices.clear();
    this.bar0 = this.snap(t + 0.06 - bar * this.barDur);
    this.nextBar = bar; this.nextStep = bar * this.bpb * 4;
    this.emit('seek', { bar });
  }

  // ------------------------------------------------------------ scheduling
  tick() {
    if (!this.playing) return;
    const now = this.ctx.currentTime, horizon = now + LOOKAHEAD;
    if (this.pendingTempo && this.timeOfBar(this.nextBar) < horizon + 0.06) this.applyTempo(this.nextBar);
    while (this.timeOfBar(this.nextBar) < horizon) { this.scheduleBar(this.nextBar, this.timeOfBar(this.nextBar)); this.nextBar++; }
    while (this.bar0 + this.nextStep * this.stepDur < horizon) { this.scheduleStep(this.nextStep, this.bar0 + this.nextStep * this.stepDur); this.nextStep++; }
    this.lateJoin(now);
    this.pumpReplay(now);
  }

  scheduleBar(B, T) {
    const st = this.session.state;
    const wanted = new Set();
    for (const id of st.order) {
      const tr = st.tracks[id];
      const want = this.resolve(tr, B);
      let v = this.voices.get(id), contiguous = false;
      if (v) {
        const ended = v.end <= T + 1e-3;
        if (!ended && want && !want.fx && !v.fx && v.url === want.url && B - v.base === want.bar) continue; // just the next bar — let it ring
        contiguous = ended && want && !want.fx && !v.fx && want.bar === 0 && want.cell === v.cell + 1 && Math.abs(v.end - T) < 2e-3;
        if (!ended) this.kill(v, T);
        this.voices.delete(id);
      }
      if (!want) continue;
      if (!this.loader.has(want.url)) { this.loader.load(want.url); continue; }
      const buf = this.bufFor(want.url, id); if (!buf) continue;
      this.startVoice(id, buf, want, B, T, want.bar * this.barDur, !contiguous);
    }
    // prefetch the near future and pin it against eviction
    for (let k = 0; k <= PREFETCH_BARS; k++) for (const id of st.order) { const w = this.resolve(st.tracks[id], B + k); if (w) { wanted.add(w.url); if (k) this.loader.ensure(w.url).then((b) => { const a = this.alphaFor(id); if (b && a !== 1) this.stretcher.get(b, a); }); } }
    const chopUrl = this.chopUrl(); if (chopUrl) wanted.add(chopUrl);
    this.loader.pinned = wanted;
    this.emit('bar', { bar: B, time: T });
  }

  startVoice(id, buf, want, B, T, offset, fadeIn) {
    if (want.fx) return this.startTreated(id, buf, want, B, T, offset - want.bar * this.barDur);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const rm = this.rateFor(buf); if (rm !== 1) src.playbackRate.value = rm;
    const g = this.ctx.createGain();
    if (fadeIn) { const f = B === this.xfadeBar ? XFADE : FADE; g.gain.setValueAtTime(0, T); g.gain.linearRampToValueAtTime(1, T + f); }
    src.connect(g).connect(this.engine.channel(id).input);
    src.start(T, offset * rm);
    src.onended = () => { src.disconnect(); g.disconnect(); };
    const v = { src, g, url: want.url, cell: want.cell, base: B - want.bar, end: T + (buf.duration - offset * rm) / rm };
    this.voices.set(id, v);
    return v;
  }

  /** One bar of a stem with a treatment: reversed, slowed (an octave down) or doubled (an octave up, the bar
   *  twice), stuttered (its first slice repeated), louder or softer. Always exactly one bar long, then cut. */
  startTreated(id, buf0, want, B, T, late = 0) {
    const fx = want.fx, bd = this.barDur, rm = this.rateFor(buf0), rate = (fx.s || 1) * rm, rev = !!fx.r, bb = bd * rm;   // bb: a bar inside the buffer
    const buf = rev ? this.loader.reverse(buf0) : buf0, D = buf.duration;
    const s0 = rev ? D - (want.bar + 1) * bb : want.bar * bb;
    const at = Math.max(0, s0 + (fx.o || 0) * bb);
    const src = this.ctx.createBufferSource(); src.buffer = buf; src.playbackRate.value = rate;
    const slice = fx.u ? bd / fx.u : (fx.s || 1) > 1 ? bd / fx.s : 0;   // seconds of timeline per repeat
    if (slice) { src.loop = true; src.loopStart = at; src.loopEnd = Math.min(D, at + slice * rate); }
    const g = this.ctx.createGain(), lvl = fx.g ?? 1, end = T + bd - late;
    g.gain.setValueAtTime(0, T); g.gain.linearRampToValueAtTime(lvl, T + FADE);
    g.gain.setValueAtTime(lvl, end - FADE); g.gain.linearRampToValueAtTime(0, end);
    src.connect(g).connect(this.engine.channel(id).input);
    const off = slice ? at + ((late * rate) % (slice * rate)) : at + late * rate;
    src.start(T, Math.min(off, D - 0.01)); src.stop(end + 0.003);
    src.onended = () => { src.disconnect(); g.disconnect(); };
    const v = { src, g, url: want.url, cell: want.cell, base: B - want.bar, end, fx };
    this.voices.set(id, v);
    return v;
  }

  kill(v, t, fade = FADE) {
    try {
      v.g.gain.cancelScheduledValues(t); v.g.gain.setValueAtTime(t > this.ctx.currentTime + 0.005 ? (v.fx?.g ?? 1) : v.g.gain.value, t);
      v.g.gain.linearRampToValueAtTime(0, t + fade); v.src.stop(t + fade + 0.002);
    } catch { /* already stopped */ }
  }

  /** A cell that arrived after its bar was scheduled joins mid-bar, in phase, instead of waiting a whole bar. */
  lateJoin(now) {
    const B = Math.floor((now - this.bar0) / this.barDur);
    if (B >= this.nextBar || this.timeOfBar(B + 1) - now < LOOKAHEAD + 0.05) return;
    const st = this.session.state;
    for (const id of st.order) {
      const v = this.voices.get(id);
      if (v && v.end > now + 0.01) continue;
      const want = this.resolve(st.tracks[id], B);
      const buf = want && this.bufFor(want.url, id);
      if (!buf) continue;
      const T = now + 0.03, offset = want.bar * this.barDur + (T - this.timeOfBar(B));
      if (offset < buf.duration - 0.05) this.startVoice(id, buf, want, B, T, offset, true);
    }
  }

  // ------------------------------------------------------------ chop pads + step sequencer
  chopUrl() { const c = this.session.state.chop; return c.track ? this.catalog.get(c.track)?.cells[c.cell]?.url : null; }
  scheduleStep(s, T) {
    const c = this.session.state.chop;
    if (c.seq && c.track) { const p = c.steps[s % 16]; if (p >= 0) this.playPad(p, T); }
    this.emit('step', { step: s, time: T });
  }
  playPad(i, at) {
    const c = this.session.state.chop, url = this.chopUrl();
    const buf0 = url && this.loader.get(url);
    if (!buf0) { if (url) this.loader.load(url); return; }
    const t = Math.max(at ?? 0, this.ctx.currentTime + 0.005);
    const slice = this.song.cellDur / 16, len = slice * c.len, rate = 2 ** (c.pitch / 12);
    const buf = c.reverse ? this.loader.reverse(buf0) : buf0;
    const off = c.reverse ? buf.duration - (i * slice + len) : i * slice;
    if (c.choke) { for (const v of this.chopVoices) this.kill(v, t); this.chopVoices = []; }
    const src = this.ctx.createBufferSource(); src.buffer = buf; src.playbackRate.value = rate;
    const g = this.ctx.createGain(), dur = len / rate;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(c.gain, t + 0.002);
    g.gain.setValueAtTime(c.gain, t + Math.max(0.003, dur - 0.012)); g.gain.linearRampToValueAtTime(0, t + dur);
    src.connect(g).connect(this.engine.channel('__chop').input);
    src.start(t, Math.max(0, off), len + 0.01);
    const v = { src, g };
    this.chopVoices.push(v);
    src.onended = () => { src.disconnect(); g.disconnect(); this.chopVoices = this.chopVoices.filter((x) => x !== v); };
    this.emit('pad', { pad: i, time: t });
  }

  // ------------------------------------------------------------ reacting to the session
  onAction(a, prev, state) {
    if (a.t === 'pad') return this.playPad(a.i, a.at);
    if (a.t === 'fx' && a.fx === 'thunder') return this.engine.thunder(a.at, this.barDur);
    if (a.t === 'fx' && a.fx === 'tapestop') return this.stop({ tape: true });
    if (a.t === 'seek') return this.seek(a.bar);
    if (a.t === 'weather/set' || a.t === 'state/load') this.engine.setWeather(state.weather);
    if ((a.t === 'chop/set' || a.t === 'state/load') && this.chopUrl()) this.loader.load(this.chopUrl());
    if (prev.tracks !== state.tracks || prev.order !== state.order || a.t === 'state/load') this.applyMix(state);
    if (a.t === 'track/remove') { const v = this.voices.get(a.id); if (v) this.kill(v, this.ctx.currentTime); this.voices.delete(a.id); }
    // prefetch the moment a launch is queued, not a bar later
    if (a.t === 'track/set' || a.t === 'tracks/set') {
      const B = this.playing ? this.nextBar : this.pausedBar;
      for (const id of a.t === 'track/set' ? [a.id] : Object.keys(a.p)) { const tr = state.tracks[id]; const w = tr && this.resolve(tr, B); if (w) this.loader.load(w.url); }
    }
  }

  applyMix(state) {
    const t = this.ctx.currentTime;
    const anySolo = state.order.some((id) => state.tracks[id]?.solo);
    for (const id of state.order) {
      const tr = state.tracks[id], src = this.catalog.get(id);
      const audible = src && !src.locked && !tr.mute && (!anySolo || tr.solo);
      this.engine.channel(id).set({ gain: audible ? tr.gain * (src.gain ?? 1) : 0, pan: tr.pan, lp: tr.lp, rev: tr.rev, dly: tr.dly }, t);
    }
    this.engine.channel('__chop').set({ gain: 1, rev: 0.08, dly: 0.05 }, t);
  }

  // ------------------------------------------------------------ replay of a shared take
  startReplay(take, { onEnd } = {}) {
    this.stop();
    this.session.replaying = true;
    this.session.dispatch({ t: 'state/load', state: take.snapshot }, { log: false });
    this.elapsedFrozen = 0;
    this.replay = { events: take.events, i: 0, end: take.lengthBeats, onEnd };
    this.pausedBar = take.startBar ?? 0;
    this.play(this.pausedBar);
  }
  endReplay() {
    if (!this.replay) return;
    this.replay = null; this.session.replaying = false;
    this.emit('replay', { ended: true });
  }
  pumpReplay(now) {
    const r = this.replay; if (!r) return;
    const beatNow = (now - this.clockOrigin) / this.beatDur, beatLA = (now + LOOKAHEAD - this.clockOrigin) / this.beatDur;
    while (r.i < r.events.length) {
      const e = r.events[r.i], target = Math.max(0, e.b);
      const isPad = e.a.t === 'pad' || e.a.t === 'fx';
      if (target > (isPad ? beatLA : beatNow)) break;
      r.i++;
      this.session.dispatch(isPad ? { ...e.a, at: this.timeOfElapsed(target) } : e.a, { log: false });
    }
    if (beatNow >= r.end) { const cb = r.onEnd; this.endReplay(); this.stop(); cb?.(); }
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  on(type, fn) { const h = (e) => fn(e.detail); this.addEventListener(type, h); return () => this.removeEventListener(type, h); }
}

/** Warped (time-stretched) copies of cells, made in a worker; kept beside the cell for the last two tempos, so a
 *  tempo that keeps moving (walking) always has something close to play while the exact copy is being made. */
class Stretcher {
  constructor(ctx) {
    this.ctx = ctx; this.map = new WeakMap(); this.alpha = new WeakMap(); this.jobs = new Map(); this.id = 0;
    this.w = new Worker(new URL('./stretch.js', import.meta.url));
    this.w.onmessage = ({ data }) => {
      const j = this.jobs.get(data.id); this.jobs.delete(data.id); if (!j) return;
      const out = this.ctx.createBuffer(data.chans.length, data.chans[0].length, j.buf.sampleRate);
      data.chans.forEach((c, i) => out.copyToChannel(c, i));
      const e = this.map.get(j.buf)?.get(j.alpha); if (e) { e.out = out; this.alpha.set(out, j.alpha); }
    };
  }
  reset() { this.map = new WeakMap(); }
  alphaOf(buf) { return this.alpha.get(buf); }
  get(buf, alpha) {
    alpha = Math.round(alpha * 1e4) / 1e4;
    let m = this.map.get(buf); if (!m) this.map.set(buf, (m = new Map()));
    const e = m.get(alpha); if (e) { m.delete(alpha); m.set(alpha, e); return e.out; }
    m.set(alpha, { out: null }); while (m.size > 2) m.delete(m.keys().next().value);
    const id = ++this.id, chans = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i).slice());
    this.jobs.set(id, { buf, alpha }); this.w.postMessage({ id, chans, alpha }, chans.map((c) => c.buffer));
    return null;
  }
  nearest(buf, alpha) {
    let best = null, bd = Infinity;
    for (const [a, e] of this.map.get(buf) || []) if (e.out && Math.abs(Math.log(a / alpha)) < bd) { bd = Math.abs(Math.log(a / alpha)); best = e.out; }
    return best;
  }
}
