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

/** jedna linia → { author, title, part } albo null */
export function parseLine(line) {
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
    const p = parseLine(line);
    if (!p) continue;
    const prev = out[out.length - 1];
    if (prev && !p.author && /^[a-ząćęłńóśźż(]/.test(line.trim())) {
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

/** ile literówek przepuszczamy w słowie tej długości */
const typoLimit = (len) => (len >= 11 ? 3 : len >= 7 ? 2 : len >= 4 ? 1 : 0);

/** podobieństwo słowa z odpowiedzi do poprawnego: 1 = identyczne, 0.9 = literówka/skrót, 0 = inne; liczby muszą być równe */
export function answerSim(a, b) {
  if (a === b) return 1;
  if (isNum(a) || isNum(b)) return 0;
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

export function checkAuthor(answer, correct) {
  const sur = surname(correct);
  const given = tokens(answer, { keepStop: true }).filter((t) => !isNum(t));
  if (!sur || !given.length) return false;
  if (!given.some((t) => answerSim(t, sur) > 0)) return false;
  // pozostałe słowa (imiona) muszą pasować do imion lub inicjałów autora
  const others = tokens(correct, { keepStop: true }).filter((t) => t !== sur);
  return given.every((t) => answerSim(t, sur) > 0 || others.some((o) => answerSim(t, o) > 0 || (t.length === 1 && o[0] === t) || (o.length === 1 && t[0] === o)));
}

const GENRE = new Set(['opera', 'balet', 'operetka', 'musical', 'piesn', 'oratorium', 'kantata']);
const noGenre = (ts) => ts.filter((t) => !GENRE.has(t));

/** warianty tytułu (tekst): pełny, bez dopisku w nawiasie/cudzysłowie, sam dopisek */
function titleVariantTexts(title) {
  const t = String(title || '').replace(/[“”„"]|''/g, '"');
  const out = new Set([t]);
  for (const re of [/\(([^)]*)\)/g, /"([^"]*)"/g]) {
    const inner = [...t.matchAll(re)].map((m) => m[1]);
    if (!inner.length) continue;
    out.add(t.replace(re, ' '));
    for (const x of inner) out.add(x);
  }
  return [...out].filter((v) => noGenre(tokens(v)).length);
}

function titleScore(a, variant) {
  const c = noGenre(tokens(variant));
  return (numsOf(a) === numsOf(c) ? 1 : 0) + seqSim(a, c);
}

export function checkTitle(answer, correct) {
  const a = noGenre(tokens(answer));
  if (!tokens(correct).length) return !a.length;
  if (!a.length) return false;
  return titleVariantTexts(correct).some((v) => titleScore(a, v) >= 1.8);
}

export function checkPart(answer, correct) {
  const a = tokens(answer, { roman: true });
  const c = tokens(correct, { roman: true });
  if (!c.length) return !a.length; // nie ma części – pole ma zostać puste
  if (!a.length) return false;
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
function wordTokens(text, opts) {
  const words = String(text || '').replace(/[“”„"]|''/g, ' ').split(/\s+/).filter(Boolean);
  const out = [];
  let before = 0;
  for (let i = 0; i < words.length; i++) {
    const all = tokens(words.slice(0, i + 1).join(' '), { ...opts, keepStop: true });
    const mine = all.slice(before);
    for (const tok of mine) {
      if (STOP.has(tok) || GENRE.has(tok)) continue;
      out.push({ word: mine.length > 1 ? tok : bare(words[i]), tok }); // „op.40” → „op”, „40”
    }
    before = all.length;
  }
  return out;
}

/**
 * Porównanie słowo po słowie. Zwraca listę uwag:
 * {kind:'typo', given, fix} – literówka (zaliczona), {kind:'wrong', given, fix?} – złe słowo / zła liczba,
 * {kind:'missing', fix} – brakuje słowa lub liczby, {kind:'empty'} – puste pole, {kind:'nopart'} – utwór nie ma części.
 */
export function explainField(field, answer, correct) {
  const roman = field === 'part';
  const A = wordTokens(answer, { roman });
  if (field === 'title') {
    // porównujemy z wariantem tytułu najbliższym odpowiedzi (np. bez dopisku w cudzysłowie)
    const a = A.map((x) => x.tok);
    const vs = titleVariantTexts(correct);
    if (vs.length) correct = vs.reduce((best, v) => (titleScore(a, v) > titleScore(a, best) ? v : best), vs[0]);
  }
  const C = wordTokens(correct, { roman });
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
  A.forEach((x, i) => {
    if (res[i] || !isNum(x.tok)) return;
    const j = C.findIndex((c, k) => !used.has(k) && isNum(c.tok));
    if (j >= 0) { used.add(j); res[i] = { kind: 'wrong', given: x.word, fix: C[j].word }; }
  });
  A.forEach((x, i) => {
    if (res[i]) return;
    if (field === 'author') {
      // imię lub inicjał autora
      const k = C.findIndex((c) => (x.tok.length === 1 && c.tok[0] === x.tok) || (c.tok.length === 1 && x.tok[0] === c.tok));
      if (k >= 0) { used.add(k); res[i] = { kind: 'ok' }; return; }
    }
    res[i] = { kind: 'wrong', given: x.word };
  });
  const out = res.filter((r) => r.kind !== 'ok');
  // brakujące: w autorze tylko nazwisko (imiona są opcjonalne), w części – słowa tylko, gdy nie podano nazwy
  const sur = field === 'author' ? surname(correct) : '';
  const gaveWords = A.some((x) => !isNum(x.tok));
  const gaveNums = A.some((x) => isNum(x.tok));
  C.forEach((c, k) => {
    if (used.has(k)) return;
    if (field === 'author' && c.tok !== sur) return;
    if (field === 'part' && (isNum(c.tok) ? !gaveNums && gaveWords : gaveNums && !gaveWords)) return;
    if (!out.some((o) => o.kind === 'missing' && o.fix === c.word)) out.push({ kind: 'missing', fix: c.word });
  });
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

function cryptoRandom() {
  const u = new Uint32Array(1);
  globalThis.crypto.getRandomValues(u);
  return u[0] / 2 ** 32;
}
