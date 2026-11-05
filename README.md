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

## Add a soundbite

Open the site with `?edit` in the address, click a release, then do one of these in the Soundbite section:

- Drop an audio file on the page. It is stored in this browser on this computer.
- Put a file in `audio/` and enter `audio/name.wav` as the link. This is the only option that carries over to another computer.
- Click a track to use its 30-second preview. Previews need internet.

"Start at" sets where the soundbite begins. For files, you can also click the waveform.

## Correct the data

Facts live in `tools/build_catalogue.py`, in `OVERRIDES` and `FILM`. Change them and run `python3 tools/build_catalogue.py`. Open questions are listed in `data/to-confirm.md`.

## On the web

The page is static and is hosted on GitHub Pages. Visitors see no editing tools. It is marked `noindex` until it replaces gunnartynes.com; remove that line from `index.html` at launch.

The research and build tools are kept on the laptop, in `research/`, `tools/` and `data/`, and are not published.
