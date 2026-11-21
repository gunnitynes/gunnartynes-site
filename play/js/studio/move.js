// The phone's body modes.
//  Walk : the motion sensors count your steps; the song's tempo follows your pace (warped, pitch kept). Stand
//         still and the stems sink back while the Cloud holds a drone; walk on and they come back.
//  Turn : the stems stand in a circle around you (3D sound for headphones). Turn, and the band turns; the one
//         you face comes forward, and if you keep facing it for a moment you hear it almost alone.

// ------------------------------------------------------------------------------------------------ walk
export class Walk extends EventTarget {
  constructor(S) {
    super(); this.S = S; this.on = false; this.spm = 0; this.steps = []; this.mean = 9.81; this.s = 0; this.armed = true; this.peak = 2;
    this.lastStep = 0; this.lastSet = 0; this.still = true; this.was = null; this.count = 0;
    addEventListener('devicemotion', (e) => this.motion(e));
    setInterval(() => this.tick(), 250);
  }
  set(on) {
    this.on = on; this.steps = []; this.spm = 0; this.count = 0;
    if (on) { this.bpm0 = this.bpm; if (!this.S.player.playing) this.S.player.play(); this.rest(true); }
    else { this.rest(false); this.S.params.set('song.bpm', this.bpm0 ?? this.S.song.bpm, { by: 'ui' }); }
    this.emit();
  }
  /** One step, from outside (a tap on the step pad, for a phone without sensors or to set the pace by hand). */
  step(now = performance.now()) {
    if (now - this.lastStep < 260) return;
    const dt = now - this.lastStep; this.lastStep = now; this.count++;
    if (dt < 1600) { this.steps.push(dt); if (this.steps.length > 8) this.steps.shift(); }
    if (this.steps.length >= 3) { const s = [...this.steps].sort((a, b) => a - b); this.spm = 60000 / s[s.length >> 1]; }
    if (this.still && this.steps.length >= 2) this.rest(false);
    this.emit();
  }
  motion(e) {
    if (!this.on) return;
    const g = e.accelerationIncludingGravity; if (!g || g.x == null) return;
    const m = Math.hypot(g.x, g.y, g.z);
    this.mean += (m - this.mean) * 0.02;                 // gravity, slowly
    this.s += (m - this.mean - this.s) * 0.3;            // the bounce of a step, smoothed
    const thr = Math.max(0.9, this.peak * 0.45);
    if (this.armed && this.s > thr) { this.armed = false; this.peak += (this.s - this.peak) * 0.2; this.step(); }
    else if (this.s > this.peak * 0.5 && !this.armed) this.peak = Math.max(this.peak, this.s);
    if (this.s < 0) this.armed = true;
  }
  /** The tempo a pace asks for: the pace itself, or half or double it, whichever lies nearest the song's. */
  tempoOf(spm) { const b = this.S.song.bpm; let best = spm, bd = Infinity; for (const k of [0.5, 1, 2]) { const v = spm * k, d = Math.abs(Math.log(v / b)); if (d < bd) { bd = d; best = v; } } return Math.max(b * 0.55, Math.min(b * 1.6, best)); }
  get bpm() { return this.S.params.get('song.bpm'); }
  tick() {
    if (!this.on) return;
    const now = performance.now();
    if (!this.still && now - this.lastStep > 2600) { this.rest(true); this.emit(); return; }
    if (this.still || !this.spm) return;
    const want = Math.round(this.tempoOf(this.spm) / 2) * 2, cur = this.bpm;
    // follow in steps of 2 BPM, at most every 1.5 s: each change re-cuts the stems on the beat
    if (Math.abs(want - cur) >= 2 && now - this.lastSet > 1500) { this.lastSet = now; this.S.params.set('song.bpm', cur + Math.sign(want - cur) * Math.min(Math.abs(want - cur), 8), { by: 'ui' }); this.emit(); }
  }
  /** Standing still: the stems sink back and the Cloud holds a drone. Walking: as you had it. */
  rest(still) {
    const P = this.S.params; this.still = still;
    if (still && this.on) { if (!this.was) { this.was = { level: P.get('band.level'), drone: P.get('cloud.drone') }; P.set('band.level', Math.min(this.was.level, 0.3)); P.set('cloud.drone', true); } }
    else if (this.was) { P.set('band.level', this.was.level); P.set('cloud.drone', this.was.drone); this.was = null; }
  }
  emit() { this.dispatchEvent(new Event('change')); }
}

