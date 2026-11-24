// Studio sound processors (AudioWorklet). Loaded once by the studio.
//  granulator : a cloud of grains read from a stretch of a stem; streams = held notes (and an optional drone)
//  strings    : plucked/bowed strings whose excitation is a slice of a stem (Karplus–Strong with a sampled exciter)
//  resonators : a bank of tuned feedback combs the whole mix rings through
//  shifter    : pitch shifter (two crossfaded delay taps) used inside the shimmer loop
//  repeat     : beat repeat — hold to loop the last fraction of a beat, live

const TAU = Math.PI * 2;
const rnd = () => Math.random();

// ------------------------------------------------------------------------------------------- granulator
class Granulator extends AudioWorkletProcessor {
  constructor() {
    super();
    this.L = null; this.R = null; this.len = 0;
    this.p = { pos: 0.3, spread: 0.08, size: 120, density: 24, pitch: 0, jitter: 0, reverse: 0, width: 0.7, scan: 0, freeze: false,
      attack: 0.08, release: 0.6, level: 0.8, drone: false, droneNote: 0, sizeJit: 0.3, shape: 0.5 };
    this.streams = new Map();   // id → { ratio, vel, env, gate, next }
    this.pending = [];          // timed note events
    this.grains = [];
    this.report = 0; this.recent = [];
    this.port.onmessage = (e) => this.msg(e.data);
  }
  msg(d) {
    if (d.buf) { this.L = d.buf[0]; this.R = d.buf[1] || d.buf[0]; this.len = this.L.length; this.grains = []; }
    if (d.p) Object.assign(this.p, d.p);
    if (d.on || d.off) this.pending.push(d);
    if (d.panic) { this.streams.clear(); this.pending = []; }
  }
  stream(id, semis, vel) {
    let s = this.streams.get(id);
    if (!s) { s = { env: 0, next: 0 }; this.streams.set(id, s); }
    s.ratio = 2 ** (semis / 12); s.vel = vel; s.gate = true;
  }
  process(_in, outputs) {
    const out = outputs[0], oL = out[0], oR = out[1] || out[0], n = oL.length, p = this.p, sr = sampleRate;
    // timed notes
    if (this.pending.length) {
      this.pending = this.pending.filter((e) => {
        if ((e.at ?? 0) > currentTime + n / sr) return true;
        if (e.on) this.stream(e.on, e.semis, e.vel ?? 0.8); else { const s = this.streams.get(e.off); if (s) s.gate = false; }
        return false;
      });
    }
    if (p.drone) { const s = this.streams.get('drone'); if (!s || !s.gate || s.semis !== p.droneNote) { this.stream('drone', p.droneNote, 0.8); this.streams.get('drone').semis = p.droneNote; } }
    else { const s = this.streams.get('drone'); if (s) s.gate = false; }
    if (!this.len) return true;
    if (!p.freeze && p.scan) { p.pos += (p.scan * n) / sr / Math.max(1, this.len / sr); p.pos -= Math.floor(p.pos); }
    const atk = 1 / Math.max(1, p.attack * sr), rel = 1 / Math.max(1, p.release * sr);
    const sizeS = Math.max(0.005, p.size / 1000), norm = 1.9 / Math.sqrt(Math.max(1, p.density * sizeS * 1.2));
    for (const [id, s] of this.streams) {
      // envelopes run per block (smooth enough at 128 samples) and grains are seeded inside the block
      s.env = s.gate ? Math.min(1, s.env + atk * n) : Math.max(0, s.env - rel * n);
      if (!s.gate && s.env <= 0) { this.streams.delete(id); continue; }
      s.next -= n;
      while (s.next <= 0 && this.grains.length < 160) {
        const dur = Math.max(64, Math.round(sizeS * sr * (1 + (rnd() * 2 - 1) * p.sizeJit)));
        let start = (p.pos + (rnd() * 2 - 1) * p.spread) * this.len; start = ((start % this.len) + this.len) % this.len;
        const semis = p.pitch + (rnd() * 2 - 1) * p.jitter;
        const rev = rnd() < p.reverse ? -1 : 1, inc = rev * s.ratio * 2 ** (semis / 12);
        const pan = (rnd() * 2 - 1) * p.width, a = s.env * s.vel * norm * p.level;
        this.grains.push({ pos: start, inc, i: 0, len: dur, l: a * Math.cos((pan + 1) * Math.PI / 4), r: a * Math.sin((pan + 1) * Math.PI / 4), off: n + s.next });
        if (this.recent.length < 48) this.recent.push(start / this.len);
        s.next += sr / Math.max(0.5, p.density) * (0.6 + rnd() * 0.8);
      }
    }
    oL.fill(0); if (oR !== oL) oR.fill(0);
    const L = this.L, R = this.R, len = this.len, shape = p.shape;
    for (let g = this.grains.length - 1; g >= 0; g--) {
      const gr = this.grains[g];
      for (let k = Math.max(0, gr.off); k < n; k++) {
        if (gr.i >= gr.len) break;
        const ph = gr.i / gr.len;
        // window: shape 0 = soft Hann, 1 = sharper, more percussive grains
        const w = shape < 0.5 ? Math.sin(Math.PI * ph) ** 2 : (ph < 0.08 ? ph / 0.08 : Math.exp(-(ph - 0.08) * (3 + shape * 6)));
        let x = gr.pos; x = ((x % len) + len) % len; const i0 = x | 0, f = x - i0, i1 = (i0 + 1) % len;
        oL[k] += (L[i0] + (L[i1] - L[i0]) * f) * w * gr.l;
        oR[k] += (R[i0] + (R[i1] - R[i0]) * f) * w * gr.r;
        gr.pos += gr.inc; gr.i++;
      }
      gr.off = 0;
      if (gr.i >= gr.len) this.grains.splice(g, 1);
    }
    if ((this.report += n) > sr / 30) { this.report = 0; this.port.postMessage({ pos: p.pos, grains: this.recent, voices: this.streams.size }); this.recent = []; }
    return true;
  }
}
registerProcessor('granulator', Granulator);

