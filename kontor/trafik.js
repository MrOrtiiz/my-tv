/*
 * Trafikrutan, under Barça-rutan uppe till höger: restiden med bil just nu (med köer) för en sträcka, från TomTom.
 * Bara på jobbets TV (mappen kontor/, med CONFIG.traffic från android/kontor.js: Palmbladsgatan 8 → Ritargatan 4).
 * TomTom-nyckeln skrivs in på TV:n (Inställningar → Hemskärm → Trafiknyckel) och stannar där: den finns aldrig i repot.
 * Var 5:e minut under CONFIG.traffic.days/hours (vardagar 07–18), annars var 30:e minut. ES5.
 */
var Trafik = (function () {
  'use strict';
  var C = window.CONFIG && CONFIG.traffic;
  if (!C) return null;

  var API = 'https://api.tomtom.com/routing/1/calculateRoute/';
  var data = null, err = '', timer = 0, seq = 0;

  function key() { return typeof Prefs !== 'undefined' && Prefs.tomtomKey ? Prefs.tomtomKey() : ''; }
  function on() { return typeof Prefs === 'undefined' || !Prefs.traffic || Prefs.traffic(); }

  function two(n) { return (n < 10 ? '0' : '') + n; }
  function hm(d) { return two(d.getHours()) + ':' + two(d.getMinutes()); }

  function el(tag, cls, parent, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }

  /** Under arbetstid: CONFIG.traffic.days (1 = måndag … 7 = söndag) och hours [från, till). */
  function busy() {
    var d = new Date(), day = d.getDay() || 7, h = d.getHours();
    var days = C.days || [1, 2, 3, 4, 5], hours = C.hours || [7, 18];
    return days.indexOf(day) >= 0 && h >= hours[0] && h < hours[1];
  }

  function url(k) {
    return API + C.from[0] + ',' + C.from[1] + ':' + C.to[0] + ',' + C.to[1]
      + '/json?traffic=true&travelMode=car&routeRepresentation=summaryOnly&key=' + encodeURIComponent(k);
  }

  /** Frågar TomTom om sträckan med nyckeln k; done(error, summary). error.rejected när TomTom sa nej till nyckeln. */
  function ask(k, done) {
    var x = new XMLHttpRequest(), over = false;
    function end(e, s) { if (!over) { over = true; done(e, s); } }
    try {
      x.open('GET', url(k), true);
      x.timeout = 15000;
      x.onload = function () {
        if (x.status === 401 || x.status === 403) { var r = new Error('TomTom sa nej till nyckeln'); r.rejected = true; end(r); return; }
        if (x.status !== 200) { end(new Error('HTTP ' + x.status)); return; }
        var j = null;
        try { j = JSON.parse(x.responseText); } catch (e) {}
        var s = j && j.routes && j.routes[0] && j.routes[0].summary;
        if (!s) { end(new Error('inget svar om vägen')); return; }
        end(null, s);
      };
      x.onerror = function () { end(new Error('inget nät')); };
      x.ontimeout = function () { end(new Error('för långsamt svar')); };
      x.send();
    } catch (e) { end(e); }
  }

  function load() {
    clearTimeout(timer);
    timer = setTimeout(load, (busy() ? 5 : 30) * 60000);
    if (!on() || !key()) { render(); return; }
    var mine = ++seq;
    ask(key(), function (e, s) {
      if (mine !== seq) return;
      if (e) err = e.rejected ? 'TomTom godkänner inte nyckeln. Byt den under Inställningar → Hemskärm → Trafiknyckel.'
        : 'Kunde inte hämta trafiken just nu (' + e.message + ').';
      else { err = ''; data = {s: s, at: Date.now()}; }
      render();
    });
  }

  /** Grön utan kö, gul vid 3–9 minuters kö, röd från 10. */
  function level(delayMin) { return delayMin >= 10 ? 'red' : delayMin >= 3 ? 'yellow' : 'green'; }

  /** Rutans plats till höger: under Barça-rutan (och dess knapp) när den också står till höger, annars under knapparna. */
  function place(box) {
    var y = 216, barca = document.getElementById('barca'), pill = document.getElementById('barcapill');
    if (barca && barca.offsetHeight && barca.offsetLeft > 960) {
      y = barca.offsetTop + barca.offsetHeight + 24;
      if (pill && pill.offsetHeight && pill.style.display !== 'none') y = Math.max(y, pill.offsetTop + pill.offsetHeight + 24);
    }
    box.style.top = y + 'px';
  }

  function render() {
    var top = document.getElementById('top'), box = document.getElementById('trafik');
    if (!top) return;
    if (!on()) { if (box) box.parentNode.removeChild(box); return; }
    if (!box) { box = el('div', 'glass', top); box.id = 'trafik'; }
    box.className = 'glass';
    box.innerHTML = '';
    var head = el('div', 'head', box);
    el('span', 'dot', head);
    el('span', 'name', head, 'Trafiken ' + (C.label || 'hem'));
    if (data) el('span', 'stamp', head, 'uppdaterad ' + hm(new Date(data.at)));

    if (!key()) {
      el('div', 'none', box, 'Lägg in din TomTom-nyckel: Inställningar → Hemskärm → Trafiknyckel.');
    } else if (!data) {
      el('div', 'none', box, err || 'Hämtar trafiken…');
    } else {
      var s = data.s, min = Math.max(1, Math.round(s.travelTimeInSeconds / 60)), delay = Math.round((s.trafficDelayInSeconds || 0) / 60);
      var lv = level(delay);
      box.className = 'glass ' + lv;
      var row = el('div', 'now', box);
      el('span', 'time', row, min + ' min');
      el('span', 'state ' + lv, row, delay >= 1 ? '+' + delay + ' min kö' : 'Fritt');
      var arrive = new Date(Date.now() + s.travelTimeInSeconds * 1000);
      var km = (s.lengthInMeters / 1000).toFixed(1).replace('.', ',');
      el('div', 'line', box, km + ' km  ·  framme ' + hm(arrive) + (C.route ? '  ·  ' + C.route : ''));
      if (err) el('div', 'warn', box, err);
    }
    place(box);
  }

  document.addEventListener('visibilitychange', function () { if (!document.hidden) load(); });
  setTimeout(load, 800);
  // Barça-rutan växer och krymper: rutan följer efter. "Framme" går framåt med klockan.
  setInterval(function () { var b = document.getElementById('trafik'); if (b) place(b); }, 2000);
  setInterval(render, 60000);

  return {
    refresh: load,
    /** Provar en nyckel innan den sparas: done(error), med error.rejected när TomTom sa nej. */
    check: function (k, done) { ask(k, function (e) { done(e); }); }
  };
})();
