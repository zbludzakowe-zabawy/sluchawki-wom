# Słuchawki – Kanony na WOM: notatki dla Claude

Aplikacja (PWA) do nauki rozpoznawania utworów muzycznych ze słuchu dla uczniów szkoły muzycznej (kanony na WOM).
Strona: https://zbludzakowe-zabawy.github.io/sluchawki-wom/ – publikowana automatycznie z `main` przez GitHub Actions.
Właścicielka pisze po polsku; cała aplikacja, komunikaty, commity i opisy PR są po polsku.

## Zasady pracy (ustalone z właścicielką)
- Zmiany na gałęzi `claude/…`, potem pull request do `main`. Właścicielka sama scala.
  Jeśli poprzedni PR z tej gałęzi jest już scalony – zacznij gałąź od nowa od `origin/main`.
- Przed PR: `npm test` + sprawdzenie w przeglądarce (Playwright, emulacja telefonu – patrz „Testowanie”).
- Pytaj, zanim zmienisz zachowanie, które właścicielka wybrała świadomie (np. blokada edycji zbiorów z biblioteki).
- Bez frameworków i bez kroku budowania: czysty HTML/CSS/JS (moduły ES). Nie dodawaj zależności npm do aplikacji.

## Architektura
| Plik | Rola |
|---|---|
| `index.html`, `style.css` | szkielet i wygląd (kolory w zmiennych CSS, tryb ciemny przez `prefers-color-scheme`) |
| `js/app.js` | cały interfejs: router na `location.hash`, ekrany, odtwarzacz, quizy, dodawanie, edycja, import/eksport, biblioteka |
| `js/textmatch.js` | czysta logika (testowana w Node): normalizacja tekstu, `parseList` (tekst → utwory), `matchAll` (utwory ↔ pliki), `checkAnswer` (quiz tekstowy), `shuffle` |
| `js/layout.js` | składa słowa z OCR (z położeniem) w wiersze tabeli `L.p. / Autor / Tytuł / Część` |
| `js/ocr.js` | Tesseract.js 5 (pol+eng) i pdf.js – ładowane z jsDelivr dopiero przy użyciu; przygotowanie obrazu: progowanie lokalne, usuwanie linii tabeli i kodu QR |
| `js/drive.js` | Google Drive API v3 z kluczem API: lista plików audio w folderze (z podfolderami), `streamUrl`, `download` |
| `js/db.js` | IndexedDB `sluchawki`: `sets` (zbiory), `audio` (pobrane nagrania – Blob po `fileId`), `results` (wyniki quizów) |
| `js/config.js` | `GOOGLE_API_KEY` – wspólny klucz (ograniczony do `https://zbludzakowe-zabawy.github.io/*` i Google Drive API; może być jawny) |
| `js/pwa.js`, `sw.js`, `manifest.webmanifest`, `icons/` | PWA wg przepisu właścicielki (skill „pwa-na-telefon”): baner instalacji, baner „Dostępna nowa wersja”, offline |
| `tools/build-sw.mjs` | przy publikacji wpisuje do `sw.js` wersję (hash plików) i listę plików |
| `tools/build-library.mjs` | przy publikacji tworzy `zbiory/index.json` (spis biblioteki: file, name, count, hash) |
| `tools/make-icons.cjs` | ikony PNG z `icons/icon.svg` (Playwright) |
| `zbiory/*.json` | biblioteka zbiorów wbudowanych – widoczna dla wszystkich |
| `przyklady/kanon-2.1.png` | wzorcowa lista utworów (zrzut tabeli z Worda) – tak wyglądają listy do odczytu |
| `przyklady/kanon-3.1.jpg` | lista z czerwonymi uwagami w kolumnie „Część/fragment” (fixture `kanon-3.1-ocr.json`) |
| `tests/` | `node --test`; `fixtures/kanon-2.1-ocr.json` = słowa z OCR wzorcowej listy |

Publikacja: `.github/workflows/pages.yml` (push do `main`) → testy → kopiuje pliki do `_site` (+ `zbiory/*.json`) → `build-library` → `build-sw` → Pages.

