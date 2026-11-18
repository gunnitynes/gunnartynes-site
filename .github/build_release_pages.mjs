// Writes one plain page per release at r/<id>/index.html, so every release has its own address that can be shared
// (with its cover in the preview) and found by search engines; also writes sitemap.xml.
// Only releases on the main timeline get a page; a hidden or deleted release loses its page on the next run.
// Run after any catalogue change (it also restores a missing page): node .github/build_release_pages.mjs  (the GitHub workflow does this on every push)
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://gunnartynes.com';
const read = (f, k) => { const t = readFileSync(join(ROOT, f), 'utf8'); return JSON.parse(t.slice(t.indexOf(k), t.lastIndexOf(k === '[' ? ']' : '}') + 1)); };
const ALL = read('catalogue.js', '[');
const EXTRA = existsSync(join(ROOT, 'extra.js')) ? read('extra.js', '{') : {};
const list = ALL.filter(e => e.tier === 'core' && !e.hide);   // already in timeline order
const H = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
const ROLE = { P: 'Produced', R: 'Recorded', M: 'Mixed', B: 'Band, performed, wrote', F: 'Film & screen' };
const LINKS = { discogs: 'Discogs', bandcamp: 'Bandcamp', apple: 'Apple Music', spotify: 'Spotify', imdb: 'IMDb', musicbrainz: 'MusicBrainz' };
const abs = p => p && !/^https?:/.test(p) ? `${SITE}/${p.replace(/^\/+/, '')}` : p;
const fmtMs = ms => ms ? `${Math.floor(ms / 60000)}:${String(Math.round(ms / 1000) % 60).padStart(2, '0')}` : '';

