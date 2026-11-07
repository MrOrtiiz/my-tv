/*
 * Sport: every match and sports event of the next 24 hours on your channels, one group per sport on the left (Fotboll
 * first, then Basket, F1, Motorsport, Tennis, Hockey, Kampsport, Amerikansk fotboll, Golf, Cykling, Handboll, Rugby,
 * Övrig sport; only those with something on). Under Fotboll the favourite teams (Barça, Sirius) come first, marked ★.
 * - All of it from sport.json on the repo's branch sport-data: the GitHub job (.github/scripts/sport.py) reads the whole
 *   IPTV guide every 3 hours and keeps the sport broadcasts, in every language, each with all its channels. Here they
 *   are found in the list (by guide id, else name), in the language order Spanish, English, Swedish, others; channels in
 *   hidden or locked groups are left out (Barça and Sirius keep hidden ones; locked ones never). Matches with a
 *   Spanish, English or Swedish channel come before those only on channels in other languages.
 * - Barça's next match also from data/barca.json (the same as Free My TV's Barça box).
 * - Without sport.json (or when it is older than 12 hours): the guide of the sport channels read here, as many of each
 *   language (at most 180 in all), so English and Swedish ones aren't crowded out by the Spanish.
 * OK plays the match: ▲ ▼ (or the channel keys) switch between its channels, as from the Barça box. A match more than
 * 10 minutes away gets a reminder instead.
 * Uses App.u (app.js). ES5 only.
 */
