// Fetch + decode cells on demand, keep a bounded LRU of decoded buffers. A full song decoded is ~2 GB;
// the player only ever needs the next few bars of each track, so it pins what it wants and the rest can go.
export class CellLoader {
  constructor(ctx, { max = 96, concurrency = 6 } = {}) {
    this.ctx = ctx; this.max = max; this.concurrency = concurrency;
    this.cache = new Map();   // url → AudioBuffer (insertion order = recency)
    this.pending = new Map(); // url → Promise
    this.queue = []; this.active = 0;
    this.pinned = new Set();
    this.reversed = new WeakMap();
    this.onload = null;
  }
  get(url) {
    const b = this.cache.get(url);
    if (b) { this.cache.delete(url); this.cache.set(url, b); }
    return b ?? null;
  }
  has(url) { return this.cache.has(url); }
  ensure(url, urgent = false) {
    if (!url || this.cache.has(url)) return Promise.resolve(this.cache.get(url));
    let p = this.pending.get(url);
    if (p) return p;
    p = new Promise((resolve, reject) => {
      const job = { url, resolve, reject };
      urgent ? this.queue.unshift(job) : this.queue.push(job);
    });
    this.pending.set(url, p);
    this.pump();
    return p;
  }
  load(url) { return this.ensure(url, true); }
  pump() {
    while (this.active < this.concurrency && this.queue.length) {
      const job = this.queue.shift();
      this.active++;
      fetch(job.url).then((r) => { if (!r.ok) throw new Error(`${r.status} ${job.url}`); return r.arrayBuffer(); })
        .then((ab) => this.ctx.decodeAudioData(ab))
        .then((buf) => { this.cache.set(job.url, buf); this.evict(); job.resolve(buf); this.onload?.(job.url); })
        .catch((e) => { console.warn('cell load failed', e); job.reject(e); })
        .finally(() => { this.pending.delete(job.url); this.active--; this.pump(); });
    }
  }
  evict() {
    if (this.cache.size <= this.max) return;
    for (const url of this.cache.keys()) {
      if (this.cache.size <= this.max) break;
      if (!this.pinned.has(url)) this.cache.delete(url);
    }
  }
  /** Reversed copy of a buffer (for reverse pads), cached alongside it. */
  reverse(buf) {
    let r = this.reversed.get(buf);
    if (r) return r;
    r = this.ctx.createBuffer(buf.numberOfChannels, buf.length, buf.sampleRate);
    for (let c = 0; c < buf.numberOfChannels; c++) { const s = buf.getChannelData(c), d = r.getChannelData(c); for (let i = 0, n = s.length; i < n; i++) d[i] = s[n - 1 - i]; }
    this.reversed.set(buf, r);
    return r;
  }
  get stats() { return { decoded: this.cache.size, loading: this.pending.size }; }
}
