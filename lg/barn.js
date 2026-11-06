/*
 * Barnens TV (LG 43NANO080A6B, webOS 25): det som skiljer från The Frame. Läses efter tv/config.js, bara på LG.
 * Allt annat (väder, högtider, födelsedagar, Barça-rutan, sök) är samma kod som på The Frame.
 * defaultShelf gäller bara en ny installation (ingen sparad favoritrad); favoritraden ändras sedan på TV:n
 * (Genvägar → Favoritappar). Appar som inte finns på TV:n hoppas över.
 */
(function (c) {
  if (!c) return;
  c.defaultShelf = ['YouTube Kids', 'Netflix', 'Disney+', 'YouTube', 'SVT Play', 'TV4 Play', 'Prime Video', 'HBO Max',
    'SkyShowtime', 'Viaplay', 'Plex', 'Spotify', 'Smart IPTV', 'IPTV AirPlayer'];
  c.ownInputs = {};   // PS5 på HDMI 4 gäller The Frame
})(window.CONFIG);
