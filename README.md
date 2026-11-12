# Słuchawki – Kanony na WOM

Aplikacja do nauki rozpoznawania utworów ze słuchu. Działa w przeglądarce i instaluje się na telefonie jak zwykła aplikacja (PWA).

## Co potrafi

**Dodawanie**
- Nowy zbiór utworów albo dopisanie utworów do istniejącego.
- Lista utworów ze zdjęcia, zrzutu ekranu, skanu lub PDF-u. Tekst odczytuje się automatycznie: Tesseract.js dla obrazów, warstwa tekstu albo OCR dla PDF. Tabela z kolumnami *L.p. / Autor / Tytuł / Część/fragment* jest rozpoznawana po nagłówkach. Komórki zawinięte do dwóch linii są łączone, a ramki i kod QR pomijane (wzór: `przyklady/kanon-2.1.png`). Listę można też wkleić jako tekst.
- Link do folderu na Dysku Google z plikami mp3. Folder musi być udostępniony „Każdy, kto ma link”. Podfoldery też są czytane.
- Automatyczne dopasowanie opisów do plików. Działa bez polskich znaków, z literówkami, skrótami i numerami części (I = 1).
- Ekran sprawdzania pokazuje, które dopasowania są pewne (zielone), a które trzeba sprawdzić (żółte i czerwone). Każde nagranie można odsłuchać przyciskiem ▶. Można zmienić plik, poprawić autora, tytuł i część, zmienić kolejność, usunąć wiersz albo dodać nieprzypisany plik jako utwór. Zbiór zapisuje się dopiero po zatwierdzeniu.
- Bez listy można utworzyć zbiór z samych nazw plików.

**Nauka** (zawsze jeden wybrany zbiór)
- Słuchanie po kolei, w kolejności ustalonej przy dodawaniu.
- Słuchanie losowe. Kolejność jest za każdym razem inna niż ostatnio.
- Słuchanie utworów wybranego autora.
- Quiz wyboru: aplikacja puszcza utwór od początku, a ty wybierasz go z listy wszystkich utworów zbioru (lista ma wyszukiwarkę). Utwór gra do końca: możesz go zatrzymać ⏸, przewinąć albo puścić „↺ Od początku”.
- Quiz tekstowy: wpisujesz autora, tytuł i część. Aplikacja nie podpowiada, czy utwór ma część. Wielkość liter, polskie znaki i drobne literówki nie mają znaczenia. Wystarczy samo nazwisko autora (imiona albo inicjały są opcjonalne). W tytule można pominąć słowa typu „opera”, „balet” oraz dopisek w nawiasie lub cudzysłowie, np. „Halka”, „Król elfów”, „Eine kleine Nachtmusik”. W części wystarczy numer albo nazwa, np. „5” albo „Pastorale”.
- Podsumowanie quizu pokazuje utwory rozpoznane i do powtórki, z twoimi odpowiedziami. Przycisk „Powtórz błędne” powtarza tylko źle rozpoznane. Za wynik ≥ 90% jest confetti 🎉.
- W ustawieniach quizu wybierasz liczbę pytań (wszystkie, 10, 20 albo 30) i to, co ma grać: cały utwór (domyślnie) albo tylko pierwsze 15, 30 lub 60 s.

**Bez internetu**
- Przycisk „Pobierz na urządzenie” zapisuje nagrania zbioru w pamięci aplikacji (IndexedDB). Potem słuchanie i quizy działają w samolocie albo w metrze.

**Edycja zbioru po zapisaniu**
- W zbiorze przycisk **✎ Edytuj** (u góry). Możesz zmienić nazwę, poprawić autora, tytuł i część, zmienić plik nagrania, kolejność albo usunąć utwór. Możesz też wczytać inny folder z Dysku i dodać z niego nowe nagrania. Lista utworów jest widoczna w zbiorze pod „Utwory w zbiorze”.

**Eksport i import**
- Zbiory są zapisane na urządzeniu.
- **Eksportuj do pliku** (w zbiorze) zapisuje jeden zbiór, a **Eksportuj wszystkie zbiory** (strona główna) zapisuje wszystkie w jednym pliku `.sluchawki.json`.
- Na drugim urządzeniu: **Importuj z pliku** na stronie głównej. Ponowny import tego samego zbioru zastępuje go, zamiast tworzyć duplikat.
- **Udostępnij link** wysyła cały zbiór w linku, który otwiera się w aplikacji i zapisuje jednym stuknięciem.

