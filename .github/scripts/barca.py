#!/usr/bin/env python3
"""FC Barcelona on your IPTV: reads the IPTV guide (XMLTV, the EPG link in the secret EPG_URL), finds the coming
matches of FC Barcelona (the next 8 days) and which of your channels show them, and writes data/barca.json for the
home screen's Barça box. Only the guide's listings are read; nothing is streamed. The link stays a secret: it's
never printed nor written to the file."""
import gzip
import io
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'barca.json')
TEAM = re.compile(r'\bbar(?:c|ç)elona\b|\bbar(?:c|ç)a\b|\bfcb\b', re.I)
NOT_LIVE = re.compile(r'highlight|höjdpunkt|sammandrag|magasin|magazine|repris|replay|rewind|classic|klassiker|'
                      r'preview|previa|pre-?match|optakt|studio|förhands|dokument|documentary|\(r\)|\brep\b|reprise|resumen|tennis|basket|handball|'
                      r'handboll|futsal|hockey|esport|\bopen\b', re.I)
MATCH = re.compile(r'\s[-–—]\s|\bv\.?\s|\bvs\.?\b|\bmot\b|\bcontra\b|fotboll|football|soccer|f[uú]tbol|liga|'
                   r'champions|copa|cup|supercopa|uefa', re.I)
DAYS = 14
MAX_MATCHES = 5
MAX_CHANNELS = 8


def when(text):
    """XMLTV time ("20261107200000 +0100") → aware datetime."""
    text = (text or '').strip()
    m = re.match(r'(\d{14})\s*([+-]\d{4})?', text)
    if not m:
        return None
    t = datetime.strptime(m.group(1), '%Y%m%d%H%M%S')
    z = m.group(2) or '+0000'
    off = timedelta(hours=int(z[1:3]), minutes=int(z[3:5])) * (1 if z[0] == '+' else -1)
    return t.replace(tzinfo=timezone(off))


def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (my-tv Barça box)', 'Accept-Encoding': 'gzip'})
    with urllib.request.urlopen(req, timeout=180) as r:
        raw = r.read()
    if raw[:2] == b'\x1f\x8b':
        raw = gzip.decompress(raw)
    return raw


def kind(raw):
    """What an answer is, in words that never quote it (it may hold the link or the login)."""
    head = raw[:2000].lstrip(b'\xef\xbb\xbf \t\r\n').lower()
    if not head:
        return 'an empty answer'
    if head.startswith(b'#extm3u'):
        return 'an M3U channel list'
    if head.startswith(b'<!doctype html') or head.startswith(b'<html') or b'<body' in head:
        return 'a web page'
    if head[:1] in (b'{', b'['):
        return 'JSON'
    if head.startswith(b'<?xml') or head.startswith(b'<tv') or head.startswith(b'<!doctype tv'):
        return 'XML'
    return 'something else (%d bytes)' % len(raw)


def guide(url):
    """The XMLTV guide behind the link: as is, or found from an M3U list (its url-tvg, or an Xtream login's xmltv.php)."""
    raw = fetch(url)
    if kind(raw) == 'an M3U channel list':
        first = raw[:4000].decode('utf-8', 'replace').splitlines()[0]
        m = re.search(r'(?:x-tvg-url|url-tvg|tvg-url)\s*=\s*"([^"]+)"', first, re.I)
        found = m.group(1).split(',')[0].strip() if m else ''
        if not found:
            u = urllib.parse.urlsplit(url)
            q = urllib.parse.parse_qs(u.query)
            if q.get('username') and q.get('password'):
                found = urllib.parse.urlunsplit((u.scheme, u.netloc, '/xmltv.php', urllib.parse.urlencode(
                    {'username': q['username'][0], 'password': q['password'][0]}), ''))
        if not found:
            raise ValueError('The link is an M3U channel list without a guide link in it.')
        print('The link is an M3U list: reading the guide it points to.')
        raw = fetch(found)
    k = kind(raw)
    if k != 'XML':
        raise ValueError('The guide link gave %s, not an XMLTV guide.' % k)
    return io.BytesIO(raw)


def save(data):
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write('\n')


def fail(now, why):
    """Says in the file what went wrong (never the link), so the box and whoever reads the file can tell."""
    save({'updated': int(now.timestamp() * 1000), 'status': 'error', 'error': why, 'matches': []})
    print(why)


