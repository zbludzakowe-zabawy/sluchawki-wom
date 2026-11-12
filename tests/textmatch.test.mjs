import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fold, tokens, parseLine, parseList, matchAll, matchScore, checkAnswer, checkAuthor, checkTitle, checkPart, explainField, answerSim, canonName,
  cleanFileName, trackFromFileName, shuffle, spreadOrder, questionCount,
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
  // część tytułu dobra – pokazujemy tylko braki, nie „Concerto – nie pasuje”
  assert.deepEqual(explainField('title', 'Concerto grosso', "Concerto Grosso g-moll ''Na Boże Narodzenie'', op. 6 nr 8"),
    ['g-moll', 'op', '6', '8'].map((fix) => ({ kind: 'missing', fix })));
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

test('liczba pytań i powtórki w quizie', () => {
  assert.equal(questionCount('75', 15), 11);
  assert.equal(questionCount('all', 15), 15);
  assert.equal(questionCount('150', 15), 23);
  assert.equal(questionCount('75', 1), 1);
  for (const n of [2, 3, 5, 15, 40]) {
    const ids = Array.from({ length: n }, (_, i) => 'u' + i);
    const extra = questionCount('150', n) - n;
    for (let k = 0; k < 50; k++) {
      const o = spreadOrder(ids, extra);
      assert.equal(o.length, n + extra);
      assert.deepEqual([...new Set(o)].sort(), [...ids].sort()); // każdy utwór co najmniej raz
      const cnt = {};
      for (const id of o) cnt[id] = (cnt[id] || 0) + 1;
      assert.ok(Object.values(cnt).every((c) => c <= 2));
      for (let i = 1; i < o.length; i++) assert.notEqual(o[i], o[i - 1], `raz za razem: ${o.join(' ')}`);
      if (n >= 5) { // powtórka co najmniej kilka pytań dalej
        const pos = {};
        o.forEach((id, i) => { if (id in pos) assert.ok(i - pos[id] >= 3, `za blisko: ${o.join(' ')}`); pos[id] = i; });
      }
    }
  }
});

test('shuffle zachowuje elementy', () => {
  const a = [1, 2, 3, 4, 5, 6];
  assert.deepEqual(shuffle(a).sort(), a);
});

test('parseList – uwagi w nawiasie [uwagi: …] są osobnym polem', () => {
  const list = parseList('1.\tChopin\tMazurek a-moll op. 68 nr 2\t\t[uwagi: nagranie bez repetycji]\n2. Bach – Suita nr 3, cz. II Air [uwaga: tylko temat]\n   [uwagi: do poprawki]\n');
  assert.equal(list.length, 2);
  assert.deepEqual(list[0], { author: 'Chopin', title: 'Mazurek a-moll op. 68 nr 2', part: '', note: 'nagranie bez repetycji' });
  assert.equal(list[1].part, 'cz. II Air');
  assert.equal(list[1].note, 'tylko temat do poprawki');
  assert.deepEqual(parseLine('Bach – Suita nr 3'), { author: 'Bach', title: 'Suita nr 3', part: '' });
});

test('fixOcr – typowe błędy odczytu', async () => {
  const { fixOcr } = await import('../js/textmatch.js');
  assert.equal(fixOcr('Ananim', 'author'), 'Anonim');
  assert.equal(fixOcr('Georg Friedrich Handel', 'author'), 'Georg Friedrich Händel');
  assert.equal(fixOcr('gratorium Mesjasz'), 'oratorium Mesjasz');
  assert.equal(fixOcr('Ill Koncert brandenburski G-dur'), 'III Koncert brandenburski G-dur');
  assert.equal(fixOcr('XX Koncert fortepianowy d-moli KV466'), 'XX Koncert fortepianowy d-moll KV466');
  assert.equal(fixOcr('Kwartet nr 7 »Razumowski”'), 'Kwartet nr 7 „Razumowski”');
  assert.equal(fixOcr('SZ. 1. Allegro', 'part'), 'cz. 1. Allegro');
  assert.equal(fixOcr('gz. 3. Allegro vivace', 'part'), 'cz. 3. Allegro vivace');
  assert.equal(fixOcr('nr 44. Alleluja,', 'part'), 'nr 44. Alleluja');
  // bez zmian: poprawne słowa, odmiany, włoskie „Il”
  assert.equal(fixOcr('Il barbiere di Siviglia'), 'Il barbiere di Siviglia');
  assert.equal(fixOcr('IX Symfonii d-moll'), 'IX Symfonii d-moll');
  assert.equal(fixOcr('Serenada G-dur KV525'), 'Serenada G-dur KV525');
});

test('fixFromFileName – poprawki według nazwy pliku', async () => {
  const { fixFromFileName } = await import('../js/textmatch.js');
  const r = { author: 'Franz Schubert', title: 'Małgorzata przy kotowrotku', part: '' };
  assert.equal(fixFromFileName(r, 'Franz Schubert - Małgorzata przy kołowrotku.mp3'), 1);
  assert.equal(r.title, 'Małgorzata przy kołowrotku');
  const b = { author: 'Bedfigh Smetana', title: 'opera Sprzedana narzeczona', part: 'Polka' };
  fixFromFileName(b, 'Bedřich Smetana - opera Sprzedana narzeczona - Polka.mp3');
  assert.equal(b.author, 'Bedřich Smetana');
  const k = { author: 'Ludwig van Beethoven', title: 'Kwartet smyczkowy nr 7 F-dur op. 59 nr 1 „Bazumowski”', part: 'cz. 1' };
  fixFromFileName(k, 'Ludwig van Beethoven - Kwartet smyczkowy nr 7 F-dur op. 59 nr 1 Razumowski - cz. 1.mp3');
  assert.equal(k.title, 'Kwartet smyczkowy nr 7 F-dur op. 59 nr 1 „Razumowski”');
  // słowa wyraźnie inne (nie literówka) zostają
  const c = { author: 'Chopin', title: 'Mazurek a-moll', part: '' };
  assert.equal(fixFromFileName(c, 'Fryderyk Chopin - Mazurek op. 68.mp3'), 0);
});