function part(e) {
  const bits = [];
  if (e.roleText) bits.push(e.roleText.trim().replace(/\.?$/, '.'));
  if (e.film && e.film.role) bits.push(cap(e.film.role.trim()).replace(/\.?$/, '.'));
  return bits.join(' ');
}
function description(e) {
  const roles = (e.roles || []).map(r => ROLE[r]).filter(Boolean).join(', ');
  let d = `${e.title}, ${e.artist}, ${e.year}${e.type ? ` (${e.type.toLowerCase()})` : ''}. Gunnar Tynes${roles ? `: ${roles.toLowerCase()}` : ''}. ${part(e)}`;
  d = d.replace(/\s+/g, ' ').trim();
  return d.length > 158 ? d.slice(0, 155).replace(/\s\S*$/, '') + '…' : d;
}
function page(e, i) {
  const x = EXTRA[e.id] || {}, prev = list[i - 1], next = list[i + 1];
  const url = `${SITE}/r/${e.id}/`, cover = e.cover ? abs(e.cover) : `${SITE}/og/home.jpg`;
  const screen = (e.roles || []).includes('F') && (e.screen || e.film);
  const facts = [e.type, (e.labels || []).join(', '), (x.fmt || e.formats || []).slice(0, 2).join(', '), x.country, (x.cat || [])[0]].filter(Boolean);
  const tracks = (e.tracks || []).length ? e.tracks.map(t => ({ n: t.n, t: t.t, d: fmtMs(t.ms), p: t.p })) : (x.tracks || []).map(t => ({ n: t[0], t: t[1], d: t[2] }));
  const bite = e.bite && e.bite.src ? { t: e.bite.title || 'Listen', p: abs(e.bite.src) } : null;
  const links = Object.keys(LINKS).filter(k => (e.links || {})[k]).map(k => `<a href="${H(e.links[k])}" rel="noopener">${LINKS[k]}</a>`);
  const f = e.film || {};
  const ld = {
    '@context': 'https://schema.org', '@type': screen ? (/series/i.test(f.kind || '') ? 'TVSeries' : 'Movie') : 'MusicAlbum',
    name: e.title, url, image: cover, datePublished: e.date || String(e.year),
    ...(screen ? { director: (f.director || []).map(n => ({ '@type': 'Person', name: n })) } : { byArtist: { '@type': /various/i.test(e.artist) ? 'Person' : 'MusicGroup', name: e.artist } }),
    ...(e.labels && e.labels.length && !screen ? { recordLabel: { '@type': 'Organization', name: e.labels[0] } } : {}),
    contributor: { '@type': 'Person', '@id': `${SITE}/#gunnar`, name: 'Gunnar Tynes', url: `${SITE}/` },
    sameAs: Object.keys(LINKS).map(k => (e.links || {})[k]).filter(Boolean),
  };
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${H(e.title)} · ${H(e.artist)} (${e.year}) · Gunnar Tynes</title>
<meta name="description" content="${H(description(e))}">
<meta property="og:type" content="${screen ? 'video.movie' : 'music.album'}">
<meta property="og:site_name" content="Gunnar Tynes">
<meta property="og:title" content="${H(e.title)} · ${H(e.artist)} (${e.year})">
<meta property="og:description" content="${H(description(e))}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${H(cover)}">
<meta name="twitter:card" content="summary">
<link rel="canonical" href="${url}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="stylesheet" href="/fonts/fonts.css">
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>
<link rel="stylesheet" href="/r/release.css">
</head>
<body>
<header id="bar">
  <h1><a href="/?start" title="Back to the start">gunnar tynes</a></h1>
  <nav aria-label="Pages"><a class="quiet" href="/?view=timeline">Timeline</a><a class="quiet" href="/?view=record">Record</a><a class="quiet" href="/live/">Live</a><a class="quiet" href="/about/">About</a></nav>
</header>
<main>
  <figure class="cov">${e.cover ? `<img src="${H(abs(e.cover))}" alt="${H(e.title)} cover" width="600" height="600">` : '<div class="none"></div>'}</figure>
  <article>
    <p class="eyebrow">${e.year}${e.type ? ` · ${H(e.type)}` : ''}</p>
    <h2>${H(e.title)}</h2>
    <p class="artist">${H(e.artist)}</p>
    ${(e.roles || []).length || part(e) ? `<section class="part"><h3>Gunnar's part</h3>${(e.roles || []).length ? `<p class="roles">${e.roles.map(r => `<span>${H(ROLE[r])}</span>`).join('')}</p>` : ''}${part(e) ? `<p>${H(part(e))}</p>` : ''}</section>` : ''}
    ${bite || tracks.some(t => t.p) ? `<button id="play" type="button" data-src="${H(bite ? bite.p : ((e.tracks || [])[e.dt] && e.tracks[e.dt].p ? e.tracks[e.dt].p : tracks.find(t => t.p).p))}"><span class="i">▶</span> <span class="l">Listen${bite ? `: ${H(bite.t)}` : ''}</span></button>` : ''}
    ${screen && (f.director || []).length ? `<p class="facts">Directed by ${H(f.director.join(', '))}${f.composer ? ` · Music by ${H(f.composer)}` : ''}</p>` : ''}
    ${facts.length ? `<p class="facts">${facts.map(H).join(' · ')}</p>` : ''}
    ${tracks.length ? `<ol class="tracks">${tracks.map(t => `<li${t.p ? ` data-src="${H(t.p)}"` : ''}><span class="n">${H(t.n)}</span><span class="t">${H(t.t)}</span><span class="d">${H(t.d || '')}</span></li>`).join('')}</ol>` : ''}
    ${links.length ? `<p class="links">${links.join('')}</p>` : ''}
    <p class="open"><a href="/?r=${encodeURIComponent(e.id)}&amp;view=timeline">See it on the timeline →</a></p>
  </article>
</main>
<nav class="step" aria-label="Neighbouring releases">
  ${prev ? `<a href="/r/${prev.id}/" rel="prev"><small>← ${prev.year}</small>${H(prev.title)}</a>` : '<span></span>'}
  ${next ? `<a href="/r/${next.id}/" rel="next"><small>${next.year} →</small>${H(next.title)}</a>` : '<span></span>'}
</nav>
<script src="/r/release.js" defer></script>
</body>
</html>
`;
}

const OUT = join(ROOT, 'r');
mkdirSync(OUT, { recursive: true });
const keep = new Set(list.map(e => e.id));
for (const d of readdirSync(OUT, { withFileTypes: true })) if (d.isDirectory() && !keep.has(d.name)) rmSync(join(OUT, d.name), { recursive: true });
list.forEach((e, i) => { mkdirSync(join(OUT, e.id), { recursive: true }); writeFileSync(join(OUT, e.id, 'index.html'), page(e, i)); });

const today = new Date().toISOString().slice(0, 10);
const urls = [[`${SITE}/`, '1.0'], [`${SITE}/about/`, '0.9'], [`${SITE}/live/`, '0.8'], [`${SITE}/booking/`, '0.6'], ...list.map(e => [`${SITE}/r/${e.id}/`, '0.5'])];
writeFileSync(join(ROOT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(([u, p]) => `  <url><loc>${u}</loc><lastmod>${today}</lastmod><priority>${p}</priority></url>`).join('\n')}\n</urlset>\n`);
console.log(`${list.length} release pages, sitemap with ${urls.length} addresses`);
