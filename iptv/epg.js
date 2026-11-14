/*
 * TV-guide as a grid: the groups on the left, then the channels of the group under a timeline of 2½ hours, from now and
 * as far ahead as the guide reaches. ◀ ▶ go from programme to programme (the timeline follows), ▲ ▼ between channels.
 * OK on what's on now plays the channel; OK on something later sets a reminder (🔔), OK again takes it away.
 * Preview: the channel you're on plays small in the corner, after a moment on it (Player.preview).
 * Search: "🔍 Sök" first among the groups: OK, write a channel's name, and the grid shows the channels found.
 * Reminders: a minute before the start a card comes up, wherever you are in the app (a film or a match too): OK
 * switches to the channel. They're kept on the TV; the app has to be open for them to show.
 * Uses App.u (app.js). ES5 only.
 */
var Epg = (function () {
  'use strict';
  var SPAN = 150 * 60000, STEP = 30 * 60000, ROW = 90;
  var V = null, focused = false;

  function U() { return App.u; }
  function floorStep(t) { return t - t % STEP; }

  // MARK: - Reminders

  function reminders() {
    var now = Date.now(), all = Store.reminders(), keep = all.filter(function (r) { return r.stop > now; });
    if (keep.length !== all.length) Store.reminders(keep);
    return keep.sort(function (a, b) { return a.start - b.start; });
  }
  function keyOf(ch, p) { return ch.id + ':' + p.start; }
  function has(ch, p) { var k = keyOf(ch, p), r = Store.reminders(); for (var i = 0; i < r.length; i++) if (r[i].key === k) return true; return false; }
  /** Sets a reminder for a programme, or takes it away. */
  function toggle(ch, p) {
    var k = keyOf(ch, p), r = Store.reminders(), out = r.filter(function (x) { return x.key !== k; });
    var on = out.length === r.length;
    if (on) out.push({key: k, ch: Store.slim(ch), title: p.title, start: p.start, stop: p.stop});
    Store.reminders(out);
    U().toast(on ? '🔔  Påminnelse ' + U().hm(p.start) + ': ' + p.title : 'Påminnelsen borttagen');
    return on;
  }

  var card = null, cardRem = null, cardTimer = 0;
  function check() {
    var now = Date.now(), r = Store.reminders();
    for (var i = 0; i < r.length; i++) {
      if (r[i].start - now <= 60000 && !r[i].shown && r[i].stop > now) {
        r[i].shown = true;
        Store.reminders(r);
        show(r[i]);
        return;
      }
    }
  }
  function show(rem) {
    var u = U();
    if (!card) { card = document.createElement('div'); card.id = 'remind'; card.className = 'glass'; document.body.appendChild(card); }
    card.innerHTML = '';
    u.el('div', 'rt', card, (rem.start > Date.now() ? 'Börjar ' + u.hm(rem.start) : 'Börjar nu') + '  ·  ' + rem.ch.name);
    u.el('div', 'rn', card, rem.title);
    u.el('div', 'rk', card, 'OK byter kanal  ·  Tillbaka stänger');
    card.className = 'glass on';
    cardRem = rem;
    clearTimeout(cardTimer);
    cardTimer = setTimeout(hide, 45000);
  }
  function hide() { if (card) card.className = 'glass'; cardRem = null; }
  /** Keys while the reminder card shows (first, before the player and everything else). */
  function remindKey(k, K) {
    if (!cardRem) return false;
    if (k === K.ok) {
      var rem = cardRem; hide();
      var ch = U().find(rem.ch.name, rem.ch.epg) || rem.ch;
      try { if (Player.playing()) Player.close(); } catch (e) {}
      Player.open([ch], 0, {title: rem.title});
      Store.reminders(Store.reminders().filter(function (x) { return x.key !== rem.key; }));
      return true;
    }
    if (k === K.back) { hide(); return true; }
    return false;
  }
  setInterval(check, 15000);
  setTimeout(check, 3000);

  // MARK: - The grid

  /** The TV guide in main. With opts.rows (a function giving the channels), only those channels and no groups column:
   *  the favourite channels under Favoriter → Kanaler; ◀ from a channel then answers 'left'. */
  function build(main, opts) {
    var u = U();
    if (opts && opts.rows) {
      var host = u.el('div', 'col grid glass fixed', main);
      V = {zone: 'grid', row: 0, first: 0, t0: floorStep(Date.now()), tc: Date.now(), rows: opts.rows(), area: host, fixed: opts.rows, groups: null};
      V.head = u.el('div', 'ghead', host);
      V.body = u.el('div', 'gbody', host);
      V.info = u.el('div', 'ginfo', host);
      V.pv = u.el('div', 'gpv', host);
      u.el('div', 'pvh', V.pv, 'Förhandsvisning');
      V.empty = opts.empty;
      draw();
      return;
    }
    main.className = 'epg';
    var gHost = u.el('div', 'col groups glass', main), area = u.el('div', 'col grid glass', main);
    V = {zone: 'grid', row: 0, first: 0, t0: floorStep(Date.now()), tc: Date.now(), rows: [], area: area};
    V.groups = new u.List(gHost, 76, function (g, r) {
      u.el('div', 'name', r, g.name);
      if (g.lang) u.el('span', 'lang lang-' + g.lang.toLowerCase(), r, g.lang);
      if (Lock.locked(g)) u.el('span', 'n', r, '🔒');
      else if (g.id === '*search' && g.n) u.el('span', 'n', r, String(g.n));
    });
    V.head = u.el('div', 'ghead', area);
    V.body = u.el('div', 'gbody', area);
    V.info = u.el('div', 'ginfo', area);
    // The preview: the channel you're on, playing small (the player puts its video over this box).
    V.pv = u.el('div', 'gpv', area);
    u.el('div', 'pvh', V.pv, 'Förhandsvisning');
    var items = [Search.item('guide')].concat(u.groupItems().filter(function (g) { return g.id !== '*edit' && g.id !== '*recent'; }));
    var start = 0;
    for (var i = 0; i < items.length; i++) if (items[i].id === '*fav' && u.channelsOf(items[i]).length) { start = i; break; } else if (items[i].id === '*all') start = i;
    V.groups.set(items, V.groupAt !== undefined ? V.groupAt : start);
    pickGroup();
    focus(focused);
  }

  function pickGroup() {
    var g = V.groups.current();
    V.rows = U().channelsOf(g);
    V.row = 0; V.first = 0;
    V.lockedGroup = g && Lock.locked(g);
    V.empty = g && g.id === '*search' ? U().searchHint(g.q, 'kanaler') : undefined;
    if (g && g.id === '*search') { g.n = V.rows.length; V.groups.draw(); }
    draw();
  }

  function px(t) { return (t - V.t0) / SPAN * V.w; }

  function progsOf(ch, done) { U().guideOf(ch, done); }

  /** The programme of a row under the time cursor (or the first after it). */
  function progAt(list, t) {
    for (var i = 0; i < list.length; i++) if (list[i].stop > t) return list[i];
    return null;
  }

  function draw() {
    if (!V) return;
    var u = U();
    V.w = V.area.clientWidth - 300 - 40;
    // the timeline
    V.head.innerHTML = '';
    for (var t = V.t0; t < V.t0 + SPAN; t += STEP) {
      var tick = u.el('div', 'tick', V.head, u.hm(t));
      tick.style.left = 300 + px(t) + 'px';
    }
    var now = Date.now();
    V.body.innerHTML = '';
    var nl = u.el('div', 'nowline', V.body);
    nl.style.left = 300 + px(now) + 'px';
    nl.style.display = now >= V.t0 && now < V.t0 + SPAN ? 'block' : 'none';
    if (!V.rows.length) {
      u.el('div', 'empty', V.body, V.lockedGroup ? '🔒  Låst med föräldralåset. Tryck OK och skriv PIN-koden.' : V.empty || 'Inga kanaler här.');
      V.info.innerHTML = '';
      stopPreview();
      return;
    }
    var rows = Math.max(1, Math.floor(V.body.clientHeight / ROW));
    if (V.row < V.first) V.first = V.row;
    if (V.row >= V.first + rows) V.first = V.row - rows + 1;
    for (var i = V.first; i < V.rows.length && i < V.first + rows; i++) drawRow(V.rows[i], i, (i - V.first) * ROW);
    drawInfo();
    later();
  }

  // The preview starts when you stay on a channel a moment (not on every step through the list).
  var pvTimer = 0;
  function later() {
    clearTimeout(pvTimer);
    pvTimer = setTimeout(function () {
      if (!V || !document.body.contains(V.pv)) return;
      var ch = !V.lockedGroup && V.rows[V.row];
      Player.preview(ch || null, V.pv);
    }, 900);
  }
  function stopPreview() { clearTimeout(pvTimer); Player.preview(null); }

  function drawRow(ch, i, top) {
    var u = U(), r = u.el('div', 'grow' + (i === V.row ? ' sel' : ''), V.body);
    r.style.top = top + 'px';
    var onCh = i === V.row && focused && V.zone === 'chan', fav = Store.isFav(ch);
    var c = u.el('div', 'gch' + (onCh ? ' focus' : ''), r);
    u.img(u.el('div', 'logo', c), '', ch.logo);
    u.el('div', 'name', c, ch.name);
    if (fav) u.el('span', 'gstar', c, '★');
    // The channel's own button (◀ from its first programme): OK adds it to the favourites or takes it away.
    if (onCh) u.el('div', 'gbtn', c, fav ? '★  Ta bort favorit' : '☆  Lägg till favorit');
    var lane = u.el('div', 'lane', r);
    progsOf(ch, function (list) {
      if (!V || V.rows[i] !== ch) return;
      lane.innerHTML = '';
      var focus = i === V.row && focused && V.zone === 'grid' ? progAt(list, V.tc) : null;
      if (!list.length) { u.el('div', 'cell none', lane, 'Ingen tablå'); return; }
      for (var j = 0; j < list.length; j++) {
        var p = list[j];
        if (p.stop <= V.t0 || p.start >= V.t0 + SPAN) continue;
        var x = Math.max(0, px(p.start)), w = Math.min(V.w, px(p.stop)) - x;
        var cell = u.el('div', 'cell' + (p.start <= Date.now() && Date.now() < p.stop ? ' now' : '') + (p === focus ? ' focus' : ''), lane);
        cell.style.left = x + 'px';
        cell.style.width = Math.max(4, w - 6) + 'px';
        if (w > 60) u.el('span', 'ct', cell, (has(ch, p) ? '🔔 ' : '') + p.title);
      }
      if (i === V.row) drawInfo();
    });
  }

  function drawInfo() {
    var u = U(), ch = V.rows[V.row];
    V.info.innerHTML = '';
    if (!ch) return;
    progsOf(ch, function (list) {
      if (!V || V.rows[V.row] !== ch) return;
      V.info.innerHTML = '';
      var p = progAt(list, V.tc), fav = Store.isFav(ch);
      if (V.zone === 'chan') {
        u.el('div', 'it', V.info, (fav ? '★  ' : '') + ch.name);
        u.el('div', 'im', V.info, fav ? 'Finns i dina favoriter' : 'Inte bland dina favoriter');
        u.el('div', 'ik', V.info, (fav ? 'OK tar bort kanalen från favoriterna' : 'OK lägger till kanalen i favoriterna') + '  ·  ▶ tillbaka till tablån  ·  ◀ grupperna');
        return;
      }
      if (!p) { u.el('div', 'it', V.info, ch.name); u.el('div', 'ik', V.info, 'Ingen tablå för den här kanalen · OK spelar  ·  ◀ ' + (fav ? '★ favorit' : '☆ lägg till i favoriter')); return; }
      var live = p.start <= Date.now();
      u.el('div', 'it', V.info, (has(ch, p) ? '🔔  ' : '') + p.title);
      u.el('div', 'im', V.info, u.hm(p.start) + '–' + u.hm(p.stop) + '  ·  ' + ch.name + (live ? '  ·  Pågår' : ''));
      if (p.desc) u.el('div', 'id', V.info, p.desc);
      u.el('div', 'ik', V.info, (live ? 'OK spelar kanalen' : has(ch, p) ? 'OK tar bort påminnelsen' : 'OK påminner dig när det börjar')
        + (live ? '  ·  ◀ ' + (fav ? '★ favorit' : '☆ lägg till i favoriter') : ''));
    });
  }

  /** Moves the time cursor to the next or previous programme of the row; the timeline follows. */
  function step(d) {
    var ch = V.rows[V.row];
    if (!ch) return false;
    var moved = false;
    progsOf(ch, function (list) {
      var p = progAt(list, V.tc), i = list.indexOf(p), now = Date.now();
      if (d < 0) {
        if (!p || i <= 0 || list[i - 1].stop <= now) { moved = false; return; }
        V.tc = Math.max(now, list[i - 1].start);
      } else {
        if (!p || i >= list.length - 1) { moved = false; return; }
        V.tc = list[i + 1].start;
      }
      var q = progAt(list, V.tc);
      while (q && q.start >= V.t0 + SPAN - STEP / 2) V.t0 += STEP;
      while (q && q.start < V.t0 && V.t0 > floorStep(now)) V.t0 -= STEP;
      moved = true;
    });
    return moved;
  }

  function activate() {
    var ch = V.rows[V.row];
    if (!ch) return;
    progsOf(ch, function (list) {
      var p = progAt(list, V.tc);
      if (!p || p.start <= Date.now()) {
        var at = V.row;
        Player.open(V.rows, at, {onClose: function (c) { for (var i = 0; i < V.rows.length; i++) if (V.rows[i].id === c.id) V.row = i; draw(); }});
      } else { toggle(ch, p); draw(); }
    });
  }

  function key(k, K) {
    var u = U();
    if (V.zone === 'groups') {
      if (k === K.up) { if (!V.groups.move(-1)) return 'tabs'; V.groupAt = V.groups.at; pickGroup(); }
      else if (k === K.down) { if (V.groups.move(1)) { V.groupAt = V.groups.at; pickGroup(); } }
      else if (k === K.ok && V.groups.current() && V.groups.current().id === '*search') {
        u.askChannels('guide', function (q) {
          if (!V || !V.groups) return;
          if (q !== null) { V.groups.items[0] = Search.item('guide'); pickGroup(); if (V.rows.length) { V.zone = 'grid'; V.tc = Date.now(); } }
          focus(true);
        });
        return;
      }
      else if (k === K.ok && V.lockedGroup) { Lock.ask(function (ok) { if (ok) { V.groups.draw(); pickGroup(); V.zone = 'grid'; focus(true); } }); return; }
      else if ((k === K.right || k === K.ok) && V.rows.length) { V.zone = 'grid'; V.tc = Date.now(); }
      else if (k === K.back) return 'tabs';
      focus(true);
      return;
    }
    if (V.zone === 'chan') {   // the channel's button, left of its programmes
      if (k === K.up) { if (V.row > 0) V.row--; else return 'tabs'; }
      else if (k === K.down) { if (V.row < V.rows.length - 1) V.row++; }
      else if (k === K.chUp) V.row = Math.max(0, V.row - 6);
      else if (k === K.chDown) V.row = Math.min(V.rows.length - 1, V.row + 6);
      else if (k === K.left) { if (V.fixed) return 'left'; V.zone = 'groups'; }
      else if (k === K.right) { V.zone = 'grid'; V.tc = Date.now(); }
      else if (k === K.ok && V.rows[V.row]) {
        var on = Store.toggleFav(V.rows[V.row]);
        u.toast(on ? 'Tillagd i favoriter' : 'Borttagen från favoriter');
        // Under Favoriter the list is the favourites: a channel taken away goes.
        if (V.fixed) { V.rows = V.fixed(); V.row = Math.min(V.row, Math.max(0, V.rows.length - 1)); if (!V.rows.length) { focus(true); return 'left'; } }
      }
      else if (k === K.back) return 'tabs';
      focus(true);
      return;
    }
    if (k === K.up) { if (V.row > 0) V.row--; else return 'tabs'; }
    else if (k === K.down) { if (V.row < V.rows.length - 1) V.row++; }
    else if (k === K.chUp) V.row = Math.max(0, V.row - 6);
    else if (k === K.chDown) V.row = Math.min(V.rows.length - 1, V.row + 6);
    else if (k === K.left) { if (!V.rows.length) return V.fixed ? 'left' : undefined; if (!step(-1)) { V.zone = 'chan'; V.tc = Date.now(); V.t0 = floorStep(Date.now()); } }
    else if (k === K.right) step(1);
    else if (k === K.ok) { activate(); return; }
    else if (k === K.back) { if (V.tc > Date.now() + 60000) { V.tc = Date.now(); V.t0 = floorStep(Date.now()); } else return 'tabs'; }
    focus(true);
  }

  function focus(on) {
    focused = on;
    if (!V) return;
    if (V.groups) V.groups.focus(on && V.zone === 'groups');
    draw();
  }

  // The now line and the reminders' marks move with the clock.
  setInterval(function () { if (V && document.body.contains(V.area)) { if (V.t0 + STEP <= floorStep(Date.now()) && V.tc < Date.now()) V.t0 = floorStep(Date.now()); draw(); } }, 60000);

  return {build: build, key: key, focus: focus, leave: function () { stopPreview(); V = null; }, reminders: reminders, toggle: toggle, has: has, remindKey: remindKey, _check: check};
})();
