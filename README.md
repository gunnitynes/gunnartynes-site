# Recorded work

A single page holding the whole catalogue, viewed as a timeline or a spinning record. An earlier talk mode is retired from the interface; adding `?talk` to the address brings it back.

## Run it

```bash
python3 -m http.server 8791 --bind 127.0.0.1 --directory ~/gunnartynes-catalogue
```

Then open http://localhost:8791.

## Views

- **Record** fits a square. Releases run along a spiral groove from the oldest at the rim to the newest at the center. Spin it, drag the tonearm, scroll, or use the arrow keys. Left alone, it plays through the catalogue.
- **Timeline** comes in two layouts, switched with the Vertical button. Horizontal stacks releases above their year. Vertical runs the years down the page, and is the default on screens narrower than 900 px.

Each visitor's last choice is remembered. Links can force a view with `?view=record`, `?view=timeline`, `?layout=vertical` or `?layout=horizontal`.

## Editing: /admin

Open `/admin/` on the site, on any device, and sign in with a GitHub access key limited to this repository. There you can edit any release, add or delete releases, upload covers and add soundbites.

For a soundbite, choose a full track, place the clip on its waveform and save. The track stays on your device; only the clip is uploaded, as 256 kbps AAC, or WAV in browsers that can't make AAC.

Each save is a commit, live within about two minutes, and History can return to any earlier version.

`catalogue.js` is now the master copy and lives in this repository. Pull before changing anything by hand. The old build script refuses to run, because it would erase edits made here.

## On the web

The page is static and is hosted on GitHub Pages. Visitors see no editing tools. It is marked `noindex` until it replaces gunnartynes.com; remove that line from `index.html` at launch.

The research and build tools are kept on the laptop, in `research/`, `tools/` and `data/`, and are not published.
