// Keeping your work. Three layers:
//  · as you go, in the browser (localStorage, or its bigger storage when that is full), at every change and when you leave
//  · versions, put aside every few minutes (versions.js)
//  · a project file: everything, with the sounds you recorded and the pieces you kept, in one file that opens on a phone
//    and on a computer alike. Browsers may throw their storage away; a file is yours.
// What one of the two does not know (the phone's table, the studio's mixer memories) it carries along untouched.
import { h, download } from '../lib/util.js';
import { pieceStore } from './pieces.js';
import { voiceStore } from './voice.js';

const DB = 'playground-work'; let dbp = null;
const db = () => (dbp ??= new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore('w'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
const idb = async (mode, fn) => { const d = await db(); return new Promise((res, rej) => { const t = d.transaction('w', mode), r = fn(t.objectStore('w')); t.oncomplete = () => res(r?.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); }); };
const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

/** Looks after one page's work under `key`: await read() once, then start(). */
export class Work {
  constructor(S, key) { this.S = S; this.key = key; this.last = null; this.leaving = false; this.full = false; this.told = false; }
  /** What was kept last, wherever it fitted. */
  async read() {
    let a = null, b = null;
    try { a = parse(localStorage.getItem(this.key)); } catch { /* blocked */ }
    try { b = parse(await Promise.race([idb('readonly', (s) => s.get(this.key)), new Promise((r) => setTimeout(r, 1500))])); } catch { /* private browsing */ }
    return a && b ? ((b.at || 0) > (a.at || 0) ? b : a) : a || b;
  }
  /** Something could not be read: put a copy aside before anything is written over it. */
  aside(d) { try { localStorage.setItem(this.key + '.unread', JSON.stringify(d)); } catch { /* full */ } }
  start() {
    this.last = JSON.stringify(this.S.projectData());   // a page that only looks on writes nothing (two tabs of it do not undo each other)
    setInterval(() => this.save(), 2000);
    document.addEventListener('visibilitychange', () => document.hidden && this.save()); addEventListener('pagehide', () => this.save());
    const arm = this.S.seq.arm.bind(this.S.seq); this.S.seq.arm = (on) => { if (on) stay(); return arm(on); };   // the first recording: ask the browser to hold on to it
  }
  save() {
    if (this.leaving) return; let j; try { j = JSON.stringify(this.S.projectData()); } catch (e) { console.error(e); return; }
    if (j === this.last) return; this.last = j; this.write(j);
  }
  write(j) {
    const s = `{"at":${Date.now()},${j.slice(1)}`;
    try { localStorage.setItem(this.key, s); if (this.full) { this.full = false; idb('readwrite', (st) => st.delete(this.key)).catch(() => {}); } return Promise.resolve(true); } catch { /* full, or not allowed */ }
    this.full = true;
    return idb('readwrite', (st) => st.put(s, this.key)).then(() => true).catch(() => { if (!this.told) { this.told = true; this.S.say?.('Your work could not be kept in this browser: save it as a file'); } return false; });
  }
  /** Put another project in this one's place and begin with it (what is here now becomes a version first). */
  async replace(d, label) {
    await this.S.versions?.save(label).catch?.(() => {});
    this.leaving = true;
    const ok = d ? await this.write(JSON.stringify(d)) : (localStorage.removeItem(this.key), await idb('readwrite', (st) => st.delete(this.key)).catch(() => {}), true);
    if (!ok) { this.leaving = false; throw new Error('there is no room for it in this browser'); }
    location.reload();
  }
}
/** Ask the browser not to clear what is kept here (once, and only when there is something to keep). */
let asked = false;
export async function stay() { if (asked) return; asked = true; try { if (!(await navigator.storage?.persisted?.())) await navigator.storage?.persist?.(); } catch { /* not here */ } }

/** Settings this page has no use for stay with the project (a phone's on the computer, and the other way round). */
export function loadParams(P, v) { P.extra = {}; for (const [k, x] of Object.entries(v || {})) if (!(k in P.def)) P.extra[k] = x; P.load(v); }
/** Everything in a project but the parts this page handles itself. */
export function carry(d, own) { const o = {}; for (const [k, x] of Object.entries(d)) if (!own.includes(k) && k !== 'at') o[k] = x; return o; }

/** Text in which every sound still in use is named, for this song, anywhere: nothing named here may be thrown away. Null when that cannot be known. */
export async function inUse(S) {
  try {
    let t = JSON.stringify(S.projectData()) + [...S.seq.undos, ...S.seq.redos].map((u) => (typeof u === 'string' ? u : JSON.stringify(u))).join('');
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith('playground.')) t += localStorage.getItem(k); }
    t += ((await idb('readonly', (s) => s.getAll())) || []).join('');
    const vd = await new Promise((res, rej) => { const r = indexedDB.open('playground-versions', 1); r.onupgradeneeded = () => r.result.createObjectStore('v'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const all = await new Promise((res, rej) => { const r = vd.transaction('v', 'readonly').objectStore('v').getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); vd.close();
    for (const v of all) t += JSON.stringify(v.data?.seq?.arr?.voice || {}) + JSON.stringify([v.data?.cloud, v.data?.forges]);
    return t;
  } catch { return null; }
}

// ------------------------------------------------------------------------------------------------ the file
const MAGIC = 'PLAYGRND';
/** Everything as one file: 'PLAYGRND', the length of the text, the text (JSON), then the sounds (16 bit). */
export async function makeFile(S, from) {
  const data = S.projectData(), text = JSON.stringify(data), sr = S.ctx.sampleRate, parts = [], audio = []; let at = 0;
  const put = (kind, key, chans, meta) => {
    let pk = 1; for (const c of chans) for (let i = 0; i < c.length; i++) { const a = Math.abs(c[i]); if (a > pk) pk = a; }
    const n = chans[0].length, x = new Int16Array(n * chans.length);
    chans.forEach((c, k) => { for (let i = 0; i < n; i++) x[k * n + i] = Math.round((c[i] / pk) * 32767); });
    audio.push({ kind, key, ch: chans.length, n, at, pk, ...(meta ? { meta } : {}) }); parts.push(x); at += x.byteLength;
  };
  const V = voiceStore(S.song.id);
  for (const url of new Set(Object.values(data.seq.arr.voice || {}).map((v) => v.url))) { const d = await V.cell(url); if (d) put('voice', url, [d]); }
  for (const id of new Set([...text.matchAll(/"rec":"([^"]+)"/g)].map((m) => m[1]))) { const d = await V.rec(id); if (d) put('rec', id, [d]); }
  for (const c of await pieceStore(S.song.id).all()) { const { L, R, _pk, ...meta } = c; put('piece', c.id, [L, R], meta); }
  const head = new TextEncoder().encode(JSON.stringify({ format: 'playground', v: 1, from, saved: Date.now(), song: S.song.id, title: S.song.title, sr, data, audio }));
  const pad = (4 - ((12 + head.length) % 4)) % 4, top = new Uint8Array(12); for (let i = 0; i < 8; i++) top[i] = MAGIC.charCodeAt(i); new DataView(top.buffer).setUint32(8, head.length, true);
  const d = new Date(), day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return new File([top, head, new Uint8Array(pad), ...parts], `${S.song.title} ${day}.playground`, { type: 'application/octet-stream' });
}
/** Reads a project file (or an older .json one): { data, sounds, from }. Throws with words for the person. */
export async function readFile(file, song) {
  const ab = await file.arrayBuffer(), u = new Uint8Array(ab);
  const magic = u.length > 12 && String.fromCharCode(...u.subarray(0, 8)) === MAGIC;
  let m, base = 0;
  try {
    if (magic) { const n = new DataView(ab).getUint32(8, true); m = JSON.parse(new TextDecoder().decode(u.subarray(12, 12 + n))); base = 12 + n + ((4 - ((12 + n) % 4)) % 4); }
    else { const d = JSON.parse(new TextDecoder().decode(u)); m = { data: d, song: d.song, audio: [], from: 'computer' }; }
  } catch { throw new Error('it is not a playground file'); }
  const d = m.data; if (!d || !d.params || !d.seq?.arr || !Array.isArray(d.seq.arr.clips)) throw new Error('it is not a playground file');
  if (m.song && m.song !== song.id) throw new Error(m.title ? `it belongs to another song, ${m.title}` : 'it belongs to another song');
  const sounds = (m.audio || []).map((a) => {
    if (base + a.at + a.n * a.ch * 2 > ab.byteLength) throw new Error('the file is not complete');
    const ch = Array.from({ length: a.ch }, (_, k) => { const x = new Int16Array(ab, base + a.at + k * a.n * 2, a.n), y = new Float32Array(a.n), g = (a.pk || 1) / 32767; for (let i = 0; i < a.n; i++) y[i] = x[i] * g; return y; });
    return { ...a, chans: ch };
  });
  return { data: d, sounds, from: m.from, saved: m.saved };
}
/** Opens a file in place of what is here. The sounds go in first, so nothing is replaced unless all of it fits. */
export async function openFile(S, work, file) {
  const { data, sounds, from } = await readFile(file, S.song), V = voiceStore(S.song.id), PS = pieceStore(S.song.id); stay();
  try {
    for (const s of sounds) {
      if (s.kind === 'voice') await V.putCell(s.key, s.chans[0]);
      else if (s.kind === 'rec') await V.putRec(s.key, s.chans[0]);
      else if (s.kind === 'piece') await PS.put({ ...s.meta, id: s.key, L: s.chans[0], R: s.chans[1] || s.chans[0] });
    }
  } catch { throw new Error('there is no room for its sounds in this browser'); }
  if (from === 'computer' && data.params['song.bpm']) data.bpm = data.params['song.bpm'];   // the phone otherwise always starts at the song's own tempo
  delete data.at; await work.replace(data, 'before opening a file');
}
/** Hands a file over: the share sheet where there is one for it, otherwise a download. True unless the person changed their mind. */
export async function deliver(file, title) {
  if (navigator.canShare?.({ files: [file] }) && matchMedia('(pointer: coarse)').matches) { try { await navigator.share({ files: [file], title }); return true; } catch (e) { if (e?.name === 'AbortError') return false; } }
  download(file, file.name); return true;
}
const savedKey = (S) => `playground.saved.${S.song.id}`;
export const lastSaved = (S) => { try { return +localStorage.getItem(savedKey(S)) || 0; } catch { return 0; } };
export async function saveFile(S, from) { stay(); const f = await makeFile(S, from), ok = await deliver(f, S.song.title); if (ok) try { localStorage.setItem(savedKey(S), Date.now()); } catch { /* fine */ } return ok ? f : null; }
/** A hidden file field that opens what is chosen. */
export function fileField(S, work, say) {
  const inp = h('input', { type: 'file', hidden: true, onchange: async () => { const f = inp.files[0]; inp.value = ''; if (!f) return; try { await openFile(S, work, f); } catch (e) { say(`That file could not be opened: ${e.message}`); } } });   // no "accept": phones grey out kinds of files they do not know
  document.body.append(inp); return inp;
}
