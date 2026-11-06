/*
 * The Barça box, at the top right: FC Barcelona's coming matches and which of your IPTV channels show them, from
 * data/barca.json in the TV's GitHub repo (written every 3 hours by .github/workflows/barca.yml from your IPTV guide).
 * Hidden until that file has been made, and while turned off (Home Settings → Barça box). ES5 only.
 */
var BarcaBox = (function () {
  'use strict';
  // GitHub's API answers with the file as it is now; raw.githubusercontent.com can lag minutes behind (its cache).
  var API = 'https://api.github.com/repos/MrOrtiiz/my-tv/contents/data/barca.json?ref=main';
  var RAW = 'https://raw.githubusercontent.com/MrOrtiiz/my-tv/main/data/barca.json';
  var EVERY = 15 * 60000, SHOW = 3;

  // MARK: - Live: the score during a match, from ESPN's open scoreboard, every 30 seconds from a quarter before kick-off
  // until the result is final. A Barça goal sets off a celebration (festive.js goal).
  var SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/soccer/%s/scoreboard?dates=%d';
  var LEAGUES = ['esp.1', 'uefa.champions', 'esp.copa_del_rey', 'esp.super_cup', 'club.friendly'];
  var LIVE_EVERY = 30000, live = null, liveTimer = 0, liveFor = 0, lastBarca = -1, goalUntil = 0;

  function ymd(ms) { var d = new Date(ms); return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate(); }

  /** The match to follow now: from 15 minutes before kick-off to 3 hours after it. */
  function liveMatch() {
    var now = Date.now();
    for (var i = 0; data && data.matches && i < data.matches.length; i++) {
      var m = data.matches[i];
      if (now >= m.start - 15 * 60000 && now <= m.start + 3 * 3600000) return m;
    }
    return null;
  }

  /** Barça's game in a scoreboard's answer, as {state, clock, detail, home, away, goals}; or null. */
  function readGame(json) {
    var evs = (json && json.events) || [];
    for (var i = 0; i < evs.length; i++) {
      var c = (evs[i].competitions || [])[0], teams = (c && c.competitors) || [];
      var isBarca = false;
      for (var k = 0; k < teams.length; k++) if (/barcelona/i.test((teams[k].team || {}).displayName || '')) isBarca = true;
      if (!isBarca) continue;
      var st = evs[i].status || {}, type = st.type || {}, home = null, away = null;
      for (k = 0; k < teams.length; k++) {
        var t = {name: (teams[k].team || {}).shortDisplayName || (teams[k].team || {}).displayName || '', score: parseInt(teams[k].score, 10) || 0,
          id: (teams[k].team || {}).id, barca: /barcelona/i.test((teams[k].team || {}).displayName || '')};
        if (teams[k].homeAway === 'home') home = t; else away = t;
      }
      var goals = [], det = (c && c.details) || [];
      for (k = 0; k < det.length; k++) {
        var dd = det[k];
        if (!dd.scoringPlay) continue;
        var who = ((dd.athletesInvolved || [])[0] || {}).displayName || '';
        goals.push({min: (dd.clock || {}).displayValue || '', who: who, own: !!dd.ownGoal, pen: !!dd.penaltyKick,
          barca: home && away ? String((dd.team || {}).id) === String((home.barca ? home : away).id) : false});
      }
      return {state: type.state || '', clock: st.displayClock || '', detail: type.shortDetail || '', home: home, away: away, goals: goals};
    }
    return null;
  }

  function fetchLive(m, i) {
    var leagues = m.league ? [m.league].concat(LEAGUES) : LEAGUES;
    if (i >= leagues.length) return;
    var x = new XMLHttpRequest();
    x.open('GET', SCOREBOARD.replace('%s', leagues[i]).replace('%d', ymd(m.start)), true);
    x.timeout = 12000;
    x.onload = function () {
      var g = null;
      if (x.status === 200) { try { g = readGame(JSON.parse(x.responseText)); } catch (e) {} }
      if (!g) { fetchLive(m, i + 1); return; }
      m.league = leagues[i];
      var mine = g.home && g.away ? (g.home.barca ? g.home.score : g.away.score) : 0;
      // A goal for Barça (not on the first reading: then it's the score as it stands).
      if (lastBarca >= 0 && mine > lastBarca && g.state === 'in') {
        goalUntil = Date.now() + 25000;
        if (window.Festive && Festive.goal) Festive.goal();
      }
      lastBarca = mine;
      live = g; liveFor = m.start;
      render();
    };
    x.onerror = x.ontimeout = function () { fetchLive(m, i + 1); };
    x.send();
  }

  function pollLive() {
    clearTimeout(liveTimer);
    var m = liveMatch();
    if (!m || !on()) { if (live) { live = null; lastBarca = -1; render(); } liveTimer = setTimeout(pollLive, 60000); return; }
    if (liveFor !== m.start) { live = null; lastBarca = -1; }
    if (!(live && live.state === 'post')) fetchLive(m, 0);
    liveTimer = setTimeout(pollLive, live && live.state === 'post' ? 5 * 60000 : LIVE_EVERY);
  }
  var CREST = 'https://a.espncdn.com/i/teamlogos/soccer/500/83.png';
  var data = null, timer = 0;
  var DAYS = ['sön', 'mån', 'tis', 'ons', 'tor', 'fre', 'lör'];
  var MONTHS = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

  function on() { return typeof Prefs === 'undefined' || !Prefs.barca || Prefs.barca(); }

  function el(tag, cls, parent, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }

  function two(n) { return (n < 10 ? '0' : '') + n; }

  /** "I dag 21:00", "I morgon 18:45", "lör 7 nov 21:00". */
  function when(ms) {
    var d = new Date(ms), now = new Date();
    var day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    var diff = Math.round((day - today) / 86400000), time = two(d.getHours()) + ':' + two(d.getMinutes());
    if (diff === 0) return 'I dag ' + time;
    if (diff === 1) return 'I morgon ' + time;
    return DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + time;
  }

  // MARK: - Pages: away from match day the box turns, as iOS's widget stacks do, between the coming matches, LaLiga's
  // table with Barça's form, and the top scorers; a dot for each page at its foot.
  var PAGE_EVERY = 12000, page = 0, pageTimer = 0;
  var SHORT = {'Atlético Madrid': 'Atlético', 'Internazionale': 'Inter', 'Paris Saint-Germain': 'PSG', 'Bayern Munich': 'Bayern',
    'Borussia Dortmund': 'Dortmund', 'Manchester City': 'Man City', 'Manchester United': 'Man United', 'Athletic Club': 'Athletic',
    'Barcelona': 'Barça', 'FC Barcelona': 'Barça'};

  function pages() {
    if (live || matchToday() || !document.body || !/\bno-picks\b/.test(document.body.className)) return ['matches'];
    var list = ['matches'];
    if (data.table && data.table.rows && data.table.rows.length) list.push('table');
    if (data.scorers && data.scorers.length) list.push('scorers');
    return list;
  }

  function turn() {
    clearTimeout(pageTimer);
    pageTimer = setTimeout(function () { page++; render(); turn(); }, PAGE_EVERY);
  }

  function short(name) { return SHORT[name] || name; }

  /** LaLiga: Barça's place and points, its last five (V O F), and the table's top four with Barça. */
  function tablePage(box) {
    var rows = data.table.rows, us = null, i;
    for (i = 0; i < rows.length; i++) if (rows[i].barca) us = rows[i];
    var sum = el('div', 'standing', box);
    if (us) {
      el('span', 'place', sum, us.rank + ':a');
      el('span', 'pts', sum, us.points + ' p  ·  ' + us.played + ' matcher  ·  ' + (us.gd > 0 ? '+' : '') + us.gd);
    }
    el('span', 'league', sum, 'LaLiga');
    if (data.form && data.form.length) {
      var f = el('div', 'form', box);
      el('span', 'label', f, 'Form');
      for (i = 0; i < data.form.length; i++) {
        var r = data.form[i];
        el('span', 'chip chip-' + r.res, f, r.res);
      }
      var lastG = data.form[data.form.length - 1];
      el('div', 'lastgame', box, 'Senast: ' + lastG.score + (lastG.home ? ' hemma mot ' : ' borta mot ') + short(lastG.opp) + '  ·  ' + lastG.comp);
    }
    var tb = el('div', 'table', box), shown = [];
    for (i = 0; i < rows.length && i < 4; i++) shown.push(rows[i]);
    if (us && us.rank > 4) shown.push(null, us);
    for (i = 0; i < shown.length; i++) {
      var x = shown[i];
      if (!x) { el('div', 'gap', tb, '···'); continue; }
      var tr = el('div', 'tr' + (x.barca ? ' us' : ''), tb);
      el('span', 'rk', tr, String(x.rank));
      el('span', 'tm', tr, short(x.short || x.team));
      el('span', 'pl', tr, String(x.played));
      el('span', 'pt', tr, String(x.points));
    }
  }

  /** LaLiga's top scorers, Barça's in its colors. */
  function scorersPage(box) {
    el('div', 'standing', box).appendChild(document.createTextNode('Skytteligan  ·  LaLiga'));
    var tb = el('div', 'table scorers', box);
    for (var i = 0; i < data.scorers.length && i < 5; i++) {
      var s = data.scorers[i], tr = el('div', 'tr' + (s.barca ? ' us' : ''), tb);
      el('span', 'rk', tr, String(i + 1));
      el('span', 'tm', tr, s.name);
      el('span', 'pl', tr, short(s.team));
      el('span', 'pt', tr, String(s.goals));
    }
  }

  /** The pill under the box: "Atlético – Barça om 2 dagar", "… i morgon 21:00", "… i dag 21:00". */
  function pill(box) {
    var top = document.getElementById('top'), p = document.getElementById('barcapill'), now = Date.now(), next = null;
    for (var i = 0; data && data.matches && i < data.matches.length; i++) if (data.matches[i].start > now) { next = data.matches[i]; break; }
    if (!box || !next || live) { if (p) p.style.display = 'none'; return; }
    if (!p) { p = el('div', '', top); p.id = 'barcapill'; }
    var teams = String(next.title).split(/\s+[–-]\s+/), name = teams.length === 2 ? short(teams[0]) + ' – ' + short(teams[1]) : next.title;
    var d = new Date(next.start), t0 = new Date(), days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() -
      new Date(t0.getFullYear(), t0.getMonth(), t0.getDate()).getTime()) / 86400000), hm = two(d.getHours()) + ':' + two(d.getMinutes());
    p.textContent = name + (days <= 0 ? ' i dag ' + hm : days === 1 ? ' i morgon ' + hm : ' om ' + days + ' dagar');
    p.style.display = '';
    p.style.left = box.offsetLeft + 'px';
    p.style.top = (box.offsetTop + box.offsetHeight + 14) + 'px';
  }

  function render() {
    var top = document.getElementById('top'), box = document.getElementById('barca');
    if (!top) return;
    if (!on() || !data || !data.updated) { if (box) box.parentNode.removeChild(box); pill(null); return; }
    if (!box) { box = el('div', 'glass', top); box.id = 'barca'; }
    box.className = 'glass' + (/\bfocus\b/.test(box.className) ? ' focus' : '');
    box.innerHTML = '';
    var head = el('div', 'head', box);
    // The club's crest as ESPN links it (barca.json's crest, else ESPN's address for it); the blaugrana dot if it won't load.
    var crest = el('img', 'crest', head), dot = el('span', 'stripe', head);
    dot.style.display = 'none';
    crest.onerror = function () { crest.style.display = 'none'; dot.style.display = ''; };
    crest.src = data.crest || CREST;
    el('span', 'name', head, 'FC Barcelona');
    // When the match list was made: shows at once whether the TV has the newest one.
    var u = new Date(data.updated);
    el('span', 'stamp', head, 'uppdaterad ' + two(u.getHours()) + ':' + two(u.getMinutes()));
    el('div', 'playhint', box, 'OK spelar matchen i din IPTV');
    var pg = pages(), which = pg[page % pg.length];
    if (pg.length > 1) {
      var dots = el('div', 'dots', box);
      for (var q = 0; q < pg.length; q++) el('span', q === page % pg.length ? 'on' : '', dots);
      if (!pageTimer) turn();
    }
    var area = el('div', 'page page-' + which, box);
    if (which === 'table') { tablePage(area); pill(box); return; }
    if (which === 'scorers') { scorersPage(area); pill(box); return; }
    box = area;   // the matches page draws into its area
    var now = Date.now(), list = [], i;
    for (i = 0; data.matches && i < data.matches.length; i++) {
      var mm = data.matches[i];
      // A match stays while it's on, and with its result for 3 hours after kick-off.
      if (mm.stop > now || (live && liveFor === mm.start && now < mm.start + 3 * 3600000)) list.push(mm);
    }
    if (data.status === 'error') {
      el('div', 'none', box, 'Kunde inte läsa din tablå just nu.');
      pill(box.parentNode);
      return;
    }
    if (!list.length) {
      el('div', 'none', box, 'Inga matcher i din tablå de närmaste två veckorna.');
      pill(box.parentNode);
      return;
    }
    var most = pg.length > 1 ? 2 : SHOW;   // with pages, room for two
    for (i = 0; i < list.length && i < most; i++) {
      var m = list[i], row = el('div', 'match', box), playing = m.start <= now && now < m.stop;
      var g = live && liveFor === m.start ? live : null;
      if (g && g.home && g.away && g.state !== 'pre') { liveRow(box, row, m, g); continue; }
      var t = el('div', 'when' + (playing ? ' now' : ''), row, playing ? 'Pågår nu' : when(m.start));
      if (m.competition) t.appendChild(document.createTextNode('  ·  ' + m.competition));
      if (m.live && !playing) el('span', 'live', t, 'Direkt');
      var title = el('div', 'title', row);
      if (m.rival_logo) {
        var rl = el('img', 'rival', title);
        rl.onerror = function () { this.style.display = 'none'; };
        rl.src = m.rival_logo;
      }
      title.appendChild(document.createTextNode(m.title));
      var ch = m.channels || [];
      if (ch.length) channelLine(row, m);
      else el('div', 'channels soon', row, 'Kanalerna visas när matchen kommer in i din tablå');
    }
    pill(box.parentNode);
  }

  /** A match being played, or just played: the clock, the score in large, the goals. */
  function liveRow(box, row, m, g) {
    row.className = 'match live-row' + (g.state === 'in' ? ' on' : '');
    if (Date.now() < goalUntil) { document.getElementById('barca').className += ' goal'; el('div', 'goalflash', row, 'MÅÅÅL!'); }
    var t = el('div', 'when now', row);
    if (g.state === 'in') {
      el('span', 'pulse', t);
      t.appendChild(document.createTextNode(/half|HT/i.test(g.detail) ? 'Halvtid' : 'Live  ' + g.clock));
    } else {
      t.appendChild(document.createTextNode(/pen|aet|ET/i.test(g.detail) ? 'Slut  ·  ' + g.detail : 'Slut'));
    }
    if (m.competition) t.appendChild(document.createTextNode('  ·  ' + m.competition));
    var sc = el('div', 'score', row);
    el('span', 'team' + (g.home.barca ? ' us' : ''), sc, g.home.name);
    el('span', 'nums', sc, g.home.score + ' – ' + g.away.score);
    el('span', 'team' + (g.away.barca ? ' us' : ''), sc, g.away.name);
    if (g.goals.length) {
      var lines = [];
      for (var k = 0; k < g.goals.length; k++) {
        var gg = g.goals[k];
        lines.push(gg.min + ' ' + gg.who + (gg.pen ? ' (str)' : '') + (gg.own ? ' (självmål)' : ''));
      }
      el('div', 'goals', row, lines.join('  ·  '));
    }
    var ch = m.channels || [];
    if (ch.length && g.state === 'in') channelLine(row, m);
  }

  // MARK: - The channels: Spanish first, then English, Swedish and the rest (the order barca.py sorts them in), each
  // language with its tag. The names without what the box doesn't need: the country tags and HD/FHD.
  var LANG_TAG = {es: 'ES', en: 'EN', sv: 'SV', xx: 'ÖVR'};

  function shortName(name) {
    var n = String(name || '');
    n = n.replace(/^\s*(\|[A-Z]{2,5}\|\s*|\[[A-Z]{2,5}\]\s*|[A-Z]{2,5}\s*[:|]\s*)/, '');
    n = n.replace(/\s+(F?HD|UHD|4K|SD|HEVC)\b/gi, '').replace(/\s+\(?(?!TV\b|HD\b)[A-Z]{2,3}\)?\s*$/, '');
    return n.replace(/^\s+|\s+$/g, '') || String(name || '');
  }

  function channelLine(row, m) {
    var ch = m.channels || [], langs = m.channel_langs || [], line = el('div', 'channels langs', row), last = '';
    for (var i = 0; i < ch.length; i++) {
      var lang = langs[i] || '';
      if (lang && lang !== last) { el('span', 'lang lang-' + lang, line, LANG_TAG[lang] || lang.toUpperCase()); last = lang; }
      else if (i) line.appendChild(document.createTextNode('  ·  '));
      line.appendChild(document.createTextNode(langs.length ? shortName(ch[i]) : ch[i]));
    }
    if (m.more) line.appendChild(document.createTextNode('  ·  +' + m.more));
  }

  function load() {
    clearTimeout(timer);
    timer = setTimeout(load, EVERY);
    if (!on()) { render(); return; }
    get(API, {Accept: 'application/vnd.github.raw+json'}, function (ok) {
      if (!ok) get(RAW + '?t=' + Date.now(), {}, function () {});
    });
  }

  function get(url, headers, done) {
    var x = new XMLHttpRequest();
    x.open('GET', url, true);
    x.timeout = 15000;
    for (var h in headers) if (headers.hasOwnProperty(h)) x.setRequestHeader(h, headers[h]);
    x.onload = function () {
      var d = null;
      if (x.status === 200) { try { d = JSON.parse(x.responseText); } catch (e) {} }
      if (!d || d.matches === undefined) { done(false); return; }
      data = d;
      render();
      pollLive();
      if (window.Festive) Festive.update();   // a match day takes over the screen's theme
      done(true);
    };
    x.onerror = x.ontimeout = function () { done(false); };
    x.send();
  }

  document.addEventListener('visibilitychange', function () { if (!document.hidden) load(); });
  setTimeout(load, 500);
  setTimeout(pollLive, 3000);
  // The time of each match ("I dag", "Pågår nu") moves on by itself.
  setInterval(render, 60000);

  /** Today's match: one that kicks off today, or is being played now; else null. */
  function matchToday() {
    if (!on() || !data || !data.matches) return null;
    var now = new Date(), y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
    for (var i = 0; i < data.matches.length; i++) {
      var x = data.matches[i], k = new Date(x.start);
      if ((x.start <= now.getTime() && now.getTime() < x.stop) || (k.getFullYear() === y && k.getMonth() === m && k.getDate() === d && x.stop > now.getTime())) return x;
    }
    return null;
  }

  /** OK on the box: the match on your IPTV (iptv.js). */
  function play(say) { if (window.IPTV) IPTV.barca(data, say); }

  return {refresh: load, matchToday: matchToday, live: pollLive, play: play};
})();
