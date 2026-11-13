/*
 * The player: live channels (▲ ▼ zap through the list they were picked from, OK shows what's on) and films and episodes
 * (◀ ▶ jump 10 s, held longer 60 s, OK pauses; where you stop is kept). HLS natively or through hls.js, MPEG-TS through
 * mpegts.js, files (mp4, mkv) natively; the libraries come from jsDelivr only when needed. ES5 only.
 * Sound and subtitles: when a film, an episode or a channel has more than one sound track, or subtitles, the bar says
 * which are on and ▼ (on a channel ▶, as ▲ ▼ zap) opens a list to choose: through hls.js for HLS, else the video's own audioTracks and
 * textTracks (Tizen 5.5 and later switch the sound of a file). The choice is kept by language for the next film.
 * Film files (mkv, mp4…) play through Samsung's own player, AVPlay, when the TV has it (webapis.avplay, loaded by the
 * IPTV package's page): it switches a file's sound and shows its own subtitles (drawn here, from onsubtitlechange).
 * The tracks chosen on the film's page before playing (opts.pick: by their place in the file) are put on at the start.
 */
var Player = (function () {
  'use strict';
  var HLSJS = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.20/dist/hls.min.js';
  var MPEGTS = 'https://cdn.jsdelivr.net/npm/mpegts.js@1.8.0/dist/mpegts.min.js';
  var TRY = 15000;
  var box, video, bar, mstat, st = null, hls = null, ts = null, seq = 0, tryTimer = 0, barTimer = 0, saveTimer = 0, tick = 0;
  var mini = null;   // the preview in the TV guide: {item}
  var menu = null;   // the list of sound and subtitles: {rows, at, box}
  var av = null;     // AVPlay playing: {at, dur, paused, sub, subs, audio}
  var avobj, subBox, subTimer = 0;

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
    mstat = el('div', 'mstat', box);
    subBox = el('div', 'avsub', box);
    // A film's own tracks show up while it loads: then the kept choice is applied.
    function found() { if (st) { prefer(); draw(!!st.status); } }
    if (video.audioTracks && video.audioTracks.addEventListener) video.audioTracks.addEventListener('addtrack', found);
    if (video.textTracks && video.textTracks.addEventListener) video.textTracks.addEventListener('addtrack', found);
    video.addEventListener('loadedmetadata', found);
    // The app sent to the background: no preview playing behind it.
    document.addEventListener('visibilitychange', function () { if (document.hidden && mini) preview(null); });
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

  // MARK: - AVPlay (Samsung's own player) for film files

  function A() { return window.webapis && window.webapis.avplay; }
  /** webapis.js: the IPTV package's page loads it; an older package's page doesn't, so try it from here once. */
  var avTried = false;
  function avReady(done) {
    var first = !avTried;
    avTried = true;
    if (A() || !first || !window.tizen) { done(!!A()); return; }
    var s = document.createElement('script'), base = location.href.replace(/[^\/]*([?#].*)?$/, '');
    s.src = base + '$WEBAPIS/webapis/webapis.js';
    s.onload = s.onerror = function () { done(!!A()); };
    document.head.appendChild(s);
  }
  function avStart(w, from, mine, next) {
    var P = A();
    if (!avobj) {
      avobj = document.createElement('object');
      avobj.setAttribute('type', 'application/avplayer');
      avobj.className = 'avobj';
      box.insertBefore(avobj, box.firstChild);
    }
    document.documentElement.className += ' avplay';
    box.className += ' av';
    av = {at: (from || 0) * 1000, dur: 0, paused: false, sub: -1, mine: mine};
    try {
      try { P.close(); } catch (e) {}
      P.open(w.url);
      P.setDisplayRect(0, 0, 1920, 1080);
      try { P.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX'); } catch (e) {}
      P.setListener({
        onbufferingstart: function () { if (av && av.mine === seq) status('Laddar…', true); },
        onbufferingcomplete: function () { if (av && av.mine === seq) status(''); },
        oncurrentplaytime: function (ms) { if (av && av.mine === seq) av.at = ms; },
        onstreamcompleted: function () { if (av && av.mine === seq) { save(); close(); } },
        onerror: function () { if (av && av.mine === seq) { avStop(); next(); } },
        onsubtitlechange: function (dur, text) { if (av && av.mine === seq) showSub(text, dur); },
        onevent: function () {}
      });
      P.prepareAsync(function () {
        if (!av || av.mine !== seq) return;
        clearTimeout(tryTimer);
        try { av.dur = P.getDuration(); } catch (e) {}
        P.play();
        if (from) try { P.seekTo(Math.floor(from * 1000), function () {}, function () {}); } catch (e) {}
        // The sound and subtitles chosen: once it plays (AVPlay switches tracks only while playing).
        setTimeout(function () { if (av && av.mine === seq) { prefer(); draw(!!st && !!st.status); } }, 600);
        status('');
      }, function () { if (av && av.mine === seq) { avStop(); next(); } });
    } catch (e) { avStop(); next(); }
  }
  function avStop() {
    if (!av) return;
    av = null;
    var P = A();
    try { P.stop(); } catch (e) {}
    try { P.close(); } catch (e) {}
    document.documentElement.className = document.documentElement.className.replace(/\s*avplay/g, '');
    box.className = box.className.replace(/\s*\bav\b/g, '');
    showSub('', 0);
  }
  function showSub(text, dur) {
    clearTimeout(subTimer);
    subBox.innerHTML = '';
    if (!text || !av || av.sub < 0) return;
    // Text subtitles may carry <i>, <b> and line breaks: kept as text, lines as lines.
    String(text).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').split(/\n|\\N/).forEach(function (l) { if (l.trim()) el('div', 'l', subBox, l); });
    if (dur > 0) subTimer = setTimeout(function () { subBox.innerHTML = ''; }, dur);
  }

  // Where it is, how long, paused: from AVPlay or the video.
  function tNow() { return av ? av.at / 1000 : video.currentTime; }
  function tDur() { return av ? av.dur / 1000 : video.duration; }
  function isPaused() { return av ? av.paused : video.paused; }
  function seekBy(d) {
    if (av) {
      var to = Math.max(0, Math.min((av.dur || 1e12) - 2000, av.at + d * 1000));
      av.at = to;
      try { A().seekTo(Math.floor(to), function () {}, function () {}); } catch (e) {}
      return;
    }
    try { video.currentTime = Math.max(0, Math.min((video.duration || 1e9) - 2, video.currentTime + d)); } catch (e) {}
  }
  function toggle() {
    if (av) { try { if (av.paused) A().play(); else A().pause(); av.paused = !av.paused; } catch (e) {} return; }
    if (video.paused) { var p = video.play(); if (p && p['catch']) p['catch'](function () {}); } else video.pause();
  }

  function stopStream() {
    avStop();
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
        // A file through AVPlay first (not for the small preview): it can switch sound and show the file's subtitles.
        if (A() && !mini && !/\.(m3u8|ts)(\?|$)/i.test(urls[i])) out.push({how: 'avplay', url: urls[i]});
        if (/\.ts(\?|$)/i.test(urls[i])) out.push({how: 'mpegts', url: urls[i], live: false});
        out.push({how: 'native', url: urls[i]});
        if (/\.m3u8(\?|$)/i.test(urls[i])) out.push({how: 'hls', url: urls[i]});
      }
      return out;
    }
    // A channel with more than one sound (or subtitles, or a choice made before playing): AVPlay on its .ts first,
    // which can switch them (mpegts.js can't, and the TV's own HTML5 player doesn't say what it has).
    if (A() && !mini && item.ts && multi(item)) out.push({how: 'avplay', url: item.ts, live: true});
    if (item.hls) { out.push({how: 'native', url: item.hls}); out.push({how: 'hls', url: item.hls}); }
    if (item.ts) { out.push({how: 'mpegts', url: item.ts, live: true}); out.push({how: 'native', url: item.ts}); }
    return out;
  }

  /** A channel known to have more than one sound or any subtitles (Ts, read on its side), or one chosen for. */
  function multi(item) {
    var t = window.Ts && Ts.known(item);
    return !!((st && st.pick && st.list[st.at] === item) || (t && (t.audio.length > 1 || t.subs.length)));
  }
  function start(item, from) {
    if (((item.kind && item.kind !== 'live') || multi(item)) && !mini && !A() && !avTried) { var m0 = ++seq; avReady(function () { if (m0 === seq) start(item, from); }); return; }
    var mine = ++seq, list = ways(item), n = 0;
    preferred = {};
    closeMenu();
    function next() {
      if (mine !== seq) return;
      if (n >= list.length) { stopStream(); status('Det gick inte att spela. ' + (st && st.kind === 'live' ? 'Prova en annan kanal med ▲ ▼.' : ''), true); return; }
      var w = list[n++];
      stopStream();
      tryTimer = setTimeout(next, TRY);
      video.onplaying = function () { if (mine !== seq) return; clearTimeout(tryTimer); status(''); };
      if (w.how === 'avplay') { avStart(w, from, mine, next); return; }
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
          hls.on(window.Hls.Events.AUDIO_TRACKS_UPDATED, function () { if (mine === seq && st) { prefer(); draw(!!st.status); } });
          hls.on(window.Hls.Events.SUBTITLE_TRACKS_UPDATED, function () { if (mine === seq && st) { prefer(); draw(!!st.status); } });
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
    // A film, an episode or a channel as HLS with its own sound or subtitle tracks: through hls.js first, which can
    // switch them (the TV's own player doesn't say what it has). Not for the small preview.
    var m3u8 = null;
    for (var i = 0; i < list.length; i++) if (list[i].how === 'hls') { m3u8 = list[i]; break; }
    if (!m3u8 || mini) { next(); return; }
    probe(m3u8.url, !item.kind || item.kind === 'live', function (multi) {
      if (mine !== seq) return;
      if (multi) { list.splice(list.indexOf(m3u8), 1); list.unshift(m3u8); }
      next();
    });
  }

  /** Whether an HLS playlist has more sound or subtitle tracks (#EXT-X-MEDIA); false when it can't be read in time
   *  (4 s for a film, 1.5 s for a channel, whose answer is kept so zapping back is quick). */
  var probed = {};
  function probe(url, live, done) {
    if (probed.hasOwnProperty(url)) { done(probed[url]); return; }
    var x = new XMLHttpRequest(), over = false;
    function end(v) { if (!over) { over = true; if (live) probed[url] = v; done(v); } }
    try { x.open('GET', url, true); } catch (e) { end(false); return; }
    x.timeout = live ? 1500 : 4000;
    x.onload = function () { end(x.status === 200 && /#EXT-X-MEDIA:[^\n]*TYPE=(AUDIO|SUBTITLES)/.test(x.responseText || '')); };
    x.onerror = x.ontimeout = function () { end(false); };
    x.send();
  }

  // MARK: - Sound and subtitles

  var NAMES = {spa: 'Spanska', es: 'Spanska', esp: 'Spanska', cas: 'Spanska', lat: 'Spanska (Latinamerika)', 'es-419': 'Spanska (Latinamerika)',
    eng: 'Engelska', en: 'Engelska', swe: 'Svenska', sv: 'Svenska', sve: 'Svenska', cat: 'Katalanska', ca: 'Katalanska',
    nor: 'Norska', no: 'Norska', nob: 'Norska', nb: 'Norska', dan: 'Danska', da: 'Danska', fin: 'Finska', fi: 'Finska',
    fre: 'Franska', fra: 'Franska', fr: 'Franska', ger: 'Tyska', deu: 'Tyska', de: 'Tyska', ita: 'Italienska', it: 'Italienska',
    por: 'Portugisiska', pt: 'Portugisiska', 'pt-br': 'Portugisiska (Brasilien)', pol: 'Polska', pl: 'Polska',
    dut: 'Nederländska', nld: 'Nederländska', nl: 'Nederländska', tur: 'Turkiska', tr: 'Turkiska', ara: 'Arabiska', ar: 'Arabiska',
    rus: 'Ryska', ru: 'Ryska', jpn: 'Japanska', ja: 'Japanska', kor: 'Koreanska', ko: 'Koreanska', chi: 'Kinesiska', zho: 'Kinesiska',
    zh: 'Kinesiska', hin: 'Hindi', hi: 'Hindi', gre: 'Grekiska', ell: 'Grekiska', el: 'Grekiska', heb: 'Hebreiska', he: 'Hebreiska',
    und: '', unk: ''};
  /** The same language whatever the file calls it: 'spa', 'es', 'es-ES' → 'es'. */
  function base(code) {
    code = String(code || '').toLowerCase();
    var n = NAMES[code] !== undefined ? NAMES[code] : NAMES[code.split(/[-_]/)[0]];
    for (var k in NAMES) if (NAMES.hasOwnProperty(k) && NAMES[k] && NAMES[k] === n && k.length === 2) return k;
    return code.split(/[-_]/)[0];
  }
  function nameOf(t, i) {
    var code = String(t.lang || t.language || '').toLowerCase(), n = NAMES[code] !== undefined ? NAMES[code] : NAMES[code.split(/[-_]/)[0]];
    var label = String(t.name || t.label || '').trim();
    if (/latin|latam|mexic/i.test(label) && (!n || /^Spanska/.test(n))) return 'Spanska (Latinamerika)';
    // A label that is only the language in its own words adds nothing ("Español", "English", "Svenska").
    if (/^(espa[ñn]ol|castellano|english|svenska|fran[cç]ais|deutsch|italiano|portugu[eê]s|catal[aà]|norsk|dansk|suomi|nederlands|polski)$/i.test(label)) label = '';
    if (n && label && label.toLowerCase() !== code && label.toLowerCase().indexOf(n.toLowerCase()) < 0 && !/^(track|audio|subtitle|text|sub|spår)?[\s_-]*\d*$/i.test(label)) return n + ' · ' + label;
    return n || label || code.toUpperCase() || ('Spår ' + (i + 1));
  }

  /** The film's sound and subtitles now: {audio: [{name, lang, on, pick()}], subs: [...]} (subs start with "Av"). */
  function tracks() {
    var audio = [], subs = [], i;
    if (av) {
      var P = A(), all = [], cur = {};
      try { all = P.getTotalTrackInfo() || []; } catch (e) {}
      try { var ci = P.getCurrentStreamInfo() || []; for (i = 0; i < ci.length; i++) cur[ci[i].type] = Number(ci[i].index); } catch (e) {}
      for (i = 0; i < all.length; i++) {
        var x = all[i], info = {};
        try { info = JSON.parse(x.extra_info || '{}'); } catch (e) {}
        var t = {lang: info.language || info.track_lang || info.lang || '', name: info.title || info.name || ''}, idx = Number(x.index);
        if (x.type === 'AUDIO') audio.push({name: nameOf(t, audio.length), lang: t.lang, on: cur.AUDIO === idx, pick: (function (n) { return function () { P.setSelectTrack('AUDIO', n); }; })(idx)});
        else if (x.type === 'TEXT' || x.type === 'SUBTITLE') subs.push({name: nameOf(t, subs.length), lang: t.lang, on: av.sub === idx, pick: (function (n) {
          return function () { P.setSelectTrack('TEXT', n); P.setSilentSubtitle(false); av.sub = n; };
        })(idx)});
      }
      if (audio.length && !current(audio)) audio[0].on = true;
      if (subs.length) subs.unshift({name: 'Av', lang: 'off', on: av.sub < 0, pick: function () { try { P.setSilentSubtitle(true); } catch (e) {} av.sub = -1; showSub('', 0); }});
      return {audio: audio, subs: subs};
    }
    if (hls) {
      var at = hls.audioTrack, a = hls.audioTracks || [];
      for (i = 0; i < a.length; i++) audio.push({name: nameOf(a[i], i), lang: a[i].lang, on: i === at, pick: (function (n) { return function () { hls.audioTrack = n; }; })(i)});
      var stt = hls.subtitleTrack, sl = hls.subtitleTracks || [];
      for (i = 0; i < sl.length; i++) subs.push({name: nameOf(sl[i], i), lang: sl[i].lang, on: i === stt, pick: (function (n) { return function () { hls.subtitleDisplay = true; hls.subtitleTrack = n; }; })(i)});
      if (subs.length) subs.unshift({name: 'Av', lang: 'off', on: stt < 0, pick: function () { hls.subtitleTrack = -1; }});
      return {audio: audio, subs: subs};
    }
    var va = video.audioTracks;
    if (va) for (i = 0; i < va.length; i++) audio.push({name: nameOf(va[i], i), lang: va[i].language, on: !!va[i].enabled, pick: (function (n) {
      return function () { for (var j = 0; j < va.length; j++) va[j].enabled = j === n; };
    })(i)});
    var vt = video.textTracks, list = [];
    if (vt) for (i = 0; i < vt.length; i++) if (vt[i].kind === 'subtitles' || vt[i].kind === 'captions') list.push(vt[i]);
    for (i = 0; i < list.length; i++) subs.push({name: nameOf(list[i], i), lang: list[i].language, on: list[i].mode === 'showing', pick: (function (n) {
      return function () { for (var j = 0; j < list.length; j++) list[j].mode = j === n ? 'showing' : 'disabled'; };
    })(i)});
    if (subs.length) {
      var none = true;
      for (i = 0; i < subs.length; i++) if (subs[i].on) none = false;
      subs.unshift({name: 'Av', lang: 'off', on: none, pick: function () { for (var j = 0; j < list.length; j++) list[j].mode = 'disabled'; }});
    }
    return {audio: audio, subs: subs};
  }
  function choice() { var t = tracks(); return t.audio.length > 1 || t.subs.length > 0 ? t : null; }
  function current(l) { for (var i = 0; i < l.length; i++) if (l[i].on) return l[i]; return null; }

  // The kept choice, once per film and kind of track (so the film's own default isn't fought after Yuri picks).
  var preferred = {};
  function prefer() {
    var t = tracks(), want = Store.tracks(), pick = st && st.pick;
    // Chosen on the film's page: by its place among the file's tracks (subs: after "Av"), else by language.
    if (pick) {
      st.pick = null;
      if (pick.audio && t.audio.length > 1) {
        var a = t.audio[pick.audio.i];
        if (!a || (pick.audio.lang && base(a.lang) !== base(pick.audio.lang))) for (var j = 0; j < t.audio.length; j++) if (base(t.audio[j].lang) === base(pick.audio.lang)) { a = t.audio[j]; break; }
        if (a && !a.on) try { a.pick(); } catch (e) {}
        preferred.audio = true;
      }
      if (pick.sub && t.subs.length) {
        var sb = pick.sub === 'off' ? t.subs[0] : t.subs[pick.sub.i + 1];
        if (pick.sub !== 'off' && (!sb || (pick.sub.lang && base(sb.lang) !== base(pick.sub.lang)))) for (var k2 = 1; k2 < t.subs.length; k2++) if (base(t.subs[k2].lang) === base(pick.sub.lang)) { sb = t.subs[k2]; break; }
        if (sb && !sb.on) try { sb.pick(); } catch (e) {}
        preferred.sub = true;
      }
      t = tracks();
    }
    [['audio', t.audio], ['sub', t.subs]].forEach(function (k) {
      var l = k[1];
      if (preferred[k[0]] || !want[k[0]] || l.length < 2) return;
      preferred[k[0]] = true;
      for (var i = 0; i < l.length; i++) if (base(l[i].lang) === want[k[0]] || (want[k[0]] === 'off' && l[i].lang === 'off')) { if (!l[i].on) try { l[i].pick(); } catch (e) {} return; }
    });
  }

  function openMenu() {
    var t = choice();
    if (!t) return false;
    menu = {at: 0, box: el('div', 'tmenu glass', box)};
    drawMenu();
    for (var i = 0; i < menu.rows.length; i++) if (menu.rows[i].t && menu.rows[i].t.on) { menu.at = i; break; }
    drawMenu();
    bar.className = 'bar glass';
    return true;
  }
  function closeMenu() { if (menu) { if (menu.box.parentNode) menu.box.parentNode.removeChild(menu.box); menu = null; } }
  function drawMenu() {
    var t = tracks(), rows = [];
    if (t.audio.length > 1) { rows.push({h: 'Ljud'}); t.audio.forEach(function (a) { rows.push({t: a, kind: 'audio'}); }); }
    if (t.subs.length) { rows.push({h: 'Undertexter'}); t.subs.forEach(function (a) { rows.push({t: a, kind: 'sub'}); }); }
    menu.rows = rows;
    if (!rows[menu.at] || rows[menu.at].h) for (var i = 0; i < rows.length; i++) if (!rows[i].h) { if (i >= menu.at || !rows[menu.at]) { menu.at = i; break; } }
    menu.box.innerHTML = '';
    el('div', 'thead', menu.box, 'Ljud och undertexter');
    var list = el('div', 'tlist', menu.box);
    rows.forEach(function (r, i) {
      if (r.h) { el('div', 'tsec', list, r.h); return; }
      var row = el('div', 'trow' + (i === menu.at ? ' focus' : '') + (r.t.on ? ' on' : ''), list);
      el('span', 'tick', row, r.t.on ? '✓' : '');
      el('span', 'tname', row, r.t.name);
    });
    el('div', 'tkeys', menu.box, '▲ ▼ välj  ·  OK byter  ·  Tillbaka stänger');
    var f = list.querySelector('.focus');
    if (f && f.offsetTop + f.offsetHeight > list.clientHeight) list.scrollTop = f.offsetTop + f.offsetHeight - list.clientHeight + 20;
    else if (f && f.offsetTop < list.scrollTop) list.scrollTop = f.offsetTop - 60;
  }
  function menuKey(k, K) {
    var r = menu.rows, i;
    if (k === K.up) { for (i = menu.at - 1; i >= 0; i--) if (!r[i].h) { menu.at = i; break; } }
    else if (k === K.down) { for (i = menu.at + 1; i < r.length; i++) if (!r[i].h) { menu.at = i; break; } }
    else if (k === K.ok && r[menu.at] && r[menu.at].t) {
      var row = r[menu.at];
      try { row.t.pick(); } catch (e) {}
      var want = Store.tracks();
      want[row.kind] = row.t.lang === 'off' ? 'off' : base(row.t.lang);
      Store.tracks(want);
      preferred[row.kind] = true;
      // The video takes a moment to switch; draw again after it.
      setTimeout(function () { if (menu) drawMenu(); }, 400);
    } else if (k === K.back || k === K.left) { closeMenu(); draw(); return true; }
    drawMenu();
    return true;
  }

  // MARK: - The bar: the channel and what's on, or the film and where it is

  function status(text, keep) {
    if (!st) { if (mstat) mstat.textContent = mini ? (text === 'Startar…' ? 'Startar ' + mini.item.name + '…' : text) : ''; return; }
    st.status = text; draw(keep || !!text);
  }

  /** Where a box of the page is, in the app's 1920 × 1080 (offsets, so a scaled page doesn't matter). */
  function place(host) {
    var x = 0, y = 0, n = host;
    while (n && n !== document.body) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
    box.style.left = x + 'px'; box.style.top = y + 'px';
    box.style.width = host.offsetWidth + 'px'; box.style.height = host.offsetHeight + 'px';
  }

  /** The TV guide's preview: the channel playing small in the box host; preview(null) stops it. The full player
   *  (open) takes over from it. */
  function preview(item, host) {
    ensure();
    if (st) return;
    if (!item || !host) {
      if (mini) { mini = null; seq++; stopStream(); box.className = ''; box.removeAttribute('style'); mstat.textContent = ''; }
      return;
    }
    if (mini && mini.item === item) { place(host); return; }
    mini = {item: item};
    box.className = 'on mini';
    bar.className = 'bar glass';
    place(host);
    start(item, 0);
  }

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
      var d = tDur(), c = tNow();
      if (d && isFinite(d)) {
        var pr2 = el('div', 'progress big', bar), f2 = el('div', 'fill', pr2);
        f2.style.width = (c / d * 100) + '%';
        el('div', 'times', bar, clock(c) + '  /  ' + clock(d) + (isPaused() ? '   ❚❚' : ''));
      }
    }
    var tc = choice(), ca = tc && current(tc.audio), cs = tc && current(tc.subs);
    if (tc) el('div', 'tracks', bar, (tc.audio.length > 1 ? '🔊 ' + (ca ? ca.name : '–') + ' (' + tc.audio.length + ' ljudspår)' : '')
      + (tc.audio.length > 1 && tc.subs.length ? '     ' : '') + (tc.subs.length ? 'Undertext: ' + (cs ? cs.name : 'Av') + ' (' + (tc.subs.length - 1) + ' st)' : ''));
    if (st.status) el('div', 'status', bar, st.status);
    var tk = tc ? (st.kind === 'live' ? '▶' : '▼') + ' ljud och undertext  ·  ' : '';
    el('div', 'keys', bar, st.kind === 'live' ? (st.list.length > 1 ? '▲ ▼ byter kanal  ·  ' : '') + tk + 'OK visar vad som går  ·  Tillbaka till listan'
      : '◀ ▶ spolar  ·  ' + tk + 'OK pausar  ·  Tillbaka till listan');
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
    var d = tDur(), c = tNow();
    if (c > 5) Store.watched(st.list[st.at], c, isFinite(d) ? d : 0);
  }

  // MARK: - Opening, closing, keys

  /** Plays list[at]: channels (kind 'live') or a film / an episode. onClose(item) when Back brings the list back. */
  function open(list, at, opts) {
    ensure();
    opts = opts || {};
    if (mini) { mini = null; box.removeAttribute('style'); mstat.textContent = ''; }
    st = {list: list, at: at || 0, kind: list[at || 0].kind && list[at || 0].kind !== 'live' ? 'vod' : 'live', title: opts.title || '', onClose: opts.onClose, status: '', pick: opts.pick || null};
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
    closeMenu();
    var it = st.list[st.at], cb = st.onClose;
    st = null;
    box.className = '';
    if (cb) cb(it);
  }

  var holdAt = 0, holdKey = 0;
  /** A key while playing: true when the player took it. */
  function key(k, K) {
    if (!st) return false;
    if (menu) return menuKey(k, K);
    if (k === K.back) { close(); return true; }
    if (st.kind === 'live' && k === K.right && openMenu()) return true;
    if (st.kind !== 'live' && (k === K.down || k === K.up) && openMenu()) return true;
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
      seekBy(d);
      draw();
      return true;
    }
    if (k === K.ok || k === K.play || k === K.pause || k === K.playPause) {
      toggle();
      save();
      draw(isPaused());
      return true;
    }
    draw();
    return true;
  }

  return {open: open, close: close, key: key, preview: preview, base: base, trackName: nameOf, playing: function () { return !!st; }};
})();
