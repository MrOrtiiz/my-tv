# my-tv

Free My TV-hemskärmen i en egen version (Uppsala, svenska, väderbakgrund), för Yuris TV:ar och kompisens projektor.

Tre grupper, var och en med sin egen mapp. En ändring görs bara i den grupp den gäller; ska något in på alla TV:ar
säger Yuri det, och då görs det i alla tre mapparna (se CLAUDE.md).

| Grupp | Mapp | Enheter |
|---|---|---|
| Hemma | `tv/` | The Frame, Samsung Freestyle-projektorn och barnens LG |
| Kompisen | `kompis/` | Kompisens projektor (HY300 Pro+) |
| Jobbet | `kontor/` | TV:n på jobbet (Samsung RM40D med Xiaomi TV Stick 4K) |

- `tv/` är det TV:arna hemma läser vid varje start: appen hämtar den senaste versionen härifrån via jsDelivr. En ändring
  som pushas hit syns nästa gång Free My TV startar, utan någon ny installation.
- `lg/` är barnens LG (webOS): laddaren som hämtar `tv/` på samma sätt, barn-TV:ns egna standardval (`barn.js`),
  förlängningen av Developer Mode (`devmode.js`) och `build.py`, som bygger `FreeMyTV-LG.ipk`.
- `kompis/` och `kontor/` läses av Android-appen i `android/` (WebView), en app per TV: `PROFILE=kompis` bygger
  `FreeMyTV-projektor.apk` (releasen [projektor](https://github.com/MrOrtiiz/my-tv/releases/tag/projektor)) och
  `PROFILE=kontor` bygger `FreeMyTV-kontor.apk` (releasen [kontor](https://github.com/MrOrtiiz/my-tv/releases/tag/kontor)).
  TV:ns egna val ligger i `android/kompis.js` och `android/kontor.js`. GitHub Actions (`android.yml`) bygger båda när
  något i `android/` ändras; ändringar i `kompis/` och `kontor/` behöver ingen ny APK.
  Kompisens projektor läser `kompis/` först när den har fått APK 1.4.0 eller senare (äldre läser `tv/`).
- `source/web/` är källkoden för de filerna (från [simbasjungles/free-my-tv](https://github.com/simbasjungles/free-my-tv), MIT).

- O.R.T.I. (`kontor/orti.js`, bara jobbet): rösten i kontrollrummet. Läser upp korta meddelanden (hälsning, trafiken
  hem, Barça, väder, status) och svarar på frågor från mobilen (Prata med O.R.T.I. i `phone/fjarr.html`). Rösten kräver
  jobbappen 1.5.0 (`android/OrtiVoice.java`: Androids talsyntes eller Azure-rösten Mattias med nyckel från mobilen).

Inga nycklar finns här: TMDB-nyckeln och TomTom-nyckeln (trafikrutan på jobbet) skrivs in på TV:n och stannar där.
