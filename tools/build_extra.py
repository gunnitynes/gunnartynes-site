"""Turn research/enrich/ into extra.js (window.EXTRA), the extra facts each info window shows,
and data/info-gaps.md, the list of releases we found little about.
Also fetches the full Wikipedia lead section (cached). Usage: python3 tools/build_extra.py"""
import json, os, re, time, urllib.request, urllib.parse, urllib.error
from collections import OrderedDict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
E = os.path.join(ROOT, 'research', 'enrich')
UA = {'User-Agent': 'CatalogueEnricher/1.0 (personal discography site)'}
GUNNAR_IDS = {624414, 592531}
GUNNAR_RX = re.compile(r'gunn(ar|i)\b.*tynes|^tynes', re.I)

def J(name):
    p = os.path.join(E, name)
    return json.load(open(p, encoding='utf-8')) if os.path.exists(p) else None

def load_catalogue():
    js = open(os.path.join(ROOT, 'catalogue.js'), encoding='utf-8').read()
    return json.loads(js[js.index('['):js.rindex(']') + 1])

def wiki_lead(lang, title, qid):
    p = os.path.join(E, f'wpx_{lang}_{qid}.json')
    if os.path.exists(p):
        return json.load(open(p, encoding='utf-8'))
    u = (f'https://{lang}.wikipedia.org/w/api.php?action=query&format=json&prop=extracts&exintro=1&explaintext=1&redirects=1&titles='
         + urllib.parse.quote(title))
    time.sleep(.3)
    try:
        d = json.load(urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=30))
        pg = next(iter(d['query']['pages'].values()))
        v = {'text': pg.get('extract', ''), 'title': pg.get('title', title)}
    except Exception as ex:
        v = {'text': '', 'title': title, 'err': str(ex)}
    json.dump(v, open(p, 'w', encoding='utf-8'), ensure_ascii=False)
    return v

def clean_name(n):
    return re.sub(r'\s*\(\d+\)$', '', n or '').strip()

def is_gunnar(a):
    return a.get('id') in GUNNAR_IDS or bool(GUNNAR_RX.search(clean_name(a.get('anv') or a.get('name'))))

def nice_role(r):
    r = re.sub(r'\s+', ' ', r).strip()
    return r[0].upper() + r[1:].lower().replace(' by', ' by') if r else r

def split_roles(role):
    # "Recorded By [Strings], Mixed By" -> ['Recorded by (strings)', 'Mixed by']
    out, depth, cur = [], 0, ''
    for ch in role:
        if ch == '[': depth += 1
        if ch == ']': depth -= 1
        if ch == ',' and depth == 0:
            out.append(cur); cur = ''
        else:
            cur += ch
    out.append(cur)
    res = []
    for x in out:
        x = x.strip()
        if not x: continue
        m = re.match(r'^(.*?)\s*\[(.*)\]$', x)
        res.append(nice_role(m.group(1)) + (f' ({m.group(2).lower()})' if m else '')) if m else res.append(nice_role(x))
    return res

STUDIO = ['Recorded At', 'Mixed At', 'Mastered At', 'Produced At', 'Engineered At', 'Remixed At', 'Overdubbed At', 'Lacquer Cut At', 'Edited At']
RIGHTS = ['Phonographic Copyright (p)', 'Copyright (c)', 'Published By', 'Licensed From', 'Licensed To', 'Licensed Through']
MAKE = ['Pressed By', 'Manufactured By', 'Made By', 'Printed By', 'Distributed By', 'Marketed By', 'Glass Mastered At']

