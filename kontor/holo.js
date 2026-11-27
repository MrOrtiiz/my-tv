/*
 * Kontrollrum v3 – Holographic Interface (bara jobbets TV, Inställningar → Hemskärm → Utseende).
 *
 * En grafikmotor bakom startsidans vanliga rutor. Rutorna (Barça, trafiken, vädret, nedräkningen, apparna, knapparna)
 * är samma som i v2, med samma data och samma fjärrkontroll; holo.css flyttar och klär om dem. Motorn ritar runt dem:
 *
 *   data      Läser bara det som redan finns: Trafik.state(), BarcaBox.next(), Data.weather, Festive.countdown(), klockan.
 *             Inga egna anrop, inga påhittade värden. Saknas något visas inget mätvärde för det.
 *   statiskt  Ett canvas som ritas om när datan ändras: koordinatnät, ledlinjer till rutorna, mätarnas skalor,
 *             dygnsbågen med dagsljuset, veckoringen, nedräkningens tidslinje, temperaturstaplarna.
 *   ringar    Förritade canvas som CSS roterar (billigt för stickan), i olika fart och riktning.
 *   dynamiskt Ett canvas per bildruta: sekundringen, svepet, partiklar i banor, ljuspulser längs ledlinjerna,
 *             mätarnas visare (glider till nya värden) och siktet runt det som har fokus.
 *
 * Dekor ritas svagt och i en mörkare turkos; mätvärden ljust, med etikett. Kvalitet (Hemskärm → Grafik): Auto sänker
 * bildfrekvens och antal partiklar om stickan inte hinner med. Allt stannar när appen inte syns eller en skärmsläckare
 * visas. ES5.
 */
