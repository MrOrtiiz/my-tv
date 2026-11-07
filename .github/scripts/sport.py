#!/usr/bin/env python3
"""Sport on your IPTV: every match and sports event in the next 30 hours on all your channels, read from the whole
IPTV guide (XMLTV, the EPG link in the secret EPG_URL), for the IPTV app's Sport page. One row per broadcast (the same
match on many channels is one), its sport, and its channels in the order Spanish, English, Swedish, others.
Written to SPORT_OUT (the workflow publishes it as sport.json on the branch sport-data, without history, so main
doesn't get a commit every 3 hours). Only the guide's listings
are read; the link is never printed nor written."""
import json
import os
import re
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(__file__))
from barca import guide, language, when, fold, LANG_ORDER  # noqa: E402

OUT = os.environ.get('SPORT_OUT') or os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'sport.json')
HOURS = 30
MAX_EVENTS = 1500
MAX_CHANNELS = 24

# A sports channel by its name, or a sports programme by its category.
SPORT_CH = re.compile(r'sport|deport|f[uú]tbol|football|soccer|fotboll|laliga|la liga|premier|champions|dazn|espn|bein|'
                      r'eleven|movistar|\bm\+|tnt|sky sport|tv4 sport|v sport|viaplay|c more|eurosport|arena|\btudn\b|\bgol\b|'
                      r'win sports|tyc|fox sports|supersport|setanta|ziggo|canal\+|\bnba\b|\bnfl\b|\bnhl\b|\bf1\b|motor|golf|'
                      r'tennis|tenis|hockey|ufc|fight|racing|cycling|ciclismo|rugby|cricket|\bmlb\b|\bmls\b|polsat sport|'
                      r'sportklub|sport tv|setanta|match!|premier sports|sportdigital|digi sport|nova sport|cosmote', re.I)
SPORT_CAT = re.compile(r'sport|deporte|f[uú]tbol|football|soccer|fotboll|basket|tennis|hockey|motor|golf|boxing|racing|'
                       r'handball|balonmano|handboll|rugby|cycling|ciclismo|cykling|cricket|athletics|atletismo|friidrott|'
                       r'volleyball|voleibol|darts|snooker|wrestling|lucha|mma|ufc|nfl|nba|nhl|baseball|b[eé]isbol', re.I)
# What isn't the event itself.
NOT = re.compile(r'highlight|höjdpunkt|sammandrag|magasin|magazine|revista|repris|replay|rewind|classic|cl[aá]sico hist|'
                 r'klassiker|preview|previa|pre-?match|post-?match|post-?partido|optakt|studio|estudio|förhands|dokument|'
                 r'documentar|\(r\)|\brep\b|reprise|resumen|res[uú]menes|noticias|\bnews\b|nyheter|an[aá]lisis|analysis|'
                 r'tertulia|programa\b|countdown|best of|lo mejor|goles de|goals of|the debate|talk|podcast|teletienda|'
                 r'\bmagacín|\bshow\b|\bkick ?off show|warm[- ]?up|vorbericht|diferido|delayed|build[- ]?up|welcome to|overtime|'
                 r'pre-?game|post-?game|hoogtepunten|samenvatting|antevis[aã]o|resumo|zusammenfassung|skr[oó]t|sestřih|'
                 r'this week|learning center|the cut\b|\bhl\b|\breview\b|reaction|the week|weekly|round-?up|'
                 r'tactics|\bgoals\b|\bgoles\b|\bmål\b', re.I)
MATCH = re.compile(r'\S\s+(?:vs\.?|v\.?|–|—|-|x)\s+\S', re.I)
EVENT = re.compile(r'grand prix|\bgp\b|formula|f[oó]rmula|formel|\bf1\b|motogp|nascar|indycar|rally|ufc|boxing|boxeo|'
                   r'boxning|\bmma\b|\bwwe\b|tour de|giro|vuelta|\batp\b|\bwta\b|wimbledon|roland|open\b|masters|golf|'
                   r'\bpga\b|ryder|olympi|world cup|mundial|championship|campeonato|mästerskap|\bvm\b|\bem\b|race|carrera|'
                   r'qualifying|clasificaci[oó]n|practice|entrenamientos|sprint', re.I)
