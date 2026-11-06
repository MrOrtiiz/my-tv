/*
 * IPTV in Free My TV: your own IPTV list (an M3U link or an Xtream login, typed on the TV under Home Settings → IPTV-länk
 * and kept only on the TV, never in the repo) and a full-screen player. OK on the Barça box plays the match on the first
 * of its channels; ▲ ▼ go through the match's other channels, Back closes.
 *
 * The streams play in the page's own <video>: HLS natively, else hls.js, else MPEG-TS through mpegts.js (both from
 * jsDelivr, loaded only when needed). ES5 only.
 */
var IPTV = (function () {
  'use strict';
  var CACHE = 'fmtv.iptv.list', DAY = 24 * 3600000, TRY = 15000;
  var HLSJS = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.20/dist/hls.min.js';
  var MPEGTS = 'https://cdn.jsdelivr.net/npm/mpegts.js@1.8.0/dist/mpegts.min.js';
  var list = null, listFor = '', loading = null;

  function link() { return typeof Prefs !== 'undefined' && Prefs.iptv ? Prefs.iptv() : ''; }

  // MARK: - The channel list

  /** An Xtream login in the link (get.php, player_api.php or a /live/user/pass/ stream): {base, user, pass}; else null. */
  function xtream(url) {
    var m = /^(https?:\/\/[^\/?#]+)\/(?:get|player_api)\.php\?(.*)$/i.exec(url);
    if (m) {
      var q = {}, parts = m[2].split('&');
      for (var i = 0; i < parts.length; i++) {
        var kv = parts[i].split('=');
        q[decodeURIComponent(kv[0] || '').toLowerCase()] = decodeURIComponent((kv[1] || '').replace(/\+/g, ' '));
      }
      if (q.username && q.password) return {base: m[1], user: q.username, pass: q.password};
    }
    m = /^(https?:\/\/[^\/?#]+)\/live\/([^\/]+)\/([^\/]+)\//i.exec(url);
    return m ? {base: m[1], user: decodeURIComponent(m[2]), pass: decodeURIComponent(m[3])} : null;
  }

  function get(url, done) {
    var x = new XMLHttpRequest(), over = false;
    x.open('GET', url, true);
    x.timeout = 60000;
    x.onreadystatechange = function () {
      if (x.readyState !== 4 || over) return;
      over = true;
      if (x.status >= 200 && x.status < 300 && x.responseText) done(null, x.responseText);
      else done(new Error(x.status ? 'HTTP ' + x.status : 'ingen kontakt'));
    };
    x.ontimeout = function () { if (!over) { over = true; done(new Error('tog för lång tid')); } };
    x.send();
  }

  /** Xtream's own list of live channels: name, guide id and the stream's number. */
  function fromXtream(x, text) {
    var json = JSON.parse(text), out = [];
    if (!json || !json.length) throw new Error('inga kanaler');
    var root = x.base + '/live/' + encodeURIComponent(x.user) + '/' + encodeURIComponent(x.pass) + '/';
    for (var i = 0; i < json.length; i++) {
      var c = json[i];
      if (!c || c.stream_id === undefined) continue;
      out.push({n: String(c.name || ''), e: String(c.epg_channel_id || ''), u: root + c.stream_id + '.m3u8', t: root + c.stream_id + '.ts'});
    }
    return out;
  }

  /** An M3U list: each #EXTINF's name and tvg-id, and the address on the line after it (films and series left out). */
  function fromM3U(text) {
    if (text.indexOf('#EXTM3U') < 0 && text.indexOf('#EXTINF') < 0) throw new Error('inte en M3U-lista');
    var lines = text.split(/\r?\n/), out = [], info = null;
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      if (l.indexOf('#EXTINF') === 0) {
        var id = /tvg-id="([^"]*)"/i.exec(l), name = l.substring(l.lastIndexOf(',') + 1);
        info = {n: name.replace(/^\s+|\s+$/g, ''), e: id ? id[1] : ''};
      } else if (info && /^https?:\/\//i.test(l)) {
        var u = l.replace(/\s+$/, '');
        if (!/\/(movie|series)\//i.test(u)) {
          info.u = u;
          // An Xtream server's stream (host/user/pass/123, or under /live/, as .ts or without an ending) is there as HLS
          // too: try that first, the MPEG-TS after it.
          var xs = /^(https?:\/\/[^\/]+)\/(?:live\/)?([^\/]+)\/([^\/]+)\/(\d+)(\.ts|\.m3u8)?$/i.exec(u);
          if (xs) {
            var root = xs[1] + '/live/' + xs[2] + '/' + xs[3] + '/' + xs[4];
            info.u = root + '.m3u8';
            info.t = root + '.ts';
          }
          out.push(info);
        }
        info = null;
      }
    }
    if (!out.length) throw new Error('inga kanaler');
    return out;
  }

  /** The channels behind a link: from the TV's copy (a day old at most), else fetched again. done(error, channels). */
  function load(url, done, fresh) {
    if (!url) { done(new Error('ingen IPTV-länk')); return; }
    if (!fresh && list && listFor === url) { done(null, list); return; }
    if (!fresh) {
      try {
        var saved = JSON.parse(localStorage.getItem(CACHE));
        if (saved && saved.link === url && Date.now() - saved.at < DAY && saved.list && saved.list.length) {
          list = saved.list; listFor = url; done(null, list); return;
        }
      } catch (e) {}
    }
    if (loading && loading.url === url) { loading.waiting.push(done); return; }
    loading = {url: url, waiting: [done]};
    var x = xtream(url);
    var src = x ? x.base + '/player_api.php?username=' + encodeURIComponent(x.user) + '&password=' + encodeURIComponent(x.pass) + '&action=get_live_streams' : url;
    get(src, function (err, text) {
      var got = null;
      if (!err) {
        try { got = x ? fromXtream(x, text) : fromM3U(text); } catch (e) { err = e; }
      }
      // Some servers answer the Xtream API badly but give the M3U list: try that too.
      if (err && x && !/\/player_api\.php/i.test(url)) {
        get(url, function (err2, text2) {
          try { if (!err2) { got = fromM3U(text2); err = null; } } catch (e) {}
          finish(err, got);
        });
        return;
      }
      finish(err, got);
    });
    function finish(err, got) {
      var waiting = loading.waiting;
      loading = null;
      if (!err) {
        list = got; listFor = url;
        try { localStorage.setItem(CACHE, JSON.stringify({link: url, at: Date.now(), list: got})); } catch (e) {}
      }
      for (var i = 0; i < waiting.length; i++) waiting[i](err, got);
    }
  }

  /** A channel's name without what differs between a guide and a list: case, accents, HD/FHD, country tags, signs. */
  function norm(s) {
    s = String(s || '').toLowerCase();
    if (s.normalize) s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
    s = s.replace(/^[a-z]{2,3}\s*[:|\-]\s*|^\|[a-z]{2,3}\|\s*/, '');
    s = s.replace(/\b(fhd|uhd|hd|sd|4k|hevc|h265|backup|raw|\d+fps)\b/g, '');
    return s.replace(/[^a-z0-9]+/g, '');
  }

  /** The list's channel for a guide's channel: by its guide id, else by its name. */
  function find(name, epg) {
    if (!list) return null;
    var i, n = norm(name), best = null;
    if (epg) for (i = 0; i < list.length; i++) if (list[i].e && list[i].e === epg) return list[i];
    for (i = 0; i < list.length; i++) if (norm(list[i].n) === n) return list[i];
    if (n.length < 4) return null;
    for (i = 0; i < list.length; i++) {
      var m = norm(list[i].n);
      if (m.length >= 4 && (m.indexOf(n) >= 0 || n.indexOf(m) >= 0) && (!best || Math.abs(m.length - n.length) < Math.abs(norm(best.n).length - n.length))) best = list[i];
    }
    return best;
  }

  // MARK: - The player

  var box = null, video = null, info = null, state = null, hls = null, ts = null, infoTimer = 0, tryTimer = 0, seq = 0;

  function el(tag, cls, parent, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    if (parent) parent.appendChild(n);
    return n;
  }

  function script(src, done) {
    var s = document.createElement('script');
    s.src = src;
    s.onload = function () { done(true); };
    s.onerror = function () { done(false); };
    document.body.appendChild(s);
  }

  function ensure() {
    if (box) return;
    box = el('div', '', document.body);
    box.id = 'iptv';
    video = el('video', '', box);
    video.setAttribute('autoplay', '');
    video.setAttribute('playsinline', '');
    info = el('div', 'info', box);
  }

  function showInfo(status, keep) {
    if (!state) return;
    var c = state.items[state.at];
    info.innerHTML = '';
    var top = el('div', 'line', info);
    el('span', 'chan', top, c.label);
    if (state.items.length > 1) el('span', 'count', top, (state.at + 1) + ' / ' + state.items.length);
    if (state.title) el('div', 'title', info, state.title);
    el('div', 'status', info, status || '');
    el('div', 'keys', info, (state.items.length > 1 ? '▲ ▼ byter kanal  ·  ' : '') + 'OK visar info  ·  Tillbaka stänger');
    info.className = 'info on';
    clearTimeout(infoTimer);
    if (!keep) infoTimer = setTimeout(function () { info.className = 'info'; }, 5000);
  }

  function stopStream() {
    clearTimeout(tryTimer);
    if (hls) { try { hls.destroy(); } catch (e) {} hls = null; }
    if (ts) { try { ts.unload(); ts.detachMediaElement(); ts.destroy(); } catch (e) {} ts = null; }
    video.onplaying = video.onerror = null;
    try { video.pause(); } catch (e) {}
    video.removeAttribute('src');
    try { video.load(); } catch (e) {}
  }

  /** The ways to play a channel, tried in turn until one plays. */
  function ways(ch) {
    var out = [], hlsUrl = /\.m3u8(\?|$)/i.test(ch.u) ? ch.u : '', tsUrl = ch.t || (hlsUrl ? '' : ch.u);
    if (hlsUrl) { out.push({how: 'native', url: hlsUrl}); out.push({how: 'hls', url: hlsUrl}); }
    if (tsUrl) { out.push({how: 'mpegts', url: tsUrl}); out.push({how: 'native', url: tsUrl}); }
    return out;
  }

  function play() {
    var mine = ++seq, c = state.items[state.at];
    stopStream();
    if (!c.ch) { showInfo('Kanalen finns inte i din IPTV-lista.', true); return; }
    var list = ways(c.ch), n = 0;
    showInfo('Startar…', true);
    function next() {
      if (mine !== seq) return;
      if (n >= list.length) { stopStream(); showInfo('Kanalen gick inte att spela. Prova en annan med ▲ ▼.', true); return; }
      var w = list[n++];
      stopStream();
      tryTimer = setTimeout(next, TRY);
      video.onplaying = function () { if (mine !== seq) return; clearTimeout(tryTimer); showInfo(''); };
      if (w.how === 'native') {
        video.onerror = function () { if (mine === seq) next(); };
        video.src = w.url;
        var p = video.play();
        if (p && p['catch']) p['catch'](function () {});
      } else if (w.how === 'hls') {
        withLib('Hls', HLSJS, function (ok) {
          if (mine !== seq) return;
          if (!ok || !window.Hls.isSupported()) { next(); return; }
          hls = new window.Hls({lowLatencyMode: false, maxBufferLength: 20});
          hls.on(window.Hls.Events.ERROR, function (e, d) { if (d && d.fatal && mine === seq) next(); });
          hls.loadSource(w.url);
          hls.attachMedia(video);
          hls.on(window.Hls.Events.MANIFEST_PARSED, function () { var p2 = video.play(); if (p2 && p2['catch']) p2['catch'](function () {}); });
        });
      } else {
        withLib('mpegts', MPEGTS, function (ok) {
          if (mine !== seq) return;
          if (!ok || !window.mpegts.isSupported()) { next(); return; }
          ts = window.mpegts.createPlayer({type: 'mpegts', isLive: true, url: w.url}, {enableWorker: false, liveBufferLatencyChasing: true});
          ts.on(window.mpegts.Events.ERROR, function () { if (mine === seq) next(); });
          ts.attachMediaElement(video);
          ts.load();
          var p3 = ts.play();
          if (p3 && p3['catch']) p3['catch'](function () {});
        });
      }
    }
    next();
  }

  var libs = {};
  function withLib(name, src, done) {
    if (window[name]) { done(true); return; }
    if (libs[name]) { libs[name].push(done); return; }
    libs[name] = [done];
    script(src, function (ok) { var w = libs[name]; libs[name] = null; for (var i = 0; i < w.length; i++) w[i](ok && !!window[name]); });
  }

  /** Plays a list of {label, ch} from item `at`, under a title (the match). */
  function open(items, at, title) {
    ensure();
    state = {items: items, at: at || 0, title: title || ''};
    box.className = 'on';
    document.body.className += ' iptv-on';
    play();
  }

  function close() {
    if (!state) return;
    seq++;
    stopStream();
    state = null;
    box.className = '';
    document.body.className = document.body.className.replace(/\s*\biptv-on\b/g, '');
  }

  // Keys while the player is open: they never reach the home screen behind it.
  var K = {up: 38, down: 40, left: 37, right: 39, ok: 13, back: 10009, chUp: 427, chDown: 428};
  window.addEventListener('keydown', function (e) {
    if (!state) return;
    var k = e.keyCode, back = (typeof TV !== 'undefined' && TV.keys) ? TV.keys.back : K.back;
    e.preventDefault();
    e.stopPropagation();
    if (k === back || k === 8 || k === 27) { close(); return; }
    if (k === K.up || k === K.chUp || k === K.right || k === K.down || k === K.chDown || k === K.left) {
      if (state.items.length < 2) { showInfo(''); return; }
      var d = (k === K.up || k === K.chUp || k === K.right) ? -1 : 1;
      state.at = (state.at + d + state.items.length) % state.items.length;
      play();
      return;
    }
    showInfo(info && info.querySelector('.status') ? info.querySelector('.status').textContent : '');
  }, true);

  // The TV's channel keys reach the app only when asked for.
  try { if (window.tizen && tizen.tvinputdevice) { tizen.tvinputdevice.registerKey('ChannelUp'); tizen.tvinputdevice.registerKey('ChannelDown'); } } catch (e) {}

  // MARK: - The Barça box

  /** The match to play: the one on now, else the next one with channels. */
  function barcaMatch(data) {
    var now = Date.now(), ms = (data && data.matches) || [], i;
    for (i = 0; i < ms.length; i++) if (ms[i].start - 30 * 60000 <= now && now < ms[i].stop + 30 * 60000 && ms[i].channels && ms[i].channels.length) return ms[i];
    for (i = 0; i < ms.length; i++) if (ms[i].stop > now && ms[i].channels && ms[i].channels.length) return ms[i];
    return null;
  }

  /** OK on the Barça box. say(text) shows a message on the home screen when there is nothing to play. */
  function barca(data, say) {
    if (!link()) { say('Lägg in din IPTV-länk under Hemskärm → IPTV-länk.'); return; }
    var m = barcaMatch(data);
    if (!m) { say('Inga kanaler än: de dyker upp när matchen kommer in i din tablå, dagen före.'); return; }
    say('Hämtar dina kanaler…');
    load(link(), function (err) {
      if (err) { say('Kunde inte läsa din IPTV-lista (' + err.message + ').'); return; }
      var items = [], ids = m.channel_ids || [];
      for (var i = 0; i < m.channels.length; i++) {
        var ch = find(m.channels[i], ids[i]);
        if (ch) items.push({label: m.channels[i], ch: ch});
      }
      if (!items.length) { say('Matchens kanaler finns inte i din IPTV-lista.'); return; }
      var soon = m.start > Date.now() ? ' (avspark ' + new Date(m.start).toTimeString().slice(0, 5) + ')' : '';
      open(items, 0, m.title + soon);
    });
  }

  return {
    configured: function () { return !!link(); },
    playing: function () { return !!state; },
    /** Checks a link before it's saved: done(error, number of channels). */
    check: function (url, done) { load(url, function (err, got) { done(err, got ? got.length : 0); }, true); },
    forget: function () { list = null; listFor = ''; try { localStorage.removeItem(CACHE); } catch (e) {} },
    barca: barca,
    open: open,
    close: close
  };
})();
