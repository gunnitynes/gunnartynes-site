// YOURS — bring your own sound into the band. Record over the song with a count-in, sample-locked to the bar
// grid (so it loops in time without any stretching), or drop any file and it is time-stretched (pitch kept) to
// the nearest 1/2/4/8/16 bars. Either way the server cuts it into the same cells as the band's stems, so your
// sound becomes a real musician in every other world: a row of stars, an orb, a pad source, a gene.
import { h, api, clamp, STATIC } from '../lib/util.js';
import { encodeWav } from '../lib/wav.js';
import { SR } from '../engine/audio.js';

export default class Sounds {
  constructor(app, el) {
    this.app = app; this.el = el;
    const { song } = app;
    this.bars = h('select', {}, [1, 2, 4, 8].map((n) => h('option', { value: n, selected: n === 4 }, `${n} bar${n > 1 ? 's' : ''}`)));
    this.nudge = h('input', { type: 'range', min: 0, max: 300, step: 1, value: Math.round(app.engine.roundTrip() * 1000) });
    this.nudgeLabel = h('span', { class: 'mono faint' });
    this.nudge.oninput = () => { this.nudgeLabel.textContent = `${this.nudge.value} ms`; };
    this.nudge.oninput();
    this.meter = h('i'); this.countIn = h('div', { class: 'count-in' });
    this.micBtn = h('button', { class: 'btn', onclick: () => this.enableMic() }, '🎙 Allow microphone');
    this.recBtn = h('button', { class: 'btn rec', disabled: true, onclick: () => this.recordTake() }, '● Record over the band');
    this.micOut = h('div');
    this.fileName = h('input', { type: 'text', placeholder: 'name it (optional)', maxlength: 40 });
    this.fit = h('select', {}, h('option', { value: 'stretch' }, 'stretch it to the beat'), h('option', { value: 'natural' }, 'keep its own speed'));
    this.file = h('input', { type: 'file', accept: 'audio/*,.wav,.aif,.aiff,.mp3,.m4a,.flac,.ogg', hidden: true, onchange: () => this.file.files[0] && this.uploadFile(this.file.files[0]) });
    this.drop = h('div', { class: 'drop', onclick: () => this.file.click() }, h('div', { style: { fontSize: '28px' } }, '⇪'), 'Drop a sound here, or click to choose', h('div', { class: 'tiny faint', style: { marginTop: '6px' } }, `wav · aiff · mp3 · m4a · flac — up to ${16} bars`));
    for (const ev of ['dragenter', 'dragover']) this.drop.addEventListener(ev, (e) => { e.preventDefault(); this.drop.classList.add('over'); });
    for (const ev of ['dragleave', 'drop']) this.drop.addEventListener(ev, (e) => { e.preventDefault(); this.drop.classList.remove('over'); });
    this.drop.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) this.uploadFile(f); });
    this.status = h('div', { class: 'dim', style: { marginTop: '10px', minHeight: '20px' } });
    this.list = h('div', { class: 'sound-list' });

    el.append(
      h('div', { class: 'world-head' }, h('h2', {}, 'Yours'), h('p', {}, `Become a member of the band. Your sound is cut onto the same grid as ours (${song.bpm} bpm) and plays in every world.`)),
      h('div', { class: 'byo' },
        h('div', { class: 'card' },
          h('h3', {}, 'Record over the band'),
          h('p', { class: 'dim' }, 'Sing, clap, play something. You get one bar of count-in, then it records exactly on the grid.'),
          h('div', { class: 'row' }, this.micBtn, this.bars),
          h('div', { class: 'mic-meter' }, this.meter),
          this.countIn,
          h('div', { class: 'row' }, this.recBtn),
          h('div', { class: 'row tiny faint' }, 'latency nudge ', this.nudge, this.nudgeLabel),
          this.micOut),
        h('div', { class: 'card' },
          h('h3', {}, 'Drop in a sound'),
          h('p', { class: 'dim' }, 'A loop, a field recording, a voice memo. It gets trimmed, levelled and fitted to whole bars.'),
          this.drop, this.file,
          h('div', { class: 'row' }, this.fileName, this.fit),
          this.status),
        h('div', { class: 'card' },
          h('h3', {}, 'In the band'),
          h('p', { class: 'dim' }, (STATIC ? 'Your sounds in this song. They stay on this device: a take you share plays without them.' : 'Your sounds in this song. When you share a take, the sounds in it are shared too.')),
          this.list)),
    );
    app.session.on(({ a }) => { if (a.t === 'track/add' || a.t === 'track/remove' || a.t === 'state/load') this.paintList(); });
    this.paintList();
  }

  show() { this.paintList(); }

  async enableMic() {
    try {
      this.mic = await this.app.engine.openMic();
      this.micBtn.textContent = '🎙 Microphone on'; this.micBtn.classList.add('on'); this.recBtn.disabled = false;
    } catch (e) { this.app.toast({ icon: '🎙', title: 'No microphone', text: e.message }); }
  }

  async recordTake() {
    const { player, engine, song } = this.app;
    if (!this.mic || this.busy) return;
    this.busy = true; this.recBtn.disabled = true;
    const bars = +this.bars.value;
    if (!player.playing) player.play();
    let B = player.barNow() + 2; // one full bar of count-in
    if (player.timeOfBar(B - 1) - engine.ctx.currentTime < 0.1) B++;
    const T = player.timeOfBar(B), lat = +this.nudge.value / 1000;
    const startFrame = Math.round((T + lat) * SR), stopFrame = startFrame + Math.round(bars * song.barDur * SR);
    const rec = this.mic.record(startFrame);
    // count in on the beats of the bar before
    const beatsIn = song.beatsPerBar;
    for (let k = 0; k < beatsIn; k++) {
      const at = T - (beatsIn - k) * song.beatDur;
      setTimeout(() => { this.countIn.textContent = String(beatsIn - k); this.app.chime('tick'); }, Math.max(0, (at - engine.ctx.currentTime) * 1000));
    }
    setTimeout(() => { this.countIn.textContent = '● recording'; }, Math.max(0, (T - engine.ctx.currentTime) * 1000));
    const audio = await rec.stop(stopFrame);
    this.countIn.textContent = '';
    this.busy = false; this.recBtn.disabled = false;
    this.offerTake(audio, bars);
  }

  offerTake(audio, bars) {
    const name = h('input', { type: 'text', placeholder: 'name it', maxlength: 40, value: 'my voice' });
    let src;
    const preview = h('button', { class: 'btn small', onclick: () => {
      src?.stop();
      const b = this.app.engine.ctx.createBuffer(2, audio.L.length, SR); b.copyToChannel(audio.L, 0); b.copyToChannel(audio.R, 1);
      src = this.app.engine.ctx.createBufferSource(); src.buffer = b; src.connect(this.app.engine.ctx.destination); src.start();
    } }, '▶ hear it alone');
    const add = h('button', { class: 'btn hot small', onclick: async () => {
      add.disabled = true;
      await this.send(encodeWav([audio.L, audio.R], SR), name.value || 'my voice', 'exact', 'mic');
      this.micOut.replaceChildren();
    } }, '+ Add to the song');
    let pk = 0; for (let i = 0; i < audio.L.length; i += 16) pk = Math.max(pk, Math.abs(audio.L[i]));
    this.micOut.replaceChildren(h('div', { class: 'row' }, name), h('div', { class: 'row' }, preview, add,
      h('button', { class: 'btn small ghost', onclick: () => this.micOut.replaceChildren() }, 'discard')),
      pk < 0.01 ? h('p', { class: 'faint tiny' }, 'That was very quiet — is the right microphone selected?') : '');
  }

  async uploadFile(f) {
    const mb = f.size / 1024 / 1024;
    if (mb > 25) return this.app.toast({ icon: '!', title: 'Too big', text: 'Keep it under 25 MB (and 16 bars).' });
    await this.send(f, this.fileName.value || f.name.replace(/\.[^.]+$/, '').slice(0, 40), this.fit.value, 'upload');
    this.fileName.value = '';
  }

  async send(blob, name, fit, origin) {
    const { song, profile, toast } = this.app;
    this.status.textContent = 'fitting it to the band…';
    const form = new FormData();
    form.append('file', blob, 'sound.wav'); form.append('songId', song.id); form.append('name', name); form.append('fit', fit);
    form.append('origin', origin); form.append('author', profile.name || '');
    try {
      const snd = await api.upload('/api/sounds', form);
      const id = await this.app.addSound(snd);
      (profile.sounds[song.id] ??= []).push(snd.id); profile.save();
      this.status.textContent = `“${snd.name}” joined the band — ${snd.bars} bar${snd.bars > 1 ? 's' : ''}.`;
      toast({ icon: '◉', title: `${snd.name} joined the band`, text: 'Find it in Stars, Orbit, Chop and Evolve.', color: this.app.catalog.get(id).color });
    } catch (e) { this.status.textContent = ''; toast({ icon: '!', title: 'Could not add that', text: e.message }); }
  }

  async paintList() {
    const { session, catalog, song, profile } = this.app;
    const inSong = session.state.order.filter((id) => id.startsWith('snd_'));
    const saved = (profile.sounds[song.id] ?? []).filter((sid) => !inSong.includes('snd_' + sid));
    const rows = inSong.map((id) => {
      const c = catalog.get(id); if (!c) return '';
      return h('div', { class: 'sound-item' }, h('i', { class: 'sw', style: { background: c.color } }), h('span', {}, c.name),
        h('button', { class: 'btn small ghost', onclick: () => session.dispatch({ t: 'track/remove', id }) }, 'remove'));
    });
    for (const sid of saved) {
      rows.push(h('div', { class: 'sound-item' }, h('i', { class: 'sw', style: { background: 'var(--ink3)' } }), h('span', { class: 'dim' }, catalog.get('snd_' + sid)?.name ?? 'an earlier sound'),
        h('button', { class: 'btn small', onclick: async () => { try { await this.app.addSound(await api.get(`/api/sounds/${sid}`)); } catch { profile.sounds[song.id] = profile.sounds[song.id].filter((x) => x !== sid); profile.save(); this.paintList(); } } }, 'bring back')));
    }
    this.list.replaceChildren(...(rows.length ? rows : [h('p', { class: 'faint' }, 'Nothing yet. The band has room for one more.')]));
  }

  frame() {
    if (!this.mic) return;
    const buf = this.buf ??= new Float32Array(1024);
    this.mic.monitor.getFloatTimeDomainData(buf);
    let pk = 0; for (const v of buf) pk = Math.max(pk, Math.abs(v));
    this.meter.style.width = `${clamp(pk * 140, 0, 100)}%`;
    this.meter.style.background = pk > 0.9 ? '#ff5d6c' : '';
  }
}
