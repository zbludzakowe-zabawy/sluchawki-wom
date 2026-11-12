// Słuchawki – tekst: normalizacja, odczyt listy utworów, dopasowanie do plików, sprawdzanie odpowiedzi.
// Moduł bez zależności od przeglądarki – testowany w Node (tests/textmatch.test.mjs).

const PL = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' };

/** małe litery, bez polskich znaków i akcentów */
export function fold(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/g, (c) => PL[c])
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss');
}

const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12, xiii: 13, xiv: 14, xv: 15 };
// „i” i „v” to też zwykłe słowa – traktujemy je jak liczby tylko po takich słowach:
const NUM_CONTEXT = new Set(['cz', 'czesc', 'czes', 'part', 'nr', 'no', 'mov', 'akt', 'ks', 'ksiega', 'tom', 'op', 'bwv', 'kv', 'k', 'hob']);
const STOP = new Set([
  'mp3', 'm4a', 'wav', 'flac', 'ogg', 'aac', 'wma',
  'cz', 'czesc', 'czes', 'nr', 'no', 'fragment', 'fragm', 'frag', 'fr', 'part', 'the', 'a', 'an', 'of',
  'i', 'w', 'z', 'na', 'do', 'oraz', 'und', 'et', 'le', 'la', 'de', 'des', 'der', 'die', 'das', 'il',
]);

/** tokeny: słowa i liczby (rzymskie zamienione na arabskie, „bwv1047” → „bwv”, „1047”) */
export function tokens(s, { keepStop = false, roman = false } = {}) {
  const raw = fold(s)
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/([a-z])(\d)/g, '$1 $2')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    let t = raw[i];
    const prev = raw[i - 1];
    if (ROMAN[t] && (roman || (t.length > 1 && t !== 'vi') || NUM_CONTEXT.has(prev))) t = String(ROMAN[t]);
    if (/^\d+$/.test(t)) t = String(Number(t));
    if (!keepStop && STOP.has(t)) continue;
    out.push(t);
  }
  return out;
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

const isNum = (t) => /^\d+$/.test(t);

/** podobieństwo dwóch słów 0..1 (liczby muszą być równe) */
export function wordSim(a, b) {
  if (a === b) return 1;
  if (isNum(a) || isNum(b)) return 0;
  const short = a.length < b.length ? a : b;
  const long = a.length < b.length ? b : a;
  if (short.length >= 4 && long.startsWith(short)) return 0.85; // skróty: „brandenb.”
  const d = levenshtein(a, b);
  const max = long.length;
  if (max >= 8 && d <= 2) return 1 - d / max;
  if (max >= 4 && d <= 1) return 1 - d / max;
  return 0;
}

const bestIn = (t, list) => {
  let best = 0;
  for (const u of list) {
    const s = wordSim(t, u);
    if (s > best) best = s;
    if (best === 1) break;
  }
  return best;
};

/** nazwisko = ostatni wyraz autora dłuższy niż 1 litera („J.S. Bach” → „bach”) */
export function surname(author) {
  const t = tokens(author, { keepStop: true }).filter((x) => x.length > 1 && !isNum(x));
  return t.length ? t[t.length - 1] : '';
}

/** nazwa pliku bez rozszerzenia i bez numeru porządkowego na początku */
export function cleanFileName(name) {
  return String(name || '')
    .replace(/\.[a-z0-9]{2,4}$/i, '')
    .replace(/^\s*\d{1,3}\s*[-._)\]]?\s+/, '')
    .replace(/^\s*\d{1,3}\s*[-._)\]]\s*/, '')
    .replace(/_/g, ' ')
    .trim();
}

/** ocena dopasowania utworu do pliku: 0..1 */
const fileTokCache = new Map();
function fileTokens(name) {
  let t = fileTokCache.get(name);
  if (!t) {
    t = tokens(cleanFileName(name));
    if (fileTokCache.size > 5000) fileTokCache.clear();
    fileTokCache.set(name, t);
  }
  return t;
}

export function matchScore(track, fileName) {
  const f = fileTokens(fileName);
  if (!f.length) return 0;
  const sur = surname(track.author);
  const authorRest = tokens(track.author).filter((t) => t !== sur && t.length > 1);
  const titleT = tokens(track.title);
  const partT = tokens(track.part, { roman: true });
  const weighted = [];
  if (sur) weighted.push([sur, 3]);
  for (const t of authorRest) weighted.push([t, 0.5]);
  for (const t of titleT) weighted.push([t, isNum(t) ? 1.5 : 1]);
  for (const t of partT) weighted.push([t, isNum(t) ? 1.5 : 0.8]);
  if (!weighted.length) return 0;
  let got = 0;
  let total = 0;
  for (const [t, w] of weighted) {
    total += w;
    got += w * bestIn(t, f);
  }
  const recall = got / total;
  const all = weighted.map(([t]) => t);
  let fileHit = 0;
  for (const t of f) fileHit += bestIn(t, all) > 0 ? 1 : 0;
  const precision = fileHit / f.length;
  // liczby w pliku, których nie ma w opisie utworu (np. inna część) – kara
  const trackNums = new Set(all.filter(isNum));
  const extraNums = f.filter((t) => isNum(t) && !trackNums.has(t)).length;
  let s = 0.75 * recall + 0.25 * precision - 0.12 * Math.min(extraNums, 3);
  if (sur && bestIn(sur, f) === 0) s -= 0.15; // brak nazwiska autora
  return Math.max(0, Math.min(1, s));
}

