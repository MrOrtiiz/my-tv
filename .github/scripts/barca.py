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
MAX_CHANNELS = 12

# The channels in the order Yuri wants them: Spanish, English, Swedish, then every other language. A channel's language
# from the country in its name ("ES: …", "… FHD CL", "|UK| …", "[SE]") or in its guide id ("Movistar.es"), else from
# words that give it away. A country's language, not the country: Chile's and Mexico's channels are Spanish.
LANG_ORDER = ['es', 'en', 'sv', 'xx']
COUNTRY_LANG = {
    'es': 'es', 'esp': 'es', 'spa': 'es', 'mx': 'es', 'mex': 'es', 'ar': 'es', 'arg': 'es', 'cl': 'es', 'co': 'es',
    'pe': 'es', 've': 'es', 'ec': 'es', 'uy': 'es', 'py': 'es', 'bo': 'es', 'cr': 'es', 'pa': 'es', 'gt': 'es', 'hn': 'es',
    'ni': 'es', 'do': 'es', 'pr': 'es', 'cu': 'es', 'latam': 'es', 'lat': 'es', 'latino': 'es',
    'uk': 'en', 'gb': 'en', 'en': 'en', 'eng': 'en', 'us': 'en', 'usa': 'en', 'ie': 'en', 'ca': 'en', 'au': 'en', 'nz': 'en',
    'za': 'en', 'ng': 'en', 'ke': 'en', 'gh': 'en',
    'se': 'sv', 'swe': 'sv', 'sw': 'sv', 'sv': 'sv',
}
# Other countries' tags count too: "V Sport Live 1 NO" or "TV3 Sport DK" isn't Swedish because of its name.
COUNTRY_LANG.update({c: 'xx' for c in 'nl pt br cz sk pl gr tr de at fr it be ch bg hu si hr rs ba mk al ro lt lv ee dk no fi ru ua by qa sa ae sg hk jp kr cn il eg ma iq ir pk'.split()})
LANG_WORDS = [
    ('es', re.compile(r'movistar|\bm\+|dazn\s*(laliga|f1|es)|laliga\s*(tv\s*)?hypermotion|espn\s*deportes|deportes|'
                      r'\bgol\b|vamos|\btudn\b|univision|telemundo|tyc\s*sports|win\s*sports|\bcdo\b|tnt\s*sports\s*(chile|arg)|'
                      r'directv\s*sports|\bespañol\b|\bespanol\b|castellano|\bcuatro\b|telecinco|la\s*1\b|\btve\b', re.I)),
    ('sv', re.compile(r'\btv4\b|c\s*more|v\s*sport|viaplay\s*(se|sverige)|sportkanalen|\btv3\s*sport|\bsvt\b|\btv6\b|'
                      r'\bsverige\b|\bswedish\b|\bnordic\b', re.I)),
    ('en', re.compile(r'sky\s*sports|tnt\s*sports|bt\s*sport|premier\s*sports|laliga\s*tv|supersport|\bespn\b|cbs\s*sports|'
                      r'bein\s*sports\s*(usa|xtra|en)|\bfox\s*(sports|soccer)|\bfs1\b|paramount|peacock|\bstan\s*sport|'
                      r'optus|\benglish\b', re.I)),
]


def language(name, cid=''):
    """'es', 'en', 'sv' or 'xx' (any other) for a channel."""
    tags = re.findall(r'(?:^|[\s|\[(:])([A-Za-z]{2,5})(?=$|[\s|\]):])', name or '')
    # The country tags: written in capitals ("ES:", "|UK|", "FHD CL"), so words in the name don't count.
    for t in tags:
        if t.isupper() and t.lower() in COUNTRY_LANG:
            return COUNTRY_LANG[t.lower()]
    m = re.search(r'\.([a-z]{2,3})$', (cid or '').lower())
    if m and m.group(1) in COUNTRY_LANG:
        return COUNTRY_LANG[m.group(1)]
    for lang, words in LANG_WORDS:
        if words.search(name or ''):
            return lang
    return 'xx'


def ordered(chans, ids):
    """The channels sorted Spanish, English, Swedish, other (each kept in the guide's order), with their languages."""
    langs = {c: language(c, ids.get(c, '')) for c in chans}
    out = sorted(chans, key=lambda c: LANG_ORDER.index(langs[c]))
    return out, langs


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