## Model danych
Zbiór (`sets`): `{ id, name, createdAt, updatedAt, folders:[{id,resourceKey,name}], files:[{id,name,size,mimeType,resourceKey}], tracks:[{id, author, title, part, note?, fileId, fileName, size, mimeType, resourceKey}], lib? }`
- `note` – uwagi do utworu (np. czerwony dopisek na liście); nigdy nie jest częścią tytułu ani fragmentu, nie bierze udziału w dopasowaniu plików ani w sprawdzaniu quizu; pokazywane na liście, w odtwarzaczu i w quizie po odpowiedzi.
- `tracks` – kolejność = kolejność „po kolei”. `files` – wszystkie pliki audio z folderów (do zmiany przypisania w edytorze).
- `lib: { file, hash }` – zbiór dodany z biblioteki → **tylko do odczytu** (🔒). Edycja i dopisywanie utworów zablokowane; „⧉ Własna kopia” tworzy zwykły zbiór „… (moja kopia)”. Zmienia go tylko „↻ Aktualizuj” (gdy `hash` w `zbiory/index.json` się zmieni). Import pliku nie nadpisuje zbioru z `lib`.

Format pliku/eksportu (`packSet`): `{ app:'sluchawki', v:1, id, name, folders, exportedAt, tracks:[[author, title, part, fileId, fileName, size, mimeType, resourceKey, note?], …] }` – 9. pole tylko, gdy są uwagi.
Eksport wszystkich: `{ app:'sluchawki', v:1, sets:[…] }`. Import rozpoznaje zbiór po `id`, potem po nazwie (zastąp / zapisz osobno).
Link „Udostępnij”: `#/import/` + `z` + base64url(deflate-raw(JSON)) (albo `j` + base64url(JSON) bez kompresji).

Stan w localStorage: `sluchawki-prefs` (liczba pytań `count`: '75' / 'all' / '150' – `questionCount`; przy 150% `spreadOrder` – połowa utworów drugi raz, nigdy raz za razem; `fragment`: 0 = cały utwór), `sluchawki-player`, `sluchawki-quiz` (wznawianie quizu), `sluchawki-draft` (szkic dodawania), `sluchawki-last-result`, `sluchawki-api-key` (własny klucz – nadpisuje config).

## Najważniejsze zachowania
- **Uwagi z obrazu**: `prepare()` zachowuje kolory, `markNotes()` w `js/ocr.js` oznacza słowa w innym kolorze niż większość tekstu (`note: true`, kolor ze środka kresek, bez dolnego skraju – czerwone podkreślenia korekty pisowni nie liczą się; kolor równy kolorowi tła komórki, np. czarny tekst w niebieskim nagłówku z JPG, też nie); `layoutText` daje je jako `\t[uwagi: …]`, `parseList` wydziela `[uwagi: …]` / `[uwaga: …]` do `note`.
- **Dodawanie**: nazwa zbioru (nowy / istniejący, ale nie z biblioteki) → lista ze zdjęcia/PDF/tekstu (`readFileText` → `layoutText` → edytowalny tekst → `parseList`) → link do folderu Dysku → automatyczne dopasowanie (`matchAll`, zachłannie, próg `MATCH_MIN` 0.35; kolory: ≥0.7 pewne, ≥0.5 sprawdź) → ręczne poprawki → „Zatwierdź”.
- **Nazwy plików na Dysku** mają format `Autor - Tytuł - Część.mp3`, np. `Arcangelo Corelli - Concerto Grosso g-moll ''Na Boże Narodzenie'', op. 6 nr 8 - cz. 5. Pastorale.mp3`.
- **Nauka**: po kolei, losowo (inna kolejność niż ostatnio – `freshShuffle`), według autora (`groupAuthors` po nazwisku).
- **Quiz**: domyślnie gra **cały utwór** (pauza/wznowienie, suwak, „od początku”); opcjonalnie pierwsze 15/30/60 s. Quiz wyboru – lista wszystkich utworów zbioru z wyszukiwarką. Quiz tekstowy – autor, tytuł, część; aplikacja nie podpowiada, czy część istnieje. Punkt tylko gdy wszystkie 3 pola dobre. ≥90% → confetti. Podsumowanie + „Powtórz błędne”.
- **Sprawdzanie odpowiedzi** (wyrozumiałe, uzgodnione): bez wielkości liter i polskich znaków, drobne literówki; autor – wystarczy nazwisko (imiona/inicjały opcjonalne, ale jeśli podane, muszą pasować; imiona w różnych językach są równoważne – „Johann” = „Jan”, lista `NAME_GROUPS`); tytuł – można pominąć „opera/balet/…” oraz dopisek w nawiasie/cudzysłowie albo podać sam dopisek; numery (op., nr, KV) muszą się zgadzać; tonacja – „A” = „A-dur” (wielka litera = dur), „a” = „a-moll” (mała = moll), obowiązkowa, jeśli jest na liście (kolejność słów dowolna: „Polonez op. 40 nr 1 A”); w części wystarczy sam numer; sam dopisek tytułu zaliczany bez tonacji, ale z uwagą „brakuje tonacji”; tytuł po polsku i w oryginale („Erlkönig (Król elfów)”, „Die Moldau / Wełtawa”) – wystarczy jedna wersja, z uwagą „pełny tytuł to …”; literówki: 1 od 4 liter, 2 od 7, 3 od 11 (`answerSim`); po odpowiedzi `explainAnswer` pokazuje, co było źle; część – wystarczy numer („I” = „cz. 1”) albo nazwa („Pastorale”), ale podany numer musi się zgadzać.
- **Offline**: „Pobierz na urządzenie” zapisuje nagrania w IndexedDB; odtwarzanie najpierw z Blob, potem strumień z Drive API (`alt=media&key=`).
- **iPhone**: jeden wspólny `<audio>`, odblokowywany cichym WAV przy pierwszym dotknięciu.

