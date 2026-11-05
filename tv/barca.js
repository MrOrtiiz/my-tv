/*
 * The Barça box, at the top right: FC Barcelona's coming matches and which of your IPTV channels show them, from
 * data/barca.json in the TV's GitHub repo (written every 3 hours by .github/workflows/barca.yml from your IPTV guide).
 * Hidden until that file has been made, and while turned off (Home Settings → Barça box). ES5 only.
 */
var BarcaBox = (function () {
  'use strict';
  var URL = 'https://raw.githubusercontent.com/MrOrtiiz/my-tv/main/data/barca.json';
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
      if (m.live && !playing) el('span', 'live', t, 'Direkt');
      el('div', 'title', row, m.title);
      el('div', 'channels', row, (m.channels || []).join('  ·  ') + (m.more ? '  ·  +' + m.more : ''));
    }
  }

  function load() {
    clearTimeout(timer);
    timer = setTimeout(load, EVERY);
    if (!on()) { render(); return; }
    var x = new XMLHttpRequest();
    x.open('GET', URL + '?t=' + Math.floor(Date.now() / 300000), true);
    x.timeout = 15000;
    x.onload = function () {
      if (x.status !== 200) return;
      try { data = JSON.parse(x.responseText); } catch (e) { return; }
      render();
    };
    x.send();
  }

  document.addEventListener('visibilitychange', function () { if (!document.hidden) load(); });
  setTimeout(load, 500);
  // The time of each match ("I dag", "Pågår nu") moves on by itself.
  setInterval(render, 60000);

  return {refresh: load};
})();
