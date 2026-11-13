#!/usr/bin/env python3
"""For finding how the IPTV list writes a film's languages: the films' names and what the server says of a few. Prints
names, categories and track fields only; never the link, the login or a stream's address. Run by hand."""
import collections, json, os, re, sys, urllib.parse
sys.path.insert(0, os.path.dirname(__file__))
from barca import fetch  # noqa: E402

url = os.environ['EPG_URL'].strip()
raw = fetch(url).decode('utf-8', 'replace')
films, info = [], None
for line in raw.splitlines():
    line = line.strip()
    if line.startswith('#EXTINF'):
        attr = dict(re.findall(r'([\w-]+)="([^"]*)"', line))
        info = (line.rsplit(',', 1)[-1].strip(), attr.get('group-title', ''))
    elif line and not line.startswith('#') and info:
        if '/movie/' in line:
            films.append((info[0], info[1], line.rsplit('/', 1)[-1].split('.')[0]))
        info = None
print('%d films' % len(films))
marks = collections.Counter()
for name, group, _ in films:
    for m in re.findall(r'[\[(|]([^\])|]{1,24})[\])|]', name):
        marks[m.strip().upper()] += 1
print('== bracket marks:', marks.most_common(80))
groups = collections.Counter(g for _, g, _ in films)
print('== groups:', [g for g, _ in groups.most_common(80)])
rx = re.compile(r'sub|multi|dual|vose|vos\b|latino|castellano|audio|lang|idioma|dub', re.I)
hits = [f for f in films if rx.search(f[0]) or rx.search(f[1])]
print('== %d names/groups with sub/multi/dual/vose/latino…:' % len(hits))
for n, g, _ in hits[:120]:
    print('   %s  |  %s' % (n, g))
# Same film, several entries?
base = collections.defaultdict(list)
for n, g, i in films:
    k = re.sub(r'[^a-z0-9]', '', re.sub(r'^\W*[a-z]{2,4}\s*[:|-]\s*|\s*[\[(].*$', '', n.lower()))
    base[k].append(n)
multi = [(k, v) for k, v in base.items() if len(v) > 2]
print('== films listed 3+ times: %d, e.g.:' % len(multi))
for k, v in multi[:40]:
    print('   ' + ' || '.join(v[:6]))
# What the server says of a few films.
q = urllib.parse.urlparse(url)
p = urllib.parse.parse_qs(q.query)
api = '%s://%s/player_api.php?username=%s&password=%s' % (q.scheme, q.netloc, urllib.parse.quote(p['username'][0]), urllib.parse.quote(p['password'][0]))
sample = (hits[:6] + films[:4])
for n, g, i in sample:
    try:
        d = json.loads(fetch(api + '&action=get_vod_info&vod_id=' + i))
    except Exception as e:
        print('   info for %s: %s' % (n, type(e).__name__)); continue
    inf = d.get('info') or {}
    md = d.get('movie_data') or {}
    print('== info for %s: info keys %s; movie_data keys %s' % (n, sorted(inf.keys()) if isinstance(inf, dict) else type(inf).__name__, sorted(md.keys())))
    for k in ('audio', 'subtitles', 'subtitle', 'video', 'language', 'lang'):
        if isinstance(inf, dict) and k in inf:
            print('   %s: %s' % (k, json.dumps(inf[k], ensure_ascii=False)[:400]))
    print('   container: %s' % md.get('container_extension'))
