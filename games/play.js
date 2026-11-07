/*
 * Spel: a game running. EmulatorJS 4.2.3 (GPL-3.0, RetroArch's cores in WebAssembly) from jsDelivr, in a frame of its
 * own over the app, so each game starts clean and leaves nothing running when it's closed.
 *
 * - The game file is handed to the frame as bytes (no address), the core files come from the cores' npm packages.
 * - Controls: a game controller (Bluetooth or USB) as on the console, by position: bottom B, right A, left Y, top X,
 *   shoulders L R, Select, Start. The remote: arrows, OK = A, red = B, green = Y, yellow = X, blue = Select,
 *   ▶ (Play) = Start, CH ▲ ▼ = L R.
 * - Back on the remote, or Select + Start (or the controller's middle button) together: the menu (continue, save,
 *   load, start over, quit). Quitting saves where it was: the next time, the game continues from there.
 * ES5 only.
 */
var Play = (function () {
  'use strict';
  var EJS = 'https://cdn.jsdelivr.net/npm/@emulatorjs/emulatorjs@4.2.3/data/';
  var CORES = 'https://cdn.jsdelivr.net/npm/@emulatorjs/core-';
  var VER = '@4.2.3/';

  var frame = null, game = null, em = null, menuOn = false, menuAt = 0, onEnd = null, started = false, padTimer = null, watchdog = null;

  // A log of each start (kept in localStorage, shown under Inställningar): where a start that hangs stopped.
  var run = null;
  function log(step) {
    if (!run) return;
    run.steps.push(Math.round((Date.now() - run.at) / 100) / 10 + ' s: ' + step);
    if (run.steps.length > 40) run.steps.splice(1, 1);
    try { localStorage.setItem('spel.lastrun', JSON.stringify(run)); } catch (e) {}
    var l = document.getElementById('emuload');
    if (l && !started) l.setAttribute('data-step', step);
  }
  function lastRun() { try { return JSON.parse(localStorage.getItem('spel.lastrun')); } catch (e) { return null; } }
  function support() {
    var out = [];
    out.push('WebAssembly ' + (typeof WebAssembly === 'object' ? 'ja' : 'NEJ'));
    try { var c = document.createElement('canvas'); out.push('WebGL2 ' + (c.getContext('webgl2') ? 'ja' : 'nej') + ', WebGL ' + (c.getContext('webgl') ? 'ja' : 'NEJ')); } catch (e) { out.push('WebGL fel'); }
    out.push('ljud ' + (window.AudioContext || window.webkitAudioContext ? 'ja' : 'nej'));
    try { if (performance && performance.memory) out.push('minne ' + Math.round(performance.memory.jsHeapSizeLimit / 1048576) + ' MB'); } catch (e) {}
    out.push(navigator.userAgent.replace(/.*(Chrome\/[0-9.]+).*/, '$1'));
    return out.join(', ');
  }
  var K = {back: 10009, ok: 13, left: 37, up: 38, right: 39, down: 40, red: 403, green: 404, yellow: 405, blue: 406,
    play: 415, pause: 19, playPause: 10252, chUp: 427, chDown: 428, exit: 10182};

  function $(id) { return document.getElementById(id); }

  /** The files of a core, at jsDelivr: each variant EmulatorJS may ask for, and its report. */
  function paths(core) {
    var p = {}, root = CORES + core + VER;
    ['', '-legacy', '-thread', '-thread-legacy'].forEach(function (v) { p[core + v + '-wasm.data'] = root + core + v + '-wasm.data'; });
    p[core + '.json'] = root + 'reports/' + core + '.json';
    return p;
  }

  // Player 1's buttons: [libretro button, remote key, controller button]. libretro: 0 B, 1 Y, 2 Select, 3 Start,
  // 4-7 ▲▼◀▶, 8 A, 9 X, 10 L, 11 R. Controller names are EmulatorJS's (BUTTON_1 = bottom, 2 = right, 3 = left, 4 = top).
  var MAP = [
    [0, K.red, 'BUTTON_1'], [1, K.green, 'BUTTON_3'], [2, K.blue, 'SELECT'], [3, K.play, 'START'],
    [4, K.up, 'DPAD_UP'], [5, K.down, 'DPAD_DOWN'], [6, K.left, 'DPAD_LEFT'], [7, K.right, 'DPAD_RIGHT'],
    [8, K.ok, 'BUTTON_2'], [9, K.yellow, 'BUTTON_4'], [10, K.chUp, 'LEFT_TOP_SHOULDER'], [11, K.chDown, 'RIGHT_TOP_SHOULDER'],
    [12, 0, 'LEFT_BOTTOM_SHOULDER'], [13, 0, 'RIGHT_BOTTOM_SHOULDER']
  ];

  function controls() {
    var p0 = {}, empty = {};
    for (var i = 0; i < MAP.length; i++) p0[MAP[i][0]] = {value: MAP[i][1] || '', value2: MAP[i][2]};
    return {0: p0, 1: empty, 2: {}, 3: {}};
  }

  /** Starts a game: g (from Library), rom (Uint8Array), state (Uint8Array to continue from, or null); end() when closed. */
  function start(g, rom, state, end) {
    stop(true);
    game = g; onEnd = end; started = false; menuOn = false;
    var sys = Library.system(g.system);
    run = {game: g.title, system: sys.name, at: Date.now(), ok: false, steps: []};
    log('start, ' + Math.round(rom.length / 1024) + ' kB, kärna ' + sys.core + ' · ' + support());
    frame = document.createElement('iframe');
    frame.id = 'emu';
    frame.setAttribute('allow', 'gamepad; autoplay; fullscreen');
    $('stage').appendChild(frame);
    document.body.className += ' playing';
    Play._rom = rom;
    Play._config = {
      EJS_player: '#game', EJS_core: sys.core, EJS_gameName: g.title, EJS_gameID: 'spel-' + g.id, EJS_pathtodata: EJS,
      EJS_paths: paths(sys.core), EJS_DEBUG_XX: true, EJS_startOnLoaded: true, EJS_color: '#0A84FF', EJS_backgroundColor: '#000000',
      EJS_language: 'en-US', EJS_disableAutoLang: false, EJS_volume: 0.8, EJS_defaultControls: controls(),
      EJS_controlScheme: sys.scheme || null, EJS_threads: false,
      EJS_Buttons: {playPause: false, restart: false, mute: false, settings: false, fullscreen: false, saveState: false, loadState: false,
        screenRecord: false, gamepad: false, cheat: false, volume: false, saveSavFiles: false, loadSavFiles: false, quickSave: false,
        quickLoad: false, screenshot: false, cacheManager: false, exitEmulation: false, netplay: false, diskButton: false, contextMenu: false}
    };
    Play._state = state || null;
    var doc = frame.contentWindow.document;
    doc.open();
    doc.write('<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#000;overflow:hidden}'
      + '#game{width:100%;height:100%}.ejs_menu_bar,.ejs_context_menu{display:none!important}</style></head><body><div id="game"></div>'
      + '<script>(function(){var c=parent.Play._config;for(var k in c)window[k]=c[k];window.EJS_gameUrl=new Uint8Array(parent.Play._rom);'
      + 'window.onerror=function(m,u,l){parent.Play._log("fel: "+m+" ("+String(u||"").split("/").pop()+":"+l+")");};'
      + 'window.addEventListener("unhandledrejection",function(e){parent.Play._log("fel: "+(e.reason&&e.reason.message||e.reason));});'
      + 'window.EJS_ready=function(){parent.Play._log("emulatorn redo, hämtar kärnan");};'
      + 'window.EJS_onGameStart=function(){parent.Play._started();};parent.Play._log("ramen klar, hämtar EmulatorJS");})();<\/script>'
      + '<script src="' + EJS + 'loader.js" onload="parent.Play._log(\'laddaren hämtad\')" onerror="parent.Play._log(\'laddaren kunde inte hämtas\')"><\/script></body></html>');
    doc.close();
    frame.contentWindow.addEventListener('keydown', inFrameKey, true);
    loading('Startar ' + g.title + '…');
    watchPad();
    // A start that never gets going: stop it after 45 s instead of leaving a black screen.
    clearTimeout(watchdog);
    watchdog = setTimeout(function () {
      if (started || !frame) return;
      log('gav upp efter 45 s');
      stop(false);
      App.toast('Spelet startade inte. Se Inställningar → Senaste start.');
    }, 45000);
  }

  function loading(text) {
    var l = $('emuload');
    if (!l) { l = document.createElement('div'); l.id = 'emuload'; $('stage').appendChild(l); }
    l.textContent = text || '';
    if (!text) l.removeAttribute('data-step');
    l.style.display = text ? 'block' : 'none';
  }

  /** EmulatorJS has the game running. */
  function onStarted() {
    started = true;
    clearTimeout(watchdog);
    log('spelet igång');
    if (run) { run.ok = true; log('klart'); }
    em = frame && frame.contentWindow.EJS_emulator;
    loading('');
    if (!em) return;
    try {   // the remote's keys as player 1's buttons (the settings EmulatorJS kept from before don't win)
      var c = controls()[0];
      for (var j in c) if (c.hasOwnProperty(j)) { em.controls[0][j] = em.controls[0][j] || {}; em.controls[0][j].value = c[j].value; em.controls[0][j].value2 = c[j].value2; }
    } catch (e) {}
    if (Play._state && em.gameManager && em.gameManager.supportsStates()) {
      try { em.gameManager.loadState(new frame.contentWindow.Uint8Array(Play._state)); App.toast('Fortsätter där du slutade. Vill du börja om: Tillbaka → Börja om.'); } catch (e) {}
    }
    Play._state = null;
    Play._rom = null;
    focusGame();
  }

  function focusGame() {
    try { frame.contentWindow.focus(); var c = frame.contentWindow.document.querySelector('#game'); if (c) { c.setAttribute('tabindex', '-1'); c.focus(); } } catch (e) {}
  }

  // MARK: - The menu

  var ITEMS = [
    ['Fortsätt', function () { menu(false); }],
    ['Spara läge', function () { saveState('slot', function (ok) { App.toast(ok ? 'Sparat. "Ladda läge" tar dig tillbaka hit.' : 'Det här spelet kan inte sparas så.'); menu(false); }); }],
    ['Ladda läge', function () { loadSlot(); }],
    ['Börja om', function () { try { em.gameManager.restart(); } catch (e) {} Store.dbDel('states', game.id + ':auto'); menu(false); }],
    ['Avsluta spelet', function () { quit(); }]
  ];

  function menu(on) {
    if (!frame) return;
    menuOn = on;
    var m = $('emumenu');
    if (!m) { m = document.createElement('div'); m.id = 'emumenu'; $('stage').appendChild(m); }
    if (!on) { m.style.display = 'none'; try { em && em.play(); } catch (e) {} focusGame(); return; }
    try { em && em.pause(); } catch (e) {}
    menuAt = 0;
    drawMenu();
    m.style.display = 'block';
    try { window.focus(); } catch (e) {}
  }

  function drawMenu() {
    var m = $('emumenu');
    m.innerHTML = '';
    var box = document.createElement('div');
    box.className = 'box';
    m.appendChild(box);
    var h = document.createElement('div'); h.className = 'h'; h.textContent = game.title; box.appendChild(h);
    var s = document.createElement('div'); s.className = 's'; s.textContent = Library.system(game.system).name; box.appendChild(s);
    ITEMS.forEach(function (it, i) {
      var b = document.createElement('div');
      b.className = 'item' + (i === menuAt ? ' focus' : '');
      b.textContent = it[0];
      b.onclick = function () { menuAt = i; it[1](); };
      box.appendChild(b);
    });
    var t = document.createElement('div'); t.className = 'tip';
    t.textContent = 'Fjärrkontroll: OK = A · röd = B · grön = Y · gul = X · blå = Select · ▶ = Start · CH ▲▼ = L R';
    box.appendChild(t);
  }

  function menuKey(k) {
    if (k === K.up) { menuAt = (menuAt + ITEMS.length - 1) % ITEMS.length; drawMenu(); }
    else if (k === K.down) { menuAt = (menuAt + 1) % ITEMS.length; drawMenu(); }
    else if (k === K.ok) ITEMS[menuAt][1]();
    else if (k === K.back || k === 27 || k === 8) menu(false);
  }

  function saveState(slot, done) {
    try {
      if (!em || !em.gameManager.supportsStates()) { done(false); return; }
      var st = em.gameManager.getState();
      Store.dbPut('states', game.id + ':' + slot, {state: st, at: Date.now()}, function (ok) { done(ok); });
    } catch (e) { done(false); }
  }

  function loadSlot() {
    Store.dbGet('states', game.id + ':slot', function (v) {
      if (!v) { App.toast('Inget sparat läge än: välj Spara läge först.'); return; }
      try { em.gameManager.loadState(new frame.contentWindow.Uint8Array(v.state)); } catch (e) { App.toast('Kunde inte ladda läget.'); }
      menu(false);
    });
  }

  /** Quits: where it was is saved (and the game's own saves), then the frame goes. */
  function quit() {
    var g = game;
    App.toast('Sparar…');
    saveState('auto', function () {
      try { em.gameManager.saveSaveFiles(); } catch (e) {}
      setTimeout(function () { stop(false); App.toast(g.title + ' är sparat. Det fortsätter där du slutade nästa gång.'); }, 600);
    });
  }

  function stop(quiet) {
    clearTimeout(watchdog);
    if (frame && !started) log('avbruten innan start');
    if (padTimer) { clearInterval(padTimer); padTimer = null; }
    var m = $('emumenu'); if (m) m.style.display = 'none';
    loading('');
    if (frame) { try { frame.contentWindow.document.open(); frame.contentWindow.document.close(); } catch (e) {} frame.parentNode.removeChild(frame); }
    frame = null; em = null; menuOn = false;
    document.body.className = document.body.className.replace(/\s*\bplaying\b/g, '');
    var end = onEnd; onEnd = null;
    if (!quiet && end) end();
  }

  // MARK: - Keys and the controller

  /** Keys inside the game's frame: Back opens the menu (everything else is the game's). */
  function inFrameKey(e) {
    var k = e.keyCode;
    if (k === K.back || k === 27 || k === K.exit) {
      e.preventDefault(); e.stopPropagation();
      if (started) menu(true); else stop(false);
    }
  }

  /** Keys in the app while a game is on (the menu). Returns true when it took the key. */
  function key(e) {
    if (!frame) return false;
    if (menuOn) { menuKey(e.keyCode); return true; }
    if (e.keyCode === K.back || e.keyCode === 27) { if (started) menu(true); else stop(false); return true; }
    focusGame();
    return true;
  }

  var padPrev = {};
  function watchPad() {
    if (padTimer || !navigator.getGamepads) return;
    padTimer = setInterval(function () {
      var pads = navigator.getGamepads ? navigator.getGamepads() : [], p = null;
      for (var i = 0; i < pads.length; i++) if (pads[i] && pads[i].connected) { p = pads[i]; break; }
      if (!p) return;
      var b = function (n) { return !!(p.buttons[n] && p.buttons[n].pressed); };
      var now = {sel: b(8), start: b(9), home: b(16), up: b(12) || p.axes[1] < -0.6, down: b(13) || p.axes[1] > 0.6, a: b(0), back: b(1)};
      function fresh(k) { return now[k] && !padPrev[k]; }
      if (!menuOn && started && ((now.sel && now.start && (fresh('sel') || fresh('start'))) || fresh('home'))) menu(true);
      else if (menuOn) {
        if (fresh('up')) menuKey(K.up);
        else if (fresh('down')) menuKey(K.down);
        else if (fresh('a')) menuKey(K.ok);
        else if (fresh('back') || fresh('home')) menu(false);
      }
      padPrev = now;
    }, 60);
  }

  return {start: start, key: key, playing: function () { return !!frame; }, lastRun: lastRun, support: support,
    _started: onStarted, _log: log, _rom: null, _config: null, _state: null};
})();
