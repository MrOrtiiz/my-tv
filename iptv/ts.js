/*
 * What's in a channel before it plays: its sound and subtitle tracks.
 * - MPEG-TS (the channel's .ts address): the first ~400 KB of the stream are read and its programme table (PAT → PMT)
 *   gives every sound and subtitle stream with its language (ISO 639 / DVB subtitle / teletext descriptors).
 * - HLS (.m3u8): the playlist's #EXT-X-MEDIA lines (TYPE=AUDIO / SUBTITLES).
 * Ts.tracks(ch, done) → done({audio: [{lang, name, codec}], subs: [...], from: 'ts' | 'hls'}) or done(null). Kept per
 * address for 30 minutes. Ts.abort() stops a reading (before the channel plays: the server may allow one connection).
 * Ts.known(ch) → the kept answer, or undefined. ES5 only.
 */
var Ts = (function () {
  'use strict';
  var MAX = 400000, WAIT = 6000, KEEP = 30 * 60000;
  var cache = {}, xhr = null;

  function abort() { if (xhr) { var x = xhr; xhr = null; try { x.abort(); } catch (e) {} } }

  /** The stream's first bytes, as they come (binary through text: x-user-defined keeps each byte). */
  function bytes(url, enough, done) {
    abort();
    var x = new XMLHttpRequest(), over = false, timer = 0, checked = 0;
    xhr = x;
    function end(v) { if (over) return; over = true; clearTimeout(timer); if (xhr === x) xhr = null; try { x.abort(); } catch (e) {} done(v); }
    function data() {
      var t = x.responseText || '', b = new Uint8Array(t.length);
      for (var i = 0; i < t.length; i++) b[i] = t.charCodeAt(i) & 0xff;
      return b;
    }
    try {
      x.open('GET', url, true);
      x.overrideMimeType('text/plain; charset=x-user-defined');
    } catch (e) { end(null); return; }
    x.onprogress = function () {
      var n = (x.responseText || '').length;
      if (n >= MAX) { end(data()); return; }
      // Every 40 KB: is the programme table all there yet?
      if (n - checked > 40000) { checked = n; var d = data(); if (enough(d)) end(d); }
    };
    x.onload = function () { end(x.status === 200 || x.status === 206 ? data() : null); };
    x.onerror = function () { end(null); };
    timer = setTimeout(function () { end(data()); }, WAIT);
    x.send();
  }

  // MARK: - MPEG-TS: PAT (PID 0) → PMT → elementary streams

  /** The payload of each packet of a PID, a section's start marked. */
  function sections(b, pid) {
    var out = [], cur = null, start = 0;
    while (start < 188 && start < b.length && !(b[start] === 0x47 && b[start + 188] === 0x47)) start++;
    for (var p = start; p + 188 <= b.length; p += 188) {
      if (b[p] !== 0x47) continue;
      var id = ((b[p + 1] & 0x1f) << 8) | b[p + 2];
      if (id !== pid) continue;
      var pusi = b[p + 1] & 0x40, afc = (b[p + 3] >> 4) & 3, q = p + 4;
      if (afc === 2) continue;
      if (afc === 3) q += 1 + b[q];
      if (pusi) {
        q += 1 + b[q];                   // pointer field
        cur = [];
        out.push(cur);
      }
      if (!cur) continue;
      for (; q < p + 188; q++) cur.push(b[q]);
    }
    return out;
  }
  function pmtPid(b) {
    var s = sections(b, 0);
    for (var i = 0; i < s.length; i++) {
      var t = s[i];
      if (t[0] !== 0) continue;
      var len = ((t[1] & 0x0f) << 8) | t[2], end = Math.min(3 + len - 4, t.length);
      for (var p = 8; p + 4 <= end; p += 4) {
        var prog = (t[p] << 8) | t[p + 1];
        if (prog !== 0) return ((t[p + 2] & 0x1f) << 8) | t[p + 3];
      }
    }
    return -1;
  }
  function lang3(t, p) { return String.fromCharCode(t[p], t[p + 1], t[p + 2]).toLowerCase().replace(/[^a-z]/g, ''); }
  function pmt(b, pid) {
    var s = sections(b, pid);
    for (var i = 0; i < s.length; i++) {
      var t = s[i];
      if (t[0] !== 2) continue;
      var len = ((t[1] & 0x0f) << 8) | t[2];
      if (t.length < 3 + len) continue;               // not all of it read
      var end = 3 + len - 4, pil = ((t[10] & 0x0f) << 8) | t[11], p = 12 + pil, out = {audio: [], subs: [], from: 'ts'};
      while (p + 5 <= end) {
        var type = t[p], eil = ((t[p + 3] & 0x0f) << 8) | t[p + 4], q = p + 5, qe = q + eil;
        var lang = '', codec = '', sub = null, audio = /^(3|4|15|17|129|135)$/.test(String(type));
        codec = {3: 'MPEG', 4: 'MPEG', 15: 'AAC', 17: 'AAC', 129: 'AC-3', 135: 'E-AC-3'}[type] || '';
        while (q + 2 <= qe) {
          var tag = t[q], dl = t[q + 1], d = q + 2;
          if (tag === 0x0A && dl >= 3) lang = lang3(t, d);                                   // ISO 639 language
          else if (tag === 0x6A) { audio = true; codec = 'AC-3'; }
          else if (tag === 0x7A) { audio = true; codec = 'E-AC-3'; }
          else if (tag === 0x7C) { audio = true; codec = 'AAC'; }
          else if (tag === 0x59 && dl >= 8) { sub = {lang: lang3(t, d), name: '', codec: 'DVB'}; }  // DVB subtitles
          else if (tag === 0x56 && dl >= 5) {                                                 // teletext: its subtitle pages
            for (var k = d; k + 5 <= d + dl; k += 5) { var tt = t[k + 3] >> 3; if (tt === 2 || tt === 5) { sub = {lang: lang3(t, k), name: 'Text-TV', codec: 'teletext'}; break; } }
          }
          q += 2 + dl;
        }
        if (sub) out.subs.push(sub);
        else if (audio) out.audio.push({lang: lang === 'und' ? '' : lang, name: '', codec: codec});
        p = qe;
      }
      return out;
    }
    return null;
  }

  // MARK: - HLS: the playlist's other renditions

  function attr(line, k) { var m = new RegExp(k + '="?([^",]*)"?').exec(line); return m ? m[1] : ''; }
  function hlsTracks(url, done) {
    abort();
    var x = new XMLHttpRequest(), over = false;
    xhr = x;
    function end(v) { if (!over) { over = true; if (xhr === x) xhr = null; done(v); } }
    try { x.open('GET', url, true); } catch (e) { end(null); return; }
    x.timeout = 4000;
    x.onload = function () {
      var out = {audio: [], subs: [], from: 'hls'}, lines = (x.responseText || '').split(/\r?\n/);
      for (var i = 0; i < lines.length; i++) if (/^#EXT-X-MEDIA:/.test(lines[i])) {
        var t = {lang: attr(lines[i], 'LANGUAGE').toLowerCase(), name: attr(lines[i], 'NAME'), codec: ''};
        if (/TYPE=AUDIO/.test(lines[i])) out.audio.push(t); else if (/TYPE=SUBTITLES/.test(lines[i])) out.subs.push(t);
      }
      end(x.status === 200 ? out : null);
    };
    x.onerror = x.ontimeout = function () { end(null); };
    x.send();
  }

  function key(ch) { return ch.ts || ch.hls || ''; }
  function known(ch) { var c = cache[key(ch)]; return c && Date.now() - c.at < KEEP ? c.v : undefined; }

  function tracks(ch, done) {
    var k = key(ch), have = known(ch);
    if (!k) { done(null); return; }
    if (have !== undefined) { done(have); return; }
    function fin(v) { cache[k] = {v: v, at: Date.now()}; done(v); }
    if (ch.ts) {
      var pid = -1;
      bytes(ch.ts, function (b) {
        if (pid < 0) pid = pmtPid(b);
        return pid >= 0 && !!pmt(b, pid);
      }, function (b) {
        if (!b) { done(null); return; }                    // not kept: try again next time
        if (pid < 0) pid = pmtPid(b);
        fin(pid >= 0 ? pmt(b, pid) : null);
      });
    } else hlsTracks(ch.hls, function (v) { if (v) fin(v); else done(null); });
  }

  return {tracks: tracks, known: known, abort: abort, _pmt: function (b) { var p = pmtPid(b); return p >= 0 ? pmt(b, p) : null; }};
})();
