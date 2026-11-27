/*
 * O.R.T.I. – Ortiz's Responsive Tactical Intelligence: rösten i kontrollrummet på jobbets TV. Läser upp korta svenska
 * meddelanden ur det som redan finns (klockan, vädret, trafiken hem, Barças matcher, nedräkningen, systemet, appar som
 * öppnas) och svarar på frågor från mobilen (koppla.js, Prata med O.R.T.I.).
 *
 *   röst      Appen (android/OrtiVoice.java, version 1.5.0+): Androids talsyntes eller Microsoft Azure (Mattias), som en
 *             ljudfil med ljudstyrkan var 20:e ms. Utan den appen: ingen röst, svaren går bara som text till mobilen.
 *   regler    En sak i taget i en kö; tysta timmar; tyst när media spelas eller en annan app syns; samma meddelande
 *             inte igen förrän dess paus har gått (sparas i localStorage, så också efter en omstart).
 *   bild      Medan han talar: vågformen runt klockan, ringarna (holo.js) pulserar med ljudet, ett svagt ljus i
 *             mitten, texten under klockan och statusen O.R.T.I. :: TALAR uppe i mitten.
 *
 * Bara riktiga värden: saknas något sägs inget om det. Inställningar under Hemskärm → O.R.T.I. ES5.
 */
