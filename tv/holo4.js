/*
 * Kontrollrum v4 – holografiskt kontrollrum hemma (Inställningar → Hemskärm → Utseende; av som standard). v3 (holo.js)
 * finns kvar som eget val. Bara i layouten utan filmtips, annars som vanligt.
 *
 * Samma rutor, data och fjärrkontroll som annars; holo4.css klär om dem och flyttar dem till ett kontrollrum:
 *
 *   mitten    Kärnan: klockan i centrum, sekundringen, veckoringen, dygnsringen med dagsljuset, två mätare
 *             (utetemperaturen till höger, dagar till nästa match till vänster) och roterande ringar som dekor.
 *   vänster   Systemnoden (dag, året, dagsljus, sol, favoriter, upptid, version), tre cykelmätare (dygnet, veckan,
 *             året) och veckans tidslinje med matchen utmärkt.
 *   höger     Barça-noden (matcher, tabell, skytteliga) och atmosfären (vädret nu, timmarnas temperatur, fem dagar).
 *   nere      Nästa match och nedräkningen som datataggar vid kärnan, och apparna i en docka i en rad.
 *
 * Ledlinjer går från kärnan till varje nod. Bara riktiga värden: saknas något visas inget mätvärde för det. Dekor ritas
 * svagt; mätvärden ljust och med etikett. Kvalitet (Hemskärm → Grafik): Auto sänker bildfrekvensen om TV:n inte hinner
 * med. Allt stannar när appen inte syns eller en skärmsläckare visas. ES5.
 */
