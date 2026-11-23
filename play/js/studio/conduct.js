// Conduct with your hands. The camera's picture is shrunk to a few hundred dots and compared frame to frame: where
// something moves, and how much. That is enough to conduct with, with no model to download and nothing leaving the
// computer:
//   · how high your movement is      → how loud the stems are
//   · left to right                   → darker to brighter
//   · how much you move               → how wide the Cloud sprays its grains
//   · your downbeats (a hand dropping and turning back up), with "Tempo from my beats" on → the tempo, on the bar line
// While Record is on, all of it is written onto the arrangement like any other move.
const W = 64, H = 48;

export class Conduct extends EventTarget {
  constructor(S) { super(); this.S = S; this.on = false; this.tempo = false; this.level = 0; this.x = 0.5; this.y = 0.5; this.amt = 0; this.bpm = 0; }
  async set(on) {
    if (on === this.on) return;
    if (!on) { this.on = false; clearInterval(this.timer); this.stream?.getTracks().forEach((t) => t.stop()); this.stream = null; this.emit(); return; }
    try { this.stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240, facingMode: 'user' }, audio: false }); }
    catch (e) { this.S.say?.(e?.name === 'NotAllowedError' ? 'The camera was not allowed' : 'No camera here'); return; }
    this.video = Object.assign(document.createElement('video'), { muted: true, playsInline: true, srcObject: this.stream }); await this.video.play().catch(() => {});
    this.cv = Object.assign(document.createElement('canvas'), { width: W, height: H }); this.cx = this.cv.getContext('2d', { willReadFrequently: true });
    this.prev = null; this.beats = []; this.vy = 0; this.lastY = null; this.down = false; this.lastSet = 0; this.on = true;
    const P = this.S.params; this.base = { level: P.get('band.level'), lp: P.get('fx.filter.lp'), spread: P.get('cloud.spread') };
    this.timer = setInterval(() => this.tick(), 33);
    if (!this.S.player.playing) this.S.player.play();
    this.emit();
  }
  tick() {
    const c = this.cx; c.save(); c.translate(W, 0); c.scale(-1, 1); c.drawImage(this.video, 0, 0, W, H); c.restore();   // a mirror: your right is the screen's right
    const px = c.getImageData(0, 0, W, H).data, lum = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) lum[i] = (px[4 * i] * 3 + px[4 * i + 1] * 6 + px[4 * i + 2]) / 10;
    this.frame = lum;
    if (!this.prev) { this.prev = lum; return; }
    let n = 0, sx = 0, sy = 0; const mask = (this.mask ??= new Uint8Array(W * H));
    for (let i = 0; i < W * H; i++) { const m = Math.abs(lum[i] - this.prev[i]) > 22; mask[i] = m; if (m) { n++; sx += i % W; sy += (i / W) | 0; } }
    this.prev = lum;
    const amt = n / (W * H); this.amt += (amt - this.amt) * 0.25;
    if (n < 18) { this.lastY = null; return; }   // nothing is moving: everything stays where you left it
    const x = sx / n / W, y = sy / n / H;
    this.x += (x - this.x) * 0.2; this.y += (y - this.y) * 0.2;
    const P = this.S.params, set = (k, v, step) => { v = Math.round(v / step) * step; if (Math.abs((P.get(k) ?? 0) - v) >= step) P.set(k, +v.toFixed(3)); };
    set('band.level', 0.15 + 0.85 * Math.max(0, Math.min(1, 1.15 - this.y * 1.2)), 0.02);
    set('fx.filter.lp', 0.45 + 0.55 * Math.max(0, Math.min(1, this.x * 1.3 - 0.1)), 0.02);
    set('cloud.spread', Math.min(0.5, 0.04 + this.amt * 3), 0.01);
    // a downbeat: the movement was travelling down and turns back up
    if (this.lastY !== null) {
      const vy = y - this.lastY; this.vy += (vy - this.vy) * 0.5;
      if (this.vy > 0.012) this.down = true;
      else if (this.down && this.vy < -0.004) { this.down = false; this.beat(); }
    }
    this.lastY = y;
  }
  beat() {
    const t = performance.now(); this.beats = [...this.beats.filter((b) => t - b < 6000), t];
    this.emit('beat');
    if (!this.tempo || this.beats.length < 4) return;
    const iv = this.beats.slice(1).map((b, i) => b - this.beats[i]).filter((d) => d > 280 && d < 1500).sort((a, b) => a - b);
    if (iv.length < 3) return;
    let bpm = 60000 / iv[iv.length >> 1]; const song = this.S.song.bpm;
    for (const k of [0.5, 2]) if (Math.abs(Math.log((bpm * k) / song)) < Math.abs(Math.log(bpm / song))) bpm *= k;
    bpm = Math.round(Math.max(song * 0.6, Math.min(song * 1.6, bpm)) / 2) * 2; this.bpm = bpm;
    const P = this.S.params, cur = P.get('song.bpm');
    if (Math.abs(bpm - cur) >= 2 && t - this.lastSet > this.S.player.barDur * 1000) { this.lastSet = t; P.set('song.bpm', bpm, { by: 'ui' }); }
  }
  /** Draw what the camera sees as moving dots, for the panel. */
  draw(g, w, hh) {
    g.clearRect(0, 0, w, hh); if (!this.frame) return;
    const dx = w / W, dy = hh / H;
    for (let i = 0; i < W * H; i++) { const v = this.frame[i] / 255; g.fillStyle = this.mask?.[i] ? '#e6b450' : `rgba(236,232,220,${(v * 0.35).toFixed(2)})`; g.fillRect((i % W) * dx, ((i / W) | 0) * dy, dx - 0.5, dy - 0.5); }
    g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.beginPath(); g.arc(this.x * w, this.y * hh, 7, 0, 7); g.stroke();
  }
  emit(type = 'change') { this.dispatchEvent(new Event(type)); }
}
