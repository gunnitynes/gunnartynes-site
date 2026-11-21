// You, as one more stem. What the microphone hears while the song plays is cut into the song's own bars and kept
// as a stem called "You": it plays along wherever the song's bars go (moved, looped, reversed in the Arrangement),
// gets a lane and a mixer row like every musician, and can be grains in the Cloud or the slice of an instrument.
//
// Where a take lands: for every bar you played over, the bar of the SONG that was sounding then (so you sing with
// the song, not at a clock time). Which cells hold your voice is part of the arrangement (arr.voice), so Undo
// takes a take back; the audio itself is kept in the browser (IndexedDB), never sent anywhere.
import { defaultTrack } from '../state/session.js';

export const VOICE = 'you';
export function addVoiceStem(song) {
  if (!song.stems.some((s) => s.id === VOICE)) song.stems.push({ id: VOICE, name: 'You', voice: true, gain: 1, cells: new Array(song.numCells).fill(null) });
}

// ---- the browser's own storage for the audio
let dbp = null;
const db = () => (dbp ??= new Promise((res, rej) => { const r = indexedDB.open('playground-voice', 1); r.onupgradeneeded = () => r.result.createObjectStore('cells'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
async function idb(mode, fn) { const d = await db(); return new Promise((res, rej) => { const tx = d.transaction('cells', mode), r = fn(tx.objectStore('cells')); tx.oncomplete = () => res(r?.result); tx.onerror = () => rej(tx.error); }); }
const idbGet = (k) => idb('readonly', (s) => s.get(k)).catch(() => null);
const idbPut = (k, v) => idb('readwrite', (s) => s.put(v, k)).catch(() => null);
const idbKeys = () => idb('readonly', (s) => s.getAllKeys()).catch(() => []);
const idbDel = (k) => idb('readwrite', (s) => s.delete(k)).catch(() => null);

export class Voice extends EventTarget {
  constructor(S) {
    super(); this.S = S; this.st = S.song.stems.find((s) => s.id === VOICE); this.take = null; this.n = 0;
    S.seq.addEventListener('change', () => this.sync());
    S.player.on('bar', ({ bar }) => { if (this.take) { this.take.map[bar] ??= this.srcOf(bar); this.emit(); } });
    S.player.on('transport', ({ playing }) => { if (!playing && this.take) this.stop(); });
  }
  get has() { return this.st.cells.some(Boolean); }
  get recording() { return !!this.take; }
  /** The voice needs its own track in the band (an older saved session has none). */
  ensureTrack() { const ss = this.S.session, P = this.S.params; if (ss.state.tracks[VOICE]) return; ss.dispatch({ t: 'track/add', track: defaultTrack(VOICE) }, { log: false }); for (const k of ['gain', 'mute', 'solo', 'pan', 'rev']) P.apply[`band.${VOICE}.${k}`]?.(P.get(`band.${VOICE}.${k}`)); }
  /** Cells on the stem follow the arrangement's record of them, once their audio is in. */
  sync() {
    const m = this.S.seq.arr.voice || {}, cells = this.st.cells, L = this.S.loader; let ch = false;
    for (let c = 0; c < cells.length; c++) { const v = m[c] && L.has(m[c].url) ? m[c] : null; if ((cells[c]?.url || null) !== (v?.url || null)) { cells[c] = v; ch = true; } }
    if (ch) this.emit();
  }
  /** After a reload: bring the takes back from the browser's storage (and forget audio nothing points at any more). */
  async restore() {
    const m = this.S.seq.arr.voice || {}, want = new Set(Object.values(m).map((v) => v.url));
    await Promise.all([...want].map(async (url) => { if (this.S.loader.has(url)) return; const d = await idbGet(url); if (d) this.S.loader.put(url, this.buffer(d)); }));
    const pre = `voice:${this.S.song.id}/`;
    for (const k of await idbKeys()) if (String(k).startsWith(pre) && !want.has(k)) idbDel(k);
    this.sync(); this.S.seq.applyBand();
  }
  buffer(data) { const b = this.S.ctx.createBuffer(1, data.length, this.S.ctx.sampleRate); b.copyToChannel(data, 0); return b; }

  /** The song bar that player bar B plays for the voice (null where it plays something treated, or nothing). */
  srcOf(B) {
    const tr = this.S.session.state.tracks[VOICE], N = this.S.song.numBars, cb = this.S.song.barsPerCell; if (!tr) return null;
    if (tr.mode === 'follow') return ((B % N) + N) % N;
    if (tr.mode === 'loop') return tr.cell * cb + ((B % cb) + cb) % cb;
    if (tr.mode === 'pattern') { const p = tr.pattern; if (!p?.length) return null; const g = p[((B % p.length) + p.length) % p.length]; return g && !g[2] ? g[0] * cb + g[1] : null; }
    return null;
  }

  async start() {
    if (this.take) return;
    const S = this.S, p = S.player, eng = S.engine;
    let mic; try { mic = await eng.openMic(); } catch (e) { throw new Error(e?.name === 'NotAllowedError' ? 'The microphone was not allowed' : 'No microphone here'); }
    await S.ctx.resume(); if (!p.playing) p.play();
    const B = Math.ceil((S.ctx.currentTime + 0.15 - p.bar0) / p.barDur);   // the first whole bar from now
    const lat = eng.roundTrip(), startFrame = Math.round((p.timeOfBar(B) + lat) * S.ctx.sampleRate);
    this.take = { B, lat, r: p.r, warp: p.warp, barDur: p.barDur, map: { [B]: this.srcOf(B) }, rec: mic.record(startFrame), mic };
    this.emit();
  }
  /** Input level now (0..1), for a meter while recording. */
  level() { const m = this.take?.mic?.monitor; if (!m) return 0; const b = (this.lb ??= new Float32Array(1024)); m.getFloatTimeDomainData(b); let pk = 0; for (const x of b) pk = Math.max(pk, Math.abs(x)); return pk; }
  /** Bars of the take so far. */
  get bars() { const t = this.take; if (!t) return 0; return Math.max(0, Math.floor((this.S.ctx.currentTime - this.S.player.timeOfBar(t.B)) / t.barDur)); }

  /** Stop and write the take into the stem. Resolves to { bars, cells } or null when nothing was heard. */
  async stop() {
    const t = this.take; if (!t) return null; this.take = null; this.emit();
    const S = this.S, sr = S.ctx.sampleRate, song = S.song, cb = song.barsPerCell;
    const out = await t.rec.stop(Math.round((S.ctx.currentTime + t.lat) * sr));
    let x = new Float32Array(out.L.length); for (let i = 0; i < x.length; i++) x[i] = (out.L[i] + out.R[i]) * 0.5;
    const barNow = Math.round(t.barDur * sr), nb = Math.ceil(x.length / barNow);
    for (let k = 0; k < nb; k++) if (t.map[t.B + k] === undefined) t.map[t.B + k] = this.srcOf(t.B + k);
    // into the song's own tempo: stretched (pitch kept) after warp, resampled after tape
    if (Math.abs(t.r - 1) > 1e-6) x = t.warp ? await stretch(x, t.r) : resample(x, t.r);
    const barLen = Math.round(song.barDur * sr), cellLen = Math.round(song.cellDur * sr);
    let pk = 0; for (const v of x) pk = Math.max(pk, Math.abs(v));
    if (pk < 0.002) return null;
    const gain = Math.min(8, 0.6 / pk); if (gain > 1) for (let i = 0; i < x.length; i++) x[i] *= gain;
    const cur = S.seq.arr.voice || {}, touched = new Map();
    let wrote = 0;
    for (let k = 0; k < nb; k++) {
      const src = t.map[t.B + k]; if (src == null) continue;
      const a = k * barLen, b = Math.min(x.length, a + barLen); if (b - a < sr * 0.1) continue;
      let p2 = 0; for (let i = a; i < b; i += 4) p2 = Math.max(p2, Math.abs(x[i]));
      if (p2 < 0.004 * Math.max(1, gain)) continue;   // a bar where you were silent leaves what was there
      const cell = Math.floor(src / cb), at = Math.round(((src % cb) * cellLen) / cb);
      let d = touched.get(cell);
      if (!d) { d = new Float32Array(cellLen); const old = cur[cell] && S.loader.get(cur[cell].url); if (old) d.set(old.getChannelData(0).subarray(0, cellLen)); touched.set(cell, d); }
      const n = Math.min(b - a, cellLen - at), F = Math.min(96, n >> 2);
      for (let i = 0; i < n; i++) { const f = Math.min(1, i / F, (n - 1 - i) / F); d[at + i] = d[at + i] * (1 - f) + x[a + i] * f; }
      wrote++;
    }
    if (!wrote) return null;
    S.seq.snapshot();
    const next = { ...cur };
    for (const [cell, d] of touched) {
      const url = `voice:${song.id}/${cell}/${Date.now().toString(36)}${++this.n}`;
      let s = 0; for (let i = 0; i < d.length; i += 8) s += d[i] * d[i];
      next[cell] = { url, rms: +(20 * Math.log10(Math.sqrt(s / (d.length / 8)) + 1e-9)).toFixed(1) };
      S.loader.put(url, this.buffer(d)); idbPut(url, d);
    }
    S.seq.arr.voice = next; S.seq.changed();
    return { bars: wrote, cells: touched.size, from: t.map[t.B] };
  }
  /** Take your voice out of the song (Undo brings it back). */
  clear() { const q = this.S.seq; if (!this.has) return; q.snapshot(); q.arr.voice = {}; q.changed(); }
  emit() { this.dispatchEvent(new Event('change')); }
}

function resample(x, r) { const n = Math.round(x.length * r), o = new Float32Array(n); for (let i = 0; i < n; i++) { const p = i / r, j = Math.floor(p), f = p - j; o[i] = (x[j] || 0) * (1 - f) + (x[j + 1] || 0) * f; } return o; }
function stretch(x, alpha) {
  return new Promise((res) => { const w = new Worker(new URL('../engine/stretch.js', import.meta.url)); w.onmessage = ({ data }) => { w.terminate(); res(data.chans[0]); }; w.postMessage({ id: 1, chans: [x], alpha }, [x.buffer]); });
}