var Holo4 = (function () {
  'use strict';

  var W = 1920, H = 1080, CX = 960, CY = 468;
  var TEAL = '95, 230, 235', DIM = '38, 110, 120', ICE = '223, 251, 255', AMBER = '255, 196, 72';
  var DAYS = ['SÖN', 'MÅN', 'TIS', 'ONS', 'TOR', 'FRE', 'LÖR'];
  var LX = 64, LW = 430;                 // vänstra kolumnen
  var R = {sec: 176, week: 204, day: 246, gauge: 314, outer: 372};
  var GAUGE_Y = 548, GAUGE_R = 54, WEEK_Y = 742;
  var TEMP_LO = -20, TEMP_HI = 30;       // utemätarens skala, °C

  var root = null, stat = null, sctx = null, sys = null, bar = null, sysFps = null, wasOn = null;
  var running = false, paused = false, raf = 0, lastFrame = 0, bootAt = 0, startedAt = Date.now();
  var model = {}, modelKey = '', links = [], pulses = [], slots = [];
  var needle = {temp: null, match: null};
  var q = {fps: 30, orbits: -1, sweep: true, level: 'auto'}, slow = 0, fast = 0, scale = 1;

  // MARK: - Hjälp

  function el(tag, cls, parent, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  function two(n) { return (n < 10 ? '0' : '') + n; }
  function hm(ms) { var d = new Date(ms); return two(d.getHours()) + ':' + two(d.getMinutes()); }
  function rad(deg) { return (deg - 90) * Math.PI / 180; }   // 0° uppåt, medurs
  function rgba(c, a) { return 'rgba(' + c + ', ' + a + ')'; }
  function hasClass(e, c) { return e && (' ' + e.className + ' ').indexOf(' ' + c + ' ') >= 0; }
  function setClass(e, c, on) {
    if (!e) return;
    if (on && !hasClass(e, c)) e.className = (e.className + ' ' + c).replace(/^\s+/, '');
    else if (!on && hasClass(e, c)) e.className = (' ' + e.className + ' ').replace(' ' + c + ' ', ' ').replace(/^\s+|\s+$/g, '');
  }
  function enabled() { return typeof Prefs !== 'undefined' && Prefs.look && Prefs.look() === 'v4' && hasClass(document.body, 'no-picks'); }
  function deg(v) { return typeof Data !== 'undefined' && Data.degrees ? Data.degrees(v) : Math.round(v) + '°'; }
  function pct(f) { return (f * 100).toFixed(1).replace('.', ',') + ' %'; }

  /** ISO-veckonumret, som i svenska kalendrar. */
  function week(d) {
    var t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())), day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
  }

  function arcAt(g, x, y, r, from, to, width, color) {
    g.beginPath();
    g.arc(x, y, r, rad(from), rad(to));
    g.lineWidth = width;
    g.strokeStyle = color;
    g.stroke();
  }
  function arc(g, r, from, to, width, color) { arcAt(g, CX, CY, r, from, to, width, color); }
  function tickAt(g, x, y, r1, r2, d, width, color) {
    var a = rad(d);
    g.beginPath();
    g.moveTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1);
    g.lineTo(x + Math.cos(a) * r2, y + Math.sin(a) * r2);
    g.lineWidth = width;
    g.strokeStyle = color;
    g.stroke();
  }
  function tick(g, r1, r2, d, width, color) { tickAt(g, CX, CY, r1, r2, d, width, color); }
  function at(r, d) { var a = rad(d); return [CX + Math.cos(a) * r, CY + Math.sin(a) * r]; }
  function line(g, x1, y1, x2, y2, width, color) {
    g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.lineWidth = width; g.strokeStyle = color; g.stroke();
  }

  /** Text på canvas; spärrad tecken för tecken (äldre webbläsare har ingen letter-spacing i canvas). */
  function text(g, s, x, y, size, color, align, weight, spacing) {
    g.font = (weight || 500) + ' ' + size + 'px Inter, Helvetica Neue, Arial, sans-serif';
    g.fillStyle = color;
    g.textAlign = align || 'left';
    g.textBaseline = 'middle';
    if (!spacing) { g.fillText(s, x, y); return g.measureText(s).width; }
    var w = 0, i;
    for (i = 0; i < s.length; i++) w += g.measureText(s.charAt(i)).width + spacing;
    w -= spacing;
    var x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    g.textAlign = 'left';
    for (i = 0; i < s.length; i++) { g.fillText(s.charAt(i), x0, y); x0 += g.measureText(s.charAt(i)).width + spacing; }
    return w;
  }

  /** En nodtagg som rutornas rubriker (holo4.css): fyllt band med etiketten, en tunn linje vidare. */
  function tag(g, label, x, y, w) {
    g.font = '600 14px Inter, Helvetica Neue, Arial, sans-serif';
    var tw = 0;
    for (var i = 0; i < label.length; i++) tw += g.measureText(label.charAt(i)).width + 2.5;
    tw += 24;
    g.fillStyle = rgba(TEAL, 0.92);
    g.fillRect(x, y, tw, 26);
    text(g, label, x + 12, y + 13.5, 14, 'rgb(3, 16, 18)', 'left', 600, 2.5);
    if (w <= tw) return;
    line(g, x + tw, y + 25.5, x + w, y + 25.5, 1, rgba(TEAL, 0.35));
    g.fillStyle = rgba(TEAL, 0.8);
    g.fillRect(x + w - 6, y + 22, 6, 4);
  }

  // MARK: - Data (bara det som redan finns)

  function readModel() {
    var d = new Date(), m = {};
    m.day = d.getDay();
    m.dayFrac = (d.getHours() * 60 + d.getMinutes()) / 1440;
    var wday = (d.getDay() + 6) % 7;
    m.wday = wday;
    m.hourOfWeek = wday * 24 + d.getHours();
    m.weekFrac = (m.hourOfWeek + d.getMinutes() / 60) / 168;
    var start = new Date(d.getFullYear(), 0, 1), leap = new Date(d.getFullYear(), 1, 29).getMonth() === 1;
    m.doy = Math.floor((d - start) / 86400000) + 1;
    m.yearLen = leap ? 366 : 365;
    m.yearFrac = (m.doy - 1 + m.dayFrac) / m.yearLen;
    // Vädret läses också med Atmosfär-noden av: utemätaren och statusraden hör till kärnan.
    var w = typeof Data !== 'undefined' ? Data.weather : null;
    if (w && !isNaN(w.temp)) {
      m.temp = w.temp;
      if (!isNaN(w.max) && !isNaN(w.min)) { m.max = w.max; m.min = w.min; }
      if (w.sunrise && w.sunset) {
        var s0 = new Date(w.sunrise), s1 = new Date(w.sunset);
        m.rise = (s0.getHours() * 60 + s0.getMinutes()) / 1440;
        m.set = (s1.getHours() * 60 + s1.getMinutes()) / 1440;
        m.riseAt = w.sunrise; m.setAt = w.sunset;
      }
      m.hours = [];
      for (var i = 0; w.hours && i < w.hours.length; i++) m.hours.push({at: w.hours[i].at, temp: w.hours[i].temp});
    }
    var match = window.BarcaBox && BarcaBox.next ? BarcaBox.next() : null;
    if (match) m.match = {start: match.start, title: match.title};
    // Nedräkningen (festive.js): "Avengers: Doomsday om 19 dagar", "… i morgon".
    var soon = window.Festive && Festive.countdown ? Festive.countdown() : '';
    var n = /om (\d+) dagar/.exec(soon) || (/i morgon/.test(soon) ? [0, '1'] : null);
    if (soon && n) m.countdown = {days: +n[1], text: soon};
    var apps = document.querySelectorAll('#tiles .tile');
    m.apps = apps ? apps.length : 0;
    return m;
  }

  /** Läser datan och lägena; ritar om det statiska lagret när något har ändrats (eller noderna har flyttat). */
  function refresh() {
    if (!root) return;
    var m = readModel();
    var modeKey = modes();
    layoutNodes();
    var lay = layoutKey();
    var key = JSON.stringify([m.temp, m.max, m.min, m.rise, m.set, m.match && m.match.start, m.countdown && m.countdown.days,
      m.day, Math.floor(m.dayFrac * 288), m.apps, m.hours && m.hours.length && m.hours[0].at, lay, modeKey, nodes.sys, nodes.cycles, nodes.week]);
    var old = model;
    model = m;
    if (key === modelKey) return;
    modelKey = key;
    if (old.temp !== undefined && m.temp !== old.temp) ping('wxtop');
    renderSys();
    layoutNodes();
    findLinks();
    findSlots();
    drawStatic();
    lastSec = -1;   // kärnans canvas i lägets färger
  }

  // MARK: - Noderna av och på (Hemskärm: System, Cykler, Vecka, Atmosfär): de som syns flyttar upp

  var nodes = {sys: true, cycles: true, week: true}, spinEls = [];

  function layoutNodes() {
    var pr = typeof Prefs !== 'undefined' && Prefs.h4node;
    nodes.sys = pr ? Prefs.h4node('sys') : true;
    nodes.cycles = pr ? Prefs.h4node('cycles') : true;
    nodes.week = pr ? Prefs.h4node('week') : true;
    var y = 112, i;
    if (sys) {
      sys.style.display = nodes.sys ? '' : 'none';
      if (nodes.sys) { sys.style.top = y + 'px'; y += (sys.offsetHeight || 300) + 44; }
    }
    if (nodes.cycles) { GAUGE_Y = y + 96; y = GAUGE_Y + GAUGE_R + 50 + 44; }
    if (nodes.week) WEEK_Y = y + 70;
    for (i = 0; i < spinEls.length; i++) {
      spinEls[i].style.top = (GAUGE_Y - 70) + 'px';
      spinEls[i].style.display = nodes.cycles ? '' : 'none';
    }
    var bx = document.getElementById('barca');
    setClass(document.body, 'h4-nobarca', !bx || bx.style.display === 'none' || !bx.offsetWidth);
  }

  // MARK: - Automatiska lägen: matchdag, match pågår (och mål), natt

  var mode = {match: false, live: false, post: false, goal: false, night: false}, matchEl = null, goalEl = null, nightEl = null;

  /** Läser lägena ur det som redan finns (Barças matcher och ställning, klockan) och sätter dem på sidan. */
  function modes() {
    var today = window.BarcaBox && BarcaBox.matchToday ? BarcaBox.matchToday() : null;
    var ls = today && BarcaBox.liveState ? BarcaBox.liveState() : null;
    if (ls && ls.start !== today.start) ls = null;
    var now = Date.now(), h = new Date(now).getHours();
    mode.today = today; mode.ls = ls;
    mode.match = !!today;
    mode.live = !!(ls && ls.state === 'in');
    mode.post = !!(ls && ls.state === 'post');
    mode.goal = !!(ls && now < ls.goalUntil);
    // Natt 22–07, men inte medan en match pågår eller strax före avspark: matchen går före.
    var soon = today && today.start - now < 2 * 3600000 && now < today.stop;
    mode.night = typeof Prefs !== 'undefined' && Prefs.h4night && Prefs.h4night() === 'auto' && (h >= 22 || h < 7) && !mode.live && !soon;
    var b = document.body;
    setClass(b, 'h4-match', mode.match);
    setClass(b, 'h4-live', mode.live);
    setClass(b, 'h4-goal', mode.goal);
    setClass(b, 'h4-night', mode.night);
    renderMatch(now);
    return [mode.match, mode.live, mode.post, mode.night].join();
  }

  function short(t) { return String(t || '').replace(/^FC /, ''); }

  /** Matchdagen i kärnan, under klockan: avsparken och tiden kvar, eller ställningen medan matchen pågår. */
  function renderMatch(now) {
    if (!matchEl) return;
    var m = mode.today, ls = mode.ls;
    if (!m) { matchEl.style.display = 'none'; goalEl.style.display = 'none'; return; }
    matchEl.style.display = 'block';
    var tagText, main, sub = '';
    if (ls && (mode.live || mode.post)) {
      tagText = mode.live ? (/half|HT/i.test(ls.detail) ? 'HALVTID' : 'LIVE  ' + (ls.clock || '')) : 'SLUT';
      main = short(ls.home.name) + '  ' + ls.home.score + ' – ' + ls.away.score + '  ' + short(ls.away.name);
      if (ls.goals.length) { var g = ls.goals[ls.goals.length - 1]; sub = 'SENASTE MÅL  ' + g.min + '  ' + g.who; }
    } else {
      tagText = 'MATCHDAG';
      main = m.title;
      var left = Math.max(0, m.start - now), hh = Math.floor(left / 3600000), mm = Math.floor(left / 60000) % 60;
      sub = 'AVSPARK ' + hm(m.start) + (left > 0 ? '  ·  OM ' + (hh ? hh + ' H ' : '') + two(mm) + ' MIN' : '');
    }
    matchEl.firstChild.textContent = tagText;
    matchEl.childNodes[1].textContent = main;
    matchEl.childNodes[2].textContent = sub;
    setClass(matchEl, 'score', !!(ls && (mode.live || mode.post)));
    goalEl.style.display = mode.goal ? 'block' : 'none';
  }

  /** Rutornas lägen och storlekar: ändras de (Barça byter sida) ritas ledlinjerna om. */
  function layoutKey() {
    var ids = ['barca', 'wxtop', 'barcapill', 'countdown', 'h4sys'], s = '';
    for (var i = 0; i < ids.length; i++) { var b = box(ids[i]); s += b ? b.x + ',' + b.y + ',' + b.w + ',' + b.h + ';' : '-;'; }
    return s;
  }

  function ping(id) {
    var e = document.getElementById(id);
    if (!e) return;
    setClass(e, 'h4-ping', true);
    setTimeout(function () { setClass(e, 'h4-ping', false); }, 1200);
    for (var i = 0; i < links.length; i++) if (links[i].id === id) pulses.push({link: i, t: 0, back: true, strong: true});
  }

  // MARK: - Ledlinjer: från kärnan ut till noderna, raka med en vinkel, som på en ritning

  function box(id) {
    var e = document.getElementById(id);
    if (!e || !e.offsetWidth || e.style.display === 'none') return null;
    var x = 0, y = 0, n = e;
    while (n && n.id !== 'stage') { x += n.offsetLeft || 0; y += n.offsetTop || 0; n = n.offsetParent; }
    return {x: x, y: y, w: e.offsetWidth, h: e.offsetHeight};
  }

  function addLink(id, from, pts) {
    var len = 0;
    for (var k = 1; k < pts.length; k++) len += Math.abs(pts[k][0] - pts[k - 1][0]) + Math.abs(pts[k][1] - pts[k - 1][1]);
    links.push({id: id, pts: pts, len: len});
  }

  function findLinks() {
    links = [];
    var b, s;
    // Höger: Barça och atmosfären, till rubrikbandets nedre kant.
    if ((b = box('barca'))) { s = at(R.outer, 58); addLink('barca', 58, [s, [s[0] + 60, b.y + 26], [b.x - 8, b.y + 26]]); }
    if ((b = box('wxtop'))) { s = at(R.outer, 96); addLink('wxtop', 96, [s, [b.x - 70, s[1]], [b.x - 70, b.y + 26], [b.x - 8, b.y + 26]]); }
    // Vänster: systemnoden och cykelmätarna.
    if ((b = box('h4sys'))) { s = at(R.outer, 302); addLink('h4sys', 302, [s, [s[0] - 60, b.y + 26], [b.x + b.w + 8, b.y + 26]]); }
    if (nodes.cycles) { s = at(R.outer, 264); addLink('cycles', 264, [s, [LX + LW + 70, s[1]], [LX + LW + 70, GAUGE_Y - 82], [LX + LW + 8, GAUGE_Y - 82]]); }
    // Nere: datataggarna för nästa match och nedräkningen.
    if ((b = box('barcapill'))) { s = at(R.gauge, 214); addLink('barcapill', 214, [s, [s[0], b.y + b.h / 2], [b.x + b.w + 8, b.y + b.h / 2]]); }
    if ((b = box('countdown'))) { s = at(R.gauge, 146); addLink('countdown', 146, [s, [s[0], b.y + b.h / 2], [b.x - 8, b.y + b.h / 2]]); }
  }

  function pointOn(link, f) {
    var want = f * link.len, p = link.pts;
    for (var k = 1; k < p.length; k++) {
      var seg = Math.abs(p[k][0] - p[k - 1][0]) + Math.abs(p[k][1] - p[k - 1][1]);
      if (want <= seg || k === p.length - 1) {
        var u = seg ? Math.min(1, want / seg) : 0;
        return [p[k - 1][0] + (p[k][0] - p[k - 1][0]) * u, p[k - 1][1] + (p[k][1] - p[k - 1][1]) * u];
      }
      want -= seg;
    }
    return p[p.length - 1];
  }

  function drawLink(g, link, upto, alpha) {
    g.beginPath();
    var want = upto * link.len, p = link.pts;
    g.moveTo(p[0][0], p[0][1]);
    for (var k = 1; k < p.length && want > 0; k++) {
      var seg = Math.abs(p[k][0] - p[k - 1][0]) + Math.abs(p[k][1] - p[k - 1][1]), u = seg ? Math.min(1, want / seg) : 1;
      g.lineTo(p[k - 1][0] + (p[k][0] - p[k - 1][0]) * u, p[k - 1][1] + (p[k][1] - p[k - 1][1]) * u);
      want -= seg;
    }
    g.lineWidth = 1;
    g.strokeStyle = rgba(TEAL, alpha);
    g.stroke();
  }

  // MARK: - Dockan: en plats per app, läst ur favoriternas lägen (home.js lägger dem i en rad i v4)

  function findSlots() {
    slots = [];
    var tiles = document.querySelectorAll('#tiles .tile');
    for (var i = 0; i < tiles.length; i++) {
      var t = tiles[i];
      if (t.style.display === 'none') continue;
      slots.push({x: parseFloat(t.style.left) || 0, y: parseFloat(t.style.top) || 0, w: t.offsetWidth || parseFloat(t.style.width) || 0});
    }
  }

  // MARK: - Statiska lagret (ritas om när datan ändras)

  function drawStatic() {
    var g = sctx;
    g.clearRect(0, 0, W, H);
    drawBackDecor(g);
    drawFrame(g);
    drawCore(g);
    for (var i = 0; i < links.length; i++) {
      drawLink(g, links[i], 1, 0.32);
      var e = links[i].pts[links[i].pts.length - 1], s = links[i].pts[0];
      g.fillStyle = rgba(TEAL, 0.9);
      g.fillRect(e[0] - 3, e[1] - 3, 6, 6);
      g.beginPath(); g.arc(s[0], s[1], 3.5, 0, Math.PI * 2); g.fill();
    }
    if (nodes.cycles) drawCycles(g);
    if (nodes.week) drawWeek(g);
    if (mode.match) {   // matchdag: en bärnstensring runt kärnan och en etikett överst
      arc(g, R.outer + 22, 0, 360, 1.5, rgba(AMBER, 0.45));
      for (var mi = 0; mi < 72; mi++) tick(g, R.outer + 22, R.outer + (mi % 6 === 0 ? 34 : 28), mi * 5, 1, rgba(AMBER, mi % 6 === 0 ? 0.7 : 0.35));
    }
    drawWeatherBars(g);
    drawTags(g);
    drawDock(g);
  }

  /** Skärmens ram: tunna linjer längs kanterna, hörnmarkeringar, skalstreck (dekor). */
  function drawFrame(g) {
    var c = rgba(TEAL, 0.28), x0 = 36, x1 = W - 36, y0 = 78, y1 = H - 20, k;
    line(g, x0, y0, x1, y0, 1, c);
    // Hörn: korta, tjockare vinklar.
    g.strokeStyle = rgba(TEAL, 0.7); g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x0, y0 + 40); g.lineTo(x0, y0); g.lineTo(x0 + 40, y0);
    g.moveTo(x1 - 40, y0); g.lineTo(x1, y0); g.lineTo(x1, y0 + 40);
    g.moveTo(x0, y1 - 40); g.lineTo(x0, y1); g.lineTo(x0 + 40, y1);
    g.moveTo(x1 - 40, y1); g.lineTo(x1, y1); g.lineTo(x1, y1 - 40);
    g.stroke();
    // Kantlinjer med skalstreck.
    line(g, x0, y0 + 60, x0, y1 - 60, 1, rgba(TEAL, 0.14));
    line(g, x1, y0 + 60, x1, y1 - 60, 1, rgba(TEAL, 0.14));
    for (k = y0 + 80; k < y1 - 60; k += 24) {
      line(g, x0, k, x0 + (k % 120 === 0 ? 10 : 5), k, 1, rgba(TEAL, 0.35));
      line(g, x1, k, x1 - (k % 120 === 0 ? 10 : 5), k, 1, rgba(TEAL, 0.35));
    }
    // Mitten av överkanten: en skala med en nedsänkt del, som en ritnings rubrikfält.
    g.strokeStyle = rgba(TEAL, 0.45); g.lineWidth = 1;
    g.beginPath(); g.moveTo(CX - 300, y0); g.lineTo(CX - 280, y0 + 10); g.lineTo(CX + 280, y0 + 10); g.lineTo(CX + 300, y0); g.stroke();
    for (k = -26; k <= 26; k++) line(g, CX + k * 10, y0 + 10, CX + k * 10, y0 + (k % 5 === 0 ? 18 : 14), 1, rgba(TEAL, k % 5 === 0 ? 0.55 : 0.3));
    // Svagt koordinatnät bakom allt.
    g.fillStyle = rgba(DIM, 0.3);
    for (var x = 96; x < W - 60; x += 64) for (var y = 98; y < H - 40; y += 64) g.fillRect(x, y, 1.5, 1.5);
  }

  /** Kärnans data: veckoringen, dygnsringen med dagsljuset, mätarnas skalor och etiketter. */
  function drawCore(g) {
    var i, p;

    // Veckoringen: sju fält, i dag ljust, dagarnas namn utanför.
    for (i = 0; i < 7; i++) {
      var wd = (i + 1) % 7, from = i * (360 / 7) + 1.6, to = (i + 1) * (360 / 7) - 1.6, now = wd === model.day;
      arc(g, R.week, from, to, now ? 7 : 3, rgba(now ? TEAL : DIM, now ? 0.95 : 0.7));
      p = at(R.week + 17, (from + to) / 2);
      text(g, DAYS[wd], p[0], p[1], 12, rgba(TEAL, now ? 1 : 0.5), 'center', 600, 1.5);
    }

    // Dygnsringen: 24 timmar, dagsljuset i bärnsten, det som gått av dygnet, nu-punkten.
    arc(g, R.day, 0, 360, 1, rgba(DIM, 0.8));
    for (i = 0; i < 96; i++) tick(g, R.day - (i % 24 === 0 ? 12 : i % 4 === 0 ? 7 : 3), R.day, i * 3.75, i % 4 === 0 ? 1.5 : 1, rgba(TEAL, i % 24 === 0 ? 0.8 : i % 4 === 0 ? 0.45 : 0.2));
    for (i = 0; i < 4; i++) { p = at(R.day + 16, i * 90); text(g, two(i * 6), p[0], p[1], 12, rgba(TEAL, 0.75), 'center', 600, 1); }
    if (model.rise !== undefined) arc(g, R.day + 4, model.rise * 360, model.set * 360, 4, rgba(AMBER, 0.6));
    arc(g, R.day - 4, 0, model.dayFrac * 360, 2, rgba(TEAL, 0.8));
    p = at(R.day, model.dayFrac * 360);
    g.fillStyle = rgba(ICE, 1);
    g.beginPath(); g.arc(p[0], p[1], 4.5, 0, Math.PI * 2); g.fill();

    // Utemätaren (höger, 50°–130°): skala −20…+30 °C, dagens min–max som ett band. Visaren ritas per bildruta.
    arc(g, R.gauge, 50, 130, 1.5, rgba(DIM, 0.9));
    for (i = TEMP_LO; i <= TEMP_HI; i += 5) {
      var dg = tempDeg(i);
      tick(g, R.gauge, R.gauge + (i % 10 === 0 ? 14 : 8), dg, i === 0 ? 2 : 1, rgba(TEAL, i === 0 ? 0.9 : 0.5));
    }
    p = at(R.gauge + 28, tempDeg(TEMP_HI)); text(g, deg(TEMP_HI), p[0], p[1], 12, rgba(TEAL, 0.6), 'center', 600);
    p = at(R.gauge + 28, tempDeg(TEMP_LO)); text(g, deg(TEMP_LO), p[0], p[1], 12, rgba(TEAL, 0.6), 'center', 600);
    p = at(R.gauge + 22, tempDeg(0)); text(g, '0', p[0] + 6, p[1], 12, rgba(TEAL, 0.8), 'left', 600);
    if (model.max !== undefined) arc(g, R.gauge - 7, tempDeg(clampT(model.max)), tempDeg(clampT(model.min)), 4, rgba(TEAL, 0.35));
    p = at(R.gauge + 28, 50); text(g, 'UTE', p[0], p[1] - 22, 13, rgba(TEAL, 0.85), 'center', 600, 3);

    // Matchmätaren (vänster, 230°–310°): dagar kvar till nästa match, 14 dagar längst ner, avspark högst upp.
    arc(g, R.gauge, 230, 310, 1.5, rgba(DIM, 0.9));
    for (i = 0; i <= 14; i++) tick(g, R.gauge, R.gauge + (i % 7 === 0 ? 14 : 8), matchDeg(i), 1, rgba(TEAL, 0.5));
    p = at(R.gauge + 28, matchDeg(14)); text(g, '14 D', p[0], p[1], 12, rgba(TEAL, 0.6), 'center', 600);
    p = at(R.gauge + 28, matchDeg(0)); text(g, '0 D', p[0], p[1], 12, rgba(TEAL, 0.6), 'center', 600);
    p = at(R.gauge + 28, 310); text(g, 'MATCH', p[0], p[1] - 22, 13, rgba(AMBER, model.match ? 0.85 : 0.4), 'center', 600, 3);
  }

  /** Värdet vid visarens spets, utanför skalan. */
  function needleLabel(g, d, s, color, dir) {
    var p = at(R.gauge + 30, d);
    text(g, s, p[0] + dir * 6, p[1], 16, rgba(color, 1), dir > 0 ? 'left' : 'right', 500, 1);
  }

  function clampT(t) { return Math.max(TEMP_LO, Math.min(TEMP_HI, t)); }
  function tempDeg(t) { return 130 - (t - TEMP_LO) / (TEMP_HI - TEMP_LO) * 80; }
  function matchDeg(days) { return 230 + (14 - days) / 14 * 80; }

  /** Tre cykelmätare: dygnet, veckan och året, hur långt de har gått. */
  function drawCycles(g) {
    tag(g, 'CYKLER  ::  TID', LX, GAUGE_Y - 96, LW);
    var list = [['DYGNET', model.dayFrac], ['VECKAN', model.weekFrac], ['ÅRET', model.yearFrac]];
    for (var i = 0; i < list.length; i++) {
      var x = LX + 72 + i * 143, y = GAUGE_Y, f = list[i][1];
      arcAt(g, x, y, GAUGE_R, 0, 360, 1, rgba(DIM, 0.9));
      for (var k = 0; k < 40; k++) tickAt(g, x, y, GAUGE_R + 5, GAUGE_R + (k % 10 === 0 ? 11 : 8), k * 9, 1, rgba(TEAL, k % 10 === 0 ? 0.6 : 0.25));
      arcAt(g, x, y, GAUGE_R - 6, 0, f * 360, 6, rgba(TEAL, 0.85));
      arcAt(g, x, y, GAUGE_R - 16, 0, 360, 1, rgba(DIM, 0.6));
      text(g, Math.round(f * 100) + '', x, y - 2, 26, rgba(ICE, 0.95), 'center', 300);
      text(g, '%', x, y + 20, 11, rgba(TEAL, 0.7), 'center', 600, 1);
      text(g, list[i][0], x, y + GAUGE_R + 26, 13, rgba(TEAL, 0.8), 'center', 600, 2.5);
    }
  }

  /** Veckans tidslinje: 7 dagar × 24 timmar, timmarna som gått lysande, nästa match markerad. */
  function drawWeek(g) {
    var now = new Date(), how = model.hourOfWeek, step = LW / 168, y = WEEK_Y;
    tag(g, 'VECKA ' + week(now) + '  ::  ' + Math.round(model.weekFrac * 100) + ' %', LX, y - 70, LW);
    for (var h = 0; h < 168; h++) {
      var dayStart = h % 24 === 0;
      g.fillStyle = h < how ? rgba(TEAL, 0.6) : h === how ? rgba(ICE, 1) : rgba(DIM, 0.45);
      g.fillRect(LX + h * step, y - (dayStart ? 8 : 0), 1.6, dayStart ? 30 : (h % 6 === 0 ? 22 : 16));
    }
    for (var d = 0; d < 7; d++) text(g, DAYS[(d + 1) % 7], LX + d * 24 * step + 3, y + 38, 12, rgba(TEAL, d === model.wday ? 1 : 0.45), 'left', 600, 1.5);
    if (model.match) {
      var monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - model.wday).getTime(), mh = Math.floor((model.match.start - monday) / 3600000);
      if (mh >= 0 && mh < 168) {
        g.fillStyle = rgba(AMBER, 1);
        g.fillRect(LX + mh * step - 2, y - 16, 5, 40);
        text(g, 'MATCH', LX + mh * step + 8, y - 12, 11, rgba(AMBER, 1), 'left', 600, 1.5);
      }
    }
  }

  /** Temperaturen de närmaste timmarna, i atmosfärnoden (holo4.css lämnar plats mellan nuläget och dagarna). */
  function drawWeatherBars(g) {
    var b = box('wxtop'), hours = document.querySelector('#wxtop .hours');
    if (!b || !model.hours || !model.hours.length) return;
    var top = b.y + (hours ? hours.offsetTop : 200) - 112, x0 = b.x + 18, w = b.w - 36, n = model.hours.length, i;
    var maxT = -99, minT = 99;
    for (i = 0; i < n; i++) { maxT = Math.max(maxT, model.hours[i].temp); minT = Math.min(minT, model.hours[i].temp); }
    var span = Math.max(4, maxT - minT), cw = w / n;
    text(g, 'TIMMAR  ::  ' + n + ' H', x0, top + 4, 12, rgba(TEAL, 0.7), 'left', 600, 2.5);
    line(g, x0, top + 82, x0 + w, top + 82, 1, rgba(TEAL, 0.3));
    for (i = 0; i < n; i++) {
      var hv = model.hours[i], bh = 8 + (hv.temp - minT) / span * 36, xx = x0 + i * cw + cw * 0.28, bw = cw * 0.44;
      g.fillStyle = rgba(TEAL, 0.12);
      g.fillRect(xx, top + 82 - 44, bw, 44);
      g.fillStyle = rgba(TEAL, 0.7);
      g.fillRect(xx, top + 82 - bh, bw, bh);
      text(g, deg(hv.temp), xx + bw / 2, top + 82 - bh - 11, 13, rgba(ICE, 0.9), 'center', 500);
      text(g, two(new Date(hv.at).getHours()), xx + bw / 2, top + 95, 12, rgba(TEAL, 0.6), 'center', 600, 1);
    }
  }

  /** Taggarnas tidslinjer: dagar kvar till matchen (14) och till nedräkningen (30). */
  function drawTags(g) {
    var b = box('barcapill'), c, cells, cw = 7, gap = 4, i, x0, lit;
    if (b && model.match) {
      cells = 14;
      var days = Math.max(0, Math.ceil((model.match.start - Date.now()) / 86400000));
      x0 = b.x + b.w - cells * (cw + gap) + gap;
      for (c = 0; c < cells; c++) {
        lit = cells - 1 - c < days;
        g.fillStyle = lit ? rgba(AMBER, 0.65) : rgba(DIM, 0.45);
        g.fillRect(x0 + c * (cw + gap), b.y + b.h + 12, cw, 7);
      }
      text(g, days + ' D', x0 - 10, b.y + b.h + 16, 12, rgba(AMBER, 0.9), 'right', 600, 1.5);
    }
    b = box('countdown');
    if (b && model.countdown) {
      cells = 30; cw = 4; gap = 3;
      x0 = b.x;
      for (c = 0; c < cells; c++) {
        lit = c < Math.min(cells, model.countdown.days);
        g.fillStyle = lit ? rgba(AMBER, c === 0 ? 0.95 : 0.6) : rgba(DIM, 0.45);
        g.fillRect(x0 + c * (cw + gap), b.y + b.h + 12, cw, 7);
      }
      text(g, 'T−' + model.countdown.days + ' D', x0 + cells * (cw + gap) + 8, b.y + b.h + 16, 12, rgba(AMBER, 0.9), 'left', 600, 1.5);
    }
  }

  /** Dockan: en tunn bas med en skåra i mitten, en etikett, en plattform under varje app. */
  function drawDock(g) {
    if (!slots.length) return;
    var x0 = slots[0].x - 40, x1 = slots[slots.length - 1].x + slots[slots.length - 1].w + 40, y = 1050, top = slots[0].y - 20;
    tag(g, 'FAVORITER  ::  ' + slots.length, x0, top - 34, Math.min(360, x1 - x0));
    g.strokeStyle = rgba(TEAL, 0.45); g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x0, top + 20); g.lineTo(x0, y - 12); g.lineTo(x0 + 12, y);
    g.lineTo(CX - 120, y); g.lineTo(CX - 108, y - 6); g.lineTo(CX + 108, y - 6); g.lineTo(CX + 120, y);
    g.lineTo(x1 - 12, y); g.lineTo(x1, y - 12); g.lineTo(x1, top + 20);
    g.stroke();
    line(g, x1 - 120, top, x1, top, 1, rgba(TEAL, 0.25));
    for (var i = 0; i < slots.length; i++) {
      var s = slots[i], cx = s.x + s.w / 2;
      line(g, s.x - 6, s.y + s.w + 36, s.x + s.w + 6, s.y + s.w + 36, 1, rgba(TEAL, 0.3));
      line(g, cx, s.y + s.w + 32, cx, s.y + s.w + 40, 1, rgba(TEAL, 0.5));
    }
  }

  // MARK: - Lagren som rör sig: förritade en gång, sedan bara vridna och flyttade (grafikkretsen gör jobbet)
  //
  // Inget ritas om per bildruta. Ringarna, partiklarna, svepet och snurrorna är färdiga canvas som motorn vrider med
  // transform; pulserna, dockans svep och siktet är små element som flyttas. Bara kärnans lilla canvas (sekundringen
  // och visarna) ritas om, en gång i sekunden eller medan en visare glider. Allt uppdateras i motorns takt (Auto:
  // 30 bilder/s, 15 om TV:n inte hinner med), inte i skärmens 60.

  var movers = [], lastTurn = 0;   // {e, period (s), dir, breath (s)}: vrids i frame()

  function spin(e, periodS, dir, breathS) {
    e.style.webkitTransformOrigin = e.style.transformOrigin = '50% 50%';
    movers.push({e: e, period: periodS, dir: dir, breath: breathS || 0, last: ''});
    return e;
  }

  function ringLayer(cls, size, draw, parent) {
    var c = el('canvas', 'h4-ring ' + cls, parent || root);
    c.width = c.height = size;
    c.style.width = c.style.height = size + 'px';
    c.style.left = (CX - size / 2) + 'px';
    c.style.top = (CY - size / 2) + 'px';
    var g = c.getContext('2d');
    g.translate(size / 2 - CX, size / 2 - CY);
    draw(g);
    return c;
  }

  /** Dekor som inte rör sig (bakersta ringen, fenorna): ritas i det statiska lagret. */
  function drawBackDecor(g) {
    var i, c0;
    arc(g, 480, 0, 360, 1, rgba(DIM, 0.35));
    var parts = [[10, 64], [118, 150], [196, 262], [300, 336]];
    for (i = 0; i < parts.length; i++) arc(g, 462, parts[i][0], parts[i][1], 1.5, rgba(TEAL, 0.22));
    for (i = 0; i < 120; i++) tick(g, 488, 494, i * 3, 1, rgba(TEAL, i % 10 === 0 ? 0.4 : 0.15));
    for (var side = 0; side < 2; side++) {
      c0 = side * 180;
      for (i = -8; i <= 8; i++) tick(g, 328, i % 4 === 0 ? 356 : 344, c0 + i * 1.6, 1, rgba(TEAL, i % 4 === 0 ? 0.45 : 0.24));
      arc(g, 362, c0 - 16, c0 + 16, 1, rgba(TEAL, 0.38));
      arc(g, 322, c0 - 22, c0 - 14, 5, rgba(TEAL, 0.25));
      arc(g, 322, c0 + 14, c0 + 22, 5, rgba(TEAL, 0.25));
    }
  }

  function buildRings() {
    // Konsoler och fin skala (moturs): böjda klamrar, trianglar mot kärnan, skalstreck mellan dygnsringen och mätarna.
    spin(ringLayer('r4-a', 860, function (g) {
      for (var i = 0; i < 4; i++) {
        var c0 = 45 + i * 90;
        arc(g, 404, c0 - 22, c0 + 22, 2, rgba(TEAL, 0.5));
        tick(g, 396, 412, c0 - 22, 2, rgba(TEAL, 0.5));
        tick(g, 396, 412, c0 + 22, 2, rgba(TEAL, 0.5));
        arc(g, 396, c0 - 8, c0 + 8, 6, rgba(TEAL, 0.25));
      }
      for (var j = 0; j < 8; j++) {
        var a = rad(j * 45), b = rad(j * 45 - 2.2), cc = rad(j * 45 + 2.2);
        g.fillStyle = rgba(TEAL, 0.55);
        g.beginPath();
        g.moveTo(CX + Math.cos(a) * 386, CY + Math.sin(a) * 386);
        g.lineTo(CX + Math.cos(b) * 398, CY + Math.sin(b) * 398);
        g.lineTo(CX + Math.cos(cc) * 398, CY + Math.sin(cc) * 398);
        g.closePath(); g.fill();
      }
      for (var k = 0; k < 180; k++) tick(g, 280, k % 5 === 0 ? 292 : 286, k * 2, 1, rgba(TEAL, k % 5 === 0 ? 0.45 : 0.2));
      arc(g, 296, 0, 360, 1, rgba(DIM, 0.5));
    }), 270, -1);
    // Yttre segmentringen (medurs): långa bågar med luckor, block och en tät skala.
    spin(ringLayer('r4-outer', 790, function (g) {
      var parts = [[6, 52], [64, 70], [82, 168], [186, 232], [244, 250], [262, 352]];
      for (var i = 0; i < parts.length; i++) arc(g, R.outer, parts[i][0], parts[i][1], 1.5, rgba(TEAL, 0.55));
      for (var j = 0; j < 16; j++) arc(g, R.outer - 9, 10 + j * 22.5, 13 + j * 22.5, 8, rgba(TEAL, 0.4));
      for (var k = 0; k < 10; k++) arc(g, R.outer + 9, 172 + k * 1.4, 172.7 + k * 1.4, 8, rgba(TEAL, 0.45));
      for (var m = 0; m < 10; m++) arc(g, R.outer + 9, 352 - m * 1.4, 352.7 - m * 1.4, 8, rgba(TEAL, 0.45));
    }), 160, 1);
    // Inre: streckad ring och små punkter innanför sekundringen; andas.
    spin(ringLayer('r4-inner', 360, function (g) {
      for (var i = 0; i < 72; i++) arc(g, 160, i * 5, i * 5 + 2.5, 1.5, rgba(TEAL, 0.35));
      for (var k = 0; k < 4; k++) arc(g, 152, k * 90 + 20, k * 90 + 70, 2, rgba(TEAL, 0.4));
      for (var j = 0; j < 24; j++) { var p = at(144, j * 15); g.fillStyle = rgba(TEAL, j % 6 ? 0.3 : 0.8); g.fillRect(p[0] - 1, p[1] - 1, 2.5, 2.5); }
    }), 80, 1, 8);
    // Bakom klockan: svaga ekrar.
    spin(ringLayer('r4-spokes', 300, function (g) {
      for (var i = 0; i < 12; i++) tick(g, 70, i % 3 === 0 ? 136 : 118, i * 30 + 15, 1, rgba(TEAL, 0.12));
      arc(g, 64, 0, 360, 1, rgba(TEAL, 0.1));
      for (var k = 0; k < 4; k++) arc(g, 100, k * 90 + 30, k * 90 + 60, 3, rgba(TEAL, 0.1));
    }), 120, -1);
  }

  /** Partiklar i en lutande bana: en ring med prickar, hoptryckt på höjden av sitt hölje och vriden inuti det. */
  var orbits = [];
  function buildOrbits(n) {
    for (var o = 0; o < orbits.length; o++) if (orbits[o].parentNode) orbits[o].parentNode.removeChild(orbits[o]);
    orbits = [];
    var keep = [];
    for (var m = 0; m < movers.length; m++) if (!movers[m].orbit) keep.push(movers[m]);
    movers = keep;
    if (!root) return;
    var specs = [[0.62, 230, 1, 40], [0.8, 330, -1, 30]];
    for (var i = 0; i < n && i < specs.length; i++) {
      var size = 1060, holder = el('div', 'h4-orbit', null);
      holder.style.left = (CX - size / 2) + 'px';
      holder.style.top = (CY - size / 2) + 'px';
      holder.style.width = holder.style.height = size + 'px';
      holder.style.webkitTransform = holder.style.transform = 'scaleY(' + specs[i][0] + ')';
      root.insertBefore(holder, stat);
      var c = el('canvas', 'h4-ring', holder);
      c.width = c.height = size;
      c.style.left = c.style.top = '0px';
      c.style.width = c.style.height = size + 'px';
      var g = c.getContext('2d');
      for (var k = 0; k < specs[i][3]; k++) {
        var r = 410 + Math.random() * 110, a = Math.random() * Math.PI * 2, sz = 1 + Math.random() * 1.6;
        g.fillStyle = rgba(TEAL, 0.15 + Math.random() * 0.45);
        g.fillRect(size / 2 + Math.cos(a) * r - sz / 2, size / 2 + Math.sin(a) * r - sz / 2, sz, sz);
      }
      spin(c, specs[i][1], specs[i][2]);
      movers[movers.length - 1].orbit = true;
      orbits.push(holder);
    }
  }

  /** Svepet runt kärnan och snurrorna på cykelmätarna: små förritade canvas. */
  var sweepEl = null;
  function buildSweep() {
    sweepEl = spin(ringLayer('r4-sweep', 440, function (g) {
      for (var k = 0; k < 5; k++) arc(g, 186 + k * 4, -30 + k * 4, 0, 4, rgba(TEAL, 0.03 + k * 0.02));
    }), 10, 1);
    for (var i = 0; i < 3; i++) {
      var x = LX + 72 + i * 143, size = 140, c = el('canvas', 'h4-ring', root);
      c.width = c.height = size;
      c.style.left = (x - size / 2) + 'px';
      c.style.top = (GAUGE_Y - size / 2) + 'px';
      c.style.width = c.style.height = size + 'px';
      arcAt(c.getContext('2d'), size / 2, size / 2, GAUGE_R + 8, 0, 14, 3, rgba(TEAL, 0.55));
      spin(c, 6 + i * 2.5, 1);
      spinEls.push(c);
    }
  }

  // MARK: - Kärnans lilla canvas: sekundringen och mätarnas visare

  var CORE_W = 900, CORE_H = 760, core = null, cctx = null, lastSec = -1;

  function drawCoreDyn(t, dt) {
    var g = cctx, moving = false;
    g.save();
    g.setTransform(scale, 0, 0, scale, 0, 0);
    g.clearRect(0, 0, CORE_W, CORE_H);
    g.translate(CORE_W / 2 - CX, CORE_H / 2 - CY);
    var d = new Date(t), sec = d.getSeconds();
    for (var s = 0; s < 60; s++) {
      var cur = s === sec;
      arc(g, R.sec, s * 6 + 0.9, s * 6 + 5.1, cur ? 8 : 4, rgba(cur ? ICE : mode.match ? AMBER : TEAL, cur ? 1 : s < sec ? 0.5 : 0.1));
    }
    if (model.temp !== undefined) {
      var tt = clampT(model.temp);
      needle.temp = needle.temp === null ? TEMP_LO : needle.temp + (tt - needle.temp) * Math.min(1, dt * 2.2);
      if (Math.abs(tt - needle.temp) < 0.02) needle.temp = tt; else moving = true;
      var td = tempDeg(needle.temp);
      arc(g, R.gauge, td, 130, 4, rgba(TEAL, 0.8));
      tick(g, R.gauge - 16, R.gauge + 18, td, 2.5, rgba(ICE, 1));
      needleLabel(g, td, deg(model.temp), ICE, 1);
    }
    if (model.match) {
      var days = Math.max(0, Math.min(14, (model.match.start - t) / 86400000));
      needle.match = needle.match === null ? 14 : needle.match + (days - needle.match) * Math.min(1, dt * 2.2);
      if (Math.abs(days - needle.match) < 0.005) needle.match = days; else moving = true;
      var md = matchDeg(needle.match);
      arc(g, R.gauge, 230, md, 4, rgba(AMBER, 0.85));
      tick(g, R.gauge - 16, R.gauge + 18, md, 2.5, rgba(AMBER, 1));
      var left = Math.max(0, model.match.start - t), dl = Math.floor(left / 86400000), hl = Math.floor(left / 3600000) % 24;
      needleLabel(g, md, (dl ? dl + ' D ' : '') + hl + ' H', AMBER, -1);
    }
    g.restore();
    lastSec = sec;
    return moving;
  }

  // MARK: - Pulser, dockans svep och siktet: små element som flyttas

  var pulseEls = [], dockSweep = null, ret = null, retCorners = [], retFor = null, retAt = 0, retBox = null, needleMoving = true;
  var bootCanvas = null, bootCtx = null;

  function buildMovers() {
    for (var i = 0; i < 6; i++) { var p = el('div', 'h4-pulse', root); p.style.display = 'none'; pulseEls.push(p); }
    dockSweep = el('div', 'h4-docksweep', root);
    ret = el('div', '', document.getElementById('home'));
    ret.id = 'h4ret';
    for (var k = 0; k < 4; k++) retCorners.push(el('span', 'c' + k, ret));
  }

  function place(e, x, y) {
    var v = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
    e.style.webkitTransform = e.style.transform = v;
  }

  /** Siktet: läget läses när fokus flyttar (och en stund efter, medan rutan glider), annars en gång i sekunden. */
  function updateReticle(t) {
    var f = document.querySelector('#top .focus, #tiles .focus, #home .focus');
    if (!f) { ret.style.display = 'none'; retFor = null; return; }
    if (f !== retFor) { retFor = f; retAt = t; }
    if (!retBox || t - retAt < 600 || t % 1000 < 40) {
      var b = rect(f);
      if (b) {
        retBox = b;
        ret.style.display = 'block';
        ret.style.left = Math.round(b.x) + 'px'; ret.style.top = Math.round(b.y) + 'px';
        ret.style.width = Math.round(b.w) + 'px'; ret.style.height = Math.round(b.h) + 'px';
      }
    }
    var pad = 9 + Math.sin(t / 280) * 3;
    place(retCorners[0], -pad, -pad); place(retCorners[1], pad, -pad);
    place(retCorners[2], pad, pad); place(retCorners[3], -pad, pad);
  }

  function frame(now) {
    raf = 0;
    if (!running) return;
    raf = requestAnimationFrame(frame);
    var minGap = 1000 / (mode.night ? Math.min(15, q.fps) : q.fps);   // natt: lugnare, 15 bilder/s
    if (now - lastFrame < minGap - 2) return;
    var dt = lastFrame ? Math.min(0.25, (now - lastFrame) / 1000) : 0, t0 = Date.now();
    adapt(now - lastFrame);
    lastFrame = now;
    var t = t0, i;

    // Uppstart: ledlinjerna ritas ut från kärnan (bara de första sekunderna, på ett eget canvas som sedan göms).
    var boot = Math.min(1, (t - bootAt) / 2600);
    if (bootCanvas) {
      if (boot < 1) {
        bootCtx.clearRect(0, 0, W, H);
        for (i = 0; i < links.length; i++) drawLink(bootCtx, links[i], Math.max(0, Math.min(1, boot * 1.6 - i * 0.1)), 0.9);
        arc(bootCtx, 100 + boot * 330, 0, 360, 2, rgba(TEAL, (1 - boot) * 0.8));
      } else if (bootCanvas.style.display !== 'none') { bootCtx.clearRect(0, 0, W, H); bootCanvas.style.display = 'none'; }
    }

    // Ringarna, partiklarna, svepet och snurrorna vrids: tio gånger i sekunden räcker för så långsamma varv
    // (svepet, det snabbaste, följer bildfrekvensen).
    var still = q.level === 'low' || q.fps <= 15 && q.level === 'auto', turn = t - lastTurn >= 95;
    if (turn) lastTurn = t;
    var slowBy = mode.night ? 2 : 1;
    for (i = 0; i < movers.length; i++) {
      var mv = movers[i];
      if (still && !mv.orbit && mv.e !== sweepEl) continue;
      if (!turn && mv.e !== sweepEl) continue;
      var ang = (t / 1000 / (mv.period * slowBy) % 1) * 360 * mv.dir, v = 'rotate(' + ang.toFixed(2) + 'deg)';
      if (v !== mv.last) { mv.e.style.webkitTransform = mv.e.style.transform = v; mv.last = v; }
      if (mv.breath) mv.e.style.opacity = (0.75 + 0.25 * Math.sin(t / 1000 / mv.breath * Math.PI * 2)).toFixed(2);
    }

    // Kärnan: en gång i sekunden, och varje bildruta medan en visare glider.
    var sec = new Date(t).getSeconds();
    if (sec !== lastSec || needleMoving) needleMoving = drawCoreDyn(t, dt || 0.03);

    // Pulser längs ledlinjerna: ut till noderna, och tillbaka när en nod fått nya värden.
    if (boot >= 1 && links.length && pulses.length < pulseEls.length && Math.random() < dt * (mode.night ? 0.25 : 0.8)) pulses.push({link: Math.floor(Math.random() * links.length), t: 0});
    for (var u = pulses.length - 1; u >= 0; u--) {
      var pu = pulses[u], ln = links[pu.link];
      pu.t += dt / (pu.strong ? 0.9 : 1.8);
      if (!ln || pu.t >= 1) { pulses.splice(u, 1); continue; }
    }
    for (i = 0; i < pulseEls.length; i++) {
      var pe = pulseEls[i], pp = pulses[i];
      if (!pp) { if (pe.style.display !== 'none') pe.style.display = 'none'; continue; }
      var pos = pointOn(links[pp.link], pp.back ? 1 - pp.t : pp.t);
      if (pe.style.display !== 'block') pe.style.display = 'block';
      pe.className = 'h4-pulse' + (pp.strong ? ' strong' : '');
      place(pe, pos[0], pos[1]);
    }

    // Dockans svep längs basen.
    if (q.sweep && !mode.night && slots.length) {
      var dx0 = slots[0].x - 40, dx1 = slots[slots.length - 1].x + slots[slots.length - 1].w + 40;
      dockSweep.style.display = 'block';
      place(dockSweep, dx0 + (t / 7000 % 1) * (dx1 - dx0) - 60, 1049);
    } else dockSweep.style.display = 'none';
    sweepEl.style.display = q.sweep ? '' : 'none';

    updateReticle(t);
    perfNote(Date.now() - t0, now);
  }

  // Mätning: motorns verkliga bildfrekvens och tiden den tar per bildruta (för Systemnoden och tester).
  var perf = {frames: 0, ms: 0, since: 0, fps: 0, msPer: 0};
  function perfNote(ms, now) {
    if (!perf.since) perf.since = now;
    perf.frames++; perf.ms += ms;
    if (now - perf.since >= 3000) {
      perf.fps = Math.round(perf.frames * 1000 / (now - perf.since));
      perf.msPer = Math.round(perf.ms / perf.frames * 10) / 10;
      perf.frames = 0; perf.ms = 0; perf.since = now;
    }
  }

  function rect(e) {
    var r = e.getBoundingClientRect(), s = document.getElementById('stage').getBoundingClientRect(), k = s.width / W;
    if (!r.width) return null;
    return {x: (r.left - s.left) / k, y: (r.top - s.top) / k, w: r.width / k, h: r.height / k};
  }

  // MARK: - Inbränning: hela startsidan flyttas en pixel i taget, sakta, i stället för en animation som går hela tiden

  var driftTimer = 0;
  function drift() {
    var pts = [[0, 0], [4, 3], [0, 5], [-4, 3], [0, 0]], f = (Date.now() / 1000 % 3600) / 900, k = Math.floor(f), u = f - k;
    var x = Math.round(pts[k][0] + (pts[k + 1][0] - pts[k][0]) * u), y = Math.round(pts[k][1] + (pts[k + 1][1] - pts[k][1]) * u);
    var ids = ['home', 'sky'];
    for (var i = 0; i < ids.length; i++) {
      var e = document.getElementById(ids[i]);
      if (e) { e.style.left = running ? x + 'px' : ''; e.style.top = running ? y + 'px' : ''; }
    }
  }

  // MARK: - Kvalitet: Auto sänker när TV:n inte hinner med, och höjer igen när den gör det

  var LEVELS = {high: {fps: 60, orbits: 2, sweep: true}, medium: {fps: 30, orbits: 1, sweep: true}, low: {fps: 15, orbits: 0, sweep: false}};

  function resize() {
    var s = q.level === 'high' ? Math.min(2, window.devicePixelRatio || 1) : 1;
    if (!stat || s === scale && stat.width === W * s) return;
    scale = s;
    stat.width = W * s;
    stat.height = H * s;
    sctx.setTransform(s, 0, 0, s, 0, 0);
    core.width = CORE_W * s; core.height = CORE_H * s;
    lastSec = -1; needleMoving = true;
    if (running) drawStatic();
  }

  function setQuality(level) {
    q.level = level || 'auto';
    resize();
    var l = LEVELS[q.level === 'auto' ? 'medium' : q.level] || LEVELS.medium;
    q.fps = l.fps; q.sweep = l.sweep;
    if (root) buildOrbits(l.orbits);
    q.orbits = l.orbits;
    slow = fast = 0;
    setClass(document.body, 'h4-low', q.level === 'low');
  }

  function adapt(gap) {
    if (q.level !== 'auto' || !gap || gap > 1000 || mode.night) return;
    var budget = 1000 / q.fps;
    if (gap > budget * 1.6) slow++; else slow = Math.max(0, slow - 1);
    if (gap < budget * 1.1) fast++; else fast = 0;
    if (slow > 45 && q.fps > 15) {   // flera sekunder för långsamt: 15 bilder/s, inga partiklar eller svep, stilla ringar
      q.fps = 15; q.sweep = false; buildOrbits(0); slow = 0;
      setClass(document.body, 'h4-low', true);
    } else if (fast > 900 && q.fps < 30) { q.fps = 30; q.sweep = true; buildOrbits(1); fast = 0; setClass(document.body, 'h4-low', false); }
  }

  // MARK: - Systemnoden och statusraden (riktiga värden från appen och vädret)

  function renderBar() {
    if (!bar) return;
    var d = new Date(), city = (typeof Prefs !== 'undefined' && Prefs.city ? Prefs.city() : '') || 'Uppsala';
    bar.childNodes[1].textContent = city.toUpperCase() + '  ::  VECKA ' + week(d) + '  ::  DAG ' + model.doy;
    var r = model.temp !== undefined ? 'UTE ' + deg(model.temp) : '';
    if (model.riseAt) r += (r ? '  ::  ' : '') + 'SOL ' + hm(model.riseAt) + '–' + hm(model.setAt);
    bar.childNodes[2].textContent = r;
  }

  function renderSys() {
    renderBar();
    if (!sys) return;
    var up = Math.floor((Date.now() - startedAt) / 60000);
    var rows = [
      ['DAG', model.doy + ' / ' + model.yearLen],
      ['ÅRET', pct(model.doy / model.yearLen)],
      model.riseAt ? ['DAGSLJUS', Math.floor((model.setAt - model.riseAt) / 3600000) + ' H ' + two(Math.round((model.setAt - model.riseAt) / 60000) % 60) + ' MIN'] : null,
      model.riseAt ? ['SOL', hm(model.riseAt) + ' – ' + hm(model.setAt)] : null,
      ['FAVORITER', model.apps + ' APPAR'],
      ['UPPTID', Math.floor(up / 60) + ' H ' + two(up % 60) + ' MIN'],
      window.FMTV_LOADER ? ['VERSION', FMTV_LOADER.version + '  ·  ' + FMTV_LOADER.commit] : null,
      ['GRAFIK', fpsText()]
    ];
    sys.innerHTML = '';
    var head = el('div', 'head', sys);
    el('span', 'tag', head, 'SYSTEM  ::  HEMMA');
    for (var i = 0; i < rows.length; i++) {
      if (!rows[i]) continue;
      var r = el('div', 'row', sys);
      el('span', 'k', r, rows[i][0]);
      var v = el('span', 'v', r, rows[i][1]);
      if (rows[i][0] === 'GRAFIK') sysFps = v;
    }
  }

  /** Grafikläget och motorns uppmätta bildfrekvens, t.ex. "AUTO  ·  30 BILDER/S". */
  function fpsText() {
    var names = {auto: 'AUTO', high: 'HÖG', medium: 'MELLAN', low: 'LÅG'};
    return (names[q.level] || 'AUTO') + (perf.fps ? '  ·  ' + perf.fps + ' BILDER/S' : '');
  }

  // MARK: - Skärmsläckarna i samma stil (home.js anropar saver när en visas)

  var SX = 960, SY = 520, saverTimer = 0, saverSpin = 0;

  function ringAt(parent, cls, size, cx, cy, draw) {
    var c = el('canvas', 'h4-ring ' + cls, null);
    c.width = c.height = size;
    c.style.width = c.style.height = size + 'px';
    c.style.left = (cx - size / 2) + 'px';
    c.style.top = (cy - size / 2) + 'px';
    var g = c.getContext('2d');
    g.translate(size / 2 - cx, size / 2 - cy);
    draw(g);
    parent.insertBefore(c, parent.firstChild);
    return c;
  }

  /** Ramen runt skärmen: hörn, en linje under rubriken, taggen och vädret till höger (bara riktiga värden). */
  function saverFrame(g, label) {
    var x0 = 36, x1 = W - 36, y0 = 78, y1 = H - 20;
    g.strokeStyle = rgba(TEAL, 0.7); g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x0, y0 + 40); g.lineTo(x0, y0); g.lineTo(x0 + 40, y0);
    g.moveTo(x1 - 40, y0); g.lineTo(x1, y0); g.lineTo(x1, y0 + 40);
    g.moveTo(x0, y1 - 40); g.lineTo(x0, y1); g.lineTo(x0 + 40, y1);
    g.moveTo(x1 - 40, y1); g.lineTo(x1, y1); g.lineTo(x1, y1 - 40);
    g.stroke();
    line(g, x0 + 40, y0, x1 - 40, y0, 1, rgba(TEAL, 0.22));
    tag(g, label, x0, 30, 0);
    var w = typeof Data !== 'undefined' && Prefs.weather() ? Data.weather : null;
    if (w && !isNaN(w.temp)) text(g, 'UTE ' + deg(w.temp) + '  ::  ' + String(Data.condition ? Data.condition(w.code, w.isDay) : '').toUpperCase(), x1, 43, 15, rgba(ICE, 0.85), 'right', 500, 3);
  }

  /** Viloläget (klockan): kärnan stor i mitten med dygns- och veckoringen, ringar som långsamt vrider sig. */
  function drawStandby(g) {
    var m = readModel(), i, p;
    g.clearRect(0, 0, W, H);
    saverFrame(g, 'KONTROLLRUM  ::  VILOLÄGE');
    for (i = 0; i < 7; i++) {
      var wd = (i + 1) % 7, from = i * (360 / 7) + 1.4, to = (i + 1) * (360 / 7) - 1.4, now = wd === m.day;
      arcAt(g, SX, SY, 300, from, to, now ? 7 : 3, rgba(now ? TEAL : DIM, now ? 0.95 : 0.7));
      p = [SX + Math.cos(rad((from + to) / 2)) * 318, SY + Math.sin(rad((from + to) / 2)) * 318];
      text(g, DAYS[wd], p[0], p[1], 13, rgba(TEAL, now ? 1 : 0.5), 'center', 600, 1.5);
    }
    arcAt(g, SX, SY, 344, 0, 360, 1, rgba(DIM, 0.8));
    for (i = 0; i < 96; i++) tickAt(g, SX, SY, 344 - (i % 24 === 0 ? 14 : i % 4 === 0 ? 8 : 3), 344, i * 3.75, i % 4 === 0 ? 1.5 : 1, rgba(TEAL, i % 24 === 0 ? 0.8 : i % 4 === 0 ? 0.45 : 0.2));
    for (i = 0; i < 4; i++) { var a = rad(i * 90); text(g, two(i * 6), SX + Math.cos(a) * 364, SY + Math.sin(a) * 364, 13, rgba(TEAL, 0.75), 'center', 600, 1); }
    if (m.rise !== undefined) arcAt(g, SX, SY, 349, m.rise * 360, m.set * 360, 4, rgba(AMBER, 0.6));
    arcAt(g, SX, SY, 339, 0, m.dayFrac * 360, 2, rgba(TEAL, 0.8));
    var na = rad(m.dayFrac * 360);
    g.fillStyle = rgba(ICE, 1);
    g.beginPath(); g.arc(SX + Math.cos(na) * 344, SY + Math.sin(na) * 344, 5, 0, Math.PI * 2); g.fill();
  }

  function standbyRings(parent) {
    var list = [];
    ringAt(parent, 's4-back', 1060, SX, SY, function (g) {
      var grad = g.createRadialGradient(SX, SY, 60, SX, SY, 300);
      grad.addColorStop(0, 'rgba(2, 8, 10, 0.85)');
      grad.addColorStop(1, 'rgba(2, 8, 10, 0)');
      g.fillStyle = grad;
      g.beginPath(); g.arc(SX, SY, 300, 0, Math.PI * 2); g.fill();
      arcAt(g, SX, SY, 510, 0, 360, 1, rgba(DIM, 0.35));
      for (var k = 0; k < 120; k++) tickAt(g, SX, SY, 516, 522, k * 3, 1, rgba(TEAL, k % 10 === 0 ? 0.4 : 0.15));
    });
    list.push([ringAt(parent, 's4-brackets', 960, SX, SY, function (g) {
      for (var i = 0; i < 4; i++) {
        var c0 = 45 + i * 90;
        arcAt(g, SX, SY, 452, c0 - 20, c0 + 20, 2, rgba(TEAL, 0.5));
        tickAt(g, SX, SY, 444, 460, c0 - 20, 2, rgba(TEAL, 0.5));
        tickAt(g, SX, SY, 444, 460, c0 + 20, 2, rgba(TEAL, 0.5));
      }
    }), 300, -1]);
    list.push([ringAt(parent, 's4-outer', 880, SX, SY, function (g) {
      var parts = [[6, 52], [64, 70], [82, 168], [186, 232], [244, 250], [262, 352]];
      for (var i = 0; i < parts.length; i++) arcAt(g, SX, SY, 418, parts[i][0], parts[i][1], 1.5, rgba(TEAL, 0.5));
      for (var j = 0; j < 16; j++) arcAt(g, SX, SY, 408, 10 + j * 22.5, 13 + j * 22.5, 8, rgba(TEAL, 0.35));
    }), 200, 1]);
    list.push([ringAt(parent, 's4-scale', 800, SX, SY, function (g) {
      for (var i = 0; i < 180; i++) tickAt(g, SX, SY, 380, i % 5 === 0 ? 392 : 386, i * 2, 1, rgba(TEAL, i % 5 === 0 ? 0.4 : 0.18));
    }), 360, -1]);
    list.push([ringAt(parent, 's4-inner', 600, SX, SY, function (g) {
      for (var i = 0; i < 90; i++) arcAt(g, SX, SY, 272, i * 4, i * 4 + 2, 1.5, rgba(TEAL, 0.3));
      for (var k = 0; k < 4; k++) arcAt(g, SX, SY, 262, k * 90 + 20, k * 90 + 70, 2, rgba(TEAL, 0.35));
    }), 120, 1]);
    return list;
  }

  /** En skärmsläckare visas (home.js): i v4 klädd som kontrollrummet. Bilderna och klockan är desamma. */
  function saver(layer, kind) {
    clearInterval(saverTimer);
    saverTimer = 0;
    var on = enabled();
    setClass(layer, 'h4-saver', on);
    if (!on) return;
    var host = kind === 'clock' ? layer.querySelector('.shift') || layer : layer;
    var c = el('canvas', 'h4-saverframe', null);
    c.width = W; c.height = H;
    clearInterval(saverSpin); saverSpin = 0;
    if (kind === 'clock') {
      var rings = standbyRings(host);
      // Ringarna vrids tio gånger i sekunden (inte i skärmens 60): skärmsläckaren kan stå på i timmar.
      if (!hasClass(document.body, 'h4-low')) saverSpin = setInterval(function () {
        if (!hasClass(layer, 'on')) { clearInterval(saverSpin); saverSpin = 0; return; }
        var t = Date.now() / 1000;
        for (var i = 0; i < rings.length; i++) {
          var v = 'rotate(' + ((t / rings[i][1] % 1) * 360 * rings[i][2]).toFixed(2) + 'deg)';
          rings[i][0].style.webkitTransform = rings[i][0].style.transform = v;
        }
      }, 100);
      host.insertBefore(c, host.querySelector('.clock'));   // över ringarna, under klockan
      drawStandby(c.getContext('2d'));
    } else {
      layer.appendChild(c);
      var g = c.getContext('2d');
      g.clearRect(0, 0, W, H);
      saverFrame(g, 'KONTROLLRUM  ::  VILOLÄGE');
    }
    // Dygnsringen och vädret följer med medan skärmsläckaren visas.
    saverTimer = setInterval(function () {
      if (!hasClass(layer, 'on') || !c.parentNode) { clearInterval(saverTimer); saverTimer = 0; return; }
      var g2 = c.getContext('2d');
      if (kind === 'clock') drawStandby(g2); else { g2.clearRect(0, 0, W, H); saverFrame(g2, 'KONTROLLRUM  ::  VILOLÄGE'); }
    }, 60000);
  }

  // MARK: - Start och stopp

  function build() {
    var sky = document.getElementById('sky'), top = document.getElementById('top');
    if (!sky || !top) return false;
    root = el('div', '', sky);
    root.id = 'holo4';
    buildRings();
    buildSweep();
    stat = el('canvas', 'h4-static', root);   // över ringarna: mätvärden och etiketter ligger överst
    stat.width = W; stat.height = H;
    sctx = stat.getContext('2d');
    core = el('canvas', 'h4-core', root);
    core.width = CORE_W; core.height = CORE_H;
    core.style.left = (CX - CORE_W / 2) + 'px'; core.style.top = (CY - CORE_H / 2) + 'px';
    core.style.width = CORE_W + 'px'; core.style.height = CORE_H + 'px';
    cctx = core.getContext('2d');
    bootCanvas = el('canvas', 'h4-bootlines', root);
    bootCanvas.width = W; bootCanvas.height = H;
    bootCtx = bootCanvas.getContext('2d');
    buildMovers();
    buildOrbits(q.orbits < 0 ? 1 : q.orbits);
    sys = el('div', '', top);
    sys.id = 'h4sys';
    matchEl = el('div', '', top);
    matchEl.id = 'h4match';
    el('span', 'tag', matchEl); el('div', 'main', matchEl); el('div', 'sub', matchEl);
    goalEl = el('div', '', top, 'MÅL');
    goalEl.id = 'h4goal';
    nightEl = el('div', 'layer', document.getElementById('stage'));
    nightEl.id = 'h4night';
    bar = el('div', '', top);
    bar.id = 'h4bar';
    el('span', 'tag', bar, 'KONTROLLRUM');
    el('span', 'l', bar);
    el('span', 'r', bar);
    return true;
  }

  function start() {
    if (running) return;
    if (!root && !build()) return;
    resize();
    running = true;
    bootAt = Date.now();
    bootCanvas.style.display = '';
    setClass(document.body, 'h4-boot', true);
    setTimeout(function () { setClass(document.body, 'h4-boot', false); }, 2800);
    needle.temp = needle.match = null;
    needleMoving = true;
    modelKey = '';
    refresh();
    drift();
    if (!driftTimer) driftTimer = setInterval(drift, 30000);
    if (window.WeatherBg && WeatherBg.hold) WeatherBg.hold(true);   // himlen bakom rummet behöver inte röra sig
    lastFrame = 0;
    perf.since = 0; perf.frames = 0; perf.ms = 0;
    if (!raf) raf = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    clearInterval(driftTimer); driftTimer = 0;
    drift();   // tillbaka på plats
    if (window.WeatherBg && WeatherBg.hold) WeatherBg.hold(false);
    if (ret) ret.style.display = 'none';
  }

  /** Följer inställningen och läget: på i v4 när startsidan syns, av annars. Byte av utseende lägger om dockan. */
  function apply() {
    var on = enabled();
    setClass(document.body, 'v4', on);
    if (on !== wasOn) {
      var first = wasOn === null;
      wasOn = on;
      if (!(first && !on) && window.FreeMyTV && FreeMyTV.relayout) FreeMyTV.relayout();
    }
    if (typeof Prefs !== 'undefined' && Prefs.holoQuality && (Prefs.holoQuality() !== q.level || q.orbits < 0)) setQuality(Prefs.holoQuality());
    var hidden = paused || document.hidden || (window.Hud && Hud.isOn && Hud.isOn());
    if (on && !hidden) start(); else stop();
  }

  document.addEventListener('visibilitychange', apply);
  // Var 5:e sekund: datan och rutornas lägen (Barça byter sida var 12:e sekund), och om v4 har slagits på.
  setInterval(function () {
    if (running) { refresh(); if (sysFps) sysFps.textContent = fpsText(); }
    else if (enabled() && !paused && !document.hidden) apply();
  }, 5000);
  setInterval(function () { if (running) { modelKey = ''; refresh(); } }, 60000);
  setTimeout(apply, 600);

  return {apply: apply, refresh: refresh, setQuality: setQuality, saver: saver, isRunning: function () { return running; },
    /** En nod slogs av eller på, eller nattläget ändrades (Hemskärm): allt läses och ritas om. */
    relayout: function () { modelKey = ''; if (running) refresh(); else apply(); },
    /** Skärmsläckarna (home.js): motorn vilar medan en av dem täcker startsidan. */
    pause: function (on) { if (paused !== !!on) { paused = !!on; apply(); } },
    /** För tester: läget just nu. */
    debug: function () { return {model: model, links: links.length, slots: slots.length, fps: q.fps, orbits: orbits.length, perf: {fps: perf.fps, msPerFrame: perf.msPer}}; }};
})();