LIVE = re.compile(r'\blive\b|\bdirekt\b|\ben vivo\b|\ben directo\b|\bdirecto\b|\(d\)', re.I)
SPORTS = [
    ('f1', re.compile(r'\bf1\b|formula\s*1|f[oó]rmula\s*1|formel\s*1', re.I)),
    ('motor', re.compile(r'motogp|moto\s*gp|nascar|indycar|rally|\bwrc\b|superbike|\bdtm\b|formula\s*e\b|le mans|motorsport|'
                         r'grand prix|\bgp\b|speedway|motocross|supercars', re.I)),
    ('basket', re.compile(r'\bnba\b|\bwnba\b|basket|baloncesto|b[aà]squet|euroleague|euroliga|\bacb\b|basketligan', re.I)),
    ('hockey', re.compile(r'\bnhl\b|hockey|\bshl\b|\bkhl\b|hockeyallsvenskan', re.I)),
    ('tennis', re.compile(r'tennis|tenis|\batp\b|\bwta\b|wimbledon|roland garros|us open|australian open|davis cup|billie jean', re.I)),
    ('fight', re.compile(r'\bufc\b|\bmma\b|boxing|boxeo|boxning|\bwwe\b|kickbox|fight night|lucha libre|\baew\b', re.I)),
    ('nfl', re.compile(r'\bnfl\b|super bowl|american football|f[uú]tbol americano|ncaa football|college football', re.I)),
    ('golf', re.compile(r'\bgolf|\bpga\b|dp world tour|ryder cup|\blpga\b|\bliv golf', re.I)),
    ('cycling', re.compile(r'cycling|ciclismo|cykling|tour de france|giro d|vuelta a|\buci\b|paris-roubaix', re.I)),
    ('handball', re.compile(r'handball|balonmano|handboll|\behf\b', re.I)),
    ('rugby', re.compile(r'rugby|six nations|seis naciones', re.I)),
    ('other', re.compile(r'snooker|darts|dardos|athletics|atletismo|atletika|friidrott|marat[oó]n|marathon|swimming|'
                         r'nataci[oó]n|simning|biathlon|skiskytte|ski jumping|alpine|alpint|längdskidor|bandy|volley|'
                         r'voleibol|padel|p[aá]del|\bfip\b|figure skating|patinaje|konståk|artistik buz|esports|'
                         r'baseball|b[eé]isbol|\bmlb\b|cricket|futsal|floorball|innebandy|curling|equestrian|h[aä]st|'
                         r'\btrav\b|horse ?racing|hästsport', re.I)),
    ('football', re.compile(r'f[uú]tbol|football|soccer|fotboll|laliga|la liga|premier league|champions|europa league|'
                            r'conference league|allsvenskan|superettan|serie a|bundesliga|ligue 1|eredivisie|primeira|liga mx|'
                            r'copa|supercopa|uefa|fifa|\bfc\b|\bcf\b|\bif\b|\bfk\b|\bsk\b|united|\bcity\b|real |atl[eé]tico|'
                            r'bar[cç]a|barcelona|madrid|sevilla|liverpool|chelsea|arsenal|juventus|milan|inter\b|bayern|psg|'
                            r'ajax|benfica|porto|celtic|aik|djurg|hammarby|malm[oö]|sirius|boca|river', re.I)),
]


def sport_of(cats, title, desc, channel):
    """The sport: the guide's own category first, then the title, the description and the channel's name."""
    for text in (cats, title, desc, channel):
        for name, rx in SPORTS:
            if text and rx.search(text):
                return name
    return 'football' if MATCH.search(title) else 'other'


TEAM_WORDS = re.compile(r'\b(fc|cf|sc|ac|afc|cd|ud|rcd|sd|club|deportivo|calcio|if|ik|bk|fk|sk|ff|the)\b')
SEP = re.compile(r'\s+(?:vs\.?|v\.?|–|—|-|x)\s+', re.I)


def teams(title):
    """The two sides of "LaLiga EA Sports - Matchday 12: Valencia vs Real Madrid (Direto)": Valencia, Real Madrid."""
    part = re.split(r'\s*[:|]\s+', title)
    for p in reversed(part):
        m = SEP.split(p, maxsplit=1)
        # "Liga Portugal 2 2026-27 - FC Felgueiras x Leixões SC": the league before the first dash, the match after.
        while len(m) == 2 and SEP.search(m[1]):
            m = SEP.split(m[1], maxsplit=1)
        if len(m) == 2:
            return m[0], re.split(r'[(\[|,]', m[1])[0]
    return None