// ------------------------------------------------------------------------------------------- strings
class Strings extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ex = new Float32Array(1); this.p = { decay: 0.996, bright: 0.5, excite: 0.08, detune: 0.004, body: 0.15, level: 0.8, release: 0.3 };
    this.voices = []; this.pending = [];
    this.port.onmessage = (e) => { const d = e.data; if (d.ex) this.ex = d.ex; if (d.p) Object.assign(this.p, d.p); if (d.on || d.off) this.pending.push(d); if (d.panic) this.voices = []; };
  }
  start(id, freq, vel) {
    const sr = sampleRate, mk = (f) => { const L = Math.max(4, sr / f); const n = Math.ceil(L) + 2; return { buf: new Float32Array(n), n, L, w: 0, s: 0 }; };
    if (this.voices.length > 14) this.voices.shift();
    this.voices.push({ id, a: mk(freq * (1 + this.p.detune)), b: mk(freq * (1 - this.p.detune)), e: 0, eLen: Math.min(this.ex.length, Math.round(this.p.excite * sr)), vel, gate: true, fade: 1 });
  }
  line(st, input, fb, bright) {
    // fractional read L samples behind the write head, one-pole lowpass in the loop
    let rp = st.w - st.L; while (rp < 0) rp += st.n;
    const i0 = rp | 0, f = rp - i0, i1 = (i0 + 1) % st.n, y = st.buf[i0] + (st.buf[i1] - st.buf[i0]) * f;
    st.s += (y - st.s) * bright;
    st.buf[st.w] = input + st.s * fb; st.w = (st.w + 1) % st.n;
    return y;
  }
  process(_in, outputs) {
    const out = outputs[0], oL = out[0], oR = out[1] || oL, n = oL.length, p = this.p, sr = sampleRate;
    if (this.pending.length) this.pending = this.pending.filter((e) => {
      if ((e.at ?? 0) > currentTime + n / sr) return true;
      if (e.on) this.start(e.on, e.freq, e.vel ?? 0.8); else for (const v of this.voices) if (v.id === e.off) v.gate = false;
      return false;
    });
    oL.fill(0); if (oR !== oL) oR.fill(0);
    const bright = 0.05 + p.bright * 0.93, relK = Math.exp(-1 / Math.max(1, p.release * sr));
    for (let vi = this.voices.length - 1; vi >= 0; vi--) {
      const v = this.voices[vi], fb = v.gate ? p.decay : p.decay * 0.985;
      let peak = 0;
      for (let k = 0; k < n; k++) {
        let x = 0;
        if (v.e < v.eLen) { const ph = v.e / v.eLen; x = this.ex[v.e] * v.vel * (1 - ph) * 0.6; v.e++; }
        const a = this.line(v.a, x, fb, bright), b = this.line(v.b, x, fb, bright);
        if (!v.gate) v.fade *= relK;
        const lv = p.level * 2.6, yL = (a * 0.7 + b * 0.3 + x * p.body) * v.fade * lv, yR = (b * 0.7 + a * 0.3 + x * p.body) * v.fade * lv;
        oL[k] += yL; oR[k] += yR; peak = Math.max(peak, Math.abs(yL));
      }
      if ((v.e >= v.eLen && peak < 1e-4) || v.fade < 1e-4) this.voices.splice(vi, 1);
    }
    return true;
  }
}
registerProcessor('strings', Strings);

