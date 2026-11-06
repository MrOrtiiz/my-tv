/**
 * Spel – Google Drive-skriptet.
 *
 * Lämnar ut spelen i en mapp i din Google Drive till Spel-appen på TV:n. Skriptet körs som du, så mappen
 * kan vara helt privat: bara den som har webbappens adress kommer åt den, och bara filerna i mappen.
 *
 * Så här:
 * 1. Skapa en mapp i Drive, t.ex. "Spel" (gärna med undermappar: NES, SNES, Game Boy, Game Boy Color,
 *    Game Boy Advance, Mega Drive, Master System). Öppna mappen och kopiera id:t från adressen:
 *    drive.google.com/drive/folders/<DET HÄR ÄR ID:T>
 * 2. Gå till script.google.com → Nytt projekt. Ta bort det som står där, klistra in hela den här filen och
 *    klistra in mappens id nedan, mellan citattecknen.
 * 3. Driftsätt → Ny driftsättning → kugghjulet → Webbapp. "Kör som": Jag. "Vem har åtkomst": Alla.
 *    Driftsätt, ge åtkomst till Drive (Google varnar för att appen inte är verifierad: det är ditt eget
 *    skript, välj Avancerat → Gå till … ).
 * 4. Kopiera webbappens URL (slutar på /exec) och skicka den till TV:n: mobilsidan i Free My TV →
 *    Inställningar → Spel, eller skriv in den i Spel-appen under Inställningar.
 *
 * Lägger du till spel i mappen syns de i appen när du väljer Uppdatera (eller nästa dag).
 * Spara gärna spelen som .zip: de blir mindre och laddas fortare.
 */
var FOLDER_ID = 'KLISTRA-IN-MAPPENS-ID-HÄR';
var PART = 6 * 1024 * 1024;   // bytes per svar (stora filer hämtas i delar)

function doGet(e) {
  var p = (e && e.parameter) || {};
  try {
    if (p.file) return out(part(p.file, parseInt(p.part || '0', 10) || 0));
    return out(list());
  } catch (err) {
    return out({error: String(err && err.message || err)});
  }
}

/** Alla filer i mappen och dess undermappar (tre nivåer ner), med undermappens namn. */
function list() {
  var root = DriveApp.getFolderById(FOLDER_ID), files = [];
  walk(root, '', files, 0);
  return {ok: true, name: root.getName(), files: files, time: Date.now()};
}

function walk(folder, path, files, depth) {
  var it = folder.getFiles();
  while (it.hasNext()) {
    var f = it.next();
    files.push({id: f.getId(), name: f.getName(), folder: path, size: f.getSize(), modified: f.getLastUpdated().getTime()});
  }
  if (depth >= 3) return;
  var sub = folder.getFolders();
  while (sub.hasNext()) {
    var s = sub.next();
    walk(s, path ? path + '/' + s.getName() : s.getName(), files, depth + 1);
  }
}

/** En del av en fil (base64), bara om filen ligger i spelmappen. */
function part(id, n) {
  var f = DriveApp.getFileById(id);
  if (!inside(f)) throw new Error('filen ligger inte i spelmappen');
  var bytes = f.getBlob().getBytes(), from = n * PART, to = Math.min(bytes.length, from + PART);
  return {ok: true, size: bytes.length, part: n, parts: Math.max(1, Math.ceil(bytes.length / PART)), data: Utilities.base64Encode(bytes.slice(from, to))};
}

function inside(file) {
  var queue = [file.getParents()], depth = 0;
  while (queue.length && depth < 5) {
    var next = [];
    for (var i = 0; i < queue.length; i++) {
      while (queue[i].hasNext()) {
        var folder = queue[i].next();
        if (folder.getId() === FOLDER_ID) return true;
        next.push(folder.getParents());
      }
    }
    queue = next;
    depth++;
  }
  return false;
}

function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
