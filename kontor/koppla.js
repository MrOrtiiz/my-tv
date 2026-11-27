/*
 * Koppla mobilen (kompisens projektor): knappen Mobilen uppe till höger visar en QR-kod. Mobilens kamera (iPhone och
 * Android, ingen app) öppnar phone/fjarr.html, en fjärrkontroll i webbläsaren: pilar, OK, Tillbaka, skriva text i
 * TV:ns textfält och spara TMDB-nyckeln direkt. Meddelandena går genom ntfy.sh på ett hemligt ämne som bara TV:n och
 * mobilen känner till (<ämne>-tv till TV:n, <ämne>-ph till mobilen); inget sparas någon annanstans. ES5.
 * Laddas av android/kompis.js; knappen finns där CONFIG.buttons tar med 'phone'.
 */
var Koppla = (function () {
  'use strict';
  var STORE = 'fmtv.remote';
  var RELAY = (window.CONFIG && CONFIG.relay) || 'https://ntfy.sh/';
  var PAGE = 'https://raw.githack.com/MrOrtiiz/my-tv/main/phone/fjarr.html';
  var QRLIB = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
  var KEYS = {left: 37, up: 38, right: 39, down: 40, ok: 13, back: 461};

  var cfg = {};
  try { cfg = JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) { cfg = {}; }
  function save() { try { localStorage.setItem(STORE, JSON.stringify(cfg)); } catch (e) {} }

  function rid(n) {
    var abc = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', out = '', b = null;
    try { b = new Uint8Array(n); window.crypto.getRandomValues(b); } catch (e) { b = null; }
    for (var i = 0; i < n; i++) out += abc.charAt((b ? b[i] : Math.floor(Math.random() * 256)) % abc.length);
    return out;
  }
  function topic() { if (!cfg.topic) { cfg.topic = 'fmtv-r-' + rid(24); save(); } return cfg.topic; }
  function url() { return PAGE + '#' + topic(); }

  function el(tag, cls, parent, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }

  function toast(text) { if (window.FreeMyTV && FreeMyTV.toast) FreeMyTV.toast(text); }

  // MARK: - ntfy

  var es = null, connected = false, lastAt = 0;

  function post(o) {
    try {
      var x = new XMLHttpRequest();
      x.open('POST', RELAY + topic() + '-ph?cache=no', true);
      x.timeout = 10000;
      x.send(JSON.stringify(o));
    } catch (e) {}
  }

  function listen() {
    if (!window.EventSource) return;
    if (es) { try { es.close(); } catch (e) {} }
    es = new EventSource(RELAY + topic() + '-tv/sse?since=' + (cfg.lastId ? encodeURIComponent(cfg.lastId) : '1m'));
    es.onmessage = function (e) {
      var m = null, o = null;
      try { m = JSON.parse(e.data); } catch (x) { return; }
      if (!m || m.event !== 'message') return;
      if (m.id) { cfg.lastId = m.id; save(); }
      if (m.time && Date.now() / 1000 - m.time > 120) return;   // gammalt: inte nu
      try { o = JSON.parse(m.message); } catch (x) { return; }
      if (o) fromPhone(o);
    };
  }

  function press(code) {
    var e = document.createEvent('Event');
    e.initEvent('keydown', true, true);
    Object.defineProperty(e, 'keyCode', {get: function () { return code; }});
    Object.defineProperty(e, 'which', {get: function () { return code; }});
    (document.activeElement || document).dispatchEvent(e);
  }

  function tvName() { return (window.CONFIG && CONFIG.tvName) || 'Projektorn'; }

  function fromPhone(o) {
    lastAt = Date.now();
    if (o.t === 'hello') {
      var was = connected;
      connected = true;
      post({t: 'hi', tv: tvName(), tmdb: !!(window.Data && Data.hasKey())});
      if (!was) toast('Mobilen är ansluten.');
      if (opened) draw();
      return;
    }
    if (o.t === 'key' && KEYS.hasOwnProperty(o.k)) {
      if (opened && o.k !== 'back') close();   // fönstret med QR-koden går undan när mobilen styr
      press(KEYS[o.k]);
      return;
    }
    if (o.t === 'text') {
      var f = document.activeElement;
      if (f && (f.tagName === 'INPUT' || f.tagName === 'TEXTAREA')) {
        f.value = String(o.v || '');
        try { f.dispatchEvent(new Event('input', {bubbles: true})); } catch (e) {}
        post({t: 'note', say: 'Skrivet på ' + tvName() + '.'});
      } else {
        post({t: 'note', say: 'Inget textfält är öppet på ' + tvName() + '. Öppna fältet med OK först.', bad: true});
      }
      return;
    }
    if (o.t === 'tmdb') {
      var key = String(o.v || '').replace(/\s+/g, '');
      if (!window.Data || !Data.checkKey || typeof Prefs === 'undefined') { post({t: 'note', say: 'Hemskärmen är inte klar än. Försök igen.', bad: true}); return; }
      post({t: 'note', say: 'Kontrollerar nyckeln med TMDB…'});
      Data.checkKey(key, function (err) {
        if (err) { post({t: 'note', say: err.rejected ? 'TMDB godtog inte nyckeln.' : 'Nådde inte TMDB: ' + err.message, bad: true}); return; }
        Prefs.set('tmdbKey', key);
        Data.keyChanged();
        post({t: 'note', say: 'TMDB-nyckeln är sparad på ' + tvName() + '. Filmtipsen kommer om en stund.', tmdb: true});
        toast('TMDB-nyckeln är sparad.');
      });
    }
  }

  // MARK: - Fönstret med QR-koden

  var root = null, opened = false;

  function loadQr(done) {
    if (window.qrcode) { done(true); return; }
    var s = document.createElement('script');
    s.src = QRLIB;
    s.onload = s.onerror = function () { done(!!window.qrcode); };
    document.head.appendChild(s);
  }

  function draw() {
    if (!root) {
      root = el('div', 'koppla', document.getElementById('stage') || document.body);
      root.id = 'koppla';
    }
    root.innerHTML = '';
    var box = el('div', 'kp-box', root);
    el('div', 'kp-title', box, 'Koppla mobilen');
    var q = el('div', 'kp-qr', box);
    loadQr(function (ok) {
      if (!ok) { q.textContent = 'QR-koden gick inte att ladda.'; return; }
      try { var qr = window.qrcode(0, 'M'); qr.addData(url()); qr.make(); q.innerHTML = qr.createSvgTag({cellSize: 8, margin: 2}); } catch (e) {}
    });
    var t = el('div', 'kp-text', box);
    el('div', 'kp-step', t, '1. Öppna kameran på mobilen (iPhone eller Android).');
    el('div', 'kp-step', t, '2. Rikta den mot koden och tryck på länken.');
    el('div', 'kp-step', t, '3. Styr projektorn, skriv text eller spara TMDB-nyckeln från mobilen.');
    el('div', 'kp-state' + (connected ? ' on' : ''), t, connected ? '● Mobilen är ansluten' : '○ Väntar på mobilen…');
    el('div', 'kp-hint', box, 'Ingen app behövs. Tillbaka stänger.');
  }

  function open() {
    listen();
    draw();
    root.className = 'koppla open';
    opened = true;
  }

  function close() {
    opened = false;
    if (root) root.className = 'koppla';
  }

  window.addEventListener('keydown', function (e) {
    if (!opened || e.defaultPrevented) return;   // spelaren (iptv.js, före oss) har redan tagit tangenten
    var k = e.keyCode;
    e.preventDefault();
    e.stopPropagation();
    if (k === 461 || k === 10009 || k === 27 || k === 8 || k === 13 || (window.TV && TV.keys && k === TV.keys.back)) close();
  }, true);

  // Har mobilen kopplats förut lyssnar TV:n från start, så att fjärrkontrollen fungerar direkt.
  if (cfg.topic) setTimeout(listen, 2000);

  return {open: open, close: close, isOpen: function () { return opened; }};
})();
