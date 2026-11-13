/*
 * Search in Free My TV: say or type a film or a series ("Dune", "serien om kocken i Chicago", "quiero ver Narcos") and see
 * where it is: the streaming apps on the TV (TMDB's "where to watch" for Sweden), the films and series in the IPTV list,
 * a Plex server at home, Stremio, and its trailer. OK on a place opens it there.
 *
 * - Claude (optional, a key of his own kept only on the TV) reads what was said and turns it into titles; without a key
 *   it's TMDB's own search on the words.
 * - The phone: a page (phone/ in the repo) paired with a QR code. What's said there arrives here through ntfy.sh, on a
 *   topic only the TV and the phone know, and the results go back to the phone, where a tap opens them on the TV.
 *   The phone also copies this TV's settings to the other TVs it's paired with (getprefs / setprefs, below).
 * - Plex: linked with a code at plex.tv/link (no password typed on the TV); films and episodes play in the IPTV app's
 *   player (or the one in this app).
 *
 * Everything it keeps (the Claude key, the Plex token, the phone's topic) lives in localStorage on the TV, never in the
 * repo. ES5 only.
 */
var Search = (function () {
  'use strict';
  var STORE = 'fmtv.search', TMDB = 'https://api.tmdb.org/3';
  var RELAY = (window.CONFIG && CONFIG.relay) || 'https://ntfy.sh/';   // the phone's relay (another ntfy server can be set in config)
  var PHONE = (window.CONFIG && CONFIG.phoneUrl) || 'https://raw.githack.com/MrOrtiiz/my-tv/main/phone/index.html';
  var QRLIB = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
  var MODEL = 'claude-haiku-5-5';

  var cfg = {};
  try { cfg = JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) { cfg = {}; }
  function save() { try { localStorage.setItem(STORE, JSON.stringify(cfg)); } catch (e) {} }

  function rid(n) {
    var abc = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', out = '', b = null;
    try { b = new Uint8Array(n); window.crypto.getRandomValues(b); } catch (e) { b = null; }
    for (var i = 0; i < n; i++) out += abc.charAt((b ? b[i] : Math.floor(Math.random() * 256)) % abc.length);
    return out;
  }
  function clientId() { if (!cfg.cid) { cfg.cid = 'fmtv-' + rid(16); save(); } return cfg.cid; }

  // MARK: - Small helpers

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, parent, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    if (parent) parent.appendChild(n);
    return n;
  }
  function toast(t) { if (window.FreeMyTV && FreeMyTV.toast) FreeMyTV.toast(t); }

  /** An HTTP request: done(error, the answer as JSON when it is, else as text). */
  function http(method, url, headers, body, timeout, done) {
    var x = new XMLHttpRequest(), over = false;
    try { x.open(method, url, true); } catch (e) { done(e); return; }
    x.timeout = timeout || 15000;
    for (var h in headers) if (headers.hasOwnProperty(h)) x.setRequestHeader(h, headers[h]);
    x.onreadystatechange = function () {
      if (x.readyState !== 4 || over) return;
      over = true;
      var v = x.responseText;
      try { v = JSON.parse(v); } catch (e) {}
      if (x.status >= 200 && x.status < 300) done(null, v);
      else {
        var err = new Error(x.status ? 'HTTP ' + x.status : 'ingen kontakt');
        err.status = x.status; err.body = v;
        done(err, v);
      }
    };
    x.ontimeout = function () { if (!over) { over = true; done(new Error('tog för lång tid')); } };
    x.send(body === undefined ? null : body);
  }

  /** Lowercase, no accents, brackets, years, quality tags or punctuation: what two names of the same title share. */
  function norm(s) {
    s = String(s || '').toLowerCase();
    try { s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) {}
    return s.replace(/&/g, ' and ').replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
      .replace(/\b(4k|uhd|fhd|hd|sd|hdr|hevc|x265|x264|multi|multisub|sub|subs|dual|vose|latino|castellano|dubbed|1080p|720p|2160p)\b/g, ' ')
      .replace(/\b(19|20)\d{2}\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').replace(/^the /, '').replace(/\s+/g, ' ').trim();
  }
  function yearIn(s) { var m = String(s || '').match(/\b(19[2-9]\d|20[0-4]\d)\b/g); return m ? +m[m.length - 1] : 0; }

  // MARK: - TMDB

  function tmdb(path, done) {
    var key = (window.Prefs && Prefs.tmdbKey) ? Prefs.tmdbKey() : '';
    if (!key) { done(new Error('ingen TMDB-nyckel')); return; }
    var bearer = key.indexOf('eyJ') === 0;
    var url = TMDB + path + (bearer ? '' : (path.indexOf('?') >= 0 ? '&' : '?') + 'api_key=' + encodeURIComponent(key));
    http('GET', url, bearer ? {Authorization: 'Bearer ' + key, Accept: 'application/json'} : {Accept: 'application/json'}, undefined, 12000, done);
  }
  function region() { return (window.Place && Place.country) || (window.CONFIG && CONFIG.tmdbRegion) || 'SE'; }

  /** The words around a title in a spoken wish ("jag vill se", "quiero ver", "play"), left out for a plain search. */
  function bare(text) {
    return String(text || '').replace(/^\s*(hej|hey|hola|ok|okej)[,!\s]+/i, '')
      .replace(/^\s*(jag\s+vill\s+(se|titta\s+på|kolla\s+på)|kan\s+du\s+(visa|hitta|söka\s+efter|spela)|visa|hitta|sök(\s+efter)?|spela|starta|kolla\s+på|titta\s+på|quiero\s+ver|pon(me)?|busca(r)?|ver|play|watch|find|search(\s+for)?|i\s+want\s+to\s+(watch|see)|show\s+me)\s+/i, '')
      .replace(/^\s*(filmen|serien|film(en)?|serie(n)?|la\s+pel[ií]cula|la\s+serie|the\s+movie|the\s+show|the\s+series)\s+/i, '')
      .replace(/[?.!]+$/, '').trim();
  }

  /** TMDB's own search on the words: up to 8 films and series, as {kind, id}. */
  function plainSearch(text, done) {
    var q = bare(text) || text;
    tmdb('/search/multi?include_adult=false&language=sv-SE&query=' + encodeURIComponent(q), function (err, r) {
      if (err) { done(err, []); return; }
      var out = [], list = (r && r.results) || [];
      for (var i = 0; i < list.length && out.length < 8; i++) {
        var o = list[i];
        if (o.media_type === 'movie' || o.media_type === 'tv') out.push({kind: o.media_type, id: o.id});
        else if (o.media_type === 'person' && o.known_for) {
          for (var j = 0; j < o.known_for.length && out.length < 8; j++) {
            var k = o.known_for[j];
            if (k.media_type === 'movie' || k.media_type === 'tv') out.push({kind: k.media_type, id: k.id});
          }
        }
      }
      done(null, out);
    });
  }

  /** A title Claude named, found on TMDB (with its year when given): done({kind, id} or null). */
  function findTitle(t, done) {
    var kind = t.type === 'tv' ? 'tv' : 'movie';
    var year = t.year ? (kind === 'tv' ? '&first_air_date_year=' : '&primary_release_year=') + t.year : '';
    function look(k, y, next) {
      tmdb('/search/' + k + '?include_adult=false&language=sv-SE&query=' + encodeURIComponent(t.title) + y, function (err, r) {
        var o = !err && r && r.results && r.results[0];
        if (o) done({kind: k, id: o.id}); else next();
      });
    }
    look(kind, year, function () {
      look(kind, '', function () { look(kind === 'tv' ? 'movie' : 'tv', '', function () { done(null); }); });
    });
  }

  /** The details of a title: its names, year, poster, overview, IMDb id and where it streams in Sweden. */
  function details(ref, done) {
    tmdb('/' + ref.kind + '/' + ref.id + '?language=sv-SE&append_to_response=watch/providers,external_ids,translations', function (err, o) {
      if (err || !o) { done(null); return; }
      var t = {kind: ref.kind, id: ref.id, title: o.title || o.name || '', original: o.original_title || o.original_name || '',
        year: +String(o.release_date || o.first_air_date || '').slice(0, 4) || 0, poster: o.poster_path || '', backdrop: o.backdrop_path || '',
        overview: o.overview || '', imdb: (o.external_ids && o.external_ids.imdb_id) || o.imdb_id || '', names: [], sources: [], pending: 0};
      var tr = (o.translations && o.translations.translations) || [];
      for (var i = 0; i < tr.length; i++) {
        var d = tr[i].data || {}, n = d.title || d.name;
        if (n && /^(en|es|sv)$/.test(tr[i].iso_639_1)) t.names.push(n);
        if (n && tr[i].iso_639_1 === 'en' && !t.en) t.en = n;
        if (!t.overview && tr[i].iso_639_1 === 'en' && d.overview) t.overview = d.overview;
      }
      t.names.push(t.title, t.original);
      var seen = {}, names = [];
      for (var j = 0; j < t.names.length; j++) { var nn = norm(t.names[j]); if (nn && !seen[nn]) { seen[nn] = true; names.push(nn); } }
      t.norms = names;
      var wp = o['watch/providers'], here = wp && wp.results && wp.results[region()];
      t.providers = here || {};
      done(t);
    });
  }

  // MARK: - Claude: what was said, as titles

  function claudeOn() { return !!cfg.claude; }

  function system() {
    var liked = [];
    try { var t = (window.Data && Data.taste) ? Data.taste() : []; for (var i = 0; i < t.length && i < 12; i++) liked.push(t[i].title); } catch (e) {}
    return 'Du är sökhjälpen på en TV-hemskärm i Sverige (appar: Netflix, HBO Max, Disney+, Prime Video, Apple TV, SkyShowtime, '
      + 'Viaplay, SVT Play, TV4 Play, SF Anytime, YouTube, plus IPTV, Plex och Stremio). Tittaren pratar svenska, spanska eller engelska, '
      + 'ofta med röstinmatning, så ord kan vara felstavade eller felhörda. Svara ENDAST med JSON, inget annat: '
      + '{"say": "kort svar på tittarens språk, högst 12 ord", "items": [{"title": "titeln på engelska eller originalspråk", "year": 2024, "type": "movie eller tv"}]}. '
      + 'Högst 6 titlar, den troligaste först. Nämner tittaren en titel: ge den titeln (och titlar den kan förväxlas med). '
      + 'Beskriver tittaren något (skådespelare, regissör, handling, genre, stämning, "något likt X"): föreslå verkliga titlar som passar. '
      + (liked.length ? 'Trailers tittaren nyligen ville se: ' + liked.join(', ') + '. Använd dem bara när tittaren ber om tips. ' : '')
      + 'Handlar det inte om film eller serier: tom items och say förklarar kort.';
  }

  function askClaude(text, done) {
    var body = JSON.stringify({model: cfg.model || MODEL, max_tokens: 600, system: system(), messages: [{role: 'user', content: text}]});
    http('POST', 'https://api.anthropic.com/v1/messages', {
      'x-api-key': cfg.claude, 'anthropic-version': '2023-06-01', 'content-type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true'
    }, body, 25000, function (err, r) {
      if (err) {
        var m = r && r.error && r.error.message;
        if (err.status === 401) m = 'Claude-nyckeln godtogs inte';
        done(new Error(m || err.message));
        return;
      }
      var txt = '';
      for (var i = 0; r && r.content && i < r.content.length; i++) if (r.content[i].type === 'text') txt += r.content[i].text;
      var a = txt.indexOf('{'), b = txt.lastIndexOf('}'), o = null;
      try { o = JSON.parse(txt.slice(a, b + 1)); } catch (e) {}
      if (!o) { done(new Error('Claude svarade konstigt')); return; }
      done(null, {say: String(o.say || ''), items: (o.items || []).slice(0, 6)});
    });
  }

  // MARK: - The apps on the TV

  var apps = null;
  function loadApps(done) {
    if (apps) { done(apps); return; }
    TV.apps(function (list) { apps = list || []; done(apps); });
  }
  function appLike(re) {
    for (var i = 0; apps && i < apps.length; i++) if (re.test(apps[i].title) || re.test(apps[i].id)) return apps[i];
    return null;
  }

  /** TMDB's names for the services (lowercase) → the app on the TV, its name. */
  var SERVICES = [
    [/netflix/, /netflix/i, 'Netflix'],
    [/amazon|prime video/, /prime video|amazon/i, 'Prime Video'],
    [/disney/, /disney/i, 'Disney+'],
    [/\bmax\b|hbo/, /\bmax\b|hbo/i, 'HBO Max'],
    [/apple tv/, /apple ?tv/i, 'Apple TV'],
    [/skyshowtime/, /skyshowtime/i, 'SkyShowtime'],
    [/viaplay/, /viaplay/i, 'Viaplay'],
    [/svt/, /svt/i, 'SVT Play'],
    [/tv4|c more|cmore/, /tv4/i, 'TV4 Play'],
    [/sf anytime/, /sf ?anytime/i, 'SF Anytime'],
    [/rakuten/, /rakuten/i, 'Rakuten TV'],
    [/paramount/, /paramount/i, 'Paramount+'],
    [/crunchyroll/, /crunchyroll/i, 'Crunchyroll'],
    [/discovery/, /discovery/i, 'Discovery+'],
    [/mubi/, /mubi/i, 'MUBI'],
    [/youtube/, /^youtube$/i, 'YouTube'],
    [/^plex/, /^plex$/i, 'Plex']
  ];
  var KINDS = [['flatrate', 'Ingår', 0], ['free', 'Gratis', 1], ['ads', 'Gratis', 1], ['rent', 'Hyr', 2], ['buy', 'Köp', 3]];

  /** The streaming apps on the TV that have the title, best deal first (included, free, rent, buy). */
  function streaming(t) {
    var found = {}, order = [];
    for (var k = 0; k < KINDS.length; k++) {
      var list = t.providers[KINDS[k][0]] || [];
      for (var i = 0; i < list.length; i++) {
        var name = String(list[i].provider_name || '').toLowerCase();
        if (name.indexOf(' channel') >= 0) continue;   // sold inside another app
        for (var s = 0; s < SERVICES.length; s++) {
          if (!SERVICES[s][0].test(name)) continue;
          var app = appLike(SERVICES[s][1]);
          if (app && !found[app.id]) { found[app.id] = true; order.push({kind: 'app', label: SERVICES[s][2], note: KINDS[k][1], rank: KINDS[k][2], app: app}); }
          break;
        }
      }
    }
    order.sort(function (a, b) { return a.rank - b.rank; });
    return order;
  }

  // MARK: - IPTV: the films and series in the Xtream list (loaded once, on the first search)

  function iptvLink() { return (window.Prefs && Prefs.iptv) ? Prefs.iptv() : ''; }
  function xtream(url) {
    var m = /^(https?:\/\/[^\/?#]+)\/(?:get|player_api)\.php\?(.*)$/i.exec(url || '');
    if (m) {
      var q = {}, parts = m[2].split('&');
      for (var i = 0; i < parts.length; i++) { var kv = parts[i].split('='); q[decodeURIComponent(kv[0] || '').toLowerCase()] = decodeURIComponent((kv[1] || '').replace(/\+/g, ' ')); }
      if (q.username && q.password) return {base: m[1], user: q.username, pass: q.password};
    }
    m = /^(https?:\/\/[^\/?#]+)\/live\/([^\/]+)\/([^\/]+)\//i.exec(url || '');
    return m ? {base: m[1], user: decodeURIComponent(m[2]), pass: decodeURIComponent(m[3])} : null;
  }

  var vod = null, vodFor = '', vodWait = null;
  var TAG = /^\s*[\[(|]?\s*([A-Z]{2,4})\s*[\])|]?\s*[-:|•]\s*/;
  /** The list's language prefix ("ES - …", "|EN| …"), and the name without it. */
  function tagOf(name) { var m = TAG.exec(name || ''); return m ? m[1] : ''; }
  function untagged(name) { return String(name || '').replace(TAG, ''); }

  function loadVod(done) {
    var link = iptvLink(), x = xtream(link);
    if (!x) { done(null); return; }
    if (vod && vodFor === link) { done(vod); return; }
    if (vodWait) { vodWait.push(done); return; }
    vodWait = [done];
    var api = x.base + '/player_api.php?username=' + encodeURIComponent(x.user) + '&password=' + encodeURIComponent(x.pass) + '&action=';
    var root = function (k) { return x.base + '/' + k + '/' + encodeURIComponent(x.user) + '/' + encodeURIComponent(x.pass) + '/'; };
    var out = {films: [], series: [], x: x};
    function finish() { vod = out; vodFor = link; var w = vodWait; vodWait = null; for (var i = 0; i < w.length; i++) w[i](vod); }
    http('GET', api + 'get_vod_streams', {}, undefined, 60000, function (e1, films) {
      for (var i = 0; !e1 && films && i < films.length; i++) {
        var f = films[i], n = String(f.name || '');
        out.films.push({n: norm(untagged(n)), name: n, id: String(f.stream_id), y: yearIn(n) || +String(f.year || f.releaseDate || '').slice(0, 4) || 0,
          tm: String(f.tmdb || f.tmdb_id || ''), tag: tagOf(n), poster: f.stream_icon || '', url: root('movie') + f.stream_id + '.' + (f.container_extension || 'mp4')});
      }
      http('GET', api + 'get_series', {}, undefined, 60000, function (e2, ser) {
        for (var j = 0; !e2 && ser && j < ser.length; j++) {
          var s = ser[j], sn = String(s.name || '');
          out.series.push({n: norm(untagged(sn)), name: sn, id: String(s.series_id), y: yearIn(sn) || +String(s.releaseDate || s.release_date || '').slice(0, 4) || 0,
            tm: String(s.tmdb || s.tmdb_id || ''), tag: tagOf(sn), poster: s.cover || ''});
        }
        finish();
      });
    });
  }

  var LANG_RANK = {ES: 0, SP: 0, EN: 1, UK: 1, US: 1, SE: 2, SV: 2, SW: 2};
  function iptvMatches(t) {
    if (!vod) return [];
    var list = t.kind === 'tv' ? vod.series : vod.films, out = [];
    for (var i = 0; i < list.length; i++) {
      var c = list[i], ok = false;
      if (c.tm && c.tm === String(t.id)) ok = true;
      else if (c.n && t.norms.indexOf(c.n) >= 0) ok = !c.y || !t.year || Math.abs(c.y - t.year) <= 1;
      if (ok) out.push(c);
    }
    out.sort(function (a, b) {
      var ra = LANG_RANK.hasOwnProperty(a.tag) ? LANG_RANK[a.tag] : 3, rb = LANG_RANK.hasOwnProperty(b.tag) ? LANG_RANK[b.tag] : 3;
      return ra - rb;
    });
    var seen = {}, picked = [];
    for (var k = 0; k < out.length && picked.length < 3; k++) { var key = out[k].tag || '-'; if (!seen[key]) { seen[key] = true; picked.push(out[k]); } }
    return picked.map(function (c) {
      return {kind: 'iptv', label: 'IPTV' + (c.tag ? ' ' + c.tag : ''), note: t.kind === 'tv' ? 'Serie' : 'Film', item: c, tv: t.kind === 'tv'};
    });
  }

  function openIptv(src, t) {
    var c = src.item, what = {kind: src.tv ? 'series' : 'film', id: c.id, name: c.name, poster: c.poster || '', url: c.url || '', year: c.y || ''};
    if (window.IPTV && IPTV.appInstalled && IPTV.appInstalled()) {
      IPTV.launchApp({open: what}, function (ok) { if (!ok) here(); });
      return;
    }
    here();
    function here() {
      if (src.tv) { toast('Serier spelas i IPTV-appen. Installera den för att se ' + t.title + '.'); return; }
      close();
      IPTV.open([{label: c.name, ch: {u: c.url, vod: true}}], 0, t.title);
    }
  }

  // MARK: - Plex: linked with a code at plex.tv/link, searched on the servers at home

  function plexHeaders(token) {
    var h = {'Accept': 'application/json', 'X-Plex-Product': 'Free My TV', 'X-Plex-Client-Identifier': clientId(),
      'X-Plex-Platform': 'Chrome', 'X-Plex-Device-Name': 'Free My TV'};
    if (token) h['X-Plex-Token'] = token;
    return h;
  }
  function plexOn() { return !!(cfg.plex && cfg.plex.token && cfg.plex.servers && cfg.plex.servers.length); }

  var plexLinking = null;
  /** Starts linking: shows(code) once plex.tv gave one, done(error or null) when linked or given up. */
  function plexLink(shows, done) {
    plexStop();
    var mine = plexLinking = {};
    http('POST', 'https://plex.tv/api/v2/pins?strong=false', plexHeaders(), undefined, 15000, function (err, pin) {
      if (mine !== plexLinking) return;
      if (err || !pin || !pin.id) { done(new Error('fick ingen kod från plex.tv')); return; }
      shows(pin.code);
      var until = Date.now() + 10 * 60000;
      (function poll() {
        if (mine !== plexLinking) return;
        if (Date.now() > until) { done(new Error('koden gick ut')); return; }
        http('GET', 'https://plex.tv/api/v2/pins/' + pin.id, plexHeaders(), undefined, 10000, function (e2, p) {
          if (mine !== plexLinking) return;
          if (!e2 && p && p.authToken) { plexServers(p.authToken, done); return; }
          mine.timer = setTimeout(poll, 3000);
        });
      })();
    });
  }
  function plexStop() { if (plexLinking && plexLinking.timer) clearTimeout(plexLinking.timer); plexLinking = null; }

  function plexServers(token, done) {
    http('GET', 'https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=1', plexHeaders(token), undefined, 15000, function (err, list) {
      if (err || !list || !list.length) { done(new Error('hittade ingen Plex-server')); return; }
      var servers = [];
      for (var i = 0; i < list.length; i++) {
        var r = list[i];
        if (String(r.provides || '').indexOf('server') < 0) continue;
        var cs = (r.connections || []).slice().sort(function (a, b) { return (a.relay ? 2 : a.local ? 0 : 1) - (b.relay ? 2 : b.local ? 0 : 1); });
        servers.push({name: r.name || 'Plex', token: r.accessToken || token, uris: cs.map(function (c) { return c.uri; })});
      }
      if (!servers.length) { done(new Error('hittade ingen Plex-server')); return; }
      cfg.plex = {token: token, servers: servers};
      save();
      done(null);
    });
  }

  /** The address of a server that answers (the one that worked last time first). */
  function plexReach(s, done) {
    var uris = s.uris.slice();
    if (s.ok) { uris.splice(uris.indexOf(s.ok), 1); uris.unshift(s.ok); }
    (function next(i) {
      if (i >= uris.length) { done(null); return; }
      http('GET', uris[i] + '/identity', plexHeaders(s.token), undefined, 3500, function (err) {
        if (err) { next(i + 1); return; }
        if (s.ok !== uris[i]) { s.ok = uris[i]; save(); }
        done(uris[i]);
      });
    })(0);
  }

  function plexSearch(t, done) {
    if (!plexOn()) { done([]); return; }
    var out = [], left = cfg.plex.servers.length;
    function one() { if (--left === 0) done(out); }
    cfg.plex.servers.forEach(function (s) {
      plexReach(s, function (uri) {
        if (!uri) { one(); return; }
        var q = t.en || t.title;
        http('GET', uri + '/hubs/search?limit=10&query=' + encodeURIComponent(q), plexHeaders(s.token), undefined, 8000, function (err, r) {
          var hubs = (!err && r && r.MediaContainer && r.MediaContainer.Hub) || [];
          for (var h = 0; h < hubs.length; h++) {
            var ms = hubs[h].Metadata || [];
            for (var m = 0; m < ms.length; m++) {
              var x = ms[m], type = x.type === 'show' ? 'tv' : x.type === 'movie' ? 'movie' : '';
              if (type !== t.kind) continue;
              if (t.norms.indexOf(norm(x.title)) < 0 && t.norms.indexOf(norm(x.originalTitle)) < 0) continue;
              if (x.year && t.year && Math.abs(x.year - t.year) > 1) continue;
              out.push({kind: 'plex', label: 'Plex', note: cfg.plex.servers.length > 1 ? s.name : (type === 'tv' ? 'Serie' : 'Film'), server: s, uri: uri, key: x.ratingKey, show: type === 'tv'});
              break;
            }
          }
          one();
        });
      });
    });
  }

  /** Plays a Plex film (or a series' next episode, where it was left) in the IPTV app's player, else here. */
  function openPlex(src, t) {
    var s = src.server, uri = src.uri, h = plexHeaders(s.token);
    toast('Startar från Plex…');
    function play(key, title) {
      http('GET', uri + '/library/metadata/' + key, h, undefined, 8000, function (err, r) {
        var md = !err && r && r.MediaContainer && r.MediaContainer.Metadata && r.MediaContainer.Metadata[0];
        var part = md && md.Media && md.Media[0] && md.Media[0].Part && md.Media[0].Part[0];
        if (!part) { toast('Kunde inte starta från Plex.'); return; }
        var tk = encodeURIComponent(s.token), session = rid(12);
        var direct = uri + part.key + '?X-Plex-Token=' + tk;
        var hls = uri + '/video/:/transcode/universal/start.m3u8?path=' + encodeURIComponent('/library/metadata/' + key)
          + '&mediaIndex=0&partIndex=0&protocol=hls&fastSeek=1&directPlay=0&directStream=1&location=lan'
          + '&session=' + session + '&X-Plex-Session-Identifier=' + session + '&X-Plex-Client-Identifier=' + encodeURIComponent(clientId())
          + '&X-Plex-Product=Plex%20Web&X-Plex-Platform=Chrome&X-Plex-Token=' + tk;
        var from = md.viewOffset ? Math.floor(md.viewOffset / 1000) : 0;
        var name = title || md.title || t.title;
        if (window.IPTV && IPTV.appInstalled && IPTV.appInstalled()) {
          IPTV.launchApp({direct: {id: 'plex:' + key, title: name, urls: [direct, hls], from: from, poster: t.poster ? 'https://image.tmdb.org/t/p/w342' + t.poster : ''}}, function (ok) {
            if (!ok) here();
          });
        } else here();
        function here() { close(); IPTV.open([{label: name, ch: {u: direct, list: [direct, hls], vod: true}}], 0, name); }
      });
    }
    if (!src.show) { play(src.key, ''); return; }
    // A series: the episode after the last one watched (Plex's own "on deck"), else the first.
    http('GET', uri + '/library/metadata/' + src.key + '/allLeaves', h, undefined, 8000, function (err, r) {
      var eps = (!err && r && r.MediaContainer && r.MediaContainer.Metadata) || [];
      if (!eps.length) { toast('Hittade inga avsnitt på Plex.'); return; }
      var ep = eps[0];
      for (var i = 0; i < eps.length; i++) if (!eps[i].viewCount) { ep = eps[i]; break; }
      play(ep.ratingKey, t.title + ' · S' + ep.parentIndex + 'E' + ep.index + (ep.title ? ' · ' + ep.title : ''));
    });
  }

  // MARK: - Stremio, the trailer, the apps

  function stremio(t) {
    var app = appLike(/stremio/i);
    return app && t.imdb ? [{kind: 'stremio', label: 'Stremio', note: '', app: app}] : [];
  }

  /** Stremio at the title when it takes the link, else just Stremio. */
  function openStremio(src, t) {
    var link = 'stremio:///detail/' + (t.kind === 'tv' ? 'series' : 'movie') + '/' + t.imdb;
    toast('Öppnar Stremio på ' + t.title + '.');
    try {
      var data = [new tizen.ApplicationControlData('PAYLOAD', [link]), new tizen.ApplicationControlData('url', [link])];
      var c = new tizen.ApplicationControl('http://tizen.org/appcontrol/operation/view', link, null, null, data);
      tizen.application.launchAppControl(c, src.app.id, function () { if (TV.watch) TV.watch(src.app.id); }, function () { TV.launch(src.app.id, null, function () {}); });
    } catch (e) { TV.launch(src.app.id, null, function () {}); }
  }

  function openApp(src, t) {
    toast('Öppnar ' + src.label + (src.note === 'Hyr' || src.note === 'Köp' ? ' (att ' + src.note.toLowerCase() + 'a)' : '') + ': sök på "' + t.title + '" där.');
    TV.launch(src.app.id, null, function (ok) { if (!ok) toast('Kunde inte öppna ' + src.label + '.'); });
  }

  function run(src, t) {
    if (src.kind === 'app') openApp(src, t);
    else if (src.kind === 'iptv') openIptv(src, t);
    else if (src.kind === 'plex') openPlex(src, t);
    else if (src.kind === 'stremio') openStremio(src, t);
    else if (src.kind === 'trailer') { if (window.FreeMyTV && FreeMyTV.trailer) FreeMyTV.trailer({kind: t.kind, id: t.id, title: t.title}); }
  }

  // MARK: - A search: what was said → titles → where each one is

  var results = [], say = '', status = '', asked = '', searchSeq = 0;

  function ask(text, from) {
    text = String(text || '').trim();
    if (!text) return;
    var mine = ++searchSeq;
    asked = text; results = []; say = ''; status = claudeOn() ? 'Frågar Claude…' : 'Letar…';
    if (!isOpen()) open(); else { setField(text); draw(); }
    tellPhone({t: 'busy', q: text, say: status});
    loadApps(function () {
      if (mine !== searchSeq) return;
      if (claudeOn()) {
        askClaude(text, function (err, a) {
          if (mine !== searchSeq) return;
          if (err) { status = 'Claude: ' + err.message + '. Söker vanligt…'; draw(); plainSearch(text, got); return; }
          say = a.say;
          if (!a.items.length) { status = ''; got(null, []); return; }
          var refs = [], left = a.items.length;
          a.items.forEach(function (it, i) {
            findTitle(it, function (ref) { refs[i] = ref; if (--left === 0) got(null, refs.filter(function (r) { return r; })); });
          });
        });
      } else plainSearch(text, got);
    });
    function got(err, refs) {
      if (mine !== searchSeq) return;
      if (err) { status = 'Kunde inte söka: ' + err.message; draw(); tellPhone({t: 'res', q: asked, say: status, items: []}); return; }
      var seen = {}, uniq = [];
      for (var i = 0; i < refs.length; i++) { var k = refs[i].kind + ':' + refs[i].id; if (!seen[k]) { seen[k] = true; uniq.push(refs[i]); } }
      if (!uniq.length) { status = say ? '' : 'Hittade inget på "' + bare(text) + '".'; draw(); sendResults(); return; }
      status = 'Letar var de finns…';
      var left = uniq.length, list = [];
      uniq.forEach(function (ref, i) {
        details(ref, function (t) {
          if (mine !== searchSeq) return;
          list[i] = t;
          if (--left) return;
          results = list.filter(function (x) { return x; });
          status = '';
          for (var j = 0; j < results.length; j++) results[j].sources = streaming(results[j]);
          sel = 0; srcAt = 0; zone = results.length ? 'results' : 'field';
          draw();
          sendResults();
          more(mine);
        });
      });
    }
  }

  /** The slower places (IPTV, Plex), added to each title as they answer; Stremio and the trailer last. */
  function more(mine) {
    var left = 2;
    function step() {
      if (mine !== searchSeq || --left) return;
      for (var i = 0; i < results.length; i++) {
        var t = results[i];
        t.sources = t.sources.concat(stremio(t), [{kind: 'trailer', label: 'Trailer', note: ''}]);
      }
      draw();
      sendResults();
    }
    if (iptvLink() && xtream(iptvLink())) {
      if (!vod) { status = 'Läser filmerna i din IPTV-lista första gången…'; draw(); }
      loadVod(function () {
        if (mine !== searchSeq) return;
        if (status.indexOf('IPTV') >= 0) status = '';
        for (var i = 0; i < results.length; i++) results[i].sources = results[i].sources.concat(iptvMatches(results[i]));
        draw(); step();
      });
    } else step();
    if (plexOn()) {
      var n = results.length;
      if (!n) { step(); return; }
      results.forEach(function (t) {
        plexSearch(t, function (found) {
          if (mine !== searchSeq) return;
          t.sources = t.sources.concat(found);
          draw();
          if (--n === 0) step();
        });
      });
    } else step();
  }

  // MARK: - The sheet on the TV

  var box = null, zone = 'field', sel = 0, srcAt = 0, toolAt = 0, panel = null, opened = false;

  function isOpen() { return opened; }

  function tools() {
    return [
      {label: cfg.topic ? 'Mobilen' : 'Koppla mobilen', on: !!cfg.topic, run: showPhone},
      {label: claudeOn() ? 'Claude: på' : 'Claude: av', on: claudeOn(), run: showClaude},
      {label: plexOn() ? 'Plex: kopplad' : 'Koppla Plex', on: plexOn(), run: showPlex}
    ];
  }

  function ensure() {
    if (box) return;
    box = $('search');
    if (!box) { box = el('div', 'layer', $('stage') || document.body); box.id = 'search'; }
  }

  function open() {
    ensure();
    opened = true;
    box.className = 'layer on';
    document.body.className += ' search-on';
    if (!results.length && !status) zone = 'field';
    draw();
    loadApps(function () {});
    if (window.IPTV && iptvLink()) loadVod(function () {});   // ready by the first search
  }

  function close() {
    if (!opened) return;
    opened = false;
    panel = null;
    plexStop();
    var f = field();
    if (f) f.blur();
    box.className = 'layer';
    document.body.className = document.body.className.replace(/\s*\bsearch-on\b/g, '');
  }

  function field() { return box && box.querySelector('input.q'); }
  function setField(v) { var f = field(); if (f) f.value = v; }

  function poster(path, size) { return path ? 'https://image.tmdb.org/t/p/' + (size || 'w342') + path : ''; }

  function draw() {
    if (!box || !opened) return;
    var typed = field() ? field().value : asked, focusField = field() && document.activeElement === field();
    box.innerHTML = '';
    var sheet = el('div', 's-sheet', box);
    var top = el('div', 'top' + (zone === 'field' ? ' focus' : ''), sheet);
    el('span', 'glass-icon', top, '⌕');
    var f = el('input', 'q', top);
    f.type = 'text';
    f.setAttribute('placeholder', 'Vad vill du se? Säg eller skriv en film, en serie eller en känsla');
    f.value = typed || '';
    f.onfocus = function () { zone = 'field'; mark(); };
    el('div', 'hint', top, 'OK skriver · mikrofonen på TV-tangentbordet eller mobilen pratar');
    if (focusField) { f.focus(); }
    var line = say || status;
    el('div', 'say' + (say ? ' claude' : ''), sheet, line || (results.length ? '' : (claudeOn() ? 'Claude tolkar vad du menar: "något roligt med Adam Sandler", "serien om kocken i Chicago".' : 'Skriv titeln, eller koppla Claude för fria önskemål.')));

    var row = el('div', 'results', sheet);
    for (var i = 0; i < results.length; i++) {
      var t = results[i], c = el('div', 's-card' + (i === sel ? ' sel' : '') + (zone === 'results' && i === sel ? ' focus' : ''), row);
      var im = el('div', 'poster', c);
      if (t.poster) im.style.backgroundImage = 'url("' + poster(t.poster) + '")';
      else el('div', 'ph', im, t.title);
      el('div', 'name', c, t.title);
      el('div', 'meta', c, (t.year || '') + (t.kind === 'tv' ? ' · Serie' : ' · Film'));
      (function (i) { c.onclick = function () { sel = i; zone = 'sources'; srcAt = 0; draw(); }; })(i);
    }
    var cur = results[sel];
    var info = el('div', 'info', sheet);
    if (cur) {
      if (cur.backdrop) sheet.style.backgroundImage = 'linear-gradient(rgba(10,10,14,0.78), rgba(10,10,14,0.94)), url("' + poster(cur.backdrop, 'w1280') + '")';
      el('div', 'title', info, cur.title + (cur.year ? ' (' + cur.year + ')' : ''));
      el('div', 'over', info, cur.overview);
      var srcs = el('div', 'sources', info);
      if (!cur.sources.length) el('div', 'none', srcs, 'Letar…');
      for (var s = 0; s < cur.sources.length; s++) {
        var x = cur.sources[s], b = el('div', 'src src-' + x.kind + (zone === 'sources' && s === srcAt ? ' focus' : ''), srcs);
        el('span', 'l', b, x.label);
        if (x.note) el('span', 'n', b, x.note);
        (function (s) { b.onclick = function () { srcAt = s; zone = 'sources'; run(cur.sources[s], cur); }; })(s);
      }
    }
    var tl = el('div', 'tools', sheet), ts = tools();
    for (var k = 0; k < ts.length; k++) {
      var tb = el('div', 'tool' + (ts[k].on ? ' on' : '') + (zone === 'tools' && k === toolAt ? ' focus' : ''), tl, ts[k].label);
      (function (k) { tb.onclick = function () { toolAt = k; zone = 'tools'; tools()[k].run(); }; })(k);
    }
    el('div', 's-back', tl, 'Tillbaka stänger');
    if (panel) drawPanel(sheet);
  }

  function mark() {
    if (!box) return;
    var top = box.querySelector('.top');
    if (top) top.className = 'top' + (zone === 'field' ? ' focus' : '');
  }

  // MARK: - Panels: the phone's QR code, the Claude key, linking Plex

  function phoneUrl() { return PHONE + '#' + topic(); }

  function showPhone() { topic(); listen(); panel = {kind: 'phone'}; draw(); }
  function showClaude() { panel = {kind: 'claude', at: 0}; draw(); }
  function showPlex() {
    panel = {kind: 'plex', code: '', msg: plexOn() ? 'Kopplad till ' + cfg.plex.servers.map(function (s) { return s.name; }).join(', ') + '.' : 'Hämtar en kod…'};
    draw();
    if (plexOn()) return;
    startPlexLink();
  }
  function startPlexLink() {
    panel.msg = 'Hämtar en kod…'; panel.code = ''; draw();
    plexLink(function (code) { if (panel && panel.kind === 'plex') { panel.code = code; panel.msg = 'Gå till plex.tv/link i mobilen eller datorn och skriv in koden.'; draw(); } },
      function (err) {
        if (!panel || panel.kind !== 'plex') return;
        panel.code = '';
        panel.msg = err ? 'Plex: ' + err.message + '. OK provar igen.' : 'Klart! Kopplad till ' + cfg.plex.servers.map(function (s) { return s.name; }).join(', ') + '.';
        draw();
      });
  }

  var qrReady = false, qrWait = null;
  function withQr(done) {
    if (window.qrcode) { done(true); return; }
    if (qrWait) { qrWait.push(done); return; }
    qrWait = [done];
    var s = document.createElement('script');
    s.src = QRLIB;
    s.onload = s.onerror = function () { var w = qrWait; qrWait = null; for (var i = 0; i < w.length; i++) w[i](!!window.qrcode); };
    document.head.appendChild(s);
  }

  function drawPanel(sheet) {
    var p = el('div', 's-panel', sheet), b = el('div', 'pbox', p);
    if (panel.kind === 'phone') {
      el('div', 'ptitle', b, 'Prata via mobilen');
      var q = el('div', 'qr', b);
      withQr(function (ok) {
        if (!ok) { q.textContent = 'QR-koden gick inte att ladda.'; return; }
        try { var qr = window.qrcode(0, 'M'); qr.addData(phoneUrl()); qr.make(); q.innerHTML = qr.createSvgTag({cellSize: 7, margin: 3}); } catch (e) { q.textContent = ''; }
      });
      el('div', 'ptext', b, 'Skanna med mobilens kamera och lägg sidan på hemskärmen. Tryck på mikrofonen och säg vad du vill se: svaren visas på TV:n och i mobilen, och ett tryck i mobilen startar det här.');
      el('div', 'ptext small', b, phoneConnected ? 'Mobilen är ansluten.' : 'Free My TV behöver vara öppen på TV:n. Meddelandena går via ntfy.sh på ett hemligt ämne.');
      el('div', 'pbtn' + (panel.at === 1 ? ' focus' : ''), b, 'Ny kod (kopplar bort mobilen)');
      panel.buttons = 1;
    } else if (panel.kind === 'claude') {
      el('div', 'ptitle', b, 'Claude AI');
      el('div', 'ptext', b, claudeOn() ? 'Claude tolkar det du säger. Nyckeln ligger bara på TV:n.' : 'Skapa en API-nyckel på console.anthropic.com och skicka den hit från mobilsidan (Inställningar → Claude-nyckel), eller skriv den här.');
      var k = el('input', 's-key', b);
      k.type = 'text';
      k.setAttribute('placeholder', 'sk-ant-…');
      k.value = panel.typed || '';
      if (panel.at === 0) el('div', 'ptext small', b, 'OK skriver, OK igen sparar.');
      el('div', 'pbtn' + (panel.at === 1 ? ' focus' : ''), b, 'Spara');
      el('div', 'pbtn' + (panel.at === 2 ? ' focus' : '') + (claudeOn() ? '' : ' off'), b, 'Ta bort nyckeln');
      if (panel.at === 0) setClassOn(k, 'focus');
      panel.buttons = 2;
      if (panel.msg) el('div', 'ptext small', b, panel.msg);
    } else if (panel.kind === 'plex') {
      el('div', 'ptitle', b, 'Plex');
      if (panel.code) el('div', 'code', b, panel.code);
      el('div', 'ptext', b, panel.msg || '');
      if (plexOn()) { el('div', 'pbtn' + (panel.at === 1 ? ' focus' : ''), b, 'Koppla bort Plex'); panel.buttons = 1; }
      else panel.buttons = 0;
    }
    el('div', 'ptext small', b, 'Tillbaka stänger.');
  }
  function setClassOn(n, c) { n.className += ' ' + c; }

  function panelKey(k, K) {
    var kf = box.querySelector('.s-panel input.s-key');
    if (panel.kind === 'claude' && kf && document.activeElement === kf) {
      if (k === K.ok || k === 65376) { panel.typed = kf.value; kf.blur(); saveClaude(panel.typed); return; }
      if (k === 65385 || k === K.back || k === 27) { panel.typed = kf.value; kf.blur(); draw(); return; }
      if (k === K.up || k === K.down) { panel.typed = kf.value; kf.blur(); panel.at = 1; draw(); return; }
      return 'type';
    }
    if (k === K.back || k === 27 || k === 8) { if (panel.kind === 'plex') plexStop(); panel = null; draw(); return; }
    var max = panel.kind === 'claude' ? 2 : panel.buttons || 0, min = panel.kind === 'claude' ? 0 : (max ? 1 : 0);
    if (panel.at === undefined && panel.kind !== 'claude') {   // nothing focused until ▲ ▼: an OK can't unpair by mistake
      if ((k === K.up || k === K.down) && max) { panel.at = min; draw(); return; }
      if (k === K.ok && panel.kind === 'plex' && !plexOn() && !panel.code) startPlexLink();
      return;
    }
    if (k === K.up) { panel.at = Math.max(min, panel.at - 1); draw(); return; }
    if (k === K.down) { panel.at = Math.min(max, panel.at + 1); draw(); return; }
    if (k !== K.ok) return;
    if (panel.kind === 'claude') {
      if (panel.at === 0) { var f = box.querySelector('.s-panel input.s-key'); if (f) f.focus(); return; }
      if (panel.at === 1) { saveClaude(panel.typed || ''); return; }
      if (panel.at === 2) { cfg.claude = ''; save(); panel.msg = 'Nyckeln är borttagen.'; draw(); return; }
    } else if (panel.kind === 'phone' && panel.at === 1) {
      cfg.topic = ''; save(); topic(); listen(); phoneConnected = false; draw();
    } else if (panel.kind === 'plex') {
      if (plexOn() && panel.at === 1) { cfg.plex = null; save(); panel.msg = 'Plex är bortkopplad. OK kopplar igen.'; panel.buttons = 0; draw(); return; }
      if (!plexOn() && !panel.code) startPlexLink();
    }
  }

  function saveClaude(key, fromPhone) {
    key = String(key || '').replace(/\s+/g, '');
    if (!/^sk-ant-/.test(key)) { if (panel) { panel.msg = 'Det ser inte ut som en Claude-nyckel (den börjar med sk-ant-).'; draw(); } return; }
    if (panel) { panel.msg = 'Kollar nyckeln…'; draw(); }
    var old = cfg.claude;
    cfg.claude = key;
    askClaude('Dune', function (err) {
      if (err && /godtogs|401/.test(err.message)) { cfg.claude = old; save(); if (panel) { panel.msg = 'Claude: ' + err.message + '.'; draw(); } tellPhone({t: 'note', say: 'Claude-nyckeln godtogs inte.'}); return; }
      save();
      if (panel) { panel.msg = 'Sparad. Claude tolkar nu det du säger.'; panel.typed = ''; draw(); } else draw();
      if (fromPhone) toast('Claude är kopplad.');
      tellPhone({t: 'note', say: 'Claude-nyckeln är sparad på TV:n.'});
    });
  }

  // MARK: - Keys while the sheet is open

  var K = {left: 37, up: 38, right: 39, down: 40, ok: 13, back: 10009};
  window.addEventListener('keydown', function (e) {
    if (!opened) return;
    if (window.IPTV && IPTV.playing && IPTV.playing()) return;
    if (window.FreeMyTV && FreeMyTV.poke) FreeMyTV.poke();
    var k = e.keyCode;
    if (window.TV && TV.keys) { K.back = TV.keys.back; }
    if (panel) {
      if (panelKey(k, K) === 'type') return;
      e.preventDefault(); e.stopPropagation();
      return;
    }
    var f = field();
    if (f && document.activeElement === f) {
      if (k === K.ok || k === 65376) { e.preventDefault(); e.stopPropagation(); f.blur(); ask(f.value, 'tv'); return; }
      if (k === K.back || k === 27 || k === 65385) { e.preventDefault(); e.stopPropagation(); f.blur(); if (k !== 65385 && !f.value) close(); return; }
      if (k === K.down) { e.preventDefault(); e.stopPropagation(); f.blur(); zone = results.length ? 'results' : 'tools'; draw(); return; }
      e.stopPropagation();
      return;   // the letters type
    }
    e.preventDefault(); e.stopPropagation();
    if (k === K.back || k === 27 || k === 8) {
      if (zone === 'sources') { zone = 'results'; draw(); return; }
      close();
      return;
    }
    var cur = results[sel], n = cur ? cur.sources.length : 0, ts = tools();
    switch (zone) {
      case 'field':
        if (k === K.ok) { if (f) f.focus(); }
        else if (k === K.down) { zone = results.length ? 'results' : 'tools'; draw(); }
        return;
      case 'results':
        if (k === K.left) { sel = Math.max(0, sel - 1); srcAt = 0; }
        else if (k === K.right) { sel = Math.min(results.length - 1, sel + 1); srcAt = 0; }
        else if (k === K.up) zone = 'field';
        else if (k === K.down || k === K.ok) { zone = n ? 'sources' : 'tools'; srcAt = 0; }
        draw();
        return;
      case 'sources':
        if (k === K.left) srcAt = Math.max(0, srcAt - 1);
        else if (k === K.right) srcAt = Math.min(n - 1, srcAt + 1);
        else if (k === K.up) zone = 'results';
        else if (k === K.down) zone = 'tools';
        else if (k === K.ok && cur && cur.sources[srcAt]) { run(cur.sources[srcAt], cur); return; }
        draw();
        return;
      case 'tools':
        if (k === K.left) toolAt = Math.max(0, toolAt - 1);
        else if (k === K.right) toolAt = Math.min(ts.length - 1, toolAt + 1);
        else if (k === K.up) zone = n ? 'sources' : results.length ? 'results' : 'field';
        else if (k === K.ok) { ts[toolAt].run(); return; }
        draw();
        return;
    }
  }, true);

  // MARK: - The phone, through ntfy.sh

  var es = null, phoneConnected = false, lastId = cfg.lastId || '';

  function topic() { if (!cfg.topic) { cfg.topic = 'fmtv-' + rid(24); save(); } return cfg.topic; }

  function listen() {
    if (!cfg.topic || !window.EventSource) return;
    if (es) { try { es.close(); } catch (e) {} es = null; }
    var url = RELAY + cfg.topic + '-tv/sse' + (lastId ? '?since=' + encodeURIComponent(lastId) : '?since=2m');
    es = new EventSource(url);
    es.onmessage = function (e) {
      var m = null, o = null;
      try { m = JSON.parse(e.data); } catch (x) { return; }
      if (!m || m.event !== 'message') return;
      if (m.id) { lastId = m.id; cfg.lastId = m.id; save(); }
      var old = m.time && Date.now() / 1000 - m.time > 180;
      try { o = JSON.parse(m.message); } catch (x) { return; }
      if (o && o.t === 'part') { o = joinPart(o); if (!o) return; }
      // Left from a while ago: not acted on now. Settings sent to all the TVs are, though: ntfy keeps them 12 hours,
      // so a TV that was off gets them when Free My TV starts.
      if (old && !(o && o.t === 'setprefs')) return;
      fromPhone(o);
    };
  }

  // ntfy takes 4096 bytes a message: anything longer goes in parts ({t: 'part', id, i, n, d}), put together here.
  var parts = {};
  function joinPart(o) {
    if (!o.id || !(o.n > 0) || o.n > 20) return null;
    var p = parts[o.id] || (parts[o.id] = []);
    p[o.i] = String(o.d || '');
    for (var i = 0; i < o.n; i++) if (p[i] === undefined) return null;
    delete parts[o.id];
    try { return JSON.parse(p.join('')); } catch (e) { return null; }
  }

  function tellPhone(o) {
    if (!cfg.topic) return;
    var body = JSON.stringify(o), url = RELAY + cfg.topic + '-ph?cache=no';
    if (body.length > 3800 && o.t === 'res') body = JSON.stringify({t: o.t, q: o.q, say: o.say, items: (o.items || []).slice(0, 5)});
    if (body.length <= 3800) { http('POST', url, {}, body, 10000, function () {}); return; }
    var id = rid(8), n = Math.ceil(body.length / 3000), i = 0;
    (function next() {   // one after the other, so they arrive in order
      if (i >= n) return;
      var d = body.slice(i * 3000, (i + 1) * 3000);
      http('POST', url, {}, JSON.stringify({t: 'part', id: id, i: i++, n: n, d: d}), 10000, next);
    })();
  }

  // MARK: - The same settings on all the TVs
  //
  // The phone page keeps every TV it was paired with. "Hämta" there asks one TV for its settings (getprefs → prefs);
  // "Skicka" sends them to the others (setprefs), which take them and start again. Only what's set on the TV goes:
  // fmtv.prefs (the home screen's settings, the TMDB key, the IPTV link), the Claude key and the Plex link. The
  // favourites only go between TVs of the same kind (an app's id on a Samsung means nothing on an LG).

  var tvModel = '';
  try { TV.about(function (i) { tvModel = (i && i.model) || ''; }); } catch (e) {}

  /** What the phone calls this TV until it's given a name there. */
  function tvName() {
    var m = String(tvModel).toUpperCase();
    if (/LS0[0-9]/.test(m)) return 'The Frame';
    if (/FREESTYLE|LFF|^SP-/.test(m)) return 'Projektorn';
    var kind = TV.name === 'webos' ? 'LG' : TV.name === 'tizen' ? 'Samsung' : 'TV';
    return m ? kind + ' ' + tvModel : kind;
  }

  /** The IPTV link pasted on the phone (Inställningar → IPTV-länk): tried first, like Genvägar → IPTV-länk on the TV. */
  function saveIptvLink(link) {
    if (!/^https?:\/\/[^\s\/]+/i.test(link)) { tellPhone({t: 'note', say: 'Det ser inte ut som en IPTV-länk (den börjar med http:// eller https://).'}); return; }
    if (!window.IPTV || !IPTV.check) { tellPhone({t: 'note', say: 'IPTV-delen har inte laddats på ' + tvName() + '. Starta om Free My TV.'}); return; }
    tellPhone({t: 'note', say: 'Provar IPTV-länken på ' + tvName() + '…'});
    IPTV.check(link, function (err, n) {
      if (err) { tellPhone({t: 'note', say: 'Kunde inte läsa listan: ' + err.message + '.'}); return; }
      Prefs.set('iptv', link);
      toast('IPTV-länken är sparad. ' + n + ' kanaler.');
      tellPhone({t: 'note', say: 'IPTV-länken är sparad på ' + tvName() + '. ' + n + ' kanaler hittades.'});
    });
  }

  function savedPrefs() { try { return JSON.parse(localStorage.getItem('fmtv.prefs')) || {}; } catch (e) { return {}; } }

  function snapshot() {
    var p = savedPrefs();
    delete p.shelfConfig;
    return {v: 1, at: Date.now(), from: tvName(), platform: TV.name, prefs: p, claude: cfg.claude || '', plex: plexOn() ? cfg.plex : null};
  }

  function applyPrefs(s) {
    if (!s || s.v !== 1 || !s.prefs) return;
    if (cfg.prefsAt && s.at <= cfg.prefsAt) return;   // already taken (or older than what was)
    var mine = savedPrefs(), keys = {}, k;
    for (k in mine) if (mine.hasOwnProperty(k)) keys[k] = true;
    for (k in s.prefs) if (s.prefs.hasOwnProperty(k)) keys[k] = true;
    for (k in keys) {
      if (!keys.hasOwnProperty(k) || k === 'shelfConfig') continue;
      if (k === 'shelf' && s.platform !== TV.name) continue;   // another kind of TV: its apps' ids aren't these
      if ((k === 'tmdbKey' || k === 'iptv') && !s.prefs[k]) continue;   // none there: this TV keeps its own
      Prefs.set(k, s.prefs[k]);
    }
    if (s.claude) cfg.claude = s.claude;
    if (s.plex && s.plex.token) cfg.plex = s.plex;
    cfg.prefsAt = s.at;
    save();
    tellPhone({t: 'note', say: 'Inställningarna från ' + (s.from || 'den andra TV:n') + ' är sparade på ' + tvName() + '.', tv: tvName(), saved: s.at});
    toast('Inställningar från ' + (s.from || 'mobilen') + '. Startar om…');
    setTimeout(function () { try { location.reload(); } catch (e) {} }, 1800);
  }

  function sendResults() {
    tellPhone({t: 'res', q: asked, say: say || status, items: results.map(function (t) {
      return {n: t.title, y: t.year, k: t.kind, p: t.poster, s: t.sources.map(function (s) { return s.label + (s.note ? ' · ' + s.note : ''); })};
    })});
  }

  function fromPhone(o) {
    if (!o || !o.t) return;
    phoneConnected = true;
    if (window.FreeMyTV && FreeMyTV.poke) FreeMyTV.poke();
    if (o.t === 'hello') { tellPhone({t: 'note', say: 'Ansluten till ' + tvName() + '.', claude: claudeOn(), plex: plexOn(), tv: tvName(), platform: TV.name}); if (opened && panel && panel.kind === 'phone') draw(); return; }
    if (o.t === 'getprefs') { tellPhone({t: 'prefs', tv: tvName(), s: snapshot()}); return; }
    if (o.t === 'setprefs') { applyPrefs(o.s); return; }
    if (o.t === 'ask') { ask(o.q, 'phone'); return; }
    if (o.t === 'open') {
      var t = results[o.r], s = t && t.sources[o.s];
      if (s) { if (!opened) open(); sel = o.r; srcAt = o.s; zone = 'sources'; draw(); run(s, t); }
      return;
    }
    if (o.t === 'key' && o.claude) { saveClaude(o.claude, true); return; }
    if (o.t === 'iptv') { saveIptvLink(String(o.link || '').replace(/\s+/g, '')); return; }
    if (o.t === 'games' && /^https:\/\/script\.google\.com\/.+/.test(o.url || '')) {   // for the Spel app (games/), given to it when it's opened
      try { localStorage.setItem('fmtv.games', o.url); } catch (e) {}
      toast('Spel-appen får din Google Drive-mapp när du öppnar den härifrån.');
      tellPhone({t: 'note', say: 'Spellänken är sparad på TV:n. Öppna Spel från Free My TV.'});
      return;
    }
    if (o.t === 'close') { close(); return; }
  }

  document.addEventListener('visibilitychange', function () { if (!document.hidden) listen(); });
  listen();

  return {
    open: open, close: close, isOpen: isOpen, ask: ask,
    // For the browser preview and tests.
    _cfg: cfg, _fromPhone: fromPhone, _relay: function (r) { RELAY = r; listen(); }, _norm: norm, _bare: bare, _results: function () { return results; }
  };
})();
