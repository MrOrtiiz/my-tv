/*
 * Spel: what the app keeps, and where the games come from.
 *
 * - Store: settings in localStorage (spel.*), game files, covers and saved states in IndexedDB, so a game played once
 *   starts at once the next time, without Google Drive.
 * - Drive: the Google Drive script (drive-script.gs) that hands out the files in one Drive folder: list() and file().
 * - Library: the files as games: which console each one is for (its extension, else its folder's name), its title,
 *   its cover (an image with the same name).
 * ES5 only.
 */
var Store = (function () {
  'use strict';
  var PREFS = 'spel.prefs';
  var prefs = {};
  try { prefs = JSON.parse(localStorage.getItem(PREFS)) || {}; } catch (e) { prefs = {}; }
  function save() { try { localStorage.setItem(PREFS, JSON.stringify(prefs)); } catch (e) {} }

  function get(k) { return prefs[k]; }
  function set(k, v) { prefs[k] = v; save(); }

  /** The games played, newest first (ids). */
  function played(id) {
    var r = (prefs.recent || []).filter(function (x) { return x !== id; });
    r.unshift(id);
    prefs.recent = r.slice(0, 30);
    save();
  }

  // IndexedDB: roms (id → {data, modified}), covers (id → data url), states (id → {state, at})
  var db = null, waiting = [];
  (function openDb() {
    try {
      var r = indexedDB.open('spel', 1);
      r.onupgradeneeded = function () {
        var d = r.result;
        ['roms', 'covers', 'states'].forEach(function (n) { if (!d.objectStoreNames.contains(n)) d.createObjectStore(n); });
      };
      r.onsuccess = function () { db = r.result; flush(); };
      r.onerror = function () { db = false; flush(); };
    } catch (e) { db = false; }
  })();
  function flush() { var w = waiting; waiting = []; for (var i = 0; i < w.length; i++) w[i](); }
  function ready(fn) { if (db !== null) fn(); else waiting.push(fn); }

  function dbGet(store, key, done) {
    ready(function () {
      if (!db) { done(null); return; }
      try {
        var r = db.transaction(store, 'readonly').objectStore(store).get(key);
        r.onsuccess = function () { done(r.result === undefined ? null : r.result); };
        r.onerror = function () { done(null); };
      } catch (e) { done(null); }
    });
  }
  function dbPut(store, key, value, done) {
    ready(function () {
      if (!db) { if (done) done(false); return; }
      try {
        var t = db.transaction(store, 'readwrite');
        t.objectStore(store).put(value, key);
        t.oncomplete = function () { if (done) done(true); };
        t.onerror = t.onabort = function () { if (done) done(false); };
      } catch (e) { if (done) done(false); }
    });
  }
  function dbDel(store, key, done) {
    ready(function () {
      if (!db) { if (done) done(); return; }
      try {
        var t = db.transaction(store, 'readwrite');
        t.objectStore(store)['delete'](key);
        t.oncomplete = t.onerror = function () { if (done) done(); };
      } catch (e) { if (done) done(); }
    });
  }
  function dbClear(store, done) {
    ready(function () {
      if (!db) { if (done) done(); return; }
      try { var t = db.transaction(store, 'readwrite'); t.objectStore(store).clear(); t.oncomplete = t.onerror = function () { if (done) done(); }; }
      catch (e) { if (done) done(); }
    });
  }

  return {get: get, set: set, played: played, dbGet: dbGet, dbPut: dbPut, dbDel: dbDel, dbClear: dbClear};
})();

var Drive = (function () {
  'use strict';

  function url(base, q) { return base + (base.indexOf('?') >= 0 ? '&' : '?') + q; }

  function getJson(u, timeout, done) {
    var x = new XMLHttpRequest(), over = false;
    try { x.open('GET', u, true); } catch (e) { done(e); return; }
    x.timeout = timeout;
    x.onreadystatechange = function () {
      if (x.readyState !== 4 || over) return;
      over = true;
      var o = null;
      try { o = JSON.parse(x.responseText); } catch (e) {}
      if (x.status === 200 && o && !o.error) done(null, o);
      else if (o && o.error) done(new Error(o.error));
      else if (x.status === 200) done(new Error('Drive-skriptet svarade inte med spel (är adressen rätt, slutar den på /exec?)'));
      else done(new Error(x.status ? 'HTTP ' + x.status : 'ingen kontakt med Google'));
    };
    x.ontimeout = function () { if (!over) { over = true; done(new Error('Google svarade inte i tid')); } };
    x.send();
  }

  /** Is this a link to a Google Apps Script web app? */
  function looksRight(u) { return /^https:\/\/script\.google(usercontent)?\.com\/.+/.test(u || ''); }

  function list(base, done) { getJson(url(base, 'list=1&t=' + Date.now()), 60000, function (err, o) { done(err, o && o.files || []); }); }

  function decode(b64) {
    var s = atob(b64), n = s.length, a = new Uint8Array(n);
    for (var i = 0; i < n; i++) a[i] = s.charCodeAt(i);
    return a;
  }

  /** A file, in parts: progress(0..1), done(error, Uint8Array). */
  function file(base, id, progress, done) {
    var parts = [], total = 1, size = 0;
    (function next(n) {
      getJson(url(base, 'file=' + encodeURIComponent(id) + '&part=' + n), 120000, function (err, o) {
        if (err) { done(err); return; }
        parts.push(decode(o.data));
        total = o.parts || 1; size = o.size || 0;
        if (progress) progress(Math.min(1, (n + 1) / total));
        if (n + 1 < total) { next(n + 1); return; }
        var all = new Uint8Array(size || parts.reduce(function (s, p) { return s + p.length; }, 0)), at = 0;
        for (var i = 0; i < parts.length; i++) { all.set(parts[i], at); at += parts[i].length; }
        done(null, all);
      });
    })(0);
  }

  return {list: list, file: file, looksRight: looksRight};
})();

