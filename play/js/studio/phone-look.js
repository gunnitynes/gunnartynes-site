// Look: the song takes the colour of what the phone's camera sees. How light it is darkens or brightens the sound, how
// colourful it is makes it ring. The picture is a few hundred dots, stays on the phone, and is never kept.
import { clamp } from './phone-kit.js';
export class Look extends EventTarget {
  constructor(S) { super(); this.S = S; this.on = false; this.W = 18; this.H = 24; }
  async set(on) {
    if (on === this.on) return; if (!on) { this.on = false; clearInterval(this.t); this.stream?.getTracks().forEach((x) => x.stop()); this.stream = null; this.img = null; this.dispatchEvent(new Event('change')); return; }
    try { this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: 240, height: 320 }, audio: false }); } catch (e) { this.S.say?.(e?.name === 'NotAllowedError' ? 'The camera was not allowed' : 'No camera here'); return; }
    this.video = Object.assign(document.createElement('video'), { muted: true, playsInline: true, srcObject: this.stream }); this.video.setAttribute('playsinline', ''); await this.video.play().catch(() => {});
    this.cv = Object.assign(document.createElement('canvas'), { width: this.W, height: this.H }); this.c = this.cv.getContext('2d', { willReadFrequently: true }); this.x = 0.5; this.y = 0.5; this.on = true; this.t = setInterval(() => this.tick(), 66); this.dispatchEvent(new Event('change'));
  }
  tick() {
    if (!this.video.videoWidth) return; this.c.drawImage(this.video, 0, 0, this.W, this.H); const d = this.c.getImageData(0, 0, this.W, this.H).data; let l = 0, s = 0; const n = this.W * this.H;
    for (let i = 0; i < n * 4; i += 4) { const a = Math.max(d[i], d[i + 1], d[i + 2]), b = Math.min(d[i], d[i + 1], d[i + 2]); l += (d[i] * 3 + d[i + 1] * 6 + d[i + 2]) / 10; s += a ? ((a - b) / a) * Math.min(1, a / 90) : 0; }
    this.img = this.cv; const P = this.S.params, x = clamp((l / n / 255) * 1.35 - 0.05, 0, 1), y = clamp(s / n * 1.5 - 0.1, 0, 1); this.x += (x - this.x) * 0.14; this.y += (y - this.y) * 0.14;
    for (const [k, v] of [['fx.field.x', this.x], ['fx.field.y', this.y]]) { const w = Math.round(v * 50) / 50; if (Math.abs((P.get(k) ?? 0) - w) >= 0.019) P.set(k, w); }
  }
}
