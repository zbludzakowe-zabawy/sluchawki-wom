import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { layoutText } from '../js/layout.js';
import { parseList, matchAll } from '../js/textmatch.js';

// prawdziwy przykład: zrzut tabeli z Worda (przyklady/kanon-2.1.png) – słowa z położeniem z OCR
const ocr = JSON.parse(readFileSync(new URL('./fixtures/kanon-2.1-ocr.json', import.meta.url)));

// nazwy plików w formacie „Autor - Tytuł - Część.mp3” (jak na Dysku)
const FILES = [
  "Arcangelo Corelli - Concerto Grosso g-moll ''Na Boże Narodzenie'', op. 6 nr 8 - cz. 5. Pastorale.mp3",
  'Bedřich Smetana - opera Sprzedana narzeczona - Polka.mp3',
  'Franz Schubert - Erlkönig (Król elfów).mp3',
  'Fryderyk Chopin - Mazurek a-moll op. 68 nr 2.mp3',
  'Fryderyk Chopin - Polonez A-dur op. 40 nr 1.mp3',
  'Fryderyk Chopin - Preludium A-dur op. 28 nr 7.mp3',
  'Fryderyk Chopin - Życzenie.mp3',
  'Hector Berlioz - Symfonia fantastyczna - cz. 2. Na balu. Walc.mp3',
  'Jan Sebastian Bach - Das Wohltemperierte Klavier - tom 1 - Preludium C-dur.mp3',
  'Louis-Claude Daquin - Le Coucou (Kukułka).mp3',
  'Ludomir Różycki - balet Pan Twardowski - Krakowiak.mp3',
  'Siergiej Prokofiew - opera Miłość do trzech pomarańczy - Marsz.mp3',
  'Siergiej Prokofiew - Symfonia klasyczna - cz. 3. Gawot.mp3',
  'Stanisław Moniuszko - opera Halka - Mazur.mp3',
  "Wolfgang Amadeusz Mozart - Serenada G-dur KV525 ''Eine Kleine Nachtmusik'' - cz. 3. Menuet.mp3",
].map((name, i) => ({ id: 'f' + i, name }));

test('tabela z OCR → 15 utworów w dobrych kolumnach, bez śmieci z kodu QR', () => {
  const list = parseList(layoutText(ocr));
  assert.equal(list.length, 15);
  assert.deepEqual(list[0], { author: 'Arcangelo Corelli', title: 'Concerto Grosso g-moll "Na Boże Narodzenie" op. 6 nr 8', part: 'cz. 5. Pastorale' });
  assert.equal(list[2].part, ''); // Schubert – obok był kod QR
  assert.equal(list[5].title, 'Preludium A-dur op. 28 nr 7');
  assert.deepEqual(list[11], { author: 'Siergiej Prokofiew', title: 'opera Miłość do trzech pomarańczy', part: 'Marsz' });
  assert.deepEqual(list[14], { author: 'Wolfgang Amadeusz Mozart', title: 'Serenada G-dur KV525 "Eine Kleine Nachtmusic"', part: 'cz. 3. Menuet' });
  for (const t of list) assert.ok(!/[_[\]=|]/.test(t.part + t.title), JSON.stringify(t));
});

test('odczytana lista dopasowuje się do plików 1:1 (mimo literówek OCR)', () => {
  const list = parseList(layoutText(ocr));
  const shuffled = FILES.slice().reverse();
  const { result } = matchAll(list, shuffled);
  assert.deepEqual(result.map((r) => r.fileId), FILES.map((f) => f.id));
  for (const r of result) assert.ok(r.score >= 0.5, `${r.fileId} ${r.score}`);
});