var Library = (function () {
  'use strict';
  // The consoles: EmulatorJS core, the extensions that are theirs, the words in a folder's name that mean them.
  var SYSTEMS = [
    {id: 'nes', name: 'NES', core: 'fceumm', ext: ['nes', 'unf', 'unif'], words: /\bnes\b|famicom|nintendo ?entertainment|nintendo ?8/i, color: ['#D0352B', '#7A1712']},
    {id: 'snes', name: 'SNES', core: 'snes9x', ext: ['sfc', 'smc', 'fig', 'swc'], words: /snes|super ?nintendo|super ?famicom|super ?nes/i, color: ['#7D63F2', '#3A2A8C']},
    {id: 'gba', name: 'Game Boy Advance', core: 'mgba', ext: ['gba'], words: /\bgba\b|game ?boy ?advance/i, color: ['#5E4FD6', '#2B2275']},
    {id: 'gbc', name: 'Game Boy Color', core: 'gambatte', ext: ['gbc'], words: /\bgbc\b|game ?boy ?colou?r/i, color: ['#1FA97A', '#0B5A3F']},
    {id: 'gb', name: 'Game Boy', core: 'gambatte', ext: ['gb'], words: /\bgb\b|game ?boy/i, color: ['#7E9A3A', '#3D4F15']},
    {id: 'md', name: 'Mega Drive', core: 'genesis_plus_gx', scheme: 'segaMD', ext: ['md', 'gen', 'smd'], words: /mega ?drive|genesis|\bmd\b/i, color: ['#2F80ED', '#0E3A7A']},
    {id: 'sms', name: 'Master System', core: 'smsplus', scheme: 'segaMS', ext: ['sms'], words: /master ?system|\bsms\b/i, color: ['#E0403A', '#5E1310']},
    {id: 'gg', name: 'Game Gear', core: 'smsplus', scheme: 'segaGG', ext: ['gg'], words: /game ?gear|\bgg\b/i, color: ['#3A3D46', '#121318']}
  ];
  var BY_ID = {};
  for (var i = 0; i < SYSTEMS.length; i++) BY_ID[SYSTEMS[i].id] = SYSTEMS[i];
  var IMAGE = /\.(png|jpe?g|webp|gif)$/i, PACKED = /\.(zip|7z)$/i;

  function ext(name) { var m = /\.([a-z0-9]+)$/i.exec(name || ''); return m ? m[1].toLowerCase() : ''; }
  function base(name) { return String(name || '').replace(/\.[a-z0-9]+$/i, ''); }
  function key(name) { return base(name).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }

  function systemOf(f) {
    var e = ext(f.name), i;
    if (!PACKED.test(f.name) && e !== 'bin') for (i = 0; i < SYSTEMS.length; i++) if (SYSTEMS[i].ext.indexOf(e) >= 0) return SYSTEMS[i];
    // A .zip, .7z or .bin: by the folder's name (the nearest one first), else by a hint in its own name.
    var parts = String(f.folder || '').split('/').reverse().concat([base(f.name)]);
    for (var p = 0; p < parts.length; p++) for (i = 0; i < SYSTEMS.length; i++) if (SYSTEMS[i].words.test(parts[p])) return SYSTEMS[i];
    if (e === 'bin') return BY_ID.md;
    return null;
  }

  /** "Super Mario Land (World) (Rev 1)" → title "Super Mario Land", tags "World · Rev 1". */
  function title(name) {
    var b = base(name).replace(/_/g, ' '), tags = [], m, re = /\s*[\[(]([^\])]*)[\])]/g;
    while ((m = re.exec(b))) if (m[1] && m[1] !== '!') tags.push(m[1]);
    return {title: b.replace(/\s*[\[(][^\])]*[\])]/g, '').replace(/\s+/g, ' ').trim() || b, tags: tags.join(' · ')};
  }

  /** The Drive files as games: [{id, name, title, tags, system, folder, size, modified, cover}], by title. */
  function build(files) {
    var covers = {}, games = [], i;
    for (i = 0; i < files.length; i++) if (IMAGE.test(files[i].name)) covers[key(files[i].name)] = files[i].id;
    for (i = 0; i < files.length; i++) {
      var f = files[i];
      if (IMAGE.test(f.name)) continue;
      var s = systemOf(f);
      if (!s) continue;
      var t = title(f.name);
      games.push({id: f.id, name: f.name, title: t.title, tags: t.tags, system: s.id, folder: f.folder || '', size: f.size || 0,
        modified: f.modified || 0, cover: covers[key(f.name)] || covers[key(t.title)] || ''});
    }
    games.sort(function (a, b) { return a.title.localeCompare(b.title, 'sv'); });
    return games;
  }

  return {SYSTEMS: SYSTEMS, system: function (id) { return BY_ID[id]; }, build: build, ext: ext};
})();
