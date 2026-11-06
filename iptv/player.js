/*
 * The player: live channels (▲ ▼ zap through the list they were picked from, OK shows what's on) and films and episodes
 * (◀ ▶ jump 10 s, held longer 60 s, OK pauses; where you stop is kept). HLS natively or through hls.js, MPEG-TS through
 * mpegts.js, files (mp4, mkv) natively; the libraries come from jsDelivr only when needed. ES5 only.
 */
var Player = (function () {
  'use strict';
  var HLSJS = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.20/dist/hls.min.js';
  var MPEGTS = 'https://cdn.jsdelivr.net/npm/mpegts.js@1.8.0/dist/mpegts.min.js';
  var TRY = 15000;
  var box, video, bar, st = null, hls = null, ts = null, seq = 0, tryTimer = 0, barTimer = 0, saveTimer = 0, tick = 0;

  function el(tag, cls, parent, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    if (parent) parent.appendChild(n);
    return n;
  }
  function two(n) { return (n < 10 ? '0' : '') + n; }
  function hm(ms) { var d = new Date(ms); return two(d.getHours()) + ':' + two(d.getMinutes()); }
  function clock(s) { s = Math.max(0, Math.floor(s || 0)); var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return (h ? h + ':' + two(m) : m) + ':' + two(s % 60); }

  function ensure() {
    if (box) return;
    box = el('div', '', document.body);
    box.id = 'player';
    video = el('video', '', box);
    video.setAttribute('playsinline', '');
    bar = el('div', 'bar glass', box);
  }

  var libs = {};
  function lib(name, src, done) {
    if (window[name]) { done(true); return; }
    if (libs[name]) { libs[name].push(done); return; }
    libs[name] = [done];
    var s = document.createElement('script');
    s.src = src;
    s.onload = s.onerror = function () { var w = libs[name]; libs[name] = null; for (var i = 0; i < w.length; i++) w[i](!!window[name]); };
    document.body.appendChild(s);
  }

  function stopStream() {
    clearTimeout(tryTimer);
    if (hls) { try { hls.destroy(); } catch (e) {} hls = null; }
    if (ts) { try { ts.unload(); ts.detachMediaElement(); ts.destroy(); } catch (e) {} ts = null; }
    video.onplaying = video.onerror = video.onloadedmetadata = null;
    try { video.pause(); } catch (e) {}
    video.removeAttribute('src');
    try { video.load(); } catch (e) {}
  }

  function ways(item) {
    var out = [];
    if (item.kind && item.kind !== 'live') {   // a film or an episode: its address, then any others (Plex: the file, then HLS)
      var urls = [item.url].concat(item.alt || []);
      for (var i = 0; i < urls.length; i++) {
        if (/\.ts(\?|$)/i.test(urls[i])) out.push({how: 'mpegts', url: urls[i], live: false});
        out.push({how: 'native', url: urls[i]});
        if (/\.m3u8(\?|$)/i.test(urls[i])) out.push({how: 'hls', url: urls[i]});
      }
      return out;
    }
    if (item.hls) { out.push({how: 'native', url: item.hls}); out.push({how: 'hls', url: item.hls}); }
    if (item.ts) { out.push({how: 'mpegts', url: item.ts, live: true}); out.push({how: 'native', url: item.ts}); }
    return out;
  }

  function start(item, from) {
    var mine = ++seq, list = ways(item), n = 0;
    function next() {
      if (mine !== seq) return;
      if (n >= list.length) { stopStream(); status('Det gick inte att spela. ' + (st.kind === 'live' ? 'Prova en annan kanal med ▲ ▼.' : ''), true); return; }
      var w = list[n++];
      stopStream();
      tryTimer = setTimeout(next, TRY);
      video.onplaying = function () { if (mine !== seq) return; clearTimeout(tryTimer); status(''); };
      if (from) video.onloadedmetadata = function () { try { video.currentTime = from; } catch (e) {} from = 0; };
      if (w.how === 'native') {
        video.onerror = function () { if (mine === seq) next(); };
        video.src = w.url;
        var p = video.play();
        if (p && p['catch']) p['catch'](function () {});
      } else if (w.how === 'hls') {
        lib('Hls', HLSJS, function (ok) {
          if (mine !== seq) return;
          if (!ok || !window.Hls.isSupported()) { next(); return; }
          hls = new window.Hls({maxBufferLength: 20});
          hls.on(window.Hls.Events.ERROR, function (e, d) { if (d && d.fatal && mine === seq) next(); });
          hls.loadSource(w.url);
          hls.attachMedia(video);
          hls.on(window.Hls.Events.MANIFEST_PARSED, function () { var p2 = video.play(); if (p2 && p2['catch']) p2['catch'](function () {}); });
        });
      } else {
        lib('mpegts', MPEGTS, function (ok) {
          if (mine !== seq) return;
          if (!ok || !window.mpegts.isSupported()) { next(); return; }
          ts = window.mpegts.createPlayer({type: 'mpegts', isLive: !!w.live, url: w.url}, {enableWorker: false, liveBufferLatencyChasing: !!w.live});
          ts.on(window.mpegts.Events.ERROR, function () { if (mine === seq) next(); });
          ts.attachMediaElement(video);
          ts.load();
          var p3 = ts.play();
          if (p3 && p3['catch']) p3['catch'](function () {});
        });
      }
    }
    status('Startar…', true);
    next();
  }

  // MARK: - The bar: the channel and what's on, or the film and where it is

  function status(text, keep) { st.status = text; draw(keep || !!text); }

  function draw(keep) {
    if (!st) return;
    var it = st.list[st.at];
    bar.innerHTML = '';
    var top = el('div', 'line', bar);
    if (st.kind === 'live') {
      if (it.logo) { var lg = el('img', 'logo', top); lg.onerror = function () { this.style.display = 'none'; }; lg.src = it.logo; }
      el('span', 'name', top, it.name);
      if (st.list.length > 1) el('span', 'count', top, (st.at + 1) + ' / ' + st.list.length);
      if (st.title) el('div', 'sub', bar, st.title);
      var g = st.guide || [], now = Date.now();
      for (var i = 0; i < g.length && i < 2; i++) {
        var row = el('div', 'prog' + (i === 0 && g[0].start <= now ? ' now' : ''), bar);
        el('span', 'time', row, hm(g[i].start) + '–' + hm(g[i].stop));
        el('span', 'title', row, g[i].title);
        if (i === 0 && g[0].start <= now) {
          var pr = el('div', 'progress', row), f = el('div', 'fill', pr);
          f.style.width = Math.min(100, (now - g[0].start) / (g[0].stop - g[0].start) * 100) + '%';
        }
      }
    } else {
      el('span', 'name', top, it.kind === 'episode' ? it.seriesName + '  ·  S' + it.season + ' A' + it.n + '  ·  ' + it.title : it.name);
      var d = video.duration, c = video.currentTime;
      if (d && isFinite(d)) {
        var pr2 = el('div', 'progress big', bar), f2 = el('div', 'fill', pr2);
        f2.style.width = (c / d * 100) + '%';
        el('div', 'times', bar, clock(c) + '  /  ' + clock(d) + (video.paused ? '   ❚❚' : ''));
      }
    }
    if (st.status) el('div', 'status', bar, st.status);
    el('div', 'keys', bar, st.kind === 'live' ? (st.list.length > 1 ? '▲ ▼ byter kanal  ·  ' : '') + 'OK visar vad som går  ·  Tillbaka till listan'
      : '◀ ▶ spolar  ·  OK pausar  ·  Tillbaka till listan');
    bar.className = 'bar glass on';
    clearTimeout(barTimer);
    if (!keep) barTimer = setTimeout(function () { bar.className = 'bar glass'; }, 5000);
  }

  function loadGuide() {
    var it = st.list[st.at], mine = seq;
    st.guide = null;
    Api.guide(it, function (err, g) { if (st && mine === seq) { st.guide = g; draw(!!st.status); } }, 3);
  }

  function playAt(i) {
    st.at = (i + st.list.length) % st.list.length;
    var it = st.list[st.at];
    start(it, st.kind === 'live' ? 0 : Store.position(it));
    if (st.kind === 'live') { Store.watched(it); loadGuide(); }
    draw(true);
  }

  function save() {
    if (!st || st.kind === 'live') return;
    var d = video.duration;
    if (video.currentTime > 5) Store.watched(st.list[st.at], video.currentTime, isFinite(d) ? d : 0);
  }

  // MARK: - Opening, closing, keys

  /** Plays list[at]: channels (kind 'live') or a film / an episode. onClose(item) when Back brings the list back. */
  function open(list, at, opts) {
    ensure();
    opts = opts || {};
    st = {list: list, at: at || 0, kind: list[at || 0].kind && list[at || 0].kind !== 'live' ? 'vod' : 'live', title: opts.title || '', onClose: opts.onClose, status: ''};
    box.className = 'on';
    playAt(st.at);
    clearInterval(saveTimer);
    saveTimer = setInterval(function () { save(); if (st && st.kind !== 'live' && /\bon\b/.test(bar.className)) draw(); }, 10000);
  }

  function close() {
    if (!st) return;
    save();
    clearInterval(saveTimer);
    seq++;
    stopStream();
    var it = st.list[st.at], cb = st.onClose;
    st = null;
    box.className = '';
    if (cb) cb(it);
  }

  var holdAt = 0, holdKey = 0;
  /** A key while playing: true when the player took it. */
  function key(k, K) {
    if (!st) return false;
    if (k === K.back) { close(); return true; }
    if (st.kind === 'live') {
      if (k === K.up || k === K.chUp) { if (st.list.length > 1) playAt(st.at - 1); else draw(); return true; }
      if (k === K.down || k === K.chDown) { if (st.list.length > 1) playAt(st.at + 1); else draw(); return true; }
      draw(!!st.status);
      return true;
    }
    if (k === K.left || k === K.right || k === K.rew || k === K.ff) {
      var now = Date.now();
      if (holdKey === k && now - holdAt < 400) tick++; else tick = 0;
      holdKey = k; holdAt = now;
      var step = tick > 4 ? 60 : 10, d = (k === K.left || k === K.rew) ? -step : step;
      try { video.currentTime = Math.max(0, Math.min((video.duration || 1e9) - 2, video.currentTime + d)); } catch (e) {}
      draw();
      return true;
    }
    if (k === K.ok || k === K.play || k === K.pause || k === K.playPause) {
      if (video.paused) { var p = video.play(); if (p && p['catch']) p['catch'](function () {}); } else video.pause();
      save();
      draw(video.paused);
      return true;
    }
    draw();
    return true;
  }

  return {open: open, close: close, key: key, playing: function () { return !!st; }};
})();
