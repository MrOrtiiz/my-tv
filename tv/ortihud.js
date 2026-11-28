/*
 * O.R.T.I. – skärmsläckaren hemma: lagret med 3D-kärnan (orti3d.js) och informationen ovanpå (orti3d.css).
 * Två varianter: 'orti' (reaktorn) och 'neural' (O.R.T.I. – Neural Intelligence: hjärnan i mitten, analytiska
 * paneler till vänster, färgstänket till höger). Mätarna visar riktiga värden; nätverket och signalen är utsmyckning.
 *
 * home.js visar den efter vald tid utan knapptryck (Inställningar → Hemskärm → Skärmsläckare: O.R.T.I.), eller direkt
 * med "Visa O.R.T.I. nu". Allt som visas är riktiga värden från appen: tiden, vädret (nu, timmar, dagar, solen),
 * veckan och dygnet. Siffrorna längs kanterna är utsmyckning och utger sig inte för att vara mätvärden.
 *
 * Lägen (OrtiSaver.state): idle, listening, thinking, speaking, success, alert. Hemma finns ingen röst, så de som
 * används nu är idle, success (när vädret har uppdaterats) och alert (utan internet). OrtiSaver.level(0–1) tar
 * ljudnivån för speaking, när en röst finns.
 */
var OrtiSaver = (function () {
  'use strict';

  var DAYS = ['SÖNDAG', 'MÅNDAG', 'TISDAG', 'ONSDAG', 'TORSDAG', 'FREDAG', 'LÖRDAG'];
  var DAY3 = ['SÖN', 'MÅN', 'TIS', 'ONS', 'TOR', 'FRE', 'LÖR'];
  var MONTHS = ['JANUARI', 'FEBRUARI', 'MARS', 'APRIL', 'MAJ', 'JUNI', 'JULI', 'AUGUSTI', 'SEPTEMBER', 'OKTOBER', 'NOVEMBER', 'DECEMBER'];
  var STATE_NAME = {idle: 'VILOLÄGE', listening: 'LYSSNAR', thinking: 'BEARBETAR', speaking: 'TALAR', success: 'KLART', alert: 'VARNING'};
  // Neural Intelligence: briefens fyra lägen (standby är idle), plus de två som appen redan använder
  var NEURAL_NAME = {idle: 'STANDBY MODE', listening: 'LISTENING', thinking: 'THINKING', speaking: 'SPEAKING', success: 'DATA UPDATED', alert: 'OFFLINE'};

  var layer = null, canvas = null, hud = null, scene = null, on = false, timer = 0, dataTimer = 0, killTimer = 0;
  var supportedCache = null, els = {}, stateNow = 'idle', mode = 'orti', built = '', ana = null, anaTimer = 0, anaT = 0, speakLevel = 0;

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, parent, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  function two(n) { return (n < 10 ? '0' : '') + n; }
  function hm(ms) { var d = new Date(ms); return two(d.getHours()) + ':' + two(d.getMinutes()); }
  function deg(v) { return typeof Data !== 'undefined' && Data.degrees ? Data.degrees(v) : Math.round(v) + '°'; }
  function week(d) {
    var t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())), day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
  }
  function pref(k, d) { return typeof Prefs !== 'undefined' && Prefs.o3 ? Prefs.o3(k, d) : d; }
  function cond(code, day) { return typeof Data !== 'undefined' && Data.condition ? String(Data.condition(code, day !== false)).toUpperCase() : ''; }

  // MARK: - Lagret

  function build() {
    var stage = $('stage') || document.body;
    if (layer && layer.parentNode) layer.parentNode.removeChild(layer);
    els = {}; ana = null;
    layer = el('div', mode === 'neural' ? 'o3-neural' : '', stage);
    layer.id = 'ortisaver';
    canvas = el('canvas', 'o3-gl', layer);
    var frame = el('canvas', 'o3-frame', layer);
    frame.width = 1920; frame.height = 1080;
    hud = el('div', 'o3-hud', layer);
    drawFrame(frame.getContext('2d'), mode === 'neural');
    if (mode === 'neural') buildNeural(); else buildHud();
    built = mode;
  }

  /** Ramen: hårfina linjer, notchar, skalor och små cirklar (utsmyckning). */
  function drawFrame(g, neural) {
    var W = 1920, H = 1080, i;
    function ln(x1, y1, x2, y2, a) { g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.lineWidth = 1; g.strokeStyle = 'rgba(0, 207, 255, ' + a + ')'; g.stroke(); }
    ln(48, 40, 820, 40, 0.45); ln(820, 40, 838, 30, 0.45); ln(838, 30, 1082, 30, 0.45); ln(1082, 30, 1100, 40, 0.45); ln(1100, 40, W - 48, 40, 0.45);
    ln(48, H - 36, 860, H - 36, 0.4); ln(860, H - 36, 878, H - 26, 0.4); ln(878, H - 26, 1042, H - 26, 0.4); ln(1042, H - 26, 1060, H - 36, 0.4); ln(1060, H - 36, W - 48, H - 36, 0.4);
    ln(48, 40, 48, H - 36, 0.3); ln(W - 48, 40, W - 48, H - 36, 0.3);
    ln(62, 90, 62, H - 90, 0.12); ln(W - 62, 90, W - 62, H - 90, 0.12);
    for (i = 0; i <= 40; i++) {   // skalor längs sidorna
      var y = 120 + i * 21, big = i % 5 === 0;
      ln(48, y, 48 + (big ? 12 : 6), y, big ? 0.55 : 0.25);
      ln(W - 48, y, W - 48 - (big ? 12 : 6), y, big ? 0.55 : 0.25);
    }
    for (i = 0; i < 64; i++) { g.fillStyle = 'rgba(0, 207, 255, ' + (0.12 + (i % 4) * 0.06) + ')'; g.fillRect(120 + i * 10, H - 31, 6, 2); g.fillRect(1180 + i * 10, H - 31, 6, 2); }
    var rings = neural ? [] : [[W - 120, 540], [120, 540]];
    for (i = 0; i < rings.length; i++) {
      g.beginPath(); g.arc(rings[i][0], rings[i][1], 16, 0, Math.PI * 2); g.lineWidth = 1.5; g.strokeStyle = 'rgba(0, 207, 255, 0.4)'; g.stroke();
      g.beginPath(); g.arc(rings[i][0], rings[i][1], 22, -0.6, 1.4); g.lineWidth = 1; g.strokeStyle = 'rgba(220, 234, 242, 0.35)'; g.stroke();
    }
  }

  function block(x, y, w, title, parent) {
    var b = el('div', 'o3-block', parent || hud);
    b.style.left = x + 'px'; b.style.top = y + 'px'; b.style.width = w + 'px';
    el('div', 'o3-title', b, title);
    el('div', 'o3-rule', b);
    return el('div', 'o3-body', b);
  }

  function buildHud() {
    // Namnet (diskret, överst i mitten, inte över kärnan) och läget
    els.name = el('div', 'o3-name', hud, 'O.R.T.I.');
    els.state = el('div', 'o3-state', hud, 'VILOLÄGE');
    // Övre vänstra hörnet: tiden, datumet, veckodagen, veckan
    els.time = el('div', 'o3-time', hud);
    els.date = el('div', 'o3-date', hud);
    els.week = el('div', 'o3-weekno', hud);
    // Övre delen: vädret nu, timmar, dagar, solen
    els.panels = el('div', 'o3-panels', hud);
    els.now = block(650, 92, 190, 'UTE', els.panels);
    els.hours = block(880, 92, 380, 'TIMMAR', els.panels);
    els.days = block(1300, 92, 290, 'KOMMANDE DAGAR', els.panels);
    els.sun = block(1630, 92, 230, 'SOLEN', els.panels);
    // Nedre delen: veckan, dygnet, 12 timmar
    els.weekBars = block(80, 836, 400, 'VECKAN', els.panels);
    els.day = block(560, 836, 560, 'DYGNET', els.panels);
    els.temps = block(1220, 836, 620, 'TEMPERATUR 12 H', els.panels);
    // Kanternas tekniska detaljer (koordinaterna är riktiga, referensnumren utsmyckning)
    els.coord = el('div', 'o3-edge o3-coord', hud);
    els.ref = el('div', 'o3-edge o3-ref', hud, 'REF 0721-48 · NEURAL STRUKTUR');
  }

  // MARK: - Neural Intelligence: vänster analytisk, höger kreativ, hjärnan i mitten

  function buildNeural() {
    // Överst i mitten: namnet, systemet och läget
    els.name = el('div', 'o3-name', hud, 'O.R.T.I.');
    els.sys = el('div', 'n3-sys', hud, 'NEURAL INTELLIGENCE SYSTEM');
    els.state = el('div', 'o3-state n3-state', hud, 'STANDBY MODE');
    // Under hjärnan: de två halvornas namn, med en tunn linje upp mot dem
    el('div', 'n3-core left', hud, 'ANALYTICAL CORE');
    el('div', 'n3-core right', hud, 'CREATIVE CORE');
    // Vänster: tiden och de analytiska panelerna (riktiga värden i text, animationerna är utsmyckning)
    els.time = el('div', 'o3-time', hud);
    els.date = el('div', 'o3-date', hud);
    els.week = el('div', 'o3-weekno', hud);
    els.panels = el('div', 'o3-panels', hud);
    var c = el('canvas', 'n3-ana', els.panels);
    var dpr = stageScale();
    c.width = Math.round(470 * dpr); c.height = Math.round(640 * dpr);
    ana = {c: c, g: c.getContext('2d'), dpr: dpr, nodes: netNodes()};
    els.now = block(92, 322, 200, 'UTE', els.panels);
    els.gDay = el('div', 'n3-gauge', els.panels); els.gDay.style.left = '92px'; els.gDay.style.top = '470px';
    els.gWeek = el('div', 'n3-gauge', els.panels); els.gWeek.style.left = '252px'; els.gWeek.style.top = '470px';
    els.gSun = el('div', 'n3-gauge', els.panels); els.gSun.style.left = '412px'; els.gSun.style.top = '470px';
    block(92, 660, 470, 'NEURALT NÄT', els.panels);
    block(92, 846, 470, 'SIGNAL', els.panels);
    // Höger: få, lugna rader (stänket får ytan)
    els.days = block(1530, 322, 300, 'KOMMANDE DAGAR', els.panels);
    els.sun = block(1530, 846, 300, 'SOLEN', els.panels);
    els.days.parentNode.className += ' n3-right';
    els.sun.parentNode.className += ' n3-right';
    els.coord = el('div', 'o3-edge o3-coord', hud);
    els.ref = el('div', 'o3-edge o3-ref', hud, 'ANALYTICAL · CREATIVE · SYNC');
  }

  function stageScale() {
    var st = $('stage');
    var w = st && st.getBoundingClientRect ? st.getBoundingClientRect().width : 1920;
    return Math.max(1, Math.min(2, w / 1920));
  }

  /** Nätverkets noder (utsmyckning): fast mönster, så att det inte hoppar mellan visningarna. */
  function netNodes() {
    var n = [], s = 41;
    function r() { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }
    var cols = [3, 5, 6, 5, 3];
    for (var i = 0; i < cols.length; i++) {
      for (var j = 0; j < cols[i]; j++) n.push({x: 12 + i * 108, y: 22 + (j + 0.5) * (120 / cols[i]), l: i, ph: r() * 6.28});
    }
    return n;
  }

  /** Mätarna (riktiga värden): dygnet, veckan och dagsljuset som har gått. */
  function renderGauges(d) {
    if (!els.gDay) return;
    var mins = d.getHours() * 60 + d.getMinutes(), wd = (d.getDay() + 6) % 7;
    var day = mins / 1440, wk = (wd + day) / 7, w = Prefs.weather() ? Data.weather : null, sun = null;
    if (w && w.sunrise && w.sunset) sun = Math.max(0, Math.min(1, (d.getTime() - w.sunrise) / (w.sunset - w.sunrise)));
    els.gDay.innerHTML = '<b>' + Math.round(day * 100) + '<i>%</i></b><span>DYGNET</span>';
    els.gWeek.innerHTML = '<b>' + Math.round(wk * 100) + '<i>%</i></b><span>VECKAN</span>';
    els.gSun.innerHTML = sun === null ? '<b>–</b><span>DAGSLJUS</span>' : '<b>' + Math.round(sun * 100) + '<i>%</i></b><span>DAGSLJUS</span>';
    ana.vals = [day, wk, sun === null ? 0 : sun];
  }

  /** De animerade panelerna till vänster: mätarnas ringar, nätverket, signalen och en svepande linje. */
  function drawAna() {
    if (!ana || !on) return;
    var g = ana.g, k = ana.dpr, t = anaT, i, j, vals = ana.vals || [0, 0, 0];
    var sp = stateNow === 'thinking' ? 2.4 : stateNow === 'listening' ? 1.5 : 1;
    g.setTransform(k, 0, 0, k, 0, 0);
    g.clearRect(0, 0, 470, 640);
    // Canvasens origo är (92, 450) på skärmen
    // Mätarna: ring med värdet, roterande skala utanför
    for (i = 0; i < 3; i++) {
      var cx = 64 + i * 160, cy = 84, R = 54;
      g.lineWidth = 1; g.strokeStyle = 'rgba(0, 157, 255, 0.18)';
      g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
      g.lineWidth = 3; g.strokeStyle = i === 2 ? 'rgba(232, 185, 78, 0.95)' : 'rgba(0, 207, 255, 0.95)';
      g.beginPath(); g.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + vals[i] * Math.PI * 2); g.stroke();
      var rot = t * 0.25 * (i % 2 ? -1 : 1) * sp;
      g.lineWidth = 1;
      for (j = 0; j < 48; j++) {
        var a = rot + j / 48 * Math.PI * 2, big = j % 6 === 0, r1 = R + 7, r2 = R + (big ? 14 : 10);
        g.strokeStyle = 'rgba(220, 234, 242, ' + (big ? 0.4 : 0.14) + ')';
        g.beginPath(); g.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); g.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2); g.stroke();
      }
      g.strokeStyle = 'rgba(0, 207, 255, 0.35)';
      g.beginPath(); g.arc(cx, cy, R - 9, rot * 1.7, rot * 1.7 + 0.9); g.stroke();
    }
    // Nätverket (y 250–380): noder i lager, kanter mellan lagren, pulser som vandrar åt höger
    var N = ana.nodes, oy = 250;
    for (i = 0; i < N.length; i++) for (j = 0; j < N.length; j++) {
      if (N[j].l !== N[i].l + 1) continue;
      var w = 0.5 + 0.5 * Math.sin(t * 0.6 * sp + N[i].ph + N[j].ph);
      g.strokeStyle = 'rgba(0, 207, 255, ' + (0.05 + w * 0.14) + ')'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(N[i].x, oy + N[i].y); g.lineTo(N[j].x, oy + N[j].y); g.stroke();
      var u = (t * 0.35 * sp + N[i].ph * 0.3 + N[j].ph * 0.2) % 1;
      if (w > 0.82) {
        g.fillStyle = 'rgba(220, 245, 255, ' + (0.9 * Math.sin(u * Math.PI)) + ')';
        g.fillRect(N[i].x + (N[j].x - N[i].x) * u - 1.5, oy + N[i].y + (N[j].y - N[i].y) * u - 1.5, 3, 3);
      }
    }
    for (i = 0; i < N.length; i++) {
      var on2 = 0.5 + 0.5 * Math.sin(t * 0.9 * sp + N[i].ph);
      g.fillStyle = 'rgba(0, 0, 0, 1)'; g.strokeStyle = 'rgba(0, 207, 255, ' + (0.45 + on2 * 0.5) + ')'; g.lineWidth = 1.5;
      g.beginPath(); g.arc(N[i].x, oy + N[i].y, 4, 0, Math.PI * 2); g.fill(); g.stroke();
      if (on2 > 0.85) { g.fillStyle = 'rgba(220, 245, 255, 0.9)'; g.beginPath(); g.arc(N[i].x, oy + N[i].y, 1.8, 0, Math.PI * 2); g.fill(); }
    }
    // Signalen (y 440–540): tre vågor som rullar, och ett rutnät
    oy = 490;
    g.strokeStyle = 'rgba(0, 157, 255, 0.12)'; g.lineWidth = 1;
    for (i = 0; i <= 10; i++) { g.beginPath(); g.moveTo(i * 47, oy - 40); g.lineTo(i * 47, oy + 40); g.stroke(); }
    g.beginPath(); g.moveTo(0, oy); g.lineTo(470, oy); g.stroke();
    var amp = 1 + (stateNow === 'speaking' ? speakLevel * 2.5 : 0);
    var waves = [[0.045, 1.3, 22, 'rgba(0, 207, 255, 0.9)'], [0.021, -0.8, 14, 'rgba(220, 234, 242, 0.45)'], [0.09, 2.1, 7, 'rgba(0, 157, 255, 0.55)']];
    for (j = 0; j < waves.length; j++) {
      g.strokeStyle = waves[j][3]; g.lineWidth = j ? 1 : 1.5; g.beginPath();
      for (i = 0; i <= 470; i += 4) {
        var env = Math.sin(i / 470 * Math.PI);
        var y = oy + Math.sin(i * waves[j][0] + t * waves[j][1] * sp) * waves[j][2] * env * amp * (0.75 + 0.25 * Math.sin(t * 0.4 + j));
        if (i) g.lineTo(i, y); else g.moveTo(i, y);
      }
      g.stroke();
    }
    // Den svepande linjen över hela kolumnen
    var sy = (t * 40 * sp) % 760 - 60;
    var gr = g.createLinearGradient(0, sy - 30, 0, sy);
    gr.addColorStop(0, 'rgba(0, 207, 255, 0)'); gr.addColorStop(1, 'rgba(0, 207, 255, 0.035)');
    g.fillStyle = gr; g.fillRect(0, sy - 30, 470, 30);
    g.fillStyle = 'rgba(0, 207, 255, 0.18)'; g.fillRect(0, sy, 470, 1);
  }

  function anaLoop() {
    clearInterval(anaTimer);
    var last = Date.now();
    anaTimer = setInterval(function () {
      if (!on || document.hidden) return;
      var now = Date.now();
      anaT += Math.min(0.2, (now - last) / 1000) * pref('speed', 1) * (isNight() ? 0.6 : 1);
      last = now;
      drawAna();
    }, 1000 / 15);
  }

  // MARK: - Data

  function renderClock() {
    var d = new Date();
    els.time.textContent = two(d.getHours()) + ':' + two(d.getMinutes());
    els.date.textContent = DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
    els.week.textContent = 'VECKA ' + week(d);
    if (mode === 'neural') { renderGauges(d); return; }
    renderWeek(d);
    renderDay(d);
  }

  function renderWeek(d) {
    var html = '', wd = (d.getDay() + 6) % 7, frac = (d.getHours() * 60 + d.getMinutes()) / 1440;
    for (var i = 0; i < 7; i++) {
      var f = i < wd ? 1 : i === wd ? frac : 0;
      html += '<div class="o3-wrow' + (i === wd ? ' now' : '') + '"><span>' + DAY3[(i + 1) % 7] + '</span><i><b style="width:' + (f * 100).toFixed(1) +
        '%"></b></i><em>' + Math.round(f * 100) + ' %</em></div>';
    }
    els.weekBars.innerHTML = html;
  }

  function renderDay(d) {
    var w = Prefs.weather() ? Data.weather : null, frac = (d.getHours() * 60 + d.getMinutes()) / 1440, html = '<div class="o3-line">';
    if (w && w.sunrise && w.sunset) {
      var r = new Date(w.sunrise), s = new Date(w.sunset);
      var a = (r.getHours() * 60 + r.getMinutes()) / 1440, b = (s.getHours() * 60 + s.getMinutes()) / 1440;
      html += '<div class="o3-daylight" style="left:' + (a * 100) + '%;width:' + ((b - a) * 100) + '%"></div>';
    }
    for (var h = 0; h <= 24; h++) html += '<div class="o3-tick' + (h % 6 ? '' : ' big') + '" style="left:' + (h / 24 * 100) + '%"></div>' +
      (h % 6 ? '' : '<div class="o3-tlab" style="left:' + (h / 24 * 100) + '%">' + two(h) + '</div>');
    html += '<div class="o3-past" style="width:' + (frac * 100) + '%"></div><div class="o3-nowdot" style="left:' + (frac * 100) + '%"></div></div>';
    var left = 1440 - (d.getHours() * 60 + d.getMinutes());
    html += '<div class="o3-kv"><span>NU <b>' + hm(d.getTime()) + '</b></span><span>KVAR AV DYGNET <b>' + Math.floor(left / 60) + ' H ' + two(left % 60) + ' MIN</b></span>' +
      (w && w.sunrise ? '<span>LJUST <b>' + hm(w.sunrise) + '–' + hm(w.sunset) + '</b></span>' : '') + '</div>';
    els.day.innerHTML = html;
  }

  function renderWeather() {
    var w = Prefs.weather() ? Data.weather : null, i, html;
    if (!w || isNaN(w.temp)) {
      els.now.innerHTML = '<div class="o3-muted">INGET VÄDER ÄN</div>';
      els.days.innerHTML = els.sun.innerHTML = '';
      if (els.hours) els.hours.innerHTML = els.temps.innerHTML = '';
      return;
    }
    els.now.innerHTML = '<div class="o3-temp">' + deg(w.temp) + '</div><div class="o3-cond">' + cond(w.code, w.isDay) + '</div>' +
      (!isNaN(w.max) ? '<div class="o3-small">MAX ' + deg(w.max) + ' · MIN ' + deg(w.min) + '</div>' : '');
    if (mode === 'neural') { renderDays(w); renderSun(w); return; }
    html = '<table class="o3-table"><tr>';
    var hs = (w.hours || []).slice(0, 6);
    for (i = 0; i < hs.length; i++) html += '<td class="k">' + hm(hs[i].at) + '</td>';
    html += '</tr><tr>';
    for (i = 0; i < hs.length; i++) html += '<td class="v">' + deg(hs[i].temp) + '</td>';
    html += '</tr><tr>';
    for (i = 0; i < hs.length; i++) html += '<td class="c">' + cond(hs[i].code, hs[i].day).split(' ')[0] + '</td>';
    els.hours.innerHTML = html + '</tr></table>';
    renderDays(w);
    renderSun(w);
    // Temperaturen de kommande 12 timmarna: tunna staplar
    var t12 = (w.hours12 || w.hours || []).slice(0, 12), lo = 99, hi = -99;
    for (i = 0; i < t12.length; i++) { lo = Math.min(lo, t12[i].temp); hi = Math.max(hi, t12[i].temp); }
    html = '<div class="o3-bars">';
    for (i = 0; i < t12.length; i++) {
      var h = 14 + (hi > lo ? (t12[i].temp - lo) / (hi - lo) : 0.5) * 70;
      html += '<div class="o3-bar' + (i === 0 ? ' first' : '') + '" style="left:' + (i * 50) + 'px"><em style="bottom:' + Math.round(h + 28) + 'px">' + deg(t12[i].temp) + '</em><i style="height:' + h + 'px"></i><span>' + two(new Date(t12[i].at).getHours()) + '</span></div>';
    }
    els.temps.innerHTML = html + '</div>' + (t12.length ? '<div class="o3-small right">LÄGST ' + deg(lo) + ' · HÖGST ' + deg(hi) + '</div>' : '');
  }

  function renderDays(w) {
    var html = '<table class="o3-table rows">', i;
    var ds = (w.days || []).slice(0, 5);
    for (i = 0; i < ds.length; i++) {
      var dd = new Date(ds[i].at);
      html += '<tr><td class="k">' + DAY3[dd.getDay()] + ' ' + dd.getDate() + '</td><td class="c">' + cond(ds[i].code, true) + '</td><td class="v">' + deg(ds[i].max) + ' / ' + deg(ds[i].min) + '</td></tr>';
    }
    els.days.innerHTML = html + '</table>';
  }

  function renderSun(w) {
    if (w.sunrise && w.sunset) {
      var len = Math.round((w.sunset - w.sunrise) / 60000);
      els.sun.innerHTML = '<div class="o3-kv col"><span>UPP <b>' + hm(w.sunrise) + '</b></span><span>NER <b>' + hm(w.sunset) + '</b></span>' +
        '<span>DAGSLJUS <b>' + Math.floor(len / 60) + ' H ' + two(len % 60) + ' MIN</b></span></div>';
    } else els.sun.innerHTML = '';
  }

  function renderEdges() {
    var lat = +(typeof Prefs !== 'undefined' && Prefs.latitude ? Prefs.latitude() : 0), lon = +(typeof Prefs !== 'undefined' && Prefs.longitude ? Prefs.longitude() : 0);
    var city = typeof Prefs !== 'undefined' && Prefs.city ? String(Prefs.city()).toUpperCase() : '';
    els.coord.textContent = city + (lat ? '  ' + Math.abs(lat).toFixed(2) + '° ' + (lat >= 0 ? 'N' : 'S') + '  ' + Math.abs(lon).toFixed(2) + '° ' + (lon >= 0 ? 'Ö' : 'V') : '');
  }

  function renderAll() {
    renderClock();
    renderWeather();
    renderEdges();
  }

  // MARK: - Lägen, natt och förflyttning

  function setState(name) {
    if (name === 'standby') name = 'idle';
    if (!STATE_NAME[name]) return;
    stateNow = name;
    if (scene) scene.setState(name);
    if (els.state) els.state.textContent = (mode === 'neural' ? NEURAL_NAME : STATE_NAME)[name];
    if (layer) layer.setAttribute('data-state', name);
  }

  function isNight() {
    if (pref('night', 'auto') !== 'auto') return false;
    var h = new Date().getHours();
    return h >= 22 || h < 7;
  }

  /** Långsam förflyttning av informationen (±12 × 8 px på tio minuter) mot inbränning. */
  function drift() {
    var ph = 2 * Math.PI * (Date.now() / 1000 % 600) / 600;
    var v = 'translate(' + Math.round(12 * Math.sin(ph)) + 'px,' + Math.round(8 * Math.sin(2 * ph + 0.7)) + 'px)';
    hud.style.webkitTransform = hud.style.transform = v;
  }

  function tick() {
    if (!on) return;
    renderClock();
    drift();
    var night = isNight();
    setClass(layer, 'o3-night', night);
    if (scene) scene.setNight(night);
    var offline = navigator.onLine === false;
    if (offline && stateNow === 'idle') setState('alert');
    else if (!offline && stateNow === 'alert') setState('idle');
  }

  function setClass(e, c, v) {
    if (!e) return;
    var has = (' ' + e.className + ' ').indexOf(' ' + c + ' ') >= 0;
    if (v && !has) e.className = (e.className + ' ' + c).replace(/^\s+/, '');
    if (!v && has) e.className = (' ' + e.className + ' ').replace(' ' + c + ' ', ' ').replace(/^\s+|\s+$/g, '');
  }

  // Vädret uppdateras (data.js): ny information utan att animationerna startar om, och en kort puls.
  var hooked = false;
  function hookData() {
    if (hooked || typeof Data === 'undefined' || !Data.onChange) return;
    hooked = true;
    var last = Data.weather;
    Data.onChange(function () {
      if (!on) return;
      renderWeather();
      if (Data.weather && Data.weather !== last && stateNow === 'idle') setState('success');
      last = Data.weather;
    });
  }

  // MARK: - Visa och dölj

  function supported() {
    if (supportedCache === null) supportedCache = !!(window.OrtiScene && OrtiScene.supported());
    return supportedCache;
  }

  /** Visar skärmsläckaren; false om den inte kan (ingen WebGL): då visar home.js klockan i stället. */
  function show(which) {
    if (on) return true;
    if (!supported()) return false;
    clearTimeout(killTimer);
    which = which === 'neural' ? 'neural' : 'orti';
    if (scene && which !== mode) { scene.destroy(); scene = null; }
    mode = which;
    if (!layer || built !== mode) build();
    else if (!canvas.parentNode) { canvas = el('canvas', 'o3-gl', null); layer.insertBefore(canvas, layer.firstChild); }
    if (!scene) {
      scene = OrtiScene.create(canvas, {figure: mode === 'neural' ? 'neural' : 'reactor', quality: pref('quality', 'auto'), brightness: pref('bright', 1), speed: pref('speed', 1)});
      if (!scene.init()) { scene = null; return false; }
    }
    setClass(layer, 'o3-nopanels', pref('panels', true) === false);
    on = true;
    hookData();
    renderAll();
    tick();
    setState(navigator.onLine === false ? 'alert' : 'idle');
    scene.frame();
    scene.start();
    // Synlig men genomskinlig först (texten ritas), toningen in två bildrutor senare
    setClass(layer, 'prep', true);
    requestAnimationFrame(function () { requestAnimationFrame(function () { if (on) setClass(layer, 'on', true); }); });
    clearInterval(timer);
    timer = setInterval(tick, 15000);
    clearInterval(dataTimer);
    dataTimer = setInterval(function () { if (on) { renderWeather(); renderEdges(); } }, 60000);
    if (ana) { drawAna(); anaLoop(); }
    return true;
  }

  /** Tonar ut och släpper grafikminnet när toningen är klar. */
  function hide() {
    if (!on) return;
    on = false;
    clearInterval(timer); clearInterval(dataTimer); clearInterval(anaTimer);
    setClass(layer, 'on', false);
    setClass(layer, 'prep', false);
    clearTimeout(killTimer);
    killTimer = setTimeout(function () {
      if (on || !scene) return;
      scene.destroy();
      scene = null;
      if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
    }, 1200);
  }

  document.addEventListener('visibilitychange', function () {
    if (!scene) return;
    if (document.hidden) scene.stop(); else if (on) scene.start();
  });

  return {
    show: show, hide: hide, isOn: function () { return on; }, supported: supported,
    state: setState,
    level: function (v) { speakLevel = Math.max(0, Math.min(1, v || 0)); if (scene) scene.level(v); },
    /** Vilken som visas nu: 'orti' eller 'neural'. */
    mode: function () { return mode; },
    /** Inställningarna ändrades (Hemskärm): gäller nästa gång, kvaliteten direkt om den visas. */
    settingsChanged: function () {
      if (!scene) return;
      scene.setQuality(pref('quality', 'auto'));
      scene.setBrightness(pref('bright', 1));
      scene.setSpeed(pref('speed', 1));
      setClass(layer, 'o3-nopanels', pref('panels', true) === false);
    },
    debug: function () { return scene ? scene.quality() : null; }
  };
})();
