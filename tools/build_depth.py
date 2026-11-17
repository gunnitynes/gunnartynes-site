"""Builds the depth layers for the depth prototype from the Vision masks.
For each usable cover: <id>-f.webp (the subject, with soft edges) and <id>-b.webp (the cover with the subject's
place filled from its surroundings), plus lab/depth/data.js listing them.
Usage: python3 tools/build_depth.py <masks dir> <masks.log>"""
import json, os, sys
import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MASKS, LOG = sys.argv[1], sys.argv[2]
OUT = os.path.join(ROOT, 'lab', 'depth', 'layers')
os.makedirs(OUT, exist_ok=True)
js = open(os.path.join(ROOT, 'catalogue.js'), encoding='utf-8').read()
C = json.loads(js[js.index('['):js.rindex(']') + 1])
by_file = {os.path.basename(e['cover']): e for e in C if e.get('cover') and e.get('tier') == 'core'}
cov = {}
for line in open(LOG):
    p = line.strip().split('\t')
    if len(p) == 2 and p[0][0].isdigit(): cov[p[1]] = float(p[0])

def _box(a, r, axis):
    r = max(1, int(r)); pad = [(0, 0)] * a.ndim; pad[axis] = (r + 1, r)
    c = np.cumsum(np.pad(a, pad, mode='edge'), axis=axis)
    n = a.shape[axis]
    return (np.take(c, range(2 * r + 1, 2 * r + 1 + n), axis=axis) - np.take(c, range(0, n), axis=axis)) / (2 * r + 1)

def blur(a, r):
    """three box passes in each direction: close to a Gaussian of radius r"""
    a = a.astype(np.float32); b = max(1, round(r * 0.58))
    for _ in range(3):
        a = _box(_box(a, b, 0), b, 1)
    return a

items = []
for fn, c in sorted(cov.items()):
    e = by_file.get(fn)
    if not e or not (0.06 < c < 0.72): continue
    im = Image.open(os.path.join(ROOT, 'covers', fn)).convert('RGB')
    S = 500
    im = im.resize((S, int(im.height * S / im.width))) if im.width != S else im
    side = min(im.size); im = im.crop(((im.width - side) // 2, (im.height - side) // 2, (im.width - side) // 2 + side, (im.height - side) // 2 + side)).resize((S, S))
    m = Image.open(os.path.join(MASKS, os.path.splitext(fn)[0] + '.png')).convert('L').resize(im.size)
    m = m.crop((0, 0, S, S)) if m.size != (S, S) else m
    ma = np.asarray(m, dtype=np.float32) / 255
    soft = np.clip(blur(ma, 1.2), 0, 1)
    rgb = np.asarray(im, dtype=np.float32)
    # front: the subject alone
    front = np.dstack([rgb, soft * 255]).astype(np.uint8)
    Image.fromarray(front, 'RGBA').save(os.path.join(OUT, e['id'] + '-f.webp'), quality=82, method=6)
    # back: fill the subject's place from what surrounds it (normalised blur), grown a little past its edge
    grow = np.clip(blur(ma, 6) * 3, 0, 1)
    keep = 1 - grow
    fill = np.dstack([blur(rgb[..., k] * keep, 22) for k in range(3)]) / np.maximum(blur(keep, 22), 1e-3)[..., None]
    back = rgb * keep[..., None] + fill * grow[..., None]
    back *= (1 - 0.35 * grow)[..., None]          # a little shade where the subject stood
    Image.fromarray(np.clip(back, 0, 255).astype(np.uint8)).save(os.path.join(OUT, e['id'] + '-b.webp'), quality=80, method=6)
    items.append({'id': e['id'], 't': e['title'], 'a': e['artist'], 'y': e['year'], 'c': round(c, 3)})
    print(e['year'], e['title'], c, flush=True)
items.sort(key=lambda x: x['y'])
open(os.path.join(ROOT, 'lab', 'depth', 'data.js'), 'w').write('window.DEPTH=' + json.dumps(items, ensure_ascii=False, separators=(',', ':')) + ';\n')
print('DONE', len(items))
