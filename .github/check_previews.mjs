// Checks every music preview in catalogue.js and repairs the ones that stopped working.
// A preview from Apple that has moved is looked up again on the release's own Apple Music album (exact track match);
// one that can't be repaired is removed from the track (so its Play button disappears instead of staying silent)
// and listed in preview-report.md for Gunnar. The monthly GitHub workflow runs this; it can also be run by hand:
//   node .github/check_previews.mjs [--dry]
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry');
const FILE = process.env.CATALOGUE_FILE || join(ROOT, 'catalogue.js');   // CATALOGUE_FILE: test on a copy
const src = readFileSync(FILE, 'utf8');
const C = JSON.parse(src.slice(src.indexOf('['), src.lastIndexOf(']') + 1));
const UA = { 'User-Agent': 'gunnartynes-catalogue/1.0 (preview check)' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const nz = s => String(s || '').normalize('NFKD').toLowerCase().replace(/ð/g, 'd').replace(/þ/g, 'th').replace(/[^a-z0-9]/g, '');

async function alive(url) {
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetch(url, { headers: { ...UA, Range: 'bytes=0-1' }, redirect: 'follow' });
      if (r.ok || r.status === 206) return true;
      if (r.status === 404 || r.status === 403 || r.status === 410) return false;
    } catch (_) {}
    await sleep(1500);
  }
  return null;   // couldn't tell (network trouble): leave it alone
}
async function pool(jobs, n) { const out = []; let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < jobs.length) { const k = i++; out[k] = await jobs[k](); } })); return out; }

const checks = [];
for (const e of C) (e.tracks || []).forEach((t, i) => { if (t.p && /^https?:/.test(t.p)) checks.push({ e, t, i }); });
const res = await pool(checks.map(c => () => alive(c.t.p)), 8);
const broken = checks.filter((c, k) => res[k] === false);
console.log(`${checks.length} previews checked, ${broken.length} not working, ${res.filter(r => r === null).length} could not be reached`);

const fixed = [], removed = [];
const albums = {};
for (const c of broken) {
  const apple = (c.e.links || {}).apple, id = apple && (apple.match(/\/(\d+)(?:\?|$)/) || [])[1];
  let p = null;
  if (id) {
    if (!albums[id]) {
      try { const r = await fetch(`https://itunes.apple.com/lookup?id=${id}&entity=song&country=US`, { headers: UA }); albums[id] = (await r.json()).results.filter(x => x.wrapperType === 'track'); }
      catch (_) { albums[id] = []; }
      await sleep(3200);
    }
    const songs = albums[id];
    const s = songs.find(x => nz(x.trackName) === nz(c.t.t)) || songs.find(x => x.trackNumber === c.t.n && nz(x.trackName).slice(0, 8) === nz(c.t.t).slice(0, 8));
    if (s && s.previewUrl && await alive(s.previewUrl)) p = s.previewUrl;
  }
  if (p) { c.t.p = p; fixed.push(c); } else { delete c.t.p; removed.push(c); }
}
const line = c => `- ${c.e.year} · ${c.e.artist} · *${c.e.title}* · track ${c.t.n} "${c.t.t}"`;
const report = `# Music previews\n\nChecked ${new Date().toISOString().slice(0, 10)}: ${checks.length} previews, ${broken.length} had stopped working.\n\n` +
  (fixed.length ? `## Repaired (${fixed.length})\n\n${fixed.map(line).join('\n')}\n\n` : '') +
  (removed.length ? `## Removed, no working preview found (${removed.length})\n\nThese tracks no longer have a Play button. A preview can come back if the release is found again on Apple Music, or if you upload your own clip in the admin.\n\n${removed.map(line).join('\n')}\n` : '');
console.log(report);
if (!DRY && (fixed.length || removed.length)) {
  writeFileSync(FILE, src.slice(0, src.indexOf('window.CATALOGUE=')) + 'window.CATALOGUE=' + JSON.stringify(C) + ';\n');
  writeFileSync(join(dirname(FILE), 'preview-report.md'), report);
}
