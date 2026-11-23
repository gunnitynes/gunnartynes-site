// What every bar of every stem sounds like (measured ahead of time by scripts/features.mjs): its pitch classes,
// its rhythm in sixteenths, how bright, how noisy and how loud. The band's answers, the Atlas and the endless
// version read it; without the file those features simply stay off.
export async function loadFeatures(S) {
  try {
    const r = await fetch(`media/songs/${S.song.id}/features.json`);
    if (!r.ok) return null;
    const f = await r.json(); S.feat = f; return f;
  } catch { return null; }
}
export const cos = (a, b) => { let d = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; } return x && y ? d / Math.sqrt(x * y) : 0; };
/** Rotate a 12-step pitch-class profile by n semitones. */
export const rot = (c, n) => c.map((_, i) => c[(((i - n) % 12) + 12) % 12]);
/** The whole band at one bar of the song: its pitch classes, rhythm, colour and how many play. */
export function bandBar(S, bar) {
  const f = S.feat; if (!f) return null;
  const c = new Array(12).fill(0), o = new Array(16).fill(0); let b = 0, n = 0;
  for (const rows of Object.values(f.stems)) { const x = rows[bar]; if (!x || x.d < -45) continue; const w = 10 ** (x.d / 20); x.c.forEach((v, i) => { c[i] += v * w; }); x.o.forEach((v, i) => { o[i] += v * w; }); b += x.b; n++; }
  return { c, o, b: n ? b / n : 0, n };
}