## Biblioteka zbiorów – dodawanie nowego zbioru wbudowanego
Właścicielka przysyła link „Udostępnij” (albo plik eksportu). Dekodowanie linku:
```python
import base64, zlib, json
s = LINK.split('#/import/')[1]; b = s[1:] + '=' * (-len(s[1:]) % 4)
d = json.loads(zlib.decompress(base64.urlsafe_b64decode(b), -15))   # s[0] == 'z'
```
Potem: sprawdź i popraw błędy odczytu OCR w autorach/tytułach (porównaj z nazwami plików, np. „Bedfigh” → „Bedřich”) – inaczej quiz tekstowy uzna dobre odpowiedzi za złe; zachowaj `id`; zapisz jako `zbiory/<nazwa-bez-polskich-znaków>.json` (format `packSet`, `indent=1`, `ensure_ascii=False`); sprawdź `node tools/build-library.mjs <katalog-testowy>`; dopisz do listy w README; PR. Właścicielka może też sama wgrać plik do `zbiory/` na `main` (bez PR).

## Testowanie
- `npm test` – testy jednostkowe (m.in. na prawdziwej liście KANON 2.1 i nazwach plików w formacie z Dysku).
- E2E: Playwright jest preinstalowany (`require('playwright')`). Serwuj kopię strony `python3 -m http.server`, a zapytania do `https://www.googleapis.com/**` podstaw przez `context.route` (lista plików JSON + nagrania WAV wygenerowane w Pythonie). Uwaga: podstawione nagrania nie obsługują Range, więc przewijanie strumienia testuj na nagraniu pobranym (Blob).
- OCR w testach: jsDelivr bywa zablokowany w sandboxie → `npm i tesseract.js@5.1.1 tesseract.js-core@5.1.1 @tesseract.js-data/pol @tesseract.js-data/eng` w scratchpadzie i przekieruj `https://cdn.jsdelivr.net/npm/<pakiet>[@wersja]/<ścieżka>` do `node_modules`. `ocrImageWords(file)` z `js/ocr.js` zwraca słowa z położeniem (do nowych fixture'ów).
- Service worker rejestruje się tylko przez HTTPS – w kopii testowej podmień warunek w `js/pwa.js` (`location.protocol !== 'https:'` → `false`), zbuduj `sw.js` przez `tools/build-sw.mjs` i sprawdź offline + baner aktualizacji.
- Zrzuty ekranu w emulacji `devices['Pixel 7']` i `devices['iPhone 13']`, sprawdź wąski ekran.

## Pułapki napotkane wcześniej
- Lista `ASSETS` w źródłowym `sw.js` ma być poprawnym JS (w cudzysłowach) i zawierać każdy plik `js/*.js` – przy publikacji i tak nadpisuje ją `build-sw.mjs`.
- Długie skrypty Pythona w heredoc w Bash bywają blokowane przez kontrolę bezpieczeństwa – zapisuj je do pliku w scratchpadzie (Write) i uruchamiaj osobno.
- Commit z kluczem API blokuje klasyfikator uprawnień – klucz jest już w `js/config.js` (właścicielka wpisała go sama); nie zmieniaj go bez prośby.
- Sieć sandboxa: `www.googleapis.com` dostępne (bez klucza ograniczonego do strony odpowiada 403 – to poprawne), `github.io` i jsDelivr zwykle zablokowane.
- Tesseract zgłasza część błędów tylko przez `errorHandler` – dlatego `ocrFailure()` w `js/ocr.js`.
