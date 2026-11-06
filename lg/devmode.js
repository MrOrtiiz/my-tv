/*
 * Håller LG:s Developer Mode vid liv. Developer Mode gäller 1000 timmar (ca 41 dagar); när tiden går ut tar TV:n bort
 * alla appar som installerats den vägen, Free My TV också. Knappen EXTEND i Developer Mode-appen nollställer tiden,
 * och webOS Dev Manager gör samma sak genom att öppna appen med {extend: true}.
 *
 * Här: högst en gång i veckan, när Free My TV:s skärmsläckare är igång (ingen tittar), öppnas Developer Mode med
 * {extend: true}, och efter 8 sekunder öppnas Free My TV igen. Tiden sparas i localStorage (fmtv.devmode) och syns
 * under Genvägar → Om den här TV:n. Bara på LG (laddas av lg/index.html).
 */
var DevMode = (function () {
  'use strict';
  var KEY = 'fmtv.devmode', EVERY = 6 * 24 * 3600 * 1000, APP = 'com.palmdts.devmode';
  var self = window.PalmSystem && window.PalmSystem.identifier ? window.PalmSystem.identifier.split(' ')[0] : '';

  function last() { try { return +localStorage.getItem(KEY) || 0; } catch (e) { return 0; } }

  function idle() {
    var s = document.getElementById('saver'), a = document.getElementById('ambient');
    function on(n) { return n && (' ' + n.className + ' ').indexOf(' on ') >= 0; }
    return !document.hidden && (on(s) || on(a));
  }

  /** Öppnar Developer Mode med extend och kommer tillbaka; done(ok). */
  function extend(done) {
    if (!window.TV || TV.name !== 'webos') { if (done) done(false); return; }
    try { localStorage.setItem(KEY, String(Date.now())); } catch (e) {}   // först, så att ett fel inte upprepas varje minut
    TV.launch(APP, {extend: true}, function (ok) {
      if (ok && self) setTimeout(function () { TV.launch(self, null, function () {}); }, 8000);
      if (done) done(ok);
    });
  }

  if (window.TV && TV.name === 'webos') {
    setInterval(function () { if (Date.now() - last() > EVERY && idle()) extend(); }, 60000);
  }

  return {last: last, extend: extend};
})();
