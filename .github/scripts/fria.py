#!/usr/bin/env python3
"""Fria TV-kanaler för kompisens projektor: gratis, öppna strömmar från iptv-org (github.com/iptv-org/iptv, de
offentliga strömmar som kanalerna själva sänder ut), provade så att bara de som svarar kommer med.

Grupper: Sverige (SVT, Kunskapskanalen, nyhetskanaler, Pluto TV och Samsung TV Plus för Sverige), España, Nyheter
och Sport. Skriver data/fria-kanaler.json (för knappen TV-kanaler, tv/kanaler.js) och data/fria-kanaler.m3u (samma
lista för en IPTV-app). Körs av .github/workflows/fria.yml en gång om dagen.

Provet görs från GitHubs servrar i USA: en svensk kanal som bara sänds i Sverige (403 där) får vara kvar, en som
inte finns (404, inget svar) tas bort. Strömmar som kräver egna HTTP-huvuden (#EXTVLCOPT) hoppas över: webbsidans
spelare kan inte sätta dem.
"""
import concurrent.futures
import json
import os
import re
import time
import urllib.error
import urllib.request

RAW = 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/%s.m3u'
LOGOS = 'https://iptv-org.github.io/api/logos.json'
ROOT = os.path.join(os.path.dirname(__file__), '..', '..', 'data')
UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

# [grupp, listor, får svenska geo-spärrade vara kvar]
SOURCES = [
    ('Sverige', ['se', 'se_samsung', 'se_pluto'], True),
    ('España', ['es', 'es_samsung', 'es_pluto', 'es_rakuten'], False),
    ('Engelska', ['uk', 'uk_bbc', 'uk_samsung', 'uk_pluto', 'us_cbsn', 'us_abcnews', 'us_pbs'], False),
]
NEWS = re.compile(r'news|noticias|nyheter|\b24\b|24h|euronews|al ?jazeera|\bdw\b|france ?24|bloomberg|cnbc|sky news|'
                  r'expressen|\bdi tv\b|info\b|actualidad', re.I)
SPORT = re.compile(r'sport|deporte|f[uú]tbol|football|soccer|golf|racing|\batg\b|motor|\bfight|boxing|tennis|\bnfl\b|\bnba\b|'
                   r'fifa|uefa|laliga|\bliga\b|horse|\bski\b|esport', re.I)
SKIP = re.compile(r'adult|xxx|playboy|religio|church|iglesia|gospel|bible|quran|islam|god tv|miracle|mission', re.I)
MAX = {'Sverige': 120, 'España': 150, 'Nyheter': 60, 'Sport': 60, 'Engelska': 80}


def fetch(url, n=None, timeout=20):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read(n) if n else r.read()


def parse(text):
    out, info, opts = [], None, False
    for line in text.splitlines():
        line = line.strip()
        if line.startswith('#EXTINF'):
            info, opts = line, False
        elif line.startswith('#EXTVLCOPT') or line.startswith('#KODIPROP'):
            opts = True
        elif line and not line.startswith('#') and info:
            name = info.split(',', 1)[1].strip() if ',' in info else ''
            tid = re.search(r'tvg-id="([^"]*)"', info)
            if not opts and re.match(r'https?://', line):
                out.append({'id': tid.group(1) if tid else '', 'raw': name, 'url': line})
            info = None
    return out


def clean(name):
    """'SVT1 (1080p) [Geo-blocked]' → 'SVT1'; and what the tags say."""
    tags = re.findall(r'\[([^\]]+)\]', name)
    res = re.search(r'\((\d+)p\)', name)
    base = re.sub(r'\s*\[[^\]]*\]|\s*\(\d+p\)', '', name).strip()
    return base, {'geo': any('geo' in t.lower() for t in tags), 'not247': any('24/7' in t for t in tags),
                  'res': int(res.group(1)) if res else 0}


