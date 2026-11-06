/*
 * What the app keeps on the TV: the IPTV link, favourites, what was watched last (with where a film or an episode was
 * left), and the channel list for a day. Nothing of it goes anywhere else. ES5 only.
 */
var Store = (function () {
  'use strict';
  var P = 'iptv.';

  function read(k, d) { try { var v = JSON.parse(localStorage.getItem(P + k)); return v === null || v === undefined ? d : v; } catch (e) { return d; } }
  function write(k, v) { try { if (v === undefined) localStorage.removeItem(P + k); else localStorage.setItem(P + k, JSON.stringify(v)); } catch (e) {} }

  /** The key of a channel, film, series or episode in the favourites and the history. */
  function key(item) { return (item.kind || 'live') + ':' + item.id; }

  /** What's kept of an item: enough to show it and play it again without the lists. */
  function slim(item) {
    var o = {kind: item.kind || 'live', id: item.id, name: item.name || item.title || ''};
    var keepKeys = ['logo', 'epg', 'cat', 'hls', 'ts', 'poster', 'url', 'title', 'n', 'season', 'series', 'seriesName', 'year', 'rating'];
    for (var i = 0; i < keepKeys.length; i++) if (item[keepKeys[i]] !== undefined && item[keepKeys[i]] !== '') o[keepKeys[i]] = item[keepKeys[i]];
    return o;
  }

  return {
    link: function (v) { if (arguments.length) write('link', v || undefined); return read('link', ''); },

    favs: function () { return read('favs', []); },
    isFav: function (item) { var f = read('favs', []), k = key(item); for (var i = 0; i < f.length; i++) if (key(f[i]) === k) return true; return false; },
    toggleFav: function (item) {
      var f = read('favs', []), k = key(item), out = [], had = false;
      for (var i = 0; i < f.length; i++) { if (key(f[i]) === k) had = true; else out.push(f[i]); }
      if (!had) out.unshift(slim(item));
      write('favs', out);
      return !had;
    },

    recent: function () { return read('recent', []); },
    /** Watched now: first in the history; a film or an episode keeps where it was left (seconds) and its length. */
    watched: function (item, pos, len) {
      var r = read('recent', []), k = key(item), out = [slim(item)];
      if (pos !== undefined) { out[0].pos = Math.floor(pos); out[0].len = Math.floor(len || 0); }
      for (var i = 0; i < r.length && out.length < 40; i++) if (key(r[i]) !== k) out.push(r[i]);
      write('recent', out);
    },
    position: function (item) {
      var r = read('recent', []), k = key(item);
      for (var i = 0; i < r.length; i++) if (key(r[i]) === k) return r[i].pos && (!r[i].len || r[i].pos < r[i].len - 60) ? r[i].pos : 0;
      return 0;
    },
    lastChannel: function () { var r = read('recent', []); for (var i = 0; i < r.length; i++) if (r[i].kind === 'live') return r[i]; return null; },

    cache: function (k, v) { if (arguments.length > 1) write('cache.' + k, v); return read('cache.' + k, null); },
    forget: function () { write('cache.live', undefined); }
  };
})();
