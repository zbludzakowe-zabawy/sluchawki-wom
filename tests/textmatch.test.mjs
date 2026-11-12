import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fold, tokens, parseLine, parseList, matchAll, matchScore, checkAnswer, checkAuthor, checkTitle, checkPart, explainField, answerSim, canonName,
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

test('quiz tekstowy – literówki przechodzą, liczby muszą się zgadzać', () => {
  assert.equal(checkAuthor('Chpoin', 'Fryderyk Chopin'), true); // zamienione litery
  assert.equal(checkAuthor('Moniuszo', 'Stanisław Moniuszko'), true);
  assert.equal(checkAuthor('Czajkowsky', 'Piotr Czajkowski'), true);
  assert.equal(checkAuthor('Bahc', 'Johann Sebastian Bach'), true);
  assert.equal(checkAuthor('Bach', 'Georg Friedrich Händel'), false);
  assert.equal(checkAuthor('Mozart', 'Joseph Haydn'), false);
  assert.equal(checkTitle('Strasny dwor', 'opera Straszny dwór'), true);
  assert.equal(checkTitle('Konsert brandenburki nr 3', 'Koncert brandenburski nr 3'), true);
  assert.equal(checkTitle('Konsert brandenburki nr 4', 'Koncert brandenburski nr 3'), false);
  assert.equal(checkTitle('Serenada G-dur KV 526', 'Serenada G-dur KV525 „Eine Kleine Nachtmusik”'), false);
  assert.equal(checkPart('cz. 1 Alegro', 'cz. I Allegro'), true);
  assert.equal(answerSim('12', '13'), 0);
});

test('quiz tekstowy – pokazanie pomyłek', () => {
  assert.deepEqual(explainField('author', 'Fryderyk Chpoin', 'Fryderyk Chopin'), [{ kind: 'typo', given: 'Chpoin', fix: 'Chopin' }]);
  assert.deepEqual(explainField('author', 'F. Chopin', 'Fryderyk Chopin'), []);
  assert.deepEqual(explainField('author', 'Fryderyk', 'Fryderyk Chopin'), [{ kind: 'missing', fix: 'Chopin' }]);
  assert.deepEqual(explainField('title', 'Polnez A-dur op.40 nr 2', 'Polonez A-dur op. 40 nr 1'),
    [{ kind: 'typo', given: 'Polnez', fix: 'Polonez' }, { kind: 'wrong', given: '2', fix: '1' }]);
  assert.deepEqual(explainField('title', 'Koncert brandenburski', 'Koncert brandenburski nr 3'), [{ kind: 'missing', fix: '3' }]);
  // porównanie z wariantem bez dopisku – nie wypisujemy „brakuje Na Boże Narodzenie”
  assert.deepEqual(explainField('title', 'Concerto grosso g-moll op. 6 nr 9', "Concerto Grosso g-moll ''Na Boże Narodzenie'', op. 6 nr 8"),
    [{ kind: 'wrong', given: '9', fix: '8' }]);
  assert.deepEqual(explainField('title', 'Halka', 'opera Halka'), []);
  assert.deepEqual(explainField('part', 'II Alegro', 'cz. I Allegro'),
    [{ kind: 'wrong', given: 'II', fix: 'I' }, { kind: 'typo', given: 'Alegro', fix: 'Allegro' }]);
  assert.deepEqual(explainField('part', 'Pastorale', 'cz. 5. Pastorale'), []);
  assert.deepEqual(explainField('part', '', 'cz. 5. Pastorale'), [{ kind: 'empty' }]);
  assert.deepEqual(explainField('part', 'cz. 2', ''), [{ kind: 'nopart' }]);
  assert.deepEqual(explainField('part', '', ''), []);
});

test('quiz tekstowy – tonacje: wielka litera = dur, mała = moll', () => {
  const t = 'Polonez A-dur op. 40 nr 1';
  assert.equal(checkTitle('Polonez A op. 40 nr 1', t), true);
  assert.equal(checkTitle('polonez a dur op 40 nr 1', t), true);
  assert.equal(checkTitle('Polonez op. 40 nr 1', t), false); // tonacja z listy jest obowiązkowa
  assert.equal(checkTitle('Polonez op.40 nr 1 A', t), true); // kolejność dowolna
  assert.equal(checkTitle('Polonez op. 40 nr 1 A-dur', t), true);
  assert.deepEqual(explainField('title', 'Polonez op. 40 nr 1', t), [{ kind: 'missing', fix: 'A-dur' }]);
  assert.equal(checkTitle('Na Boże Narodzenie', 'Concerto Grosso g-moll „Na Boże Narodzenie” op. 6 nr 8'), true); // sam dopisek
  assert.deepEqual(explainField('title', 'Na Boże Narodzenie', 'Concerto Grosso g-moll „Na Boże Narodzenie” op. 6 nr 8'),
    [{ kind: 'keymissing', fix: 'g-moll' }, { kind: 'fulltitle', fix: 'Concerto Grosso g-moll «Na Boże Narodzenie» op. 6 nr 8' }]); // zaliczone, ale z przypomnieniem
  assert.deepEqual(explainField('title', 'Concerto grosso g op. 6 nr 8', 'Concerto Grosso g-moll „Na Boże Narodzenie” op. 6 nr 8'),
    [{ kind: 'fulltitle', fix: 'Concerto Grosso g-moll «Na Boże Narodzenie» op. 6 nr 8' }]);
  assert.equal(checkPart('1', 'tom 1 - Preludium C-dur'), true); // sam numer części
  assert.equal(checkPart('Preludium', 'tom 1 - Preludium C-dur'), false);
  assert.equal(checkTitle('Polonez a op. 40 nr 1', t), false); // „a” = a-moll
  assert.equal(checkTitle('Polonez C-dur op. 40 nr 1', t), false);
  assert.equal(checkTitle('Polonez a-moll op. 40 nr 1', t), false);
  assert.equal(checkTitle('Concerto grosso g op. 6 nr 8', 'Concerto Grosso g-moll „Na Boże Narodzenie” op. 6 nr 8'), true);
  assert.equal(checkTitle('Concerto grosso G op. 6 nr 8', 'Concerto Grosso g-moll „Na Boże Narodzenie” op. 6 nr 8'), false);
  assert.equal(checkTitle('Preludium Fis', 'Preludium Fis-dur'), true);
  assert.equal(checkTitle('Preludium fis', 'Preludium Fis-dur'), false);
  assert.equal(checkTitle('Msza h', 'Msza h-moll'), true);
  assert.equal(checkPart('Preludium C', 'tom 1 - Preludium C-dur'), true);
  assert.equal(checkPart('Preludium c', 'tom 1 - Preludium C-dur'), false);
  assert.deepEqual(explainField('title', 'Polonez a op. 40 nr 1', t), [{ kind: 'wrong', given: 'a', fix: 'A-dur', key: true }]);
  assert.deepEqual(explainField('title', 'Polonez A op. 40 nr 1', t), []);
  assert.deepEqual(explainField('title', 'Polonez A dur op. 40 nr 1', t), []);
});

