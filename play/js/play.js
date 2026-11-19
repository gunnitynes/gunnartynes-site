import { AudioEngine, SR } from './engine/audio.js';
import { CellLoader } from './engine/loader.js';
import { Player } from './engine/player.js';
import { Session, initialState, defaultTrack } from './state/session.js';
import { Profile, ACHIEVEMENTS, judge } from './state/profile.js';
import { $, h, api, download, fmtTime, clamp, STATIC } from './lib/util.js';
import { toast, chime } from './ui/toast.js';
import { Weather } from './worlds/weather.js';

// Worlds load lazily; each is a different game played on the same session.
const WORLDS = [
  { id: 'stars', name: 'Stars', sub: 'launch the song', glyph: '✶', color: 'var(--butter)', load: () => import('./worlds/stars.js') },
  { id: 'orbit', name: 'Orbit', sub: 'mix by gravity', glyph: '◎', color: 'var(--lilac)', load: () => import('./worlds/orbit.js') },
  { id: 'chop', name: 'Chop', sub: 'pads & steps', glyph: '▦', color: 'var(--peach)', load: () => import('./worlds/chop.js') },
  { id: 'evolve', name: 'Evolve', sub: 'breed remixes', glyph: '❦', color: 'var(--mint)', load: () => import('./worlds/evolve.js') },
  { id: 'sounds', name: 'Yours', sub: 'add your sound', glyph: '◉', color: 'var(--rose)', load: () => import('./worlds/sounds.js') },
];
const USER_COLORS = ['#ffffff', '#ff9ef0', '#9ef7ff', '#d4ff8a', '#ffd0a0', '#b8a4ff'];
const LEVEL_NAMES = ['wanderer', 'listener', 'tinkerer', 'remixer', 'conductor', 'weather-maker', 'gardener', 'cartographer', 'myth'];

const params = new URLSearchParams(location.search);
const app = { worlds: {}, active: null };
window.playground = app; // handy in the console

boot().catch((e) => { console.error(e); $('#splash-status').textContent = 'Could not load: ' + e.message; });