export const MATCH_MIN = 0.35;

/**
 * Dopasowuje utwory do plików (każdy plik najwyżej raz): zachłannie od najlepszych par.
 * Zwraca tablicę { fileId|null, score } w kolejności utworów oraz ranking plików dla każdego utworu.
 */
export function matchAll(tracks, files) {
  const scores = tracks.map((t) => files.map((f) => matchScore(t, f.name)));
  const pairs = [];
  scores.forEach((row, i) => row.forEach((s, j) => { if (s >= MATCH_MIN) pairs.push([s, i, j]); }));
  pairs.sort((a, b) => b[0] - a[0]);
  const usedT = new Set();
  const usedF = new Set();
  const result = tracks.map(() => ({ fileId: null, score: 0 }));
  for (const [s, i, j] of pairs) {
    if (usedT.has(i) || usedF.has(j)) continue;
    usedT.add(i);
    usedF.add(j);
    result[i] = { fileId: files[j].id, score: s };
  }
  const ranking = scores.map((row) => row
    .map((s, j) => ({ id: files[j].id, score: s }))
    .sort((a, b) => b.score - a.score));
  return { result, ranking };
}

export function confidence(score) {
  if (score >= 0.7) return 'high';
  if (score >= 0.5) return 'mid';
  return 'low';
}

// ---------- odczyt listy utworów z tekstu (OCR albo wklejonego) ----------

const HEADER = /^(l\.?\s*p\.?|lp|nr|autor|kompozytor|tytu[lł]|utw[oó]r|cz[eę][sś][cć]|fragment)\b/i;
const PART_RE = /(?:^|[\s,;(–—-]+)((?:cz\.|cz[eę][sś][cć]|fragm?\.?|fragment|part)\s*.*)$/i;
const ROMAN_PART_RE = /[,;]\s*((?:[IVX]{1,4})\.?\s+[^,;]*)$/;

const UP = 'A-ZĄĆĘŁŃÓŚŹŻÄÖÜÉÈÁÍČŘŠŽ';
const INITIALS_AUTHOR = new RegExp(`^(?:[${UP}][a-z]?\\.\\s?){1,3}[${UP}][\\p{Ll}'’-]+(?:-[${UP}][\\p{Ll}]+)?(?=\\s|$)`, 'u');
const clean = (s) => String(s || '').replace(/\s+/g, ' ').replace(/^[\s,;:–—|-]+|[\s,;:–—|-]+$/g, '').trim();

/** wydziela część/fragment z końca tytułu */
export function splitPart(title) {
  let t = clean(title);
  const m = t.match(PART_RE);
  if (m && m.index > 0) return { title: clean(t.slice(0, m.index)), part: clean(m[1]) };
  const r = t.match(ROMAN_PART_RE);
  if (r) return { title: clean(t.slice(0, r.index)), part: clean(r[1]) };
  const paren = t.match(/\(([^)]*(?:cz\.|cz[eę][sś][cć]|fragm)[^)]*)\)\s*$/i);
  if (paren) return { title: clean(t.slice(0, paren.index)), part: clean(paren[1]) };
  return { title: t, part: '' };
}

// uwagi do utworu (np. dopisane na liście na czerwono) – w tekście listy jako „[uwagi: …]”;
// nie są częścią tytułu ani fragmentu i nie biorą udziału w dopasowaniu ani w quizie
const NOTE_RE = /\[\s*uwag[ai]\s*:\s*([^\]]*)\]?/gi;
/** wydziela uwagi z linii: { text: linia bez uwag, note } */
export function splitNote(line) {
  const notes = [];
  const text = String(line || '').replace(NOTE_RE, (m, n) => { if (clean(n)) notes.push(clean(n)); return ' '; });
  return { text, note: notes.join('; ') };
}

/** jedna linia → { author, title, part[, note] } albo null */
export function parseLine(line) {
  const { text, note } = splitNote(line);
  const p = parseCols(text);
  if (p && note) p.note = note;
  return p;
}

