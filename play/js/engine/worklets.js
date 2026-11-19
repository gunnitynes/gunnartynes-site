// AudioWorklet processors. Loaded once by the engine.

// Bit + sample-rate reduction for the "storm" end of the weather pad.
class Crusher extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'bits', defaultValue: 16, minValue: 1, maxValue: 16, automationRate: 'k-rate' },
      { name: 'down', defaultValue: 1, minValue: 1, maxValue: 64, automationRate: 'k-rate' },
      { name: 'mix', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }
  constructor() { super(); this.hold = [0, 0]; this.phase = 0; }
  process(inputs, outputs, p) {
    const inp = inputs[0], out = outputs[0];
    if (!inp.length) return true;
    const mix = p.mix[0];
    if (mix <= 0.0001) { for (let c = 0; c < out.length; c++) out[c].set(inp[c] ?? inp[0]); return true; }
    const q = 2 ** (p.bits[0] - 1), down = p.down[0];
    for (let i = 0; i < out[0].length; i++) {
      if ((this.phase += 1) >= down) { this.phase -= down; for (let c = 0; c < out.length; c++) this.hold[c] = Math.round((inp[c] ?? inp[0])[i] * q) / q; }
      for (let c = 0; c < out.length; c++) { const x = (inp[c] ?? inp[0])[i]; out[c][i] = x + (this.hold[c] - x) * mix; }
    }
    return true;
  }
}
registerProcessor('crusher', Crusher);

// A tap that streams audio to the main thread while armed, starting at an exact frame so a take
// begins precisely on a bar line. Also used for the microphone ("record over the band").
class Tap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.armed = false; this.startFrame = 0; this.stopFrame = Infinity; this.chunk = []; this.n = 0;
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.cmd === 'start') { this.armed = true; this.startFrame = m.startFrame ?? currentFrame; this.stopFrame = Infinity; }
      if (m.cmd === 'stop') { this.stopFrame = m.stopFrame ?? currentFrame; }
    };
  }
  flush(done) {
    if (this.n) this.port.postMessage({ chunk: this.chunk, n: this.n });
    this.chunk = []; this.n = 0;
    if (done) { this.armed = false; this.port.postMessage({ done: true }); }
  }
  process(inputs) {
    const inp = inputs[0];
    if (!this.armed) return true;
    const len = 128, f0 = currentFrame;
    let s = Math.max(0, this.startFrame - f0), e = Math.min(len, this.stopFrame - f0);
    if (e > s && inp.length) {
      const l = inp[0].slice(s, e), r = (inp[1] ?? inp[0]).slice(s, e);
      this.chunk.push([l, r]); this.n += e - s;
      if (this.n >= 16384) this.flush(false);
    }
    if (f0 + len >= this.stopFrame) this.flush(true);
    return true;
  }
}
registerProcessor('tap', Tap);