async function boot() {
  const remixId = params.get('remix');
  const remix = remixId ? await api.get(`/api/remixes/${remixId}`) : null;
  const songId = params.get('song') || remix?.song_id;
  if (!songId) { location.href = './'; return; }
  const [site, song] = await Promise.all([api.get('/api/site'), api.get(`/api/songs/${songId}`)]);
  document.title = `${song.title} — ${site.bandName} playground`;
  document.documentElement.style.setProperty('--accent', song.color);
  $('#song-title').textContent = song.title;
  $('#splash-band').textContent = `${song.artist} · ${song.bpm} bpm · ${song.stems.length} stems`;
  $('#splash-title').textContent = song.title;
  $('#splash-blurb').textContent = remix ? `“${remix.title}” — a take by ${remix.author}` : song.blurb;

  const profile = new Profile();
  const engine = new AudioEngine();
  await engine.ready;
  const loader = new CellLoader(engine.ctx);

  // the catalog: every playable source, the band's stems and the player's own sounds alike
  const catalog = new Map();
  for (const s of song.stems) {
    catalog.set(s.id, { id: s.id, kind: 'stem', name: s.name, color: s.color, group: s.group, gain: s.gain, cells: s.cells, barDb: s.barDb,
      lock: s.locked, locked: !!s.locked && !profile.isUnlocked(s.locked) });
  }
  const ids = song.stems.map((s) => s.id);
  const session = new Session(initialState(song, { catalogIds: ids }));
  const player = new Player(engine, loader, session, song);
  for (const [id, e] of catalog) player.addSource(id, e);
  player.addSource('__chop', { id: '__chop', kind: 'chop', name: 'Pads', color: '#ffb59e', group: 'pads', cells: [], gain: 1 });
  Object.assign(app, { song, site, profile, engine, loader, catalog, session, player, remix, toast, chime });

  app.addSound = async (snd, { addToSession = true } = {}) => {
    const id = 'snd_' + snd.id;
    if (!catalog.has(id)) {
      const n = [...catalog.values()].filter((c) => c.kind === 'sound').length;
      const entry = { id, kind: 'sound', soundId: snd.id, name: snd.name, color: USER_COLORS[n % USER_COLORS.length], group: 'yours', gain: 1, cells: snd.cells, author: snd.author };
      catalog.set(id, entry); player.addSource(id, entry);
    }
    if (addToSession && !session.state.tracks[id]) session.dispatch({ t: 'track/add', track: defaultTrack(id, { mode: 'follow' }) });
    return id;
  };
  // any sound tracks referenced by a saved session or a remix must be in the catalog before they can play
  const ensureSounds = async (state) => {
    for (const id of state.order.filter((x) => x.startsWith('snd_'))) {
      if (!catalog.has(id)) { try { await app.addSound(await api.get(`/api/sounds/${id.slice(4)}`), { addToSession: false }); } catch { /* removed by moderation */ } }
    }
  };

  // restore the player's last session for this song (a remix replay overrides it)
  const saveKey = `playground.session.${song.id}`;
  if (!remix) {
    try {
      const saved = JSON.parse(localStorage.getItem(saveKey));
      if (saved?.songId === song.id) {
        await ensureSounds(saved);
        saved.order = saved.order.filter((id) => catalog.has(id));
        for (const id of ids) if (!saved.tracks[id]) { saved.tracks[id] = defaultTrack(id); saved.order.push(id); }
        session.dispatch({ t: 'state/load', state: saved }, { log: false });
      }
    } catch { /* fresh start */ }
  } else await ensureSounds(remix.data.snapshot);
  let saveTimer;
  session.on(() => { if (session.replaying) return; clearTimeout(saveTimer); saveTimer = setTimeout(() => { try { localStorage.setItem(saveKey, JSON.stringify(session.state)); } catch {} }, 600); });

  judge(profile, session, player, catalog);
  wireProfile();
  buildHud();
  app.weather = new Weather(app, $('#weather'));
  buildWorldNav();

  // preload the first phrase of everything while the title card shows
  const startBar = remix ? (remix.data.startBar ?? 0) : 0;
  const first = session.state.order.map((id) => player.resolve(session.state.tracks[id], startBar)).filter(Boolean).map((w) => w.url);
  if (player.chopUrl()) first.push(player.chopUrl());
  let done = 0;
  const bar = $('#splash-bar'), status = $('#splash-status');
  await Promise.all(first.map((u) => loader.load(u).catch(() => {}).finally(() => {
    done++; bar.style.width = `${(done / first.length) * 100}%`; status.textContent = `waking the musicians · ${done}/${first.length}`;
  })));
  status.textContent = remix ? 'ready to listen' : 'ready';
  const go = $('#splash-go');
  go.disabled = false;
  if (remix) go.textContent = 'Listen to the take';
  go.onclick = async () => {
    await engine.ctx.resume();
    $('#splash').classList.add('gone');
    await openWorld(params.get('world') || (remix ? 'orbit' : 'stars'));
    if (remix) startReplay(); else player.play(0);
  };
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ worlds

function buildWorldNav() {
  const nav = $('#worlds');
  for (const w of WORLDS) {
    const b = h('button', { class: 'world-btn', 'data-w': w.id, style: { '--wc': w.color }, onclick: () => openWorld(w.id) },
      h('span', { class: 'glyph' }, w.glyph), w.name, h('small', {}, w.sub));
    nav.append(b);
  }
}

async function openWorld(id) {
  const def = WORLDS.find((w) => w.id === id) ?? WORLDS[0];
  if (!app.worlds[def.id]) {
    const mod = await def.load();
    const el = h('section', { class: 'world', id: `w-${def.id}` });
    $('#stage').append(el);
    app.worlds[def.id] = new mod.default(app, el);
  }
  for (const [k, w] of Object.entries(app.worlds)) {
    const on = k === def.id;
    w.el.classList.toggle('active', on);
    if (on) w.show?.(); else if (app.active === w) w.hide?.();
  }
  app.active = app.worlds[def.id];
  document.querySelectorAll('.world-btn').forEach((b) => b.classList.toggle('active', b.dataset.w === def.id));
  const u = new URL(location.href); u.searchParams.set('world', def.id); history.replaceState(null, '', u);
}
app.openWorld = openWorld;

let last = performance.now();
function frame(t) {
  const dt = Math.min(0.1, (t - last) / 1000); last = t;
  updateHud();
  app.active?.frame?.(t / 1000, dt);
  app.weather?.frame(t / 1000, dt);
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ HUD + transport

const scopeBuf = new Float32Array(2048);
function buildHud() {
  const { player, session } = app;
  $('#t-play').onclick = () => togglePlay();
  $('#t-rew').onclick = () => session.dispatch({ t: 'seek', bar: 0 });
  $('#t-tape').onclick = () => { if (app.take) stopTake(); session.dispatch({ t: 'fx', fx: 'tapestop' }); };
  $('#t-rec').onclick = () => app.take ? stopTake() : startTake();
  $('#lvl').onclick = showTrophies;
  player.on('transport', ({ playing }) => { $('#t-play').textContent = playing ? '■' : '▶'; });
  addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select, dialog') || e.metaKey || e.ctrlKey) return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'r' && !e.repeat && app.active !== app.worlds.chop) { app.take ? stopTake() : startTake(); }
    else if (e.key === 'w' && app.active !== app.worlds.chop) app.weather.toggle();
    else if (e.key === 'Home') session.dispatch({ t: 'seek', bar: 0 });
  });
}