// ------------------------------------------------------------------------------------------- resonators
class Resonators extends AudioWorkletProcessor {
  constructor() {
    super();
    this.p = { freqs: [110, 165, 220, 330, 440, 660], decay: 0.97, mix: 0, bright: 0.6 };
    this.lines = []; this.build();
    this.port.onmessage = (e) => { const old = this.p.freqs.join(); Object.assign(this.p, e.data.p || {}); if (this.p.freqs.join() !== old) this.build(); };
  }
  build() { this.lines = this.p.freqs.map((f) => { const L = sampleRate / f, n = Math.ceil(L) + 2; return { buf: new Float32Array(n), n, L, w: 0, s: 0 }; }); }
  process(inputs, outputs) {
    const inp = inputs[0], out = outputs[0], n = out[0].length, p = this.p;
    const iL = inp[0] || new Float32Array(n), iR = inp[1] || iL, oL = out[0], oR = out[1] || oL;
    if (p.mix <= 0.0005) { oL.set(iL); if (oR !== oL) oR.set(iR); return true; }
    const fb = p.decay, br = 0.1 + p.bright * 0.85, g = 0.35 / Math.sqrt(this.lines.length);
    for (let k = 0; k < n; k++) {
      const x = (iL[k] + iR[k]) * 0.5 * 0.25; let sL = 0, sR = 0;
      for (let j = 0; j < this.lines.length; j++) {
        const st = this.lines[j]; let rp = st.w - st.L; while (rp < 0) rp += st.n;
        const i0 = rp | 0, f = rp - i0, y = st.buf[i0] + (st.buf[(i0 + 1) % st.n] - st.buf[i0]) * f;
        st.s += (y - st.s) * br; st.buf[st.w] = x + st.s * fb; st.w = (st.w + 1) % st.n;
        if (j & 1) sR += y; else sL += y;
      }
      oL[k] = iL[k] * (1 - p.mix) + Math.tanh(sL * g * 4) * p.mix;
      oR[k] = iR[k] * (1 - p.mix) + Math.tanh(sR * g * 4) * p.mix;
    }
    return true;
  }
}
registerProcessor('resonators', Resonators);