def from_discogs(num):
    r = J(f'dg_release_{num}.json')
    if not r: return {}
    x = OrderedDict()
    x['dg'] = int(num)
    labs = [f"{clean_name(l['name'])}{(' · ' + l['catno']) if l.get('catno') and l['catno'].lower() != 'none' else ''}" for l in r.get('labels', [])]
    if labs: x['cat'] = list(OrderedDict.fromkeys(labs))
    if r.get('country'): x['country'] = r['country']
    if r.get('released'): x['released'] = r['released']
    fm = []
    for f in r.get('formats', []):
        d = [f.get('name', '')] + [s for s in (f.get('descriptions') or []) if s] + ([f['text']] if f.get('text') else [])
        q = f.get('qty')
        fm.append(((q + ' × ') if q and q != '1' else '') + ', '.join(d))
    if fm: x['fmt'] = fm
    notes = (r.get('notes') or '').strip()
    if notes:
        notes = re.sub(r'\[([a-z])=?([^\]]*)\]', lambda m: m.group(2) if m.group(1) in 'alm' else '', notes)
        notes = re.sub(r'\[/?[bi u]\]', '', notes).replace('\r', '')
        x['notes'] = notes.strip()[:1400]
    # credits: release-level + track-level
    people = OrderedDict()
    def add(a, tracks=''):
        n = clean_name(a.get('anv') or a.get('name'))
        if not n: return
        p = people.setdefault(n, {'n': n, 'r': OrderedDict(), 'g': is_gunnar(a)})
        for role in split_roles(a.get('role', '')):
            ts = p['r'].setdefault(role, [])
            if not tracks: ts.append('*')
            else:
                for t in re.split(r',\s*', tracks):
                    if t and t not in ts: ts.append(t)
    for a in r.get('extraartists', []):
        add(a, (a.get('tracks') or '').strip())
    for t in r.get('tracklist', []):
        for a in t.get('extraartists', []) or []:
            add(a, t.get('position') or '')
    cr = []
    for p in people.values():
        rs = []
        for role, ts in p['r'].items():
            if '*' in ts or not ts: rs.append(role)
            else: rs.append(role + ' · ' + ('track ' if len(ts) == 1 else 'tracks ') + ', '.join(ts))
        if rs:
            d = {'n': p['n'], 'r': rs}
            if p['g']: d['g'] = 1
            cr.append(d)
    if cr: x['credits'] = cr
    comp = OrderedDict()
    for c in r.get('companies', []):
        t = c.get('entity_type_name', '')
        comp.setdefault(t, [])
        n = clean_name(c['name'])
        if n not in comp[t]: comp[t].append(n)
    for key, keys in (('studios', STUDIO), ('rights', RIGHTS), ('made', MAKE)):
        v = [[k.replace(' (p)', '').replace(' (c)', ''), comp[k]] for k in keys if k in comp]
        if v: x[key] = v
    tl = []
    for t in r.get('tracklist', []):
        if t.get('type_') != 'track': continue
        arts = ''.join(clean_name(a.get('anv') or a['name']) + (' ' + a['join'] + ' ' if a.get('join') and a['join'] != ',' else (', ' if a.get('join') == ',' else '')) for a in (t.get('artists') or []))
        tl.append([t.get('position', ''), t.get('title', ''), t.get('duration', ''), arts.strip()])
    if tl: x['tracks'] = tl
    cm = r.get('community') or {}
    if cm.get('have'):
        x['have'] = cm['have']; x['want'] = cm.get('want', 0)
        rt = cm.get('rating') or {}
        if rt.get('count', 0) >= 5: x['rating'] = [round(rt['average'], 2), rt['count']]
    vids = [v for v in r.get('videos', []) if 'youtube' in v.get('uri', '')]
    if vids: x['videos'] = [[v['title'], v['uri']] for v in vids[:4]]
    mid = r.get('master_id')
    if mid:
        v = J(f'dg_versions_{mid}.json')
        if v and v.get('versions'):
            vs = v['versions']
            ed = []
            for e in sorted(vs, key=lambda e: (e.get('released') or '0')[:4] if (e.get('released') or '0')[:4] not in ('0', '') else '9999'):
                y = (e.get('released') or '')[:4]
                cn = e.get('catno', '') if (e.get('catno') or '').lower() != 'none' else ''
                ed.append([y if y not in ('0',) else '', e.get('country', ''), clean_name(e.get('label', '')), e.get('format', ''), cn])
            x['editions'] = ed
            x['editions_n'] = v['pagination']['items']
    return x

def from_mb(rec):
    x = {}
    g = rec.get('mb_rg') and J(f"mb_rg_{rec['mb_rg']}.json")
    if g:
        if g.get('first-release-date'): x['first'] = g['first-release-date']
        tags = [t['name'] for t in sorted(g.get('genres', []) + g.get('tags', []), key=lambda t: -t.get('count', 0)) if t.get('count', 0) > 0]
        if tags: x['mbtags'] = list(OrderedDict.fromkeys(tags))[:6]
        x['mb'] = rec['mb_rg']
    return x