function togglePlay() {
  const { player } = app;
  if (player.replay) return player.playing ? player.stop() : player.play();
  if (player.playing) { if (app.take) stopTake(); player.stop(); } else player.play();
}

function updateHud() {
  const { player, song, engine } = app;
  const beat = player.playing ? (engine.ctx.currentTime - player.bar0) / player.beatDur : player.pausedBar * song.beatsPerBar;
  const b = Math.max(0, beat);
  const bar = Math.floor(b / song.beatsPerBar);
  $('#pos-bar').textContent = (bar % song.numBars) + 1;
  $('#pos-beat').textContent = Math.floor(b % song.beatsPerBar) + 1;
  const songBar = bar % song.numBars;
  const sec = song.sections.find((s) => songBar >= s.startCell * song.barsPerCell && songBar < s.endCell * song.barsPerCell);
  const chip = $('#pos-section');
  if (chip.textContent !== (sec?.name ?? '')) chip.textContent = sec?.name ?? '';
  if (app.take) $('#rec-label').textContent = app.take.armed ? 'ARMED' : fmtTime(Math.max(0, engine.ctx.currentTime - app.take.t0));

  const cv = $('#hud-scope'), g = cv.getContext('2d');
  const W = cv.width = cv.clientWidth * 2, H = cv.height = cv.clientHeight * 2;
  engine.analyser.getFloatTimeDomainData(scopeBuf);
  g.clearRect(0, 0, W, H);
  g.lineWidth = 2.5; g.strokeStyle = song.color; g.globalAlpha = 0.9; g.beginPath();
  for (let i = 0; i < 512; i++) { const x = (i / 511) * W, y = H / 2 + scopeBuf[i * 2] * H * 0.8; i ? g.lineTo(x, y) : g.moveTo(x, y); }
  g.stroke();
}

// ------------------------------------------------------------------ takes: record, download, share

function startTake() {
  const { player, engine, session, song } = app;
  if (player.replay) takeOver();
  let B;
  if (!player.playing) { B = player.pausedBar; player.play(B); }
  else { B = player.barNow() + 1; if (player.timeOfBar(B) - engine.ctx.currentTime < 0.08) B++; }
  const T = player.timeOfBar(B);
  const rec = engine.recordMaster(Math.round(T * SR));
  app.take = { armed: true, rec, t0: T, B };
  $('#t-rec').classList.add('armed');
  // the take begins exactly on the bar line: the audio tap starts at that frame, the event log at that beat
  setTimeout(() => {
    if (!app.take) return;
    app.take.armed = false;
    session.beginTake(player.elapsed(), B % song.numBars);
    session.take.startBeat = (T - player.clockOrigin) / player.beatDur;
    $('#t-rec').classList.remove('armed'); $('#t-rec').classList.add('on');
  }, Math.max(0, (T - engine.ctx.currentTime) * 1000));
}

