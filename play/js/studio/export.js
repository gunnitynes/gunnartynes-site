// Take your version to Ableton (or any DAW): one zip with
//   · a WAV for every stem (or every family of stems) exactly as your arrangement plays it — moved, looped,
//     reversed, slowed, stuttered, silenced, and your recorded Audio — all starting at bar 1, so they line up
//     the moment they are dropped in;
//   · the instruments' notes as a MIDI file, one track per instrument;
//   · a note on tempo and where everything starts.
// Rendered here in the browser, sample by sample from the stems' own audio (at the song's tempo: the playground's
// tempo and key changes and the Process effects are not in the files).
const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (u8) => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = crcT[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

/** A zip with no compression (audio does not compress anyway), built as a Blob so big files stay out of the way. */
export class Zip {
  constructor() { this.parts = []; this.dir = []; this.off = 0; }
  add(name, data) {
    const u8 = data instanceof Uint8Array ? data : new Uint8Array(data), nm = new TextEncoder().encode(name), crc = crc32(u8);
    const hd = new DataView(new ArrayBuffer(30)); hd.setUint32(0, 0x04034b50, true); hd.setUint16(4, 20, true); hd.setUint16(6, 0x0800, true); hd.setUint32(14, crc, true); hd.setUint32(18, u8.length, true); hd.setUint32(22, u8.length, true); hd.setUint16(26, nm.length, true);
    this.parts.push(new Blob([hd.buffer, nm, u8])); this.dir.push({ nm, crc, size: u8.length, off: this.off }); this.off += 30 + nm.length + u8.length;
  }
  blob() {
    const cd = []; let size = 0;
    for (const e of this.dir) { const d = new DataView(new ArrayBuffer(46)); d.setUint32(0, 0x02014b50, true); d.setUint16(4, 20, true); d.setUint16(6, 20, true); d.setUint16(8, 0x0800, true); d.setUint32(16, e.crc, true); d.setUint32(20, e.size, true); d.setUint32(24, e.size, true); d.setUint16(28, e.nm.length, true); d.setUint32(42, e.off, true); cd.push(d.buffer, e.nm); size += 46 + e.nm.length; }
    const end = new DataView(new ArrayBuffer(22)); end.setUint32(0, 0x06054b50, true); end.setUint16(8, this.dir.length, true); end.setUint16(10, this.dir.length, true); end.setUint32(12, size, true); end.setUint32(16, this.off, true);
    return new Blob([...this.parts, ...cd, end.buffer], { type: 'application/zip' });
  }
}
export function wav(L, R, sr) {
  const n = L.length, buf = new ArrayBuffer(44 + n * 4), v = new DataView(buf), s = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  s(0, 'RIFF'); v.setUint32(4, 36 + n * 4, true); s(8, 'WAVE'); s(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true); s(36, 'data'); v.setUint32(40, n * 4, true);
  const o = new Int16Array(buf, 44); for (let i = 0; i < n; i++) { const a = Math.max(-1, Math.min(1, L[i])), b = Math.max(-1, Math.min(1, R[i])); o[2 * i] = a < 0 ? a * 0x8000 : a * 0x7fff; o[2 * i + 1] = b < 0 ? b * 0x8000 : b * 0x7fff; }
  return new Uint8Array(buf);
}
export function midi(tracks, bpm) {
  const PPQ = 480, bytes = [], u32 = (x) => [(x >>> 24) & 255, (x >>> 16) & 255, (x >>> 8) & 255, x & 255], vlq = (x) => { const o = [x & 127]; while ((x >>= 7)) o.unshift((x & 127) | 128); return o; };
  const chunk = (id, data) => [...[...id].map((c) => c.charCodeAt(0)), ...u32(data.length), ...data];
  const tempo = 60000000 / bpm, t0 = [0, 0xff, 0x51, 3, (tempo >> 16) & 255, (tempo >> 8) & 255, tempo & 255, 0, 0xff, 0x2f, 0];
  bytes.push(...chunk('MThd', [0, 1, 0, tracks.length + 1, PPQ >> 8, PPQ & 255]), ...chunk('MTrk', t0));
  tracks.forEach(({ name, notes }, i) => {
    const ev = []; for (const n of notes) { ev.push([Math.round(n.b * PPQ), 0x90 | (i % 16), n.note, Math.max(1, Math.round(n.vel * 127))]); ev.push([Math.round((n.b + n.d) * PPQ), 0x80 | (i % 16), n.note, 0]); }
    ev.sort((a, b) => a[0] - b[0] || (a[1] & 0xf0) - (b[1] & 0xf0));
    const nm = [...new TextEncoder().encode(name)], d = [0, 0xff, 0x03, ...vlq(nm.length), ...nm]; let last = 0;
    for (const [t, st, a, b] of ev) { d.push(...vlq(t - last), st, a, b); last = t; }
    d.push(0, 0xff, 0x2f, 0); bytes.push(...chunk('MTrk', d));
  });
  return new Uint8Array(bytes);
}

const FAM = { rhythm: 'Rhythm', bass: 'Bass', keys: 'Keys', guitar: 'Guitar', synth: 'Synths', strings: 'Strings', voice: 'Voices', other: 'Other' };
export async function exportForDaw(S, { perStem = false, progress = () => {}, names = [] } = {}) {
  const q = S.seq, song = S.song, P = S.params, cb = song.barsPerCell, bpb = song.beatsPerBar, sr = S.ctx.sampleRate;
  const [r0, r1] = q.arr.cycle || [0, q.arr.bars], bars = r1 - r0, barLen = Math.round(song.barDur * sr);
  const cyc = q.arr.cycle; q.arr.cycle = null; const pats = q.bandPatterns(); q.arr.cycle = cyc;
  const stems = song.stems.filter((st) => st.cells.some(Boolean) && !P.get(`band.${st.id}.mute`));
  const groups = perStem ? stems.map((st) => [st.name, [st]]) : Object.entries(stems.reduce((m, st) => { const k = st.voice ? 'Audio' : FAM[st.group] || 'Other'; (m[k] ??= []).push(st); return m; }, {}));
  // plain letters inside the zip (any unzip tool can make the folders), the song's own name on the zip itself
  const ascii = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '-').replace(/[\/:*?"<>|]/g, '-');
  const zip = new Zip(), base = ascii(`${song.title} - playground`);
  let done = 0, total = groups.reduce((a, [, s]) => a + s.length, 0);
  for (const [gname, sts] of groups) {
    const L = new Float32Array(bars * barLen), R = new Float32Array(bars * barLen);
    for (const st of sts) {
      const pat = pats[st.id]?.pattern || [], gain = P.get(`band.${st.id}.gain`) ?? 1;
      let prev = null;
      for (let T = r0; T < r1; T++) {
        const e = pat[T]; if (!e) { prev = null; continue; }
        const [cell, bar, fx] = e, url = st.cells[cell]?.url; if (!url) { prev = null; continue; }
        const buf = await S.loader.ensure(url).catch(() => null); if (!buf) continue;
        const a = buf.getChannelData(0), b = buf.numberOfChannels > 1 ? buf.getChannelData(1) : a, D = a.length;
        const rate = fx?.s || 1, rev = !!fx?.r, g = (fx?.g ?? 1) * gain, slice = fx?.u ? barLen / fx.u : rate > 1 ? barLen / rate : 0;
        const at = (rev ? D - (bar + 1) * barLen : bar * barLen) + (fx?.o || 0) * barLen;
        const join = !fx && prev && prev[0] === cell && prev[1] + 1 === bar, F = 96, o = (T - r0) * barLen;
        for (let i = 0; i < barLen; i++) {
          let pos = slice ? at + ((i % slice) * rate) : at + i * rate; if (rev) pos = D - 1 - pos;
          const j = Math.floor(pos), fr = pos - j; if (j < 0 || j + 1 >= D) continue;
          let w = g; if (!join && i < F) w *= i / F; if ((fx || pat[T + 1]?.[2]) && i > barLen - F) w *= (barLen - i) / F;
          L[o + i] += (a[j] + (a[j + 1] - a[j]) * fr) * w; R[o + i] += (b[j] + (b[j + 1] - b[j]) * fr) * w;
        }
        prev = fx ? null : [cell, bar];
      }
      progress(++done / (total + 1), st.name);
    }
    let pk = 0; for (let i = 0; i < L.length; i += 7) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
    if (pk > 0.0005) zip.add(`${base}/${ascii(gname)}.wav`, wav(L, R, sr));
  }
  // the instruments' notes, one MIDI track each
  const tracks = [];
  for (let slot = 0; slot < S.slots.length; slot++) {
    const notes = [];
    for (const cl of q.arr.clips) {
      if (cl.lane !== slot || cl.pat == null) continue;
      const pb = q.pb(cl.pat), cs = cl.start * bpb, ce = (cl.start + cl.len) * bpb, b0 = cs - (cl.off || 0) * bpb;
      for (let k = 0; b0 + k * pb < ce; k++) for (const e of q.vars[cl.pat] || []) {
        if (e.k !== 'n' || e.slot !== (cl.part ?? cl.lane) || e.b >= pb) continue;
        const t = b0 + k * pb + e.b; if (t < cs || t >= ce || t < r0 * bpb || t >= r1 * bpb) continue;
        notes.push({ b: t - r0 * bpb, d: Math.min(e.d || 0.25, ce - t), note: e.note + (cl.tr || 0), vel: e.vel });
      }
    }
    if (notes.length) tracks.push({ name: names[slot] || `Instrument ${slot}`, notes });
  }
  if (tracks.length) zip.add(`${base}/Instruments.mid`, midi(tracks, song.bpm));
  zip.add(`${base}/README.txt`, new TextEncoder().encode([
    `${song.title} — your version, from the Playground`, '',
    `Tempo: ${song.bpm} BPM, ${bpb}/4. Every file starts at bar 1 and is ${bars} bars long${q.arr.cycle ? ` (bars ${r0 + 1}–${r1} of your arrangement: the loop)` : ''}.`,
    'Drop them all into a new Live set (or any DAW) at bar 1, set the tempo above, and they line up.',
    tracks.length ? 'Instruments.mid holds the notes you played on the instruments, one track each: put any instrument on them.' : '',
    `${perStem ? 'One file per stem.' : 'One file per family of stems.'} Levels and mutes are as in your mix; the Process effects, tempo and key changes are not in the files.`,
  ].join('\n')));
  progress(1, 'zip');
  return { blob: zip.blob(), name: `${song.title} · playground.zip`, files: zip.dir.length };
}
