// The audio graph. Every track gets a Channel; the master bus runs through the WEATHER (filter, storm sends,
// crusher) and a glue/limit stage. A Tap on the master records takes; a second Tap records the microphone.
import { encodeWav } from '../lib/wav.js';

export const SR = 48000;

export class Channel {
  constructor(eng, id) {
    const c = eng.ctx;
    this.id = id;
    this.input = c.createGain();
    this.fader = c.createGain();
    this.lp = c.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 20000; this.lp.Q.value = 0.5;
    this.pan = c.createStereoPanner();
    this.revSend = c.createGain(); this.revSend.gain.value = 0;
    this.dlySend = c.createGain(); this.dlySend.gain.value = 0;
    this.meter = c.createAnalyser(); this.meter.fftSize = 512;
    this.input.connect(this.fader).connect(this.lp).connect(this.pan);
    this.pan.connect(eng.bus); this.pan.connect(this.revSend).connect(eng.revIn); this.pan.connect(this.dlySend).connect(eng.dlyIn);
    this.pan.connect(this.meter);
    this.buf = new Float32Array(512);
    this.level = 0;
  }
  set(p, t, tc = 0.03) {
    // only touch params that actually moved, so a 20 Hz stream of orb drags doesn't pile up automation events
    this.last ??= {};
    const go = (k, param, v) => { if (v === undefined || this.last[k] === v) return; this.last[k] = v; param.setTargetAtTime(v, t, tc); };
    go('gain', this.fader.gain, p.gain);
    go('pan', this.pan.pan, p.pan === undefined ? undefined : Math.max(-1, Math.min(1, p.pan)));
    go('lp', this.lp.frequency, p.lp === undefined ? undefined : 80 * 250 ** p.lp); // lp 0..1 → 80 Hz..20 kHz
    go('rev', this.revSend.gain, p.rev);
    go('dly', this.dlySend.gain, p.dly);
  }
  readLevel() {
    this.meter.getFloatTimeDomainData(this.buf);
    let s = 0; for (let i = 0; i < this.buf.length; i++) s += this.buf[i] * this.buf[i];
    const rms = Math.sqrt(s / this.buf.length);
    this.level = Math.max(rms, this.level * 0.86);
    return this.level;
  }
  dispose() { for (const n of [this.input, this.fader, this.lp, this.pan, this.revSend, this.dlySend]) n.disconnect(); }
}

function makeIR(ctx, seconds) {
  const len = Math.round(seconds * ctx.sampleRate);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch); let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / ctx.sampleRate;
      const k = 0.08 + 0.9 * Math.min(1, t / seconds); // the tail darkens as it decays, like a fjord, not a tile room
      lp += (Math.random() * 2 - 1 - lp) * (1 - k);
      d[i] = lp * Math.exp(-t * 6.9 / seconds) * (i < 0.012 * ctx.sampleRate ? i / (0.012 * ctx.sampleRate) : 1);
    }
  }
  return ir;
}

export class AudioEngine {
  constructor() {
    this.ctx = new AudioContext({ sampleRate: SR, latencyHint: 'interactive' });
    this.channels = new Map();
    this.ready = this.init();
  }

  async init() {
    const c = this.ctx;
    await c.audioWorklet.addModule(new URL('./worklets.js', import.meta.url));
    const g = (v = 1) => { const n = c.createGain(); n.gain.value = v; return n; };

    this.bus = g();            // sum of all tracks
    this.post = g();           // bus + fx returns
    this.bus.connect(this.post);

    // fjord reverb
    this.revIn = g(); this.reverb = c.createConvolver(); this.reverb.buffer = makeIR(c, 3.6);
    this.revOut = g(0.85);
    this.revIn.connect(this.reverb).connect(this.revOut).connect(this.post);

    // tempo ping-pong delay with a filtered feedback loop
    this.dlyIn = g(); this.dlyGate = g(1);
    this.dL = c.createDelay(4); this.dR = c.createDelay(4);
    this.fb = g(0.42);
    this.fbHP = c.createBiquadFilter(); this.fbHP.type = 'highpass'; this.fbHP.frequency.value = 260;
    this.fbLP = c.createBiquadFilter(); this.fbLP.type = 'lowpass'; this.fbLP.frequency.value = 5200;
    const merge = c.createChannelMerger(2); this.dlyOut = g(0.8);
    this.dlyIn.connect(this.dlyGate).connect(this.dL);
    this.dL.connect(this.dR); this.dR.connect(this.fbHP).connect(this.fbLP).connect(this.fb).connect(this.dL);
    this.dL.connect(merge, 0, 0); this.dR.connect(merge, 0, 1);
    merge.connect(this.dlyOut).connect(this.post);

    // weather sends straight off the bus
    this.wxRev = g(0); this.wxDly = g(0);
    this.bus.connect(this.wxRev).connect(this.revIn);
    this.bus.connect(this.wxDly).connect(this.dlyIn);

    // weather on the master
    this.lp = c.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 20000; this.lp.Q.value = 0.9;
    this.hp = c.createBiquadFilter(); this.hp.type = 'highpass'; this.hp.frequency.value = 18; this.hp.Q.value = 0.9;
    this.crusher = new AudioWorkletNode(c, 'crusher', { outputChannelCount: [2] });
    this.glue = c.createDynamicsCompressor();
    this.glue.threshold.value = -14; this.glue.ratio.value = 2.2; this.glue.attack.value = 0.02; this.glue.release.value = 0.25; this.glue.knee.value = 8;
    this.limit = c.createDynamicsCompressor();
    this.limit.threshold.value = -2; this.limit.ratio.value = 20; this.limit.attack.value = 0.001; this.limit.release.value = 0.12; this.limit.knee.value = 0;
    this.master = g(0.9);
    this.analyser = c.createAnalyser(); this.analyser.fftSize = 2048; this.analyser.smoothingTimeConstant = 0.8;
    this.post.connect(this.lp).connect(this.hp).connect(this.crusher).connect(this.glue).connect(this.limit).connect(this.master);
    this.master.connect(this.analyser);
    this.master.connect(c.destination);

    this.tap = new AudioWorkletNode(c, 'tap', { numberOfInputs: 1, numberOfOutputs: 0 });
    this.master.connect(this.tap);
    this.setTempo(120);
  }

