/*
 * Your IPTV service: an Xtream login (get.php / player_api.php link) or a plain M3U list. Live channels with their
 * groups, the guide (now, next and the rest of the day per channel), films and series. The link lives only on the TV
 * (Store.link), given by Free My TV when it opens this app, or typed under Inställningar. ES5 only.
 */
var Api = (function () {
  'use strict';
  var DAY = 24 * 3600000;
  var src = null, live = null, liveCats = null, mem = {};

  // MARK: - The link

  /** {base, user, pass} of an Xtream login in the link, else null (a plain M3U list). */
  function xtream(url) {
    var m = /^(https?:\/\/[^\/?#]+)\/(?:get|player_api)\.php\?(.*)$/i.exec(url || '');
    if (m) {
      var q = {}, parts = m[2].split('&');
      for (var i = 0; i < parts.length; i++) {
        var kv = parts[i].split('=');
        try { q[decodeURIComponent(kv[0] || '').toLowerCase()] = decodeURIComponent((kv[1] || '').replace(/\+/g, ' ')); } catch (e) {}
      }
      if (q.username && q.password) return {base: m[1], user: q.username, pass: q.password};
    }
    m = /^(https?:\/\/[^\/?#]+)\/(?:live\/)?([^\/]+)\/([^\/]+)\/\d+/i.exec(url || '');
    return m && !/\.m3u8?(\?|$)/i.test(url) ? {base: m[1], user: decodeURIComponent(m[2]), pass: decodeURIComponent(m[3])} : null;
  }

  function use(url) {
    if (src && src.url === url) return;
    src = {url: url, x: xtream(url)};
    live = null; liveCats = null; mem = {};
  }

  // MARK: - Requests

  function get(url, done, timeout) {
    var x = new XMLHttpRequest(), over = false;
    x.open('GET', url, true);
    x.timeout = timeout || 60000;
    x.onreadystatechange = function () {
      if (x.readyState !== 4 || over) return;
      over = true;
      if (x.status >= 200 && x.status < 300) done(null, x.responseText);
      else done(new Error(x.status ? 'HTTP ' + x.status : 'ingen kontakt med servern'));
    };
    x.ontimeout = function () { if (!over) { over = true; done(new Error('servern svarade inte')); } };
    x.send();
  }

  function api(action, extra, done) {
    var x = src.x, key = action + (extra || '');
    if (mem[key] && Date.now() - mem[key].at < 30 * 60000) { done(null, mem[key].v); return; }
    get(x.base + '/player_api.php?username=' + encodeURIComponent(x.user) + '&password=' + encodeURIComponent(x.pass)
      + '&action=' + action + (extra || ''), function (err, text) {
      if (err) { done(err); return; }
      var v;
      try { v = JSON.parse(text); } catch (e) { done(new Error('oväntat svar från servern')); return; }
      mem[key] = {at: Date.now(), v: v};
      done(null, v);
    });
  }

  function root(kind) { var x = src.x; return x.base + '/' + kind + '/' + encodeURIComponent(x.user) + '/' + encodeURIComponent(x.pass) + '/'; }

  // MARK: - Live channels

  /** All live channels as {id, name, logo, epg, cat, hls, ts}, and the groups {id, name, n}; kept a day on the TV. */
  function channels(done, fresh) {
    if (!src) { done(new Error('ingen IPTV-länk')); return; }
    if (live && !fresh) { done(null, live, liveCats); return; }
    if (!fresh) {
      var saved = Store.cache('live');
      if (saved && saved.url === src.url && Date.now() - saved.at < DAY) { live = saved.live; liveCats = saved.cats; done(null, live, liveCats); return; }
    }
    function keep(l, c) {
      live = l; liveCats = c;
      Store.cache('live', {url: src.url, at: Date.now(), live: l, cats: c});
      done(null, l, c);
    }
    if (src.x) {
      api('get_live_categories', '', function (err, cats) {
        if (err) { m3u(keep, done); return; }
        api('get_live_streams', '', function (err2, streams) {
          if (err2 || !streams || !streams.length) { m3u(keep, done); return; }
          var r = root('live'), out = [], n = {};
          for (var i = 0; i < streams.length; i++) {
            var s = streams[i];
            if (!s || s.stream_id === undefined) continue;
            out.push({id: String(s.stream_id), name: String(s.name || ''), logo: s.stream_icon || '', epg: String(s.epg_channel_id || ''),
              cat: String(s.category_id || ''), hls: r + s.stream_id + '.m3u8', ts: r + s.stream_id + '.ts'});
            n[s.category_id] = (n[s.category_id] || 0) + 1;
          }
          var groups = [];
          for (i = 0; cats && i < cats.length; i++) if (n[cats[i].category_id]) groups.push({id: String(cats[i].category_id), name: String(cats[i].category_name || ''), n: n[cats[i].category_id]});
          keep(out, Lang.sort(groups, function (g) { return g.name; }));
        });
      });
    } else m3u(keep, done);
  }

  /** A plain M3U list: live channels with their group-title (films and series left out). */
  function m3u(keep, done) {
    get(src.url, function (err, text) {
      if (err) { done(err); return; }
      if (text.indexOf('#EXTINF') < 0) { done(new Error('länken ger ingen kanallista')); return; }
      var lines = text.split(/\r?\n/), out = [], info = null, groups = {}, order = [], k = 0;
      for (var i = 0; i < lines.length; i++) {
        var l = lines[i];
        if (l.indexOf('#EXTINF') === 0) {
          var a = function (name) { var m = new RegExp(name + '="([^"]*)"', 'i').exec(l); return m ? m[1] : ''; };
          info = {name: l.substring(l.lastIndexOf(',') + 1).replace(/^\s+|\s+$/g, ''), logo: a('tvg-logo'), epg: a('tvg-id'), group: a('group-title') || 'Övrigt'};
        } else if (info && /^https?:\/\//i.test(l)) {
          var u = l.replace(/\s+$/, '');
          if (!/\/(movie|series)\//i.test(u)) {
            if (!groups[info.group]) { groups[info.group] = {id: 'g' + order.length, name: info.group, n: 0}; order.push(groups[info.group]); }
            groups[info.group].n++;
            var ch = {id: 'm' + (k++), name: info.name, logo: info.logo, epg: info.epg, cat: groups[info.group].id};
            var xs = /^(https?:\/\/[^\/]+)\/(?:live\/)?([^\/]+)\/([^\/]+)\/(\d+)(\.ts|\.m3u8)?$/i.exec(u);
            if (xs) { var b = xs[1] + '/live/' + xs[2] + '/' + xs[3] + '/' + xs[4]; ch.hls = b + '.m3u8'; ch.ts = b + '.ts'; }
            else if (/\.m3u8(\?|$)/i.test(u)) ch.hls = u;
            else ch.ts = u;
            out.push(ch);
          }
          info = null;
        }
      }
      if (!out.length) { done(new Error('inga kanaler i listan')); return; }
      keep(out, Lang.sort(order, function (g) { return g.name; }));
    });
  }

  // MARK: - The guide

  function b64(s) {
    try { return decodeURIComponent(escape(window.atob(s || ''))); } catch (e) { try { return window.atob(s || ''); } catch (e2) { return s || ''; } }
  }

  /** The programmes of a channel from now on: [{title, desc, start, stop}] (ms); [] without a guide. */
  function guide(ch, done, limit) {
    if (!src || !src.x) { done(null, []); return; }
    api('get_short_epg', '&stream_id=' + encodeURIComponent(ch.id) + '&limit=' + (limit || 12), function (err, v) {
      if (err || !v) { done(null, []); return; }
      var l = v.epg_listings || [], out = [], now = Date.now();
      for (var i = 0; i < l.length; i++) {
        var start = (+l[i].start_timestamp || Date.parse(String(l[i].start).replace(' ', 'T') + 'Z') / 1000) * 1000;
        var stop = (+l[i].stop_timestamp || Date.parse(String(l[i].end || l[i].stop).replace(' ', 'T') + 'Z') / 1000) * 1000;
        if (stop > now) out.push({title: b64(l[i].title), desc: b64(l[i].description), start: start, stop: stop});
      }
      out.sort(function (a, b) { return a.start - b.start; });
      done(null, out);
    });
  }

  // MARK: - Films and series

  function vodNeeded(done) { if (!src || !src.x) { done(new Error('filmer och serier kräver en Xtream-inloggning')); return false; } return true; }

  function cats(action, done) {
    if (!vodNeeded(done)) return;
    api(action, '', function (err, v) {
      if (err) { done(err); return; }
      var out = [];
      for (var i = 0; v && i < v.length; i++) out.push({id: String(v[i].category_id), name: String(v[i].category_name || '')});
      done(null, Lang.sort(out, function (g) { return g.name; }));
    });
  }

  function films(cat, done) {
    if (!vodNeeded(done)) return;
    api('get_vod_streams', '&category_id=' + encodeURIComponent(cat), function (err, v) {
      if (err) { done(err); return; }
      var out = [], r = root('movie');
      for (var i = 0; v && i < v.length; i++) {
        var f = v[i];
        out.push({kind: 'film', id: String(f.stream_id), name: String(f.name || ''), poster: f.stream_icon || '', rating: f.rating || '',
          url: r + f.stream_id + '.' + (f.container_extension || 'mp4'), year: f.year || ''});
      }
      done(null, out);
    });
  }

  function filmInfo(film, done) {
    api('get_vod_info', '&vod_id=' + encodeURIComponent(film.id), function (err, v) {
      var i = (v && v.info) || {};
      done(null, {plot: i.plot || i.description || '', year: i.releasedate || i.release_date || film.year || '', genre: i.genre || '',
        duration: i.duration || '', rating: i.rating || film.rating || '', backdrop: (i.backdrop_path && i.backdrop_path[0]) || i.cover_big || ''});
    });
  }

  function series(cat, done) {
    if (!vodNeeded(done)) return;
    api('get_series', '&category_id=' + encodeURIComponent(cat), function (err, v) {
      if (err) { done(err); return; }
      var out = [];
      for (var i = 0; v && i < v.length; i++) {
        var s = v[i];
        out.push({kind: 'series', id: String(s.series_id), name: String(s.name || ''), poster: s.cover || '', rating: s.rating || '',
          plot: s.plot || '', year: s.releaseDate || s.year || ''});
      }
      done(null, out);
    });
  }

  /** A series' seasons: [{n, episodes: [{id, title, n, url, plot}]}], and its info. */
  function seriesInfo(s, done) {
    api('get_series_info', '&series_id=' + encodeURIComponent(s.id), function (err, v) {
      if (err) { done(err); return; }
      var eps = (v && v.episodes) || {}, seasons = [], r = root('series');
      for (var k in eps) {
        if (!eps.hasOwnProperty(k)) continue;
        var list = [];
        for (var i = 0; i < eps[k].length; i++) {
          var e = eps[k][i];
          list.push({kind: 'episode', id: String(e.id), n: +e.episode_num || i + 1, season: +k, series: s.id, seriesName: s.name,
            title: String(e.title || ('Avsnitt ' + (i + 1))), plot: (e.info && e.info.plot) || '', url: r + e.id + '.' + (e.container_extension || 'mp4')});
        }
        list.sort(function (a, b) { return a.n - b.n; });
        seasons.push({n: +k, episodes: list});
      }
      seasons.sort(function (a, b) { return a.n - b.n; });
      var info = (v && v.info) || {};
      done(null, seasons, {plot: info.plot || s.plot || '', year: info.releaseDate || s.year || '', genre: info.genre || '', backdrop: (info.backdrop_path && info.backdrop_path[0]) || ''});
    });
  }

  return {
    use: use, xtream: xtream, channels: channels, guide: guide,
    filmCats: function (d) { cats('get_vod_categories', d); }, films: films, filmInfo: filmInfo,
    seriesCats: function (d) { cats('get_series_categories', d); }, series: series, seriesInfo: seriesInfo,
    hasVod: function () { return !!(src && src.x); },
    host: function () { var m = /^https?:\/\/([^\/:?#]+)/i.exec((src && src.url) || ''); return m ? m[1] : ''; }
  };
})();