**Biblioteka zbiorów (dla wszystkich użytkowników)**
- Zbiory wrzucone do folderu `zbiory/` w repozytorium widzi każdy na stronie głównej, w sekcji „Biblioteka zbiorów”. Wystarczy stuknąć **＋ Dodaj**.
- Jak opublikować zbiór:
  1. W aplikacji, w zbiorze: **⇪ Eksportuj do pliku**.
  2. Na GitHubie, w repozytorium (gałąź `main`): *Add file → Upload files*, wpisz folder `zbiory/` (np. przeciągnij plik i zmień nazwę na `zbiory/kanon-2.1.json`), *Commit changes*.
  3. Po publikacji (około minuty) zbiór pojawi się w bibliotece. Jeśli później podmienisz plik, użytkownicy zobaczą przy nim **↻ Aktualizuj**.
- Spis biblioteki (`zbiory/index.json`) tworzy się sam przy publikacji (`tools/build-library.mjs`).
- Zbiorów z biblioteki **nie można edytować** (🔒), żeby wszyscy uczyli się z tej samej wersji. Przycisk **⧉ Własna kopia** tworzy zwykły zbiór „… (moja kopia)”, który można dowolnie zmieniać. Zbiór z biblioteki zmienia się tylko przez **↻ Aktualizuj**, po zmianie pliku w repozytorium.
- Wbudowane zbiory: `zbiory/kanon-klasa-5-nr-1.json` – *Kanon klasa 5 nr 1* (15 utworów); `zbiory/kanon-klasa-6-cz1.json` – *Kanon klasa 6 cz1* (18 utworów, Pasja według św. Mateusza w 2 plikach).

## Klucz Google API (jednorazowo)

Aplikacja czyta Dysk Google przez oficjalne Google Drive API, więc potrzebny jest darmowy klucz API:

1. Wejdź na [console.cloud.google.com](https://console.cloud.google.com/) i utwórz projekt.
2. Otwórz **Interfejsy API i usługi → Biblioteka → Google Drive API → Włącz**.
3. Otwórz **Dane logowania → Utwórz dane logowania → Klucz interfejsu API**.
4. Ogranicz klucz: **Witryny** → `https://<użytkownik>.github.io/*`, **Ogranicz klucz** → Google Drive API.
5. Wpisz klucz w `js/config.js` (`GOOGLE_API_KEY`), żeby działał u wszystkich. Można go też wpisać w aplikacji: ⚙ Ustawienia.

Taki klucz może być jawny. Pozwala tylko czytać pliki, które już są udostępnione publicznie „przez link”, i działa tylko na stronie aplikacji.

## Aplikacja na telefon

Strona jest publikowana na GitHub Pages (workflow `.github/workflows/pages.yml` po każdym pushu do `main`). Jednorazowo trzeba włączyć: **Settings → Pages → Source: GitHub Actions**.

- **Android (Chrome):** baner „Zainstaluj” albo menu ⋮ → *Zainstaluj aplikację*.
- **iPhone/iPad (Safari):** *Udostępnij* → *Do ekranu początkowego*.
- **Komputer (Chrome/Edge):** ikona instalacji w pasku adresu.

Aplikacja uruchamia się bez internetu. Zbiory, wyniki, rozpoczęty quiz i szkic dodawania są zapamiętywane. Gdy pojawi się „Dostępna nowa wersja”, stuknij *Odśwież*. Nic nie zginie.

## Struktura

| Plik | Opis |
|---|---|
| `index.html`, `style.css` | strona i wygląd |
| `js/app.js` | ekrany: zbiory, dodawanie, odtwarzacz, quizy, wyniki, ustawienia |
| `js/textmatch.js` | odczyt listy z tekstu, dopasowanie do plików, sprawdzanie odpowiedzi |
| `js/drive.js` | Dysk Google (lista plików, odtwarzanie, pobieranie) |
| `js/ocr.js` | odczyt tekstu ze zdjęcia / PDF (usuwa ramki tabeli i kod QR) |
| `js/layout.js` | składanie odczytanego tekstu w kolumny tabeli (Autor / Tytuł / Część), łączenie zawiniętych komórek |
| `js/db.js` | pamięć urządzenia (IndexedDB) |
| `js/confetti.js` | nagroda 🎉 |
| `js/config.js` | wspólny klucz Google API |
| `js/pwa.js`, `sw.js`, `manifest.webmanifest`, `icons/` | instalacja, offline, aktualizacje |
| `tools/` | `build-sw.mjs` (wersja service workera przy publikacji), `build-library.mjs` (spis biblioteki zbiorów), `make-icons.cjs` (ikony z `icons/icon.svg`) |
| `zbiory/` | biblioteka zbiorów widoczna dla wszystkich (pliki wyeksportowane z aplikacji) |
| `tests/` | testy (`npm test`), m.in. na prawdziwej liście z `przyklady/` |
| `przyklady/` | przykładowe listy utworów (wzór dla odczytu) |
