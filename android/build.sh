#!/usr/bin/env bash
# Bygger FreeMyTV-projektor.apk (Free My TV för kompisens HY300 Pro+) utan Gradle:
# aapt2 -> javac -> d8 -> zipalign -> apksigner, som simbasjungles/free-my-tv build.sh (MIT).
# Behöver en JDK (17+) och Android SDK (build-tools 34+, en plattform android-34+). Körs av .github/workflows/android.yml.
#   KEYSTORE=nyckel.keystore KS_PASS=… bash android/build.sh   → FreeMyTV-projektor.apk i repots rot
# Utan KEYSTORE skapas en tillfällig nyckel (en sådan APK kan inte uppdatera en installerad, signerad med den riktiga).
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION_NAME="$(grep -o "VERSION = '[^']*'" android/index.html | cut -d"'" -f2)"
VERSION_CODE="${VERSION_CODE:-1}"
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
[ -n "$SDK" ] && [ -d "$SDK/build-tools" ] || { echo "Android SDK saknas (ANDROID_HOME)."; exit 1; }
# Beprövade versioner före de senaste (build-tools 34/35, plattform 34/35): äldre projektorer läser deras APK:er säkert.
pick() { for v in "$@"; do [ -e "$v" ] && { echo "$v"; return; }; done; }
BT="$(pick "$SDK/build-tools/34.0.0" "$SDK/build-tools/35.0.0" "$SDK/build-tools/$(ls "$SDK/build-tools" | sort -V | tail -1)")"
AJ="$(pick "$SDK/platforms/android-34/android.jar" "$SDK/platforms/android-35/android.jar" "$(ls -d "$SDK"/platforms/android-*/android.jar | sort -V | tail -1)")"
echo "build-tools: $BT"
echo "plattform:   $AJ"
echo "version:     $VERSION_NAME ($VERSION_CODE)"

OUT=android/out
rm -rf "$OUT"
mkdir -p "$OUT/assets" "$OUT/classes" "$OUT/gen"

python3 android/assets.py "$OUT/assets"

"$BT/aapt2" compile --dir android/res -o "$OUT/res.zip"
"$BT/aapt2" link -o "$OUT/base.apk" -I "$AJ" --manifest android/AndroidManifest.xml -A "$OUT/assets" \
  --java "$OUT/gen" --min-sdk-version 24 --target-sdk-version 34 \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" "$OUT/res.zip"

javac -nowarn -Xlint:-options -source 8 -target 8 -encoding UTF-8 -bootclasspath "$AJ" -classpath "$AJ" \
  -d "$OUT/classes" $(find android/src "$OUT/gen" -name '*.java')
"$BT/d8" --release --min-api 24 --lib "$AJ" --output "$OUT" $(find "$OUT/classes" -name '*.class')
(cd "$OUT" && zip -qj base.apk classes.dex)
"$BT/zipalign" -f -p 4 "$OUT/base.apk" "$OUT/aligned.apk"

if [ -z "${KEYSTORE:-}" ]; then
  KEYSTORE="$OUT/tillfallig.keystore"; KS_PASS=freemytv; export KS_PASS
  keytool -genkeypair -keystore "$KEYSTORE" -storepass "$KS_PASS" -keypass "$KS_PASS" -alias fmtv \
    -keyalg RSA -keysize 2048 -validity 20000 -dname "CN=Free My TV Projektor (tillfällig)" >/dev/null 2>&1
fi
"$BT/apksigner" sign --ks "$KEYSTORE" --ks-pass env:KS_PASS --key-pass env:KS_PASS \
  --out FreeMyTV-projektor.apk "$OUT/aligned.apk"
"$BT/apksigner" verify --verbose FreeMyTV-projektor.apk | head -6
"$BT/aapt2" dump badging FreeMyTV-projektor.apk | head -3
ls -la FreeMyTV-projektor.apk
