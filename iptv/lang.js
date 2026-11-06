/*
 * A group's or a channel's language, for the order Yuri wants: Spanish, English, Swedish, then every other language.
 * From the country in the name ("ES | DEPORTES", "|UK| Sky Sports", "… FHD CL", "SE: TV4") or words that give it
 * away ("LATINO", "SPAIN", "SVERIGE", "Movistar"). A country's language, not the country: Chile and Mexico are Spanish.
 * The same rules as .github/scripts/barca.py language(). ES5 only.
 */
var Lang = (function () {
  'use strict';
  var ORDER = ['es', 'en', 'sv', 'xx'];
  var COUNTRY = {
    es: 'es', esp: 'es', spa: 'es', mx: 'es', mex: 'es', ar: 'es', arg: 'es', cl: 'es', co: 'es', pe: 'es', ve: 'es',
    ec: 'es', uy: 'es', py: 'es', bo: 'es', cr: 'es', pa: 'es', gt: 'es', hn: 'es', ni: 'es', 'do': 'es', pr: 'es', cu: 'es',
    latam: 'es', lat: 'es', latino: 'es',
    uk: 'en', gb: 'en', en: 'en', eng: 'en', us: 'en', usa: 'en', ie: 'en', ca: 'en', au: 'en', nz: 'en', za: 'en', ng: 'en',
    ke: 'en', gh: 'en',
    se: 'sv', swe: 'sv', sw: 'sv', sv: 'sv'
  };
  var WORDS = [
    ['es', /movistar|\bm\+|dazn\s*(laliga|f1|es)|hypermotion|espn\s*deportes|deportes|\bgol\b|vamos|\btudn\b|univision|telemundo|tyc\s*sports|win\s*sports|\bcdo\b|directv\s*sports|español|espanol|castellano|\bspain\b|espa[ñn]a|latino|latin\s*america|mexico|méxico|argentina|chile|colombia|\bperu\b|telecinco|\bcuatro\b|\btve\b/i],
    ['sv', /\btv4\b|c\s*more|v\s*sport|viaplay\s*(se|sverige)|sportkanalen|\btv3\s*sport|\bsvt\b|\btv6\b|sverige|sweden|swedish|svenska/i],
    ['en', /sky\s*sports|tnt\s*sports|bt\s*sport|premier\s*sports|laliga\s*tv|supersport|\bespn\b|cbs\s*sports|bein\s*sports\s*(usa|xtra|en)|fox\s*(sports|soccer)|\bfs1\b|paramount|peacock|stan\s*sport|optus|english|united\s*kingdom|\bbritish\b|\busa\b|\bamerica\b|canada|australia|ireland/i]
  ];

  function of(name, id) {
    name = String(name || '');
    var re = /(?:^|[\s|\[(:\-])([A-Za-z]{2,6})(?=$|[\s|\]):\-])/g, m;
    while ((m = re.exec(name))) {
      var t = m[1];
      if (t === t.toUpperCase() && COUNTRY.hasOwnProperty(t.toLowerCase())) return COUNTRY[t.toLowerCase()];
    }
    var s = /\.([a-z]{2,3})$/.exec(String(id || '').toLowerCase());
    if (s && COUNTRY.hasOwnProperty(s[1])) return COUNTRY[s[1]];
    for (var i = 0; i < WORDS.length; i++) if (WORDS[i][1].test(name)) return WORDS[i][0];
    return 'xx';
  }

  function rank(name, id) { return ORDER.indexOf(of(name, id)); }

  /** Sorts a list by language (Spanish, English, Swedish, others), keeping the order within each language. */
  function sort(list, nameOf) {
    var tagged = [];
    for (var i = 0; i < list.length; i++) tagged.push({x: list[i], r: rank(nameOf(list[i])), i: i});
    tagged.sort(function (a, b) { return a.r - b.r || a.i - b.i; });
    var out = [];
    for (i = 0; i < tagged.length; i++) out.push(tagged[i].x);
    return out;
  }

  var TAG = {es: 'ES', en: 'EN', sv: 'SV', xx: ''};
  return {of: of, rank: rank, sort: sort, tag: function (name, id) { return TAG[of(name, id)]; }};
})();