def from_wiki(rec):
    qid = rec.get('qid')
    if not qid: return {}
    w = J(f'wd_{qid}.json') or {}
    x = {'qid': qid}
    sl = w.get('sitelinks', {})
    for lang in ('en', 'is'):
        s = sl.get(f'{lang}wiki')
        if not s: continue
        lead = wiki_lead(lang, s['title'], qid)
        txt = re.sub(r'\n{2,}', '\n', lead.get('text', '')).strip()
        if len(txt) > 60:
            paras = [p.strip() for p in txt.split('\n') if p.strip()]
            out, n = [], 0
            for p in paras:
                if n > 1100: break
                out.append(p); n += len(p)
            x['wiki'] = {'lang': lang, 'title': lead.get('title') or s['title'], 'text': out,
                         'url': f"https://{lang}.wikipedia.org/wiki/" + urllib.parse.quote((lead.get('title') or s['title']).replace(' ', '_'))}
            break
    # films: director, cast, country from Wikidata claims (labels fetched lazily below)
    cl = w.get('claims', {})
    def ids(p): return [c['mainsnak'].get('datavalue', {}).get('value', {}).get('id') for c in cl.get(p, []) if c['mainsnak'].get('datavalue')]
    for key, p in (('director', 'P57'), ('cast', 'P161'), ('writer', 'P58'), ('producer', 'P162'), ('award', 'P166'), ('nominated', 'P1411')):
        v = [i for i in ids(p) if i]
        if v: x['_' + key] = v[:8]
    return x

label_cache_p = os.path.join(E, '_labels.json')
LBL = json.load(open(label_cache_p)) if os.path.exists(label_cache_p) else {}
def labels(qids):
    need = [q for q in qids if q not in LBL]
    for i in range(0, len(need), 40):
        chunk = need[i:i + 40]
        u = 'https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=labels&languages=en|is&ids=' + '|'.join(chunk)
        d = {}
        for k in range(6):
            time.sleep(1.5 + 5 * k)
            try:
                d = json.load(urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=30)); break
            except urllib.error.HTTPError as ex:
                if ex.code != 429: raise
        for q, ent in d.get('entities', {}).items():
            l = ent.get('labels', {})
            LBL[q] = (l.get('en') or l.get('is') or {}).get('value', q)
    json.dump(LBL, open(label_cache_p, 'w'), ensure_ascii=False)
    return [LBL.get(q, q) for q in qids]

def main():
    C = load_catalogue()
    idx = {r['id']: r for r in (J('_index.json') or [])}
    out, gaps = OrderedDict(), []
    for e in C:
        rec = idx.get(e['id'], {})
        x = OrderedDict()
        if rec.get('discogs'): x.update(from_discogs(rec['discogs']))
        x.update(from_mb(rec))
        x.update(from_wiki(rec))
        for key in ('director', 'cast', 'writer', 'producer', 'award', 'nominated'):
            if '_' + key in x:
                x[key] = labels(x.pop('_' + key))
        if x: out[e['id']] = x
        score = sum(1 for k in ('wiki', 'credits', 'notes', 'editions', 'studios') if k in x)
        if e.get('tier') == 'core' and score < 2:
            gaps.append((e, x))
    dates = []
    for e in C:
        x = out.get(e['id'], {})
        src = x.get('first') or (x.get('released') or '').replace('-00', '')
        cur = e.get('date') or ''
        if src and len(src) >= 7 and (not cur or cur.endswith('-01-01') or (len(src) == 10 and cur[:7] != src[:7]) or src[:4] != cur[:4]):
            if src[:len(cur)] != cur:
                dates.append((e, cur or str(e.get('year')), src))
    js = '// Generated by tools/build_extra.py from public sources (Discogs CC0, MusicBrainz, Wikidata, Wikipedia CC BY-SA).\nwindow.EXTRA=' + json.dumps(out, ensure_ascii=False, separators=(',', ':')) + ';\n'
    open(os.path.join(ROOT, 'extra.js'), 'w', encoding='utf-8').write(js)
    lines = ['# Releases with little public information', '',
             'These are the releases where Discogs, MusicBrainz and Wikipedia gave little or nothing.',
             'Anything you can tell about them (who played, where it was recorded, a sentence of background, a link) will make their info window richer.', '']
    for e, x in sorted(gaps, key=lambda g: g[0]['year']):
        have = [k for k in ('wiki', 'credits', 'notes', 'editions', 'studios', 'cat') if k in x]
        lines.append(f"- **{e['title']}** — {e['artist']}, {e['year']}. Found: {', '.join(have) if have else 'nothing'}.")
    if dates:
        lines += ['', '## Release dates that differ from the sources', '', 'The site date first, then what Discogs or MusicBrainz say. Tell me which to use.', '']
        for e, cur, src in dates:
            lines.append(f"- **{e['title']}** ({e['artist']}): site {cur}, sources {src}")
    open(os.path.join(ROOT, 'data', 'info-gaps.md'), 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
    print('entries with extra', len(out), 'of', len(C), '| wiki', sum('wiki' in v for v in out.values()),
          '| credits', sum('credits' in v for v in out.values()), '| editions', sum('editions' in v for v in out.values()),
          '| gaps', len(gaps), '| bytes', len(js))

main()
