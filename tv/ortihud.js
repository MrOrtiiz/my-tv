/*
 * O.R.T.I. – skärmsläckaren hemma: lagret med 3D-kärnan (orti3d.js) och informationen ovanpå (orti3d.css).
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

  var layer = null, canvas = null, hud = null, scene = null, on = false, timer = 0, dataTimer = 0, killTimer = 0;
  var supportedCache = null, els = {}, stateNow = 'idle';

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
    layer = el('div', '', stage);
    layer.id = 'ortisaver';
    canvas = el('canvas', 'o3-gl', layer);
    var frame = el('canvas', 'o3-frame', layer);
    frame.width = 1920; frame.height = 1080;
    hud = el('div', 'o3-hud', layer);
    drawFrame(frame.getContext('2d'));
    buildHud();
  }

  /** Ramen: hårfina linjer, notchar, skalor och små cirklar (utsmyckning). */
  function drawFrame(g) {
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
    var rings = [[W - 120, 540], [120, 540]];
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
    els.ref = el('div', 'o3-edge o3-ref', hud, 'REF 0721-48 · HOLO-STRUKTUR A–F');
  }

  // MARK: - Data

  function renderClock() {
    var d = new Date();
    els.time.textContent = two(d.getHours()) + ':' + two(d.getMinutes());
    els.date.textContent = DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
    els.week.textContent = 'VECKA ' + week(d);
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
      els.hours.innerHTML = els.days.innerHTML = els.sun.innerHTML = els.temps.innerHTML = '';
      return;
    }
    els.now.innerHTML = '<div class="o3-temp">' + deg(w.temp) + '</div><div class="o3-cond">' + cond(w.code, w.isDay) + '</div>' +
      (!isNaN(w.max) ? '<div class="o3-small">MAX ' + deg(w.max) + ' · MIN ' + deg(w.min) + '</div>' : '');
    html = '<table class="o3-table"><tr>';
    var hs = (w.hours || []).slice(0, 6);
    for (i = 0; i < hs.length; i++) html += '<td class="k">' + hm(hs[i].at) + '</td>';
    html += '</tr><tr>';
    for (i = 0; i < hs.length; i++) html += '<td class="v">' + deg(hs[i].temp) + '</td>';
    html += '</tr><tr>';
    for (i = 0; i < hs.length; i++) html += '<td class="c">' + cond(hs[i].code, hs[i].day).split(' ')[0] + '</td>';
    els.hours.innerHTML = html + '</tr></table>';
    html = '<table class="o3-table rows">';
    var ds = (w.days || []).slice(0, 5);
    for (i = 0; i < ds.length; i++) {
      var dd = new Date(ds[i].at);
      html += '<tr><td class="k">' + DAY3[dd.getDay()] + ' ' + dd.getDate() + '</td><td class="c">' + cond(ds[i].code, true) + '</td><td class="v">' + deg(ds[i].max) + ' / ' + deg(ds[i].min) + '</td></tr>';
    }
    els.days.innerHTML = html + '</table>';
    if (w.sunrise && w.sunset) {
      var len = Math.round((w.sunset - w.sunrise) / 60000);
      els.sun.innerHTML = '<div class="o3-kv col"><span>UPP <b>' + hm(w.sunrise) + '</b></span><span>NER <b>' + hm(w.sunset) + '</b></span>' +
        '<span>DAGSLJUS <b>' + Math.floor(len / 60) + ' H ' + two(len % 60) + ' MIN</b></span></div>';
    } else els.sun.innerHTML = '';
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
    if (!STATE_NAME[name]) return;
    stateNow = name;
    if (scene) scene.setState(name);
    if (els.state) els.state.textContent = STATE_NAME[name];
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
  function show() {
    if (on) return true;
    if (!supported()) return false;
    clearTimeout(killTimer);
    if (!layer) build();
    else if (!canvas.parentNode) { canvas = el('canvas', 'o3-gl', null); layer.insertBefore(canvas, layer.firstChild); }
    if (!scene) {
      scene = OrtiScene.create(canvas, {quality: pref('quality', 'auto'), brightness: pref('bright', 1), speed: pref('speed', 1)});
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
    return true;
  }

  /** Tonar ut och släpper grafikminnet när toningen är klar. */
  function hide() {
    if (!on) return;
    on = false;
    clearInterval(timer); clearInterval(dataTimer);
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
    level: function (v) { if (scene) scene.level(v); },
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
