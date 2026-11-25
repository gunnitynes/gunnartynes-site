// The field of Process: the whole song, with the song as it is in the middle and four treatments of it in the corners. Two
// numbers (fx.field.x, fx.field.y) say where the point is, so a recording, the tilt of the phone and the camera move them and
// nothing else; everything the treatments are made of follows from them. Used on the phone; the computer plays it too.
import { clamp } from './phone-kit.js';

const pct = (v) => Math.round(v * 100);
/** What the field moves: [path, name, how to say it, min, max, ·, where it stands when the song is as it is]. */
export const ARMS = [
  ['fx.filter.lp', 'Tone', pct, 0, 1, 0, 1], ['fx.filter.hp', 'Thin', pct, 0, 1, 0, 0], ['fx.filter.q', 'Peak', pct, 0, 1, 0, 0.15], ['fx.filter.lfo', 'Sweep', pct, 0, 1, 0, 0],
  ['fx.tape.mix', 'Tape', pct, 0, 1, 0, 0], ['fx.tape.wow', 'Wow', pct, 0, 1, 0, 0.4], ['fx.res.mix', 'Ring', pct, 0, 1, 0, 0], ['fx.shim.mix', 'Shimmer', pct, 0, 1, 0, 0],
  ['fx.shim.rise', 'Rise', pct, 0, 1, 0, 0.35], ['fx.echo.mix', 'Echo', pct, 0, 1, 0, 0], ['fx.echo.fb', 'Repeats', pct, 0, 1, 0, 0.45], ['fx.ens.mix', 'Ensemble', pct, 0, 1, 0, 0],
];
const REST = ARMS.map((a) => a[6]);
//              Tone  Thin  Peak  Swp   Tape  Wow   Ring  Shim  Rise  Echo  Rep   Ens     (top left, top right, bottom left, bottom right)
export const CORNERS = [
  ['glass', [1, 0.22, 0.15, 0, 0, 0.4, 0.5, 0.45, 0.35, 0.35, 0.55, 0]],
  ['sky', [0.92, 0.3, 0.15, 0, 0.1, 0.4, 0.1, 0.85, 0.6, 0.35, 0.5, 0.3]],
  ['deep', [0.42, 0, 0.25, 0, 0.2, 0.3, 0.05, 0.3, 0.2, 0.2, 0.55, 0.5]],
  ['worn', [0.72, 0.4, 0.1, 0, 0.7, 0.95, 0, 0.1, 0.2, 0.08, 0.3, 0.2]],
];
/** Defines the point; corners() → the four [{ n, v }] in use. Returns run(), which sets everything from where the point is. */
export function defineField(P, corners) {
  const run = () => {
    const x = P.get('fx.field.x'), y = 1 - P.get('fx.field.y'), far = clamp((Math.max(Math.abs(2 * x - 1), Math.abs(2 * y - 1)) - 0.05) / 0.95, 0, 1), w = [(1 - x) * (1 - y), x * (1 - y), (1 - x) * y, x * y], cs = corners();
    ARMS.forEach(([p], i) => { let v = 0; for (let c = 0; c < 4; c++) v += w[c] * (cs[c].v[i] ?? REST[i]); v = +clamp(REST[i] + (v - REST[i]) * far, 0, 1).toFixed(3); if (Math.abs((P.get(p) ?? 0) - v) > 0.002) P.set(p, v, { by: 'macro' }); });
  };
  P.define('fx.field.x', 0.5); P.define('fx.field.y', 0.5); (P.range ??= {}); Object.assign(P.range, { 'fx.field.x': [0, 1, 'Process across'], 'fx.field.y': [0, 1, 'Process up'] });
  P.on(({ path, by }) => { if (by !== 'load' && path.startsWith('fx.field.')) run(); });
  return run;
}
export const fresh = () => CORNERS.map(([n, v]) => ({ n, v: [...v] }));
export const standing = (P) => ARMS.map(([p]) => clamp(P.get(p) ?? 0, 0, 1));
