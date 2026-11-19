import { $, $$, h, api, fmtTime, clamp, hexA, STATIC } from './lib/util.js';
/* on gunnartynes.com there is no server to keep other people's takes: they travel as links instead, so the gallery stays out */
if (STATIC) { document.querySelector('.gallery-wrap')?.remove(); const f = document.querySelector('footer'); if (f) f.innerHTML = 'made by the band · the stems are ours, the remixes are yours · share a take and its link carries your moves · <a href="/" style="color:inherit">gunnar tynes</a>'; }
import { Profile } from './state/profile.js';

const LEVEL_NAMES = ['wanderer', 'listener', 'tinkerer', 'remixer', 'conductor', 'weather-maker', 'gardener', 'cartographer', 'myth'];

const site = await api.get('/api/site');
document.title = `${site.bandName} — playground`;
$('#band').textContent = site.bandName;
// the band's tagline, with its first clause lit up
const [first, ...rest] = site.tagline.split(/(?<=—|,)/);
$('#tagline').replaceChildren(h('em', {}, first), rest.join(''));

const profile = new Profile();
$('#lvl-ring').textContent = profile.level;
$('#lvl-ring').style.setProperty('--p', Math.round(profile.progress * 100));
$('#lvl-name').textContent = LEVEL_NAMES[clamp(profile.level - 1, 0, LEVEL_NAMES.length - 1)];
$('#lvl-xp').textContent = `${profile.xp} xp · ${profile.got.size} trophies`;

const songs = await api.get('/api/songs');
const box = $('#songs');
if (!songs.length) box.append(h('div', { class: 'empty card' }, 'No songs yet. The band is still setting up the playground — come back soon.'));
for (const s of songs) {
  const cv = h('canvas', { width: 600, height: 300 });
  box.append(h('a', { class: 'island', href: `play.html?song=${s.id}`, style: { '--c': s.color } },
    h('span', { class: 'btn small hot go', style: { '--c': s.color } }, 'play →'),
    h('h3', {}, s.title),
    h('div', { class: 'meta' }, `${s.stems} musicians · ${s.bpm} bpm · ${s.bars} bars${STATIC ? '' : ` · ${s.remixes} take${s.remixes === 1 ? '' : 's'}`}`),
    s.blurb ? h('p', { class: 'dim', style: { maxWidth: '80%' } }, s.blurb) : '',
    h('div', { class: 'chips' }, s.sections.map((x) => h('span', {}, x))),
    cv));
  drawIsland(cv, s);
}

function drawIsland(cv, s) {
  // a little horizon: one wave per musician, phase-shifted, in the song's colour
  const g = cv.getContext('2d');
  let t = 0;
  const tick = () => {
    t += 0.01; g.clearRect(0, 0, 600, 300);
    for (let k = 0; k < Math.min(12, s.stems); k++) {
      g.strokeStyle = hexA(s.color, 0.08 + (k / 12) * 0.25); g.lineWidth = 1.5; g.beginPath();
      for (let x = 0; x <= 600; x += 6) {
        const y = 210 + k * 7 + Math.sin(x * 0.012 + t * (1 + k * 0.13) + k) * (12 + k * 1.5) + Math.sin(x * 0.031 - t * 2 + k * 3) * 4;
        x ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
    }
    requestAnimationFrame(tick);
  };
  tick();
}

async function loadGallery(sort = 'new') {
  const list = await api.get(`/api/remixes?sort=${sort}`);
  const gal = $('#gallery');
  if (!gal) return;
  gal.replaceChildren(...(list.length ? list.map((r) => h('a', { class: 'take', href: `play.html?remix=${r.id}` },
    h('span', { class: 'tiny faint' }, r.songTitle), h('b', {}, r.title),
    h('div', { class: 'row' }, h('span', {}, `by ${r.author}`), h('span', {}, `${fmtTime(r.duration)} · ♥ ${r.likes}`)))) :
    [h('div', { class: 'empty card' }, 'No takes yet. Be the first: press REC inside any song.')]));
}
$$('.tabs .btn').forEach((b) => b.addEventListener('click', () => { $$('.tabs .btn').forEach((x) => x.classList.toggle('on', x === b)); loadGallery(b.dataset.sort); }));
loadGallery();

// background sky
const sky = $('#sky'), sg = sky.getContext('2d');
const stars = Array.from({ length: 160 }, () => [Math.random(), Math.random(), Math.random()]);
(function drawSky(t = 0) {
  sky.width = innerWidth; sky.height = innerHeight;
  for (const [x, y, s] of stars) {
    sg.fillStyle = `rgba(245,240,255,${0.08 + 0.25 * (0.5 + 0.5 * Math.sin(t / 900 * (0.4 + s) + s * 20)) * s})`;
    sg.fillRect(x * innerWidth, y * innerHeight, 1 + s, 1 + s);
  }
  requestAnimationFrame(drawSky);
})();
