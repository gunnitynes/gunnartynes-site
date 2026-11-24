// iPhones and iPads treat sound made by a page like a ringtone: with the phone on silent it is not heard from the
// speaker (headphones are not affected). Two things say "this is music, play it":
//   · the audio session (iOS 16.4 and later): type "playback", or "play-and-record" while the microphone is open
//   · a real media element playing real silence, round and round, while the song plays (older ones)
// It also wakes the sound when the output changes (headphones in or out), which can leave it stuck.
const IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let el = null, want = false;
const session = (type) => { try { if (navigator.audioSession && navigator.audioSession.type !== type) navigator.audioSession.type = type; } catch { /* not here */ } };
function silence() {
  if (el) return el;
  const n = 8000, b = new Uint8Array(44 + n), v = new DataView(b.buffer), s = (o, t) => { for (let i = 0; i < t.length; i++) b[o + i] = t.charCodeAt(i); };   // one second, 8 bit (128 is silence)
  s(0, 'RIFF'); v.setUint32(4, 36 + n, true); s(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true); s(36, 'data'); v.setUint32(40, n, true); b.fill(128, 44);
  el = document.createElement('audio'); el.src = URL.createObjectURL(new Blob([b], { type: 'audio/wav' })); el.loop = true; el.preload = 'auto'; el.setAttribute('playsinline', ''); el.setAttribute('x-webkit-airplay', 'deny'); el.disableRemotePlayback = true;
  return el;
}
const hold = () => { if (IOS && want && !document.hidden) silence().play().catch(() => { /* needs a finished touch: the next one */ }); };
/** Call on a finished touch (touchend or click). Safe to call again and again. */
export function wakeSpeaker(ctx) {
  session('playback'); if (ctx.state !== 'running') ctx.resume();
  if (!IOS || wakeSpeaker.done) { hold(); return; } wakeSpeaker.done = true; want = true; hold();
  // one sample of Web Audio inside the touch, so the context itself counts as started by it
  try { const s = ctx.createBufferSource(); s.buffer = ctx.createBuffer(1, 1, ctx.sampleRate); s.connect(ctx.destination); s.start(0); } catch { /* fine */ }
  const back = () => { if (document.hidden) return; hold(); if (ctx.state !== 'running') ctx.resume(); };
  document.addEventListener('visibilitychange', back); addEventListener('pageshow', back); addEventListener('focus', back);
  addEventListener('touchend', () => { if (ctx.state !== 'running') ctx.resume(); if (el?.paused) hold(); }, true);
  ctx.addEventListener('statechange', () => { if (ctx.state === 'interrupted') ctx.resume().catch(() => {}); });
  let t = 0; navigator.mediaDevices?.addEventListener?.('devicechange', () => { if (micOpen) return; clearTimeout(t); t = setTimeout(async () => { try { await ctx.suspend(); await ctx.resume(); } catch { /* the next touch */ } hold(); }, 350); });
}
let micOpen = false;
/** The microphone needs the other kind of session; afterwards it goes back to playing music. */
export function micSession(on) { micOpen = on; session(on ? 'play-and-record' : 'playback'); if (!on) setTimeout(hold, 250); }
session('playback');
