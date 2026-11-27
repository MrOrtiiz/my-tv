/*
 * TV-kanaler (kompisens projektor): gratis kanaler som sänds öppet på nätet (iptv-org), från data/fria-kanaler.json
 * (.github/workflows/fria.yml provar dem varje morgon). Grupperna Sverige, España, Nyheter, Sport och Engelska som
 * flikar, kanalerna som rutor med logga. OK spelar kanalen i hemskärmens spelare (iptv.js); där byter ▲ ▼ kanal inom
 * gruppen och Tillbaka går tillbaka hit. ← → ↑ ↓ flyttar, Tillbaka stänger. ES5.
 * Laddas av android/kompis.js; knappen finns där CONFIG.buttons tar med 'channels'.
 */
var Kanaler = (function () {
  'use strict';
  var API = 'https://api.github.com/repos/MrOrtiiz/my-tv/contents/data/fria-kanaler.json?ref=main';
  var RAW = 'https://raw.githubusercontent.com/MrOrtiiz/my-tv/main/data/fria-kanaler.json';
  var COLS = 6, W = 264, H = 150, GAP_X = 28, ROW = 226, LEFT = (1920 - (COLS * W + (COLS - 1) * GAP_X)) / 2, ROWS_SHOWN = 3;
  var STORE = 'fmtv.kanaler';

  var data = null, loadedAt = 0, root = null, grid = null, tabs = null, opened = false;
  var tab = 0, sel = 0, zone = 'grid', lastPlayed = {};

  try { var s = JSON.parse(localStorage.getItem(STORE) || '{}'); tab = s.tab || 0; lastPlayed = s.last || {}; } catch (e) {}
  function save() { try { localStorage.setItem(STORE, JSON.stringify({tab: tab, last: lastPlayed})); } catch (e) {} }

  function el(tag, cls, parent, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  function two(n) { return (n < 10 ? '0' : '') + n; }

  function get(url, headers, done) {
    var x = new XMLHttpRequest(), over = false;
    x.open('GET', url, true);
    x.timeout = 20000;
    for (var h in headers) if (headers.hasOwnProperty(h)) x.setRequestHeader(h, headers[h]);
    x.onreadystatechange = function () {
      if (x.readyState !== 4 || over) return;
      over = true;
      var d = null;
      try { d = x.status === 200 ? JSON.parse(x.responseText) : null; } catch (e) {}
      done(d && d.groups ? d : null);
    };
    x.ontimeout = x.onerror = function () { if (!over) { over = true; done(null); } };
    x.send();
  }

  function load(done) {
    if (data && Date.now() - loadedAt < 6 * 3600000) { done(); return; }
    get(API, {Accept: 'application/vnd.github.raw+json'}, function (d) {
      if (d) { data = d; loadedAt = Date.now(); done(); return; }
      get(RAW + '?t=' + Date.now(), {}, function (d2) { if (d2) { data = d2; loadedAt = Date.now(); } done(); });
    });
  }

  function groups() { return (data && data.groups) || []; }
  function chans() { var g = groups()[tab]; return g ? g.channels : []; }

  // MARK: - Fönstret

  function build() {
    root = el('div', 'kanaler', document.getElementById('stage') || document.body);
    root.id = 'kanaler';
    var head = el('div', 'kn-head', root);
    el('div', 'kn-title', head, 'TV-kanaler');
    el('div', 'kn-sub', head, '').id = 'knsub';
    tabs = el('div', 'kn-tabs', root);
    var view = el('div', 'kn-view', root);
    grid = el('div', 'kn-grid', view);
    el('div', 'kn-hint', root, 'OK spelar  ·  ▲ ▼ byter kanal i spelaren  ·  Tillbaka stänger');
  }

  function draw() {
    var sub = document.getElementById('knsub');
    if (!data) { sub.textContent = 'Hämtar kanalerna…'; tabs.innerHTML = ''; grid.innerHTML = ''; return; }
    var u = new Date(data.updated);
    sub.textContent = 'Gratis kanaler som sänds öppet  ·  provade ' + u.getDate() + '/' + (u.getMonth() + 1) + ' ' + two(u.getHours()) + ':' + two(u.getMinutes());
    tabs.innerHTML = '';
    var gs = groups();
    if (tab >= gs.length) tab = 0;
    for (var g = 0; g < gs.length; g++) {
      var t = el('div', 'kn-tab' + (g === tab ? ' on' : '') + (zone === 'tabs' && g === tab ? ' focus' : ''), tabs, gs[g].name);
      el('span', 'kn-count', t, ' ' + gs[g].channels.length);
    }
    grid.innerHTML = '';
    var list = chans();
    for (var i = 0; i < list.length; i++) {
      var c = el('div', 'kn-card', grid), r = Math.floor(i / COLS), col = i % COLS;
      c.style.left = (LEFT + col * (W + GAP_X)) + 'px';
      c.style.top = (r * ROW) + 'px';
      var box = el('div', 'kn-logo', c);
      if (list[i].logo && r < ROWS_SHOWN + 2) logo(box, list[i]);
      else if (list[i].logo) box.setAttribute('data-logo', '1');
      if (!list[i].logo) el('div', 'kn-initial', box, list[i].name);
      el('div', 'kn-name', c, list[i].name);
    }
    focus();
  }

  function logo(box, ch) {
    if (box.getAttribute('data-done')) return;
    box.setAttribute('data-done', '1');
    var img = el('img', '', box);
    img.onerror = function () { img.parentNode.removeChild(img); el('div', 'kn-initial', box, ch.name); };
    img.src = ch.logo;
  }

  function focus() {
    var cards = grid.children, list = chans(), last = lastPlayed[tab];
    for (var i = 0; i < cards.length; i++) {
      cards[i].className = 'kn-card' + (zone === 'grid' && i === sel ? ' focus' : '') + (i === last ? ' last' : '');
    }
    var row = Math.floor(sel / COLS), rows = Math.ceil(list.length / COLS);
    var first = Math.max(0, Math.min(Math.max(0, rows - ROWS_SHOWN), row - 1));
    grid.style.webkitTransform = grid.style.transform = 'translateY(' + (-first * ROW) + 'px)';
    // Loggorna för raderna som syns (och nästa), först när de behövs: projektorn har lite minne.
    for (var j = first * COLS; j < Math.min(list.length, (first + ROWS_SHOWN + 1) * COLS); j++) {
      var b = cards[j] && cards[j].firstChild;
      if (b && b.getAttribute('data-logo')) { b.removeAttribute('data-logo'); logo(b, list[j]); }
    }
    var ts = tabs.children;
    for (var k = 0; k < ts.length; k++) ts[k].className = 'kn-tab' + (k === tab ? ' on' : '') + (zone === 'tabs' && k === tab ? ' focus' : '');
  }

  function play() {
    var list = chans(), g = groups()[tab];
    if (!list.length || !window.IPTV || !IPTV.open) return;
    lastPlayed[tab] = sel;
    save();
    var items = [];
    for (var i = 0; i < list.length; i++) items.push({label: list[i].name, ch: {u: list[i].url, list: [list[i].url]}});
    IPTV.open(items, sel, g ? g.name : '');
  }

  // MARK: - Tangenter

  window.addEventListener('keydown', function (e) {
    if (!opened || e.defaultPrevented) return;   // spelaren (iptv.js, före oss) har redan tagit tangenten
    if (window.IPTV && IPTV.playing && IPTV.playing()) return;   // spelaren har tangenterna
    var k = e.keyCode, back = (window.TV && TV.keys && k === TV.keys.back) || k === 461 || k === 10009 || k === 27 || k === 8;
    e.preventDefault();
    e.stopPropagation();
    if (window.FreeMyTV && FreeMyTV.poke) FreeMyTV.poke();
    if (back) { close(); return; }
    var n = chans().length, gs = groups().length;
    if (zone === 'tabs') {
      if (k === 37 && tab > 0) { tab--; sel = lastPlayed[tab] || 0; save(); draw(); return; }
      if (k === 39 && tab < gs - 1) { tab++; sel = lastPlayed[tab] || 0; save(); draw(); return; }
      if ((k === 40 || k === 13) && n) { zone = 'grid'; sel = Math.min(sel, n - 1); }
      focus();
      return;
    }
    if (k === 37 && sel % COLS > 0) sel--;
    else if (k === 39 && sel % COLS < COLS - 1 && sel < n - 1) sel++;
    else if (k === 38) { if (sel >= COLS) sel -= COLS; else zone = 'tabs'; }
    else if (k === 40 && sel + COLS < n) sel += COLS;
    else if (k === 40 && Math.floor(sel / COLS) < Math.floor((n - 1) / COLS)) sel = n - 1;
    else if (k === 13) { play(); return; }
    focus();
  }, true);   // före hemskärmens egna tangenter

  function open() {
    if (!root) build();
    root.className = 'kanaler open';
    opened = true;
    zone = 'grid';
    load(function () {
      if (!opened) return;
      if (!data) { document.getElementById('knsub').textContent = 'Kunde inte hämta kanalerna. Försök igen om en stund.'; return; }
      sel = lastPlayed[tab] || 0;
      if (sel >= chans().length) sel = 0;
      draw();
    });
    draw();
  }

  function close() {
    opened = false;
    if (root) root.className = 'kanaler';
  }

  return {open: open, close: close, isOpen: function () { return opened; }};
})();
