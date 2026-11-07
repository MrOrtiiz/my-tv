/*
 * The parental lock and the groups editor.
 * - Lock: a 4-digit PIN kept only on the TV. Groups (and film and series categories) that look adult are locked by
 *   themselves; any other can be locked by hand under Grupper. A locked group shows 🔒 and nothing in it until the PIN
 *   is typed; then everything is open until the app is closed, at most 3 hours. Locked groups' channels also stay out
 *   of Alla kanaler, Favoriter, Senast sedda, the guide and Sport.
 * - Grupper: every group in Yuri's order: OK lifts one (▲ ▼ moves it, OK puts it down), a group can be hidden, and
 *   locked or opened.
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

  // MARK: - Grupper: order, hide, lock

  function editor() {
    var u = U(), o = $('overlay');
    var list = u.ordered();
    if (!list.length) { u.toast('Inga grupper än: kanallistan är inte hämtad.'); return; }
    o.innerHTML = '';
    o.className = 'on';
    var st = {kind: 'groups', col: 0, grab: false};
    var sheet = u.el('div', 'sheet edit glass', o);
    u.el('div', 'dtitle', sheet, 'Grupper');
    var hint = u.el('div', 'psub', sheet, '');
    var host = u.el('div', 'elist', sheet);
    var hidden = Store.hidden();
    var L = new u.List(host, 74, function (g, r, i) {
      if (st.grab && i === L.at) r.className += ' grab';
      u.el('div', 'name', r, (st.grab && i === L.at ? '↕  ' : '') + g.name);
      if (g.lang) u.el('span', 'lang lang-' + g.lang.toLowerCase(), r, g.lang);
      var pills = u.el('div', 'pills', r);
      var p1 = u.el('span', 'pill' + (hidden[g.id] ? ' off' : '') + (i === L.at && L.focused && st.col === 1 ? ' focus' : ''), pills, hidden[g.id] ? 'Dold' : 'Visas');
      var lk = on() && lockedBy(g);
      var p2 = u.el('span', 'pill' + (lk ? ' lock' : '') + (i === L.at && L.focused && st.col === 2 ? ' focus' : ''), pills, lk ? '🔒 Låst' : 'Öppen');
      if (i === L.at && L.focused && st.col === 0) r.className += ' focus';
      else if (i === L.at) r.className = r.className.replace(' focus', '');
    });
    function setHint() {
      hint.textContent = st.grab ? '▲ ▼ flyttar gruppen · OK släpper den'
        : st.col === 0 ? 'OK lyfter gruppen så att du kan flytta den · ▶ dölj eller lås · Tillbaka sparar'
        : st.col === 1 ? 'OK döljer eller visar gruppen' : on() ? 'OK låser eller öppnar gruppen (PIN-kod)' : 'OK: välj en PIN-kod för att kunna låsa grupper';
    }
    function save() { Store.groupOrder(L.items.map(function (g) { return g.id; })); }
    st.handle = function (k) {
      var g = L.current();
      if (st.grab) {
        if (k === 38 || k === 40) {
          var a = L.at, b = a + (k === 38 ? -1 : 1);
          if (b >= 0 && b < L.items.length) { var t = L.items[a]; L.items[a] = L.items[b]; L.items[b] = t; L.at = b; save(); }
        } else if (k === 13 || k === 10009 || k === 27) { st.grab = false; save(); }
        L.draw(); setHint();
        return;
      }
      if (k === 38) L.move(-1);
      else if (k === 40) L.move(1);
      else if (k === 37 && st.col > 0) st.col--;
      else if (k === 39 && st.col < 2) st.col++;
      else if (k === 13 && g) {
        if (st.col === 0) st.grab = true;
        else if (st.col === 1) { hidden[g.id] = !hidden[g.id]; if (!hidden[g.id]) delete hidden[g.id]; Store.hidden(hidden); }
        else if (!on()) { newPin(function () { u.toast('Föräldralåset är på'); editor(); }); return; }
        else {
          ask(function (ok) {
            if (!ok) { editor(); return; }
            var l = Store.locks(); l[g.id] = !lockedBy(g); Store.locks(l);
            var at = L.at; editor(); var s2 = u.overlay(); if (s2 && s2.list) { s2.list.at = at; s2.col = 2; s2.list.draw(); }
          });
          return;
        }
      } else if (k === 10009 || k === 27) { u.overlay(null); u.toast('Sparat'); u.redraw(); return; }
      L.draw(); setHint();
    };
    st.list = L;
    u.overlay(st);
    L.focused = true;
    L.set(list, 0);
    setHint();
  }

  return {locked: locked, lockedBy: lockedBy, on: on, open: isOpen, ask: ask, settings: settings, editor: editor};
})();