// ------------------------------------------------------------------------------------------- shifter
class Shifter extends AudioWorkletProcessor {
  constructor() { super(); this.ratio = 2; this.n = 4096; this.buf = [new Float32Array(this.n), new Float32Array(this.n)]; this.w = 0; this.ph = 0; this.port.onmessage = (e) => { if (e.data.ratio) this.ratio = e.data.ratio; }; }
  process(inputs, outputs) {
    const inp = inputs[0], out = outputs[0], n = out[0].length, win = 2048, step = (1 - this.ratio) / win;
    for (let k = 0; k < n; k++) {
      for (let c = 0; c < 2; c++) this.buf[c][this.w] = (inp[c] || inp[0] || [])[k] || 0;
      this.ph = (this.ph + step + 1) % 1;
      for (let c = 0; c < out.length; c++) {
        let s = 0;
        for (const o of [0, 0.5]) {
          const ph = (this.ph + o) % 1, d = ph * win, rp = (this.w - d - 1 + this.n) % this.n, i0 = rp | 0, f = rp - i0;
          const b = this.buf[c], y = b[i0] + (b[(i0 + 1) % this.n] - b[i0]) * f;
          s += y * Math.sin(Math.PI * ph);
        }
        out[c][k] = s * 0.7;
      }
      this.w = (this.w + 1) % this.n;
    }
    return true;
  }
}
registerProcessor('shifter', Shifter);

// ------------------------------------------------------------------------------------------- repeat
// Hold to loop the last fraction of a beat. Starts and stops can be timed (`at`), the loop can be read faster or
// slower (pitch) and each pass can fade (decay).
class Repeat extends AudioWorkletProcessor {
  constructor() {
    super(); this.n = sampleRate * 4; this.buf = [new Float32Array(this.n), new Float32Array(this.n)]; this.w = 0;
    this.on = false; this.len = 0; this.start = 0; this.r = 0; this.x = 0; this.decay = 0.98; this.g = 1; this.rate = 1; this.q = [];
    this.port.onmessage = (e) => { const d = e.data; if (d.p) { if (d.p.rate) this.rate = d.p.rate; if (d.p.decay !== undefined) this.decay = d.p.decay; } if (d.on || d.off) this.q.push(d); };
  }
  begin(d) { this.len = Math.max(64, Math.round(d.len * sampleRate)); this.start = (this.w - this.len + this.n) % this.n; this.r = 0; this.g = 1; this.on = true; }
  process(inputs, outputs) {
    const inp = inputs[0], out = outputs[0], n = out[0].length, xf = 1 / 240;
    if (this.q.length) this.q = this.q.filter((d) => { if ((d.at ?? 0) > currentTime + n / sampleRate) return true; if (d.on) this.begin(d); else this.on = false; return false; });
    for (let k = 0; k < n; k++) {
      for (let c = 0; c < 2; c++) this.buf[c][this.w] = (inp[c] || inp[0] || [])[k] || 0;
      this.x += ((this.on ? 1 : 0) - this.x) * xf;
      if (this.x > 1e-4) {
        const p = this.r, i0 = (this.start + (p | 0)) % this.n, i1 = (i0 + 1) % this.n, f = p - (p | 0);
        const edge = Math.min(1, p / 96, (this.len - p) / 96);
        for (let c = 0; c < out.length; c++) { const d = (inp[c] || inp[0] || [])[k] || 0, b = this.buf[c]; out[c][k] = d * (1 - this.x) + (b[i0] + (b[i1] - b[i0]) * f) * edge * this.g * this.x; }
        this.r += this.rate; if (this.r >= this.len) { this.r -= this.len; this.g *= this.decay; }
      } else for (let c = 0; c < out.length; c++) out[c][k] = (inp[c] || inp[0] || [])[k] || 0;
      if (!this.on || this.x < 0.5) this.w = (this.w + 1) % this.n;   // keep listening, but hold still while looping
    }
    return true;
  }
}
registerProcessor('repeat', Repeat);

