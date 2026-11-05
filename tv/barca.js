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

  function render() {
    var top = document.getElementById('top'), box = document.getElementById('barca');
    if (!top) return;
    if (!on() || !data || !data.updated) { if (box) box.parentNode.removeChild(box); return; }
    if (!box) { box = el('div', 'glass', top); box.id = 'barca'; }
    box.innerHTML = '';
    var head = el('div', 'head', box);
    el('span', 'stripe', head);
    el('span', 'name', head, 'FC Barcelona');
    // When the match list was made: shows at once whether the TV has the newest one.
    var u = new Date(data.updated);
    el('span', 'stamp', head, 'uppdaterad ' + two(u.getHours()) + ':' + two(u.getMinutes()));
    var now = Date.now(), list = [], i;
    for (i = 0; data.matches && i < data.matches.length; i++) if (data.matches[i].stop > now) list.push(data.matches[i]);
    if (data.status === 'error') {
      el('div', 'none', box, 'Kunde inte läsa din tablå just nu.');
      return;
    }
    if (!list.length) {
      el('div', 'none', box, 'Inga matcher i din tablå de närmaste två veckorna.');
      return;
    }
    for (i = 0; i < list.length && i < SHOW; i++) {
      var m = list[i], row = el('div', 'match', box), playing = m.start <= now && now < m.stop;
      var t = el('div', 'when' + (playing ? ' now' : ''), row, playing ? 'Pågår nu' : when(m.start));
      if (m.competition) t.appendChild(document.createTextNode('  ·  ' + m.competition));
      if (m.live && !playing) el('span', 'live', t, 'Direkt');
      el('div', 'title', row, m.title);
      var ch = m.channels || [];
      el('div', 'channels' + (ch.length ? '' : ' soon'), row, ch.length ? ch.join('  ·  ') + (m.more ? '  ·  +' + m.more : '')
        : 'Kanalerna visas när matchen kommer in i din tablå');
    }
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
      done(true);
    };
    x.onerror = x.ontimeout = function () { done(false); };
    x.send();
  }

  document.addEventListener('visibilitychange', function () { if (!document.hidden) load(); });
  setTimeout(load, 500);
  // The time of each match ("I dag", "Pågår nu") moves on by itself.
  setInterval(render, 60000);

  return {refresh: load};
})();
