/*
 * What's in a film file before it plays: the sound and subtitle tracks of an MKV (Matroska) file, read from its start
 * (one Range request of 1 MB; when the track list lies further in, a second one where the file's index says it is).
 * Mkv.tracks(url, done) → done({audio: [{lang, name, codec, def}], subs: [...]}) or done(null) when it can't be read
 * (not MKV, no Range support, too slow). Kept per address. Mkv.abort() stops a reading (before the film plays, so the
 * server sees one connection at a time). ES5 only.
 */
var Mkv = (function () {
  'use strict';
  var HEAD = 1048576, MORE = 262144, WAIT = 8000;
  var cache = {}, xhr = null;

  function get(url, from, len, done) {
    var x = new XMLHttpRequest(), over = false;
    xhr = x;
    function end(v) { if (!over) { over = true; if (xhr === x) xhr = null; done(v); } }
    try {
      x.open('GET', url, true);
      x.responseType = 'arraybuffer';
      x.setRequestHeader('Range', 'bytes=' + from + '-' + (from + len - 1));
    } catch (e) { end(null); return; }
    x.timeout = WAIT;
    // A server that sends the whole film instead of the part asked for: stop it.
    x.onprogress = function (e) { if (e.loaded > len + 65536) { try { x.abort(); } catch (er) {} end(null); } };
    x.onload = function () { end(x.status === 206 || (x.status === 200 && x.response && x.response.byteLength <= len + 65536) ? new Uint8Array(x.response) : null); };
    x.onerror = x.ontimeout = x.onabort = function () { end(null); };
    x.send();
  }

  // EBML: an element is its id (1–4 bytes, marker kept) and size (1–8 bytes, marker dropped), then its data.
  function vint(b, p, keep) {
    var first = b[p], len = 1, mask = 0x80;
    if (first === undefined) return null;
    while (len <= 8 && !(first & mask)) { len++; mask >>= 1; }
    if (len > 8 || p + len > b.length) return null;
    var v = keep ? first : first & (mask - 1), ones = (first & (mask - 1)) === mask - 1;
    for (var i = 1; i < len; i++) { v = v * 256 + b[p + i]; if (b[p + i] !== 255) ones = false; }
    return {v: v, len: len, unknown: !keep && ones};
  }
  function head(b, p) {
    var id = vint(b, p, true);
    if (!id) return null;
    var sz = vint(b, p + id.len, false);
    if (!sz) return null;
    return {id: id.v, start: p + id.len + sz.len, size: sz.unknown ? -1 : sz.v};
  }
  function uint(b, p, n) { var v = 0; for (var i = 0; i < n; i++) v = v * 256 + b[p + i]; return v; }
  function str(b, p, n) {
    var s = '';
    for (var i = 0; i < n && b[p + i]; i++) s += '%' + (b[p + i] < 16 ? '0' : '') + b[p + i].toString(16);
    try { return decodeURIComponent(s); } catch (e) { return ''; }
  }

  var SEGMENT = 0x18538067, SEEKHEAD = 0x114D9B74, SEEK = 0x4DBB, SEEKID = 0x53AB, SEEKPOS = 0x53AC,
    TRACKS = 0x1654AE6B, ENTRY = 0xAE, CLUSTER = 0x1F43B675;

  function readTracks(b, p, end) {
    var out = {audio: [], subs: []};
    while (p < end) {
      var e = head(b, p);
      if (!e || e.size < 0) break;
      if (e.id === ENTRY) {
        var t = {type: 0, lang: 'eng', name: '', codec: '', def: true}, q = e.start, qe = Math.min(e.start + e.size, b.length);
        while (q < qe) {
          var f = head(b, q);
          if (!f || f.size < 0) break;
          if (f.id === 0x83) t.type = uint(b, f.start, f.size);
          else if (f.id === 0x22B59C) t.lang = str(b, f.start, f.size);
          else if (f.id === 0x22B59D) t.bcp = str(b, f.start, f.size);
          else if (f.id === 0x536E) t.name = str(b, f.start, f.size);
          else if (f.id === 0x86) t.codec = str(b, f.start, f.size);
          else if (f.id === 0x88) t.def = !!uint(b, f.start, f.size);
          else if (f.id === 0x55AA) t.forced = !!uint(b, f.start, f.size);
          q = f.start + f.size;
        }
        var lang = (t.bcp || t.lang || '').toLowerCase();
        var item = {lang: lang === 'und' ? '' : lang, name: t.name, codec: t.codec, def: t.def, forced: !!t.forced};
        if (t.type === 2) out.audio.push(item);
        else if (t.type === 17) out.subs.push(item);
      }
      p = e.start + e.size;
    }
    return out;
  }

  /** The track list in a file's first part, or where it is further in ({at}), or null. */
  function scan(b) {
    var p = 0, e = head(b, 0);
    if (!e || e.id !== 0x1A45DFA3) return null;           // not EBML: not MKV
    p = e.start + e.size;
    var seg = head(b, p);
    if (!seg || seg.id !== SEGMENT) return null;
    var base = seg.start, tracksAt = -1;
    p = seg.start;
    while (p < b.length) {
      e = head(b, p);
      if (!e) break;
      if (e.id === TRACKS) {
        if (e.start + e.size <= b.length) return readTracks(b, e.start, e.start + e.size);
        return {at: p, len: e.start - p + e.size};
      }
      if (e.id === CLUSTER || e.size < 0) break;
      if (e.id === SEEKHEAD) {
        var q = e.start, qe = Math.min(e.start + e.size, b.length);
        while (q < qe) {
          var s = head(b, q);
          if (!s || s.size < 0) break;
          if (s.id === SEEK) {
            var r = s.start, re = s.start + s.size, id = 0, pos = -1;
            while (r < re) {
              var f = head(b, r);
              if (!f) break;
              if (f.id === SEEKID) id = uint(b, f.start, f.size);
              else if (f.id === SEEKPOS) pos = uint(b, f.start, f.size);
              r = f.start + f.size;
            }
            if (id === TRACKS && pos >= 0) tracksAt = base + pos;
          }
          q = s.start + s.size;
        }
      }
      p = e.start + e.size;
    }
    return tracksAt >= 0 ? {at: tracksAt, len: MORE} : null;
  }

  function tracks(url, done) {
    if (!url || !/\.mkv(\?|$)/i.test(url)) { done(null); return; }
    if (cache.hasOwnProperty(url)) { done(cache[url]); return; }
    function fin(v) { cache[url] = v; done(v); }
    get(url, 0, HEAD, function (b) {
      if (!b) { done(null); return; }        // not kept: a slow server may answer next time
      var r = scan(b);
      if (!r || r.audio) { fin(r); return; }
      get(url, r.at, r.len, function (b2) {
        if (!b2) { done(null); return; }
        var e = head(b2, 0);
        fin(e && e.id === TRACKS ? readTracks(b2, e.start, Math.min(e.start + e.size, b2.length)) : null);
      });
    });
  }

  function abort() { if (xhr) { var x = xhr; xhr = null; try { x.abort(); } catch (e) {} } }

  return {tracks: tracks, abort: abort, _scan: scan};
})();