var Sport = (function () {
  'use strict';
  var BARCA_API = 'https://api.github.com/repos/MrOrtiiz/my-tv/contents/data/barca.json?ref=main';
  var FEED = ['https://raw.githubusercontent.com/MrOrtiiz/my-tv/sport-data/sport.json',
    'https://api.github.com/repos/MrOrtiiz/my-tv/contents/sport.json?ref=sport-data'];
  var MAX = 180, AHEAD = 24 * 3600000, STALE = 12 * 3600000;
  var SPORT = /sport|deport|\bnba\b|basket|\bf1\b|formula|motor|eurosport|tennis|tenis|hockey|\bnhl\b|\bufc\b|fight|golf|rugby|cycling|ciclismo|f[uú]tbol|football|soccer|fotboll|laliga|la liga|premier|champions|dazn|espn|bein|eleven|movistar\s*(liga|deport|campeones|f[uú]tbol)|m\+\s*(liga|deport|campeones)|tnt sport|sky sport|tv4 sport|v sport|viaplay|c more|arena|\btudn\b|\bgol\b|win sports|tyc|fox sports|supersport|setanta|ziggo sport|canal\+\s*sport/i;
  var MATCH = /\S\s+(vs\.?|v\.?|–|—|-)\s+\S/i;
  var EVENT = /grand prix|\bgp\b|formula|f[oó]rmula 1|\bf1\b|motogp|ufc|boxing|boxeo|boxning|\bnba\b|\bnhl\b|\bnfl\b|tour de|giro|vuelta|atp|wta|wimbledon|roland|open\b|golf|\bpga\b|race|carrera/i;
  var NOT = /highlight|resumen|res[uú]menes|magazine|revista|noticias|news|preview|previa|post[\s-]?partido|an[aá]lisis|tertulia|programa|repetici[oó]n|replay|\(r\)|\brepris|diferido|\bclassic|cl[aá]sico hist|documental|studio|estudio|the debate|countdown|goals? of|goles de|best of|lo mejor/i;
  var FOOTBALL = /laliga|la liga|premier league|champions|europa league|conference league|allsvenskan|superettan|serie a|bundesliga|ligue 1|eredivisie|primeira|liga mx|copa|supercopa|f[uú]tbol|football|soccer|fotboll|uefa|fifa|mundial|world cup|eurocopa|\bfc\b|\bcf\b|\bif\b|\bfk\b|\bsk\b|united|\bcity\b|real |atl[eé]tico|barcelona|bar[cç]a|madrid|sevilla|valencia|betis|villarreal|athletic|osasuna|girona|liverpool|chelsea|arsenal|tottenham|newcastle|juventus|milan|inter|napoli|roma|bayern|dortmund|leverkusen|psg|marseille|ajax|psv|benfica|porto|sporting|celtic|rangers|aik|djurg[aå]rden|hammarby|malm[oö]|g[oö]teborg|elfsborg|h[aä]cken|boca|river|am[eé]rica|chivas|tigres|monterrey/i;
  var BARCA = /bar[cç]a|barcelona/i;
  /** The favourite teams: first under their sport, marked ★ (Barça also has its own colours). */
  var FAVS = [['Barça', BARCA], ['Sirius', /\bsirius\b/i]];  // Sirius = IK Sirius FK (football only, see collect)
  /** The sports, in the order of the groups (the ids are sport.py's); here the first that matches a programme wins. */
  var SPORTS = [
    ['f1', 'F1', /\bf1\b|formula\s*1|f[oó]rmula\s*1|formel\s*1|grand prix de f|\bf1 (gp|grand)/i],
    ['motor', 'Motorsport', /motogp|moto\s*gp|nascar|indycar|rally|\bwrc\b|\bwec\b|endurance|superbike|\bdtm\b|formula\s*e\b|le mans|porsche|carrera cup|supercup|autorace|\d+\s*(horas|hours|uur|timmar|heures|ore)\b|\bgt3?\b|\btcr\b|touring car|dakar|karting|grand prix|\bgp\b|speedway|motocross/i],
    ['basket', 'Basket', /\bnba\b|\bwnba\b|basket|baloncesto|b[aà]squet|euroleague|euroliga|\bacb\b|basketligan/i],
    ['hockey', 'Hockey', /\bnhl\b|hockey|\bshl\b|\bkhl\b|hockeyallsvenskan/i],
    ['tennis', 'Tennis', /tennis|tenis|\batp\b|\bwta\b|wimbledon|roland garros|us open|australian open|davis cup/i],
    ['fight', 'Kampsport', /\bufc\b|\bmma\b|boxing|boxeo|boxning|\bwwe\b|kickbox|fight night/i],
    ['nfl', 'Amerikansk fotboll', /\bnfl\b|super bowl|american football|f[uú]tbol americano|college football/i],
    ['golf', 'Golf', /\bgolf|\bpga\b|dp world tour|ryder cup|\blpga\b/i],
    ['cycling', 'Cykling', /cycling|ciclismo|cykling|tour de france|giro d|vuelta a|\buci\b/i],
    ['handball', 'Handboll', /handball|balonmano|handboll|\behf\b/i],
    ['rugby', 'Rugby', /rugby|six nations|seis naciones/i],
    ['football', 'Fotboll', null],
    ['other', 'Övrig sport', null]
  ];
  var FOOTBALL_AT = 11;

  var V = null, focused = false, barca = null, barcaAt = 0, feed = null, feedAt = 0, feedTried = 0;

  function U() { return App.u; }
  function clean(t) { return String(t || '').replace(/^\s*(live|en vivo|en directo|directo|direkt)\s*[:\-–|]\s*|^\s*\((d|en vivo|directo|live)\)\s*/i, '').replace(/\s*\((en )?(vivo|directo|live)\)\s*/ig, ' ').replace(/\s+/g, ' ').trim(); }
  function nkey(t) { return clean(t).toLowerCase().replace(/[^a-z0-9]+/g, ''); }
  function favOf(t) { for (var f = 0; f < FAVS.length; f++) if (FAVS[f][1].test(t)) return FAVS[f][0]; return ''; }

  function get(url, done) {
    var x = new XMLHttpRequest();
    try { x.open('GET', url, true); if (url.indexOf('api.github.com') >= 0) x.setRequestHeader('Accept', 'application/vnd.github.raw+json'); } catch (e) { done(null); return; }
    x.timeout = 20000;
    x.onreadystatechange = function () {
      if (x.readyState !== 4) return;
      var d = null;
      try { if (x.status === 200) d = JSON.parse(x.responseText); } catch (e) {}
      done(d);
    };
    x.send();
  }

  function loadBarca(done) {
    if (barca && Date.now() - barcaAt < 30 * 60000) { done(); return; }
    get(BARCA_API, function (d) { if (d && d.matches) { barca = d; barcaAt = Date.now(); } done(); });
  }

  /** sport.json: the sport broadcasts of the whole guide (kept 15 minutes; tried again after 2 if it failed). */
  function loadFeed(done) {
    if (feed && Date.now() - feedAt < 15 * 60000) { done(); return; }
    if (!feed && Date.now() - feedTried < 2 * 60000) { done(); return; }
    feedTried = Date.now();
    (function next(i) {
      if (i >= FEED.length) { done(); return; }
      get(FEED[i] + (i === 0 ? '?t=' + Math.floor(Date.now() / 300000) : ''), function (d) {
        if (d && d.ev && d.ch) { feed = d; feedAt = Date.now(); done(); } else next(i + 1);
      });
    })(0);
  }
  function feedOk() { return !!(feed && Date.now() - feed.updated < STALE); }

  /** The sport channels for the guide read here: from open groups, as many of each language, at most MAX. */
  function sportChannels() {
    var u = U(), by = {es: [], en: [], sv: [], xx: []}, out = [];
    u.shown().forEach(function (g) {
      if (Lock.locked(g)) return;
      var all = u.channelsOf(g), byGroup = SPORT.test(g.name);
      for (var i = 0; i < all.length; i++) if (byGroup || SPORT.test(all[i].name)) {
        var l = Lang.of ? Lang.of(g.name) : 'xx';
        if (l === 'xx' && Lang.of) l = Lang.of(all[i].name, all[i].epg);
        (by[l] || by.xx).push(all[i]);
      }
    });
    for (var n = 0; out.length < MAX; n++) {
      var any = false;
      ['es', 'en', 'sv', 'xx'].forEach(function (l) { if (by[l][n] && out.length < MAX) { out.push(by[l][n]); any = true; } });
      if (!any) break;
    }
    return out;
  }

  function build(main) {
    var u = U();
    main.className = 'sport';
    var fHost = u.el('div', 'col groups glass', main), eHost = u.el('div', 'col events glass', main);
    V = {zone: 'events', events: [], read: 0, chans: [], filter: 'all', loading: true};
    V.status = u.el('div', 'sstatus', fHost);
    V.filters = new u.List(u.el('div', 'flist', fHost), 76, function (f, r) { u.el('div', 'name', r, f[1]); if (f[3]) u.el('span', 'n', r, String(f[3])); });
    V.list = new u.List(eHost, 112, row);
    V.list.emptyText = 'Hämtar sporten…';
    V.filters.set([SPORTS[FOOTBALL_AT].concat([0])], 0);
    V.list.set([]);
    focus(focused);
    status();
    var mine = V, waiting = 2;
    function ready() {
      if (V !== mine || --waiting) return;
      V.loading = false;
      if (feedOk()) { collect(); return; }
      // No sport.json: read the sport channels' guides here.
      V.chans = sportChannels();
      var left = V.chans.length;
      if (!left) { V.list.emptyText = 'Hittade inga sportkanaler i din lista.'; collect(); return; }
      V.chans.forEach(function (ch) {
        u.guideOf(ch, function () {
          if (V !== mine) return;
          V.read++;
          if (--left === 0 || V.read % 12 === 0) collect();
          status();
        });
      });
      status();
    }
    loadBarca(ready);
    loadFeed(ready);
  }

  function status() {
    if (!V) return;
    var u = U();
    if (V.loading) V.status.textContent = 'Hämtar sporten…';
    else if (V.fromFeed) V.status.textContent = V.all.length + ' sändningar · hela tablån ' + u.hm(feed.updated);
    else V.status.textContent = V.read < V.chans.length ? 'Läser tablån: ' + V.read + ' av ' + V.chans.length + ' sportkanaler' : V.chans.length + ' sportkanaler · ' + V.events.length + ' sändningar';
  }

  /** sport.json's channels in the list: every stream with the guide id (FHD, HD…), else the one with the name. */
  function feedChannels() {
    var u = U(), all = u.channels(), byEpg = {}, out = [], i;
    if (feed._list === all) return feed._map;
    for (i = 0; i < all.length; i++) if (all[i].epg) (byEpg[all[i].epg] = byEpg[all[i].epg] || []).push(all[i]);
    for (i = 0; i < feed.ch.length; i++) {
      var f = feed.ch[i], got = (f[1] && byEpg[f[1]]) ? byEpg[f[1]].slice(0, 4) : [];
      if (!got.length) { var c = u.find(f[0], ''); if (c) got = [c]; }
      out.push(got);
    }
    feed._list = all; feed._map = out;
    return out;
  }

  /** May the channel be used for this event: never from a locked group, from a hidden one only for a favourite. */
  function allowed(c, fav, hidden) {
    var g = U().groupById(c.cat);
    if (!g) return true;
    if (Lock.locked(g)) return false;
    return !hidden[g.id] || !!fav;
  }

  function fromFeed(now, end) {
    var map = feedChannels(), hidden = Store.hidden(), list = [];
    for (var i = 0; i < feed.ev.length; i++) {
      var e = feed.ev[i];
      if (e.e <= now || e.s >= end) continue;
      var t = clean(e.t), fav = favOf(t), chans = [];
      for (var j = 0; j < e.c.length; j++) {
        var got = map[e.c[j]] || [];
        for (var k = 0; k < got.length; k++) if (chans.indexOf(got[k]) < 0 && allowed(got[k], fav, hidden)) chans.push(got[k]);
      }
      if (!chans.length) continue;
      list.push({title: t, desc: e.d || '', start: e.s, stop: e.e, channels: chans, sport: e.sp || 'other', barca: BARCA.test(t), text: t});
    }
    return list;
  }

  function fromGuides(now, end) {
    var u = U(), byKey = {}, list = [];
    V.chans.forEach(function (ch) {
      u.guideOf(ch, function (progs) {
        for (var i = 0; i < progs.length; i++) {
          var p = progs[i], t = clean(p.title);
          if (p.stop <= now || p.start >= end || !t || NOT.test(t)) continue;
          if (!MATCH.test(t) && !EVENT.test(t)) continue;
          var k = nkey(t) + '|' + Math.round(p.start / 600000);
          var ev = byKey[k];
          if (!ev) {
            ev = byKey[k] = {title: t, desc: (p.desc || '').split(/[.\n]/)[0].slice(0, 90), start: p.start, stop: p.stop, channels: [],
              text: t + ' ' + (p.desc || '').slice(0, 200), barca: BARCA.test(t)};
            list.push(ev);
          }
          if (ev.channels.indexOf(ch) < 0) ev.channels.push(ch);
        }
      });
    });
    return list;
  }

  /** The matches and events, Barça's first. */
  function collect() {
    if (!V) return;
    var u = U(), now = Date.now(), end = now + AHEAD;
    V.fromFeed = feedOk();
    var list = V.fromFeed ? fromFeed(now, end) : fromGuides(now, end);
    // Barça's next match from barca.json (its channels are filled in the day before).
    var bm = barca && barca.matches && barca.matches[0];
    if (bm && bm.stop > now) {
      var found = null;
      for (var i = 0; i < list.length; i++) if (list[i].barca && (!list[i].sport || list[i].sport === 'football') && Math.abs(list[i].start - bm.start) < 3 * 3600000 && (!found || list[i].channels.length > found.channels.length)) found = list[i];
      var chans = [];
      // Barça's channels even from hidden groups (hiding is for the lists, not for Barça); locked ones stay out.
      (bm.channels || []).forEach(function (n, j) {
        var c = u.find(n, (bm.channel_ids || [])[j]), g = c && u.groupById(c.cat);
        if (c && chans.indexOf(c) < 0 && !(g && Lock.locked(g))) chans.push(c);
      });
      if (found) { found.title = bm.title; found.desc = bm.competition || found.desc; chans.forEach(function (c) { if (found.channels.indexOf(c) < 0) found.channels.push(c); }); found.next = true; found.sport = 'football'; }
      else list.push({title: bm.title, desc: bm.competition || '', start: bm.start, stop: bm.stop, channels: chans, sport: 'football', barca: true, next: true, text: bm.title});
    }
    // The other favourites' next match (sport.json's fav, from ESPN): on its row if the guide has it, else a row of its own.
    var favs = feedOk() && feed.fav || [], nextOf = {};
    favs.forEach(function (m) {
      if (m.e <= now || nextOf[m.team]) return;
      nextOf[m.team] = m;
      var hit = null;
      for (var i = 0; i < list.length; i++) if ((!list[i].sport || list[i].sport === 'football') && favOf(list[i].title) === m.team && Math.abs(list[i].start - m.s) < 90 * 60000) hit = list[i];
      if (hit) hit.next = true;
      else list.push({title: m.t, desc: m.comp, start: m.s, stop: m.e, channels: [], sport: 'football', next: true, text: m.t});
    });
    list.forEach(function (ev) {
      ev.channels.sort(function (a, b) { return Lang.rank(a.name, a.epg) - Lang.rank(b.name, b.epg); });
      ev.live = ev.start <= now && now < ev.stop;
      if (!ev.sport) ev.sport = sportOf(ev);
      // A favourite is a football match of the team ("Porsche Cup … in Barcelona" or "6 Horas de Barcelona" isn't), and
      // Barça's only when barca.json has a match then: any other Barça match today is a replay.
      ev.fav = ev.sport === 'football' && MATCH.test(ev.title) ? favOf(ev.title) : '';
      // A favourite's match at a time its schedule doesn't have is a replay (Barça: barca.json; the others: sport.json).
      var known = ev.fav === 'Barça' ? (barca && barca.matches ? barca.matches.map(function (m) { return m.start; }) : null)
        : ev.fav && feedOk() && feed.fav_ok ? favs.filter(function (m) { return m.team === ev.fav; }).map(function (m) { return m.s; }) : null;
      if (ev.fav && !ev.next && known) {
        var real = false;
        known.forEach(function (t) { if (Math.abs(t - ev.start) < 90 * 60000) real = true; });
        if (!real) { ev.fav = ''; ev.replay = true; }
      }
      ev.barca = ev.fav === 'Barça';
      // On a Spanish, English or Swedish channel (0), or only in other languages (1).
      ev.other = ev.channels.length && Lang.rank(ev.channels[0].name, ev.channels[0].epg) >= 3 ? 1 : 0;
    });
    // Favourites first, then what's on in Spanish, English or Swedish (now first, then by time), then the rest.
    list.sort(function (a, b) { return (!!b.fav - !!a.fav) || (a.other - b.other) || (b.live - a.live) || (a.start - b.start); });
    V.all = list;
    // The groups: Fotboll always, the others when they have something.
    var n = {}, cats = [];
    list.forEach(function (e) { n[e.sport] = (n[e.sport] || 0) + 1; });
    cats.push(SPORTS[FOOTBALL_AT].concat([n.football || 0]));
    SPORTS.forEach(function (sp) { if (sp[0] !== 'football' && n[sp[0]]) cats.push(sp.concat([n[sp[0]]])); });
    var cur = V.filters.current(), at = 0;
    for (var c = 0; c < cats.length; c++) if (cur && cats[c][0] === cur[0]) at = c;
    V.filters.set(cats, at);
    show();
  }

  /** The sport of a match: by its title and description, then its channels' names; a match ("A – B") on a football
   *  channel, or with a football word, is football. */
  function sportOf(ev) {
    var names = ev.channels.map(function (c) { return c.name; }).join(' ');
    for (var i = 0; i < SPORTS.length; i++) if (SPORTS[i][2] && SPORTS[i][2].test(ev.text)) return SPORTS[i][0];
    if (FOOTBALL.test(ev.text)) return 'football';
    for (i = 0; i < SPORTS.length; i++) if (SPORTS[i][2] && SPORTS[i][2].test(names)) return SPORTS[i][0];
    return MATCH.test(ev.title) ? 'football' : 'other';
  }

  function show() {
    var f = (V.filters.current() || ['football'])[0], cur = V.list.current();
    V.events = (V.all || []).filter(function (e) { return e.sport === f; });
    var at = cur ? V.events.indexOf(cur) : 0;
    V.list.emptyText = V.loading ? 'Hämtar sporten…' : !V.fromFeed && V.read < V.chans.length ? 'Läser tablån för sportkanalerna…' : 'Inget i tablån de närmaste timmarna.';
    V.list.set(V.events, at < 0 ? 0 : at);
    status();
  }

  function row(ev, r) {
    var u = U(), now = Date.now();
    if (ev.barca) r.className += ' barca';
    else if (ev.fav === 'Sirius') r.className += ' sirius';
    else if (ev.fav) r.className += ' fav';
    // The time on its own line, the day (imorgon, lör 8 nov) small above it: nothing runs into the title.
    var time = u.el('div', 'etime' + (ev.live ? ' live' : ''), r);
    if (!ev.live && new Date(ev.start).getDate() !== new Date().getDate()) u.el('div', 'eday', time, ev.start - now > 2 * 86400000 ? new Date(ev.start).toLocaleDateString('sv-SE', {weekday: 'short', day: 'numeric', month: 'short'}) : 'imorgon');
    u.el('div', 'ehm', time, ev.live ? 'NU' : u.hm(ev.start));
    var t = u.el('div', 'text', r);
    u.el('div', 'name', t, (ev.fav ? '★  ' : '') + ev.title);
    if (ev.replay && ev.desc.indexOf('Repris') !== 0) ev.desc = 'Repris' + (ev.desc ? ' · ' + ev.desc : '');
    var names = ev.channels.slice(0, 3).map(function (c) { var tag = Lang.tag(c.name, c.epg); return (tag ? tag + ' ' : '') + c.name.replace(/^\s*[A-Z]{2,3}\s*[:|\-]\s*|^\|[A-Z]{2,3}\|\s*/, ''); });
    var sub = [ev.desc, names.length ? names.join(' · ') + (ev.channels.length > 3 ? ' +' + (ev.channels.length - 3) : '') : (ev.next ? 'Kanalerna kommer dagen före matchen' : '')].filter(function (x) { return x; }).join('   ·   ');
    u.el('div', 'now', t, sub);
    if (ev.live) { var bar = u.el('div', 'progress', t), fl = u.el('div', 'fill', bar); fl.style.width = Math.min(100, (now - ev.start) / (ev.stop - ev.start) * 100) + '%'; }
  }

  function play(ev) {
    var u = U();
    if (!ev.channels.length) { u.toast(ev.next ? 'Kanalerna för matchen fylls i dagen före.' : 'Ingen kanal hittades.'); return; }
    if (!ev.live && ev.start - Date.now() > 10 * 60000) {
      Epg.toggle(ev.channels[0], {title: ev.title, start: ev.start, stop: ev.stop});
      V.list.draw();
      return;
    }
    Player.open(ev.channels, 0, {title: ev.title + (ev.channels.length > 1 ? '  ·  ▲ ▼ byter kanal' : '')});
  }

  function key(k, K) {
    if (V.zone === 'filters') {
      if (k === K.up) { if (!V.filters.move(-1)) return 'tabs'; show(); }
      else if (k === K.down) { if (V.filters.move(1)) show(); }
      else if (k === K.right || k === K.ok) V.zone = 'events';
      else if (k === K.back) return 'tabs';
      focus(true);
      return;
    }
    if (k === K.up) { if (!V.list.move(-1)) return 'tabs'; }
    else if (k === K.down) V.list.move(1);
    else if (k === K.left) V.zone = 'filters';
    else if (k === K.ok && V.list.current()) { play(V.list.current()); return; }
    else if (k === K.back) return 'tabs';
    focus(true);
  }

  function focus(on) {
    focused = on;
    if (!V) return;
    V.filters.focus(on && V.zone === 'filters');
    V.list.focus(on && V.zone === 'events');
  }

  return {build: build, key: key, focus: focus, leave: function () { V = null; }};
})();
