// Time-stretching without changing pitch (WSOLA), in a worker so the page never stutters while cells are warped.
// Message in: { id, chans: [Float32Array…], alpha } where alpha = new length / old length. Out: { id, chans }.
// Each output frame (2048 samples, 75% overlap, Hann) is taken from near where it nominally belongs in the input,
// nudged up to ±512 samples to where it best continues the frame before it — so the waveform keeps its shape.
const N = 2048, HS = 512, TOL = 512;
const win = new Float32Array(N); for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);

function stretch(chans, alpha) {
  const L = chans[0].length, Lo = Math.round(L * alpha), C = chans.length;
  const mono = new Float32Array(L); for (const ch of chans) for (let i = 0; i < L; i++) mono[i] += ch[i] / C;
  const out = chans.map(() => new Float32Array(Lo + N)), wsum = new Float32Array(Lo + N);
  const corr = (a, b, step) => { let s = 0; for (let i = 0; i < N / 2; i += step) s += mono[a + i] * mono[b + i]; return s; };
  let prev = 0;
  for (let k = 0; k * HS < Lo; k++) {
    const nominal = Math.round((k * HS) / alpha);
    let pos = Math.min(Math.max(0, nominal), Math.max(0, L - N));
    if (k > 0) {
      const target = prev + HS;
      if (target + N / 2 < L) {
        const lo = Math.max(0, nominal - TOL), hi = Math.min(L - N, nominal + TOL);
        let best = pos, bv = -Infinity;
        for (let p = lo; p <= hi; p += 8) { const v = corr(target, p, 4); if (v > bv) { bv = v; best = p; } }
        const lo2 = Math.max(0, best - 8), hi2 = Math.min(L - N, best + 8);
        for (let p = lo2; p <= hi2; p++) { const v = corr(target, p, 2); if (v > bv) { bv = v; best = p; } }
        if (hi >= lo) pos = best;
      }
    }
    const o = k * HS;
    for (let c = 0; c < C; c++) { const src = chans[c], dst = out[c]; for (let i = 0; i < N && pos + i < L; i++) dst[o + i] += src[pos + i] * win[i]; }
    for (let i = 0; i < N; i++) wsum[o + i] += win[i];
    prev = pos;
  }
  return out.map((d) => { const r = new Float32Array(Lo); for (let i = 0; i < Lo; i++) r[i] = wsum[i] > 1e-3 ? d[i] / wsum[i] : 0; return r; });
}

onmessage = ({ data }) => {
  const chans = stretch(data.chans, data.alpha);
  postMessage({ id: data.id, chans }, chans.map((c) => c.buffer));
};
