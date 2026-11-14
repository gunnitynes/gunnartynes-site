# Plugins site

Static site listing the plugins, hosted on GitHub Pages.

- `index.html` — the public site (grid → detail page at `#/<id>`).
- `admin/` — the editor. Sign in with a fine-grained GitHub token that has **Contents: read and write** on this repo only. Every Publish is one commit that updates `data/plugins.json` and adds/removes images in `images/`.
- `data/plugins.json` — all content. Descriptions are Markdown (`### Heading`, `* **TERM**: text`).
- `tools/` — the one-time import script used to build the first version from screenshots.