def main():
    now = datetime.now(timezone.utc)
    url = os.environ.get('EPG_URL', '').strip()
    if not url:
        fail(now, 'No EPG_URL secret.')
        return
    until = now + timedelta(days=DAYS)
    names, found, seen, programmes = {}, [], [], 0
    try:
        src = guide(url)
    except urllib.error.HTTPError as e:  # the message may hold the link: only the kind of failure
        fail(now, 'The guide answered HTTP %d.' % e.code)
        return
    except ValueError as e:  # our own messages, which never quote the link
        fail(now, str(e))
        return
    except Exception as e:
        fail(now, 'Could not read the guide (%s).' % type(e).__name__)
        return
    try:
        events = list(ET.iterparse(src, events=('end',)))
    except ET.ParseError as e:
        fail(now, 'The guide is not XMLTV (%s).' % str(e)[:80])
        return
    for _, el in events:
        if el.tag == 'channel':
            dn = el.find('display-name')
            if dn is not None and dn.text:
                names[el.get('id')] = dn.text.strip()
            el.clear()
        elif el.tag == 'programme':
            title = (el.findtext('title') or '').strip()
            sub = (el.findtext('sub-title') or '').strip()
            desc = (el.findtext('desc') or '').strip()
            cats = ' '.join((c.text or '') for c in el.findall('category'))
            text = ' '.join((title, sub))
            start, stop, channel = when(el.get('start')), when(el.get('stop')), el.get('channel') or ''
            el.clear()
            programmes += 1
            if not start or not stop or stop <= now or start > until:
                continue
            if not TEAM.search(text):
                continue
            if len(seen) < 25:
                seen.append('%s | %s | %d min' % (start.strftime('%m-%d %H:%M'), text[:90], (stop - start).total_seconds() // 60))
            if NOT_LIVE.search(' '.join((text, cats))):
                continue
            if not timedelta(minutes=80) <= (stop - start) <= timedelta(hours=5):
                continue
            if not MATCH.search(' '.join((text, cats, desc[:200]))):
                continue
            live = bool(re.search(r'\blive\b|\bdirekt\b|\bvivo\b|\bdirecto\b', ' '.join((text, cats, desc[:200])), re.I))
            found.append({'title': title or sub, 'start': start, 'stop': stop, 'channel': channel,
                          'live': live, 'category': cats.strip()})
    found.sort(key=lambda p: p['start'])
    matches = []
    for p in found:
        name = names.get(p['channel'], p['channel'])
        # The same match on several channels: listings that start within an hour of each other.
        m = next((m for m in matches if abs((p['start'] - m['first']).total_seconds()) <= 3600), None)
        if m is None:
            m = {'first': p['start'], 'titles': {}, 'channels': [], 'live': False, 'stop': p['stop']}
            matches.append(m)
        m['titles'][p['title']] = m['titles'].get(p['title'], 0) + 1
        m['live'] = m['live'] or p['live']
        if name and name not in m['channels']:
            m['channels'].append(name)
    out = []
    for m in matches[:MAX_MATCHES]:
        title = sorted(m['titles'].items(), key=lambda kv: (-kv[1], len(kv[0])))[0][0]
        title = re.sub(r'^\s*(live|direkt|en directo|en vivo)\s*[:|-]\s*', '', title, flags=re.I)
        swedish = [c for c in m['channels'] if re.search(r'\b(se|swe|sverige|swedish|nordic)\b', c, re.I)]
        rest = [c for c in m['channels'] if c not in swedish]
        out.append({'title': title, 'start': int(m['first'].timestamp() * 1000), 'stop': int(m['stop'].timestamp() * 1000),
                    'live': m['live'], 'channels': (swedish + rest)[:MAX_CHANNELS], 'more': max(0, len(m['channels']) - MAX_CHANNELS)})
    data = {'updated': int(now.timestamp() * 1000), 'status': 'ok', 'matches': out,
            'guide': {'channels': len(names), 'programmes': programmes, 'barca_listings': len(found)},
            'barca_titles_seen': seen}
    save(data)
    print('%d channels, %d programmes, %d Barça listings kept, %d matches.' % (len(names), programmes, len(found), len(out)))


if __name__ == '__main__':
    main()
