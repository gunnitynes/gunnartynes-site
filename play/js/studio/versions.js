// Versions: every few minutes (when something changed) your whole project is put aside as a version, in the
// browser's own storage. Listen to any of them in place — switch back and forth while it plays — then keep it, or
// go back to now.
const DB = 'playground-versions', MAX = 40;
let dbp = null;
const db = () => (dbp ??= new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore('v'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
async function tx(mode, fn) { const d = await db(); return new Promise((res, rej) => { const t = d.transaction('v', mode), r = fn(t.objectStore('v')); t.oncomplete = () => res(r?.result); t.onerror = () => rej(t.error); }); }

export class Versions extends EventTarget {
  constructor(S, { every = 3 } = {}) {
    super(); this.S = S; this.list = []; this.listening = null; this.now = null; this.lastJson = '';
    this.load().then(() => this.save('when you came in'));
    setInterval(() => { if (!this.listening) this.save(); }, every * 60000);
  }
  get pre() { return `${this.S.song.id}:`; }
  async load() {
    const keys = (await tx('readonly', (s) => s.getAllKeys()).catch(() => [])).filter((k) => String(k).startsWith(this.pre)).sort();
    this.list = (await Promise.all(keys.map((k) => tx('readonly', (s) => s.get(k)).catch(() => null)))).filter(Boolean).reverse();
    this.emit();
  }
  /** Put the project aside now, if it changed since the last one. */
  async save(label = '') {
    const d = this.S.projectData(), j = JSON.stringify({ p: d.params, s: d.seq, b: d.band });
    if (j === this.lastJson || j === (this.list[0] && JSON.stringify({ p: this.list[0].data.params, s: this.list[0].data.seq, b: this.list[0].data.band }))) { this.lastJson = j; return; }
    this.lastJson = j;
    const q = this.S.seq, takes = new Set(q.arr.clips.filter((c) => c.pat && !'ABCDEFGHIJKLMNOP'.includes(c.pat)).map((c) => c.pat)).size;
    const v = { ts: Date.now(), label, data: d, summary: `${q.arr.bars} bars · ${q.arr.clips.length} pieces${takes ? ` · ${takes} take${takes > 1 ? 's' : ''}` : ''}${Object.keys(q.arr.voice || {}).length ? ' · audio' : ''}` };
    await tx('readwrite', (s) => s.put(v, this.pre + String(v.ts).padStart(15, '0'))).catch(() => {});
    this.list.unshift(v);
    for (const old of this.list.splice(MAX)) tx('readwrite', (s) => s.delete(this.pre + String(old.ts).padStart(15, '0'))).catch(() => {});
    this.emit();
  }
  /** Hear a version in place (what you have now is held aside). */
  listen(v) { if (!this.now) this.now = this.S.projectData(); this.listening = v; this.S.applyLive(v.data); this.emit(); }
  back() { if (!this.now) return; this.S.applyLive(this.now); this.now = null; this.listening = null; this.emit(); }
  keep() { this.now = null; this.listening = null; this.save('kept from an earlier version'); this.emit(); }
  emit() { this.dispatchEvent(new Event('change')); }
}
export const ago = (ts) => { const m = Math.round((Date.now() - ts) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(ts).toLocaleDateString(); };
