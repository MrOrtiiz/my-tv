/*
 * Marvel före Avengers: Doomsday (16 dec 2026): alla MCU-filmer i berättelsens ordning, som affischer i ett rutnät.
 * Öppnas med knappen Marvel uppe till höger (CONFIG.buttons med 'marvel': android/kompis.js, kompisens projektor).
 * Ordningen: space.com:s lista "Marvel movies in order" (augusti 2026, 38 filmer).
 * Affischerna och var filmen går att se (Sverige) från TMDB med hemskärmens TMDB-nyckel; utan nyckel titelkort.
 * OK öppnar appen där filmen finns (Disney+, Netflix …) med titeln att söka på; den senast öppnade är markerad
 * så att man ser var man är. ← → ↑ ↓ flyttar, Tillbaka stänger. ES5.
 */
var Marvel = (function () {
  'use strict';

  // [TMDB-id, titel, premiärår, året i berättelsen]
  var FILMS = [
    [1771, 'Captain America: The First Avenger', 2011, '1942'],
    [617126, 'The Fantastic Four: First Steps', 2025, '1964'],
    [299537, 'Captain Marvel', 2019, '1995'],
    [1726, 'Iron Man', 2008, '2008'],
    [10138, 'Iron Man 2', 2010, '2010'],
    [1724, 'The Incredible Hulk', 2008, '2010'],
    [10195, 'Thor', 2011, '2010'],
    [24428, 'The Avengers', 2012, '2012'],
    [76338, 'Thor: The Dark World', 2013, '2013'],
    [68721, 'Iron Man 3', 2013, '2013'],
    [100402, 'Captain America: The Winter Soldier', 2014, '2014'],
    [118340, 'Guardians of the Galaxy', 2014, '2014'],
    [283995, 'Guardians of the Galaxy Vol. 2', 2017, '2014'],
    [99861, 'Avengers: Age of Ultron', 2015, '2015'],
    [102899, 'Ant-Man', 2015, '2015'],
    [271110, 'Captain America: Civil War', 2016, '2016'],
    [497698, 'Black Widow', 2021, '2016'],
    [315635, 'Spider-Man: Homecoming', 2017, '2016'],
    [284054, 'Black Panther', 2018, '2016'],
    [284052, 'Doctor Strange', 2016, '2016'],
    [284053, 'Thor: Ragnarok', 2017, '2017'],
    [363088, 'Ant-Man and the Wasp', 2018, '2018'],
    [299536, 'Avengers: Infinity War', 2018, '2018'],
    [299534, 'Avengers: Endgame', 2019, '2023'],
    [429617, 'Spider-Man: Far From Home', 2019, '2024'],
    [566525, 'Shang-Chi and the Legend of the Ten Rings', 2021, '2024'],
    [524434, 'Eternals', 2021, '2024'],
    [634649, 'Spider-Man: No Way Home', 2021, '2024'],
    [453395, 'Doctor Strange in the Multiverse of Madness', 2022, '2024'],
    [616037, 'Thor: Love and Thunder', 2022, '2025'],
    [505642, 'Black Panther: Wakanda Forever', 2022, '2025'],
    [640146, 'Ant-Man and the Wasp: Quantumania', 2023, '2025'],
    [447365, 'Guardians of the Galaxy Vol. 3', 2023, '2026'],
    [609681, 'The Marvels', 2023, '2026'],
    [533535, 'Deadpool & Wolverine', 2024, '2026'],
    [822119, 'Captain America: Brave New World', 2025, '2026'],
    [986056, 'Thunderbolts*', 2025, '2027'],
    [969681, 'Spider-Man: Brand New Day', 2026, '2028']
  ];
  var DOOMSDAY = new Date(2026, 11, 16).getTime();   // svensk premiär
  var COLS = 8, W = 188, H = 282, GAP_X = 36, GAP_Y = 104, LEFT = (1920 - (COLS * W + (COLS - 1) * GAP_X)) / 2;
  var STORE = 'fmtv.marvel', API = 'https://api.tmdb.org/3', IMG = 'https://image.tmdb.org/t/p/w342';

  var root = null, grid = null, opened = false, sel = 0, info = {}, last = -1, msgTimer = 0;

  function load() {
    try { var o = JSON.parse(localStorage.getItem(STORE) || '{}'); info = o.info || {}; last = typeof o.last === 'number' ? o.last : -1; } catch (e) {}
  }
  function save() { try { localStorage.setItem(STORE, JSON.stringify({info: info, last: last})); } catch (e) {} }

  function el(tag, cls, parent, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }

  function key() { try { return typeof Prefs !== 'undefined' ? Prefs.tmdbKey() : ''; } catch (e) { return ''; } }

  function tmdb(path, done) {
    var k = key();
    if (!k) { done(null); return; }
    var bearer = k.indexOf('eyJ') === 0, x = new XMLHttpRequest(), over = false;
    var url = API + path + (bearer ? '' : (path.indexOf('?') >= 0 ? '&' : '?') + 'api_key=' + encodeURIComponent(k));
    x.open('GET', url, true);
    x.timeout = 12000;
    if (bearer) x.setRequestHeader('Authorization', 'Bearer ' + k);
    x.onreadystatechange = function () {
      if (x.readyState !== 4 || over) return;
      over = true;
      var j = null;
      try { j = x.status === 200 ? JSON.parse(x.responseText) : null; } catch (e) {}
      done(j);
    };
    x.ontimeout = x.onerror = function () { if (!over) { over = true; done(null); } };
    x.send();
  }

  function fold(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

  /** Affischen (svensk först) och var den går att streama i Sverige, en gång per film (sparas i en vecka). */
  function fetchFilm(i, done) {
    var f = FILMS[i], have = info[f[0]];
    if (have && have.at > Date.now() - 7 * 86400000) { done(); return; }
    tmdb('/movie/' + f[0] + '?language=sv-SE&append_to_response=watch/providers', function (j) {
      // Fel id (eller en titel som inte stämmer): sök på titel och premiärår.
      if (!j || fold(j.original_title).indexOf(fold(f[1]).slice(0, 6)) < 0) {
        tmdb('/search/movie?query=' + encodeURIComponent(f[1]) + '&year=' + f[2] + '&language=sv-SE', function (s) {
          var hit = s && s.results && s.results[0];
          if (!hit) { done(); return; }
          tmdb('/movie/' + hit.id + '?language=sv-SE&append_to_response=watch/providers', function (j2) { keep(f, j2); done(); });
        });
        return;
      }
      keep(f, j);
      done();
    });
  }

  function keep(f, j) {
    if (!j) return;
    var se = ((j['watch/providers'] || {}).results || {}).SE || {}, flat = [];
    for (var i = 0; se.flatrate && i < se.flatrate.length; i++) flat.push(se.flatrate[i].provider_name);
    info[f[0]] = {poster: j.poster_path || '', where: flat, rent: !!(se.rent || se.buy), at: Date.now()};
  }

  function fetchAll() {
    var i = 0;
    (function next() {
      if (i >= FILMS.length) { save(); return; }
      var n = i++;
      fetchFilm(n, function () { paint(n); next(); });
    })();
  }

  // MARK: - Rutan

  function build() {
    root = el('div', 'marvel', document.getElementById('stage') || document.body);
    root.id = 'marvel';
    var head = el('div', 'mv-head', root);
    el('div', 'mv-title', head, 'Marvel före Avengers: Doomsday');
    var days = Math.ceil((DOOMSDAY - Date.now()) / 86400000);
    el('div', 'mv-sub', head, FILMS.length + ' filmer i berättelsens ordning' +
      (days > 0 ? '  ·  premiär om ' + days + (days === 1 ? ' dag' : ' dagar') : ''));
    el('div', 'mv-msg', root).id = 'mvmsg';
    var view = el('div', 'mv-view', root);
    grid = el('div', 'mv-grid', view);
    for (var i = 0; i < FILMS.length; i++) {
      var c = el('div', 'mv-card', grid), r = Math.floor(i / COLS), col = i % COLS;
      c.style.left = (LEFT + col * (W + GAP_X)) + 'px';
      c.style.top = (r * (H + GAP_Y)) + 'px';
      var p = el('div', 'mv-poster', c);
      el('div', 'mv-fallback', p, FILMS[i][1]);
      el('div', 'mv-num', c, String(i + 1));
      el('div', 'mv-name', c, FILMS[i][1]);
      el('div', 'mv-year', c, FILMS[i][3]);
      paint(i);
    }
    el('div', 'mv-hint', root, key() ? 'OK öppnar filmen där den finns  ·  Tillbaka stänger'
      : 'Affischerna kommer med TMDB-nyckeln (Genvägar → Hemskärm)  ·  Tillbaka stänger');
  }

  function paint(i) {
    if (!grid) return;
    var c = grid.children[i], d = info[FILMS[i][0]];
    if (!c) return;
    var p = c.firstChild;
    if (d && d.poster && !p.style.backgroundImage) {
      var img = new Image();
      img.onload = function () { p.style.backgroundImage = 'url(' + img.src + ')'; p.className = 'mv-poster has'; };
      img.src = IMG + d.poster;
    }
    c.className = 'mv-card' + (i === sel ? ' focus' : '') + (i === last ? ' last' : '');
  }

  function focus() {
    for (var i = 0; i < FILMS.length; i++) paint(i);
    var row = Math.floor(sel / COLS), rows = Math.ceil(FILMS.length / COLS);
    var first = Math.max(0, Math.min(rows - 2, row - 0));   // två rader syns; den valda överst
    grid.style.webkitTransform = grid.style.transform = 'translateY(' + (-first * (H + GAP_Y)) + 'px)';
  }

  function say(text) {
    var m = document.getElementById('mvmsg');
    if (!m) return;
    m.textContent = text;
    m.className = 'mv-msg show';
    clearTimeout(msgTimer);
    msgTimer = setTimeout(function () { m.className = 'mv-msg'; }, 6000);
  }

  // MARK: - Öppna filmen

  /** Tjänsterna (TMDB:s namn) → appen på TV:n, via TV.apps. */
  function findApp(apps, provider) {
    var p = fold(provider).replace(/plus$/, '').replace(/standardwithads|basicwithads|amazonchannel$/, '');
    for (var i = 0; i < apps.length; i++) {
      var t = fold(apps[i].title);
      if (p && (t.indexOf(p) === 0 || p.indexOf(t) === 0)) return apps[i];
    }
    return null;
  }

  function play() {
    var f = FILMS[sel], d = info[f[0]];
    last = sel;
    save();
    focus();
    var where = d && d.where ? d.where : ['Disney Plus'];
    if (!window.TV) return;
    TV.apps(function (apps) {
      for (var i = 0; i < where.length; i++) {
        var app = findApp(apps, where[i]);
        if (app) {
          say('Sök på "' + f[1] + '" i ' + app.title);
          setTimeout(function () { TV.launch(app.id, null, function () {}); }, 1200);
          return;
        }
      }
      if (d && d.where && d.where.length) say(f[1] + ' finns på ' + d.where.join(', ') + ', men appen finns inte på projektorn.');
      else if (d && d.rent) say(f[1] + ' går att hyra eller köpa, men ingår inte i någon tjänst just nu.');
      else if (d) say(f[1] + ' går inte att streama i Sverige just nu.');
      else say('Vet inte var ' + f[1] + ' finns (behöver TMDB-nyckeln). Prova Disney+.');
    });
  }

  // MARK: - Tangenter

  window.addEventListener('keydown', function (e) {
    if (!opened || e.defaultPrevented) return;   // spelaren (iptv.js, före oss) har redan tagit tangenten
    var k = e.keyCode, back = (window.TV && TV.keys && k === TV.keys.back) || k === 461 || k === 10009 || k === 27 || k === 8;
    e.preventDefault();
    e.stopPropagation();
    if (window.FreeMyTV && FreeMyTV.poke) FreeMyTV.poke();
    if (back) { close(); return; }
    if (k === 37 && sel % COLS > 0) sel--;
    else if (k === 39 && sel % COLS < COLS - 1 && sel < FILMS.length - 1) sel++;
    else if (k === 38 && sel >= COLS) sel -= COLS;
    else if (k === 40 && sel + COLS < FILMS.length) sel += COLS;
    else if (k === 40 && Math.floor(sel / COLS) < Math.floor((FILMS.length - 1) / COLS)) sel = FILMS.length - 1;
    else if (k === 13) { play(); return; }
    focus();
  }, true);   // före hemskärmens egna tangenter

  function open() {
    load();
    if (!root) build();
    sel = last >= 0 ? last : 0;
    root.className = 'marvel open';
    opened = true;
    focus();
    fetchAll();
  }

  function close() {
    opened = false;
    if (root) root.className = 'marvel';
  }

  return {open: open, close: close, isOpen: function () { return opened; }};
})();