# Barça's football fixtures, the truth the guide is checked against: ESPN's open schedule per competition, and
# TheSportsDB as a second source. A listing counts only when it starts at a fixture's kick-off: no basketball, no replays.
ESPN = 'https://site.api.espn.com/apis/site/v2/sports/soccer/%s/teams/83/schedule?fixture=true'
LEAGUES = [('esp.1', 'LaLiga'), ('uefa.champions', 'Champions League'), ('esp.copa_del_rey', 'Copa del Rey'),
           ('esp.super_cup', 'Supercopa'), ('club.friendly', 'Träningsmatch')]
SPORTSDB = 'https://www.thesportsdb.com/api/v1/json/3/eventsnext.php?id=133739'
OTHER_SPORT = re.compile(r'koszyk|basket|baloncesto|b[aà]squet|euroleague|euroliga|\bacb\b|handbal|futsal|hockey|'
                         r'waterpolo|volley|siatk|r[eé]plica|repet|\b(19|20)\d\d/\d\d\b|\b\d\d/\d\d\b', re.I)


def fold(text):
    """Lower case without accents: "Alavés" and "ALAVES" alike."""
    import unicodedata
    return ''.join(c for c in unicodedata.normalize('NFKD', text or '') if not unicodedata.combining(c)).lower()


def tokens(name):
    """The words that tell a club apart: "Atlético Madrid" → atletico, madrid; not "fc", "cd", "real"..."""
    common = {'club', 'real', 'deportivo', 'sporting', 'athletic', 'united', 'city', 'calcio', 'football', 'futbol', 'de', 'cf',
              'fc', 'cd', 'sc', 'ac', 'ud', 'rc', 'sd', 'afc', 'the'}
    return [w for w in re.findall(r'[a-z0-9]+', fold(name)) if len(w) >= 3 and w not in common]


def logo(team):
    """A team's crest as ESPN links it (its own image, never a copy of it), or ''."""
    for l in team.get('logos') or []:
        if l.get('href'):
            return l['href']
    return team.get('logo') or ''


CREST = {'url': ''}


def fixtures(now, until):
    out, used, errors = {}, [], []
    for slug, comp in LEAGUES:
        try:
            data = json.loads(fetch(ESPN % slug))
        except Exception as e:
            errors.append('espn %s: %s' % (slug, type(e).__name__))
            continue
        for ev in data.get('events') or []:
            try:
                kick = datetime.fromisoformat(ev['date'].replace('Z', '+00:00'))
            except Exception:
                continue
            if not now - timedelta(hours=2) <= kick <= until:
                continue
            comps = (ev.get('competitions') or [{}])[0].get('competitors', [])
            teams = [c.get('team', {}).get('displayName', '') for c in comps]
            logos = {c.get('team', {}).get('displayName', ''): logo(c.get('team', {})) for c in comps}
            for name, href in logos.items():
                if 'barcelona' in fold(name) and href and not CREST['url']:
                    CREST['url'] = href
            home = next((c.get('team', {}).get('displayName', '') for c in (ev.get('competitions') or [{}])[0].get('competitors', [])
                         if c.get('homeAway') == 'home'), teams[0] if teams else '')
            rival = next((t for t in teams if 'barcelona' not in fold(t)), '')
            if not rival:
                continue
            title = 'Barcelona – %s' % rival if 'barcelona' in fold(home) else '%s – Barcelona' % rival
            out[kick.strftime('%Y%m%d%H')] = {'kick': kick, 'rival': rival, 'title': title, 'competition': comp,
                                              'rival_logo': logos.get(rival, '')}
        used.append('espn ' + slug)
    try:
        data = json.loads(fetch(SPORTSDB))
        for ev in data.get('events') or []:
            if (ev.get('strSport') or 'Soccer') != 'Soccer':
                continue
            ts = ev.get('strTimestamp') or ''
            try:
                kick = datetime.fromisoformat(ts.replace('Z', '+00:00'))
                if kick.tzinfo is None:
                    kick = kick.replace(tzinfo=timezone.utc)
            except Exception:
                continue
            if not now - timedelta(hours=2) <= kick <= until:
                continue
            home, away = ev.get('strHomeTeam') or '', ev.get('strAwayTeam') or ''
            rival = away if 'barcelona' in fold(home) else home
            key = kick.strftime('%Y%m%d%H')
            if key not in out and rival:
                out[key] = {'kick': kick, 'rival': rival, 'competition': ev.get('strLeague') or '', 'rival_logo': '',
                            'title': 'Barcelona – %s' % rival if 'barcelona' in fold(home) else '%s – Barcelona' % rival}
        used.append('thesportsdb')
    except Exception as e:
        errors.append('thesportsdb: %s' % type(e).__name__)
    return sorted(out.values(), key=lambda f: f['kick']), used, errors


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