// ------------------------------------------------------------------------------------------- gate
// A rhythmic chopper locked to the band's bar grid: 16 steps, each open or shut; "pluck" makes open steps decay.
class Gate extends AudioWorkletProcessor {
  constructor() {
    super(); this.p = { steps: [1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 0], depth: 0, smooth: 0.25, pluck: 0, rate: 4, bar0: 0, beatDur: 0.5, playing: false }; this.g = 1;
    this.port.onmessage = (e) => Object.assign(this.p, e.data);
  }
  process(inputs, outputs) {
    const inp = inputs[0], out = outputs[0], n = out[0].length, p = this.p, sr = sampleRate;
    if (p.depth <= 0.001 && Math.abs(this.g - 1) < 1e-4) { for (let c = 0; c < out.length; c++) { const x = inp[c] || inp[0]; if (x) out[c].set(x); else out[c].fill(0); } return true; }
    const stepDur = p.beatDur / p.rate, N = p.steps.length, coef = 1 - Math.exp(-1 / (sr * (0.0015 + p.smooth * p.smooth * stepDur * 0.7)));
    for (let k = 0; k < n; k++) {
      let target = 1;
      if (p.playing && p.depth > 0.001) {
        const ph = (currentTime + k / sr - p.bar0) / stepDur, s = Math.floor(ph), idx = ((s % N) + N) % N;
        target = p.steps[idx] ? 1 - p.depth * p.pluck * (ph - s) : 1 - p.depth;
      }
      this.g += (target - this.g) * coef;
      for (let c = 0; c < out.length; c++) out[c][k] = ((inp[c] || inp[0] || [])[k] || 0) * this.g;
    }
    return true;
  }
}
registerProcessor('gate', Gate);

// ------------------------------------------------------------------------------------------- platter
// A hand on the tape: the last twelve seconds are always on it. Held, the sound is read back at the speed the hand
// turns (either way, or standing still); let go, it crosses back into what is playing now.
class Platter extends AudioWorkletProcessor {
  constructor() { super(); this.n = Math.round(sampleRate * 12); this.b = [new Float32Array(this.n), new Float32Array(this.n)]; this.w = 0; this.full = 0; this.on = false; this.rp = 0; this.r = 0; this.target = 0; this.mix = 0; this.amp = 0;
    this.port.onmessage = ({ data: d }) => { if (d.on !== undefined) { if (d.on && !this.on) { this.rp = 0; this.r = 1; this.target = 0; } this.on = d.on; } if (d.rate !== undefined) this.target = d.rate; }; }
  process(inputs, outputs) {
    const inp = inputs[0], out = outputs[0], N = this.n, oL = out[0], oR = out[1] || oL, len = oL.length, iL = inp[0], iR = inp[1] || iL;
    for (let k = 0; k < len; k++) {
      const x = iL ? iL[k] : 0, y = iR ? iR[k] : 0;
      if (!this.on) { this.b[0][this.w] = x; this.b[1][this.w] = y; this.w = (this.w + 1) % N; if (this.full < N) this.full++; }
      this.mix += ((this.on ? 1 : 0) - this.mix) * 0.003;
      if (this.mix < 0.0005) { oL[k] = x; if (oR !== oL) oR[k] = y; continue; }
      // rp: how far behind the hand is, in samples (0 = the moment it landed)
      this.r += (this.target - this.r) * 0.0022; if (this.on) this.rp = Math.max(1, Math.min(this.full - 4, this.rp - this.r));
      this.amp += (Math.min(1, Math.abs(this.r) * 5) - this.amp) * 0.004;
      let p = this.w - 1 - this.rp; p = ((p % N) + N) % N; const i = p | 0, f = p - i, j = (i + 1) % N;
      const sL = (this.b[0][i] + (this.b[0][j] - this.b[0][i]) * f) * this.amp, sR = (this.b[1][i] + (this.b[1][j] - this.b[1][i]) * f) * this.amp;
      oL[k] = x * (1 - this.mix) + sL * this.mix; if (oR !== oL) oR[k] = y * (1 - this.mix) + sR * this.mix;
    }
    return true;
  }
}
registerProcessor('platter', Platter);
