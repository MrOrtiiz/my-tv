/*
 * Kompisens projektor (HY300 Pro+, Android 14): det som skiljer från The Frame. Läses efter tv/config.js, bara där.
 * Allt annat (väder i Uppsala, svenska, iOS-stilen, filmtips, högtider) är samma kod som på The Frame.
 * IPTV, sök och spelen laddas inte alls på projektorn (android/index.html, SKIP). Barça-rutan visar Valencia (c.team).
 * defaultShelf gäller bara en ny installation (ingen sparad favoritrad); favoritraden ändras sedan på projektorn
 * (Genvägar → Favoritappar). Appar som inte finns på projektorn hoppas över.
 */
(function (c) {
  if (!c) return;
  c.defaultShelf = ['YouTube', 'Netflix', 'Prime Video', 'Disney+', 'HBO Max', 'SVT Play', 'TV4 Play', 'Viaplay',
    'SkyShowtime', 'Apple TV', 'Plex', 'Spotify', 'Kodi', 'Stremio'];
  c.picksOn = true;          // filmtipsen (behöver en TMDB-nyckel: Genvägar → Hemskärm → TMDB-nyckel)
  c.birthdays = [];          // Yuris familjs födelsedagar gäller inte här
  c.ownInputs = {};          // PS5 på HDMI 4 gäller The Frame
  c.buttons = ['marvel', 'inputs', 'shortcuts'];   // Marvel (tv/marvel.js); ingen sök- eller spelknapp; Ingångar bara om projektorn har någon

  // Valencia-rutan: Barça-rutan (tv/barca.js) för Valencia CF, från data/valencia.json (barca.yml skriver den), med
  // Valencias färger på matchdagen (festive.js).
  c.team = {name: 'Valencia CF', key: 'valencia', espn: '94', file: 'valencia.json', label: 'Valencia-ruta',
    theme: 'valencia', stripes: ['255,128,0', '240,240,240']};
  // Nyaste koden även utan omstart: när hemskärmen kommer tillbaka (efter en app) och sidan är äldre än en timme laddas
  // den om, och laddaren hämtar då senaste commit från GitHub.
  var loadedAt = Date.now();
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && Date.now() - loadedAt > 3600000) location.reload();
  });

  // Laddaren i APK 1.0.0 tar bort barca.js: då läses den här, efter de andra skripten (samma ordning som i tv/index.html).
  // Marvel före Doomsday (tv/marvel.js, knappen Marvel) laddas bara här.
  document.addEventListener('DOMContentLoaded', function () {
    function add(src) { var s = document.createElement('script'); s.src = src; document.body.appendChild(s); }
    if (!window.BarcaBox) add('barca.js');
    var css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'marvel.css';
    document.head.appendChild(css);
    add('marvel.js');
  });
})(window.CONFIG);