# LaLiga's table, Barça's form (the last five, every competition) and the league's top scorers, for the box's pages
# when it isn't match day. Each part on its own: one that fails is left out and named in league_errors.
STANDINGS = 'https://site.api.espn.com/apis/v2/sports/soccer/esp.1/standings'
RESULTS = 'https://site.api.espn.com/apis/site/v2/sports/soccer/%s/teams/83/schedule'
SCORERS = ['https://site.api.espn.com/apis/site/v2/sports/soccer/esp.1/statistics',
           'https://site.web.api.espn.com/apis/site/v2/sports/soccer/esp.1/statistics']


def num(v):
    """A score or a stat as ESPN gives it: a number, a string, or {value, displayValue}."""
    if isinstance(v, dict):
        v = v.get('value', v.get('displayValue'))
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


def table():
    data = json.loads(fetch(STANDINGS))
    groups = data.get('children') or [data]
    entries = ((groups[0].get('standings') or {}).get('entries')) or []
    rows = []
    for e in entries:
        st = {x.get('name') or x.get('type'): x.get('value') for x in e.get('stats') or []}
        t = e.get('team') or {}
        rows.append({'rank': num(st.get('rank')), 'team': t.get('displayName') or '', 'short': t.get('shortDisplayName') or t.get('displayName') or '',
                     'logo': logo(t), 'points': num(st.get('points')), 'played': num(st.get('gamesPlayed')),
                     'gd': num(st.get('pointDifferential')), 'barca': 'barcelona' in fold(t.get('displayName') or '')})
    rows = [r for r in rows if r['rank'] is not None]
    rows.sort(key=lambda r: r['rank'])
    if not rows:
        raise ValueError('no rows')
    return {'league': 'LaLiga', 'rows': rows}


def form():
    games = []
    for slug, comp in LEAGUES:
        try:
            data = json.loads(fetch(RESULTS % slug))
        except Exception:
            continue
        for ev in data.get('events') or []:
            c = (ev.get('competitions') or [{}])[0]
            if not ((c.get('status') or ev.get('status') or {}).get('type') or {}).get('completed'):
                continue
            us = them = None
            for t in c.get('competitors') or []:
                side = {'name': (t.get('team') or {}).get('shortDisplayName') or (t.get('team') or {}).get('displayName') or '',
                        'score': num(t.get('score')), 'home': t.get('homeAway') == 'home'}
                if 'barcelona' in fold((t.get('team') or {}).get('displayName') or ''):
                    us = side
                else:
                    them = side
            if not us or not them or us['score'] is None or them['score'] is None:
                continue
            res = 'V' if us['score'] > them['score'] else 'F' if us['score'] < them['score'] else 'O'
            games.append({'date': ev.get('date', ''), 'res': res, 'opp': them['name'], 'home': us['home'], 'comp': comp,
                          'score': '%d–%d' % (us['score'], them['score'])})
    games.sort(key=lambda g: g['date'])
    if not games:
        raise ValueError('no results')
    return games[-5:]


def scorers():
    for url in SCORERS:
        try:
            data = json.loads(fetch(url))
        except Exception:
            continue
        for cat in data.get('stats') or []:
            if 'goal' not in fold(cat.get('name') or '') and 'goal' not in fold(cat.get('displayName') or ''):
                continue
            out = []
            for l in (cat.get('leaders') or [])[:5]:
                a = l.get('athlete') or {}
                team = (a.get('team') or l.get('team') or {}).get('shortDisplayName') or (a.get('team') or l.get('team') or {}).get('displayName') or ''
                out.append({'name': a.get('displayName') or a.get('shortName') or '', 'team': team, 'goals': num(l.get('value')),
                            'barca': 'barcelona' in fold(team)})
            if out:
                return out
    raise ValueError('no scorers')


def league_info():
    info, errors = {}, []
    for key, fn in (('table', table), ('form', form), ('scorers', scorers)):
        try:
            info[key] = fn()
        except Exception as e:
            errors.append('%s: %s' % (key, type(e).__name__))
    info['league_errors'] = errors
    return info