async function stopTake() {
  const { engine, session, player, profile } = app;
  const take = app.take; app.take = null;
  $('#t-rec').classList.remove('on', 'armed'); $('#rec-label').textContent = 'REC';
  if (!take) return;
  if (take.armed) { await take.rec.stop(Math.round(engine.ctx.currentTime * SR)); return; }
  const data = session.endTake(player.elapsed());
  const audio = await take.rec.stop(Math.round(engine.ctx.currentTime * SR));
  if (audio.seconds < 1) return toast({ icon: '·', title: 'Too short', text: 'That take was under a second.' });
  profile.award('taper');
  data.sounds = session.state.order.filter((id) => id.startsWith('snd_')).map((id) => id.slice(4));
  showTakeDialog(data, audio);
}

function showTakeDialog(data, audio) {
  const { song, profile, remix } = app;
  const dlg = $('#take-dialog');
  const cv = h('canvas', { class: 'take-wave', width: 960, height: 140 });
  const title = h('input', { type: 'text', placeholder: 'name your take', value: '', maxlength: 60 });
  const author = h('input', { type: 'text', placeholder: 'your name', value: profile.name, maxlength: 40 });
  const shareBtn = h('button', { class: 'btn hot' }, STATIC ? '⌁ Share as a link' : '⌁ Share to the gallery');
  const out = h('div', { class: 'dlg-row' });
  dlg.replaceChildren(
    h('h2', {}, 'Your take'),
    h('p', { class: 'dim' }, `${fmtTime(audio.seconds)} · ${data.events.length} moves recorded`),
    cv,
    h('div', { class: 'dlg-row' }, title, author),
    h('div', { class: 'dlg-row' },
      h('button', { class: 'btn', onclick: () => download(audio.wav(), `${song.title} — ${title.value || 'take'}.wav`) }, '↓ Download WAV'),
      shareBtn,
      h('button', { class: 'btn ghost', onclick: () => dlg.close() }, 'Close')),
    h('p', { class: 'faint tiny', style: { marginTop: '14px' } }, STATIC ? 'The link carries your MOVES, not the audio — anyone who opens it replays your take on the real stems and can take it over from there. Sounds you added yourself stay on your device.' : 'Sharing saves your MOVES, not the audio — anyone can replay it on the real stems and take it over from there.'),
    out,
  );
  const g = cv.getContext('2d'); g.fillStyle = song.color;
  const step = Math.max(1, Math.floor(audio.L.length / 960));
  for (let x = 0; x < 960; x++) { let m = 0; for (let i = x * step; i < (x + 1) * step && i < audio.L.length; i++) m = Math.max(m, Math.abs(audio.L[i])); g.fillRect(x, 70 - m * 66, 1, m * 132 + 1); }
  shareBtn.onclick = async () => {
    shareBtn.disabled = true;
    profile.name = author.value.trim(); profile.save();
    try {
      const { id } = await api.post('/api/remixes', { songId: song.id, title: title.value || 'untitled', author: author.value, data, duration: audio.seconds, forkedFrom: remix?.id });
      const url = new URL(`play.html?remix=${id}`, location.href).href;
      profile.award('broadcaster');
      out.replaceChildren(h('input', { type: 'text', value: url, readonly: true, onclick: (e) => e.target.select() }),
        h('button', { class: 'btn small', onclick: () => navigator.clipboard?.writeText(url) }, 'copy link'));
    } catch (e) { shareBtn.disabled = false; toast({ icon: '!', title: 'Could not share', text: e.message }); }
  };
  dlg.showModal();
}

