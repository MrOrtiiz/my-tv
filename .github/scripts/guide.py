#!/usr/bin/env python3
"""A TV guide for every channel: the IPTV list's channels that have no guide of their own (no guide id, or nothing in
the IPTV guide for the coming day) get one from the open guides of epgshare01 (one XMLTV file per country), matched by
their name. Written to GUIDE_OUT (the workflow publishes it as guide.json on the branch sport-data, beside sport.json);
the IPTV app uses it when the server has no guide for a channel.

guide.json: {updated, m: {channel name or '#'+guide id: n}, g: [[[start, stop, title, description], ...], ...]}
(times in ms). Only names and listings are read and written: never the link, the login or a stream's address."""
import gzip
import json
import os
import re
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(__file__))
from barca import fetch, guide, when, fold, kind  # noqa: E402

OUT = os.environ.get('GUIDE_OUT') or os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'guide.json')
BACK, AHEAD = timedelta(hours=1), timedelta(hours=26)
SHARE = 'https://epgshare01.online/epgshare01/epg_ripper_%s.xml.gz'
# A channel's country, from the tag in its name or group ("ES:", "|UK|", "SE ·", "… FHD MX"), → epgshare01's files.
COUNTRY_FILES = {
    'es': ['ES1'], 'esp': ['ES1'], 'spain': ['ES1'], 'uk': ['UK1'], 'gb': ['UK1'], 'se': ['SE1'], 'swe': ['SE1'],
    'us': ['US2', 'US_SPORTS1'], 'usa': ['US2', 'US_SPORTS1'], 'mx': ['MX1'], 'mex': ['MX1'], 'ar': ['AR1'], 'arg': ['AR1'],
    'co': ['CO1'], 'cl': ['CL1'], 'pe': ['PE1'], 'latam': ['MX1', 'AR1', 'CO1'], 'latino': ['MX1', 'AR1', 'CO1'],
    'ca': ['CA2'], 'ie': ['IE1'], 'au': ['AU1'], 'de': ['DE1'], 'fr': ['FR1'], 'it': ['IT1'], 'pt': ['PT1'],
    'nl': ['NL1'], 'dk': ['DK1'], 'no': ['NO1'], 'fi': ['FI1'], 'pl': ['PL1'], 'tr': ['TR1'], 'br': ['BR1'],
}
# Spanish, English and Swedish always; the others when many channels need them.
ALWAYS = ['ES1', 'UK1', 'SE1', 'US2', 'US_SPORTS1']
MAX_FILES = 14
QUALITY = re.compile(r'\b(fhd|uhd|hd|sd|4k|8k|hevc|h\.?265|h\.?264|hdr|50fps|60fps|fps|backup|raw|vip|multi[- ]?audio|'
                     r'ᴴᴰ|ᶠᴴᴰ|ᵁᴴᴰ|ˢᴰ|ʰᵈ|ʳᵃʷ)\b', re.I)


def norm(name):
    """'ES: Movistar LaLiga FHD' and 'Movistar LaLiga' alike: no country tag, quality, brackets or signs."""
    s = fold(name)
    s = re.sub(r'^\s*(\|[^|]{1,12}\||[a-z]{2,6}\s*[:|]|\[[^\]]{1,12}\])\s*', '', s)
    s = re.sub(r'[\[(][^\])]*[\])]', ' ', s)
    s = QUALITY.sub(' ', s)
    s = re.sub(r'\s+(es|uk|gb|se|us|usa|mx|ar|co|cl|pe|ca|ie|au|de|fr|it|pt|nl|dk|no|fi|pl|tr|br)\s*$', '', s)
    # Movistar's channels go by "M+ …" and "Movistar …" (and "Movistar Plus+ …").
    s = re.sub(r'^\s*(m\s*\+|movistar\s*(plus\s*\+?|\+)?)\s*', 'movistar ', s)
    s = s.replace('+', 'plus').replace('&', 'and')
    return re.sub(r'[^a-z0-9]', '', s)


def keys(name):
    """A name's keys: as normalised, and without an "hd" glued on ("BBCScotlandHD")."""
    k = norm(name)
    return [k, k[:-2]] if k.endswith('hd') and len(k) > 4 else [k]


def country(name, group, gid=''):
    """The channel's country: a capital tag in its name or group, else its guide id's ending ("dazn1.es")."""
    for text in (name, group):
        for t in re.findall(r'(?:^|[\s|\[(:\-])([A-Za-z]{2,6})(?=$|[\s|\]):\-])', text or ''):
            if t.isupper() and t.lower() in COUNTRY_FILES:
                return t.lower()
    m = re.search(r'\.([a-z]{2,3})$', (gid or '').lower())
    return m.group(1) if m and m.group(1) in COUNTRY_FILES else ''


def files_of(cc):
    """epgshare01's files for a country; for a channel of no known country, the Spanish, English and Swedish ones."""
    return COUNTRY_FILES.get(cc) or ['ES1', 'UK1', 'SE1', 'US2']


def m3u_channels(raw):
    """The live channels of an M3U list: [(name, guide id, group)]; films, series and adult groups left out."""
    out, info = [], None
    for line in raw.decode('utf-8', 'replace').splitlines():
        line = line.strip()
        if line.startswith('#EXTINF'):
            attr = dict(re.findall(r'([\w-]+)="([^"]*)"', line))
            info = (line.rsplit(',', 1)[-1].strip(), attr.get('tvg-id', '').strip(), attr.get('group-title', ''))
        elif line and not line.startswith('#') and info:
            # The address only says whether it's a channel; it is never kept.
            if not re.search(r'/(movie|series)/', line) and not re.search(r'adult|xxx|18\+|porn', info[2], re.I):
                out.append(info)
            info = None
    return out