test('quiz tekstowy – tytuł po polsku i w oryginale', () => {
  assert.equal(checkTitle('Król elfów', 'Erlkönig (Król elfów)'), true);
  assert.equal(checkTitle('Kukułka', 'Le Coucou (Kukułka)'), true);
  assert.equal(checkTitle('Le Coucou', 'Le Coucou (Kukułka)'), true);
  assert.equal(checkTitle('Wełtawa', 'Die Moldau / Wełtawa'), true);
  assert.equal(checkTitle('Die Moldau', 'Die Moldau / Wełtawa'), true);
  assert.deepEqual(explainField('title', 'Król elfów', 'Erlkönig (Król elfów)'), [{ kind: 'fulltitle', fix: 'Erlkönig (Król elfów)' }]);
  assert.deepEqual(explainField('title', 'Krol elfow', 'Erlkönig (Król elfów)'), [{ kind: 'fulltitle', fix: 'Erlkönig (Król elfów)' }]);
  assert.deepEqual(explainField('title', 'Wełtawa', 'Die Moldau / Wełtawa'), [{ kind: 'fulltitle', fix: 'Die Moldau / Wełtawa' }]);
  assert.deepEqual(explainField('title', 'Erlkönig (Król elfów)', 'Erlkönig (Król elfów)'), []);
  assert.deepEqual(explainField('title', 'Erlkonig Krol elfow', 'Erlkönig (Król elfów)'), []);
  assert.deepEqual(explainField('title', 'Halka', 'opera Halka'), []);
  assert.deepEqual(explainField('title', 'Na Boże Narodzenie', "Concerto Grosso g-moll ''Na Boże Narodzenie'', op. 6 nr 8").at(-1),
    { kind: 'fulltitle', fix: 'Concerto Grosso g-moll «Na Boże Narodzenie», op. 6 nr 8' });
  assert.deepEqual(explainField('title', 'Król Lear', 'Erlkönig (Król elfów)').some((n) => n.kind === 'fulltitle'), false); // błąd – bez tej uwagi
});

test('quiz tekstowy – imiona w różnych językach', () => {
  assert.equal(checkAuthor('Johann Sebastian Bach', 'Jan Sebastian Bach'), true);
  assert.equal(checkAuthor('Johan Sebastian Bach', 'Jan Sebastian Bach'), true);
  assert.equal(checkAuthor('Jan Sebastian Bach', 'Johann Sebastian Bach'), true);
  assert.equal(checkAuthor('Johhan Bach', 'Jan Sebastian Bach'), true); // literówka w imieniu
  assert.equal(checkAuthor('J. S. Bach', 'Jan Sebastian Bach'), true);
  assert.equal(checkAuthor('Wolfgang Amadeus Mozart', 'Wolfgang Amadeusz Mozart'), true);
  assert.equal(checkAuthor('Sergei Prokofiew', 'Siergiej Prokofiew'), true);
  assert.equal(checkAuthor('Frédéric Chopin', 'Fryderyk Chopin'), true);
  assert.equal(checkAuthor('G. F. Händel', 'Jerzy Fryderyk Händel'), true); // inicjały oryginalnych imion
  assert.equal(checkAuthor('Georg Friedrich Händel', 'Jerzy Fryderyk Händel'), true);
  assert.equal(checkAuthor('Karl Bach', 'Jan Sebastian Bach'), false); // inne imię
  assert.equal(checkAuthor('Piotr Bach', 'Jan Sebastian Bach'), false);
  assert.equal(canonName('bach'), 'bach');
  assert.deepEqual(explainField('author', 'Johan Sebastian Bach', 'Jan Sebastian Bach'), []);
  assert.deepEqual(explainField('author', 'G. F. Händel', 'Jerzy Fryderyk Händel'), []);
  assert.deepEqual(explainField('author', 'Karl Bach', 'Jan Sebastian Bach'), [{ kind: 'wrong', given: 'Karl' }]);
});

test('shuffle zachowuje elementy', () => {
  const a = [1, 2, 3, 4, 5, 6];
  assert.deepEqual(shuffle(a).sort(), a);
});
