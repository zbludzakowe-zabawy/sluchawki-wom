import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fold, tokens, parseLine, parseList, matchAll, matchScore, checkAnswer, checkAuthor, checkTitle, checkPart,
  cleanFileName, trackFromFileName, shuffle,
} from '../js/textmatch.js';

test('fold i tokens', () => {
  assert.equal(fold('Łącko Żółć'), 'lacko zolc');
  assert.deepEqual(tokens('Koncert brandenburski nr III'), ['koncert', 'brandenburski', '3']);
  assert.deepEqual(tokens('Preludium i fuga cz. I'), ['preludium', 'fuga', '1']);
  assert.deepEqual(tokens('BWV1047'), ['bwv', '1047']);
});

test('parseLine – różne formaty', () => {
  assert.deepEqual(parseLine('1. J.S. Bach – Koncert brandenburski nr 3 G-dur, cz. I'),
    { author: 'J.S. Bach', title: 'Koncert brandenburski nr 3 G-dur', part: 'cz. I' });
  assert.deepEqual(parseLine('F. Chopin - Polonez A-dur op. 40 nr 1'),
    { author: 'F. Chopin', title: 'Polonez A-dur op. 40 nr 1', part: '' });
  assert.deepEqual(parseLine('W.A. Mozart\tEine kleine Nachtmusik\tcz. 1'),
    { author: 'W.A. Mozart', title: 'Eine kleine Nachtmusik', part: 'cz. 1' });
  assert.deepEqual(parseLine('3) Vivaldi | Cztery pory roku – Wiosna | cz. I Allegro'),
    { author: 'Vivaldi', title: 'Cztery pory roku – Wiosna', part: 'cz. I Allegro' });
  assert.deepEqual(parseLine('Moniuszko: Straszny dwór, fragment – Mazur'),
    { author: 'Moniuszko', title: 'Straszny dwór', part: 'fragment – Mazur' });
  assert.equal(parseLine('Lp.  Autor   Tytuł   Część'), null);
  assert.equal(parseLine(''), null);
});

test('parseList łączy zawinięte linie', () => {
  const list = parseList('1. Bach – Suita orkiestrowa nr 3\n   (cz. II Air)\n2. Händel – Mesjasz, Alleluja\n');
  assert.equal(list.length, 2);
  assert.equal(list[0].author, 'Bach');
  assert.equal(list[0].part, 'cz. II Air');
  assert.equal(list[1].title, 'Mesjasz, Alleluja');
  assert.equal(list[1].part, '');
});

test('parseList – tekst z OCR tabeli', () => {
  const list = parseList(`KANON 2.1 — wstęp do form, tańce
Lp. |       Autor                       Tytuł                |       Część
1. J.S.Bach         Suita orkiestrowa nr 3 D-dur Air
2. E.Chopin         Polonez A-dur op. 40 nr 1
3. S.Moniuszko Straszny dwór                      Mazur
4. W.A.Mozart Eine kleine Nachtmusik         cz. 1
5. P.Czajkowski Dziadek do orzechów            Walc kwiatów`);
  assert.deepEqual(list, [
    { author: 'J.S.Bach', title: 'Suita orkiestrowa nr 3 D-dur Air', part: '' },
    { author: 'E.Chopin', title: 'Polonez A-dur op. 40 nr 1', part: '' },
    { author: 'S.Moniuszko', title: 'Straszny dwór', part: 'Mazur' },
    { author: 'W.A.Mozart', title: 'Eine kleine Nachtmusik', part: 'cz. 1' },
    { author: 'P.Czajkowski', title: 'Dziadek do orzechów', part: 'Walc kwiatów' },
  ]);
});

test('parseList pomija nagłówek nad numerowaną listą', () => {
  const list = parseList('KANON 2.1 – wstęp do form, tańce\nLp. Autor Tytuł\n1. Bach – Air\n2. Chopin – Polonez A-dur\n');
  assert.deepEqual(list.map((t) => t.author), ['Bach', 'Chopin']);
});

test('cleanFileName i trackFromFileName', () => {
  assert.equal(cleanFileName('03 - Chopin - Polonez A-dur.mp3'), 'Chopin - Polonez A-dur');
  assert.equal(cleanFileName('12_Bach_Air.mp3'), 'Bach Air');
  assert.deepEqual(trackFromFileName('07. Mozart - Requiem - Lacrimosa.mp3'),
    { author: 'Mozart', title: 'Requiem', part: 'Lacrimosa' });
});

