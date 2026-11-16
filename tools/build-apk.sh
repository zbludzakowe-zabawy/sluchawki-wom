#!/usr/bin/env bash
# Buduje aplikację na Androida (android/) bez Gradle – samymi narzędziami Android SDK.
# Użycie: tools/build-apk.sh _site/sluchawki.apk
# Wymaga: ANDROID_HOME (jest na GitHub Actions ubuntu-latest) i JDK 17+.
set -euo pipefail

OUT="${1:-sluchawki.apk}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/android"
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
[ -n "$SDK" ] || { echo "Brak ANDROID_HOME" >&2; exit 1; }

BT="$(ls -d "$SDK"/build-tools/* | sort -V | tail -1)"
PLATFORM="$(ls -d "$SDK"/platforms/android-* | sort -V | tail -1)"
JAR="$PLATFORM/android.jar"
echo "build-tools: $BT"
echo "platforma:   $PLATFORM"

# numer wersji rośnie z czasem – nowy plik instaluje się na starym
VCODE=$(( $(date +%s) / 60 - 29000000 ))
VNAME="1.0.$VCODE"

W="$(mktemp -d)"
trap 'rm -rf "$W"' EXIT

"$BT/aapt2" compile --dir "$SRC/res" -o "$W/res.zip"
"$BT/aapt2" link -o "$W/base.apk" -I "$JAR" \
  --manifest "$SRC/AndroidManifest.xml" -R "$W/res.zip" --java "$W/gen" --auto-add-overlay \
  --min-sdk-version 24 --target-sdk-version 34 \
  --version-code "$VCODE" --version-name "$VNAME"

mkdir -p "$W/classes"
javac -encoding UTF-8 -source 8 -target 8 -nowarn -Xlint:-options \
  -bootclasspath "$JAR" -d "$W/classes" \
  $(find "$SRC/src" "$W/gen" -name '*.java')

mkdir -p "$W/dex"
"$BT/d8" --release --min-api 24 --lib "$JAR" --output "$W/dex" $(find "$W/classes" -name '*.class')
(cd "$W/dex" && zip -q -u "$W/base.apk" classes.dex)

"$BT/zipalign" -p -f 4 "$W/base.apk" "$W/aligned.apk"
# Klucz podpisu jest w repozytorium celowo: aplikacja tylko wyświetla stronę i nie ma
# żadnych uprawnień poza internetem, a ten sam klucz pozwala instalować nowe wersje na starych.
"$BT/apksigner" sign --ks "$SRC/sluchawki.keystore" --ks-pass pass:sluchawki \
  --ks-key-alias sluchawki --key-pass pass:sluchawki --out "$OUT" "$W/aligned.apk"
"$BT/apksigner" verify "$OUT"
echo "Gotowe: $OUT (wersja $VNAME, $(du -k "$OUT" | cut -f1) KB)"
