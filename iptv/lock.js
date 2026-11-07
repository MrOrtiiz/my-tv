/*
 * The parental lock and the groups editor.
 * - Lock: a 4-digit PIN kept only on the TV. Groups (and film and series categories) that look adult are locked by
 *   themselves; any other can be locked by hand under Grupper. A locked group shows 🔒 and nothing in it until the PIN
 *   is typed; then everything is open until the app is closed, at most 3 hours. Locked groups' channels also stay out
 *   of Alla kanaler, Favoriter, Senast sedda, the guide and Sport.
 * - Grupper, Filmer, Serier (Inställningar, or ✎ last in Live, Filmer and Serier): every group or category in Yuri's
 *   order: OK lifts one (▲ ▼ moves it, OK puts it down), each can be hidden, and locked or opened; on top, Lås alla /
 *   Öppna alla and Dölj alla / Visa alla.
 * Uses App.u (app.js). ES5 only.
 */
var Lock = (function () {
  'use strict';
  var ADULT = /adult|xxx|\+\s?18|18\s?\+|porn|erotic|for adults|adultos|vuxen|hentai|playboy|hustler|brazzers|private\s?tv/i;
  var HOURS = 3;
  var openUntil = 0;

  function U() { return App.u; }
  function on() { return !!Store.pin(); }
  function isOpen() { return Date.now() < openUntil; }

  /** Is it locked by the settings (open or not right now)? */
  function lockedBy(g) {
    var l = Store.locks();
    if (l.hasOwnProperty(g.id)) return !!l[g.id];
    return ADULT.test(g.name || '');
  }
  /** Is it locked right now? */
  function locked(g) { return !!g && on() && !isOpen() && g.id && g.id.charAt(0) !== '*' && lockedBy(g); }

  function $(id) { return document.getElementById(id); }

  // MARK: - The PIN pad

  var KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', '✓'];

  /** A PIN pad: check(code) returns true to close it, or a message to show (and start over). cancel() on Back. */
  function pad(title, sub, check, cancel) {
    var u = U(), o = $('overlay');
    o.innerHTML = '';
    o.className = 'on';
    var st = {kind: 'pin', code: '', at: 4, msg: ''};
    var sheet = u.el('div', 'sheet pin glass', o);
    u.el('div', 'dtitle', sheet, title);
    var subEl = u.el('div', 'psub', sheet, sub);
    var dots = u.el('div', 'dots', sheet), grid = u.el('div', 'pad', sheet);
    u.el('div', 'hint', sheet, 'Sifferknapparna på fjärrkontrollen fungerar också. Tillbaka avbryter.');
    function draw() {
      dots.innerHTML = '';
      for (var i = 0; i < 4; i++) u.el('span', 'dot' + (i < st.code.length ? ' on' : ''), dots);
      subEl.textContent = st.msg || sub;
      subEl.className = 'psub' + (st.msg ? ' err' : '');
      grid.innerHTML = '';
      for (var k = 0; k < KEYS.length; k++) u.el('div', 'pkey' + (k === st.at ? ' focus' : ''), grid, KEYS[k]);
    }
    function add(d) {
      if (st.code.length >= 4) return;
      st.code += d; st.msg = '';
      draw();
      if (st.code.length === 4) setTimeout(function () {
        var r = check(st.code);
        if (r === true) return;
        st.code = ''; st.msg = r || 'Fel kod, försök igen.'; draw();
      }, 180);
    }
    st.handle = function (k) {
      if (k >= 48 && k <= 57) { add(String(k - 48)); return; }
      if (k >= 96 && k <= 105) { add(String(k - 96)); return; }
      if (k === 8) { st.code = st.code.slice(0, -1); draw(); return; }
      if (k === 37 && st.at % 3) st.at--;
      else if (k === 39 && st.at % 3 < 2) st.at++;
      else if (k === 38 && st.at >= 3) st.at -= 3;
      else if (k === 40 && st.at < 9) st.at += 3;
      else if (k === 13) {
        var key = KEYS[st.at];
        if (key === '⌫') st.code = st.code.slice(0, -1);
        else if (key === '✓') { if (st.code.length === 4) { var r = check(st.code); if (r !== true) { st.code = ''; st.msg = r || 'Fel kod.'; } } }
        else { add(key); return; }
      } else if (k === 10009 || k === 27) { u.overlay(null); if (cancel) cancel(); return; }
      draw();
    };
    u.overlay(st);
    draw();
  }

  /** Asks for the PIN when something locked is opened; cb(true) when it's open (or there's no lock). */
  function ask(cb) {
    if (!on() || isOpen()) { cb(true); return; }
    pad('Föräldralås', 'Skriv PIN-koden för att låsa upp', function (code) {
      if (code !== Store.pin()) return 'Fel kod, försök igen.';
      openUntil = Date.now() + HOURS * 3600000;
      U().overlay(null);
      U().toast('Upplåst tills appen stängs (högst ' + HOURS + ' timmar)', 4500);
      cb(true);
      return true;
    }, function () { cb(false); });
  }

  /** A new PIN, typed twice. */
  function newPin(done) {
    pad('Välj en PIN-kod', 'Fyra siffror', function (first) {
      pad('Skriv PIN-koden igen', 'Samma fyra siffror', function (again) {
        if (again !== first) { setTimeout(function () { newPin(done); }, 0); U().toast('Koderna var olika, börja om.'); return true; }
        Store.pin(first);
        openUntil = 0;
        U().overlay(null);
        if (done) done();
        return true;
      });
      return true;
    });
  }

  // MARK: - A menu sheet (buttons one under the other)

  function menu(title, sub, items) {
    var u = U(), o = $('overlay');
    o.innerHTML = '';
    o.className = 'on';
    var st = {kind: 'menu', at: 0};
    var sheet = u.el('div', 'sheet pin glass', o);
    u.el('div', 'dtitle', sheet, title);
    u.el('div', 'psub', sheet, sub);
    var host = u.el('div', 'mbuttons', sheet);
    function draw() {
      host.innerHTML = '';
      for (var i = 0; i < items.length; i++) u.el('div', 'button' + (i === st.at ? ' focus' : ''), host, items[i][0]);
    }
    st.handle = function (k) {
      if (k === 38 && st.at > 0) st.at--;
      else if (k === 40 && st.at < items.length - 1) st.at++;
      else if (k === 13) { items[st.at][1](); return; }
      else if (k === 10009 || k === 27) { u.overlay(null); return; }
      draw();
    };
    u.overlay(st);
    draw();
  }

  /** Inställningar → Föräldralås. */
  function settings() {
    var u = U();
    if (!on()) {
      newPin(function () { u.toast('Föräldralåset är på. Vuxengrupper är låsta, fler låser du under Grupper.', 6000); u.redraw(); });
      return;
    }
    ask(function (ok) {
      if (!ok) return;
      menu('Föräldralås', 'Låset är på. Låsta grupper väljer du under Grupper.', [
        ['Lås igen nu', function () { openUntil = 0; u.overlay(null); u.toast('Låst'); u.redraw(); }],
        ['Byt PIN-kod', function () { newPin(function () { u.toast('Ny PIN-kod sparad'); u.redraw(); }); }],
        ['Stäng av föräldralåset', function () { Store.pin(''); openUntil = 0; u.overlay(null); u.toast('Föräldralåset är av'); u.redraw(); }]
      ]);
    });
  }

  // MARK: - Grupper, Filmer, Serier: order, hide, lock

  var KINDS = {live: 'Grupper', films: 'Filmer', series: 'Serier'};

  /** The editor for the live groups (kind 'live' or none) or the film or series categories ('films', 'series'). */
  function editor(kind) {
    var u = U();
    kind = KINDS[kind] ? kind : 'live';
    if (kind === 'live') {
      var groups = u.ordered();
      if (!groups.length) { u.toast('Inga grupper än: kanallistan är inte hämtad.'); return; }
      sheet(kind, groups, Store.hidden(), function (h) { Store.hidden(h); },
        function (items) { Store.groupOrder(items.map(function (g) { return g.id; })); });
      return;
    }
    if (!Store.link()) { u.toast('Lägg in din IPTV-länk först.'); return; }
    Api.use(Store.link());
    u.toast('Hämtar kategorierna…', 1500);
    (kind === 'films' ? Api.filmCats : Api.seriesCats)(function (err, cats) {
      if (err || !cats || !cats.length) { u.toast(err ? 'Kunde inte hämta: ' + err.message : 'Inga kategorier.'); return; }
      // Their lock and hidden ids are kind:id (as in the Filmer and Serier tabs).
      var items = u.vodOrdered(kind, cats).map(function (c) { return {id: kind + ':' + c.id, cid: c.id, name: c.name, lang: Lang.tag(c.name)}; });
      sheet(kind, items, Store.vodHidden(), function (h) { Store.vodHidden(h); },
        function (list) { Store.vodOrder(kind, list.map(function (c) { return c.cid; })); });
    });
  }

  function sheet(kind, list, hidden, saveHidden, saveOrder) {
    var u = U(), o = $('overlay');
    o.innerHTML = '';
    o.className = 'on';
    // bar: the row of buttons on top (Lås alla / Öppna alla, Dölj alla / Visa alla), reached with ▲ from the first row.
    var st = {kind: 'groups', col: 0, grab: false, bar: false, barAt: 0};
    var box = u.el('div', 'sheet edit glass', o);
    u.el('div', 'dtitle', box, KINDS[kind] + ' – ordna, dölj och lås');
    var hint = u.el('div', 'psub', box, '');
    var bar = u.el('div', 'ebar', box);
    var host = u.el('div', 'elist', box);
    var word = kind === 'live' ? 'gruppen' : 'kategorin';
    var L = new u.List(host, 74, function (g, r, i) {
      if (st.grab && i === L.at) r.className += ' grab';
      u.el('div', 'name', r, (st.grab && i === L.at ? '↕  ' : '') + g.name);
      if (g.lang) u.el('span', 'lang lang-' + g.lang.toLowerCase(), r, g.lang);
      var pills = u.el('div', 'pills', r);
      u.el('span', 'pill' + (hidden[g.id] ? ' off' : '') + (i === L.at && L.focused && st.col === 1 ? ' focus' : ''), pills, hidden[g.id] ? 'Dold' : 'Visas');
      var lk = on() && lockedBy(g);
      u.el('span', 'pill' + (lk ? ' lock' : '') + (i === L.at && L.focused && st.col === 2 ? ' focus' : ''), pills, lk ? '🔒 Låst' : 'Öppen');
      if (i === L.at && L.focused && st.col === 0) r.className += ' focus';
      else if (i === L.at) r.className = r.className.replace(' focus', '');
    });
    function allLocked() { return on() && L.items.every(function (g) { return lockedBy(g); }); }
    function allShown() { return L.items.every(function (g) { return !hidden[g.id]; }); }
    function buttons() {
      return [[allLocked() ? 'Öppna alla' : '🔒  Lås alla', function () { lockAll(!allLocked()); }],
        [allShown() ? 'Dölj alla' : 'Visa alla', function () { showAll(!allShown()); }]];
    }
    function drawBar() {
      bar.innerHTML = '';
      var b = buttons();
      for (var i = 0; i < b.length; i++) u.el('span', 'pill ebtn' + (st.bar && st.barAt === i ? ' focus' : ''), bar, b[i][0]);
    }
    function draw() { L.focused = !st.bar; L.draw(); drawBar(); setHint(); }
    function setHint() {
      hint.textContent = st.bar ? (st.barAt === 0 ? 'OK låser eller öppnar alla på en gång (PIN-kod)' : 'OK visar eller döljer alla på en gång') + ' · ▼ tillbaka till listan'
        : st.grab ? '▲ ▼ flyttar ' + word + ' · OK släpper den'
        : st.col === 0 ? 'OK lyfter ' + word + ' så att du kan flytta den · ▶ dölj eller lås · ▲ överst: alla på en gång · Tillbaka sparar'
        : st.col === 1 ? 'OK döljer eller visar ' + word : on() ? 'OK låser eller öppnar ' + word + ' (PIN-kod)' : 'OK: välj en PIN-kod för att kunna låsa';
    }
    function reopen(at, col, onBar) {
      // After a PIN pad: the same sheet again, where it was.
      sheet(kind, L.items, hidden, saveHidden, saveOrder);
      var s2 = u.overlay();
      if (s2 && s2.list) { s2.list.at = at; s2.col = col; s2.bar = !!onBar; s2.barAt = st.barAt; s2.redraw(); }
    }
    function withPin(then) {
      var at = L.at, col = st.col, onBar = st.bar;
      if (!on()) { newPin(function () { u.toast('Föräldralåset är på'); then(); reopen(at, col, onBar); }); return; }
      ask(function (ok) { if (ok) then(); reopen(at, col, onBar); });
    }
    function lockAll(lock) {
      withPin(function () {
        var l = Store.locks();
        L.items.forEach(function (g) { l[g.id] = lock; });
        Store.locks(l);
        u.toast(lock ? 'Alla är låsta' : 'Alla är öppna');
      });
    }
    function showAll(show) {
      L.items.forEach(function (g) { if (show) delete hidden[g.id]; else hidden[g.id] = true; });
      saveHidden(hidden);
      u.toast(show ? 'Alla visas' : 'Alla är dolda');
      draw();
    }
    function save() { saveOrder(L.items); }
    st.handle = function (k) {
      var g = L.current();
      if (st.bar) {
        if (k === 37 && st.barAt > 0) st.barAt--;
        else if (k === 39 && st.barAt < 1) st.barAt++;
        else if (k === 40) st.bar = false;
        else if (k === 13) { buttons()[st.barAt][1](); return; }
        else if (k === 10009 || k === 27) { u.overlay(null); u.toast('Sparat'); u.redraw(); return; }
        draw();
        return;
      }
      if (st.grab) {
        if (k === 38 || k === 40) {
          var a = L.at, b = a + (k === 38 ? -1 : 1);
          if (b >= 0 && b < L.items.length) { var t = L.items[a]; L.items[a] = L.items[b]; L.items[b] = t; L.at = b; save(); }
        } else if (k === 13 || k === 10009 || k === 27) { st.grab = false; save(); }
        draw();
        return;
      }
      if (k === 38) { if (!L.move(-1)) st.bar = true; }
      else if (k === 40) L.move(1);
      else if (k === 37 && st.col > 0) st.col--;
      else if (k === 39 && st.col < 2) st.col++;
      else if (k === 13 && g) {
        if (st.col === 0) st.grab = true;
        else if (st.col === 1) { hidden[g.id] = !hidden[g.id]; if (!hidden[g.id]) delete hidden[g.id]; saveHidden(hidden); }
        else { withPin(function () { var l = Store.locks(); l[g.id] = !lockedBy(g); Store.locks(l); }); return; }
      } else if (k === 10009 || k === 27) { u.overlay(null); u.toast('Sparat'); u.redraw(); return; }
      draw();
    };
    st.list = L;
    st.redraw = draw;
    u.overlay(st);
    L.set(list, 0);
    draw();
  }

  return {locked: locked, lockedBy: lockedBy, on: on, open: isOpen, ask: ask, settings: settings, editor: editor};
})();
