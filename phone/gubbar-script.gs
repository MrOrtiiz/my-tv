/**
 * Dansgolvet – gubbarna från Google Drive.
 *
 * Lämnar ut bilderna i mappen Dansgolvet → Gubbar i din Google Drive till mobilsidan (phone/dance.html), så
 * att de syns som gubbar att välja. Skriptet körs som du, så mappen kan vara helt privat: bara den som har
 * webbappens adress kommer åt den, och bara bilderna i mappen.
 *
 * Så här (en gång):
 * 1. Gå till script.google.com → Nytt projekt. Ta bort det som står där och klistra in hela den här filen.
 *    (Mappens id står redan nedan. Använder du en annan mapp: kopiera id:t från adressen
 *    drive.google.com/drive/folders/<ID> och klistra in det i stället.)
 * 2. Driftsätt → Ny driftsättning → kugghjulet → Webbapp. "Kör som": Jag. "Vem har åtkomst": Alla.
 *    Driftsätt och ge åtkomst till Drive (Google varnar för att appen inte är verifierad: det är ditt eget
 *    skript, välj Avancerat → Gå till … ).
 * 3. Kopiera webbappens URL (slutar på /exec). I mobilen: Dansgolvet → "Koppla Drive-mappen", klistra in.
 *    TV:n kommer ihåg den och lägger den i QR-koden, så alla mobiler som skannar får gubbarna.
 *
 * Nya bilder i mappen syns direkt nästa gång mobilsidan öppnas.
 */
var FOLDER_ID = '1DdyOkxg3bpBj1b0c7TC4XpOIyll-HbVn';
var PART = 6 * 1024 * 1024;   // bytes per svar (delbart med 3, så delarnas base64 kan sättas ihop)

function doGet(e) {
  var p = (e && e.parameter) || {};
  try {
    if (p.file) return out(part(p.file, parseInt(p.part || '0', 10) || 0));
    return out(list());
  } catch (err) {
    return out({error: String(err && err.message || err)});
  }
}

/** Bilderna i mappen, med en liten förhandsbild var. */
function list() {
  var folder = DriveApp.getFolderById(FOLDER_ID), it = folder.getFiles(), files = [];
  while (it.hasNext()) {
    var f = it.next(), type = f.getMimeType();
    if (!/^image\//.test(type)) continue;
    var thumb = null;
    try { var t = f.getThumbnail(); if (t) thumb = 'data:' + t.getContentType() + ';base64,' + Utilities.base64Encode(t.getBytes()); } catch (x) {}
    files.push({id: f.getId(), name: f.getName(), type: type, size: f.getSize(), modified: f.getLastUpdated().getTime(), thumb: thumb});
  }
  files.sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
  return {ok: true, name: folder.getName(), files: files, time: Date.now()};
}

/** En bild (base64), i delar om den är stor, bara om den ligger i mappen. */
function part(id, n) {
  var f = DriveApp.getFileById(id), inside = false, parents = f.getParents();
  while (parents.hasNext()) if (parents.next().getId() === FOLDER_ID) inside = true;
  if (!inside) throw new Error('bilden ligger inte i gubbmappen');
  var bytes = f.getBlob().getBytes(), from = n * PART, to = Math.min(bytes.length, from + PART);
  return {ok: true, type: f.getMimeType(), size: bytes.length, part: n, parts: Math.max(1, Math.ceil(bytes.length / PART)),
    data: Utilities.base64Encode(bytes.slice(from, to))};
}

function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
