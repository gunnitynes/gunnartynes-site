"""Fetch everything public we can find about each catalogue entry, into research/enrich/.
Discogs (CC0 release data), MusicBrainz, Wikidata and Wikipedia (summaries, CC BY-SA, shown with a link).
Re-runnable: skips what is already saved. Usage: python3 tools/enrich_fetch.py"""
import json, os, re, sys, time, urllib.request, urllib.parse, urllib.error, subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'research', 'enrich')
os.makedirs(OUT, exist_ok=True)
UA = {'User-Agent': 'CatalogueEnricher/1.0 (personal discography site)'}

def load_catalogue():
    js = open(os.path.join(ROOT, 'catalogue.js'), encoding='utf-8').read()
    return json.loads(js[js.index('['):js.rindex(']') + 1])

last = {}
def get(url, host_gap=1.2, tries=6):
    host = urllib.parse.urlparse(url).netloc
    wait = host_gap - (time.time() - last.get(host, 0))
    if wait > 0: time.sleep(wait)
    for i in range(tries):
        try:
            last[host] = time.time()
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 404: return None
            if e.code == 503: time.sleep(3 + 3 * i); continue      # MusicBrainz: just slow down
            if e.code == 429: time.sleep(60); continue             # Discogs: wait out the minute
            raise
        except Exception:
            time.sleep(5 * (i + 1))
    return None

def cached(name, fn):
    p = os.path.join(OUT, name)
    if os.path.exists(p):
        return json.load(open(p, encoding='utf-8'))
    v = fn()
    if v is None and not name.startswith(('mb_url_',)): return None   # a failure: try again next run
    json.dump(v, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    return v

DG = lambda u: get(u, host_gap=2.6)

def wiki_summary(lang, title):
    t = urllib.parse.quote(title.replace(' ', '_'), safe='')
    return get(f'https://{lang}.wikipedia.org/api/rest_v1/page/summary/{t}', host_gap=0.3)

def wikidata(qid):
    d = get(f'https://www.wikidata.org/wiki/Special:EntityData/{qid}.json', host_gap=0.3)
    return d and d['entities'].get(qid)

def wd_by_imdb(tt):
    q = f'SELECT ?item WHERE {{ ?item wdt:P345 "{tt}" }}'
    d = get('https://query.wikidata.org/sparql?format=json&query=' + urllib.parse.quote(q), host_gap=1)
    b = d and d['results']['bindings']
    return b[0]['item']['value'].rsplit('/', 1)[1] if b else None

def main():
    C = load_catalogue()
    report = []
    for e in C:
        rec = {'id': e['id']}
        L = e.get('links') or {}
        # Discogs
        dl = L.get('discogs', '')
        m = re.search(r'/(release|master)/(\d+)', dl)
        rel = None
        if m:
            kind, num = m.groups()
            if kind == 'master':
                ms = cached(f'dg_master_{num}.json', lambda: DG(f'https://api.discogs.com/masters/{num}'))
                if ms and ms.get('main_release'):
                    num = str(ms['main_release'])
            rel = cached(f'dg_release_{num}.json', lambda: DG(f'https://api.discogs.com/releases/{num}'))
            if rel and rel.get('master_id'):
                mid = rel['master_id']
                cached(f'dg_master_{mid}.json', lambda: DG(f'https://api.discogs.com/masters/{mid}'))
                cached(f'dg_versions_{mid}.json', lambda: DG(f'https://api.discogs.com/masters/{mid}/versions?per_page=100'))
            rec['discogs'] = num
        # MusicBrainz via the Discogs URL, else via an existing MB link
        mbrel = None
        mbl = L.get('musicbrainz', '')
        mm = re.search(r'/release/([0-9a-f-]{36})', mbl)
        if mm:
            mbrel = mm.group(1)
        elif rec.get('discogs'):
            def look():
                return get('https://musicbrainz.org/ws/2/url?fmt=json&inc=release-rels+release-group-rels&resource=' +
                           urllib.parse.quote(f'https://www.discogs.com/release/{rec["discogs"]}'))
            u = cached(f'mb_url_{rec["discogs"]}.json', look)
            for r in (u or {}).get('relations', []):
                if r.get('release'): mbrel = r['release']['id']; break
        qid = None
        if mbrel:
            r = cached(f'mb_release_{mbrel}.json', lambda: get(f'https://musicbrainz.org/ws/2/release/{mbrel}?fmt=json&inc=release-groups+url-rels+labels+recordings+artist-credits+recording-level-rels+work-rels+artist-rels'))
            rec['mb_release'] = mbrel
            rg = r and r.get('release-group', {}).get('id')
            if rg:
                g = cached(f'mb_rg_{rg}.json', lambda: get(f'https://musicbrainz.org/ws/2/release-group/{rg}?fmt=json&inc=url-rels+tags+genres'))
                rec['mb_rg'] = rg
                for rr in (g or {}).get('relations', []):
                    if rr.get('type') == 'wikidata':
                        qid = rr['url']['resource'].rsplit('/', 1)[1]
        # Films: Wikidata through the IMDb id
        if not qid and L.get('imdb'):
            t = re.search(r'tt\d+', L['imdb'])
            if t:
                v = cached(f'wd_imdb_{t.group(0)}.json', lambda: {'qid': wd_by_imdb(t.group(0))})
                qid = v and v.get('qid')
        if qid:
            rec['qid'] = qid
            w = cached(f'wd_{qid}.json', lambda: wikidata(qid))
            sl = (w or {}).get('sitelinks', {})
            for lang in ('en', 'is'):
                s = sl.get(f'{lang}wiki')
                if s:
                    cached(f'wp_{lang}_{qid}.json', lambda: wiki_summary(lang, s['title']))
                    rec.setdefault('wiki', []).append(lang)
        report.append(rec)
        print(json.dumps(rec, ensure_ascii=False), flush=True)
    json.dump(report, open(os.path.join(OUT, '_index.json'), 'w'), ensure_ascii=False, indent=1)
    print('DONE', len(report), 'discogs', sum(1 for r in report if r.get('discogs')), 'mb', sum(1 for r in report if r.get('mb_release')), 'wiki', sum(1 for r in report if r.get('wiki')))

main()
