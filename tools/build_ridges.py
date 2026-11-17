"""Analyse one 30-second preview per release into a spectrum, then average them per year.
Writes lab/ridges/data.js. The audio is only analysed; nothing but the curves is kept.
Usage: python3 tools/build_ridges.py <scratch dir>"""
import json, os, sys, subprocess, urllib.request, hashlib
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TMP = sys.argv[1]
os.makedirs(TMP, exist_ok=True)
SR, NB, FLO, FHI = 22050, 110, 40.0, 10000.0
edges = np.geomspace(FLO, FHI, NB + 1)

def load():
    js = open(os.path.join(ROOT, 'catalogue.js'), encoding='utf-8').read()
    return json.loads(js[js.index('['):js.rindex(']') + 1])

def preview(e):
    t = e.get('tracks') or []
    if e.get('dt') is not None and e['dt'] < len(t) and t[e['dt']].get('p'): return t[e['dt']]['p'], t[e['dt']]['t']
    for x in t:
        if x.get('p'): return x['p'], x['t']
    return None, None

def spectrum(url):
    key = hashlib.sha1(url.encode()).hexdigest()[:16]
    raw = os.path.join(TMP, key + '.f32')
    if not os.path.exists(raw):
        src = os.path.join(TMP, key + '.m4a')
        urllib.request.urlretrieve(url, src)
        subprocess.run(['ffmpeg', '-v', 'quiet', '-y', '-i', src, '-ac', '1', '-ar', str(SR), '-f', 'f32le', raw], check=True)
        os.remove(src)
    x = np.fromfile(raw, dtype=np.float32)
    if len(x) < SR: return None
    n = 4096; hop = 2048; win = np.hanning(n)
    frames = [np.abs(np.fft.rfft(x[i:i + n] * win)) for i in range(0, len(x) - n, hop)]
    mag = np.mean(frames, axis=0)
    f = np.fft.rfftfreq(n, 1 / SR)
    bands = np.array([mag[(f >= edges[i]) & (f < edges[i + 1])].mean() if np.any((f >= edges[i]) & (f < edges[i + 1])) else 0 for i in range(NB)])
    db = 20 * np.log10(bands + 1e-9)
    return db

C = [e for e in load() if e.get('tier') == 'core']
by = {}
for e in C:
    url, title = preview(e)
    if not url: continue
    try:
        s = spectrum(url)
    except Exception as ex:
        print('skip', e['title'], ex); continue
    if s is None: continue
    by.setdefault(e['year'], []).append((e, s, url, title))
    print(e['year'], e['title'], flush=True)

years = []
allv = np.concatenate([s for v in by.values() for _, s, _, _ in v])
lo, hi = np.percentile(allv, 5), np.percentile(allv, 99.5)
for y in range(min(e['year'] for e in C), max(e['year'] for e in C) + 1):
    v = by.get(y, [])
    if v:
        m = np.mean([s for _, s, _, _ in v], axis=0)
        curve = np.clip((m - lo) / (hi - lo), 0, 1)
    else:
        curve = np.zeros(NB)
    years.append({'y': y, 's': [round(float(c), 3) for c in curve],
                  'r': [{'t': e['title'], 'a': e['artist'], 'c': e.get('cover', ''), 'p': url, 'k': title} for e, _, url, title in v]})
os.makedirs(os.path.join(ROOT, 'lab', 'ridges'), exist_ok=True)
open(os.path.join(ROOT, 'lab', 'ridges', 'data.js'), 'w').write('window.RIDGES=' + json.dumps({'bands': [round(float(v), 1) for v in edges], 'years': years}, ensure_ascii=False, separators=(',', ':')) + ';\n')
print('DONE', sum(len(v) for v in by.values()), 'previews,', len(years), 'years')
