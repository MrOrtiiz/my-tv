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
from barca import guide, language, when, fold, fetch, LANG_ORDER  # noqa: E402

OUT = os.environ.get('SPORT_OUT') or os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'sport.json')
HOURS = 30
MAX_EVENTS = 1500
MAX_CHANNELS = 24

# A sports channel by its name, or a sports programme by its category.
SPORT_CH = re.compile(r'sport|deport|f[uú]tbol|football|soccer|fotboll|laliga|la liga|hypermotion|premier league|'
                      r'premier sports|champions|liga de campeones|dazn|espn|bein|eleven|movistar\s*(liga|deport|campeones|'
                      r'f[uú]tbol|golf|vamos|laliga)|\bm\+\s*(liga|deport|campeones|golf|vamos|laliga)|tnt sports|sky sport|'
                      r'tv4 (sport|fotboll|hockey|tennis|motor)|v sport|viaplay sport|c more (sport|fotboll|hockey)|eurosport|'
                      r'arena sport|\btudn\b|\bgol\b|win sports|tyc|fox sports|fox deportes|fox soccer|supersport|setanta|'
                      r'ziggo sport|canal\+\s*sport|\bnba\b|\bnfl\b|\bnhl\b|\bmlb\b|\bf1\b|motor|golf|tennis|tenis|hockey|ufc|'
                      r'fight|racing|cycling|ciclismo|rugby|cricket|polsat sport|sportklub|sport tv|match!|sportdigital|'
                      r'digi sport|nova sport|cosmote sport|fanduel|altitude|marquee|nbc sports|cbs sports|champions league \d',
                      re.I)
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
                   r'qualifying|clasificaci[oó]n|practice|pr[aá]ctica|entrenamientos|sprint|gran premio|torneo|tournament|'
                   r'turnering|semi-?final|quarter-?final|cuartos de final|octavos|\bfinal\b|round of|kval\b|tävling', re.I)
# A competition's block, its teams in the description or not told ("LaLiga EA Sports", "Fotboll: Engelska Premier League").
COMP = re.compile(r'laliga|la liga|hypermotion|premier league|\bchampionship\b|bundesliga|serie a\b|ligue 1|eredivisie|'
                  r'primeira|liga portugal|champions league|liga de campeones|europa league|conference league|allsvenskan|'
                  r'superettan|\bshl\b|\bnba\b|\bnhl\b|\bnfl\b|\bmlb\b|\bmls\b|liga mx|liga saud|saudi pro|euroleague|'
                  r'euroliga|liga endesa|\bacb\b|copa del rey|fa cup|carabao|coppa italia|dfb|libertadores|sudamericana|'
                  r'supercopa|nations league|eliteserien|superliga|ligaen', re.I)
# "Fotboll: …", "Basket: NBA", "Tenis: …": the Nordic and Polish guides' way to write a match without its teams.
KIND = re.compile(r'^(fotboll|f[uú]tbol|football|basket|baloncesto|ishockey|hockey|handboll|balonmano|tennis|tenis|golf|'
                  r'motorsport|formel 1|f[oó]rmula 1|cykling|ciclismo|boxning|boxeo|mma|rugby|amerikansk fotboll|'
                  r'innebandy|bandy|friidrott|atletismo|pi[lł]ka no[zż]na|koszyk[oó]wka)\s*:', re.I)
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