def save(data):
    data.update(league_info())
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
            if NOT_LIVE.search(' '.join((text, cats))) or OTHER_SPORT.search(' '.join((text, cats))):
                continue
            if not timedelta(minutes=80) <= (stop - start) <= timedelta(hours=5):
                continue
            live = bool(re.search(r'\blive\b|\bdirekt\b|\bvivo\b|\bdirecto\b', ' '.join((text, cats, desc[:200])), re.I))
            found.append({'title': title or sub, 'start': start, 'stop': stop, 'channel': channel,
                          'live': live, 'category': cats.strip(), 'football': bool(MATCH.search(' '.join((text, cats, desc[:200])))),
                          'text': fold(' '.join((text, desc[:200])))})
    found.sort(key=lambda p: p['start'])
    games, used, errors = fixtures(now, until)
    if games:
        out = []
        for g in games[:MAX_MATCHES]:
            words = tokens(g['rival'])
            chans, ids = [], {}
            for p in found:
                if not -50 * 60 <= (p['start'] - g['kick']).total_seconds() <= 20 * 60:
                    continue
                # "Internazionale" is "Inter" in many guides, "Atlético" "Atletico" or "Atl.": the first five letters do.
                if not (any(w in p['text'] or (len(w) > 5 and w[:5] in p['text']) for w in words) or (not words and p['football'])):
                    continue
                name = names.get(p['channel'], p['channel'])
                if name and name not in chans:
                    chans.append(name)
                    ids[name] = p['channel']
            sorted_chans, langs = ordered(chans, ids)
            picked = sorted_chans[:MAX_CHANNELS]
            out.append({'title': g['title'], 'competition': g['competition'], 'rival_logo': g.get('rival_logo', ''),
                        'start': int(g['kick'].timestamp() * 1000),
                        'stop': int((g['kick'] + timedelta(hours=2)).timestamp() * 1000), 'live': bool(chans),
                        'channels': picked, 'channel_ids': [ids.get(c, '') for c in picked],
                        'channel_langs': [langs[c] for c in picked], 'more': max(0, len(chans) - MAX_CHANNELS)})
        save({'updated': int(now.timestamp() * 1000), 'status': 'ok', 'crest': CREST['url'], 'matches': out, 'source': used, 'source_errors': errors,
              'guide': {'channels': len(names), 'programmes': programmes, 'barca_listings': len(found),
                        'until': max(p['stop'] for p in found).isoformat() if found else None},
              'barca_titles_seen': seen})
        print('%d fixtures; %d with channels.' % (len(out), sum(1 for o in out if o['channels'])))
        return
    # No fixture list today: the guide alone, football only.
    found = [p for p in found if p['football']]
    matches = []
    for p in found:
        name = names.get(p['channel'], p['channel'])
        # The same match on several channels: listings that start within an hour of each other.
        m = next((m for m in matches if abs((p['start'] - m['first']).total_seconds()) <= 3600), None)
        if m is None:
            m = {'first': p['start'], 'titles': {}, 'channels': [], 'ids': {}, 'live': False, 'stop': p['stop']}
            matches.append(m)
        m['titles'][p['title']] = m['titles'].get(p['title'], 0) + 1
        m['live'] = m['live'] or p['live']
        if name and name not in m['channels']:
            m['channels'].append(name)
            m['ids'][name] = p['channel']
    out = []
    for m in matches[:MAX_MATCHES]:
        title = sorted(m['titles'].items(), key=lambda kv: (-kv[1], len(kv[0])))[0][0]
        title = re.sub(r'^\s*(live|direkt|en directo|en vivo)\s*[:|-]\s*', '', title, flags=re.I)
        sorted_chans, langs = ordered(m['channels'], m['ids'])
        picked = sorted_chans[:MAX_CHANNELS]
        out.append({'title': title, 'start': int(m['first'].timestamp() * 1000), 'stop': int(m['stop'].timestamp() * 1000),
                    'live': m['live'], 'channels': picked, 'channel_ids': [m['ids'].get(c, '') for c in picked],
                    'channel_langs': [langs[c] for c in picked],
                    'more': max(0, len(m['channels']) - MAX_CHANNELS)})
    data = {'updated': int(now.timestamp() * 1000), 'status': 'ok', 'matches': out,
            'guide': {'channels': len(names), 'programmes': programmes, 'barca_listings': len(found)},
            'barca_titles_seen': seen, 'source': used, 'source_errors': errors}
    save(data)
    print('%d channels, %d programmes, %d Barça listings kept, %d matches.' % (len(names), programmes, len(found), len(out)))


if __name__ == '__main__':
    main()