def check(url):
    """'ok', 'geo' (403/401/451: kanske bara utanför landet) eller 'dead'."""
    try:
        req = urllib.request.Request(url, headers={'User-Agent': UA})
        with urllib.request.urlopen(req, timeout=8) as r:
            head = r.read(4096)
            kind = (r.headers.get('Content-Type') or '').lower()
            if b'#EXTM3U' in head or 'mpegurl' in kind or 'mp2t' in kind or 'video' in kind or 'octet' in kind:
                return 'ok'
            return 'dead'
    except urllib.error.HTTPError as e:
        return 'geo' if e.code in (401, 403, 451) else 'dead'
    except Exception:
        return 'dead'


def main():
    logos = {}
    try:
        for l in json.loads(fetch(LOGOS, timeout=60)):
            if l.get('channel') and l.get('url') and not l.get('feed') and l['channel'] not in logos:
                logos[l['channel']] = l['url']
    except Exception as e:
        print('logos:', type(e).__name__)

    entries, seen = [], set()
    for group, lists, keep_geo in SOURCES:
        for prio, name in enumerate(lists):
            try:
                items = parse(fetch(RAW % name).decode('utf-8', 'replace'))
            except Exception as e:
                print('%s: %s' % (name, type(e).__name__))
                continue
            for it in items:
                if it['url'] in seen:
                    continue
                seen.add(it['url'])
                base, tags = clean(it['raw'])
                if not base or SKIP.search(base):
                    continue
                it.update({'group': group, 'name': base, 'keep_geo': keep_geo, 'prio': prio, **tags})
                it['logo'] = logos.get(it['id'].split('@')[0], '')
                entries.append(it)
    print('provar', len(entries), 'strömmar')

    with concurrent.futures.ThreadPoolExecutor(48) as pool:
        for it, res in zip(entries, pool.map(lambda e: check(e['url']), entries)):
            it['state'] = res

    groups = {'Sverige': [], 'España': [], 'Nyheter': [], 'Sport': [], 'Engelska': []}
    names = {g: {} for g in groups}
    for it in entries:
        ok = it['state'] == 'ok' or (it['state'] == 'geo' and (it['keep_geo'] or it['geo']) and it['group'] == 'Sverige')
        if not ok:
            continue
        ch = {'name': it['name'], 'logo': it['logo'], 'url': it['url'], 'prio': it['prio']}
        targets = [it['group']]
        if NEWS.search(it['name']):
            targets.append('Nyheter')
        if SPORT.search(it['name']):
            targets.append('Sport')
        for g in targets:
            key = it['name'].lower()
            prev = names[g].get(key)
            if prev is not None:   # samma kanal flera gånger: den med högst upplösning
                if it['res'] > prev[1]:
                    groups[g][prev[0]] = ch
                    names[g][key] = (prev[0], it['res'])
                continue
            names[g][key] = (len(groups[g]), it['res'])
            groups[g].append(ch)

    # SVT först, sedan landets egna kanaler (den första listan) före Pluto/Samsung, i bokstavsordning.
    order = lambda c: (0 if re.match(r'svt|kunskap|la 1\b|la 2\b|24 horas|antena 3|bbc', c['name'], re.I) else 1, c['prio'], c['name'].lower())
    out = []
    for g in ['Sverige', 'España', 'Nyheter', 'Sport', 'Engelska']:
        chans = sorted(groups[g], key=order)[:MAX[g]]
        for c in chans:
            c.pop('prio', None)
        if chans:
            out.append({'name': g, 'channels': chans})
        print(g, len(chans))

    os.makedirs(ROOT, exist_ok=True)
    data = {'updated': int(time.time() * 1000), 'source': 'iptv-org (github.com/iptv-org/iptv)', 'groups': out}
    with open(os.path.join(ROOT, 'fria-kanaler.json'), 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    with open(os.path.join(ROOT, 'fria-kanaler.m3u'), 'w', encoding='utf-8') as f:
        f.write('#EXTM3U\n')
        for g in out:
            for c in g['channels']:
                f.write('#EXTINF:-1 tvg-logo="%s" group-title="%s",%s\n%s\n' % (c['logo'], g['name'], c['name'], c['url']))


if __name__ == '__main__':
    main()
