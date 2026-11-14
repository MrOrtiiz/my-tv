/*
 * Search, in every tab: "🔍 Sök" first in the left column (Live, TV-guide, Sport, Filmer, Serier, Favoriter). OK on it
 * opens a field (the TV's keyboard; SmartThings on the phone can type too) with the number of hits and the first ones
 * as you type; Klar/Enter shows them all in the tab, where the group's list would be. An empty search takes it away.
 * The search is kept while the app is open, one per tab. Every word has to be in the name (in any order, without
 * accents: "atletico" finds "Atlético"); names that start with the search come first.
 * Uses App.u (app.js). ES5 only.
 */
var Search = (function () {
  'use strict';
  var queries = {};

  function U() { return App.u; }

  /** Text for matching: lower case, no accents, letters and digits only, one space between words. */
  function fold(s) {
    s = String(s || '').toLowerCase();
    if (s.normalize) s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
    return s.replace(/[^a-z0-9]+/g, ' ').replace(/^\s+|\s+$/g, '');
  }
  /** A channel's name without its country tag ("ES: ", "|UK| "), for "starts with". */
  function bare(s) { return String(s || '').replace(/^\s*[A-Za-z]{2,3}\s*[:|\-]\s*|^\s*\|[A-Za-z]{2,3}\|\s*/, ''); }

  /** The items with every word of q in textOf(item), best first: the name starts with the search, then a word in it
   *  does, then the rest; in the list's own order within each. */
  function filter(items, q, textOf, nameOf) {
    var ws = fold(q).split(' ').filter(function (w) { return w; }), whole = ws.join(' '), out = [];
    if (!ws.length) return [];
    nameOf = nameOf || textOf;
    for (var i = 0; i < items.length; i++) {
      var t = ' ' + fold(textOf(items[i])) + ' ', ok = true;
      for (var j = 0; j < ws.length && ok; j++) if (t.indexOf(ws[j]) < 0) ok = false;
      if (!ok) continue;
      var n = fold(bare(nameOf(items[i])));
      out.push({it: items[i], s: n.indexOf(whole) === 0 ? 0 : (' ' + n).indexOf(' ' + ws[0]) >= 0 ? 1 : 2, i: i});
    }
    out.sort(function (a, b) { return a.s - b.s || a.i - b.i; });
    return out.map(function (x) { return x.it; });
  }

  /** The search of a tab (live, guide, sport, films, series, favs); with q, sets it. */
  function query(tab, q) { if (arguments.length > 1) queries[tab] = String(q || '').replace(/^\s+|\s+$/g, ''); return queries[tab] || ''; }
  /** The row in the left column: "🔍  Sök", or the search. */
  function item(tab, n) { var q = query(tab); return {id: '*search', name: q ? '🔍  ' + q : '🔍  Sök', q: q, n: q && n ? n : 0}; }

  /**
   * The search field. opts: {tab, title, placeholder, find(q, cb): cb(hits) or cb(null) while loading, name(hit) and
   * sub(hit) for the first hits}. Klar/Enter keeps the search and calls done(q); Tillbaka closes it and calls done(null).
   */
  function ask(opts, done) {
    var u = U(), o = document.getElementById('overlay'), seq = 0, timer = 0;
    o.innerHTML = '';
    o.className = 'on';
    var sheet = u.el('div', 'sheet search glass', o);
    u.el('div', 'dtitle', sheet, opts.title);
    var input = u.el('input', 'field', sheet);
    input.type = 'text';
    input.value = query(opts.tab);
    input.placeholder = opts.placeholder || '';
    input.setAttribute('autocapitalize', 'none');
    input.setAttribute('autocorrect', 'off');
    input.setAttribute('autocomplete', 'off');
    var count = u.el('div', 'scount', sheet, ' '), hits = u.el('div', 'shits', sheet);
    u.el('div', 'hint', sheet, 'Klar (Enter) visar alla träffar. Ett tomt fält tar bort sökningen. Tillbaka avbryter.  Tips: SmartThings-appen på mobilen kan skriva.');

    function preview() {
      var q = input.value, mine = ++seq;
      hits.innerHTML = '';
      if (!fold(q)) { count.textContent = opts.empty || 'Skriv vad du letar efter.'; count.className = 'scount'; return; }
      count.textContent = 'Söker…';
      opts.find(q, function (list) {
        if (mine !== seq || u.overlay() !== st) return;
        hits.innerHTML = '';
        if (!list) { count.textContent = opts.loading || 'Hämtar…'; return; }
        count.textContent = list.length ? list.length + (list.length === 1 ? ' träff' : ' träffar') : 'Inga träffar';
        count.className = 'scount' + (list.length ? ' some' : '');
        for (var i = 0; i < list.length && i < 6; i++) {
          var r = u.el('div', 'shit', hits);
          u.el('span', 'sn', r, opts.name(list[i]));
          var sub = opts.sub ? opts.sub(list[i]) : '';
          if (sub) u.el('span', 'ss', r, sub);
        }
        if (list.length > 6) u.el('div', 'shit more', hits, '+ ' + (list.length - 6) + ' till');
      });
    }
    function later() { clearTimeout(timer); timer = setTimeout(preview, 250); }
    function finish(q) {
      clearTimeout(timer);
      seq++;
      try { input.blur(); } catch (e) {}
      u.overlay(null);
      if (q !== null) query(opts.tab, q);
      done(q === null ? null : query(opts.tab));
    }

    var st = {kind: 'input', input: input, handle: function (k) {
      if (k === 10009 || k === 27) { finish(null); return; }
      if (k === 38 || k === 40) { input.blur(); return; }
      if (k === 13) { if (document.activeElement !== input) input.focus(); else finish(input.value); }
    }};
    input.oninput = later;
    input.onkeydown = function (e) {
      // Enter, or Klar on the TV's keyboard; Avbryt (65385) only closes the keyboard.
      // Stopped here: the same key mustn't reach the app's keys too (as OK on what's under the field).
      if (e.keyCode === 13 || e.keyCode === 65376) { e.preventDefault(); e.stopPropagation(); finish(input.value); }
      else if (e.keyCode === 65385) { e.stopPropagation(); input.blur(); }
    };
    u.overlay(st);
    preview();
    setTimeout(function () { input.focus(); }, 50);
  }

  return {fold: fold, filter: filter, query: query, item: item, ask: ask};
})();
