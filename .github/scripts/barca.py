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
DAYS = 8
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


def guide(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (my-tv Barça box)', 'Accept-Encoding': 'gzip'})
    with urllib.request.urlopen(req, timeout=180) as r:
        raw = r.read()
    if raw[:2] == b'\x1f\x8b':
        raw = gzip.decompress(raw)
    return io.BytesIO(raw)


def main():
    url = os.environ.get('EPG_URL', '').strip()
    if not url:
        sys.exit('No EPG_URL secret: add your IPTV guide link under Settings → Secrets and variables → Actions.')
    now = datetime.now(timezone.utc)
    until = now + timedelta(days=DAYS)
    names, found = {}, []
    try:
        src = guide(url)
    except Exception as e:  # the message may hold the link: say only what kind of failure it was
        sys.exit('Could not read the guide (%s).' % type(e).__name__)
    for _, el in ET.iterparse(src, events=('end',)):
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
            if not start or not stop or stop <= now or start > until:
                continue
            if not TEAM.search(text):
                continue
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
    data = {'updated': int(now.timestamp() * 1000), 'matches': out}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write('\n')
    print('%d channels in the guide, %d Barça listings, %d matches.' % (len(names), len(found), len(out)))


if __name__ == '__main__':
    main()