var Orti = (function () {
  'use strict';

  var NAME = 'O.R.T.I.', STORE = 'fmtv.orti';
  var A = window.FMTVAndroid && typeof FMTVAndroid.ortiSpeak === 'function' ? FMTVAndroid : null;
  var C = (window.CONFIG && CONFIG.orti) || {};
  var DAYS = ['söndag', 'måndag', 'tisdag', 'onsdag', 'torsdag', 'fredag', 'lördag'];
  var MONTHS = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'];
  var AZURE_VOICES = [['sv-SE-MattiasNeural', 'Mattias (Azure)'], ['sv-SE-SofieNeural', 'Sofie (Azure)']];
  var QUIET = ['off', '22-07', '19-07', '17-08'];

  var mem = {};
  try { mem = JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) { mem = {}; }
  function remember(k) { mem[k] = Date.now(); try { localStorage.setItem(STORE, JSON.stringify(mem)); } catch (e) {} }
  function since(k) { return mem[k] ? Date.now() - mem[k] : Infinity; }

  // MARK: - Inställningar (Prefs, kontor/data.js)

  function pref(k, d) {
    if (typeof Prefs === 'undefined' || !Prefs.orti) return d;
    return Prefs.orti(k, d);
  }
  function on() { return pref('on', true) !== false; }
  function engine() { return pref('engine', 'android') === 'azure' && azureKey() ? 'azure' : 'android'; }
  function azureKey() { return String(pref('azureKey', '') || '').trim(); }
  function quiet() { var q = pref('quiet', '19-07'); return QUIET.indexOf(q) >= 0 ? q : '19-07'; }
  function inQuiet(d) {
    var q = quiet();
    if (q === 'off') return false;
    var a = +q.split('-')[0], b = +q.split('-')[1], h = (d || new Date()).getHours();
    return a > b ? h >= a || h < b : h >= a && h < b;
  }

  // MARK: - Hjälp

  function two(n) { return (n < 10 ? '0' : '') + n; }
  function hm(ms) { var d = new Date(ms); return d.getHours() + ':' + two(d.getMinutes()); }
  function el(tag, cls, parent, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  function setClass(e, c, yes) {
    if (!e) return;
    var has = (' ' + e.className + ' ').indexOf(' ' + c + ' ') >= 0;
    if (yes && !has) e.className = (e.className + ' ' + c).replace(/^\s+/, '');
    else if (!yes && has) e.className = (' ' + e.className + ' ').replace(' ' + c + ' ', ' ').replace(/^\s+|\s+$/g, '');
  }
  function pick(list, seed) { return list[Math.abs(seed || 0) % list.length]; }
  function daySeed() { var d = new Date(); return d.getDate() + d.getMonth() * 31; }
  function name() { return C.name || 'Yuri'; }
  function minutes(n) { return n === 1 ? 'en minut' : n + ' minuter'; }
  function grader(t) { var r = Math.round(t); return (r < 0 ? 'minus ' : '') + Math.abs(r) + (Math.abs(r) === 1 ? ' grad' : ' grader'); }

  /** Texten som den ska låta: lagen "mot" i stället för tankstrecket, Barça som det uttalas, förkortningar utskrivna. */
  function spoken(s) {
    return String(s).replace(/\s+[–-]\s+/g, ' mot ').replace(/Barça/g, 'Barsa').replace(/O\.R\.T\.I\./g, 'Orti')
      .replace(/(\d)°/g, '$1 grader').replace(/\bmin\b/g, 'minuter');
  }
  function xml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  // MARK: - Data (bara det som redan finns)

  function weather() { return typeof Data !== 'undefined' && Data.weather && !isNaN(Data.weather.temp) ? Data.weather : null; }
  function condition(w) { return typeof Data !== 'undefined' && Data.condition ? String(Data.condition(w.code, w.isDay)).toLowerCase() : ''; }
  function wet(code) { return (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95 ? 'regn' : (code >= 71 && code <= 77) || code === 85 || code === 86 ? 'snö' : ''; }
  function traffic() { return window.Trafik && Trafik.state ? Trafik.state() : null; }
  function trafficCfg() { return (window.CONFIG && CONFIG.traffic) || null; }
  function nextMatch() { return window.BarcaBox && BarcaBox.next ? BarcaBox.next() : null; }
  function live() { return window.BarcaBox && BarcaBox.liveState ? BarcaBox.liveState() : null; }
  function rival(title) {
    var t = String(title || '').split(/\s+[–-]\s+/);
    if (t.length !== 2) return title;
    return /barcelona|barça/i.test(t[0]) ? t[1] : t[0];
  }
  function countdown() { return window.Festive && Festive.countdown ? Festive.countdown() : ''; }
  function mediaPlaying() { return !!(window.IPTV && IPTV.playing && IPTV.playing()); }

  // MARK: - Meddelandena

  function greetingWord(h) { return h < 5 ? 'God natt' : h < 10 ? 'God morgon' : h < 13 ? 'Hej' : h < 18 ? 'God eftermiddag' : 'God kväll'; }

  function weatherLine(short) {
    var w = weather();
    if (!w) return '';
    var s = grader(w.temp) + (condition(w) ? ' och ' + condition(w) : '') + (short ? '' : ' i ' + ((typeof Prefs !== 'undefined' && Prefs.city && Prefs.city()) || 'Uppsala'));
    if (!short && !isNaN(w.max) && !isNaN(w.min)) s += '. I dag mellan ' + (Math.round(w.min) < 0 ? 'minus ' : '') + Math.abs(Math.round(w.min)) + ' och ' + grader(w.max);
    var soon = wetSoon(w);
    if (soon) s += '. ' + soon;
    return s + '.';
  }

  /** Regn eller snö de närmaste tre timmarna, när det inte redan faller: "Regn väntas omkring 15." */
  function wetSoon(w) {
    if (!w || !w.hours || wet(w.code)) return '';
    for (var i = 0; i < w.hours.length && i < 3; i++) {
      var k = wet(w.hours[i].code);
      if (k) return (k === 'regn' ? 'Regn' : 'Snö') + ' väntas omkring ' + new Date(w.hours[i].at).getHours() + '.';
    }
    return '';
  }

  function trafficLine() {
    var t = traffic();
    if (!t) return '';
    var lab = (trafficCfg() && trafficCfg().label) || 'hem';
    var s = 'Resan ' + lab + ' tar ' + minutes(t.min) + ' just nu';
    if (t.delay >= 2) s += ', varav ' + minutes(t.delay) + ' i kö';
    return s + '. Åker du nu är du framme ' + t.arrive + '.';
  }

  function matchLine() {
    var ls = live(), m = nextMatch();
    if (ls && (ls.state === 'in' || ls.state === 'post')) {
      return (ls.state === 'in' ? 'Matchen pågår. ' : 'Matchen är slut. ') + ls.home.name + ' ' + ls.home.score + ', ' + ls.away.name + ' ' + ls.away.score + '.';
    }
    if (!m) return 'Ingen Barça-match de närmaste två veckorna.';
    var d = new Date(m.start), today = new Date(), days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000);
    var when = days === 0 ? 'i dag klockan ' + hm(m.start) : days === 1 ? 'i morgon klockan ' + hm(m.start) : DAYS[d.getDay()] + ' den ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' klockan ' + hm(m.start);
    return 'Nästa match: Barça mot ' + rival(m.title) + ' ' + when + (m.competition ? ' i ' + m.competition : '') + '.';
  }

  function countdownLine() {
    var c = countdown();
    return c ? c.charAt(0).toUpperCase() + c.slice(1) + '.' : '';
  }

  function statusLine() {
    var parts = [];
    var ok = [], miss = [];
    (weather() ? ok : miss).push('vädret');
    if (window.Trafik) (traffic() ? ok : miss).push('trafiken');
    if (window.BarcaBox) (nextMatch() || live() ? ok : miss).push('Barça');
    parts.push(miss.length ? 'Allt fungerar utom ' + miss.join(' och ') + '.' : 'Alla system fungerar.');
    if (window.FMTV_LOADER) parts.push('Version ' + FMTV_LOADER.version + '.');
    var up = Math.floor((Date.now() - startedAt) / 60000);
    parts.push('Upptid ' + (up >= 60 ? Math.floor(up / 60) + ' timmar och ' : '') + minutes(up % 60) + '.');
    parts.push('Röst: ' + (A ? (engine() === 'azure' ? 'Azure' : 'Android') : 'saknas, appen behöver version 1.5') + '.');
    return parts.join(' ');
  }

  function timeLine() {
    var d = new Date();
    return 'Klockan är ' + hm(d.getTime()) + '. Det är ' + DAYS[d.getDay()] + ' den ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + '.';
  }

  /** Hälsningen: tiden på dygnet, vädret, och det viktigaste i dag (match, resan hem på eftermiddagen). */
  function greeting() {
    var h = new Date().getHours(), out = [greetingWord(h) + ', ' + name() + '.'];
    if (pref('weather', true) !== false) { var w = weatherLine(true); if (w) out.push(w.charAt(0).toUpperCase() + w.slice(1)); }
    var m = window.BarcaBox && BarcaBox.matchToday ? BarcaBox.matchToday() : null;
    if (m && pref('match', true) !== false) out.push('Barça spelar mot ' + rival(m.title) + ' i dag klockan ' + hm(m.start) + '.');
    if (h >= 14 && pref('traffic', true) !== false) { var t = trafficLine(); if (t) out.push(t); }
    return out.join(' ');
  }

  // MARK: - Kö och regler

  var queue = [], current = null, seq = 0, startedAt = Date.now(), status = 'redo', lastError = '';

  /**
   * Säger något. opt: key (samma inte igen inom gap ms), gap, prio (högre först), auto (följer tysta timmar och media),
   * reply (fn(text) till mobilen), force (också med rösten av: bara text).
   */
  function say(text, opt) {
    opt = opt || {};
    if (!text) return false;
    if (opt.key && since(opt.key) < (opt.gap || 3600000)) return false;
    if (opt.reply) opt.reply(text);
    if (!on()) return false;
    if (opt.auto && (inQuiet() || document.hidden)) return false;
    if (pref('media', true) !== false && (mediaPlaying() || (document.hidden && !opt.reply))) return false;
    if (opt.key) remember(opt.key);
    queue.push({id: 'o' + (++seq), text: text, prio: opt.prio || 0});
    queue.sort(function (a, b) { return b.prio - a.prio; });
    if (queue.length > 4) queue.length = 4;   // det som inte hann sägas är inte aktuellt längre
    pump();
    return true;
  }

  function pump() {
    if (current || !queue.length) return;
    current = queue.shift();
    current.at = Date.now();
    caption(current.text);
    setStatus('talar');
    if (sim) { simulate(current); return; }
    if (!A) { done(current.id, 'Ingen röst: jobbappen behöver version 1.5.0.'); return; }
    var e = engine(), o = {id: current.id, engine: e, volume: +pref('volume', 0.9), rate: +pref('rate', 0.95), pitch: 0.9};
    if (e === 'azure') {
      var voice = pref('azureVoice', AZURE_VOICES[0][0]), rate = Math.round((o.rate - 1) * 100);
      o.key = azureKey();
      o.region = pref('azureRegion', 'swedencentral');
      o.ssml = '<speak version="1.0" xml:lang="sv-SE"><voice name="' + voice + '"><prosody rate="' + (rate >= 0 ? '+' : '') + rate + '%" pitch="-3%">' + xml(spoken(current.text)) + '</prosody></voice></speak>';
    } else {
      o.text = spoken(current.text);
      o.voice = pref('voice', '');
    }
    try { A.ortiSpeak(JSON.stringify(o)); } catch (x) { done(current.id, 'Bryggan svarade inte.'); return; }
    // Kommer inget svar alls (talsyntesen hänger): vidare efter en stund.
    var mine = current.id;
    setTimeout(function () { if (current && current.id === mine && !current.started) done(mine, 'Rösten svarade inte i tid.'); }, 15000);
  }

  function done(id, err) {
    if (!current || current.id !== id) return;
    if (err) {
      lastError = err;
      if (window.FreeMyTV && FreeMyTV.toast) FreeMyTV.toast(NAME + ': ' + err);
      // Azure ville inte (fel nyckel, slut på kvoten): Androids röst så länge, och det sägs en gång.
      if (current.id.indexOf('test') !== 0 && current.engineTried !== 'android' && engine() === 'azure' && /Azure/.test(err)) {
        current.engineTried = 'android';
        Prefs.set('orti.engine', 'android');
        var again = current;
        current = null;
        queue.unshift(again);
        say('Azure-rösten svarar inte. Jag använder Androids röst så länge.', {key: 'azure-fallback', gap: 3 * 3600000, prio: 5});
        return;
      }
    }
    current = null;
    Visual.stop();
    setStatus(err ? 'fel' : 'redo');
    setTimeout(pump, 500);
  }

  /** Händelser från appen (OrtiVoice.java): start med längd och ljudkurva, slut, fel. */
  function fromNative(o) {
    if (!o || !current || o.id !== current.id) return;
    if (o.ev === 'start') { current.started = true; Visual.start(o.env || [], o.dur || 0); }
    else if (o.ev === 'end') done(o.id);
    else if (o.ev === 'error') done(o.id, o.msg || 'Okänt fel.');
  }

  function stop() {
    queue = [];
    if (A) { try { A.ortiStop(); } catch (e) {} }
    if (current) { var id = current.id; done(id); }
  }

  // Förhandsvisning i en webbläsare (tester): ingen röst, men samma bild, med en ljudkurva ur texten.
  var sim = false;
  function simulate(item) {
    var env = [], s = item.text;
    for (var i = 0; i < s.length * 3; i++) {
      var ch = s.charAt(Math.floor(i / 3)), vowel = /[aeiouyåäö]/i.test(ch), gap = /[ .,]/.test(ch);
      env.push(gap ? 0.08 : vowel ? 0.7 + 0.3 * Math.sin(i) : 0.35 + 0.2 * Math.cos(i * 1.7));
    }
    item.started = true;
    Visual.start(env, env.length * 20);
    setTimeout(function () { done(item.id); }, env.length * 20);
  }

  // MARK: - Det O.R.T.I. säger av sig själv (var 30:e sekund, och när någon kommer tillbaka till TV:n)

  function ymd() { var d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }

  function tick() {
    if (!on()) return;
    var now = new Date(), h = now.getHours(), wd = now.getDay();

    // Barça: en timme och tio minuter före avspark, mål, slutresultat.
    if (pref('match', true) !== false) {
      var m = nextMatch(), ls = live();
      if (m && !ls) {
        var left = (m.start - now.getTime()) / 60000;
        if (left > 50 && left <= 62) say('Barça möter ' + rival(m.title) + ' om en timme, klockan ' + hm(m.start) + '.', {key: 'm60-' + m.start, gap: 7200000, auto: true, prio: 3});
        if (left > 0 && left <= 11) say('Avspark om tio minuter. Barça mot ' + rival(m.title) + '.', {key: 'm10-' + m.start, gap: 7200000, auto: true, prio: 3});
      }
      if (ls && ls.state === 'in') {
        var us = ls.home.barca ? ls.home : ls.away, them = ls.home.barca ? ls.away : ls.home;
        var scoreKey = 'goal-' + ls.start + '-' + us.score;
        if (us.score > 0 && Date.now() < ls.goalUntil) say('Mål för Barça! ' + us.score + ' mot ' + them.score + '.', {key: scoreKey, gap: 6 * 3600000, prio: 6});
      }
      if (ls && ls.state === 'post') {
        var u2 = ls.home.barca ? ls.home : ls.away, t2 = ls.home.barca ? ls.away : ls.home;
        var res = u2.score > t2.score ? 'Barça vann' : u2.score < t2.score ? 'Barça förlorade' : 'Det blev oavgjort';
        say('Slutresultat: ' + res + ', ' + u2.score + ' mot ' + t2.score + ' mot ' + t2.name + '.', {key: 'end-' + ls.start, gap: 12 * 3600000, auto: true, prio: 3});
      }
    }

    // Trafiken hem, vardagar på eftermiddagen: en gång kvart i fyra, och när det blir rött.
    var tc = trafficCfg(), t = traffic();
    if (pref('traffic', true) !== false && tc && t && (!tc.days || tc.days.indexOf(wd) >= 0)) {
      if (h * 60 + now.getMinutes() >= 15 * 60 + 45 && h < 18) say(trafficLine(), {key: 'traffic-' + ymd(), gap: 12 * 3600000, auto: true, prio: 2});
      if (h >= 14 && h < 18 && t.level === 'red' && lastLevel !== 'red') say('Det har blivit kö på vägen ' + (tc.label || 'hem') + '. Räkna med ' + minutes(t.min) + ', ' + t.delay + ' mer än vanligt.', {key: 'traffic-red', gap: 1800000, auto: true, prio: 2});
      lastLevel = t.level;
    }
    // Trafiktjänsten svarar inte (nyckeln finns, inom trafiktiderna): en gång på två timmar.
    if (tc && window.Trafik && typeof Prefs !== 'undefined' && Prefs.tomtomKey && Prefs.tomtomKey() && !t && Date.now() - startedAt > 10 * 60000
      && tc.hours && h >= tc.hours[0] && h < tc.hours[1]) say('Jag når inte trafiktjänsten just nu.', {key: 'err-traffic', gap: 7200000, auto: true, prio: 1});

    // Vädret: regn eller snö på väg (en gång på tre timmar), och väderdata som saknas.
    if (pref('weather', true) !== false) {
      var w = weather(), soon = wetSoon(w);
      if (soon) say(soon, {key: 'wet-' + soon, gap: 3 * 3600000, auto: true, prio: 1});
      if (!w && Date.now() - startedAt > 30 * 60000) say('Väderdata saknas just nu.', {key: 'err-weather', gap: 3 * 3600000, auto: true, prio: 1});
    }

    // Ny version av hemskärmen (efter en omstart): en gång per version.
    if (window.FMTV_LOADER && FMTV_LOADER.commit && mem.commit !== FMTV_LOADER.commit) {
      var first = !mem.commit;
      mem.commit = FMTV_LOADER.commit;
      remember('commit-at');
      if (!first) say('Systemet är uppdaterat.', {key: 'update-' + FMTV_LOADER.commit, gap: 86400000, auto: true, prio: 1});
    }
  }
  var lastLevel = '';

  /** Någon tar fjärrkontrollen efter en stund (eller appen startar): hälsningen, högst var tredje timme, 05–22. */
  var lastKeyAt = 0;
  function woke() {
    var h = new Date().getHours();
    if (pref('greet', true) === false || h < 5 || h >= 22) return;
    say(greeting(), {key: 'greet', gap: 3 * 3600000, auto: true, prio: 4});
  }
  window.addEventListener('keydown', function () {
    var idle = Date.now() - lastKeyAt;
    lastKeyAt = Date.now();
    if (idle > 30 * 60000) setTimeout(woke, 1500);
  }, true);

  // MARK: - Frågor från mobilen

  /** En fråga (svenska, fritt formulerad): svaret sägs och går tillbaka som text till reply. */
  function ask(q, reply) {
    // Bara ord, med mellanslag runt: has('väder') hittar "vädret" och "väder" men inte "oväder"-delar mitt i ord.
    // (JavaScripts \b räknar inte å, ä och ö som bokstäver, därför inte reguljära ordgränser.)
    var raw = String(q || '').toLowerCase().replace(/^\s*(hej|hallå)?\s*(orti|o\.r\.t\.i\.?)[\s,!.]*/, '').trim();
    var s = ' ' + raw.replace(/[^a-z0-9åäöéüç]+/g, ' ').trim() + ' ';
    function has(words) { for (var i = 0; i < words.length; i++) if (s.indexOf(' ' + words[i]) >= 0) return true; return false; }
    var r = function (text) { say(text, {reply: reply, prio: 5}); };
    if (!current) setStatus('lyssnar');
    if (!raw || /^(hej|hallå|tjena|god (morgon|dag|kväll|eftermiddag))[\s!.,]*$/.test(raw)) return r(greeting());
    if (has(['tyst', 'sluta', 'stopp', 'stop ', 'avbryt'])) { stop(); if (reply) reply('Okej.'); return; }
    var open = /(^|\s)(öppna|starta|visa)\s+(.+)$/.exec(raw);
    if (open) return openApp(open[3].replace(/[.!?]+$/, ''), r);
    if (has(['vad kan du', 'hjälp', 'kommando'])) return r('Fråga mig om tid, väder, trafiken hem, Barça, premiärer eller status. Jag kan också öppna appar.');
    if (has(['trafik', 'restid', 'resan', 'hem', 'kö ', 'köer', 'åka', 'åker'])) return r(trafficLine() || 'Jag har ingen trafikinformation just nu.');
    if (has(['klocka', 'tid ', 'tiden', 'datum', 'vilken dag', 'vecka'])) return r(timeLine());
    if (has(['väder', 'vädr', 'temperatur', 'grader', 'regn', 'snö', 'kallt', 'varmt', 'ute '])) { var w = weatherLine(false); return r(w ? w.charAt(0).toUpperCase() + w.slice(1) : 'Jag har inget väder just nu.'); }
    if (has(['barça', 'barca', 'barsa', 'match', 'fotboll', 'avspark', 'ställning', 'resultat'])) return r(matchLine());
    if (has(['premiär', 'film', 'bio ', 'nedräkning', 'dagar kvar'])) return r(countdownLine() || 'Ingen nedräkning just nu.');
    if (has(['status', 'system', 'hur mår du', 'fungerar'])) return r(statusLine());
    r('Det kan jag inte svara på än. Fråga om tid, väder, trafik, Barça, premiärer eller status.');
  }

  function openApp(what, r) {
    if (!window.TV || !TV.apps) return r('Jag kan inte öppna appar just nu.');
    TV.apps(function (list) {
      var best = null, w = what.toLowerCase();
      for (var i = 0; list && i < list.length; i++) {
        var t = String(list[i].title || '').toLowerCase();
        if (t === w) { best = list[i]; break; }
        if (!best && (t.indexOf(w) >= 0 || w.indexOf(t) >= 0)) best = list[i];
      }
      if (!best) { r('Jag hittar ingen app som heter ' + what + '.'); return; }
      r('Öppnar ' + best.title + '.');
      setTimeout(function () { TV.launch(best.id, null, function () {}); }, 900);
    });
  }

  /** Hemskärmen öppnar en app (home.js): en kort bekräftelse. */
  function opening(title) {
    if (pref('confirm', true) === false || !title) return;
    say('Öppnar ' + title + '.', {key: 'open-' + title, gap: 20000, prio: 1});
  }

  // MARK: - Bild: vågformen, ringarna, ljuset, texten och statusen

  var root = null, canvas = null, g = null, cap = null, tag = null, glow = null;

  function build() {
    if (root) return;
    var stage = document.getElementById('stage') || document.body;
    root = el('div', '', stage);
    root.id = 'orti';
    glow = el('div', 'orti-glow', root);
    canvas = el('canvas', 'orti-wave', root);
    canvas.width = canvas.height = 720;
    g = canvas.getContext('2d');
    cap = el('div', 'orti-cap', root);
    tag = el('div', 'orti-tag', root);
    el('span', 'dot', tag);
    el('span', 'name', tag, NAME);
    el('span', 'state', tag);
    setStatus(status);
  }

  function setStatus(s) {
    status = s;
    if (!tag) return;
    var text = !on() ? 'AV' : !A && !sim ? 'BEHÖVER APP 1.5' : s === 'talar' ? 'TALAR' : s === 'lyssnar' ? 'LYSSNAR' : s === 'fel' ? 'FEL' : 'REDO';
    tag.lastChild.textContent = '  ::  ' + text;
    tag.className = 'orti-tag ' + (on() ? s : 'av');
    if (s === 'fel') setTimeout(function () { if (status === 'fel') setStatus('redo'); }, 8000);
  }

  var capTimer = 0;
  function caption(text) {
    if (!cap) return;
    clearTimeout(capTimer);
    cap.textContent = text;
    setClass(cap, 'on', true);
  }

  /** Mitten att rita runt: klockan när den syns, annars skärmens mitt (skärmsläckaren). */
  function center() {
    var c = document.getElementById('clock'), s = document.getElementById('stage');
    var saver = document.querySelector('#hud.on, #saver.on, #ambient.on');
    if (c && s && c.offsetWidth && !saver) {
      var r = c.getBoundingClientRect(), q = s.getBoundingClientRect(), k = q.width / 1920;
      if (r.width) return [(r.left + r.width / 2 - q.left) / k, (r.top + r.height / 2 - q.top) / k];
    }
    return [960, 470];
  }

  var Visual = (function () {
    var env = [], t0 = 0, dur = 0, raf = 0, level = 0, rings = [], fade = 0;

    function start(e, d) {
      build();
      env = e && e.length ? e : [0.6];
      t0 = Date.now();
      dur = d || env.length * 20;
      fade = 1;
      var c = center();
      canvas.style.left = (c[0] - 360) + 'px';
      canvas.style.top = (c[1] - 360) + 'px';
      glow.style.left = (c[0] - 300) + 'px';
      glow.style.top = (c[1] - 300) + 'px';
      cap.style.top = (c[1] + 262) + 'px';
      rings = document.querySelectorAll('.holo-ring, #hudbg canvas');
      setClass(document.body, 'orti-talk', true);
      if (!raf) raf = requestAnimationFrame(frame);
    }

    function stop() {
      env = [];
      setClass(document.body, 'orti-talk', false);
      capTimer = setTimeout(function () { setClass(cap, 'on', false); }, 2500);
    }

    var last = 0;
    function frame(now) {
      raf = 0;
      if (now - last < 32) { raf = requestAnimationFrame(frame); return; }   // 30 bilder/s räcker
      last = now;
      var t = Date.now() - t0, i = Math.floor(t / 20), a = env.length ? (env[Math.min(i, env.length - 1)] || 0) : 0;
      if (!env.length) fade = Math.max(0, fade - 0.08);
      level += (a - level) * 0.45;
      var lv = level * fade;
      g.clearRect(0, 0, 720, 720);
      // Vågformen: 96 staplar runt klockan; varje stapel läser kurvan lite bakåt, så att det rör sig som ljud.
      var n = 96, r0 = 236;
      g.lineCap = 'round';
      for (var k = 0; k < n; k++) {
        var back = env.length ? env[Math.max(0, Math.min(env.length - 1, i - (k % 12)))] || 0 : 0;
        var len = 4 + (0.35 * lv + 0.65 * back * fade) * (22 + 26 * Math.abs(Math.sin(k * 0.7 + t / 400)));
        var ang = (k / n) * Math.PI * 2 - Math.PI / 2, ca = Math.cos(ang), sa = Math.sin(ang);
        g.strokeStyle = 'rgba(223, 251, 255, ' + (0.35 + 0.65 * lv).toFixed(2) + ')';
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(360 + ca * r0, 360 + sa * r0);
        g.lineTo(360 + ca * (r0 + len), 360 + sa * (r0 + len));
        g.stroke();
      }
      // Ringen som pulserar med rösten.
      g.beginPath();
      g.arc(360, 360, r0 - 12, 0, Math.PI * 2);
      g.lineWidth = 1.5 + 5 * lv;
      g.strokeStyle = 'rgba(95, 230, 235, ' + (0.2 + 0.6 * lv).toFixed(2) + ')';
      g.stroke();
      glow.style.opacity = (0.15 + 0.6 * lv).toFixed(2);
      for (var j = 0; j < rings.length; j++) rings[j].style.opacity = env.length ? (0.65 + 0.35 * lv).toFixed(2) : '';
      if (env.length || fade > 0) raf = requestAnimationFrame(frame);
      else { g.clearRect(0, 0, 720, 720); glow.style.opacity = '0'; }
    }

    return {start: start, stop: stop};
  })();

  // MARK: - Röster (Hemskärm → Röst)

  var voiceList = null;
  function voices() {
    if (voiceList) return voiceList;
    if (!A || !A.ortiVoices) return [];
    try {
      var o = JSON.parse(A.ortiVoices());
      if (o.ready) {
        voiceList = (o.voices || []).filter(function (v) { return v.installed || v.network; });
        voiceList.sort(function (a, b) { return b.quality - a.quality; });
        return voiceList;
      }
    } catch (e) {}
    return [];
  }
  function voiceName(v) {
    // Googles namn, t.ex. sv-se-x-lfs-local / sv-SE-language: kortare på skärmen.
    var m = /sv-se-x-([a-z]+)-(local|network)/i.exec(v);
    return m ? 'Google ' + m[1].toUpperCase() + (m[2] === 'network' ? ' (nät)' : '') : v;
  }

  /** Raderna under Hemskärm (home.js lägger in dem). */
  function settingRows(cycle, openKoppla) {
    var rows = [], dim = !on();
    rows.push({label: NAME + ' röst', toggle: on(), step: function () { Prefs.set('orti.on', !on()); setStatus('redo'); if (!on()) stop(); }});
    var eng = engine();
    rows.push({label: 'Röstmotor', value: eng === 'azure' ? 'Azure' : 'Android', dim: dim,
      step: function (d) { if (!azureKey()) { if (window.FreeMyTV && FreeMyTV.toast) FreeMyTV.toast('Lägg in Azure-nyckeln från mobilen först.'); return; } cycle('orti.engine', ['android', 'azure'], eng, d); }});
    if (eng === 'azure') {
      var av = pref('azureVoice', AZURE_VOICES[0][0]), names = AZURE_VOICES.map(function (x) { return x[0]; });
      rows.push({label: 'Röst', value: (AZURE_VOICES[names.indexOf(av)] || AZURE_VOICES[0])[1], dim: dim, step: function (d) { cycle('orti.azureVoice', names, av, d); }});
    } else {
      var list = voices(), cur = pref('voice', ''), ids = [''].concat(list.map(function (x) { return x.name; }));
      rows.push({label: 'Röst', value: cur ? voiceName(cur) : 'Standard (svenska)', dim: dim, step: function (d) { cycle('orti.voice', ids, cur, d); }});
    }
    var rate = +pref('rate', 0.95), rates = [0.85, 0.9, 0.95, 1, 1.08];
    rows.push({label: 'Talhastighet', value: Math.round(rate * 100) + ' %', dim: dim, step: function (d) { cycle('orti.rate', rates, rate, d); }});
    var vol = +pref('volume', 0.9), vols = [0.4, 0.55, 0.7, 0.8, 0.9, 1];
    rows.push({label: 'Röstvolym', value: Math.round(vol * 100) + ' %', dim: dim, step: function (d) { cycle('orti.volume', vols, vol, d); }});
    rows.push({label: 'Testa rösten', value: '›', dim: dim, step: function (d) { if (d >= 0) say(greetingWord(new Date().getHours()) + ', ' + name() + '. Det här är ' + NAME + '. Alla system fungerar.', {prio: 9}); }});
    var flag = function (label, k) {
      rows.push({label: label, toggle: pref(k, true) !== false, dim: dim, step: function () { Prefs.set('orti.' + k, pref(k, true) === false); }});
    };
    flag('Hälsningar', 'greet');
    flag('Matchpåminnelser', 'match');
    flag('Trafikmeddelanden', 'traffic');
    flag('Vädermeddelanden', 'weather');
    flag('Bekräftelser (appar)', 'confirm');
    flag('Tyst när media spelas', 'media');
    var q = quiet(), qn = {off: 'Av', '22-07': '22–07', '19-07': '19–07', '17-08': '17–08'};
    rows.push({label: 'Tysta timmar', value: qn[q], dim: dim, step: function (d) { cycle('orti.quiet', QUIET, q, d); }});
    var k = azureKey();
    rows.push({label: 'Azure-nyckel', value: k ? '•••• ' + k.slice(-4) : 'Från mobilen', dim: dim,
      step: function (d) { if (d >= 0 && openKoppla) openKoppla(); }});
    return rows;
  }

  /** En Azure-nyckel från mobilen: provas med en kort mening; sparas och blir röstmotor om Azure svarar. */
  function tryAzure(key, region, reply) {
    if (!A) { reply('Jobbappen behöver version 1.5.0 för rösten.', true); return; }
    var oldKey = azureKey(), oldEngine = pref('engine', 'android'), oldRegion = pref('azureRegion', 'swedencentral');
    Prefs.set('orti.azureKey', key);
    Prefs.set('orti.azureRegion', region || 'swedencentral');
    Prefs.set('orti.engine', 'azure');
    var id = 'test' + (++seq), timer = setTimeout(function () { finish('Azure svarade inte.'); }, 20000), over = false;
    function finish(err) {
      if (over) return;
      over = true;
      clearTimeout(timer);
      waiters[id] = null;
      if (err) {
        Prefs.set('orti.azureKey', oldKey); Prefs.set('orti.engine', oldEngine); Prefs.set('orti.azureRegion', oldRegion);
        reply(err, true);
      } else reply('Azure-nyckeln är sparad. ' + NAME + ' talar nu med rösten Mattias.', false);
    }
    waiters[id] = function (o) { if (o.ev === 'start') finish(''); else if (o.ev === 'error') finish(o.msg); };
    stop();
    queue.push({id: id, text: 'Azure-rösten är klar. Det här är ' + NAME + '.', prio: 9});
    pump();
  }
  var waiters = {};

  // MARK: - Start

  function init() {
    build();
    setStatus('redo');
    setInterval(tick, 30000);
    setTimeout(function () { voices(); tick(); }, 8000);
    setTimeout(woke, 12000);   // appen har startat: hälsningen när allt har laddats
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else setTimeout(init, 0);

  return {
    say: function (text) { return say(text, {prio: 5}); },
    ask: ask,
    opening: opening,
    stop: stop,
    tryAzure: tryAzure,
    settingRows: settingRows,
    isSpeaking: function () { return !!current; },
    /** Händelser från appen (OrtiVoice.java). */
    _native: function (o) { if (o && waiters[o.id]) waiters[o.id](o); fromNative(o); },
    /** För tester i en webbläsare: samma bild utan röst. */
    _sim: function (yes) { sim = !!yes; setStatus(status); }
  };
})();
