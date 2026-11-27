# my-tv: regler för Claude

Yuris Free My TV-hemskärm. Läs README.md för hur repot hänger ihop.

## Tre grupper, tre mappar – ändra bara i den grupp som gäller

| Grupp | Mapp | Enheter | Egna val |
|---|---|---|---|
| Hemma | `tv/` | The Frame, Samsung Freestyle-projektorn, barnens LG | `tv/config.js`, `lg/barn.js` |
| Kompisen | `kompis/` | Kompisens projektor (HY300 Pro+, Android) | `android/kompis.js` |
| Jobbet | `kontor/` | TV:n på jobbet (RM40D + Xiaomi TV Stick 4K) | `android/kontor.js` |

- När Yuri ber om en ändring: gör den **bara** i mappen för den enhet eller grupp han nämner ("TV:n hemma",
  "projektorn", "barnens TV" → `tv/`; "kompisens projektor" → `kompis/`; "jobbet"/"kontoret" → `kontor/`).
- Ändra aldrig i de andra mapparna "för att hålla dem lika". De får skilja sig åt.
- Säger han "på alla", "överallt" eller "alla TV:ar": gör samma ändring i alla tre mapparna, och säg att du gjort det.
- Är det oklart vilken grupp han menar: fråga innan du ändrar.
- `data/` (Barça, Valencia, fria kanaler) och `phone/` delas av alla. En ändring där påverkar alla grupper: säg det
  och fråga först om den inte gäller alla.
- Inga nycklar i repot (det är publikt): TMDB-, TomTom- och IPTV-uppgifter skrivs in på TV:n.
- Koden körs på gamla TV:ar: bara ES5 i `tv/`, `kompis/`, `kontor/`, `lg/` och `android/index.html`.
