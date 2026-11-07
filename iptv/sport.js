/*
 * Sport: what's on now and the rest of the day on the sport channels, one group per sport on the left (Fotboll first,
 * then Basket, F1, Motorsport, Tennis, Hockey, Kampsport, Amerikansk fotboll, Övrig sport; only those with something on).
 * Under Fotboll the favourite teams (Barça, Sirius) come first, marked ★; every other match follows.
 * - Barça: the next match from data/barca.json in the repo (the same file as Free My TV's Barça box), with its
 *   channels found in the list, also in hidden groups (not locked ones); and every programme in the guide with Barça in
 *   its title.
 * - The rest: the guide of the sport channels (groups or channels named sport, deportes, LaLiga, DAZN, Sky Sports, ESPN,
 *   TV4 Sport…; Spanish, English and Swedish first, at most 160), read a few at a time. Programmes that look like a
 *   match ("A – B", "A vs B") or a race or a fight; the same match on several channels is one row, its channels in the
 *   language order. Replays, highlights and studio shows are left out.
 * OK plays the match: ▲ ▼ (or the channel keys) switch between its channels, as from the Barça box.
 * Uses App.u (app.js). ES5 only.
 */
var Sport = (function () {
  'use strict';
  var BARCA_API = 'https://api.github.com/repos/MrOrtiiz/my-tv/contents/data/barca.json?ref=main';
  var MAX = 160, AHEAD = 16 * 3600000;
  var SPORT = /sport|deport|\bnba\b|basket|\bf1\b|formula|motor|eurosport|tennis|tenis|hockey|\bnhl\b|\bufc\b|fight|f[uú]tbol|football|soccer|laliga|la liga|premier|champions|dazn|espn|bein|eleven|movistar\s*(liga|deport|campeones|f[uú]tbol)|m\+\s*(liga|deport|campeones)|tnt sport|sky sport|tv4 sport|v sport|viaplay sport|c more (fotboll|sport)|arena|\btudn\b|\bgol\b|win sports|tyc|fox sports|supersport|setanta|ziggo sport|canal\+\s*sport/i;
  var MATCH = /\S\s+(vs\.?|v\.?|–|—|-)\s+\S/i;
  var EVENT = /grand prix|\bgp\b|formula|f[oó]rmula 1|\bf1\b|motogp|ufc|boxing|boxeo|boxning|\bnba\b|\bnhl\b|\bnfl\b|tour de|giro|vuelta|atp|wta|wimbledon|roland|open\b/i;
  var NOT = /highlight|resumen|res[uú]menes|magazine|revista|noticias|news|preview|previa|post[\s-]?partido|an[aá]lisis|tertulia|programa|repetici[oó]n|replay|\(r\)|\brepris|diferido|\bclassic|cl[aá]sico hist|documental|studio|estudio|the debate|countdown|goals? of|goles de|best of|lo mejor/i;
  var FOOTBALL = /laliga|la liga|premier league|champions|europa league|conference league|allsvenskan|superettan|serie a|bundesliga|ligue 1|eredivisie|primeira|liga mx|copa|supercopa|f[uú]tbol|football|soccer|fotboll|uefa|fifa|mundial|world cup|eurocopa|\bfc\b|\bcf\b|\bif\b|\bfk\b|\bsk\b|united|\bcity\b|real |atl[eé]tico|barcelona|bar[cç]a|madrid|sevilla|valencia|betis|villarreal|athletic|osasuna|girona|liverpool|chelsea|arsenal|tottenham|newcastle|juventus|milan|inter|napoli|roma|bayern|dortmund|leverkusen|psg|marseille|ajax|psv|benfica|porto|sporting|celtic|rangers|aik|djurg[aå]rden|hammarby|malm[oö]|g[oö]teborg|elfsborg|h[aä]cken|boca|river|am[eé]rica|chivas|tigres|monterrey/i;
  var BARCA = /bar[cç]a|barcelona/i;
  /** The favourite teams: first under their sport, marked ★ (Barça also has its own colours). */
  var FAVS = [['Barça', BARCA], ['Sirius', /\bsirius\b/i]];
  /** The sports, in the order of the groups; the first that matches a programme (title, description, channel) wins. */
  var SPORTS = [
    ['f1', 'F1', /\bf1\b|formula\s*1|f[oó]rmula\s*1|formel\s*1|grand prix de f|\bf1 (gp|grand)/i],
    ['motor', 'Motorsport', /motogp|moto\s*gp|nascar|indycar|rally|\bwrc\b|superbike|\bdtm\b|formula\s*e\b|le mans|grand prix|\bgp\b/i],
    ['basket', 'Basket', /\bnba\b|\bwnba\b|basket|baloncesto|euroleague|euroliga|\bacb\b|ncaa.*basket|basketligan/i],
    ['hockey', 'Hockey', /\bnhl\b|hockey|\bshl\b|\bkhl\b|hockeyallsvenskan/i],
    ['tennis', 'Tennis', /tennis|tenis|\batp\b|\bwta\b|wimbledon|roland garros|us open|australian open|davis cup/i],
    ['fight', 'Kampsport', /\bufc\b|\bmma\b|boxing|boxeo|boxning|\bwwe\b|kickbox|fight night/i],
    ['nfl', 'Amerikansk fotboll', /\bnfl\b|super bowl|american football|f[uú]tbol americano/i],
    ['football', 'Fotboll', null],
    ['other', 'Övrig sport', null]
  ];

  var V = null, focused = false, barca = null, barcaAt = 0;

  function U() { return App.u; }
  function clean(t) { return String(t || '').replace(/^\s*(live|en vivo|en directo|directo|direkt)\s*[:\-–|]\s*|^\s*\((d|en vivo|directo|live)\)\s*/i, '').replace(/\s*\((en )?(vivo|directo|live)\)\s*/ig, ' ').replace(/\s+/g, ' ').trim(); }
  function nkey(t) { return clean(t).toLowerCase().replace(/[^a-z0-9]+/g, ''); }

  /** The sport channels: open groups (not hidden or locked) or channels named like sport, languages in Yuri's order. */
  function sportChannels() {
    var u = U(), out = [];
    u.shown().forEach(function (g) {
      if (Lock.locked(g)) return;
      var all = u.channelsOf(g), byGroup = SPORT.test(g.name);
      for (var i = 0; i < all.length; i++) if (byGroup || SPORT.test(all[i].name)) out.push({c: all[i], r: Lang.rank(g.name) * 10 + Lang.rank(all[i].name, all[i].epg)});
    });
    out.sort(function (a, b) { return a.r - b.r; });
    return out.slice(0, MAX).map(function (x) { return x.c; });
  }

  function loadBarca(done) {
    if (barca && Date.now() - barcaAt < 30 * 60000) { done(); return; }
    var x = new XMLHttpRequest();
    try { x.open('GET', BARCA_API, true); x.setRequestHeader('Accept', 'application/vnd.github.raw+json'); } catch (e) { done(); return; }
    x.timeout = 15000;
    x.onreadystatechange = function () {
      if (x.readyState !== 4) return;
      try { var d = JSON.parse(x.responseText); if (d && d.matches) { barca = d; barcaAt = Date.now(); } } catch (e) {}
      done();
    };
    x.send();
  }

  function build(main) {
    var u = U();
    main.className = 'sport';
    var fHost = u.el('div', 'col groups glass', main), eHost = u.el('div', 'col events glass', main);
    V = {zone: 'events', events: [], read: 0, chans: [], filter: 'all'};
    V.status = u.el('div', 'sstatus', fHost);
    V.filters = new u.List(u.el('div', 'flist', fHost), 76, function (f, r) { u.el('div', 'name', r, f[1]); if (f[3]) u.el('span', 'n', r, String(f[3])); });
    V.list = new u.List(eHost, 112, row);
    V.list.emptyText = 'Läser tablån för sportkanalerna…';
    V.filters.set([SPORTS[7].concat([null, 0])], 0);
    V.list.set([]);
    focus(focused);
    V.chans = sportChannels();
    var mine = V;
    loadBarca(function () { if (V === mine) collect(); });
    var left = V.chans.length;
    if (!left) { V.list.emptyText = 'Hittade inga sportkanaler i din lista.'; collect(); }
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

  function status() {
    if (!V) return;
    V.status.textContent = V.read < V.chans.length ? 'Läser tablån: ' + V.read + ' av ' + V.chans.length + ' sportkanaler' : V.chans.length + ' sportkanaler · ' + V.events.length + ' sändningar';
  }

  /** The matches and events of the guides read so far, Barça's first. */
  function collect() {
    if (!V) return;
    var u = U(), now = Date.now(), end = now + AHEAD, byKey = {}, list = [];
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
    // Barça's next match from barca.json (its channels are filled in the day before).
    var bm = barca && barca.matches && barca.matches[0];
    if (bm && bm.stop > now) {
      var found = null;
      for (var i = 0; i < list.length; i++) if (list[i].barca && Math.abs(list[i].start - bm.start) < 3 * 3600000) found = list[i];
      var chans = [];
      // Barça's channels even from hidden groups (hiding is for the lists, not for Barça); locked ones stay out.
      (bm.channels || []).forEach(function (n, j) {
        var c = u.find(n, (bm.channel_ids || [])[j]), g = c && u.groupById(c.cat);
        if (c && chans.indexOf(c) < 0 && !(g && Lock.locked(g))) chans.push(c);
      });
      if (found) { found.title = bm.title; found.desc = bm.competition || found.desc; chans.forEach(function (c) { if (found.channels.indexOf(c) < 0) found.channels.push(c); }); found.next = true; }
      else list.push({title: bm.title, desc: bm.competition || '', start: bm.start, stop: bm.stop, channels: chans, sport: 'football', barca: true, next: true, text: bm.title});
    }
    list.forEach(function (ev) {
      ev.channels.sort(function (a, b) { return Lang.rank(a.name, a.epg) - Lang.rank(b.name, b.epg); });
      ev.live = ev.start <= now && now < ev.stop;
      if (!ev.sport) ev.sport = sportOf(ev);
      ev.fav = '';
      for (var f = 0; f < FAVS.length; f++) if (FAVS[f][1].test(ev.title)) { ev.fav = FAVS[f][0]; break; }
    });
    // Favourites first, then what's on now, then by time.
    list.sort(function (a, b) { return (!!b.fav - !!a.fav) || (b.live - a.live) || (a.start - b.start); });
    V.all = list;
    // The groups: Fotboll always, the others when they have something.
    var n = {}, cats = [];
    list.forEach(function (e) { n[e.sport] = (n[e.sport] || 0) + 1; });
    SPORTS.forEach(function (sp) { if (sp[0] === 'football' || n[sp[0]]) cats.push([sp[0], sp[1], sp[2], n[sp[0]] || 0]); });
    cats.sort(function (a, b) { return (b[0] === 'football') - (a[0] === 'football'); });
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
    if (MATCH.test(ev.title) && /f[uú]tbol|football|fotboll|soccer|laliga|liga|premier|champions|calcio|bundesliga/i.test(names)) return 'football';
    return MATCH.test(ev.title) ? 'football' : 'other';
  }

  function show() {
    var f = (V.filters.current() || ['football'])[0], cur = V.list.current();
    V.events = (V.all || []).filter(function (e) { return e.sport === f; });
    var at = cur ? V.events.indexOf(cur) : 0;
    V.list.emptyText = V.read < V.chans.length ? 'Läser tablån för sportkanalerna…' : 'Inget i tablån de närmaste timmarna.';
    V.list.set(V.events, at < 0 ? 0 : at);
    status();
  }

  function row(ev, r) {
    var u = U(), now = Date.now();
    if (ev.barca) r.className += ' barca';
    else if (ev.fav) r.className += ' fav';
    var time = u.el('div', 'etime' + (ev.live ? ' live' : ''), r, ev.live ? 'NU' : u.hm(ev.start));
    if (!ev.live && new Date(ev.start).getDate() !== new Date().getDate()) time.textContent = (ev.start - now > 2 * 86400000 ? new Date(ev.start).toLocaleDateString('sv-SE', {weekday: 'short', day: 'numeric', month: 'short'}) + ' ' : 'imorgon ') + u.hm(ev.start);
    var t = u.el('div', 'text', r);
    u.el('div', 'name', t, (ev.fav ? '★  ' : '') + ev.title);
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