// ------------------------------------------------------------------ replaying someone's take

function startReplay() {
  const { player, remix } = app;
  const banner = $('#replay-banner');
  const likeBtn = h('button', { class: 'btn small', onclick: async () => {
    if (app.profile.liked.has(remix.id)) return;
    await api.post(`/api/remixes/${remix.id}/like`, {}); app.profile.liked.add(remix.id); app.profile.save(); likeBtn.textContent = '♥ liked';
  } }, app.profile.liked.has(remix.id) ? '♥ liked' : '♡ like');
  banner.replaceChildren(h('span', {}, `▶ “${remix.title}” by ${remix.author}`), ...(STATIC ? [] : [likeBtn]),
    h('button', { class: 'btn small', onclick: () => { player.endReplay(); player.stop(); startReplay(); } }, '↺ again'),
    h('button', { class: 'btn small', onclick: takeOver }, 'take over →'));
  banner.hidden = false;
  player.startReplay(remix.data, { onEnd: () => toast({ icon: '■', title: 'End of the take', text: 'Press “again”, or take it over and make it yours.' }) });
}

function takeOver() {
  app.player.endReplay();
  $('#replay-banner').hidden = true;
  toast({ icon: '→', title: 'It’s yours now', text: 'Everything you change from here is your remix.' });
}

// ------------------------------------------------------------------ profile, trophies, unlocks

function wireProfile() {
  const { profile, catalog, player, session } = app;
  const paint = () => {
    $('#lvl-ring').textContent = profile.level;
    $('#lvl-ring').style.setProperty('--p', Math.round(profile.progress * 100));
    $('#lvl-name').textContent = LEVEL_NAMES[clamp(profile.level - 1, 0, LEVEL_NAMES.length - 1)];
    $('#lvl-xp').textContent = `${profile.xp} xp`;
  };
  paint();
  const checkUnlocks = () => {
    for (const e of catalog.values()) {
      if (e.locked && profile.isUnlocked(e.lock)) {
        e.locked = false;
        player.applyMix(session.state);
        chime('unlock');
        toast({ icon: '🔓', title: `Unlocked: ${e.name}`, text: 'A hidden part of the song just woke up.', color: e.color });
        session.dispatchEvent(new CustomEvent('change', { detail: { a: { t: 'unlock', id: e.id }, prev: session.state, state: session.state } }));
      }
    }
  };
  profile.on('xp', () => { paint(); checkUnlocks(); });
  profile.on('achievement', (a) => { chime('achievement'); toast({ icon: a.icon, title: a.name, text: `${a.desc}  +${a.xp} xp` }); });
  profile.on('level', ({ level }) => { chime('level'); toast({ icon: level, title: `Level ${level}`, text: `You are now a ${LEVEL_NAMES[clamp(level - 1, 0, LEVEL_NAMES.length - 1)]}.`, color: 'var(--mint)' }); });
}

function showTrophies() {
  const { profile, catalog } = app;
  const dlg = $('#trophy-dialog');
  const locked = [...catalog.values()].filter((e) => e.lock);
  dlg.replaceChildren(
    h('h2', {}, `Level ${profile.level} · ${profile.xp} xp`),
    h('div', { class: 'trophies' }, ACHIEVEMENTS.map((a) => h('div', { class: 'trophy' + (profile.got.has(a.id) ? ' got' : '') },
      h('div', { class: 'i' }, a.icon), h('b', {}, a.name), h('small', {}, a.desc)))),
    locked.length ? h('div', {}, h('h3', { style: { marginTop: '18px' } }, 'Hidden sounds'),
      ...locked.map((e) => h('p', { class: 'dim' }, `${e.locked ? '🔒' : '🔓'} ${e.locked ? '???' : e.name} — ${e.locked ? profile.lockHint(e.lock) : 'unlocked'}`))) : '',
    h('div', { class: 'dlg-row' }, h('button', { class: 'btn', onclick: () => dlg.close() }, 'Close')),
  );
  dlg.showModal();
}