def listed(src, now):
    """The guide ids with something in the IPTV guide from now on, for the coming day."""
    have = set()
    for _, el in ET.iterparse(src, events=('end',)):
        if el.tag == 'programme':
            stop, start = when(el.get('stop')), when(el.get('start'))
            if stop and start and stop > now and start < now + timedelta(hours=24):
                have.add(el.get('channel'))
        if el.tag in ('programme', 'channel'):
            el.clear()
    return have


SEEN = {}   # with GUIDE_DEBUG: every name of each file, to show what didn't match


def share(code, wanted, now):
    """Of one epgshare01 file: the channels named like a wanted name ({norm: ext id}) and their listings."""
    try:
        raw = fetch(SHARE % code)
    except Exception as e:
        print('  %s: not read (%s)' % (code, type(e).__name__))
        return {}, {}
    if raw[:2] == b'\x1f\x8b':
        raw = gzip.decompress(raw)
    if kind(raw) != 'XML':
        print('  %s: not a guide (%s)' % (code, kind(raw)))
        return {}, {}
    import io
    names, progs = {}, {}
    for _, el in ET.iterparse(io.BytesIO(raw), events=('end',)):
        if el.tag == 'channel':
            cid = el.get('id') or ''
            ks = [k for d in el.findall('display-name') for k in keys(d.text or '')] + keys(cid.rsplit('.', 1)[0])
            if os.environ.get('GUIDE_DEBUG') == '1':
                SEEN.setdefault(code, []).append('%s=%s' % (cid, ks[0] if ks else ''))
            for k in ks:
                if k and k in wanted and k not in names:
                    names[k] = code + ':' + cid
            el.clear()
        elif el.tag == 'programme':
            cid = code + ':' + (el.get('channel') or '')
            start, stop = when(el.get('start')), when(el.get('stop'))
            if start and stop and stop > now - BACK and start < now + AHEAD:
                progs.setdefault(cid, []).append([int(start.timestamp() * 1000), int(stop.timestamp() * 1000),
                                                  (el.findtext('title') or '').strip()[:90],
                                                  re.split(r'(?<=[.!?])\s', (el.findtext('desc') or '').strip())[0][:90]])
            el.clear()
    used = set(names.values())
    progs = {c: sorted(p) for c, p in progs.items() if c in used}
    print('  %s: %d of the wanted names, %d with listings' % (code, len(names), len(progs)))
    return names, progs


def main():
    now = datetime.now(timezone.utc)
    url = os.environ.get('EPG_URL', '').strip()
    if not url:
        print('No EPG_URL secret.')
        return
    try:
        raw = fetch(url)
    except Exception as e:  # never the message: it may hold the link
        print('Could not read the list (%s).' % type(e).__name__)
        return
    if kind(raw) != 'an M3U channel list':
        print('The link is %s, not an M3U list: no channel names to match.' % kind(raw))
        return
    chans = m3u_channels(raw)
    del raw
    try:
        have = listed(guide(url), now)
    except Exception as e:
        print('Could not read the IPTV guide (%s); every channel counts as without one.' % type(e).__name__)
        have = set()
    without = [c for c in chans if not (c[1] and c[1] in have)]
    print('%d channels, %d without a guide of their own.' % (len(chans), len(without)))
    # The files to read: by the countries of the channels without a guide.
    need = {}
    for name, gid, group in without:
        for code in files_of(country(name, group, gid)):
            need[code] = need.get(code, 0) + 1
    files = [c for c in ALWAYS if c in need] + sorted((c for c in need if c not in ALWAYS), key=lambda c: -need[c])
    files = files[:MAX_FILES]
    print('Reading %s' % ', '.join('%s (%d)' % (c, need[c]) for c in files))
    by_country = {}
    for name, gid, group in without:
        by_country.setdefault(country(name, group, gid), []).append((name, gid, norm(name)))
    found, listings = {}, {}
    for code in files:
        wanted = {n for cc, items in by_country.items() if code in files_of(cc) for _, _, n in items if n}
        names, progs = share(code, wanted, now)
        for k, v in names.items():
            found.setdefault(code, {})[k] = v
        listings.update(progs)
    # Each channel without a guide → the first file of its country that has its name.
    table, at, m = [], {}, {}
    for cc, items in by_country.items():
        for name, gid, n in items:
            ext = next((found[c][n] for c in files_of(cc) if n in found.get(c, {}) and found[c][n] in listings), None)
            if not ext:
                continue
            if ext not in at:
                at[ext] = len(table)
                table.append(listings[ext])
            m[name] = at[ext]
            if gid:
                m['#' + gid] = at[ext]
    if os.environ.get('GUIDE_DEBUG') == '1':
        import random
        random.seed(2)
        for cc in ('es', 'se', 'uk', 'us', ''):
            miss = [(name, n) for name, _, n in by_country.get(cc, []) if name not in m]
            print('== %s: %d without a match, e.g.: %s' % (cc or '?', len(miss), ' | '.join('%s→%s' % x for x in random.sample(miss, min(60, len(miss))))))
        for code in ('ES1', 'SE1', 'UK1'):
            names = SEEN.get(code, [])
            print('== %s has %d channels, e.g.: %s' % (code, len(names), ' | '.join(random.sample(names, min(80, len(names))))))
    data = {'updated': int(now.timestamp() * 1000), 'm': m, 'g': table}
    os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    got = len([k for k in m if not k.startswith('#')])
    print('A guide from the net for %d of the %d channels without one (%d guides, %d KB).'
          % (got, len(without), len(table), os.path.getsize(OUT) // 1024))


if __name__ == '__main__':
    main()
