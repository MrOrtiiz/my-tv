/*
 * Kompisens projektor (HY300 Pro+, Android 14): det som skiljer från The Frame. Läses efter tv/config.js, bara där.
 * Allt annat (väder i Uppsala, svenska, iOS-stilen, filmtips, högtider) är samma kod som på The Frame.
 * Barça-rutan, IPTV, sök och spelen laddas inte alls på projektorn (android/index.html, FMTV_SKIP).
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
  c.buttons = ['inputs', 'shortcuts'];   // ingen sök- eller spelknapp; Ingångar bara om projektorn har någon
})(window.CONFIG);