  setTempo(bpm) {
    const beat = 60 / bpm;
    this.dL.delayTime.value = beat * 0.75; this.dR.delayTime.value = beat * 0.75; // dotted eighths, ping → pong
  }

  channel(id) {
    let ch = this.channels.get(id);
    if (!ch) { ch = new Channel(this, id); this.channels.set(id, ch); }
    return ch;
  }
  dropChannel(id) { this.channels.get(id)?.dispose(); this.channels.delete(id); }

  /** weather: x ∈ [-1,1] cold(lowpass)…warm(highpass); y ∈ [0,1] calm…storm. */
  setWeather({ x = 0, y = 0, freeze = false }) {
    const t = this.ctx.currentTime, tc = 0.06;
    const cold = Math.max(0, -x), warm = Math.max(0, x);
    this.lp.frequency.setTargetAtTime(20000 * (1 - cold) ** 3.2 + 140 * cold, t, tc);
    this.lp.Q.setTargetAtTime(0.7 + cold * 6, t, tc);
    this.hp.frequency.setTargetAtTime(18 + 2200 * warm ** 2.4, t, tc);
    this.hp.Q.setTargetAtTime(0.7 + warm * 5, t, tc);
    this.wxRev.gain.setTargetAtTime(y * 0.55, t, tc);
    this.wxDly.gain.setTargetAtTime(y > 0.25 ? (y - 0.25) * 0.7 : 0, t, tc);
    this.fb.gain.setTargetAtTime(freeze ? 0.995 : 0.38 + y * 0.32, t, tc);
    this.dlyGate.gain.setTargetAtTime(freeze ? 0 : 1, t, 0.01);
    const storm = Math.max(0, (y - 0.72) / 0.28);
    this.crusher.parameters.get('mix').setValueAtTime(storm, t);
    this.crusher.parameters.get('bits').setValueAtTime(16 - storm * 11, t);
    this.crusher.parameters.get('down').setValueAtTime(1 + storm * 18, t);
  }

  /** Thunder: a one-bar delay throw + reverb swell. */
  thunder(at, barDur) {
    const a = at ?? this.ctx.currentTime;
    for (const [p, peak] of [[this.wxDly.gain, 0.9], [this.wxRev.gain, 0.8]]) {
      const base = p.value;
      p.cancelScheduledValues(a); p.setValueAtTime(base, a); p.linearRampToValueAtTime(peak, a + 0.03);
      p.setValueAtTime(peak, a + barDur * 0.5); p.linearRampToValueAtTime(base, a + barDur);
    }
  }

  meterLevel(buf) {
    this.analyser.getFloatTimeDomainData(buf);
    let pk = 0; for (let i = 0; i < buf.length; i++) pk = Math.max(pk, Math.abs(buf[i]));
    return pk;
  }

  /** Record the master from an exact ctx frame. Returns {stop(atFrame) → Promise<{wav:Blob, seconds}>}. */
  recordMaster(startFrame) { return recordTap(this.tap, startFrame); }

  /** Microphone in → its own tap. Resolves to the same recorder interface. */
  async openMic() {
    if (this.mic) return this.mic;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    const src = this.ctx.createMediaStreamSource(stream);
    const tap = new AudioWorkletNode(this.ctx, 'tap', { numberOfInputs: 1, numberOfOutputs: 0 });
    const monitor = this.ctx.createAnalyser(); monitor.fftSize = 1024;
    src.connect(tap); src.connect(monitor);
    this.mic = { stream, tap, monitor, record: (f) => recordTap(tap, f), close: () => { stream.getTracks().forEach((t) => t.stop()); src.disconnect(); this.mic = null; } };
    return this.mic;
  }

  /** Input + output latency estimate, used to line mic takes up with what the player heard. */
  roundTrip() { return (this.ctx.baseLatency || 0) + (this.ctx.outputLatency || 0.02) + 0.01; }
}

function recordTap(tap, startFrame) {
  const chunks = []; let frames = 0; let resolveDone;
  const done = new Promise((r) => { resolveDone = r; });
  tap.port.onmessage = (e) => {
    if (e.data.chunk) { chunks.push(...e.data.chunk); frames += e.data.n; }
    if (e.data.done) resolveDone();
  };
  tap.port.postMessage({ cmd: 'start', startFrame });
  return {
    get seconds() { return frames / SR; },
    async stop(stopFrame) {
      tap.port.postMessage({ cmd: 'stop', stopFrame });
      await done;
      const L = new Float32Array(frames), R = new Float32Array(frames); let o = 0;
      for (const [l, r] of chunks) { L.set(l, o); R.set(r, o); o += l.length; }
      return { L, R, seconds: frames / SR, wav: () => encodeWav([L, R], SR) };
    },
  };
}