function parseCols(line) {
  let s = String(line || '').replace(/[“”„"]/g, '"').replace(/\s+$/, '');
  s = s.replace(/^\s*(\d{1,3}\s*[.)\]:]|[a-z]\))\s*/i, '').replace(/^\s*\d{1,3}\s+(?=\D)/, '');
  if (!clean(s) || clean(s).length < 3) return null;
  if (HEADER.test(clean(s)) && clean(s).split(/\s+/).length <= 6 && !/[–—-]/.test(s)) return null;
  // kolumny: tabulator, | albo co najmniej 2 spacje (tekst z OCR tabeli)
  let cols = s.split(/\t+|\s*\|\s*|\s{2,}/).map(clean).filter(Boolean);
  // „J.S.Bach Suita…”, „W.A. Mozart Eine…” – autor z inicjałami, a za nim (bez odstępu kolumny) tytuł
  const ini = clean(cols[0] || '').match(INITIALS_AUTHOR);
  if (ini && clean(cols[0]).length > ini[0].length + 1 && !/^\s*[–—:-]/.test(clean(cols[0]).slice(ini[0].length))) {
    cols.splice(0, 1, ini[0].trim(), clean(cols[0]).slice(ini[0].length));
  }
  const colon = s.indexOf(':');
  const dash = s.search(/\s[–—-]\s|[–—]/);
  if (cols.length < 2 && colon > 0 && colon < 40 && (dash < 0 || colon < dash)) {
    cols = [s.slice(0, colon), s.slice(colon + 1)].map(clean).filter(Boolean);
    if (cols.length === 2) {
      const sp = splitPart(cols[1]);
      return { author: cols[0], title: sp.title, part: sp.part };
    }
  }
  if (cols.length < 2) cols = s.split(/\s+[–—-]\s+|\s*[–—]\s*/).map(clean).filter(Boolean);
  if (cols.length < 2) {
    // „Bach Koncert …” – nie wiadomo, gdzie kończy się autor
    const sp = splitPart(s);
    return { author: '', title: sp.title, part: sp.part };
  }
  const author = cols[0];
  if (cols.length >= 3) {
    const rest = cols.slice(1);
    const last = rest[rest.length - 1];
    const looksPart = /^(cz|cz[eę][sś][cć]|fragm|fragment|part|[IVX]{1,4}\b|\d+\.)/i.test(last) || rest.length >= 2;
    if (looksPart) return { author, title: clean(rest.slice(0, -1).join(', ')), part: clean(last) };
  }
  const sp = splitPart(cols.slice(1).join(' – '));
  return { author, title: sp.title, part: sp.part };
}

/** cały tekst → lista utworów; linia bez autora zaczynająca się małą literą łączona z poprzednią */
const NUMBERED = /^\s*\d{1,3}\s*[.)\]:]?\s+\S/;

