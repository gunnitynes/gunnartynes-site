// A clock that keeps ticking while the page is busy or in the background: the timer lives in a worker, where nothing
// else runs. (The page's own timers are held up by drawing, and slowed to one a second when it is hidden.)
let w = null; const subs = new Set();
export function onTick(fn) {
  subs.add(fn);
  if (!w) { try { w = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 25)'], { type: 'text/javascript' }))); w.onmessage = () => { for (const f of subs) f(); }; w.onerror = () => { w.terminate(); w = {}; setInterval(() => { for (const f of subs) f(); }, 25); }; } catch { w = {}; setInterval(() => { for (const f of subs) f(); }, 25); } }
  return () => subs.delete(fn);
}
