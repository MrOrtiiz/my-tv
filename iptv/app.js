/*
 * IPTV, Yuri's own player for his IPTV service, in the look of his Free My TV home screen (dark Liquid Glass).
 * Live (groups → channels → what's on), Guide (now and next on every channel, the rest of the day on the focused one),
 * Filmer, Serier, Favoriter (with Senast sedda) and Inställningar. Spanish, English and Swedish groups come first.
 * Free My TV opens it with the IPTV link (and, from the Barça box, the match's channels to play at once).
 * Like Free My TV, every start loads this code from GitHub (MrOrtiiz/my-tv, folder iptv/). ES5 only.
 */
var App = (function () {
  'use strict';
  var VERSION = '1.8';
  var K = {left: 37, up: 38, right: 39, down: 40, ok: 13, back: 10009, chUp: 427, chDown: 428,
    play: 415, pause: 19, playPause: 10252, ff: 417, rew: 412, stop: 413};
  var TABS = [['favs', 'Favoriter'], ['sport', 'Sport'], ['live', 'Live'], ['guide', 'TV-guide'], ['films', 'Filmer'], ['series', 'Serier'], ['settings', 'Inställningar']];

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, parent, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    if (parent) parent.appendChild(n);
    return n;
  }
  function img(parent, cls, src) {
    var i = el('img', cls, parent);
    i.onerror = function () { this.style.visibility = 'hidden'; };
    if (src) i.src = src; else i.style.visibility = 'hidden';
    return i;
  }
  function setClass(n, c, on) {
    if (!n) return;
    var has = (' ' + n.className + ' ').indexOf(' ' + c + ' ') >= 0;
    if (on && !has) n.className += ' ' + c;
    if (!on && has) n.className = (' ' + n.className + ' ').replace(' ' + c + ' ', ' ').replace(/^\s+|\s+$/g, '');
  }
  function two(n) { return (n < 10 ? '0' : '') + n; }
  function hm(ms) { var d = new Date(ms); return two(d.getHours()) + ':' + two(d.getMinutes()); }

  // MARK: - A list that draws only the rows in view (thousands of channels on a TV)

  function List(host, rowH, render) {
    this.host = host; this.rowH = rowH; this.render = render; this.items = []; this.at = 0; this.first = 0; this.focused = false;
    this.inner = el('div', 'inner', host);
  }
  List.prototype.set = function (items, at) { this.items = items || []; this.at = Math.max(0, Math.min(at || 0, this.items.length - 1)); this.first = 0; this.draw(); };
  List.prototype.rows = function () { return Math.max(1, Math.floor(this.host.clientHeight / this.rowH)); };
  List.prototype.move = function (d) {
    var n = this.at + d;
    if (n < 0 || n >= this.items.length) return false;
    this.at = n; this.draw(); return true;
  };
  List.prototype.current = function () { return this.items[this.at]; };
  List.prototype.draw = function () {
    var rows = this.rows();
    if (this.at < this.first + 1) this.first = Math.max(0, this.at - 1);
    if (this.at > this.first + rows - 2) this.first = Math.min(Math.max(0, this.items.length - rows), this.at - rows + 2);
    this.first = Math.max(0, Math.min(this.first, Math.max(0, this.items.length - rows)));
    this.inner.innerHTML = '';
    for (var i = this.first; i < this.items.length && i < this.first + rows + 1; i++) {
      var r = el('div', 'row' + (i === this.at ? ' sel' : '') + (i === this.at && this.focused ? ' focus' : ''), this.inner);
      r.style.top = (i - this.first) * this.rowH + 'px';
      r.style.height = (this.rowH - 8) + 'px';
      this.render(this.items[i], r, i);
    }
    if (!this.items.length) el('div', 'empty', this.inner, this.emptyText || '');
  };
  List.prototype.focus = function (on) { this.focused = on; this.draw(); };
  List.prototype.visible = function () { return this.items.slice(this.first, this.first + this.rows() + 1); };

  /** A grid of posters, drawn by rows in view. */
  function Grid(host, cols, tileW, tileH, render) {
    this.host = host; this.cols = cols; this.tileW = tileW; this.tileH = tileH; this.render = render;
    this.items = []; this.at = 0; this.firstRow = 0; this.focused = false;
    this.inner = el('div', 'inner', host);
  }
  Grid.prototype.set = function (items, at) { this.items = items || []; this.at = Math.max(0, Math.min(at || 0, this.items.length - 1)); this.firstRow = 0; this.draw(); };
  Grid.prototype.move = function (dx, dy) {
    var n = this.at + dx + dy * this.cols;
    if (dx && Math.floor(n / this.cols) !== Math.floor(this.at / this.cols)) return false;
    if (n < 0 || n >= this.items.length) { if (dy > 0 && Math.floor(this.at / this.cols) < Math.floor((this.items.length - 1) / this.cols)) n = this.items.length - 1; else return false; }
    this.at = n; this.draw(); return true;
  };
  Grid.prototype.current = function () { return this.items[this.at]; };
  Grid.prototype.draw = function () {
    var rows = Math.max(1, Math.floor(this.host.clientHeight / this.tileH)), row = Math.floor(this.at / this.cols);
    if (row < this.firstRow) this.firstRow = row;
    if (row > this.firstRow + rows - 1) this.firstRow = row - rows + 1;
    this.inner.innerHTML = '';
    for (var i = this.firstRow * this.cols; i < this.items.length && i < (this.firstRow + rows + 1) * this.cols; i++) {
      var t = el('div', 'tile' + (i === this.at && this.focused ? ' focus' : ''), this.inner);
      t.style.left = (i % this.cols) * this.tileW + 'px';
      t.style.top = (Math.floor(i / this.cols) - this.firstRow) * this.tileH + 'px';
      this.render(this.items[i], t, i);
    }
    if (!this.items.length) el('div', 'empty', this.inner, this.emptyText || '');
  };
  Grid.prototype.focus = function (on) { this.focused = on; this.draw(); };

  // MARK: - State

  var tab = 'live', zone = 'tabs', tabAt = 0;
  var channels = [], groups = [], byCat = {}, loadErr = null, loadingLive = false;
  var V = {};   // the views of the screen shown now
  var overlay = null;   // a detail sheet over the screen: {kind, zones...}

  function toast(text, ms) {
    var t = $('toast');
    t.textContent = text;
    t.className = 'glass on';
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { t.className = 'glass'; }, ms || 3500);
  }

  // MARK: - The top bar

  function drawTabs() {
    var bar = $('tabs');
    bar.innerHTML = '';
    for (var i = 0; i < TABS.length; i++) {
      var t = el('div', 'tab' + (TABS[i][0] === tab ? ' on' : '') + (zone === 'tabs' && i === tabAt ? ' focus' : ''), bar, TABS[i][1]);
      (function (i) { t.onclick = function () { tabAt = i; openTab(TABS[i][0]); }; })(i);
    }
  }
  function tickClock() {
    var d = new Date();
    $('clock').textContent = two(d.getHours()) + ':' + two(d.getMinutes());
    setTimeout(tickClock, 60000 - Date.now() % 60000 + 50);
  }

  // MARK: - Channels

  /** All groups in Yuri's order (moved ones where he put them, new ones in the language order after). */
  function orderedGroups() {
    var order = Store.groupOrder(), idx = {}, i;
    for (i = 0; i < order.length; i++) idx[order[i]] = i;
    var list = [];
    for (i = 0; i < groups.length; i++) list.push({g: groups[i], r: idx.hasOwnProperty(groups[i].id) ? idx[groups[i].id] : order.length + i});
    list.sort(function (a, b) { return a.r - b.r; });
    return list.map(function (x) { return x.g; });
  }
  /** The groups shown: not hidden. */
  function shownGroups() { var h = Store.hidden(); return orderedGroups().filter(function (g) { return !h[g.id]; }); }
  function groupById(id) { for (var i = 0; i < groups.length; i++) if (groups[i].id === id) return groups[i]; return null; }
  /** May a channel be shown now: its group isn't hidden or locked. */
  function open_(ch) {
    var g = groupById(ch.cat);
    if (!g) return true;
    return !Store.hidden()[g.id] && !Lock.locked(g);
  }

  function groupItems() {
    var all = channels.filter(open_);
    var out = [{id: '*fav', name: '★  Favoriter'}, {id: '*recent', name: 'Senast sedda'}, {id: '*all', name: 'Alla kanaler', n: all.length}];
    out = out.concat(shownGroups());
    if (groups.length) out.push({id: '*edit', name: '✎  Ordna, dölj och lås'});
    return out;
  }

  /** A group's channels in its own order (moved ones first where he put them). */
  function ordered(gid, list) {
    var ids = Store.chanOrder(gid);
    if (!ids) return list;
    var idx = {}, i, out = [];
    for (i = 0; i < ids.length; i++) idx[ids[i]] = i;
    for (i = 0; i < list.length; i++) out.push({c: list[i], r: idx.hasOwnProperty(list[i].id) ? idx[list[i].id] : ids.length + i});
    out.sort(function (a, b) { return a.r - b.r; });
    return out.map(function (x) { return x.c; });
  }

  function channelsOf(g) {
    if (!g || g.id === '*edit') return [];
    if (g.id === '*all') return channels.filter(open_);
    if (g.id === '*fav' || g.id === '*recent') {
      var src = g.id === '*fav' ? Store.favs() : Store.recent(), out = [];
      for (var i = 0; i < src.length; i++) if (src[i].kind === 'live' && open_(src[i])) out.push(src[i]);
      return out;
    }
    if (Lock.locked(g)) return [];
    return ordered(g.id, byCat[g.id] || []);
  }

  function loadChannels(fresh, done) {
    if (!Store.link()) { loadErr = new Error('ingen IPTV-länk'); if (done) done(); return; }
    Api.use(Store.link());
    loadingLive = true;
    Api.channels(function (err, list, cats) {
      loadingLive = false;
      loadErr = err;
      if (!err) {
        groups = cats; byCat = {};
        for (var i = 0; i < list.length; i++) (byCat[list[i].cat] = byCat[list[i].cat] || []).push(list[i]);
        // Alla kanaler in the groups' order: Spanish, English, Swedish first.
        channels = [];
        for (i = 0; i < cats.length; i++) channels = channels.concat(byCat[cats[i].id] || []);
        if (channels.length < list.length) { var seen = {}; for (i = 0; i < channels.length; i++) seen[channels[i].id] = 1; for (i = 0; i < list.length; i++) if (!seen[list[i].id]) channels.push(list[i]); }
        for (i = 0; i < groups.length; i++) groups[i].lang = Lang.tag(groups[i].name);
      }
      if (done) done();
    }, fresh);
  }

  /** A guide's or a Free My TV channel name, found in the list: by its guide id, else its name. */
  function norm(s) {
    s = String(s || '').toLowerCase();
    if (s.normalize) s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
    s = s.replace(/^[a-z]{2,3}\s*[:|\-]\s*|^\|[a-z]{2,3}\|\s*/, '');
    s = s.replace(/\b(fhd|uhd|hd|sd|4k|hevc|h265|backup|raw|\d+fps)\b/g, '');
    return s.replace(/[^a-z0-9]+/g, '');
  }
  function find(name, epg) {
    var i, n = norm(name), best = null;
    if (epg) for (i = 0; i < channels.length; i++) if (channels[i].epg && channels[i].epg === epg) return channels[i];
    for (i = 0; i < channels.length; i++) if (norm(channels[i].name) === n) return channels[i];
    if (n.length < 4) return null;
    for (i = 0; i < channels.length; i++) {
      var m = norm(channels[i].name);
      if (m.length >= 4 && (m.indexOf(n) >= 0 || n.indexOf(m) >= 0) && (!best || Math.abs(m.length - n.length) < Math.abs(norm(best.name).length - n.length))) best = channels[i];
    }
    return best;
  }

  // The guide, a few channels at a time, kept 10 minutes.
  var guides = {}, guideQueue = [], guideBusy = 0;
  function guideOf(ch, done) {
    var g = guides[ch.id];
    if (g && Date.now() - g.at < 600000) { done(g.list); return; }
    guideQueue.push({ch: ch, done: done});
    pump();
  }
  function pump() {
    while (guideBusy < 4 && guideQueue.length) {
      var job = guideQueue.shift();
      if (guides[job.ch.id] && Date.now() - guides[job.ch.id].at < 600000) { job.done(guides[job.ch.id].list); continue; }
      guideBusy++;
      (function (job) {
        Api.guide(job.ch, function (err, list) {
          guideBusy--;
          guides[job.ch.id] = {at: Date.now(), list: list || []};
          job.done(list || []);
          pump();
        }, 12);
      })(job);
    }
  }
  function nowNext(list) {
    var now = Date.now(), out = [];
    for (var i = 0; i < list.length && out.length < 2; i++) if (list[i].stop > now) out.push(list[i]);
    return out;
  }

  // MARK: - Live and TV-guide

  function chanRow(guideMode) {
    return function (ch, r, i) {
      if (V.grab && V.chans && i === V.chans.at) r.className += ' grab';
      img(el('div', 'logo', r), '', ch.logo);
      var t = el('div', 'text', r);
      el('div', 'name', t, ch.name);
      if (guideMode) {
        var line1 = el('div', 'now', t, ' '), line2 = el('div', 'next', t, ' ');
        guideOf(ch, function (list) {
          var nn = nowNext(list);
          line1.textContent = nn[0] ? hm(nn[0].start) + '  ' + nn[0].title : 'Ingen tablå';
          line2.textContent = nn[1] ? hm(nn[1].start) + '  ' + nn[1].title : '';
        });
      }
      if (Store.isFav(ch)) el('div', 'star', r, '★');
    };
  }

  function buildChannels(guideMode) {
    var main = $('main');
    main.innerHTML = '';
    main.className = guideMode ? 'guide' : 'live';
    var gHost = el('div', 'col groups glass', main), cHost = el('div', 'col chans glass', main), side = el('div', 'col side glass', main);
    V.groups = new List(gHost, 76, function (g, r) {
      el('div', 'name', r, g.name);
      if (g.lang) el('span', 'lang lang-' + g.lang.toLowerCase(), r, g.lang);
      if (Lock.locked(g)) el('span', 'n', r, '🔒');
      else if (g.n) el('span', 'n', r, String(g.n));
    });
    V.chans = new List(cHost, guideMode ? 112 : 84, chanRow(guideMode));
    V.chans.emptyText = 'Inga kanaler här.';
    V.side = side;
    V.guideMode = guideMode;
    var start = 2;
    var last = Store.lastChannel();
    V.groups.set(groupItems(), V.groupAt !== undefined ? V.groupAt : start);
    showGroup(last);
    if (zone !== 'tabs') zone = 'chans';
    focusZone();
  }

  function showGroup(selectCh) {
    var g = V.groups.current(), list = channelsOf(g), at = 0;
    V.groupAt = V.groups.at;
    V.grab = false;
    V.chans.emptyText = g && g.id === '*edit' ? 'OK öppnar: flytta grupper, dölj dem du inte vill se och lås grupper med föräldralåset.'
      : g && Lock.locked(g) ? '🔒  Låst med föräldralåset. Tryck OK och skriv PIN-koden.' : 'Inga kanaler här.';
    if (selectCh) for (var i = 0; i < list.length; i++) if (list[i].id === selectCh.id) { at = i; break; }
    V.chans.set(list, at);
    sideFor();
  }

  var sideTimer = 0;
  function sideFor() {
    var ch = V.chans && V.chans.current(), side = V.side;
    if (!side) return;
    side.innerHTML = '';
    if (!ch) { el('div', 'hint', side, loadErr ? 'Kunde inte läsa din IPTV-lista: ' + loadErr.message + '.' : loadingLive ? 'Hämtar kanaler…' : ''); return; }
    var head = el('div', 'head', side);
    img(el('div', 'logo big', head), '', ch.logo);
    el('div', 'title', head, ch.name);
    var progs = el('div', 'progs', side, 'Hämtar tablån…');
    if (!V.guideMode) {
      var btns = el('div', 'buttons', side);
      V.buttons = [['Spela', function () { playChannel(); }], [Store.isFav(ch) ? '★  Ta bort från favoriter' : '☆  Lägg till i favoriter', function () {
        var on = Store.toggleFav(ch); toast(on ? 'Tillagd i favoriter' : 'Borttagen från favoriter'); V.chans.draw(); sideFor();
      }]];
      var g = V.groups.current();
      if (g && g.id !== '*all' && g.id !== '*recent' && V.chans.items.length > 1) V.buttons.push(['↕  Flytta i listan', function () {
        V.grab = true; zone = 'chans'; toast('▲ ▼ flyttar kanalen · OK släpper', 5000); focusZone();
      }]);
      for (var b = 0; b < V.buttons.length; b++) el('div', 'button' + (zone === 'side' && V.btnAt === b ? ' focus' : ''), btns, V.buttons[b][0]);
    } else el('div', 'keys', side, 'OK spelar  ·  ▲ ▼ kanaler  ·  ◀ grupper');
    clearTimeout(sideTimer);
    var mine = ch;
    sideTimer = setTimeout(function () {
      guideOf(ch, function (list) {
        if (!V.chans || V.chans.current() !== mine) return;
        progs.innerHTML = '';
        if (!list.length) { el('div', 'hint', progs, 'Ingen tablå för den här kanalen.'); return; }
        var now = Date.now(), max = V.guideMode ? 10 : 4;
        for (var i = 0; i < list.length && i < max; i++) {
          var p = list[i], row = el('div', 'prog' + (p.start <= now && now < p.stop ? ' now' : ''), progs);
          el('span', 'time', row, hm(p.start));
          var tt = el('div', 'tt', row);
          el('div', 'ptitle', tt, p.title);
          if (p.start <= now && now < p.stop) {
            var bar = el('div', 'progress', tt), f = el('div', 'fill', bar);
            f.style.width = Math.min(100, (now - p.start) / (p.stop - p.start) * 100) + '%';
            if (p.desc) el('div', 'desc', tt, p.desc);
          }
        }
      });
    }, 250);
  }

  /** Moves the grabbed channel one step, and keeps the new order (the group's, or the favourites'). */
  function moveChannel(d) {
    var l = V.chans.items, a = V.chans.at, b = a + d;
    if (b < 0 || b >= l.length) return;
    var t = l[a]; l[a] = l[b]; l[b] = t;
    V.chans.at = b;
    var g = V.groups.current();
    if (g.id === '*fav') {
      var favs = Store.favs(), lives = l.slice(), out = [], k = 0;
      for (var i = 0; i < favs.length; i++) out.push(favs[i].kind === 'live' && k < lives.length ? lives[k++] : favs[i]);
      Store.setFavs(out);
    } else Store.chanOrder(g.id, l.map(function (c) { return c.id; }));
    V.chans.draw();
  }

  function playChannel() {
    var list = V.chans.items, at = V.chans.at;
    if (!list.length) return;
    Player.open(list, at, {onClose: function (ch) {
      // Back on the channel last watched, in the same list.
      for (var i = 0; i < V.chans.items.length; i++) if (V.chans.items[i].id === ch.id) { V.chans.at = i; break; }
      V.chans.draw(); sideFor();
    }});
  }

  // MARK: - Films and series

  function posterTile(item, t) {
    img(t, 'poster', item.poster);
    el('div', 'pname', t, item.name);
    if (Store.isFav(item)) el('div', 'star', t, '★');
  }

  function buildVod(kind) {
    var main = $('main');
    main.innerHTML = '';
    main.className = 'vod';
    var cHost = el('div', 'col cats glass', main), gHost = el('div', 'col posters', main);
    V.cats = new List(cHost, 76, function (c, r) {
      el('div', 'name', r, c.name);
      var tag = Lang.tag(c.name);
      if (tag) el('span', 'lang lang-' + tag.toLowerCase(), r, tag);
      if (Lock.locked({id: kind + ':' + c.id, name: c.name})) el('span', 'n', r, '🔒');
    });
    V.grid = new Grid(gHost, 6, 215, 362, posterTile);
    V.kind = kind;
    V.cats.emptyText = 'Hämtar…';
    V.cats.set([]);
    zone = zone === 'tabs' ? 'tabs' : 'cats';
    focusZone();
    var fn = kind === 'films' ? Api.filmCats : Api.seriesCats;
    if (!Store.link()) { V.cats.emptyText = 'Lägg in din IPTV-länk under Inställningar.'; V.cats.draw(); return; }
    Api.use(Store.link());
    fn(function (err, cats) {
      if (tab !== kind) return;
      if (err) { V.cats.emptyText = 'Kunde inte hämta: ' + err.message + '.'; V.cats.draw(); return; }
      var h = Store.vodHidden();
      cats = vodOrdered(kind, cats).filter(function (c) { return !h[kind + ':' + c.id]; });
      cats.push({id: '*edit', name: '✎  Ordna, dölj och lås'});
      V.cats.set(cats, V['catAt_' + kind] || 0);
      showCat();
    });
  }

  /** Film or series categories in Yuri's order (Inställningar → Filmer/Serier), new ones after, in language order. */
  function vodOrdered(kind, cats) {
    var order = Store.vodOrder(kind), at = {}, i;
    for (i = 0; i < order.length; i++) at[order[i]] = i;
    var known = cats.filter(function (c) { return at.hasOwnProperty(c.id); }).sort(function (a, b) { return at[a.id] - at[b.id]; });
    return known.concat(cats.filter(function (c) { return !at.hasOwnProperty(c.id); }));
  }

  var catSeq = 0;
  function showCat() {
    var c = V.cats.current(), mine = ++catSeq;
    if (!c) return;
    V['catAt_' + V.kind] = V.cats.at;
    if (c.id === '*edit') { V.grid.emptyText = 'OK öppnar: flytta kategorier, dölj dem du inte vill se och lås dem med föräldralåset.'; V.grid.set([]); return; }
    if (Lock.locked({id: V.kind + ':' + c.id, name: c.name})) { V.grid.emptyText = '🔒  Låst med föräldralåset. Tryck OK och skriv PIN-koden.'; V.grid.set([]); return; }
    V.grid.emptyText = 'Hämtar…';
    V.grid.set([]);
    (V.kind === 'films' ? Api.films : Api.series)(c.id, function (err, items) {
      if (mine !== catSeq) return;
      V.grid.emptyText = err ? 'Kunde inte hämta: ' + err.message + '.' : 'Inget här.';
      V.grid.set(items || []);
    });
  }

  function openDetail(item) {
    var o = $('overlay');
    o.innerHTML = '';
    o.className = 'on';
    overlay = {item: item, zone: 'buttons', btnAt: 0, buttons: [], seasons: null, sAt: 0};
    var sheet = el('div', 'sheet glass', o);
    var bd = el('div', 'backdrop', sheet);
    img(sheet, 'dposter', item.poster);
    var info = el('div', 'dinfo', sheet);
    el('div', 'dtitle', info, item.name);
    var meta = el('div', 'dmeta', info, [item.year, item.rating ? '★ ' + item.rating : ''].join('   '));
    var plot = el('div', 'dplot', info, item.plot || '');
    var btns = el('div', 'buttons', info);
    overlay.btnHost = btns;
    if (item.kind === 'film') {
      Api.filmInfo(item, function (err, i) {
        if (!overlay || overlay.item !== item) return;
        meta.textContent = [i.year, i.genre, i.duration, i.rating ? '★ ' + i.rating : ''].join('   ');
        plot.textContent = i.plot;
        if (i.backdrop) bd.style.backgroundImage = 'url("' + i.backdrop + '")';
      });
      var pos = Store.position(item);
      if (pos) overlay.buttons.push(['Fortsätt från ' + Math.floor(pos / 60) + ' min', function () { playVod([item], 0); }]);
      overlay.buttons.push([pos ? 'Spela från början' : 'Spela', function () { Store.watched(item, 0, 0); playVod([item], 0); }]);
      overlay.buttons.push([Store.isFav(item) ? '★  Ta bort från favoriter' : '☆  Lägg till i favoriter', function () { favToggle(item); }]);
      drawButtons();
    } else {
      overlay.buttons.push([Store.isFav(item) ? '★  Ta bort från favoriter' : '☆  Lägg till i favoriter', function () { favToggle(item); }]);
      drawButtons();
      var eps = el('div', 'episodes', info);
      var sHost = el('div', 'seasons', eps), eHost = el('div', 'eps', eps);
      overlay.sList = new List(sHost, 64, function (s, r) { el('div', 'name', r, 'Säsong ' + s.n); });
      overlay.eList = new List(eHost, 64, function (e, r) {
        el('div', 'name', r, e.n + '.  ' + e.title);
        var p = Store.position(e);
        if (p) el('span', 'n', r, Math.floor(p / 60) + ' min');
      });
      overlay.sList.emptyText = 'Hämtar avsnitt…';
      overlay.sList.set([]);
      Api.seriesInfo(item, function (err, seasons, i) {
        if (!overlay || overlay.item !== item) return;
        if (err) { overlay.sList.emptyText = 'Kunde inte hämta: ' + err.message; overlay.sList.draw(); return; }
        if (i.plot) plot.textContent = i.plot;
        meta.textContent = [i.year, i.genre].join('   ');
        if (i.backdrop) bd.style.backgroundImage = 'url("' + i.backdrop + '")';
        overlay.seasons = seasons;
        // Where it was left: the season of the last episode watched.
        var rec = Store.recent(), sAt = 0;
        for (var r = 0; r < rec.length; r++) if (rec[r].kind === 'episode' && rec[r].series === item.id) { for (var s = 0; s < seasons.length; s++) if (seasons[s].n === rec[r].season) sAt = s; break; }
        overlay.sList.set(seasons, sAt);
        overlay.eList.set(seasons[sAt] ? seasons[sAt].episodes : []);
        overlay.zone = 'eps';
        overlayFocus();
      });
    }
    overlayFocus();
  }

  function favToggle(item) {
    var on = Store.toggleFav(item);
    toast(on ? 'Tillagd i favoriter' : 'Borttagen från favoriter');
    for (var i = 0; i < overlay.buttons.length; i++) if (/favoriter/.test(overlay.buttons[i][0])) overlay.buttons[i][0] = on ? '★  Ta bort från favoriter' : '☆  Lägg till i favoriter';
    drawButtons();
    if (V.grid) V.grid.draw();
  }

  function drawButtons() {
    var h = overlay.btnHost;
    h.innerHTML = '';
    for (var i = 0; i < overlay.buttons.length; i++) el('div', 'button' + (overlay.zone === 'buttons' && overlay.btnAt === i ? ' focus' : ''), h, overlay.buttons[i][0]);
  }

  function overlayFocus() {
    if (!overlay) return;
    drawButtons();
    if (overlay.sList) { overlay.sList.focus(overlay.zone === 'seasons'); overlay.eList.focus(overlay.zone === 'eps'); }
  }

  function closeOverlay() {
    overlay = null;
    $('overlay').className = '';
    $('overlay').innerHTML = '';
    if (V.grid) V.grid.draw();
  }

  function playVod(list, at) {
    var keep = overlay;
    Player.open(list, at, {onClose: function () {
      if (keep && keep.item && $('overlay').className === 'on') {
        // Back on the detail sheet, with where it was left.
        var item = keep.item; closeOverlay(); openDetail(item);
      } else drawScreen();
    }});
  }

  // MARK: - Favourites and history

  var FAV_SECTIONS = [['Kanaler', 'live'], ['Filmer', 'film'], ['Serier', 'series'], ['Senast sedda', 'recent'], ['Påminnelser', 'rem']];
  function buildFavs() {
    var main = $('main');
    main.innerHTML = '';
    main.className = 'favs';
    V.sections = new List(el('div', 'col groups glass', main), 76, function (s, r) { el('div', 'name', r, s[0]); });
    V.itemsHost = el('div', 'col items glass', main);
    V.items = new List(V.itemsHost, 92, function (it, r) {
      img(el('div', 'logo', r), '', it.logo || it.poster);
      var t = el('div', 'text', r);
      el('div', 'name', t, it.kind === 'episode' ? it.seriesName + '  ·  S' + it.season + ' A' + it.n : it.name);
      var sub = it.kind === 'live' ? 'Kanal' : it.kind === 'film' ? 'Film' : it.kind === 'series' ? 'Serie' : it.kind === 'rem' ? it.title : it.title || 'Avsnitt';
      if (it.pos && it.len) sub += '  ·  ' + Math.floor(it.pos / 60) + ' av ' + Math.floor(it.len / 60) + ' min';
      el('div', 'now', t, sub);
    });
    V.sections.set(FAV_SECTIONS, V.secAt || 0);
    showSection();
    if (zone !== 'tabs') zone = V.mod ? 'mod' : 'items';
    focusZone();
  }
  /** The favourite channels as they are in the list now (else as kept), the locked ones left out. */
  function favChannels() {
    var f = Store.favs(), out = [];
    for (var i = 0; i < f.length; i++) if (f[i].kind === 'live' && open_(f[i])) out.push(find(f[i].name, f[i].epg) || f[i]);
    return out;
  }
  function showSection() {
    var s = V.sections.current(), src = s[1] === 'recent' ? Store.recent() : Store.favs(), out = [];
    V.secAt = V.sections.at;
    // Kanaler: the favourite channels as in the TV guide (the grid, with what's on now and later).
    if (V.mod) { V.mod.leave(); V.mod = null; if (V.favGrid) { $('main').removeChild(V.favGrid); V.favGrid = null; } }
    V.itemsHost.style.display = s[1] === 'live' ? 'none' : '';
    if (s[1] === 'live') {
      var before = $('main').children.length;
      Epg.build($('main'), {rows: favChannels, empty: 'Inga favoritkanaler än. Lägg till med ☆ i Live, eller ◀ på en kanal i TV-guiden.'});
      V.favGrid = $('main').children[before];
      V.mod = Epg;
      V.items.set([]);
      return;
    }
    if (s[1] === 'rem') {
      var rem = Epg.reminders();
      V.items.emptyText = 'Inga påminnelser. Välj ett kommande program i TV-guiden och tryck OK.';
      V.items.set(rem.map(function (r) { return {kind: 'rem', rem: r, name: r.title, logo: r.ch.logo, title: hm(r.start) + '  ·  ' + r.ch.name + '  ·  OK tar bort'}; }));
      return;
    }
    for (var i = 0; i < src.length; i++) if ((s[1] === 'recent' || src[i].kind === s[1]) && (src[i].kind !== 'live' || open_(src[i]))) out.push(src[i]);
    V.items.emptyText = s[1] === 'recent' ? 'Inget sett än.' : 'Inga favoriter här än. Lägg till med ☆ på en kanal, film eller serie.';
    V.items.set(out);
  }
  function openFavItem(it) {
    if (it.kind === 'rem') { Epg.toggle(it.rem.ch, it.rem); showSection(); return; }
    if (it.kind === 'live') {
      var lives = [], at = 0;
      for (var i = 0; i < V.items.items.length; i++) if (V.items.items[i].kind === 'live') { if (V.items.items[i] === it) at = lives.length; lives.push(V.items.items[i]); }
      Player.open(lives, at, {onClose: function () { showSection(); focusZone(); }});
      return;
    }
    if (it.kind === 'episode') { Player.open([it], 0, {onClose: function () { showSection(); }}); return; }
    openDetail(it);
  }

  // MARK: - Settings

  function buildSettings() {
    var main = $('main');
    main.innerHTML = '';
    main.className = 'settings';
    var host = el('div', 'col setlist glass', main);
    V.set = new List(host, 92, function (row, r) {
      el('div', 'name', r, row[0]);
      el('span', 'n', r, row[1] || '');
    });
    var rows = [
      ['IPTV-länk', Store.link() ? (Api.host() || 'angiven') : 'Inte angiven', editLink],
      ['Uppdatera kanallistan', channels.length ? channels.length + ' kanaler' : '', function () {
        Store.forget(); toast('Hämtar kanallistan…'); loadChannels(true, function () { toast(loadErr ? 'Kunde inte läsa listan: ' + loadErr.message : channels.length + ' kanaler'); buildSettings(); });
      }],
      ['Grupper', 'ordna, dölj och lås', function () { Lock.editor(); }],
      ['Filmer', 'ordna, dölj och lås', function () { Lock.editor('films'); }],
      ['Serier', 'ordna, dölj och lås', function () { Lock.editor('series'); }],
      ['Föräldralås', Store.pin() ? (Lock.open() ? 'på · upplåst nu' : 'på') : 'av', function () { Lock.settings(); }],
      ['Återställ grupperna', 'ordning och dolda', function () { Store.resetGroups(); toast('Grupperna, filmerna och serierna har sin vanliga ordning igen, inga är dolda.'); V = {}; buildSettings(); }],
      ['Rensa senast sedda', '', function () { try { localStorage.removeItem('iptv.recent'); } catch (e) {} toast('Rensat'); }],
      ['Om appen', 'IPTV ' + VERSION + ' · laddas från GitHub', function () {}]
    ];
    V.set.set(rows, V.setAt || 0);
    el('div', 'hint', main, 'Länken skickas med från Free My TV när du öppnar appen därifrån, så du behöver bara skriva in den här om du öppnar appen direkt. Den sparas bara på TV:n.');
    if (zone !== 'tabs') zone = 'set';
    focusZone();
  }

  function editLink() {
    var o = $('overlay');
    o.innerHTML = '';
    o.className = 'on';
    overlay = {kind: 'input'};
    var sheet = el('div', 'sheet small glass', o);
    el('div', 'dtitle', sheet, 'IPTV-länk');
    var input = el('input', 'field', sheet);
    input.type = 'text';
    input.value = Store.link();
    input.setAttribute('autocapitalize', 'none');
    input.setAttribute('autocorrect', 'off');
    input.placeholder = 'http://server:port/get.php?username=…&password=…';
    el('div', 'hint', sheet, 'M3U-länk eller Xtream-inloggning. Enter sparar, Tillbaka avbryter. Tips: klistra in med SmartThings-appen på mobilen.');
    overlay.input = input;
    input.onkeydown = function (e) {
      if (e.keyCode === 13 || e.keyCode === 65376) { e.preventDefault(); saveLink(input.value); }
    };
    setTimeout(function () { input.focus(); }, 50);
  }

  function saveLink(v) {
    v = String(v || '').replace(/\s+/g, '');
    if (v && !/^https?:\/\//i.test(v)) { toast('Länken ska börja med http:// eller https://'); return; }
    Store.link(v);
    Store.forget();
    closeOverlay();
    toast(v ? 'Hämtar kanallistan…' : 'Länken borttagen');
    if (v) loadChannels(true, function () { toast(loadErr ? 'Kunde inte läsa listan: ' + loadErr.message : 'Sparad. ' + channels.length + ' kanaler.'); drawScreen(); });
    else { channels = []; groups = []; drawScreen(); }
  }

  // MARK: - Screens and focus

  function openTab(name) {
    if (tab !== name) { if (V.mod && V.mod.leave) V.mod.leave(); V = {}; }
    tab = name;
    for (var i = 0; i < TABS.length; i++) if (TABS[i][0] === name) tabAt = i;
    drawScreen();
  }

  function drawScreen() {
    drawTabs();
    if (tab === 'live') buildChannels(false);
    else if (tab === 'guide') { $('main').innerHTML = ''; V.mod = Epg; Epg.build($('main')); }
    else if (tab === 'sport') { $('main').innerHTML = ''; V.mod = Sport; Sport.build($('main')); }
    else if (tab === 'films' || tab === 'series') buildVod(tab);
    else if (tab === 'favs') buildFavs();
    else buildSettings();
  }

  function focusZone() {
    drawTabs();
    if (V.groups) V.groups.focus(zone === 'groups');
    if (V.chans) { V.chans.focus(zone === 'chans'); if (!V.guideMode) sideFor(); }
    if (V.cats) V.cats.focus(zone === 'cats');
    if (V.grid) V.grid.focus(zone === 'grid');
    if (V.sections) V.sections.focus(zone === 'sections');
    if (V.items) V.items.focus(zone === 'items');
    if (V.set) V.set.focus(zone === 'set');
    if (V.mod) V.mod.focus(zone === 'mod');
  }

  function firstZone() {
    return tab === 'live' ? 'chans' : tab === 'guide' || tab === 'sport' ? 'mod' : tab === 'films' || tab === 'series' ? 'cats' : tab === 'favs' ? (V.mod ? 'mod' : 'items') : 'set';
  }

  function keyOverlay(k) {
    if (overlay.handle) { overlay.handle(k); return; }
    if (overlay.kind === 'input') {
      if (k === K.back) { closeOverlay(); return; }
      if (k === K.down || k === K.up) { overlay.input.blur(); }
      if (k === K.ok && document.activeElement !== overlay.input) overlay.input.focus();
      return;
    }
    if (k === K.back) { closeOverlay(); focusZone(); return; }
    var z = overlay.zone;
    if (z === 'buttons') {
      if (k === K.left && overlay.btnAt > 0) overlay.btnAt--;
      else if (k === K.right && overlay.btnAt < overlay.buttons.length - 1) overlay.btnAt++;
      else if (k === K.down && overlay.sList && overlay.seasons) overlay.zone = 'eps';
      else if (k === K.ok) { overlay.buttons[overlay.btnAt][1](); return; }
    } else if (z === 'seasons') {
      if (k === K.up) { if (!overlay.sList.move(-1)) overlay.zone = 'buttons'; else overlay.eList.set(overlay.sList.current().episodes); }
      else if (k === K.down) { if (overlay.sList.move(1)) overlay.eList.set(overlay.sList.current().episodes); }
      else if (k === K.right || k === K.ok) overlay.zone = 'eps';
    } else if (z === 'eps') {
      if (k === K.up) { if (!overlay.eList.move(-1)) overlay.zone = 'buttons'; }
      else if (k === K.down) overlay.eList.move(1);
      else if (k === K.left) overlay.zone = 'seasons';
      else if (k === K.ok && overlay.eList.current()) {
        // The episode, and the season's following episodes after it with ▲ ▼? No: one at a time, where it was left.
        playVod([overlay.eList.current()], 0);
        return;
      }
    }
    overlayFocus();
  }

  function key(e) {
    var k = e.keyCode;
    if (overlay && overlay.kind === 'input' && document.activeElement === overlay.input && k !== K.back && k !== 27 && k !== K.up && k !== K.down) return;
    if (k === 27 || (k === 8 && !(overlay && overlay.kind === 'pin'))) k = K.back;   // Esc and Backspace when trying it on a computer
    e.preventDefault();
    if (Epg.remindKey(k, K)) return;
    if (Player.key(k, K)) return;
    if (overlay) { keyOverlay(k); return; }
    if (zone === 'tabs') {
      if (k === K.left && tabAt > 0) { tabAt--; openTab(TABS[tabAt][0]); }
      else if (k === K.right && tabAt < TABS.length - 1) { tabAt++; openTab(TABS[tabAt][0]); }
      else if (k === K.down || k === K.ok) { zone = firstZone(); focusZone(); }
      else if (k === K.back) exit();
      return;
    }
    if (V.grab && zone === 'chans') {
      if (k === K.up) moveChannel(-1);
      else if (k === K.down) moveChannel(1);
      else if (k === K.ok || k === K.back) { V.grab = false; toast('Sparat'); V.chans.draw(); sideFor(); }
      return;
    }
    if (zone === 'mod' && V.mod) {
      var to = V.mod.key(k, K);
      if (to === 'tabs') { zone = 'tabs'; focusZone(); }
      else if (to === 'left' && V.sections) { zone = 'sections'; focusZone(); }
      return;
    }
    if (k === K.back) { zone = 'tabs'; focusZone(); return; }
    switch (zone) {
      case 'groups':
        var gnow = V.groups.current();
        if (k === K.up) { if (!V.groups.move(-1)) { zone = 'tabs'; } else showGroup(); }
        else if (k === K.down) { if (V.groups.move(1)) showGroup(); }
        else if (k === K.ok && gnow && gnow.id === '*edit') { Lock.editor(); return; }
        else if (k === K.ok && gnow && Lock.locked(gnow)) { Lock.ask(function (ok) { if (ok) { V.groups.set(groupItems(), V.groups.at); showGroup(); zone = 'chans'; focusZone(); } }); return; }
        else if ((k === K.right || k === K.ok) && V.chans.items.length) zone = 'chans';
        break;
      case 'chans':
        if (k === K.up) { if (!V.chans.move(-1)) zone = 'tabs'; else if (!V.guideMode) sideFor(); else sideFor(); }
        else if (k === K.down) { V.chans.move(1); sideFor(); }
        else if (k === K.left) zone = 'groups';
        else if (k === K.right && !V.guideMode && V.chans.current()) { zone = 'side'; V.btnAt = 0; }
        else if (k === K.ok) playChannel();
        else if (k === K.chUp || k === K.chDown) { V.chans.move(k === K.chUp ? -1 : 1); sideFor(); }
        break;
      case 'side':
        if (k === K.left) { zone = 'chans'; }
        else if (k === K.up && V.btnAt > 0) V.btnAt--;
        else if (k === K.down && V.btnAt < V.buttons.length - 1) V.btnAt++;
        else if (k === K.ok) { V.buttons[V.btnAt][1](); return; }
        sideFor();
        break;
      case 'cats':
        var cnow = V.cats.current();
        if (k === K.up) { if (!V.cats.move(-1)) zone = 'tabs'; else showCat(); }
        else if (k === K.down) { if (V.cats.move(1)) showCat(); }
        else if (k === K.ok && cnow && cnow.id === '*edit') { Lock.editor(V.kind); return; }
        else if (k === K.ok && cnow && Lock.locked({id: V.kind + ':' + cnow.id, name: cnow.name})) { Lock.ask(function (ok) { if (ok) { V.cats.draw(); showCat(); } }); return; }
        else if ((k === K.right || k === K.ok) && V.grid.items.length) zone = 'grid';
        break;
      case 'grid':
        if (k === K.left) { if (!V.grid.move(-1, 0)) zone = 'cats'; }
        else if (k === K.right) V.grid.move(1, 0);
        else if (k === K.up) { if (!V.grid.move(0, -1)) zone = 'tabs'; }
        else if (k === K.down) V.grid.move(0, 1);
        else if (k === K.ok && V.grid.current()) { openDetail(V.grid.current()); return; }
        break;
      case 'sections':
        if (k === K.up) { if (!V.sections.move(-1)) zone = 'tabs'; else showSection(); }
        else if (k === K.down) { if (V.sections.move(1)) showSection(); }
        else if (k === K.right || k === K.ok) zone = V.mod ? 'mod' : 'items';
        break;
      case 'items':
        if (k === K.up) { if (!V.items.move(-1)) zone = 'tabs'; }
        else if (k === K.down) V.items.move(1);
        else if (k === K.left) zone = 'sections';
        else if (k === K.ok && V.items.current()) { openFavItem(V.items.current()); return; }
        break;
      case 'set':
        if (k === K.up) { if (!V.set.move(-1)) zone = 'tabs'; }
        else if (k === K.down) V.set.move(1);
        else if (k === K.ok) { V.setAt = V.set.at; V.set.current()[2](); return; }
        break;
    }
    focusZone();
  }

  function exit() {
    try { window.tizen.application.getCurrentApplication().exit(); } catch (e) {}
  }

  // MARK: - Opened by Free My TV: the link, and maybe a match to play

  function appControl() {
    var out = {};
    try {
      var req = window.tizen.application.getCurrentApplication().getRequestedAppControl();
      var data = (req && req.appControl && req.appControl.data) || [];
      for (var i = 0; i < data.length; i++) out[data[i].key] = data[i].value && data[i].value[0];
    } catch (e) {}
    // For trying it in a browser: ?link=…&play={…}
    var q = /[?&]link=([^&]+)/.exec(location.search); if (q) out.link = decodeURIComponent(q[1]);
    q = /[?&]play=([^&]+)/.exec(location.search); if (q) out.play = decodeURIComponent(q[1]);
    return out;
  }

  function handleLaunch() {
    var d = appControl(), play = null;
    if (d.link && d.link !== Store.link()) { Store.link(d.link); Store.forget(); }
    try { play = d.play ? JSON.parse(d.play) : null; } catch (e) {}
    // From Free My TV's search: a film or an episode from Plex (its addresses), played at once.
    if (play && play.direct && play.direct.urls && play.direct.urls.length) {
      var dp = play.direct, it = {kind: 'film', id: String(dp.id || dp.urls[0]), name: dp.title || '', poster: dp.poster || '', url: dp.urls[0], alt: dp.urls.slice(1)};
      if (dp.from && !Store.position(it)) Store.watched(it, dp.from, 0);
      Player.open([it], 0, {title: dp.title || '', onClose: function () { drawScreen(); }});
      loadChannels(false, function () {});   // the lists behind it, for when Back closes the film
      return;
    }
    loadChannels(false, function () {
      if (Player.playing() && !play) return;
      drawScreen();
      if (loadErr) { toast(Store.link() ? 'Kunde inte läsa din IPTV-lista: ' + loadErr.message : 'Lägg in din IPTV-länk under Inställningar.', 6000); if (!Store.link()) { tabAt = 5; openTab('settings'); } return; }
      // From Free My TV's search: a film or a series from the list, on its own page (Play, the seasons).
      if (play && play.open && play.open.id) {
        var o = play.open;
        Api.use(Store.link());
        openDetail({kind: o.kind === 'series' ? 'series' : 'film', id: String(o.id), name: o.name || '', poster: o.poster || '', url: o.url || '', year: o.year || ''});
        return;
      }
      if (play && play.channels) {
        var items = [];
        for (var i = 0; i < play.channels.length; i++) {
          var ch = find(play.channels[i], (play.channel_ids || [])[i]);
          if (ch && items.indexOf(ch) < 0) items.push(ch);
        }
        if (items.length) Player.open(items, 0, {title: play.title || '', onClose: function (c) { tab = 'sport'; tabAt = 1; zone = 'mod'; drawScreen(); }});
        else toast('Matchens kanaler finns inte i din IPTV-lista.', 6000);
      }
    });
  }

  function start() {
    try {
      var keys = ['ChannelUp', 'ChannelDown', 'MediaPlay', 'MediaPause', 'MediaPlayPause', 'MediaFastForward', 'MediaRewind', 'MediaStop'];
      for (var i = 0; i < keys.length; i++) window.tizen.tvinputdevice.registerKey(keys[i]);
    } catch (e) {}
    document.addEventListener('keydown', key);
    // Opened again (by Free My TV, or from the apps) while running: on Sport again, unless something is playing.
    window.addEventListener('appcontrol', function () {
      if (!Player.playing() && !overlay && tab !== 'sport') { if (V.mod && V.mod.leave) V.mod.leave(); V = {}; tab = 'sport'; tabAt = 1; zone = 'mod'; }
      handleLaunch();
    });
    tickClock();
    drawTabs();
    $('main').innerHTML = '<div class="loading">Hämtar dina kanaler…</div>';
    // Always opens on Sport.
    tab = 'sport'; tabAt = 1; zone = 'mod';
    handleLaunch();
  }

  /** What lock.js, epg.js and sport.js use. */
  var U = {
    el: el, img: img, hm: hm, two: two, List: List, toast: toast, guideOf: guideOf, find: find,
    channels: function () { return channels; }, groups: function () { return groups; }, ordered: orderedGroups, shown: shownGroups,
    channelsOf: channelsOf, groupItems: groupItems, open: open_, groupById: groupById, vodOrdered: vodOrdered,
    overlay: function (o) { if (arguments.length) { overlay = o; if (!o) closeOverlay(); } return overlay; },
    redraw: function () { V = {}; drawScreen(); }, focusTabs: function () { zone = 'tabs'; focusZone(); }
  };

  return {start: start, version: VERSION, u: U};
})();

