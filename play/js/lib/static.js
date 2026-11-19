// Static mode: the playground running as plain files (on gunnartynes.com/play/), with no server behind it.
// Turned on by `window.PG_STATIC = true` in the exported pages (scripts/export-static.mjs).
//  - songs come from api/*.json written at export time
//  - a shared take is not stored anywhere: its moves are compressed into the link itself
//  - a sound you add (mic or file) is fitted to the band right here in the browser and stays on this device
import { encodeWav } from './wav.js';

export const STATIC = typeof window !== 'undefined' && !!window.PG_STATIC;
const SR = 48000;
let lastSong = null;

// ---------------------------------------------------------------- takes in the link
const b64u = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64u = (s) => { const b = atob(s.replace(/-/g, '+').replace(/_/g, '/')); const out = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i); return out; };
async function squeeze(obj) {
  const stream = new Blob([JSON.stringify(obj)]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return 'z' + b64u(new Uint8Array(await new Response(stream).arrayBuffer()));
}
async function unsqueeze(id) {
  if (!id.startsWith('z')) throw new Error('That take link is not complete.');
  const stream = new Blob([unb64u(id.slice(1))]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return JSON.parse(await new Response(stream).text());
}

// ---------------------------------------------------------------- the API, answered without a server
async function json(url) { const r = await fetch(url); if (!r.ok) throw new Error(r.status === 404 ? 'Not found' : r.statusText); return r.json(); }
export async function staticGet(url) {
  const u = new URL(url, 'http://x'), p = u.pathname;
  if (p === '/api/site') return json('api/site.json');
  if (p === '/api/songs') return json('api/songs.json');
  let m = p.match(/^\/api\/songs\/([\w-]+)$/);
  if (m) { lastSong = await json(`api/songs/${m[1]}.json`); return lastSong; }
  if (p === '/api/remixes') return [];
  m = p.match(/^\/api\/remixes\/([\w-]+)$/);
  if (m) { const t = await unsqueeze(m[1]); return { id: m[1], song_id: t.s, title: t.t || 'untitled', author: t.a || 'someone', data: t.d, duration: t.u || 0, likes: 0, forked_from: '' }; }
  if (/^\/api\/sounds\//.test(p)) throw new Error('That sound only lived in an earlier visit.');
  throw new Error('Not available here');
}
export async function staticPost(url, body) {
  if (url === '/api/remixes') return { id: await squeeze({ s: body.songId, t: body.title, a: body.author, d: body.data, u: Math.round(body.duration || 0) }) };
  return {};
}
export async function staticUpload(url, form) {
  if (url !== '/api/sounds') throw new Error('Not available here');
  if (!lastSong) throw new Error('No song is open.');
  return fitSound(form.get('file'), { name: String(form.get('name') || 'my sound').slice(0, 40), fit: String(form.get('fit') || 'stretch'), origin: form.get('origin') === 'mic' ? 'mic' : 'upload', author: String(form.get('author') || '') }, lastSong);
}

// ---------------------------------------------------------------- fitting a sound to the band (the browser twin of processSound)
const FIT_BARS = [1, 2, 4, 8, 16], MAX_BARS = 16, WAVE_POINTS = 64;
const dB = (v) => 20 * Math.log10(Math.max(v, 1e-9));

async function decodeStereo(blob) {
  const ctx = new OfflineAudioContext(2, 1, SR);   // decodeAudioData resamples to the context's rate
  const b = await ctx.decodeAudioData(await blob.arrayBuffer());
  const L = b.getChannelData(0), R = b.numberOfChannels > 1 ? b.getChannelData(1) : L, x = new Float32Array(L.length * 2);
  for (let i = 0; i < L.length; i++) { x[2 * i] = L[i]; x[2 * i + 1] = R[i]; }
  return x;
}
/** Time-stretch with the pitch kept: overlap-add of Hann windows, each placed where it lines up best with the last (WSOLA). */
function stretch(x, tempo) {
  const frames = x.length / 2, outFrames = Math.round(frames / tempo);
  const N = 2048, hop = N / 2, search = 512, out = new Float32Array(outFrames * 2 + N * 2), norm = new Float32Array(outFrames + N);
  const win = new Float32Array(N); for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const mono = (i) => (i >= 0 && i < frames ? x[2 * i] + x[2 * i + 1] : 0);
  let prev = 0;
  for (let o = 0; o < outFrames; o += hop) {
    const ideal = Math.round(o * tempo);
    let best = ideal, bestC = -Infinity;
    if (o > 0) {
      const want = prev + hop;   // what would follow naturally from the last window
      for (let k = -search; k <= search; k += 8) {
        const s = ideal + k; if (s < 0 || s + N > frames) continue;
        let c = 0; for (let i = 0; i < N; i += 16) c += mono(s + i) * mono(want + i);
        if (c > bestC) { bestC = c; best = s; }
      }
    }
    for (let i = 0; i < N; i++) {
      const s = best + i; if (s >= frames) break;
      out[2 * (o + i)] += x[2 * s] * win[i]; out[2 * (o + i) + 1] += x[2 * s + 1] * win[i]; norm[o + i] += win[i];
    }
    prev = best;
  }
  const y = new Float32Array(outFrames * 2);
  for (let i = 0; i < outFrames; i++) { const n = norm[i] > 1e-3 ? norm[i] : 1; y[2 * i] = out[2 * i] / n; y[2 * i + 1] = out[2 * i + 1] / n; }
  return y;
}
function analyseCell(x, cellFrames) {
  let sq = 0, pk = 0; const wave = new Array(WAVE_POINTS).fill(0);
  for (let i = 0; i < cellFrames; i++) {
    const m = (x[2 * i] + x[2 * i + 1]) * 0.5; sq += m * m; const a = Math.abs(m); if (a > pk) pk = a;
    const w = Math.floor((i / cellFrames) * WAVE_POINTS); if (a > wave[w]) wave[w] = a;
  }
  return { rms: +dB(Math.sqrt(sq / cellFrames)).toFixed(1), peak: +dB(pk).toFixed(1), wave: wave.map((v) => Math.round(Math.min(1, v * 1.4) * 99)) };
}
async function fitSound(blob, { name, fit, origin, author }, song) {
  const barSamples = song.barDur * SR, barDur = song.barDur, cellBars = song.barsPerCell;
  let x = await decodeStereo(blob), frames = x.length / 2;
  if (fit !== 'exact') {   // trim silence at both ends so the loop starts on its first sound
    const th = 10 ** (-48 / 20); let s = 0, e = frames - 1;
    while (s < frames && Math.abs(x[2 * s]) < th && Math.abs(x[2 * s + 1]) < th) s++;
    while (e > s && Math.abs(x[2 * e]) < th && Math.abs(x[2 * e + 1]) < th) e--;
    s = Math.max(0, s - Math.round(0.004 * SR)); x = x.slice(s * 2, (e + 1) * 2); frames = x.length / 2;
  }
  if (frames < SR * 0.05) throw new Error('That sound is (almost) silent.');
  const dur = frames / SR;
  let bars;
  if (fit === 'stretch' && dur > barDur * 0.6) {
    bars = FIT_BARS.reduce((b, n) => (Math.abs(Math.log(dur / (n * barDur))) < Math.abs(Math.log(dur / (b * barDur))) ? n : b), 1);
    const tempo = dur / (bars * barDur);
    if (Math.abs(tempo - 1) > 0.002) x = stretch(x, tempo);
  } else bars = Math.max(1, fit === 'exact' ? Math.round(dur / barDur) : Math.ceil(dur / barDur - 0.02));
  bars = Math.min(bars, MAX_BARS);
  const loopFrames = Math.round(bars * barSamples), loop = new Float32Array(loopFrames * 2);
  loop.set(x.subarray(0, Math.min(x.length, loop.length)));
  const fade = Math.min(loopFrames, Math.round(0.003 * SR));
  for (let i = 0; i < fade; i++) { const k = loopFrames - 1 - i, gn = i / fade; loop[2 * k] *= gn; loop[2 * k + 1] *= gn; }
  let pk = 0; for (let i = 0; i < loop.length; i++) pk = Math.max(pk, Math.abs(loop[i]));
  if (pk > 1e-4) { const k = 0.5 / pk; for (let i = 0; i < loop.length; i++) loop[i] *= k; }
  const cellFrames = Math.round(cellBars * barSamples), numCells = Math.max(1, Math.ceil(loopFrames / cellFrames)), cells = [];
  for (let c = 0; c < numCells; c++) {
    const out = new Float32Array(cellFrames * 2), L = new Float32Array(cellFrames), R = new Float32Array(cellFrames);
    for (let i = 0; i < cellFrames; i++) { const s = (c * cellFrames + i) % loopFrames; out[2 * i] = L[i] = loop[2 * s]; out[2 * i + 1] = R[i] = loop[2 * s + 1]; }
    cells.push({ url: URL.createObjectURL(encodeWav([L, R], SR)), ...analyseCell(out, cellFrames) });
  }
  const id = 'l' + Math.random().toString(36).slice(2, 9);
  return { id, songId: song.id, name, author, origin, status: 'ready', bars, cells, color: '#ffffff', group: 'yours' };
}