export function parseList(text) {
  const out = [];
  const lines = String(text || '').split(/\r?\n/);
  // gdy lista jest numerowana, linie przed pierwszym numerem to nagłówek (tytuł listy itp.)
  const firstNum = lines.findIndex((l) => NUMBERED.test(l));
  const numbered = lines.filter((l) => NUMBERED.test(l)).length >= 2;
  for (const [i, line] of lines.entries()) {
    if (!line.trim()) continue;
    if (numbered && i < firstNum) continue;
    const prev = out[out.length - 1];
    const { text: rest, note } = splitNote(line);
    // linia z samymi uwagami – dopisujemy je do poprzedniego utworu
    if (note && !clean(rest)) {
      if (prev) prev.note = prev.note ? `${prev.note} ${note}` : note;
      continue;
    }
    const p = parseLine(line);
    if (!p) continue;
    if (prev && !p.author && /^[a-ząćęłńóśźż(]/.test(line.trim())) {
      if (p.note) prev.note = prev.note ? `${prev.note} ${p.note}` : p.note;
      if (p.part && !prev.part) { prev.title = clean(prev.title + ' ' + p.title); prev.part = p.part; }
      else if (p.title) {
        const sp = splitPart(prev.title + ' ' + p.title + (p.part ? ' ' + p.part : ''));
        prev.title = sp.title;
        prev.part = sp.part || prev.part;
      }
      continue;
    }
    out.push(p);
  }
  return out;
}

/** opis z samej nazwy pliku („Bach - Koncert brandenburski nr 3 - cz. 1.mp3”) */
export function trackFromFileName(name) {
  const p = parseLine(cleanFileName(name));
  return p || { author: '', title: cleanFileName(name), part: '' };
}

// ---------- sprawdzanie odpowiedzi w quizie tekstowym ----------

/** odległość Damerau-Levenshteina (zamiana sąsiednich liter = 1 błąd: „Chpoin” → „Chopin”) */
export function typoDistance(a, b) {
  if (a === b) return 0;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

// Tonacje: „A-dur” = „A” (wielka litera = dur), „a-moll” = „a” (mała litera = moll).
// Zamieniamy je na jeden token („adur”, „fismoll”), który – jak liczba – musi się zgadzać dokładnie.
const NOTE = '[A-Ha-h](?:is|es|s)?(?:is|es)?';
const KEY_RE = new RegExp(`(^|[^\\p{L}\\p{N}'’])(${NOTE})(?:\\s*-?\\s*([Dd][Uu][Rr]|[Mm][Oo][Ll][Ll]))?(?![\\p{L}\\p{N}'’])`, 'gu');
const isKey = (t) => /^[a-h](?:is|es|s)?(?:is|es)?(?:dur|moll)$/.test(t);

/** tekst z tonacjami zapisanymi jednym słowem: „Polonez A op. 40” → „Polonez  adur  op. 40” */
export function keyed(s) {
  return String(s || '').replace(KEY_RE, (m, pre, note, mode) => {
    const kind = mode ? mode.toLowerCase() : note[0] === note[0].toUpperCase() ? 'dur' : 'moll';
    return `${pre} ${note.toLowerCase()}${kind} `;
  });
}
const keysOf = (ts) => ts.filter(isKey);
/** tonacje muszą się zgadzać – podana zła albo pominięta (gdy jest na liście) = błąd */
const keysOk = (a, c) => keysOf(a).sort().join(',') === keysOf(c).sort().join(',');

/** ile literówek przepuszczamy w słowie tej długości */
const typoLimit = (len) => (len >= 11 ? 3 : len >= 7 ? 2 : len >= 4 ? 1 : 0);

/** podobieństwo słowa z odpowiedzi do poprawnego: 1 = identyczne, 0.9 = literówka/skrót, 0 = inne; liczby muszą być równe */
export function answerSim(a, b) {
  if (a === b) return 1;
  if (isNum(a) || isNum(b) || isKey(a) || isKey(b)) return 0;
  if (a.length >= 4 && b.startsWith(a)) return 0.9; // skrót: „brandenb.”
  return typoDistance(a, b) <= typoLimit(b.length) ? 0.9 : 0;
}

const bestAns = (t, list) => list.reduce((m, u) => Math.max(m, answerSim(t, u)), 0);

function seqSim(a, b) {
  // podobieństwo dwóch list słów (a – odpowiedź, b – poprawne): średnia z pokrycia w obie strony
  if (!a.length && !b.length) return 1;
  if (!a.length || !b.length) return 0;
  const covA = a.reduce((s, t) => s + bestAns(t, b), 0) / a.length;
  const covB = b.reduce((s, u) => s + a.reduce((m, t) => Math.max(m, answerSim(t, u)), 0), 0) / b.length;
  return (covA + covB) / 2;
}

const numsOf = (ts) => ts.filter(isNum).sort().join(',');

// Imiona w różnych językach = to samo imię („Johann” = „Jan”, „Wolfgang Amadeus” = „Wolfgang Amadeusz”).
const NAME_GROUPS = [
  'jan johann johan johannes jean john giovanni juan ivan iwan',
  'jerzy georg george georges giorgio',
  'fryderyk friedrich frederic frederick federico bedrich',
  'amadeusz amadeus amadeo amedeo',
  'ludwik ludwig louis luigi ludovico',
  'franciszek franz francois francesco frantisek francis',
  'piotr pyotr petr peter pietro pierre pjotr',
  'siergiej sergei sergey sergej sergiusz',
  'jozef joseph josef giuseppe jose',
  'antoni antonio antonin anton antoine',
  'karol carl karl charles carlo karel',
  'mikolaj nikolai nikolaj nikolay nicolas nicola nicolo',
  'ryszard richard riccardo',
  'edward edvard',
  'feliks felix',
  'gustaw gustav gustave',
  'dymitr dmitri dmitrij dmitry',
  'aleksander alexander alexandre alessandro aleksandr',
  'henryk heinrich henri henry enrico',
  'maurycy maurice moritz',
  'krzysztof christoph christophe christopher cristoforo',
  'wilhelm william guillaume guglielmo',
  'klaudiusz claude claudio',
  'jakub jacob jakob giacomo jacques james',
  'michal michael michel michele mikhail michail',
  'andrzej andreas andre andrea andrei andrew',
  'pawel paul paolo pablo',
  'tomasz thomas tommaso',
  'hektor hector',
  'ignacy ignaz ignace',
  'wincenty vincenzo vincent',
  'modest modeste',
  'gioachino gioacchino joachim',
];
const NAME_CANON = new Map();
const NAME_INITIALS = new Map(); // „jerzy” → {j, g} – inicjał może pochodzić z dowolnej wersji imienia
for (const g of NAME_GROUPS) {
  const w = g.split(' ');
  for (const x of w) NAME_CANON.set(x, w[0]);
  NAME_INITIALS.set(w[0], new Set(w.map((x) => x[0])));
}
/** czy jednoliterowe „ini” to inicjał imienia (oryginał „raw”, wspólna forma „canon”) */
const isInitial = (ini, raw, canon) => ini.length === 1 && (raw[0] === ini || (NAME_INITIALS.get(canon) || new Set()).has(ini));
/** wspólna forma imienia (także z literówką: „Johhan” → „jan”); inne słowa bez zmian */
export function canonName(t) {
  if (NAME_CANON.has(t)) return NAME_CANON.get(t);
  if (t.length >= 4) for (const [v, c] of NAME_CANON) if (answerSim(t, v) > 0) return c;
  return t;
}

export function checkAuthor(answer, correct) {
  const sur = canonName(surname(correct));
  const given = tokens(answer, { keepStop: true }).filter((t) => !isNum(t));
  if (!sur || !given.length) return false;
  const g = given.map((t) => ({ raw: t, c: canonName(t) }));
  if (!g.some((t) => answerSim(t.c, sur) > 0)) return false;
  // pozostałe słowa (imiona) muszą pasować do imion (w dowolnym języku) lub inicjałów autora
  const others = tokens(correct, { keepStop: true }).map((t) => ({ raw: t, c: canonName(t) })).filter((o) => o.c !== sur);
  const initial = (t, o) => isInitial(t.raw, o.raw, o.c) || isInitial(o.raw, t.raw, t.c);
  return g.every((t) => answerSim(t.c, sur) > 0 || others.some((o) => answerSim(t.c, o.c) > 0 || initial(t, o)));
}

const GENRE = new Set(['opera', 'balet', 'operetka', 'musical', 'piesn', 'oratorium', 'kantata']);
const noGenre = (ts) => ts.filter((t) => !GENRE.has(t));

/** warianty tytułu (tekst): pełny, bez dopisku w nawiasie/cudzysłowie, sam dopisek, części oddzielone „/” (tytuł po polsku i w oryginale) */
function titleVariantTexts(title) {
  const t = String(title || '').replace(/[“”„"]|''/g, '"');
  const out = new Set([t]);
  if (t.includes('/')) for (const x of t.split('/')) out.add(x);
  for (const re of [/\(([^)]*)\)/g, /"([^"]*)"/g]) {
    const inner = [...t.matchAll(re)].map((m) => m[1]);
    if (!inner.length) continue;
    out.add(t.replace(re, ' '));
    for (const x of inner) out.add(x);
  }
  return [...out].filter((v) => noGenre(tokens(v)).length);
}

function titleScore(a, variant) {
  const c = noGenre(tokens(keyed(variant)));
  return (numsOf(a) === numsOf(c) && keysOk(a, c) ? 1 : 0) + seqSim(a, c);
}

export function checkTitle(answer, correct) {
  const a = noGenre(tokens(keyed(answer)));
  if (!tokens(correct).length) return !a.length;
  if (!a.length) return false;
  return titleVariantTexts(correct).some((v) => titleScore(a, v) >= 1.8);
}

export function checkPart(answer, correct) {
  const a = tokens(keyed(answer), { roman: true });
  const c = tokens(keyed(correct), { roman: true });
  if (!c.length) return !a.length; // nie ma części – pole ma zostać puste
  if (!a.length) return false;
  // tonacja: obowiązkowa, gdy podano nazwę części (sam numer „I” = „cz. 1” wystarczy)
  if (a.some((t) => !isNum(t)) ? !keysOk(a, c) : keysOf(a).length) return false;
  const aw = a.filter((t) => !isNum(t));
  const cw = c.filter((t) => !isNum(t));
  // podane liczby muszą się zgadzać („I” = „cz. 1”); same słowa („Pastorale”) też wystarczą
  if (a.some(isNum) && numsOf(a) !== numsOf(c)) return false;
  if (!aw.length) return a.some(isNum);
  if (!cw.length) return false;
  return seqSim(aw, cw) >= 0.7;
}

export function checkAnswer(ans, track) {
  const author = checkAuthor(ans.author, track.author);
  const title = checkTitle(ans.title, track.title);
  const part = checkPart(ans.part, track.part);
  return { author, title, part, ok: author && title && part };
}

// ---------- co dokładnie było źle (pokazywane po odpowiedzi) ----------

const bare = (w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

/** słowa tekstu z tokenami: [{word, tok}] (tokeny liczone w kontekście poprzednich słów – „cz. I” → 1) */
function wordTokens(text, { keys, names, ...opts }) {
  const words = String(text || '').replace(/[“”„"]|''/g, ' ').split(/\s+/).filter(Boolean);
  const tok = (ws) => tokens(keys ? keyed(ws.join(' ')) : ws.join(' '), { ...opts, keepStop: true });
  const full = tok(words); // całość – „a dur” (dwa słowa) to jedna tonacja „adur”
  const out = [];
  let before = 0;
  for (let i = 0; i < words.length; i++) {
    const upto = tok(words.slice(0, i + 1)).length;
    const mine = full.slice(before, Math.max(before, upto));
    for (const t of mine) {
      if (STOP.has(t) || GENRE.has(t)) continue;
      out.push({ word: mine.length > 1 && !isKey(t) ? t : bare(words[i]), tok: names ? canonName(t) : t, raw: t }); // „op.40” → „op”, „40”
    }
    before = Math.max(before, upto);
  }
  return out;
}

/**
 * Porównanie słowo po słowie. Zwraca listę uwag (+ {kind:'keymissing', fix} – brak tonacji, ale pole zaliczone przez dopisek; {kind:'fulltitle', fix} – zaliczony fragment tytułu, np. sam polski):
 * {kind:'typo', given, fix} – literówka (zaliczona), {kind:'wrong', given, fix?} – złe słowo / zła liczba,
 * {kind:'missing', fix} – brakuje słowa lub liczby, {kind:'empty'} – puste pole, {kind:'nopart'} – utwór nie ma części.
 */
export function explainField(field, answer, correct) {
  const roman = field === 'part';
  const keys = field !== 'author';
  const full = correct;
  let partial = false;
  const names = field === 'author';
  const A = wordTokens(answer, { roman, keys, names });
  if (field === 'title') {
    // porównujemy z wariantem tytułu najbliższym odpowiedzi (np. bez dopisku w cudzysłowie)
    const a = A.map((x) => x.tok);
    const vs = titleVariantTexts(correct);
    // najpierw podobieństwo słów, potem zgodność liczb/tonacji („Concerto grosso” → wersja z „Concerto Grosso…”, nie sam dopisek)
    const pick = (v) => { const c = noGenre(tokens(keyed(v))); return seqSim(a, c) + (numsOf(a) === numsOf(c) && keysOk(a, c) ? 0.5 : 0); };
    if (vs.length) correct = vs.reduce((best, v) => (pick(v) > pick(best) ? v : best), vs[0]);
    // zaliczony tylko fragment tytułu (np. sam polski tytuł) – pokażemy pełny tytuł
    partial = vs.length > 1 && correct !== vs[0] && checkTitle(answer, full);
  }
  const C = wordTokens(correct, { roman, keys, names });
  if (!C.length) return A.length ? [{ kind: 'nopart' }] : [];
  if (!A.length) return [{ kind: 'empty' }];
  const used = new Set();
  const res = new Array(A.length).fill(null);
  // 1) identyczne słowa, 2) literówki, 3) złe liczby (z podpowiedzią właściwej), 4) reszta – złe
  A.forEach((x, i) => {
    const j = C.findIndex((c, k) => !used.has(k) && c.tok === x.tok);
    if (j >= 0) { used.add(j); res[i] = { kind: 'ok' }; }
  });
  A.forEach((x, i) => {
    if (res[i]) return;
    let best = -1;
    C.forEach((c, k) => { if (!used.has(k) && answerSim(x.tok, c.tok) > 0 && best < 0) best = k; });
    if (best >= 0) { used.add(best); res[i] = { kind: 'typo', given: x.word, fix: C[best].word }; }
  });
  for (const same of [isNum, isKey]) {
    A.forEach((x, i) => {
      if (res[i] || !same(x.tok)) return;
      const j = C.findIndex((c, k) => !used.has(k) && same(c.tok));
      if (j >= 0) { used.add(j); res[i] = { kind: 'wrong', given: x.word, fix: C[j].word, ...(same === isKey ? { key: true } : {}) }; }
    });
  }
  A.forEach((x, i) => {
    if (res[i]) return;
    if (field === 'author') {
      // imię lub inicjał autora
      const k = C.findIndex((c) => isInitial(x.raw, c.raw, c.tok) || isInitial(c.raw, x.raw, x.tok));
      if (k >= 0) { used.add(k); res[i] = { kind: 'ok' }; return; }
    }
    res[i] = { kind: 'wrong', given: x.word };
  });
  const out = res.filter((r) => r.kind !== 'ok');
  // brakujące: w autorze tylko nazwisko (imiona są opcjonalne), w części – słowa tylko, gdy nie podano nazwy
  const sur = field === 'author' ? canonName(surname(correct)) : '';
  const gaveWords = A.some((x) => !isNum(x.tok));
  const gaveNums = A.some((x) => isNum(x.tok));
  C.forEach((c, k) => {
    if (used.has(k)) return;
    if (field === 'author' && c.tok !== sur) return;
    if (field === 'part' && (isNum(c.tok) ? !gaveNums && gaveWords : gaveNums && !gaveWords)) return;
    if (!out.some((o) => o.kind === 'missing' && o.fix === c.word)) out.push({ kind: 'missing', fix: c.word });
  });
  if (field === 'title') {
    // zaliczony sam dopisek („Na Boże Narodzenie”) – i tak przypominamy o tonacji z pełnego tytułu
    const have = new Set([...A, ...C].map((x) => x.tok));
    for (const k of wordTokens(full, { keys: true })) {
      if (isKey(k.tok) && !have.has(k.tok)) { have.add(k.tok); out.push({ kind: 'keymissing', fix: k.word }); }
    }
    if (partial) {
      // cudzysłów wewnątrz („''Na Boże Narodzenie''”) → «…», bo całość pokazujemy w „…”
      const fix = String(full).replace(/(?:''|["“”„])\s*([^"“”„']+?)\s*(?:''|["“”„])/g, '«$1»').replace(/\s+/g, ' ').trim();
      out.push({ kind: 'fulltitle', fix });
    }
  }
  return out;
}

/** uwagi do wszystkich pól odpowiedzi: {author:[…], title:[…], part:[…]} */
export function explainAnswer(ans, track) {
  return {
    author: explainField('author', ans.author, track.author),
    title: explainField('title', ans.title, track.title),
    part: explainField('part', ans.part, track.part),
  };
}

/** losowe przetasowanie (kryptograficzne) */
export function shuffle(arr, rnd = cryptoRandom) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Kolejność pytań z powtórkami: każdy utwór raz, a `extra` losowych utworów drugi raz.
 * Ten sam utwór nie pada zaraz po sobie – powtórka jest możliwie daleko (co najmniej kilka pytań odstępu).
 */
export function spreadOrder(ids, extra, rnd = cryptoRandom) {
  const n = ids.length;
  extra = Math.max(0, Math.min(extra, n));
  if (!extra) return shuffle(ids, rnd);
  const twice = new Set(shuffle(ids, rnd).slice(0, extra));
  for (let gap = Math.max(1, Math.floor(n / 2)); gap >= 1; gap--) {
    for (let attempt = 0; attempt < 30; attempt++) {
      const left = new Map(ids.map((id) => [id, twice.has(id) ? 2 : 1]));
      const out = [];
      let ok = true;
      while (left.size) {
        const recent = new Set(out.slice(-gap));
        const free = [...left.keys()].filter((id) => !recent.has(id));
        if (!free.length) { ok = false; break; }
        // najpierw te, które mają jeszcze 2 wystąpienia – żeby na końcu nie zostały same powtórki
        const need = free.filter((id) => left.get(id) === 2);
        const pool = need.length && rnd() < need.length / left.size + 0.3 ? need : free;
        const id = pool[Math.floor(rnd() * pool.length)];
        out.push(id);
        if (left.get(id) === 1) left.delete(id); else left.set(id, 1);
      }
      if (ok) return out;
    }
  }
  return shuffle([...ids, ...twice], rnd); // nie powinno się zdarzyć
}

/** liczba pytań dla ustawienia: '75' – ok. 75% utworów, 'all' – wszystkie, '150' – półtora raza tyle */
export function questionCount(setting, n) {
  if (setting === '75') return Math.max(1, Math.round(n * 0.75));
  if (setting === '150') return n < 2 ? n : Math.round(n * 1.5);
  return n;
}

function cryptoRandom() {
  const u = new Uint32Array(1);
  globalThis.crypto.getRandomValues(u);
  return u[0] / 2 ** 32;
}

// ---------- poprawianie typowych błędów odczytu (OCR) ----------

// słowa częste na listach kanonów: OCR myli w nich pojedynczą literę („Ananim”, „gratorium”)
const OCR_VOCAB = [
  'Anonim', 'oratorium', 'kantata', 'symfonia', 'symfoniczny', 'symfoniczna', 'koncert', 'fortepianowy', 'fortepianowa',
  'skrzypcowy', 'wiolonczelowy', 'smyczkowy', 'kwartet', 'kwintet', 'uwertura', 'preludium', 'nokturn', 'mazurek',
  'polonez', 'ballada', 'etiuda', 'scherzo', 'sonata', 'toccata', 'menuet', 'menuetto', 'allegro', 'allegretto',
  'andante', 'andantino', 'adagio', 'vivace', 'moderato', 'larghetto', 'maestoso', 'finale', 'pastorale', 'serenada',
  'rapsodia', 'wariacje', 'fantazja', 'madrygał', 'requiem', 'magnificat', 'motet', 'pasja', 'Mesjasz', 'Alleluja',
  'opera', 'balet', 'operetka', 'kołysanka', 'fortepian', 'Bogurodzica',
];
// nazwiska, w których OCR gubi znaki diakrytyczne
const OCR_NAMES = ['Händel', 'Dvořák', 'Bedřich', 'Janáček', 'Górecki', 'Różycki', 'Żeleński', 'Paderewski'];
const VOCAB_BY_LEN = new Map();
for (const v of OCR_VOCAB) {
  const k = v.length;
  if (!VOCAB_BY_LEN.has(k)) VOCAB_BY_LEN.set(k, []);
  VOCAB_BY_LEN.get(k).push(v);
}
const NAMES_BY_FOLD = new Map(OCR_NAMES.map((n) => [fold(n), n]));
const withCase = (src, w) => (src[0] === src[0].toUpperCase() ? w[0].toUpperCase() : w[0].toLowerCase()) + w.slice(1);

/** słowo z jedną zmienioną literą (nie na końcu – tam bywają odmiany: „symfonii”) → słowo ze słownika */
function vocabWord(w) {
  const low = w.toLowerCase();
  const named = NAMES_BY_FOLD.get(fold(w));
  if (named && named !== w) return named;
  if (w.length < 6) return null;
  for (const v of VOCAB_BY_LEN.get(w.length) || []) {
    const vl = v.toLowerCase();
    if (vl === low) return null;
    let diff = -1;
    let n = 0;
    for (let i = 0; i < vl.length; i++) if (vl[i] !== low[i]) { n++; diff = i; }
    if (n === 1 && diff < vl.length - 2) return withCase(w, v);
  }
  return null;
}

/** typowe błędy odczytu w jednej komórce tabeli (col: 'author' | 'title' | 'part') */
export function fixOcr(s, col = 'title') {
  let t = String(s || '');
  // tonacje: „d-moli” / „d-mol1” → „d-moll”, „G-dut” → „G-dur”
  t = t.replace(/\b([A-Ha-h](?:is|es|s)?)\s*-\s*m[o0][l1iI|]{2}(?![\p{L}])/gu, '$1-moll');
  t = t.replace(/\b([A-Ha-h](?:is|es|s)?)\s*-\s*d[uü][rtn](?![\p{L}])/gu, '$1-dur');
  // cyfry rzymskie z „l” zamiast „I”: „Ill” → „III”, „Vll” → „VII” (samo „Il” to też włoskie słowo – zostaje)
  t = t.replace(/(?<![\p{L}\p{N}])[IVX][IVXl1]*[l1][IVXl1]*(?![\p{L}\p{N}])/gu, (m) => (m === 'Il' ? m : m.replace(/[l1]/g, 'I')));
  // cudzysłowy: „»Razumowski”” → „„Razumowski””, „,,Jesień”” → „„Jesień””
  t = t.replace(/(^|\s)(?:»|,,)(?=\S)/g, '$1„');
  // część: „SZ. 1”, „gz. 3”, „Cz,1” → „cz. 1”
  if (col === 'part') t = t.replace(/^\s*(?:[csg][zZ2]|[CSG][zZ2])\s*[.,]\s*(?=\d|[IVX]\b)/, 'cz. ');
  // słowa ze słownika
  t = t.replace(/[\p{L}]+/gu, (w) => vocabWord(w) || w);
  // przecinek na końcu komórki to plamka (komórki nie kończą się przecinkiem)
  return t.replace(/\s*,\s*$/, '').trim();
}

const wordsOf = (s) => String(s || '').match(/[\p{L}]+/gu) || [];

/**
 * poprawia słowa utworu według nazwy dopasowanego pliku (nazwy plików pisał człowiek):
 * „kotowrotku” → „kołowrotku”, „Bazumowski” → „Razumowski”. Zmienia tylko słowa prawie identyczne
 * (literówka) z jednoznacznym odpowiednikiem w nazwie pliku. Zwraca liczbę poprawionych słów.
 */
export function fixFromFileName(row, fileName) {
  const fw = [...new Set(wordsOf(cleanFileName(fileName)))];
  const fset = new Set(fw.map((w) => w.toLowerCase()));
  let changed = 0;
  for (const k of ['author', 'title', 'part']) {
    if (!row[k]) continue;
    row[k] = row[k].replace(/[\p{L}]+/gu, (w) => {
      const low = w.toLowerCase();
      if (w.length < 4 || fset.has(low)) return w;
      let best = null;
      let bestD = Infinity;
      let tie = false;
      for (const f of fw) {
        if (Math.abs(f.length - w.length) > 1) continue;
        const d = typoDistance(low, f.toLowerCase());
        if (d < bestD) { best = f; bestD = d; tie = false; } else if (d === bestD && f.toLowerCase() !== best.toLowerCase()) tie = true;
      }
      const limit = w.length >= 7 ? 2 : 1;
      if (!best || tie || bestD > limit) return w;
      changed++;
      return withCase(w, best);
    });
  }
  return changed;
}