test('dopasowanie wybiera właściwe pliki, także z literówkami i bez polskich znaków', () => {
  const tracks = [
    { author: 'J.S. Bach', title: 'Koncert brandenburski nr 3', part: 'cz. I' },
    { author: 'J.S. Bach', title: 'Koncert brandenburski nr 5', part: 'cz. I' },
    { author: 'F. Chopin', title: 'Polonez A-dur op. 40 nr 1', part: '' },
    { author: 'S. Moniuszko', title: 'Straszny dwór', part: 'Mazur' },
    { author: 'K. Penderecki', title: 'Tren', part: '' },
  ];
  const files = [
    { id: 'a', name: '01 Bach - Brandenburgisches Konzert 5 - 1.mp3' },
    { id: 'b', name: '02 Bach - Koncert brandenburski 3 cz 1.mp3' },
    { id: 'c', name: 'Chopin Polonez A dur op40 nr1.mp3' },
    { id: 'd', name: 'Moniuszko - Straszny dwor - mazur.mp3' },
    { id: 'e', name: 'Szymanowski - Harnasie.mp3' },
  ];
  const { result } = matchAll(tracks, files);
  assert.deepEqual(result.map((r) => r.fileId), ['b', 'a', 'c', 'd', null]);
  assert.ok(matchScore(tracks[3], files[3].name) > 0.7);
});

test('quiz tekstowy – sprawdzanie odpowiedzi', () => {
  const t = { author: 'Fryderyk Chopin', title: 'Polonez A-dur op. 40 nr 1', part: '' };
  assert.equal(checkAnswer({ author: 'fryderyk chopin', title: 'polonez a-dur op 40 nr 1', part: '' }, t).ok, true);
  assert.equal(checkAnswer({ author: 'Chopin', title: 'Polonez A-dur op.40 nr.1', part: '' }, t).ok, true);
  assert.equal(checkAnswer({ author: 'Szopen', title: 'Polonez A-dur op. 40 nr 1', part: '' }, t).author, false);
  assert.equal(checkAnswer({ author: 'Chopin', title: 'Polonez A-dur op. 40 nr 2', part: '' }, t).title, false);
  assert.equal(checkAnswer({ author: 'Chopin', title: 'Polonez A-dur op. 40 nr 1', part: 'cz. 1' }, t).part, false);
  assert.equal(checkAuthor('F. Chopin', 'Fryderyk Chopin'), true);
  assert.equal(checkAuthor('Jan Chopin', 'Fryderyk Chopin'), false);
  assert.equal(checkAuthor('Chopn', 'Fryderyk Chopin'), true); // literówka
  assert.equal(checkTitle('Koncert brandenburski', 'Koncert brandenburski nr 3'), false);
  assert.equal(checkPart('I', 'cz. 1'), true);
  assert.equal(checkPart('cz. 2', 'cz. I'), false);
  assert.equal(checkPart('', 'cz. I'), false);
  assert.equal(checkPart('allegro', 'cz. I Allegro'), true); // sama nazwa części wystarczy
  assert.equal(checkPart('cz. 2 allegro', 'cz. I Allegro'), false);
  assert.equal(checkPart('Pastorale', 'cz. 5. Pastorale'), true);
  assert.equal(checkPart('Preludium C-dur', 'tom 1 - Preludium C-dur'), true);
  assert.equal(checkPart('Menuet', 'cz. 3. Gawot'), false);
  assert.equal(checkTitle('Halka', 'opera Halka'), true);
  assert.equal(checkTitle('opera Halka', 'opera Halka'), true);
  assert.equal(checkTitle('Król elfów', 'Erlkönig (Król elfów)'), true);
  assert.equal(checkTitle('erlkonig', 'Erlkönig (Król elfów)'), true);
  assert.equal(checkTitle('Eine kleine Nachtmusik', 'Serenada G-dur KV525 „Eine Kleine Nachtmusik”'), true);
  assert.equal(checkTitle('Serenada G-dur KV 525', 'Serenada G-dur KV525 „Eine Kleine Nachtmusik”'), true);
  assert.equal(checkTitle('Concerto grosso g-moll op. 6 nr 8', 'Concerto Grosso g-moll „Na Boże Narodzenie” op. 6 nr 8'), true);
  assert.equal(checkTitle('Mazurek a-moll op. 68 nr 2', 'Polonez A-dur op. 40 nr 1'), false);
  assert.equal(checkTitle('Symfonia', 'Symfonia fantastyczna'), false);
  assert.equal(checkPart('1 allegro', 'cz. I Allegro'), true);
  assert.equal(checkPart('Mazur', 'Mazur'), true);
});

test('shuffle zachowuje elementy', () => {
  const a = [1, 2, 3, 4, 5, 6];
  assert.deepEqual(shuffle(a).sort(), a);
});
