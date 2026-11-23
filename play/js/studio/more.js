// "More": the add-ons, in one panel under the header, so nothing already in the studio moves. The band answers
// you, the Atlas, the endless version, key, conducting with your hands, versions, and taking it all to Ableton.
import { h } from '../lib/util.js';
import { openAtlas } from './atlas.js';
import { ago } from './versions.js';
import { exportForDaw } from './export.js';

export function buildMore(S, { button, names }) {
  const { params: P, song } = S, say = (m) => S.say?.(m);
  const sw = (label, title, get, set) => { const b = h('button', { type: 'button', class: 'sw', title, onclick: () => set(!get()) }, h('i'), label); b.sync = () => b.setAttribute('aria-pressed', !!get()); b.sync(); return b; };
  const sec = (title, lede, ...kids) => h('section', { class: 'more-sec' }, h('h4', {}, title), lede ? h('p', { class: 'more-lede' }, lede) : '', ...kids);
  const A = S.answer, E = S.endless, C = S.conduct, V = S.versions;
  const noFeat = !S.feat;

  // the band answers you
  const ansB = sw('Answer me', 'Play a phrase and leave a bar of quiet: a musician answers with the bar of theirs closest to it', () => A.on, (v) => { A.set(v); if (v && !S.player.playing) S.player.play(); });
  const micB = sw('Listen to me', 'Sing or play into the microphone: your notes count as the phrase', () => A.listening, (v) => A.listen(v));
  const ansInfo = h('p', { class: 'more-info' });
  const showAns = () => { ansB.sync(); micB.sync(); micB.disabled = !A.on; ansInfo.textContent = !A.on ? '' : A.notes.length ? `hearing you · ${A.notes.length} note${A.notes.length > 1 ? 's' : ''}` : A.last ? `${A.last.name} answered with bar ${A.last.bar} · K keeps it` : 'play a phrase, then leave a bar of quiet'; };
  A.addEventListener('change', showAns); showAns();

  // endless
  const endB = sw('Endless', 'From the next bar the song keeps going and never repeats; switch it off and the arrangement is as it was, except what you kept', () => E.on, (v) => { E.set(v); if (!v && E.kept) say(`${E.kept} kept piece${E.kept > 1 ? 's' : ''} stay on the arrangement`); });
  E.addEventListener('change', () => endB.sync());

  // key
  const keySel = h('select', { title: 'The whole song, or one stem', onchange: () => showKey() }, h('option', { value: '' }, 'Whole song'), ...song.stems.filter((s) => s.cells.some(Boolean) || s.voice).map((s) => h('option', { value: s.id }, s.name)));
  const keyPath = () => (keySel.value ? `band.${keySel.value}.key` : 'song.key');
  const keyOut = h('span', { class: 'more-key' });
  const step = (d) => { const p = keyPath(); P.set(p, Math.max(-12, Math.min(12, (P.get(p) || 0) + d))); };
  const showKey = () => { const v = P.get(keyPath()) || 0, all = P.get('song.key') || 0; keyOut.textContent = `${v > 0 ? '+' : ''}${v} semitone${Math.abs(v) === 1 ? '' : 's'}${keySel.value && all ? ` (and ${all > 0 ? '+' : ''}${all} for the song)` : ''}`; };
  P.on(({ path }) => /\.key$/.test(path) && showKey()); showKey();

  // conduct
  const conB = sw('Conduct', 'The camera follows your movement: height is how loud, left to right darker to brighter, how much you move sprays the Cloud', () => C.on, (v) => C.set(v));
  const tempoB = sw('Tempo from my beats', 'Your downbeats set the tempo (on the bar line)', () => C.tempo, (v) => { C.tempo = v; tempoB.sync(); });
  const cam = h('canvas', { class: 'more-cam', width: 256, height: 192 }), cg = cam.getContext('2d');
  const conInfo = h('p', { class: 'more-info' });
  C.addEventListener('change', () => { conB.sync(); cam.hidden = !C.on; tempoB.disabled = !C.on; conInfo.textContent = C.on ? 'move your hands in front of the camera' : ''; });
  C.addEventListener('beat', () => { conInfo.textContent = C.tempo && C.bpm ? `downbeat · ${C.bpm} BPM` : 'downbeat'; cam.classList.add('beat'); setTimeout(() => cam.classList.remove('beat'), 120); });
  cam.hidden = true; tempoB.disabled = true;

  // versions
  const vlist = h('div', { class: 'more-versions' });
  const showV = () => {
    vlist.replaceChildren(...V.list.slice(0, 8).map((v) => {
      const on = V.listening === v;
      return h('div', { class: 'more-v' + (on ? ' on' : '') }, h('span', { class: 'when' }, ago(v.ts)), h('span', { class: 'what' }, v.summary), on
        ? h('span', { class: 'btns' }, h('button', { type: 'button', class: 'pill', onclick: () => V.keep() }, 'Keep'), h('button', { type: 'button', class: 'pill', onclick: () => V.back() }, 'Back to now'))
        : h('button', { type: 'button', class: 'pill', onclick: () => V.listen(v) }, 'Listen'));
    }));
  };
  V.addEventListener('change', showV); showV();

  // export
  let perStem = false;
  const famB = h('button', { type: 'button', onclick: () => { perStem = false; showEx(); } }, 'Families'), stemB = h('button', { type: 'button', onclick: () => { perStem = true; showEx(); } }, 'Every stem');
  const exB = h('button', { type: 'button', class: 'pill strong', onclick: async () => {
    exB.disabled = true;
    try {
      const r = await exportForDaw(S, { perStem, names, progress: (f, what) => { exB.textContent = `${Math.round(f * 100)}% · ${what}`; } });
      const a = h('a', { href: URL.createObjectURL(r.blob), download: r.name }); document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 30000);
      say(`${r.files} files in the zip: drop them into Live at bar 1`);
    } catch (e) { say('The export stopped: ' + e.message); }
    exB.disabled = false; exB.textContent = 'Make the zip';
  } }, 'Make the zip');
  const showEx = () => { famB.setAttribute('aria-pressed', !perStem); stemB.setAttribute('aria-pressed', perStem); };
  showEx();

  const panel = h('div', { id: 'more', hidden: true },
    sec('The band answers you', 'Play a phrase on the keys (or sing it), then leave a bar of quiet. A musician answers with the bar of theirs closest to what you played, in time.', h('div', { class: 'more-row' }, ansB, micB), ansInfo),
    sec('Atlas', 'Every bar of every stem as a dot on one map, by how it sounds. Sweep across it to play a path through the song; draw it onto the tape.', h('div', { class: 'more-row' }, h('button', { type: 'button', class: 'pill strong', onclick: () => { close(); openAtlas(S, { say }); } }, 'Open the Atlas'))),
    sec('Endless version', 'The song keeps going and never repeats: phrases that follow well from each other, a few changes, colours that drift. K keeps what you hear.', h('div', { class: 'more-row' }, endB)),
    sec('Key', 'Move the whole song, or one stem, up or down. The change comes in on the next bar line.', h('div', { class: 'more-row' }, keySel, h('div', { class: 'seg' }, h('button', { type: 'button', onclick: () => step(-1) }, '−'), h('button', { type: 'button', onclick: () => { P.set(keyPath(), 0); } }, '0'), h('button', { type: 'button', onclick: () => step(1) }, '+')), keyOut)),
    sec('Conduct with your hands', 'Height is how loud, left to right is darker to brighter, the more you move the more the Cloud sprays. The camera picture stays on this computer.', h('div', { class: 'more-row' }, conB, tempoB), cam, conInfo),
    sec('Versions', 'Every few minutes your work is put aside as a version. Listen to an earlier one in place, then keep it or go back.', h('div', { class: 'more-row' }, h('button', { type: 'button', class: 'pill', onclick: async () => { await V.save('saved by hand'); say('Version saved'); } }, 'Save a version now')), vlist),
    sec('To Ableton', 'Your version as WAV files that start at bar 1 (the loop, if one is set), and the instruments’ notes as MIDI.', h('div', { class: 'more-row' }, h('div', { class: 'seg' }, famB, stemB), exB)));
  if (noFeat) for (const b of [ansB, endB]) b.disabled = true;
  document.body.append(panel);
  const close = () => { panel.hidden = true; button.setAttribute('aria-expanded', 'false'); };
  button.onclick = (e) => { e.stopPropagation(); panel.hidden = !panel.hidden; button.setAttribute('aria-expanded', String(!panel.hidden)); if (!panel.hidden) { showV(); showAns(); } };
  addEventListener('pointerdown', (e) => { if (!panel.hidden && !panel.contains(e.target) && e.target !== button && !button.contains(e.target)) close(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  (function loop() { if (C.on && !panel.hidden) C.draw(cg, cam.width, cam.height); requestAnimationFrame(loop); })();
}