// ------------------------------------------------------------------------------------------------ turn
export class Surround extends EventTarget {
  constructor(S) {
    super(); this.S = S; this.on = false; this.heading = 0; this.h0 = null; this.face = null; this.dwell = 0; this.alone = null; this.t = 0;
    addEventListener('deviceorientation', (e) => this.orient(e));
  }
  /** The stems in the circle: those with something in them, evenly round. */
  get ring() { return this.S.song.stems.filter((s) => s.cells.some(Boolean)); }
  set(on) {
    this.on = on; this.h0 = null; this.alone = null; this.face = null;
    const ring = this.ring, eng = this.S.engine;
    this.az = new Map(ring.map((st, i) => [st.id, (i / ring.length) * Math.PI * 2]));
    for (const st of this.S.song.stems) { const ch = eng.channel(st.id); ch.spatial(on && this.az.has(st.id), this.az.get(st.id) || 0); }
    if (on && !this.S.player.playing) this.S.player.play();
    this.turn(this.heading); this.emit();
  }
  orient(e) {
    if (!this.on) return;
    let h = e.webkitCompassHeading; if (h == null) { if (e.alpha == null) return; h = 360 - e.alpha; }
    if (this.h0 === null) this.h0 = h;
    this.turn(((h - this.h0) * Math.PI) / 180);
  }
  /** Face this way (radians, clockwise from where you stood when Turn went on). */
  turn(rad) {
    this.heading = rad;
    const L = this.S.ctx.listener, t = this.S.ctx.currentTime, fx = Math.sin(rad), fz = -Math.cos(rad);
    if (L.forwardX) { L.forwardX.setTargetAtTime(fx, t, 0.03); L.forwardY.setTargetAtTime(0, t, 0.03); L.forwardZ.setTargetAtTime(fz, t, 0.03); L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; }
    else L.setOrientation?.(fx, 0, fz, 0, 1, 0);
  }
  /** Called every frame: who is in front, how long you have faced them, and the gains that follow. */
  frame(dt) {
    if (!this.on || !this.az) return;
    let face = null, fd = Infinity; const d = new Map();
    for (const [id, a] of this.az) { let x = Math.abs(((a - this.heading) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI); d.set(id, x); if (x < fd) { fd = x; face = id; } }
    if (face !== this.face) { this.face = face; this.dwell = 0; this.emit(); }
    this.dwell = fd < 0.3 ? this.dwell + dt : 0;
    if (!this.alone && this.dwell > 2.2) { this.alone = face; this.emit(); try { navigator.vibrate?.(30); } catch { /* none */ } }
    if (this.alone && (d.get(this.alone) ?? 9) > 0.55) { this.alone = null; this.emit(); }
    if ((this.t += dt) < 0.05) return; this.t = 0;
    const now = this.S.ctx.currentTime;
    for (const [id, x] of d) {
      const ch = this.S.engine.channels.get(id); if (!ch?.focus) continue;
      const g = this.alone ? (id === this.alone ? 1.5 : 0.1) : 0.6 + 0.9 * Math.exp(-((x / 0.55) ** 2));
      ch.focus.gain.setTargetAtTime(g, now, 0.12);
    }
  }
  get progress() { return this.alone ? 1 : Math.min(1, this.dwell / 2.2); }
  emit() { this.dispatchEvent(new Event('change')); }
}
