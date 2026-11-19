// One state, many lenses. Every world (Stars, Orbit, Chop, Evolve, Sounds, Weather) reads and writes the SAME
// session through dispatch(), so a mix made by flinging orbs keeps playing when you go chop it up — and because
// every change is an action with a beat-time, a whole performance can be recorded as a tiny event list and
// replayed by anyone, exactly, on top of the stems.

export const defaultTrack = (id, extra = {}) => ({
  id, gain: 1, pan: 0, lp: 1, rev: 0.06, dly: 0, mute: false, solo: false,
  mode: 'follow', cell: 0, pattern: null, orb: null, ...extra,
});

export function initialState(song, { catalogIds = [] } = {}) {
  const tracks = {};
  for (const id of catalogIds) tracks[id] = defaultTrack(id);
  return {
    songId: song.id,
    order: [...catalogIds],
    tracks,
    weather: { x: 0, y: 0, freeze: false },
    chop: { track: null, cell: 0, steps: Array(16).fill(-1), seq: false, pitch: 0, reverse: false, choke: true, len: 1, gain: 1 },
  };
}

function reduce(s, a) {
  switch (a.t) {
    case 'track/set': {
      const tr = s.tracks[a.id]; if (!tr) return s;
      return { ...s, tracks: { ...s.tracks, [a.id]: { ...tr, ...a.p } } };
    }
    case 'tracks/set': {
      const tracks = { ...s.tracks };
      for (const [id, p] of Object.entries(a.p)) if (tracks[id]) tracks[id] = { ...tracks[id], ...p };
      return { ...s, tracks };
    }
    case 'track/add':
      if (s.tracks[a.track.id]) return s;
      return { ...s, order: [...s.order, a.track.id], tracks: { ...s.tracks, [a.track.id]: a.track } };
    case 'track/remove': {
      const tracks = { ...s.tracks }; delete tracks[a.id];
      return { ...s, order: s.order.filter((x) => x !== a.id), tracks, chop: s.chop.track === a.id ? { ...s.chop, track: null } : s.chop };
    }
    case 'weather/set': return { ...s, weather: { ...s.weather, ...a.p } };
    case 'chop/set': return { ...s, chop: { ...s.chop, ...a.p } };
    case 'state/load': return structuredClone(a.state);
    default: return s; // transient actions (pad, fx, seek) change no state; the player hears them
  }
}

export class Session extends EventTarget {
  constructor(state) {
    super();
    this.state = state;
    this.clock = () => 0;   // → current beat (set by the player)
    this.take = null;       // { startBeat, events, snapshot } while recording
    this.replaying = false;
  }
  dispatch(a, { log = true } = {}) {
    const prev = this.state;
    this.state = reduce(prev, a);
    if (this.take && log && !this.replaying) {
      // a quantised pad hit carries the beat it will actually sound on
      const ev = { b: +((a.atBeat ?? this.clock()) - this.take.startBeat).toFixed(4), a: a.at === undefined ? a : { ...a, at: undefined } };
      // collapse runs of continuous gestures (dragging an orb, sweeping the weather) to ~1/16 note resolution
      const last = this.take.events[this.take.events.length - 1];
      if (last && sameGesture(last.a, a) && ev.b - last.b < 0.25) { last.a = mergeGesture(last.a, a); }
      else this.take.events.push(ev);
    }
    this.dispatchEvent(new CustomEvent('change', { detail: { a, prev, state: this.state } }));
  }
  on(fn) { const h = (e) => fn(e.detail); this.addEventListener('change', h); return () => this.removeEventListener('change', h); }

  /** startBeat is on the performance clock; startBar is where in the song the take begins. */
  beginTake(startBeat, startBar) { this.take = { startBeat, startBar, events: [], snapshot: structuredClone(this.state) }; }
  endTake(endBeat) {
    const t = this.take; this.take = null;
    if (!t) return null;
    return { snapshot: t.snapshot, events: t.events, lengthBeats: +(endBeat - t.startBeat).toFixed(3), startBar: t.startBar };
  }
}

const gestureKey = (a) => a.t === 'track/set' ? `ts:${a.id}:${Object.keys(a.p).sort()}` : a.t === 'weather/set' ? `ws:${Object.keys(a.p).sort()}`
  : a.t === 'tracks/set' && a.g ? `tg:${a.g}` : null;
const sameGesture = (x, y) => { const k = gestureKey(x); return k !== null && k === gestureKey(y); };
const mergeGesture = (x, y) => y.t === 'tracks/set' ? y : { ...x, p: { ...x.p, ...y.p } };
