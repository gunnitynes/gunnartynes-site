// Lighter (AAC) cells for phones: how the files are laid out (scripts/light.mjs), and how a cell is cut out of one.
// All lengths are samples at 48 kHz:  silence · chirp · silence · a little of the cell before · THE CELL · a little after
export const LIGHT = { chirpAt: 1024, chirp: 1024, around: 2048, head: 4608, tail: 1536, edge: 96 };

export function chirp(sr) {
  const n = Math.round(LIGHT.chirp * sr / 48000), x = new Float32Array(n);
  for (let i = 0; i < n; i++) { const t = i / sr, T = n / sr; x[i] = Math.sin(2 * Math.PI * (600 * t + (8000 - 600) * t * t / (2 * T))) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1))); }
  return x;
}

let C = null, csr = 0, ce = 0, last = -1;
/** Where the chirp starts in a decoded file (a decoder may add a bit of silence in front), or -1. */
function find(x, sr) {
  if (csr !== sr) { C = chirp(sr); csr = sr; ce = C.reduce((a, v) => a + v * v, 0); last = -1; }
  const n = C.length, at = (o) => { let s = 0, e = 1e-9; for (let i = 0; i < n; i++) { const v = x[o + i]; s += v * C[i]; e += v * v; } return s / Math.sqrt(e * ce); };
  const best = (lo, hi) => { let b = -1, w = 0.8; for (let o = Math.max(0, lo); o <= hi; o++) { const r = at(o); if (r > w) { w = r; b = o; } } return b; };
  // every file comes back with the same amount in front: look there first
  if (last >= 0) { const b = best(last - 2, last + 2); if (b >= 0) return (last = b); }
  const b = best(0, Math.min(x.length - n, Math.round(0.2 * sr)));
  if (b >= 0) last = b;
  return b;
}

// The first and last moments of every cell are kept exactly (16 bit, at the end of the file in a box decoders skip): the
// cell blends into them, so one cell runs into the next without the smallest step.
const MARK = 0x4c454447;   // 'LEDG'
/** The exact edges in a file's bytes (read before it is decoded), or null. */
export function edges(ab) {
  const len = LIGHT.edge * 8, size = 12 + len, v = new DataView(ab), at = ab.byteLength - size;
  if (at < 0 || v.getUint32(at) !== size || v.getUint32(at + 8) !== MARK) return null;
  const x = new Int16Array(LIGHT.edge * 4); for (let i = 0; i < x.length; i++) x[i] = v.getInt16(at + 12 + i * 2, true);
  return x;   // L R L R …: the beginning, then the end
}
/** That box, for the bytes of a cell's samples (interleaved stereo). */
export function edgeBox(x) {
  const E = LIGHT.edge, b = new Uint8Array(12 + E * 8), v = new DataView(b.buffer);
  v.setUint32(0, b.length); v.setUint32(4, 0x66726565); v.setUint32(8, MARK);   // 'free'
  for (let i = 0; i < E * 2; i++) { v.setInt16(12 + i * 2, x[i], true); v.setInt16(12 + (E * 2 + i) * 2, x[x.length - E * 2 + i], true); }
  return b;
}

/** The cell itself, to the sample: `dur` seconds of it. Throws when the file is not one of ours. */
export function cutLight(ctx, buf, dur, edge = null) {
  const sr = buf.sampleRate, o = find(buf.getChannelData(0), sr);
  if (o < 0) throw new Error('no chirp');
  const start = o + Math.round((LIGHT.head - LIGHT.chirpAt) * sr / 48000), n = Math.round(dur * sr);
  if (start + n > buf.length + 8) throw new Error('too short');
  const out = ctx.createBuffer(buf.numberOfChannels, n, sr);
  for (let c = 0; c < buf.numberOfChannels; c++) out.copyToChannel(buf.getChannelData(c).subarray(start, start + n), c);
  if (edge && sr === 48000) for (let c = 0; c < out.numberOfChannels; c++) {
    const x = out.getChannelData(c), E = LIGHT.edge;
    for (let k = 0; k < E; k++) {
      const g = Math.max(0, Math.min(1, (E - k) / (E - 32)));   // all of it for the last 32 samples, then over to the cell
      x[k] += (edge[k * 2 + c] / 32768 - x[k]) * g;
      const j = n - 1 - k; x[j] += (edge[(E * 2 - 1 - k) * 2 + c] / 32768 - x[j]) * g;
    }
  }
  return out;
}
