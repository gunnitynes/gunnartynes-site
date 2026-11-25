// Pieces: stretches of what was heard, kept on the phone (phone-tape.js). Their storage, how their slices become sound, and
// how they play on the timeline, which the studio on the computer does too.
const DB = 'playground-pieces'; let dbp = null;
const db = () => (dbp ??= new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore('p'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
const idb = async (mode, fn) => { const d = await db(); return new Promise((res, rej) => { const t = d.transaction('p', mode), r = fn(t.objectStore('p')); t.oncomplete = () => res(r?.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); }); };
export const pieceStore = (songId) => {
  const pre = `${songId}:`;
  return {
    put: (c) => idb('readwrite', (s) => s.put({ ...c }, pre + c.id)),
    del: (id) => idb('readwrite', (s) => s.delete(pre + id)),
    all: async () => { try { const keys = (await idb('readonly', (s) => s.getAllKeys())).filter((k) => String(k).startsWith(pre)); return (await Promise.all(keys.map((k) => idb('readonly', (s) => s.get(k))))).filter(Boolean).sort((a, b) => b.t - a.t); } catch { return []; } },
  };
};

/** `list()`: the pieces there are. Returns what is needed to hear them, and plays those on the timeline. */
export function pieceSound(S, list) {
  const { ctx, player, seq: q } = S, sr = ctx.sampleRate, bpb = () => S.song.beatsPerBar, bufs = new Map();
  function render(c) {
    const N = c.L.length, n = c.steps.length, src = c.src || n, sl = N / src, total = Math.round(sl * n), L = new Float32Array(total), R = new Float32Array(total), F = Math.min(140, sl * 0.1);
    c.steps.forEach((s, k) => {
      if (s.m) return; const o = Math.round(k * sl), e = Math.min(total, Math.round((k + 1) * sl)), len = e - o, at = s.i * sl, rate = 2 ** s.o, part = len / s.u, next = c.steps[k + 1], prev = c.steps[k - 1], plain = (a) => a && !a.m && !a.r && a.u === 1 && !a.o, fi = !(plain(s) && plain(prev) && prev.i + 1 === s.i), fo = !(plain(s) && plain(next) && next.i === s.i + 1);
      for (let i = 0; i < len; i++) { const j = i % part, p0 = j * rate, p = s.r ? at + sl - 1 - p0 : at + p0, x = ((p % N) + N) % N, a = x | 0, f = x - a, b = (a + 1) % N; let w = 1; if (fi && i < F) w = i / F; if (fo && i > len - F) w = Math.min(w, (len - i) / F); if (s.u > 1) { if (j < F) w = Math.min(w, j / F); if (j > part - F) w = Math.min(w, (part - j) / F); } L[o + i] = (c.L[a] + (c.L[b] - c.L[a]) * f) * w; R[o + i] = (c.R[a] + (c.R[b] - c.R[a]) * f) * w; }
    });
    return [L, R];
  }
  const bufOf = (c) => { const key = JSON.stringify(c.steps); let x = bufs.get(c.id); if (!x || x.key !== key) { const [L, R] = render(c), b = ctx.createBuffer(2, L.length, sr); b.copyToChannel(L, 0); b.copyToChannel(R, 1); bufs.set(c.id, (x = { key, b, L, R })); if (bufs.size > 6) bufs.delete(bufs.keys().next().value); } return x; };
  const len = (c) => ((c.L.length / sr) * c.steps.length) / (c.src || c.steps.length), barsOf = (c) => (c.bars ? (c.bars * c.steps.length) / (c.src || c.steps.length) : len(c) / player.barDur);

  /** On the timeline a piece sounds from where it begins to where it ends, as one sound, round and round inside. */
  const live = new Map(), hush = (id) => { for (const [k, x] of live) if (id === undefined || k === id) { const t = ctx.currentTime; x.g.gain.cancelScheduledValues(t); x.g.gain.setValueAtTime(x.g.gain.value, t); x.g.gain.linearRampToValueAtTime(0, t + 0.012); try { x.s.stop(t + 0.02); } catch { /* gone */ } live.delete(k); } };
  player.on('bar', ({ bar, time }) => {
    if (q.mode !== 'song') return; const T = Math.floor(q.tl(bar * bpb()) / bpb()), seen = new Set();
    for (const cl of q.arr.clips) {
      if (!cl.cap || T < cl.start || T >= cl.start + cl.len || q.mute.has('cap')) continue; const c = list().find((x) => x.id === cl.cap); if (!c) continue;
      const b = bufOf(c).b, n = Math.max(0.25, c.bars ? barsOf(c) : Math.max(1, Math.round(barsOf(c)))), rate = b.duration / n / player.barDur, at = (((T - cl.start + (cl.off || 0)) % n) + n) % n, key = cl.id; seen.add(key); const x = live.get(key);
      if (x && x.b === b && Math.abs(x.rate - rate) < 1e-4 && x.next === T) { x.next = T + 1; } else {
        if (x) { x.g.gain.setValueAtTime(1, time); x.g.gain.linearRampToValueAtTime(0, time + 0.01); x.s.stop(time + 0.015); }
        const s = ctx.createBufferSource(), g = ctx.createGain(); s.buffer = b; s.loop = true; s.playbackRate.value = rate; g.gain.value = 0; g.gain.setValueAtTime(0, time); g.gain.linearRampToValueAtTime(1, time + 0.006); s.connect(g).connect(S.dryBus); s.start(time, (at / n) * b.duration); live.set(key, { s, g, b, rate, next: T + 1 }); s.onended = () => { if (live.get(key)?.s === s) live.delete(key); };
      }
      const y = live.get(key), end = time + player.barDur, lastBar = T === cl.start + cl.len - 1 || T === (q.arr.cycle?.[1] ?? q.arr.bars) - 1; if (lastBar) { y.g.gain.setValueAtTime(1, end - 0.002); y.g.gain.linearRampToValueAtTime(0, end + 0.008); y.s.stop(end + 0.02); live.delete(key); }
    }
    for (const [k, x] of live) if (!seen.has(k)) { x.g.gain.setValueAtTime(1, time); x.g.gain.linearRampToValueAtTime(0, time + 0.01); x.s.stop(time + 0.02); live.delete(k); }
  });
  player.on('transport', ({ playing: p }) => { if (!p) hush(); }); player.on('seek', () => hush()); player.on('tempo', () => hush());
  return { render, bufOf, len, barsOf };
}
