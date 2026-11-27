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

  var root = null, stat = null, sctx = null, dyn = null, dctx = null, sys = null, bar = null, wasOn = null;
  var running = false, paused = false, raf = 0, lastFrame = 0, bootAt = 0, startedAt = Date.now();
  var model = {}, modelKey = '', links = [], particles = [], pulses = [], slots = [];
  var needle = {temp: null, match: null};
  var q = {fps: 30, particles: 60, sweep: true, level: 'auto'}, slow = 0, fast = 0, scale = 1;

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
    var w = typeof Data !== 'undefined' && Prefs.weather() ? Data.weather : null;
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

  /** Läser datan; ritar om det statiska lagret när något har ändrats (eller rutorna har flyttat). */
  function refresh() {
    if (!root) return;
    var m = readModel(), lay = layoutKey();
    var key = JSON.stringify([m.temp, m.max, m.min, m.rise, m.set, m.match && m.match.start, m.countdown && m.countdown.days,
      m.day, Math.floor(m.dayFrac * 288), m.apps, m.hours && m.hours.length && m.hours[0].at, lay]);
    var old = model;
    model = m;
    if (key === modelKey) return;
    modelKey = key;
    if (old.temp !== undefined && m.temp !== old.temp) ping('wxtop');
    findLinks();
    findSlots();
    drawStatic();
    renderSys();
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
    s = at(R.outer, 264); addLink('cycles', 264, [s, [LX + LW + 70, s[1]], [LX + LW + 70, GAUGE_Y - 82], [LX + LW + 8, GAUGE_Y - 82]]);
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
    drawFrame(g);
    drawCore(g);
    for (var i = 0; i < links.length; i++) {
      drawLink(g, links[i], 1, 0.32);
      var e = links[i].pts[links[i].pts.length - 1], s = links[i].pts[0];
      g.fillStyle = rgba(TEAL, 0.9);
      g.fillRect(e[0] - 3, e[1] - 3, 6, 6);
      g.beginPath(); g.arc(s[0], s[1], 3.5, 0, Math.PI * 2); g.fill();
    }
    drawCycles(g);
    drawWeek(g);
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

  // MARK: - Ringarna (förritade, roteras av CSS)

  function ringLayer(cls, size, draw) {
    var c = el('canvas', 'h4-ring ' + cls, root);
    c.width = c.height = size;
    c.style.width = c.style.height = size + 'px';
    c.style.left = (CX - size / 2) + 'px';
    c.style.top = (CY - size / 2) + 'px';
    var g = c.getContext('2d');
    g.translate(size / 2 - CX, size / 2 - CY);
    draw(g);
    return c;
  }

  function buildRings() {
    // Längst bak: stora svaga ringar med långa bågar (djup).
    ringLayer('r4-back', 1000, function (g) {
      // Mörkare bakom klockan, så att siffrorna läses mot ringarna (rund, så rotationen syns inte).
      var grad = g.createRadialGradient(CX, CY, 40, CX, CY, 230);
      grad.addColorStop(0, 'rgba(2, 8, 10, 0.8)');
      grad.addColorStop(1, 'rgba(2, 8, 10, 0)');
      g.fillStyle = grad;
      g.beginPath(); g.arc(CX, CY, 230, 0, Math.PI * 2); g.fill();
      arc(g, 480, 0, 360, 1, rgba(DIM, 0.35));
      var parts = [[10, 64], [118, 150], [196, 262], [300, 336]];
      for (var i = 0; i < parts.length; i++) arc(g, 462, parts[i][0], parts[i][1], 1.5, rgba(TEAL, 0.22));
      for (var k = 0; k < 120; k++) tick(g, 488, 494, k * 3, 1, rgba(TEAL, k % 10 === 0 ? 0.4 : 0.15));
    });
    // Konsoler: böjda klamrar på diagonalerna och små trianglar som pekar in mot kärnan.
    ringLayer('r4-brackets', 860, function (g) {
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
    });
    // Yttre segmentringen: långa bågar med luckor, block, och en tät skala.
    ringLayer('r4-outer', 790, function (g) {
      var parts = [[6, 52], [64, 70], [82, 168], [186, 232], [244, 250], [262, 352]];
      for (var i = 0; i < parts.length; i++) arc(g, R.outer, parts[i][0], parts[i][1], 1.5, rgba(TEAL, 0.55));
      for (var j = 0; j < 16; j++) arc(g, R.outer - 9, 10 + j * 22.5, 13 + j * 22.5, 8, rgba(TEAL, 0.4));
      for (var k = 0; k < 10; k++) arc(g, R.outer + 9, 172 + k * 1.4, 172.7 + k * 1.4, 8, rgba(TEAL, 0.45));
      for (var m = 0; m < 10; m++) arc(g, R.outer + 9, 352 - m * 1.4, 352.7 - m * 1.4, 8, rgba(TEAL, 0.45));
    });
    // Fin skala mellan dygnsringen och mätarna.
    ringLayer('r4-scale', 600, function (g) {
      for (var i = 0; i < 180; i++) tick(g, 280, i % 5 === 0 ? 292 : 286, i * 2, 1, rgba(TEAL, i % 5 === 0 ? 0.45 : 0.2));
      arc(g, 296, 0, 360, 1, rgba(DIM, 0.5));
    });
    // Fenor uppe och nere: täta streck och block mellan dygnsringen och den yttre ringen (dekor, som i en ritning).
    ringLayer('r4-fins', 740, function (g) {
      for (var side = 0; side < 2; side++) {
        var c0 = side * 180;
        for (var i = -8; i <= 8; i++) tick(g, 328, i % 4 === 0 ? 356 : 344, c0 + i * 1.6, 1, rgba(TEAL, i % 4 === 0 ? 0.55 : 0.3));
        arc(g, 362, c0 - 16, c0 + 16, 1, rgba(TEAL, 0.45));
        arc(g, 322, c0 - 22, c0 - 14, 5, rgba(TEAL, 0.3));
        arc(g, 322, c0 + 14, c0 + 22, 5, rgba(TEAL, 0.3));
      }
    });
    // Inre: streckad ring och små punkter innanför sekundringen.
    ringLayer('r4-inner', 360, function (g) {
      for (var i = 0; i < 72; i++) arc(g, 160, i * 5, i * 5 + 2.5, 1.5, rgba(TEAL, 0.35));
      for (var k = 0; k < 4; k++) arc(g, 152, k * 90 + 20, k * 90 + 70, 2, rgba(TEAL, 0.4));
      for (var j = 0; j < 24; j++) { var p = at(144, j * 15); g.fillStyle = rgba(TEAL, j % 6 ? 0.3 : 0.8); g.fillRect(p[0] - 1, p[1] - 1, 2.5, 2.5); }
    });
    // Bakom klockan: svaga ekrar som långsamt vrider sig.
    ringLayer('r4-spokes', 300, function (g) {
      for (var i = 0; i < 12; i++) tick(g, 70, i % 3 === 0 ? 136 : 118, i * 30 + 15, 1, rgba(TEAL, 0.12));
      arc(g, 64, 0, 360, 1, rgba(TEAL, 0.1));
      for (var k = 0; k < 4; k++) arc(g, 100, k * 90 + 30, k * 90 + 60, 3, rgba(TEAL, 0.1));
    });
  }

  // MARK: - Dynamiska lagret (per bildruta)

  function makeParticles(n) {
    particles = [];
    for (var i = 0; i < n; i++) {
      particles.push({r: 410 + Math.random() * 110, tilt: 0.5 + Math.random() * 0.35, a: Math.random() * Math.PI * 2,
        v: (Math.random() < 0.5 ? -1 : 1) * (0.015 + Math.random() * 0.04), s: 1 + Math.random() * 1.4, o: 0.15 + Math.random() * 0.4});
    }
  }

  function frame(now) {
    raf = 0;
    if (!running) return;
    raf = requestAnimationFrame(frame);
    var minGap = 1000 / q.fps;
    if (now - lastFrame < minGap - 2) return;
    var dt = lastFrame ? Math.min(0.25, (now - lastFrame) / 1000) : 0;
    adapt(now - lastFrame);
    lastFrame = now;

    var g = dctx, t = Date.now(), boot = Math.min(1, (t - bootAt) / 2600), i;
    g.clearRect(0, 0, W, H);

    // Uppstart: ledlinjerna ritas ut från kärnan, en ring växer ut.
    if (boot < 1) {
      for (i = 0; i < links.length; i++) drawLink(g, links[i], Math.max(0, Math.min(1, boot * 1.6 - i * 0.1)), 0.9);
      arc(g, 100 + boot * 330, 0, 360, 2, rgba(TEAL, (1 - boot) * 0.8));
    }

    // Sekundringen: 60 fält, sekunderna som gått lyser, den aktuella starkast.
    var d = new Date(t), sec = d.getSeconds() + d.getMilliseconds() / 1000;
    for (var s = 0; s < 60; s++) {
      var on = s < sec, cur = s === Math.floor(sec);
      arc(g, R.sec, s * 6 + 0.9, s * 6 + 5.1, cur ? 8 : 4, rgba(cur ? ICE : TEAL, cur ? 1 : on ? 0.5 : 0.1));
    }

    // Svepet: en svag ljuskil runt kärnan (dekor).
    if (q.sweep) {
      var sw = (t / 10000 % 1) * 360;
      for (var k = 0; k < 5; k++) arc(g, 186 + k * 4, sw - 30 + k * 4, sw, 4, rgba(TEAL, 0.03 + k * 0.02));
    }

    // Mätarnas visare glider mot sina värden.
    if (model.temp !== undefined) {
      var tt = clampT(model.temp);
      needle.temp = needle.temp === null ? TEMP_LO : needle.temp + (tt - needle.temp) * Math.min(1, dt * 2.2);
      var td = tempDeg(needle.temp);
      arc(g, R.gauge, td, 130, 4, rgba(TEAL, 0.8));
      tick(g, R.gauge - 16, R.gauge + 18, td, 2.5, rgba(ICE, 1));
      needleLabel(g, td, deg(model.temp), ICE, 1);
    }
    if (model.match) {
      var days = Math.max(0, Math.min(14, (model.match.start - t) / 86400000));
      needle.match = needle.match === null ? 14 : needle.match + (days - needle.match) * Math.min(1, dt * 2.2);
      var md = matchDeg(needle.match);
      arc(g, R.gauge, 230, md, 4, rgba(AMBER, 0.85));
      tick(g, R.gauge - 16, R.gauge + 18, md, 2.5, rgba(AMBER, 1));
      var left = Math.max(0, model.match.start - t), dl = Math.floor(left / 86400000), hl = Math.floor(left / 3600000) % 24;
      needleLabel(g, md, (dl ? dl + ' D ' : '') + hl + ' H', AMBER, -1);
    }

    // Cykelmätarna: en liten markör som snurrar längs varje skala (dekor).
    for (i = 0; i < 3; i++) {
      var gx = LX + 72 + i * 143, ga = (t / (6000 + i * 2500) % 1) * 360;
      arcAt(g, gx, GAUGE_Y, GAUGE_R + 8, ga, ga + 14, 3, rgba(TEAL, 0.55));
    }

    // Partiklar i lutande banor runt kärnan.
    for (var p = 0; p < particles.length; p++) {
      var pt = particles[p];
      pt.a += pt.v * dt;
      g.fillStyle = rgba(TEAL, pt.o);
      g.fillRect(CX + Math.cos(pt.a) * pt.r - pt.s / 2, CY + Math.sin(pt.a) * pt.r * pt.tilt - pt.s / 2, pt.s, pt.s);
    }

    // Ljuspulser längs ledlinjerna: ut till noderna, och tillbaka när en nod fått nya värden.
    if (boot >= 1 && links.length && Math.random() < dt * 0.8) pulses.push({link: Math.floor(Math.random() * links.length), t: 0});
    for (var u = pulses.length - 1; u >= 0; u--) {
      var pu = pulses[u], ln = links[pu.link];
      pu.t += dt / (pu.strong ? 0.9 : 1.8);
      if (!ln || pu.t >= 1) { pulses.splice(u, 1); continue; }
      var pos = pointOn(ln, pu.back ? 1 - pu.t : pu.t);
      g.fillStyle = rgba(ICE, pu.strong ? 1 : 0.8);
      g.fillRect(pos[0] - (pu.strong ? 3.5 : 2), pos[1] - (pu.strong ? 3.5 : 2), pu.strong ? 7 : 4, pu.strong ? 7 : 4);
    }

    // Dockan: ett svagt svep längs basen.
    if (q.sweep && slots.length) {
      var dx0 = slots[0].x - 40, dx1 = slots[slots.length - 1].x + slots[slots.length - 1].w + 40, sx = dx0 + (t / 7000 % 1) * (dx1 - dx0);
      for (var z = 0; z < 6; z++) { g.fillStyle = rgba(TEAL, 0.05 + z * 0.05); g.fillRect(sx - 60 + z * 10, 1049, 10, 2); }
    }

    // Siktet runt det som har fokus: hörnmarkeringar som andas.
    var f = document.querySelector('#top .focus, #tiles .focus, #home .focus');
    if (f) {
      var fb = rect(f);
      if (fb) {
        var pad = 9 + Math.sin(t / 280) * 3;
        g.strokeStyle = rgba(ICE, 0.95);
        g.lineWidth = 2;
        corners(g, fb.x - pad, fb.y - pad, fb.w + pad * 2, fb.h + pad * 2, 14);
      }
    }
  }

  function rect(e) {
    var r = e.getBoundingClientRect(), s = document.getElementById('stage').getBoundingClientRect(), k = s.width / W;
    if (!r.width) return null;
    return {x: (r.left - s.left) / k, y: (r.top - s.top) / k, w: r.width / k, h: r.height / k};
  }

  function corners(g, x, y, w, h, L) {
    g.beginPath();
    g.moveTo(x, y + L); g.lineTo(x, y); g.lineTo(x + L, y);
    g.moveTo(x + w - L, y); g.lineTo(x + w, y); g.lineTo(x + w, y + L);
    g.moveTo(x + w, y + h - L); g.lineTo(x + w, y + h); g.lineTo(x + w - L, y + h);
    g.moveTo(x + L, y + h); g.lineTo(x, y + h); g.lineTo(x, y + h - L);
    g.stroke();
  }

  // MARK: - Kvalitet: Auto sänker när TV:n inte hinner med, och höjer igen när den gör det

  var LEVELS = {high: {fps: 60, particles: 90, sweep: true}, medium: {fps: 30, particles: 60, sweep: true}, low: {fps: 15, particles: 24, sweep: false}};

  function resize() {
    var s = q.level === 'high' ? Math.min(2, window.devicePixelRatio || 1) : 1;
    if (!stat || s === scale && stat.width === W * s) return;
    scale = s;
    stat.width = dyn.width = W * s;
    stat.height = dyn.height = H * s;
    sctx.setTransform(s, 0, 0, s, 0, 0);
    dctx.setTransform(s, 0, 0, s, 0, 0);
    if (running) drawStatic();
  }

  function setQuality(level) {
    q.level = level || 'auto';
    resize();
    var l = LEVELS[q.level === 'auto' ? 'medium' : q.level] || LEVELS.medium;
    q.fps = l.fps; q.sweep = l.sweep;
    makeParticles(l.particles);
    slow = fast = 0;
    setClass(document.body, 'h4-low', q.level === 'low');
  }

  function adapt(gap) {
    if (q.level !== 'auto' || !gap || gap > 1000) return;
    var budget = 1000 / q.fps;
    if (gap > budget * 1.6) slow++; else slow = Math.max(0, slow - 1);
    if (gap < budget * 1.1) fast++; else fast = 0;
    if (slow > 45 && q.fps > 15) {
      q.fps = q.fps > 30 ? 30 : 15; q.sweep = q.fps > 15; makeParticles(q.fps > 15 ? 60 : 24); slow = 0;
      setClass(document.body, 'h4-low', q.fps <= 15);
    } else if (fast > 900 && q.fps < 30) { q.fps = 30; q.sweep = true; makeParticles(60); fast = 0; setClass(document.body, 'h4-low', false); }
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
      window.FMTV_LOADER ? ['VERSION', FMTV_LOADER.version + '  ·  ' + FMTV_LOADER.commit] : null
    ];
    sys.innerHTML = '';
    var head = el('div', 'head', sys);
    el('span', 'tag', head, 'SYSTEM  ::  HEMMA');
    for (var i = 0; i < rows.length; i++) {
      if (!rows[i]) continue;
      var r = el('div', 'row', sys);
      el('span', 'k', r, rows[i][0]);
      el('span', 'v', r, rows[i][1]);
    }
  }

  // MARK: - Start och stopp

  function build() {
    var sky = document.getElementById('sky'), top = document.getElementById('top');
    if (!sky || !top) return false;
    root = el('div', '', sky);
    root.id = 'holo4';
    buildRings();
    stat = el('canvas', 'h4-static', root);   // över ringarna: mätvärden och etiketter ligger överst
    stat.width = W; stat.height = H;
    sctx = stat.getContext('2d');
    dyn = el('canvas', 'h4-dyn', document.getElementById('home'));
    dyn.width = W; dyn.height = H;
    dctx = dyn.getContext('2d');
    sys = el('div', '', top);
    sys.id = 'h4sys';
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
    setClass(document.body, 'h4-boot', true);
    setTimeout(function () { setClass(document.body, 'h4-boot', false); }, 2800);
    needle.temp = needle.match = null;
    modelKey = '';
    refresh();
    lastFrame = 0;
    if (!raf) raf = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (dctx) dctx.clearRect(0, 0, W, H);
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
    if (typeof Prefs !== 'undefined' && Prefs.holoQuality && (Prefs.holoQuality() !== q.level || !particles.length)) setQuality(Prefs.holoQuality());
    var hidden = paused || document.hidden || (window.Hud && Hud.isOn && Hud.isOn());
    if (on && !hidden) start(); else stop();
  }

  document.addEventListener('visibilitychange', apply);
  // Var 5:e sekund: datan och rutornas lägen (Barça byter sida var 12:e sekund), och om v4 har slagits på.
  setInterval(function () { if (running) refresh(); else if (enabled() && !paused && !document.hidden) apply(); }, 5000);
  setInterval(function () { if (running) { modelKey = ''; refresh(); } }, 60000);
  setTimeout(apply, 600);

  return {apply: apply, refresh: refresh, setQuality: setQuality, isRunning: function () { return running; },
    /** Skärmsläckarna (home.js): motorn vilar medan en av dem täcker startsidan. */
    pause: function (on) { if (paused !== !!on) { paused = !!on; apply(); } },
    /** För tester: läget just nu. */
    debug: function () { return {model: model, links: links.length, slots: slots.length, fps: q.fps, particles: particles.length}; }};
})();
