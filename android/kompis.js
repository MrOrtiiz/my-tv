/*
 * Kompisens projektor (HY300 Pro+, Android 14): det som skiljer från The Frame. Läses efter tv/config.js, bara där.
 * Allt annat (väder i Uppsala, svenska, iOS-stilen, filmtips, högtider) är samma kod som på The Frame.
 * IPTV och spelen laddas inte alls på projektorn (android/index.html, SKIP). Barça-rutan visar Valencia (c.team).
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
  // Marvel (tv/marvel.js), Mobilen (tv/koppla.js: QR-kod till en fjärrkontroll i mobilen), Sök (tv/search.js, som på
  // The Frame: filmer och serier, var de finns i Sverige, trailer); ingen spelknapp; Ingångar bara om projektorn har någon.
  c.buttons = ['marvel', 'phone', 'search', 'inputs', 'shortcuts'];

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
  // Marvel före Doomsday (tv/marvel.js) och Koppla mobilen (tv/koppla.js) laddas bara här.
  document.addEventListener('DOMContentLoaded', function () {
    function add(src) { var s = document.createElement('script'); s.src = src; document.body.appendChild(s); }
    function css(href) { var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l); }
    if (!window.BarcaBox) add('barca.js');
    if (!window.Search) { css('search.css'); add('search.js'); }   // laddaren i APK 1.0.0/1.1.0 tar bort dem
    css('marvel.css');
    add('marvel.js');
    css('koppla.css');
    add('koppla.js');
  });
})(window.CONFIG);