var Holo = (function () {
  'use strict';

  var W = 1920, H = 1080, CX = 960, CY = 392;
  var TEAL = '95, 230, 235', DIM = '40, 120, 130', AMBER = '255, 196, 72', GREEN = '90, 230, 140', RED = '255, 92, 80';
  var LEVEL = {green: GREEN, yellow: AMBER, red: RED};
  var DAYS = ['SÖN', 'MÅN', 'TIS', 'ONS', 'TOR', 'FRE', 'LÖR'];

  var root = null, stat = null, sctx = null, dyn = null, dctx = null, sys = null;
  var running = false, paused = false, raf = 0, lastFrame = 0, bootAt = 0, startedAt = Date.now();
  var model = {}, modelKey = '', links = [], particles = [], pulses = [];
  var needle = {traffic: -1, match: -1};
  var q = {fps: 30, particles: 70, sweep: true, level: 'auto'}, slow = 0, fast = 0, scale = 1;

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
  function enabled() { return typeof Prefs !== 'undefined' && Prefs.look && Prefs.look() === 'v3'; }

  function arc(g, r, from, to, width, color) {
    g.beginPath();
    g.arc(CX, CY, r, rad(from), rad(to));
    g.lineWidth = width;
    g.strokeStyle = color;
    g.stroke();
  }
  function tick(g, r1, r2, deg, width, color) {
    var a = rad(deg);
    g.beginPath();
    g.moveTo(CX + Math.cos(a) * r1, CY + Math.sin(a) * r1);
    g.lineTo(CX + Math.cos(a) * r2, CY + Math.sin(a) * r2);
    g.lineWidth = width;
    g.strokeStyle = color;
    g.stroke();
  }
  function text(g, s, x, y, size, color, align, weight, spacing) {
    g.font = (weight || 600) + ' ' + size + 'px Inter, Helvetica Neue, Arial, sans-serif';
    g.fillStyle = color;
    g.textAlign = align || 'left';
    g.textBaseline = 'middle';
    if (!spacing) { g.fillText(s, x, y); return; }
    // Spärrad text: tecken för tecken (canvas har ingen letter-spacing på äldre WebView).
    var w = 0, i;
    for (i = 0; i < s.length; i++) w += g.measureText(s.charAt(i)).width + spacing;
    w -= spacing;
    var x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    g.textAlign = 'left';
    for (i = 0; i < s.length; i++) { g.fillText(s.charAt(i), x0, y); x0 += g.measureText(s.charAt(i)).width + spacing; }
  }

  // MARK: - Data (bara det som redan finns)

  function readModel() {
    var d = new Date(), m = {};
    m.day = d.getDay();
    m.dayFrac = (d.getHours() * 60 + d.getMinutes()) / 1440;
    var t = window.Trafik && Trafik.state ? Trafik.state() : null;
    if (t) m.traffic = t;
    var w = typeof Data !== 'undefined' && Prefs.weather() ? Data.weather : null;
    if (w && !isNaN(w.temp)) {
      m.temp = w.temp;
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
    if (match) m.match = {start: match.start, title: match.title, competition: match.competition || ''};
    // Nedräkningen (festive.js): "Avengers: Doomsday om 19 dagar", "… i morgon".
    var soon = window.Festive && Festive.countdown ? Festive.countdown() : '';
    var n = /om (\d+) dagar/.exec(soon) || (/i morgon/.test(soon) ? [0, '1'] : null);
    if (soon && n) m.countdown = {days: +n[1], text: soon};
    var apps = document.querySelectorAll('#tiles .tile');
    m.apps = apps ? apps.length : 0;
    return m;
  }

  /** Läser datan; ritar om det statiska lagret och pingar rutor som fått nya värden. */
  function refresh() {
    if (!root) return;
    var m = readModel(), key = JSON.stringify([m.traffic && [m.traffic.min, m.traffic.delay], m.temp, m.rise, m.set,
      m.match && m.match.start, m.countdown && m.countdown.days, m.day, Math.floor(m.dayFrac * 96), m.apps, m.hours && m.hours.length]);
    var old = model;
    model = m;
    if (key === modelKey) return;
    modelKey = key;
    if (old.traffic && m.traffic && old.traffic.min !== m.traffic.min) ping('trafik');
    if (old.temp !== undefined && m.temp !== old.temp) ping('wxtop');
    findLinks();
    drawStatic();
    renderSys();
  }

  /** En ruta som fick nya värden blinkar till, och en puls skickas från kärnan längs dess ledlinje. */
  function ping(id) {
    var e = document.getElementById(id);
    if (!e) return;
    setClass(e, 'holo-ping', true);
    setTimeout(function () { setClass(e, 'holo-ping', false); }, 1200);
    for (var i = 0; i < links.length; i++) if (links[i].id === id) pulses.push({link: i, t: 0, back: true, strong: true});
  }

  // MARK: - Ledlinjer: från kärnans kant ut till varje ruta, raka och vinklade som på en ritning

  function box(id) {
    var e = document.getElementById(id);
    if (!e || !e.offsetWidth || e.style.display === 'none') return null;
    var x = 0, y = 0, n = e;
    while (n && n.id !== 'stage') { x += n.offsetLeft || 0; y += n.offsetTop || 0; n = n.offsetParent; }
    if (id === 'countdown') x -= e.offsetWidth / 2;   // centrerad med translateX(-50%) i holo.css
    return {x: x, y: y, w: e.offsetWidth, h: e.offsetHeight};
  }

  function findLinks() {
    links = [];
    var targets = [['barca', 300, 'left'], ['trafik', 60, 'right'], ['wxtop', 100, 'right'], ['holosys', 240, 'left'], ['countdown', 180, 'down']];
    for (var i = 0; i < targets.length; i++) {
      var b = box(targets[i][0]);
      if (!b) continue;
      var a = rad(targets[i][1]), r = 338, sx = CX + Math.cos(a) * r, sy = CY + Math.sin(a) * r, pts;
      if (targets[i][2] === 'left') { var ex = b.x + b.w + 6, ey = b.y + 34; pts = [[sx, sy], [sx - 40, ey], [ex, ey]]; }
      else if (targets[i][2] === 'right') { var rx = b.x - 6, ry = b.y + 34; pts = [[sx, sy], [sx + 40, ry], [rx, ry]]; }
      else { pts = [[sx, sy], [sx, b.y - 6]]; }
      var len = 0;
      for (var k = 1; k < pts.length; k++) len += Math.abs(pts[k][0] - pts[k - 1][0]) + Math.abs(pts[k][1] - pts[k - 1][1]);
      links.push({id: targets[i][0], pts: pts, len: len});
    }
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
      var seg = Math.abs(p[k][0] - p[k - 1][0]) + Math.abs(p[k][1] - p[k - 1][1]), u = Math.min(1, want / seg);
      g.lineTo(p[k - 1][0] + (p[k][0] - p[k - 1][0]) * u, p[k - 1][1] + (p[k][1] - p[k - 1][1]) * u);
      want -= seg;
    }
    g.lineWidth = 1.5;
    g.strokeStyle = rgba(TEAL, alpha);
    g.stroke();
  }

  // MARK: - Statiska lagret (ritas om när datan ändras)

  function drawStatic() {
    var g = sctx;
    g.clearRect(0, 0, W, H);

    // Koordinatnät och ritningsmarkeringar (dekor, svagt).
    g.fillStyle = rgba(DIM, 0.35);
    for (var x = 40; x < W; x += 80) for (var y = 60; y < H; y += 80) g.fillRect(x, y, 1.5, 1.5);
    g.strokeStyle = rgba(DIM, 0.18);
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(CX - 420, CY); g.lineTo(CX + 420, CY); g.moveTo(CX, CY - 380); g.lineTo(CX, CY + 380); g.stroke();
    for (var k = -10; k <= 10; k++) { g.fillStyle = rgba(DIM, 0.5); g.fillRect(CX + k * 40 - 0.5, CY - 4, 1, 8); g.fillRect(CX - 4, CY + k * 36 - 0.5, 8, 1); }

    // Ledlinjerna och deras ankarpunkter.
    for (var i = 0; i < links.length; i++) {
      drawLink(g, links[i], 1, 0.38);
      var e = links[i].pts[links[i].pts.length - 1], s = links[i].pts[0];
      g.fillStyle = rgba(TEAL, 0.9);
      g.fillRect(e[0] - 3, e[1] - 3, 6, 6);
      g.beginPath(); g.arc(s[0], s[1], 4, 0, Math.PI * 2); g.fill();
    }

    // Dygnsbågen (r 250): hela dygnet runt kärnan, dagsljuset ljusare, nu-markeringen.
    var r = 250;
    arc(g, r, 0, 360, 2, rgba(DIM, 0.5));
    for (var hh = 0; hh < 24; hh++) tick(g, r - (hh % 6 === 0 ? 12 : 6), r, hh * 15, hh % 6 === 0 ? 2 : 1, rgba(TEAL, hh % 6 === 0 ? 0.7 : 0.35));
    if (model.rise !== undefined) {
      arc(g, r, model.rise * 360, model.set * 360, 6, rgba(AMBER, 0.55));   // dagsljuset; tiderna står i systempanelen
    }
    arc(g, r, 0, model.dayFrac * 360, 3, rgba(TEAL, 0.85));
    var na = rad(model.dayFrac * 360);
    g.fillStyle = rgba(TEAL, 1);
    g.beginPath(); g.arc(CX + Math.cos(na) * r, CY + Math.sin(na) * r, 5, 0, Math.PI * 2); g.fill();

    // Veckoringen (r 222): sju fält, i dag ljust.
    for (var dd = 0; dd < 7; dd++) {
      var wd = (dd + 1) % 7, from = dd * (360 / 7) + 2, to = (dd + 1) * (360 / 7) - 2, now = wd === model.day;
      arc(g, 222, from, to, now ? 8 : 4, rgba(now ? TEAL : DIM, now ? 0.95 : 0.55));
      var mid = rad((from + to) / 2);
      text(g, DAYS[wd], CX + Math.cos(mid) * 204, CY + Math.sin(mid) * 204, 12, rgba(TEAL, now ? 1 : 0.45), 'center', 700, 1);
    }

    // Mätarnas skalor: restid hem (höger, 0–40 min) och nästa match (vänster, 0–14 dagar). Visarna ritas per bildruta.
    arc(g, 300, 40, 140, 2, rgba(DIM, 0.6));
    for (var tm = 0; tm <= 40; tm += 5) tick(g, 300, tm % 10 === 0 ? 316 : 309, 40 + tm * 2.5, 1.5, rgba(TEAL, 0.6));
    var tl = model.traffic ? 'HEM  ' + model.traffic.min + ' MIN' : 'HEM  –';
    text(g, tl, CX + Math.cos(rad(34)) * 352, CY + Math.sin(rad(34)) * 352, 15, rgba(model.traffic ? (LEVEL[model.traffic.level] || TEAL) : DIM, 1), 'left', 700, 2);
    text(g, '40 MIN', CX + Math.cos(rad(140)) * 340, CY + Math.sin(rad(140)) * 340, 12, rgba(TEAL, 0.6), 'center', 600, 1);
    arc(g, 300, 220, 320, 2, rgba(DIM, 0.6));
    for (var md = 0; md <= 14; md++) tick(g, 300, md % 7 === 0 ? 316 : 309, 320 - md * (100 / 14), 1.5, rgba(TEAL, 0.6));
    var ml = 'MATCH  –';
    if (model.match) { var left = Math.max(0, model.match.start - Date.now()), dl = Math.floor(left / 86400000), hl = Math.floor(left / 3600000) % 24;
      ml = 'MATCH  ' + (dl ? dl + ' D ' : '') + hl + ' H'; }
    text(g, ml, CX + Math.cos(rad(326)) * 352, CY + Math.sin(rad(326)) * 352, 15, rgba(model.match ? AMBER : DIM, 1), 'right', 700, 2);
    text(g, '14 D', CX + Math.cos(rad(220)) * 336, CY + Math.sin(rad(220)) * 336, 12, rgba(TEAL, 0.6), 'center', 600, 1);

    // Nedräkningens tidslinje under kärnan: 30 fält, de dagar som är kvar lysande (festive.js).
    if (model.countdown) {
      var cd = box('countdown'), cells = 30, cw = 8, gap = 4, total = cells * (cw + gap) - gap;
      var x0 = cd ? cd.x + cd.w + 86 : CX + 280, y0 = cd ? cd.y + cd.h / 2 - 4 : 753;
      for (var c = 0; c < cells; c++) {
        var lit = c < Math.min(cells, model.countdown.days);
        g.fillStyle = lit ? rgba(AMBER, c === 0 ? 0.95 : 0.6) : rgba(DIM, 0.35);
        g.fillRect(x0 + c * (cw + gap), y0, cw, 8);
      }
      text(g, 'T−' + model.countdown.days + ' D', x0 - 14, y0 + 4, 13, rgba(AMBER, 0.9), 'right', 700, 1.5);   // till vänster om fälten
      text(g, '30 D', x0 + total + 14, y0 + 4, 13, rgba(DIM, 0.9), 'left', 700, 1.5);
    }

    // Veckans tidslinje nere till vänster: 7 dagar × 24 timmar, timmarna som gått lysande, nästa match markerad.
    var now = new Date(), wday = (now.getDay() + 6) % 7, hourOfWeek = wday * 24 + now.getHours(), tx = 70, ty = 930, cwk = 2, step = 2.8;
    var wk = window.Hud && Hud.week ? Hud.week(now) : '';
    text(g, 'VECKA ' + wk + '  ::  ' + Math.round(hourOfWeek / 168 * 100) + ' %', tx, ty - 34, 13, rgba(TEAL, 0.8), 'left', 700, 3);
    for (var hw = 0; hw < 168; hw++) {
      g.fillStyle = hw < hourOfWeek ? rgba(TEAL, 0.55) : hw === hourOfWeek ? rgba(TEAL, 1) : rgba(DIM, 0.35);
      g.fillRect(tx + hw * step, ty - (hw % 24 === 0 ? 10 : 0), cwk, hw % 24 === 0 ? 26 : 16);
    }
    for (var dn = 0; dn < 7; dn++) text(g, DAYS[(dn + 1) % 7], tx + dn * 24 * step + 2, ty + 32, 12, rgba(TEAL, dn === wday ? 1 : 0.45), 'left', 700, 1);
    if (model.match) {
      var monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - wday).getTime(), mh = Math.floor((model.match.start - monday) / 3600000);
      if (mh >= 0 && mh < 168) {
        g.fillStyle = rgba(AMBER, 1);
        g.fillRect(tx + mh * step - 2, ty - 16, 6, 38);
        text(g, 'MATCH', tx + mh * step + 8, ty - 14, 11, rgba(AMBER, 1), 'left', 700, 1);
      }
    }

    // Temperaturen de närmaste timmarna (Data.weather.hours): staplar till höger.
    if (model.hours && model.hours.length) {
      var bx = 1440, by = 1000, bw = 46, maxT = -99, minT = 99, hi;
      for (hi = 0; hi < model.hours.length; hi++) { maxT = Math.max(maxT, model.hours[hi].temp); minT = Math.min(minT, model.hours[hi].temp); }
      if (model.temp !== undefined) { maxT = Math.max(maxT, model.temp); minT = Math.min(minT, model.temp); }
      var span = Math.max(4, maxT - minT);
      text(g, 'TEMP  ::  ' + model.hours.length + ' H', bx, by - 128, 13, rgba(TEAL, 0.8), 'left', 700, 3);
      for (hi = 0; hi < model.hours.length; hi++) {
        var hv = model.hours[hi], bh = 18 + (hv.temp - minT) / span * 70, xx = bx + hi * (bw + 26);
        g.fillStyle = rgba(TEAL, 0.18);
        g.fillRect(xx, by - 100, bw, 100);
        g.fillStyle = rgba(TEAL, 0.75);
        g.fillRect(xx, by - bh, bw, bh);
        text(g, Math.round(hv.temp) + '°', xx + bw / 2, by - bh - 14, 14, rgba(TEAL, 1), 'center', 600);
        text(g, two(new Date(hv.at).getHours()), xx + bw / 2, by + 16, 12, rgba(TEAL, 0.6), 'center', 600, 1);
      }
    }
  }

  // MARK: - Ringarna (förritade, roteras av CSS)

  function ringLayer(cls, size, draw) {
    var c = el('canvas', 'holo-ring ' + cls, root);
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
    // Yttersta: segmenterad, med luckor och små block.
    ringLayer('r-outer', 760, function (g) {
      var parts = [[8, 70], [86, 94], [110, 168], [192, 250], [262, 268], [284, 352]];
      for (var i = 0; i < parts.length; i++) arc(g, 368, parts[i][0], parts[i][1], 2, rgba(TEAL, 0.55));
      for (var j = 0; j < 12; j++) arc(g, 358, 20 + j * 30, 23 + j * 30, 9, rgba(TEAL, 0.5));
      for (var k = 0; k < 8; k++) arc(g, 376, 120 + k * 2.4, 121.3 + k * 2.4, 10, rgba(TEAL, 0.45));
    });
    // Mellanring: fina skalstreck var 2:a grad.
    ringLayer('r-scale', 720, function (g) {
      for (var i = 0; i < 180; i++) tick(g, 342, i % 5 === 0 ? 352 : 347, i * 2, 1, rgba(DIM, i % 5 === 0 ? 0.9 : 0.55));
    });
    // Inre: tunna bågar och prickar runt klockan.
    ringLayer('r-inner', 420, function (g) {
      arc(g, 180, 0, 360, 1, rgba(DIM, 0.6));
      arc(g, 172, 30, 150, 2, rgba(TEAL, 0.5));
      arc(g, 172, 210, 330, 2, rgba(TEAL, 0.5));
      for (var i = 0; i < 36; i++) { var a = rad(i * 10); g.fillStyle = rgba(TEAL, i % 3 ? 0.35 : 0.8); g.fillRect(CX + Math.cos(a) * 192 - 1, CY + Math.sin(a) * 192 - 1, 2.5, 2.5); }
    });
    // Hexmönster längs en bana (dekor).
    ringLayer('r-hex', 860, function (g) {
      g.strokeStyle = rgba(DIM, 0.45);
      g.lineWidth = 1;
      for (var i = 0; i < 48; i++) {
        if (i % 4 === 3) continue;
        var a = rad(i * 7.5), x = CX + Math.cos(a) * 408, y = CY + Math.sin(a) * 408;
        g.beginPath();
        for (var s = 0; s < 6; s++) { var b = s * Math.PI / 3; g.lineTo(x + Math.cos(b) * 7, y + Math.sin(b) * 7); }
        g.closePath();
        g.stroke();
      }
    });
  }

  // MARK: - Dynamiska lagret (per bildruta)

  function makeParticles(n) {
    particles = [];
    for (var i = 0; i < n; i++) {
      particles.push({r: 380 + Math.random() * 120, tilt: 0.55 + Math.random() * 0.4, a: Math.random() * Math.PI * 2,
        v: (Math.random() < 0.5 ? -1 : 1) * (0.02 + Math.random() * 0.05), s: 1 + Math.random() * 1.6, o: 0.25 + Math.random() * 0.5});
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

    var g = dctx, t = Date.now(), boot = Math.min(1, (t - bootAt) / 2600);
    g.clearRect(0, 0, W, H);

    // Uppstart: ledlinjerna ritas ut från kärnan, kärnan tänds.
    if (boot < 1) {
      for (var b = 0; b < links.length; b++) drawLink(g, links[b], Math.max(0, Math.min(1, boot * 1.6 - b * 0.12)), 0.9);
      arc(g, 120 + boot * 260, 0, 360, 2, rgba(TEAL, (1 - boot) * 0.8));
    }

    // Sekundringen (r 270): 60 fält, sekunderna som gått i minuten lyser, den aktuella starkast.
    var d = new Date(t), sec = d.getSeconds() + d.getMilliseconds() / 1000;
    for (var s = 0; s < 60; s++) {
      var on = s < sec, cur = s === Math.floor(sec);
      arc(g, 270, s * 6 + 0.8, s * 6 + 5.2, cur ? 9 : 5, rgba(TEAL, cur ? 1 : on ? 0.5 : 0.12));
    }

    // Svepet: en ljuskil som går runt kärnan (dekor).
    if (q.sweep) {
      var sw = (t / 9000 % 1) * 360;
      for (var k = 0; k < 6; k++) arc(g, 150 + k * 14, sw - 26 + k * 2, sw, 10, rgba(TEAL, 0.035 + k * 0.012));
    }

    // Mätarnas visare glider mot sina värden.
    if (model.traffic) {
      var target = Math.min(40, model.traffic.min);
      needle.traffic = needle.traffic < 0 ? 0 : needle.traffic + (target - needle.traffic) * Math.min(1, dt * 2.5);
      var col = LEVEL[model.traffic.level] || TEAL, deg = 40 + needle.traffic * 2.5;
      arc(g, 300, 40, deg, 5, rgba(col, 0.85));
      var free = Math.max(0, Math.min(40, model.traffic.min - model.traffic.delay));
      tick(g, 290, 322, 40 + free * 2.5, 1.5, rgba(TEAL, 0.6));   // utan kö
      tick(g, 284, 330, deg, 3, rgba(col, 1));
    }
    if (model.match) {
      var days = Math.max(0, Math.min(14, (model.match.start - t) / 86400000));
      needle.match = needle.match < 0 ? 14 : needle.match + (days - needle.match) * Math.min(1, dt * 2.5);
      var md = 320 - needle.match * (100 / 14);
      arc(g, 300, md, 320, 5, rgba(AMBER, 0.85));
      tick(g, 284, 330, md, 3, rgba(AMBER, 1));
    }

    // Partiklar i lutande banor runt kärnan.
    for (var p = 0; p < particles.length; p++) {
      var pt = particles[p];
      pt.a += pt.v * dt;
      g.fillStyle = rgba(TEAL, pt.o);
      g.fillRect(CX + Math.cos(pt.a) * pt.r - pt.s / 2, CY + Math.sin(pt.a) * pt.r * pt.tilt - pt.s / 2, pt.s, pt.s);
    }

    // Ljuspulser längs ledlinjerna: ut till rutorna, och tillbaka när en ruta fått nya värden.
    if (boot >= 1 && links.length && Math.random() < dt * 0.9) pulses.push({link: Math.floor(Math.random() * links.length), t: 0});
    for (var u = pulses.length - 1; u >= 0; u--) {
      var pu = pulses[u], ln = links[pu.link];
      pu.t += dt / (pu.strong ? 0.9 : 1.6);
      if (!ln || pu.t >= 1) { pulses.splice(u, 1); continue; }
      var pos = pointOn(ln, pu.back ? 1 - pu.t : pu.t);
      g.fillStyle = rgba(TEAL, pu.strong ? 1 : 0.85);
      g.fillRect(pos[0] - (pu.strong ? 4 : 2.5), pos[1] - (pu.strong ? 4 : 2.5), pu.strong ? 8 : 5, pu.strong ? 8 : 5);
    }

    // Siktet runt det som har fokus: hörnmarkeringar som andas.
    var f = document.querySelector('#top .focus, #tiles .focus, #home .focus');
    if (f) {
      var fb = rect(f);
      if (fb) {
        var pad = 10 + Math.sin(t / 260) * 3, L = 16;
        g.strokeStyle = rgba(TEAL, 0.95);
        g.lineWidth = 2;
        corners(g, fb.x - pad, fb.y - pad, fb.w + pad * 2, fb.h + pad * 2, L);
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

  // MARK: - Kvalitet: Auto sänker när stickan inte hinner med, och höjer igen när den gör det

  var LEVELS = {high: {fps: 60, particles: 110, sweep: true}, medium: {fps: 30, particles: 70, sweep: true}, low: {fps: 15, particles: 30, sweep: false}};

  /** Grafik Hög på en 4K-skärm: de två stora canvas ritas i skärmens upplösning (skarpare linjer, mer minne). */
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
    setClass(document.body, 'holo-low', q.level === 'low');
  }

  function adapt(gap) {
    if (q.level !== 'auto' || !gap || gap > 1000) return;
    var budget = 1000 / q.fps;
    if (gap > budget * 1.6) slow++; else slow = Math.max(0, slow - 1);
    if (gap < budget * 1.1) fast++; else fast = 0;
    if (slow > 45 && q.fps > 15) {   // flera sekunder för långsamt: ett steg ner
      q.fps = q.fps > 30 ? 30 : 15; q.sweep = q.fps > 15; makeParticles(q.fps > 15 ? 70 : 30); slow = 0;
      setClass(document.body, 'holo-low', q.fps <= 15);
    } else if (fast > 900 && q.fps < 30) { q.fps = 30; q.sweep = true; makeParticles(70); fast = 0; setClass(document.body, 'holo-low', false); }
  }

  // MARK: - Systempanelen (riktiga värden från appen och vädret)

  function renderSys() {
    if (!sys) return;
    var d = new Date(), start = new Date(d.getFullYear(), 0, 1), doy = Math.floor((d - start) / 86400000) + 1;
    var leap = new Date(d.getFullYear(), 1, 29).getMonth() === 1, len = leap ? 366 : 365, up = Math.floor((Date.now() - startedAt) / 60000);
    var rows = [
      ['DAG', doy + ' / ' + len],
      ['ÅRET', (doy / len * 100).toFixed(1).replace('.', ',') + ' %'],
      model.riseAt ? ['DAGSLJUS', Math.floor((model.setAt - model.riseAt) / 3600000) + ' H ' + two(Math.round((model.setAt - model.riseAt) / 60000) % 60) + ' MIN'] : null,
      model.riseAt ? ['SOL', hm(model.riseAt) + ' – ' + hm(model.setAt)] : null,
      ['FAVORITER', model.apps + ' APPAR'],
      ['UPPTID', Math.floor(up / 60) + ' H ' + two(up % 60) + ' MIN'],
      window.FMTV_LOADER ? ['VERSION', FMTV_LOADER.version + '  ·  ' + FMTV_LOADER.commit] : null
    ];
    sys.innerHTML = '';
    el('div', 'head', sys, 'SYSTEM  ::  KONTOR');
    for (var i = 0; i < rows.length; i++) {
      if (!rows[i]) continue;
      var r = el('div', 'row', sys);
      el('span', 'k', r, rows[i][0]);
      el('span', 'sep', r, '::');
      el('span', 'v', r, rows[i][1]);
    }
  }

  // MARK: - Start och stopp

  function build() {
    var sky = document.getElementById('sky'), top = document.getElementById('top');
    if (!sky || !top) return false;
    root = el('div', '', sky);
    root.id = 'holo';
    stat = el('canvas', 'holo-static', root);
    stat.width = W; stat.height = H;
    sctx = stat.getContext('2d');
    buildRings();
    dyn = el('canvas', 'holo-dyn', document.getElementById('home'));
    dyn.width = W; dyn.height = H;
    dctx = dyn.getContext('2d');
    sys = el('div', '', top);
    sys.id = 'holosys';
    return true;
  }

  function start() {
    if (running) return;
    if (!root && !build()) return;
    resize();
    running = true;
    bootAt = Date.now();
    setClass(document.body, 'holo-boot', true);
    setTimeout(function () { setClass(document.body, 'holo-boot', false); }, 2800);
    needle.traffic = needle.match = -1;
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

  /** Följer inställningen och läget: på i v3 när startsidan syns, av annars. */
  function apply() {
    var v3 = enabled();
    setClass(document.body, 'v3', v3);
    if (typeof Prefs !== 'undefined' && Prefs.holoQuality && (Prefs.holoQuality() !== q.level || !particles.length)) setQuality(Prefs.holoQuality());
    var hidden = paused || document.hidden || (window.Hud && Hud.isOn && Hud.isOn());
    if (v3 && !hidden) start(); else stop();
  }

  document.addEventListener('visibilitychange', apply);
  setInterval(function () { if (running) refresh(); else if (enabled() && !paused && !document.hidden && !(window.Hud && Hud.isOn())) apply(); }, 5000);
  setInterval(function () { if (running) { refresh(); renderSys(); } }, 60000);
  setTimeout(apply, 600);

  return {apply: apply, refresh: refresh, setQuality: setQuality, isRunning: function () { return running; },
    /** Skärmsläckarna (home.js): motorn vilar medan en av dem täcker startsidan. */
    pause: function (on) { if (paused !== !!on) { paused = !!on; apply(); } },
    /** För tester: läget just nu. */
    debug: function () { return {model: model, links: links.length, fps: q.fps, particles: particles.length}; }};
})();
