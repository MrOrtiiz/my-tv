/*
 * Yuris TV på jobbet (Samsung RM40D med Xiaomi TV Stick 4K, Google TV): det som skiljer från The Frame. Läses efter
 * kontor/config.js, bara här (appen FreeMyTV-kontor.apk, PROFILE=kontor i android/build.sh), som läser mappen kontor/.
 * Allt annat (väder i Uppsala, svenska, iOS-stilen, Barça-rutan, högtider) är samma kod som på The Frame.
 * Spelen laddas inte (android/index.html, SKIP). Trafikrutan (kontor/trafik.js) visar restiden hem med köer från TomTom;
 * nyckeln skrivs in på TV:n (Inställningar → Hemskärm → Trafiknyckel) och finns aldrig i repot.
 */
(function (c) {
  if (!c) return;
  c.defaultShelf = ['YouTube', 'Spotify', 'SVT Play', 'Netflix', 'Prime Video', 'Disney+', 'HBO Max', 'TV4 Play', 'Plex', 'Stremio'];
  c.picksOn = false;         // filmtipsen kräver en TMDB-nyckel; slås på under Hemskärm om den läggs in
  c.ownInputs = {};          // PS5 på HDMI 4 gäller The Frame
  // Mobilen (koppla.js: mobilen som fjärrkontroll och tangentbord, bra för nyckeln), Sök, Ingångar, Genvägar; inga spel.
  // Hem först: tar dig till den vanliga Free My TV-startsidan (den som Hem-knappen på fjärrkontrollen öppnar).
  c.buttons = ['home', 'phone', 'search', 'inputs', 'shortcuts'];

  // Trafikrutan: bil från jobbet (Palmbladsgatan 8) hem (Ritargatan 4B), koordinater från TomTom.
  c.traffic = {label: 'hem',
    from: [59.8600155, 17.7018762], to: [59.8731401, 17.6755244],
    days: [1, 2, 3, 4, 5], hours: [7, 18]};

  // Nyaste koden även utan omstart: när hemskärmen kommer tillbaka och sidan är äldre än en timme laddas den om.
  var loadedAt = Date.now();
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && Date.now() - loadedAt > 3600000) location.reload();
  });

  // Tilläggen som bara laddas här, efter de andra skripten (samma ordning som kompis.js).
  document.addEventListener('DOMContentLoaded', function () {
    function add(src) { var s = document.createElement('script'); s.src = src; document.body.appendChild(s); }
    function css(href) { var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l); }
    if (!window.BarcaBox) add('barca.js');
    if (!window.Search) { css('search.css'); add('search.js'); }
    if (!window.IPTV) { css('iptv.css'); add('iptv.js'); }
    css('koppla.css');
    add('koppla.js');
    css('trafik.css');
    add('trafik.js');
  });
})(window.CONFIG);
