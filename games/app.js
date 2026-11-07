/*
 * Spel: the library. Shelves on the left (Senast spelade, Alla spel, each console, Inställningar), the games on the
 * right, from a folder in Google Drive (lib.js, drive-script.gs). OK on a game plays it (play.js); a game that was left
 * halfway asks first: continue or start over. A game controller works everywhere: the stick or pad moves, the bottom
 * button is OK, the right one is Back.
 * Free My TV sends the Drive link with it when it opens the app (app control, key "drive"), so it's set up once there.
 * ES5 only.
 */
var App = (function () {
  'use strict';
  var VERSION = '1.0';
  var K = {back: 10009, ok: 13, left: 37, up: 38, right: 39, down: 40, red: 403, exit: 10182};
  var COLS = 5, TILE_W = 272, TILE_H = 420;

  var games = [], shelves = [], shelfAt = 1, zone = 'side', at = 0, cardAt = 0, cardItems = [], ask = null, busy = false;

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, parent, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    if (parent) parent.appendChild(n);
    return n;
  }

  var toastTimer = null;
  function toast(t) {
    var n = $('toast');
    n.textContent = t;
    n.className = 'on';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { n.className = ''; }, 4200);
  }

  function link() { return Store.get('drive') || ''; }

  // MARK: - The TV: its keys, and what Free My TV sent

  function setupTv() {
    try {
      var keys = ['ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue', 'MediaPlay', 'MediaPause', 'MediaPlayPause', 'ChannelUp', 'ChannelDown'];
      for (var i = 0; i < keys.length; i++) { try { tizen.tvinputdevice.registerKey(keys[i]); } catch (e) {} }
    } catch (e) {}
    launchData();
    document.addEventListener('visibilitychange', function () { if (!document.hidden) launchData(); });
  }

  function launchData() {
    try {
      var req = tizen.application.getCurrentApplication().getRequestedAppControl();
      var d = req && req.appControl && req.appControl.data || [];
      for (var i = 0; i < d.length; i++) {
        if (d[i].key === 'drive' && d[i].value && d[i].value[0] && Drive.looksRight(d[i].value[0]) && d[i].value[0] !== link()) {
          Store.set('drive', d[i].value[0]);
          refresh(true);
        }
      }
    } catch (e) {}
  }

  // MARK: - The games

  function refresh(force) {
    var cached = Store.get('list');
    if (cached && !force && Date.now() - (Store.get('listAt') || 0) < 24 * 3600 * 1000) { games = Library.build(cached); draw(); return; }
    if (cached) { games = Library.build(cached); draw(); }
    if (!link()) { draw(); return; }
    busy = true;
    drawHead('Hämtar spellistan från Google Drive…');
    Drive.list(link(), function (err, files) {
      busy = false;
      if (err) {
        toast('Google Drive: ' + err.message);
        if (!cached) { games = []; draw(); }
        drawHead();
        return;
      }
      Store.set('list', files);
      Store.set('listAt', Date.now());
      games = Library.build(files);
      if (force) toast(games.length ? games.length + ' spel i din Drive-mapp.' : 'Inga spel hittades i mappen. Se Inställningar.');
      draw();
    });
  }

  function makeShelves() {
    var s = [], recent = (Store.get('recent') || []).filter(function (id) { return byId(id); });
    if (recent.length) s.push({id: 'recent', name: 'Senast spelade', list: recent.map(byId)});
    s.push({id: 'all', name: 'Alla spel', list: games});
    Library.SYSTEMS.forEach(function (sys) {
      var l = games.filter(function (g) { return g.system === sys.id; });
      if (l.length) s.push({id: sys.id, name: sys.name, list: l, color: sys.color[0]});
    });
    s.push({id: 'settings', name: 'Inställningar', list: []});
    return s;
  }
  function byId(id) { for (var i = 0; i < games.length; i++) if (games[i].id === id) return games[i]; return null; }
  function shelf() { return shelves[shelfAt] || shelves[0]; }

  // MARK: - Drawing

  function draw() {
    var keep = shelf() && shelf().id;
    shelves = makeShelves();
    shelfAt = 0;
    for (var i = 0; i < shelves.length; i++) if (shelves[i].id === keep) shelfAt = i;
    drawSide();
    drawMain();
  }

  function drawSide() {
    var s = $('side');
    s.innerHTML = '';
    el('div', 'app', s, 'Spel');
    el('div', 'sub', s, link() ? games.length + ' spel från Google Drive' : 'Inte kopplad till Google Drive');
    for (var i = 0; i < shelves.length; i++) {
      if (shelves[i].id === 'settings') el('div', 'gap', s);
      var r = el('div', 'shelf' + (i === shelfAt ? ' sel' : '') + (zone === 'side' && i === shelfAt ? ' focus' : '') + (shelves[i].color ? ' dot' : ''), s, shelves[i].name);
      if (shelves[i].list.length && shelves[i].id !== 'settings') el('span', 'n', r, String(shelves[i].list.length));
      (function (i) { r.onclick = function () { shelfAt = i; zone = 'side'; at = 0; drawSide(); drawMain(); }; })(i);
      if (shelves[i].color) r.className += ' c-' + shelves[i].id;
    }
    var pad = el('div', 'pad', s);
    var p = pad1();
    pad.innerHTML = p ? '<b>●</b> Handkontroll ansluten' : 'Ingen handkontroll: anslut en via<br>Bluetooth i TV:ns inställningar';
    dotColors();
  }

  var dotsDone = false;
  function dotColors() {
    if (dotsDone) return;
    dotsDone = true;
    var css = '';
    Library.SYSTEMS.forEach(function (s) { css += '#side .shelf.c-' + s.id + ':before{background:' + s.color[0] + '}'; });
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  }

  function drawHead(note) {
    var h = $('head');
    h.innerHTML = '';
    var sh = shelf();
    el('div', 't', h, sh ? sh.name : 'Spel');
    el('div', 'r', h, note || (busy ? 'Hämtar…' : (sh && sh.id !== 'settings' && link() ? 'OK spelar · Tillbaka till hyllorna' : '')));
  }

  function drawMain() {
    drawHead();
    var g = $('grid');
    g.innerHTML = '';
    var sh = shelf();
    if (!link() || (sh && sh.id === 'settings')) { drawSettings(g); return; }
    if (!sh.list.length) {
      var c = el('div', 'card', g);
      c.style.top = '0';
      el('h2', '', c, games.length ? 'Inga spel här' : 'Mappen är tom');
      el('div', '', c, games.length ? 'Välj en annan hylla.' : 'Lägg spelfiler i din Drive-mapp (gärna i undermappar per konsol) och välj Uppdatera under Inställningar.');
      return;
    }
    var rail = el('div', 'rail', g);
    var list = sh.list, row = Math.floor(at / COLS);
    rail.style.transform = rail.style.webkitTransform = 'translateY(' + (-Math.max(0, row - 1) * TILE_H) + 'px)';
    var first = Math.max(0, (row - 2) * COLS), last = Math.min(list.length, (row + 4) * COLS);
    for (var i = first; i < last; i++) tile(rail, list[i], i);
  }

  function tile(parent, gm, i) {
    var sys = Library.system(gm.system);
    var t = el('div', 'tile' + (zone === 'grid' && i === at ? ' focus' : ''), parent);
    t.style.left = (i % COLS) * TILE_W + 'px';
    t.style.top = Math.floor(i / COLS) * TILE_H + 'px';
    var art = el('div', 'art', t);
    var gen = el('div', 'gen', art);
    gen.style.background = 'linear-gradient(155deg, ' + sys.color[0] + ', ' + sys.color[1] + ')';
    el('div', 'ring', gen);
    el('div', 'sys', gen, sys.name);
    el('div', 'nm', gen, gm.title);
    if (gm.cover) cover(gm, art, gen);
    el('div', 'name', t, gm.title);
    el('div', 'meta', t, sys.name + (gm.tags ? ' · ' + gm.tags : ''));
    (function (i) { t.onclick = function () { at = i; zone = 'grid'; open(shelf().list[i]); }; })(i);
  }

  // Covers: an image in the folder with the game's name, fetched once and kept.
  var coverUrls = {}, coverQueue = [], coverBusy = false;
  function cover(gm, art, gen) {
    if (coverUrls[gm.cover]) { show(coverUrls[gm.cover]); return; }
    Store.dbGet('covers', gm.cover, function (v) {
      if (v) { coverUrls[gm.cover] = URL.createObjectURL(new Blob([v.data], {type: v.type})); show(coverUrls[gm.cover]); return; }
      coverQueue.push(function (next) {
        Drive.file(link(), gm.cover, null, function (err, bytes) {
          if (!err && bytes) {
            var type = /\.png$/i.test(gm.cover) ? 'image/png' : 'image/jpeg';
            if (bytes[0] === 0x89) type = 'image/png'; else if (bytes[0] === 0x52) type = 'image/webp'; else if (bytes[0] === 0x47) type = 'image/gif';
            Store.dbPut('covers', gm.cover, {data: bytes, type: type});
            coverUrls[gm.cover] = URL.createObjectURL(new Blob([bytes], {type: type}));
            show(coverUrls[gm.cover]);
          }
          next();
        });
      });
      pump();
    });
    function show(u) { art.style.backgroundImage = 'url("' + u + '")'; gen.style.display = 'none'; }
  }
  function pump() {
    if (coverBusy || !coverQueue.length) return;
    coverBusy = true;
    coverQueue.shift()(function () { coverBusy = false; pump(); });
  }

  // MARK: - Settings (and the first start, before Drive is linked)

  function drawSettings(g) {
    var c = el('div', 'card', g);
    c.style.top = '0';
    cardItems = [];
    if (!link()) {
      el('h2', '', c, 'Koppla din Google Drive');
      c.insertAdjacentHTML('beforeend', '<ol>'
        + '<li>Skapa en mapp i Google Drive, t.ex. <b>Spel</b>, med undermappar per konsol (NES, SNES, Game Boy, Game Boy Color, Game Boy Advance, Mega Drive, Master System) och lägg dina spelfiler där.</li>'
        + '<li>Gå till <b>script.google.com</b>, skapa ett nytt projekt och klistra in skriptet <code>drive-script.gs</code> med mappens id.</li>'
        + '<li>Driftsätt som webbapp (Kör som: Jag, Åtkomst: Alla) och skicka adressen hit: mobilsidan i Free My TV → Inställningar → Spel, eller skriv in den nedan.</li></ol>');
    } else {
      el('h2', '', c, 'Inställningar');
      el('div', '', c, 'Google Drive-skriptets adress:');
    }
    var inp = el('input', 'link', c);
    inp.type = 'text';
    inp.setAttribute('placeholder', 'https://script.google.com/macros/s/…/exec');
    inp.value = link();
    cardItems.push({input: inp});
    var b = el('div', 'btns', c);
    cardItems.push({btn: el('div', 'btn', b, 'Spara'), run: function () { saveLink(inp.value); }});
    if (link()) {
      cardItems.push({btn: el('div', 'btn', b, 'Uppdatera spellistan'), run: function () { refresh(true); }});
      cardItems.push({btn: el('div', 'btn', b, 'Rensa sparade spelfiler'), run: function () {
        Store.dbClear('roms', function () { Store.dbClear('covers', function () { coverUrls = {}; toast('Spelfilerna hämtas från Drive igen nästa gång. Dina sparade lägen finns kvar.'); }); });
      }});
    }
    var lr = Play.lastRun();
    if (lr) {
      el('div', 'small', c, 'Senaste start: ' + lr.game + ' (' + lr.system + ')' + (lr.ok ? ', startade.' : ', STARTADE INTE. Ta gärna en bild av det här.'));
      el('div', 'log', c, lr.steps.join('\n'));
    } else el('div', 'small', c, 'TV:n: ' + Play.support());
    el('div', 'small', c, 'Kontroller: en handkontroll (Bluetooth eller USB) fungerar som på konsolen. Med fjärrkontrollen: pilar, OK = A, röd = B, grön = Y, gul = X, blå = Select, ▶ = Start. '
      + 'Tillbaka (eller Select + Start på handkontrollen) öppnar menyn i spelet. Spel · version ' + VERSION + ' · EmulatorJS 4.2.3 (GPL-3.0).');
    markCard();
  }

  function markCard() {
    for (var i = 0; i < cardItems.length; i++) {
      var n = cardItems[i].input || cardItems[i].btn;
      n.className = n.className.replace(/\s*\bfocus\b/g, '') + (zone === 'card' && i === cardAt ? ' focus' : '');
    }
  }

  function saveLink(v) {
    v = String(v || '').trim();
    if (!Drive.looksRight(v)) { toast('Adressen ska börja med https://script.google.com/ och sluta på /exec.'); return; }
    toast('Provar adressen…');
    Drive.list(v, function (err, files) {
      if (err) { toast('Fungerade inte: ' + err.message); return; }
      Store.set('drive', v);
      Store.set('list', files);
      Store.set('listAt', Date.now());
      games = Library.build(files);
      toast('Sparad. ' + games.length + ' spel hittades.');
      zone = 'side';
      shelfAt = 0;
      draw();
    });
  }

  // MARK: - Playing a game

  function open(gm) {
    if (!gm) return;
    Store.dbGet('states', gm.id + ':auto', function (v) {
      if (!v) { go(gm, null); return; }
      ask = {game: gm, at: 0, items: [['Fortsätt där du slutade', function () { go(gm, new Uint8Array(v.state)); }],
        ['Börja från början', function () { Store.dbDel('states', gm.id + ':auto'); go(gm, null); }], ['Avbryt', function () {}]]};
      drawAsk();
    });
  }

  function drawAsk() {
    var a = $('ask');
    if (!ask) { a.style.display = 'none'; return; }
    a.innerHTML = '';
    var box = el('div', 'box', a);
    el('div', 'h', box, ask.game.title);
    el('div', 's', box, Library.system(ask.game.system).name);
    ask.items.forEach(function (it, i) {
      var b = el('div', 'item' + (i === ask.at ? ' focus' : ''), box, it[0]);
      b.onclick = function () { var f = it[1]; ask = null; drawAsk(); f(); };
    });
    a.style.display = 'block';
  }

  function go(gm, state) {
    getRom(gm, function (rom) {
      if (!rom) return;
      Store.played(gm.id);
      Play.start(gm, rom, state, function () { draw(); });
    });
  }

  function getRom(gm, done) {
    Store.dbGet('roms', gm.id, function (v) {
      if (v && v.modified === gm.modified) { done(new Uint8Array(v.data)); return; }
      var a = $('ask');
      a.innerHTML = '';
      var box = el('div', 'box', a);
      el('div', 'h', box, gm.title);
      var s = el('div', 's', box, 'Hämtar från Google Drive…');
      var bar = el('div', 'bar', box), fill = el('i', '', bar);
      bar.style.width = '100%';
      a.style.display = 'block';
      loadingRom = true;
      Drive.file(link(), gm.id, function (p) { fill.style.width = Math.round(p * 100) + '%'; s.textContent = 'Hämtar från Google Drive… ' + Math.round(p * 100) + ' %'; }, function (err, bytes) {
        loadingRom = false;
        a.style.display = 'none';
        if (err) { toast('Kunde inte hämta spelet: ' + err.message); done(null); return; }
        Store.dbPut('roms', gm.id, {data: bytes, modified: gm.modified});
        done(bytes);
      });
    });
  }
  var loadingRom = false;

  // MARK: - Keys

  function key(e) {
    var k = e.keyCode;
    if (Play.playing()) { if (Play.key(e)) e.preventDefault(); return; }
    var f = document.activeElement;
    if (f && f.tagName === 'INPUT') {
      if (k === K.ok || k === 65376) { e.preventDefault(); f.blur(); var it = cardItems[cardAt]; if (it && it.input) saveLink(f.value); return; }
      if (k === K.back || k === 27 || k === 65385 || k === K.up || k === K.down) { e.preventDefault(); f.blur(); if (k === K.down) { cardAt = Math.min(cardItems.length - 1, cardAt + 1); markCard(); } return; }
      return;
    }
    if (loadingRom) { e.preventDefault(); return; }
    e.preventDefault();
    handle(k);
  }

  function handle(k) {
    if (ask) {
      if (k === K.up) ask.at = Math.max(0, ask.at - 1);
      else if (k === K.down) ask.at = Math.min(ask.items.length - 1, ask.at + 1);
      else if (k === K.ok) { var f = ask.items[ask.at][1]; ask = null; drawAsk(); f(); return; }
      else if (k === K.back || k === 27 || k === 8) ask = null;
      drawAsk();
      return;
    }
    var sh = shelf(), n = sh ? sh.list.length : 0;
    if (zone === 'side') {
      if (k === K.up) { shelfAt = Math.max(0, shelfAt - 1); at = 0; }
      else if (k === K.down) { shelfAt = Math.min(shelves.length - 1, shelfAt + 1); at = 0; }
      else if (k === K.right || k === K.ok) {
        if (sh.id === 'settings' || !link()) { zone = 'card'; cardAt = 0; }
        else if (n) zone = 'grid';
      }
      else if (k === K.back || k === 27 || k === K.exit) { exit(); return; }
      drawSide(); drawMain();
      return;
    }
    if (zone === 'card') {
      var item = cardItems[cardAt];
      if (k === K.up) { if (cardAt > 0) cardAt = item && item.btn && cardItems[0].input ? 0 : cardAt - 1; }
      else if (k === K.down) { if (item && item.input) cardAt = Math.min(cardItems.length - 1, 1); }
      else if (k === K.left) { if (item && item.btn && cardAt > 1) cardAt--; else { zone = 'side'; drawSide(); } }
      else if (k === K.right) { if (item && item.btn && cardAt < cardItems.length - 1) cardAt++; }
      else if (k === K.ok) { if (item && item.input) item.input.focus(); else if (item) item.run(); return; }
      else if (k === K.back || k === 27 || k === 8) { zone = 'side'; drawSide(); }
      markCard();
      return;
    }
    // the grid
    if (k === K.left) { if (at % COLS === 0) { zone = 'side'; drawSide(); } else at--; }
    else if (k === K.right) { if (at + 1 < n && (at + 1) % COLS !== 0) at++; }
    else if (k === K.up) { if (at >= COLS) at -= COLS; }
    else if (k === K.down) { if (at + COLS < n) at += COLS; else if (Math.floor(at / COLS) < Math.floor((n - 1) / COLS)) at = n - 1; }
    else if (k === K.ok) { open(sh.list[at]); return; }
    else if (k === K.back || k === 27 || k === 8) { zone = 'side'; drawSide(); }
    drawMain();
  }

  function exit() { try { tizen.application.getCurrentApplication().exit(); } catch (e) {} }

  // The controller in the library: pad or stick moves, bottom button OK, right button Back.
  function pad1() {
    var pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (var i = 0; i < pads.length; i++) if (pads[i] && pads[i].connected) return pads[i];
    return null;
  }
  var prev = {}, repeatAt = 0, hadPad = false;
  setInterval(function () {
    var p = pad1();
    if (!!p !== hadPad) { hadPad = !!p; drawSide(); if (p) toast('Handkontroll ansluten'); }
    if (!p || Play.playing()) { prev = {}; return; }
    var b = function (n) { return !!(p.buttons[n] && p.buttons[n].pressed); };
    var ax = p.axes || [];
    var now = {up: b(12) || ax[1] < -0.6, down: b(13) || ax[1] > 0.6, left: b(14) || ax[0] < -0.6, right: b(15) || ax[0] > 0.6, ok: b(0), back: b(1)};
    var codes = {up: K.up, down: K.down, left: K.left, right: K.right, ok: K.ok, back: K.back}, t = Date.now();
    for (var name in now) {
      if (!now[name]) continue;
      var fresh = !prev[name], held = /up|down|left|right/.test(name) && t > repeatAt;
      if (fresh || held) {
        repeatAt = t + (fresh ? 420 : 110);
        if (document.activeElement && document.activeElement.tagName === 'INPUT') document.activeElement.blur();
        if (!loadingRom) handle(codes[name]);
      }
    }
    prev = now;
  }, 50);

  document.addEventListener('keydown', key);

  setupTv();
  (function () {
    var lr = Play.lastRun();
    if (lr && !lr.ok && !lr.seen && Date.now() - lr.at < 6 * 3600 * 1000) {
      setTimeout(function () { toast('Förra spelstarten (' + lr.game + ') fastnade. Se Inställningar → Senaste start.'); }, 800);
      lr.seen = true; lr.steps.push('(appen startades om)');
      try { localStorage.setItem('spel.lastrun', JSON.stringify(lr)); } catch (e) {}
    }
  })();
  if (!link()) zone = 'side';
  refresh(false);
  if (!games.length) draw();

  return {toast: toast, refresh: refresh, _games: function () { return games; }};
})();