def key_of(title, start):
    """The same match on several channels: its two teams (without FC, CF…) and the half hour, else the title."""
    t = teams(title)
    if t:
        names = [re.sub(r'[^a-z0-9]', '', TEAM_WORDS.sub('', fold(x))) for x in t]
        if all(names):
            return '%s|%s|%d' % (names[0][:7], names[1][:7], int(start.timestamp()) // 1800)
    return '%s|%d' % (re.sub(r'[^a-z0-9]', '', fold(title))[:40], int(start.timestamp()) // 1800)


def main():
    now = datetime.now(timezone.utc)
    until = now + timedelta(hours=HOURS)
    url = os.environ.get('EPG_URL', '').strip()
    if not url:
        print('No EPG_URL secret.')
        return
    try:
        src = guide(url)
    except Exception as e:  # never the message: it may hold the link
        print('Could not read the guide (%s).' % type(e).__name__)
        return
    debug = os.environ.get('SPORT_DEBUG') == '1'
    seen, dropped = {}, {}
    names, events, read = {}, {}, 0
    for _, el in ET.iterparse(src, events=('end',)):
        if el.tag == 'channel':
            dn = el.find('display-name')
            if dn is not None and dn.text:
                names[el.get('id')] = dn.text.strip()
            el.clear()
            continue
        if el.tag != 'programme':
            continue
        read += 1
        title = (el.findtext('title') or '').strip()
        sub = (el.findtext('sub-title') or '').strip()
        desc = (el.findtext('desc') or '').strip()
        cats = ' '.join((c.text or '') for c in el.findall('category'))
        start, stop, cid = when(el.get('start')), when(el.get('stop')), el.get('channel') or ''
        el.clear()
        if not start or not stop or stop <= now or start >= until or not title:
            continue
        cname = names.get(cid, cid)
        if not (SPORT_CH.search(cname) or SPORT_CAT.search(cats)):
            continue
        text = ' '.join((title, sub))
        if debug:
            lg = language(cname, cid)
            seen.setdefault(lg, set()).add(cname)
        why = ''
        if NOT.search(text) or (NOT.search(cats) and not MATCH.search(text)):
            why = 'not'
        elif not (MATCH.search(text) or EVENT.search(text)):
            # Only "Live" to go on: a sport category, and a title that isn't just the channel's name.
            if not (LIVE.search(' '.join((text, desc[:120]))) and SPORT_CAT.search(cats)) or fold(title)[:8] in fold(cname):
                why = 'plain'
        if why:
            if debug and lg in ('es', 'sv', 'en'):
                dropped.setdefault((lg, why), []).append('%s | %s | %s | %s | %s' % (cname[:24], title[:50], sub[:30], cats[:20], desc[:50].replace('\n', ' ')))
            continue
        if (stop - start) < timedelta(minutes=20) or (stop - start) > timedelta(hours=10):
            continue
        # A generic title with the match in its sub-title: "LaLiga" / "Real Madrid - Sevilla".
        shown = title
        if sub and MATCH.search(sub) and not MATCH.search(title):
            shown = '%s: %s' % (title, sub)
        shown = re.sub(r'^\s*(live|en vivo|en directo|directo|direkt)\s*[:\-–|]\s*|^\s*\((d|en vivo|directo|live)\)\s*', '', shown, flags=re.I)
        shown = re.sub(r'\s*\((en )?(vivo|directo|live)\)\s*', ' ', shown, flags=re.I).strip()
        sp = sport_of(cats, shown, desc[:200], cname)
        # An F1 session is the same in every language, whatever each channel calls it.
        k = 'f1|%d' % (int(start.timestamp()) // 1800) if sp == 'f1' else key_of(shown, start)
        lang = language(cname, cid)
        rank = LANG_ORDER.index(lang)
        ev = events.get(k)
        if ev is None:
            ev = events[k] = {'t': shown, 'd': re.split(r'[.\n]', desc)[0][:90], 's': start, 'e': stop,
                              'sp': sp, 'c': [], 'ids': set(), 'r': rank}
        elif rank < ev['r'] or (rank == ev['r'] and len(shown) < len(ev['t']) and MATCH.search(shown)):
            # The title (and description) as the Spanish, else English, else Swedish channel writes it.
            ev['t'], ev['r'] = shown, rank
            ev['d'] = re.split(r'[.\n]', desc)[0][:90] or ev['d']
            if ev['sp'] == 'other':
                ev['sp'] = sp
        if cid not in ev['ids']:
            ev['ids'].add(cid)
            ev['c'].append([cname, cid, lang])
    # The channels once, the broadcasts by their numbers: [name, guide id, language].
    table, at, out, counts = [], {}, [], {}
    for ev in sorted(events.values(), key=lambda e: e['s']):
        chans = sorted(ev['c'], key=lambda c: LANG_ORDER.index(c[2]))[:MAX_CHANNELS]
        nums = []
        for c in chans:
            if c[1] not in at:
                at[c[1]] = len(table)
                table.append(c)
            nums.append(at[c[1]])
        out.append({'t': ev['t'], 'd': ev['d'], 's': int(ev['s'].timestamp() * 1000), 'e': int(ev['e'].timestamp() * 1000),
                    'sp': ev['sp'], 'c': nums})
        counts[ev['sp']] = counts.get(ev['sp'], 0) + 1
        if len(out) >= MAX_EVENTS:
            break
    data = {'updated': int(now.timestamp() * 1000), 'hours': HOURS, 'channels': len(names), 'programmes': read,
            'counts': counts, 'ch': table, 'ev': out}
    os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    print('%d channels, %d programmes, %d sport broadcasts: %s' % (len(names), read, len(out), counts))
    if debug:
        import random
        random.seed(1)
        for lg, chans in sorted(seen.items()):
            print('== %s: %d sport channels: %s' % (lg, len(chans), ', '.join(sorted(chans)[:80])))
        for (lg, why), rows in sorted(dropped.items()):
            print('== left out, %s, %s: %d' % (lg, why, len(rows)))
            for r in random.sample(rows, min(40, len(rows))):
                print('   ' + r)


if __name__ == '__main__':
    main()