# ESPN's open scoreboards, to name the match of a block that doesn't ("Fotboll: Tyska Bundesliga", "Från MEWA Arena i
# Mainz"): the league from the block's title, the match by its kick-off, and by its arena, city or team when several
# kick off together.
ESPN = 'https://site.api.espn.com/apis/site/v2/sports/%s/scoreboard?dates=%s'
LEAGUES = [
    (re.compile(r'hypermotion|laliga 2|segunda', re.I), 'soccer/esp.2', 'LaLiga Hypermotion'),
    (re.compile(r'laliga|la liga|\bspanska', re.I), 'soccer/esp.1', 'LaLiga'),
    (re.compile(r'premier league|\bengelska', re.I), 'soccer/eng.1', 'Premier League'),
    (re.compile(r'\bchampionship\b', re.I), 'soccer/eng.2', 'Championship'),
    (re.compile(r'bundesliga|\btyska', re.I), 'soccer/ger.1', 'Bundesliga'),
    (re.compile(r'serie a\b|\bitalienska', re.I), 'soccer/ita.1', 'Serie A'),
    (re.compile(r'ligue 1|\bfranska', re.I), 'soccer/fra.1', 'Ligue 1'),
    (re.compile(r'eredivisie|\bnederländska', re.I), 'soccer/ned.1', 'Eredivisie'),
    (re.compile(r'primeira|liga portugal|\bportugisiska', re.I), 'soccer/por.1', 'Liga Portugal'),
    (re.compile(r'champions league|liga de campeones', re.I), 'soccer/uefa.champions', 'Champions League'),
    (re.compile(r'europa league', re.I), 'soccer/uefa.europa', 'Europa League'),
    (re.compile(r'conference league', re.I), 'soccer/uefa.europa.conf', 'Conference League'),
    (re.compile(r'(?<!hockey)allsvenskan', re.I), 'soccer/swe.1', 'Allsvenskan'),
    (re.compile(r'liga saud|saudi pro|saudiska', re.I), 'soccer/ksa.1', 'Saudi Pro League'),
    (re.compile(r'\bmls\b', re.I), 'soccer/usa.1', 'MLS'),
    (re.compile(r'liga mx|mexikanska', re.I), 'soccer/mex.1', 'Liga MX'),
    (re.compile(r'copa del rey', re.I), 'soccer/esp.copa_del_rey', 'Copa del Rey'),
    (re.compile(r'\bnba\b', re.I), 'basketball/nba', 'NBA'),
    (re.compile(r'\bnhl\b', re.I), 'hockey/nhl', 'NHL'),
    (re.compile(r'\bnfl\b', re.I), 'football/nfl', 'NFL'),
]
FIXTURES = {}


def fixtures_of(path, now):
    """The matches of a league yesterday, today and tomorrow (ESPN's days are American): [(kick-off, home, away, words of the arena and city)]."""
    if path in FIXTURES:
        return FIXTURES[path]
    out = []
    for day in (now - timedelta(days=1), now, now + timedelta(days=1)):
        try:
            data = json.loads(fetch(ESPN % (path, day.strftime('%Y%m%d'))))
        except Exception:
            continue
        for ev in data.get('events') or []:
            try:
                kick = datetime.fromisoformat(ev['date'].replace('Z', '+00:00'))
                comp = (ev.get('competitions') or [{}])[0]
                sides = {c.get('homeAway'): c.get('team', {}).get('displayName', '') for c in comp.get('competitors', [])}
                venue = comp.get('venue') or {}
                place = fold(' '.join((venue.get('fullName') or '', (venue.get('address') or {}).get('city') or '')))
            except Exception:
                continue
            if sides.get('home') and sides.get('away'):
                out.append((kick, sides['home'], sides['away'], place))
    FIXTURES[path] = out
    return out


def name_match(title, desc, start, now):
    """'Bundesliga: Mainz – Bayern Munich' for a block of a league whose match isn't in its title, else None."""
    text = '%s %s' % (title, desc[:160])
    for rx, path, league in LEAGUES:
        if rx.search(text):
            break
    else:
        return None
    near = [f for f in fixtures_of(path, now) if timedelta(minutes=-20) <= f[0] - start <= timedelta(minutes=35)]
    if len(near) > 1:
        words = fold(text)
        named = [f for f in near if any(w in words for w in
                 [x for x in re.findall(r'[a-z0-9]{4,}', f[3]) if x not in ('arena', 'stadium', 'stadion', 'estadio', 'park', 'city')]
                 + [x for x in re.findall(r'[a-z0-9]{4,}', fold(f[1] + ' ' + f[2])) if x not in ('real', 'city', 'united')])]
        near = named if len(named) == 1 else []
    if len(near) != 1:
        return None
    return '%s: %s – %s' % (league, near[0][1], near[0][2])


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
            return '%s|%s|%d' % (names[0][:5], names[1][:5], int(start.timestamp()) // 1800)
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
            # A competition's block ("LaLiga EA Sports", "Fotboll: Tyska Bundesliga") as long as a match, or "Live" with
            # a sport category; never a title that is just the channel's name ("M+ LaLiga 3", "DAZN LaLiga 2").
            flat = lambda x: re.sub(r'[^a-z0-9]', '', fold(x))
            block = (KIND.search(title) or COMP.search(title)) and timedelta(minutes=60) <= stop - start <= timedelta(hours=4)
            live = LIVE.search(' '.join((text, desc[:120]))) and SPORT_CAT.search(cats)
            if not (block or live) or flat(title)[:8] in flat(cname) or flat(cname)[:8] in flat(title):
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
        if not MATCH.search(shown):
            named = name_match(shown, desc, start, now)
            if named:
                shown = named
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
