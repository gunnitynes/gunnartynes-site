// The game layer: XP, levels, achievements and unlockable stems. Kept in localStorage — it is a toy, not a bank.
// Achievements are judged from the same action stream the engine hears, so they reward musical gestures
// (a real drop, a long orbit, a fifth generation) rather than clicks.

const KEY = 'playground.profile.v1';

export const ACHIEVEMENTS = [
  { id: 'first-light', name: 'First Light', desc: 'Press play for the first time.', xp: 20, icon: '✦' },
  { id: 'astronomer', name: 'Astronomer', desc: 'Launch 10 stars in the Constellation.', xp: 40, icon: '✶' },
  { id: 'scene-change', name: 'Scene Change', desc: 'Jump the whole band to another part of the song.', xp: 30, icon: '⇥' },
  { id: 'the-drop', name: 'The Drop', desc: 'Take the drums away for at least 4 bars, then bring them back.', xp: 80, icon: '⤓' },
  { id: 'gravity', name: 'Gravity', desc: 'Fling an orb into orbit.', xp: 30, icon: '◎' },
  { id: 'lullaby', name: 'Lullaby', desc: 'Put five sounds to sleep at the same time.', xp: 40, icon: '☾' },
  { id: 'butcher', name: 'Chop Shop', desc: 'Hit 50 pads.', xp: 40, icon: '▦' },
  { id: 'drummer', name: 'Machine Heart', desc: 'Run a step pattern with 8+ hits for 4 bars.', xp: 60, icon: '♥' },
  { id: 'darwin', name: 'Natural Selection', desc: 'Breed a fifth generation of creatures.', xp: 80, icon: '❦' },
  { id: 'weather-maker', name: 'Weather Maker', desc: 'Call down thunder.', xp: 25, icon: 'ϟ' },
  { id: 'frozen-lake', name: 'Frozen Lake', desc: 'Freeze the echoes.', xp: 25, icon: '❄' },
  { id: 'your-voice', name: 'Your Voice Here', desc: 'Add a sound of your own to the song.', xp: 100, icon: '◉' },
  { id: 'taper', name: 'On Tape', desc: 'Record a take.', xp: 60, icon: '⏺' },
  { id: 'broadcaster', name: 'Broadcaster', desc: 'Share a take with the world.', xp: 120, icon: '⌁' },
  { id: 'tape-stop', name: 'Power Cut', desc: 'Stop the tape like you mean it.', xp: 15, icon: '⏏' },
];

export const levelFor = (xp) => { let lv = 1; while (xp >= need(lv + 1)) lv++; return lv; };
export const need = (lv) => Math.round(80 * (lv - 1) ** 1.6); // xp needed to reach level lv

const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) ?? null; } catch { return null; } };

export class Profile extends EventTarget {
  constructor() {
    super();
    const p = load() ?? {};
    this.name = p.name ?? '';
    this.xp = p.xp ?? 0;
    this.got = new Set(p.got ?? []);
    this.counters = p.counters ?? {};
    this.sounds = p.sounds ?? {};   // songId → [soundIds]
    this.liked = new Set(p.liked ?? []);
  }
  get level() { return levelFor(this.xp); }
  get progress() { const a = need(this.level), b = need(this.level + 1); return (this.xp - a) / (b - a); }
  save() {
    try { localStorage.setItem(KEY, JSON.stringify({ name: this.name, xp: this.xp, got: [...this.got], counters: this.counters, sounds: this.sounds, liked: [...this.liked] })); } catch { /* private mode */ }
  }
  addXp(n, why) {
    const before = this.level; this.xp += n; this.save();
    this.emit('xp', { n, why });
    if (this.level > before) this.emit('level', { level: this.level });
  }
  award(id) {
    if (this.got.has(id)) return;
    const a = ACHIEVEMENTS.find((x) => x.id === id); if (!a) return;
    this.got.add(id); this.save();
    this.emit('achievement', a);
    this.addXp(a.xp, a.name);
  }
  count(key, n = 1) { this.counters[key] = (this.counters[key] ?? 0) + n; this.save(); return this.counters[key]; }

  /** Lock syntax from the band's admin: "level:3", "achievement:the-drop", or several joined by commas (all must hold). */
  isUnlocked(lock) {
    if (!lock) return true;
    return lock.split(',').every((cond) => {
      const [k, v] = cond.trim().split(':');
      if (k === 'level') return this.level >= +v;
      if (k === 'achievement') return this.got.has(v);
      if (k === 'xp') return this.xp >= +v;
      return true;
    });
  }
  lockHint(lock) {
    return lock.split(',').map((cond) => {
      const [k, v] = cond.trim().split(':');
      if (k === 'level') return `reach level ${v}`;
      if (k === 'achievement') return `earn “${ACHIEVEMENTS.find((a) => a.id === v)?.name ?? v}”`;
      if (k === 'xp') return `collect ${v} xp`;
      return cond;
    }).join(' and ');
  }
  emit(t, d) { this.dispatchEvent(new CustomEvent(t, { detail: d })); }
  on(t, fn) { this.addEventListener(t, (e) => fn(e.detail)); }
}

/** Watches the session + player and hands out achievements. */
export function judge(profile, session, player, catalog) {
  const rhythm = () => session.state.order.filter((id) => catalog.get(id)?.group === 'rhythm');
  let drumsGoneAt = null, seqHitsBars = 0;
  const audibleRhythm = (s) => rhythm().some((id) => { const t = s.tracks[id]; return t && !t.mute && t.mode !== 'off' && t.gain > 0.05; });

  player.on('transport', ({ playing, tape }) => {
    if (playing) profile.award('first-light');
    if (tape) profile.award('tape-stop');
  });
  player.on('bar', ({ bar }) => {
    const s = session.state;
    if (player.playing) profile.count('bars');
    if (player.playing && profile.counters.bars % 32 === 0) profile.addXp(5, 'playing');
    const has = audibleRhythm(s);
    if (!has && drumsGoneAt === null) drumsGoneAt = bar;
    if (has && drumsGoneAt !== null) { if (bar - drumsGoneAt >= 4) profile.award('the-drop'); drumsGoneAt = null; }
    const hits = s.chop.steps.filter((x) => x >= 0).length;
    seqHitsBars = s.chop.seq && hits >= 8 ? seqHitsBars + 1 : 0;
    if (seqHitsBars >= 4) profile.award('drummer');
  });
  player.on('pad', () => { if (!session.replaying && profile.count('pads') >= 50) profile.award('butcher'); });
  session.on(({ a, state }) => {
    if (session.replaying) return;
    if (a.g === 'scene') profile.award('scene-change');
    if (a.t === 'track/set' && a.p.mode === 'loop' && profile.count('launches') >= 10) profile.award('astronomer');
    if (a.t === 'fx' && a.fx === 'thunder') profile.award('weather-maker');
    if (a.t === 'weather/set' && a.p.freeze) profile.award('frozen-lake');
    if (a.t === 'track/add') profile.award('your-voice');
    if (a.t === 'track/set' && a.p.mute !== undefined) {
      if (Object.values(state.tracks).filter((t) => t.mute && t.orb).length >= 5) profile.award('lullaby');
    }
  });
}
