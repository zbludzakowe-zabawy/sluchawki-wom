import { fixOcr } from './textmatch.js';

// Słuchawki – składanie tekstu z OCR według położenia słów.
// Dla tabel (nagłówek „Autor / Tytuł / Część”) słowa trafiają do kolumn według położenia,
// a komórki zawinięte do następnej linii (bez numeru L.p.) są doklejane do swojego wiersza.
// Słowa oznaczone przez OCR jako napisane innym kolorem (w.note – np. czerwone uwagi nauczyciela)
// nie należą do tytułu ani części – trafiają do uwag.
// Wynik: linie „1.<TAB>autor<TAB>tytuł<TAB>część[<TAB>[uwagi: …]]”, które rozumie parseList().

const median = (a) => {
  if (!a.length) return 0;
  const s = a.slice().sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};
const fold = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');

/** odrzuca śmieci (kod QR, kreski, plamy) */
function cleanWords(words) {
  const h = median(words.map((w) => w.y1 - w.y0));
  return words.filter((w) => {
    const t = String(w.text || '').trim();
    if (!t) return false;
    const alnum = (t.match(/[\p{L}\p{N}]/gu) || []).length;
    const wh = w.y1 - w.y0;
    if (!alnum) return /^[-–—„”"'(),.:;]+$/.test(t) && w.conf >= 50; // same znaki: tylko interpunkcja
    if (w.conf < 40 && /[[\]{}|=_<>~^*#@$%\\]/.test(t)) return false;
    if (h && wh > h * 1.6) return (alnum >= 3 && w.conf >= 50) || w.conf >= 85; // za wysokie: plamy, kod QR
    if (h && wh < h * 0.35) return w.conf >= 60;
    return true;
  });
}

/** słowa → linie (po środku wysokości) */
function toLines(words) {
  const h = median(words.map((w) => w.y1 - w.y0)) || 10;
  const sorted = words.slice().sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2);
  const lines = [];
  for (const w of sorted) {
    const c = (w.y0 + w.y1) / 2;
    const line = lines.find((l) => Math.abs(l.c - c) < h * 0.55);
    if (line) { line.words.push(w); line.c = (line.c * (line.words.length - 1) + c) / line.words.length; }
    else lines.push({ c, words: [w] });
  }
  lines.sort((a, b) => a.c - b.c);
  for (const l of lines) l.words.sort((a, b) => a.x0 - b.x0);
  return lines;
}

const joinWords = (ws) => ws.map((w) => w.text).join(' ')
  .replace(/\s+([,.;:)”])/g, '$1')
  .replace(/([„(])\s+/g, '$1')
  .replace(/(\S)([„(])/g, '$1 $2') // „g-moll„Na” → „g-moll „Na”
  .replace(/\b(nr|op|cz|no)\.?(\d)/gi, (m, a, d) => `${a}${m.includes('.') ? '.' : ''} ${d}`); // „nr8” → „nr 8”

/** linia bez tabeli: większe przerwy między słowami zamieniane na odstęp kolumny */
function plainLine(l, h) {
  let out = '';
  let prev = null;
  for (const w of l.words) {
    if (prev) out += w.x0 - prev.x1 > h * 1.6 ? '   ' : ' ';
    out += w.text;
    prev = w;
  }
  return out;
}

export function layoutText(r) {
  const words = cleanWords((r && r.words) || []);
  if (!words.length) return (r && r.text) || '';
  const lines = toLines(words);
  const h = median(words.map((w) => w.y1 - w.y0)) || 10;
  const hi = lines.findIndex((l) => l.words.some((w) => /^(autor|kompozytor)/.test(fold(w.text)))
    && l.words.some((w) => /^(tytu|utwor)/.test(fold(w.text))));
  if (hi < 0) return lines.map((l) => fixOcr(plainLine(l, h))).join('\n');

  const head = lines[hi].words;
  const find = (re) => head.find((w) => re.test(fold(w.text).replace(/^["'„]/, '')));
  const cols = [];
  const lp = find(/^(l\.?\s*p|lp|nr\b|no\b)/);
  const au = find(/^(autor|kompozytor)/);
  const ti = find(/^(tytu|utwor)/);
  const pa = find(/^(cz[eę]|fragm|cze)/);
  if (lp && lp.x0 < au.x0) cols.push({ key: 'lp', x: lp.x0 });
  cols.push({ key: 'author', x: au.x0 }, { key: 'title', x: ti.x0 });
  if (pa && pa.x0 > ti.x0) cols.push({ key: 'part', x: pa.x0 });
  const tol = h * 1.2;
  const colOf = (w) => {
    let k = 0;
    for (let i = 0; i < cols.length; i++) if (w.x0 >= cols[i].x - tol) k = i;
    if (!lp && k === 0 && /^\d{1,3}[.)]?$/.test(w.text) && w.x1 < au.x0) return 'lp';
    return cols[k].key;
  };

  const pre = lines.slice(0, hi).map((l) => plainLine(l, h));
  const rows = [];
  for (const l of lines.slice(hi + 1)) {
    const cell = { lp: [], author: [], title: [], part: [], note: [] };
    for (const w of l.words) cell[w.note ? 'note' : colOf(w)].push(w);
    const num = cell.lp.length && /^\d{1,3}[.)]?$/.test(cell.lp.map((w) => w.text).join(''));
    // numer bez kolumny L.p. przyklejony do autora
    if (!num && !cell.lp.length && cell.author.length && /^\d{1,3}[.)]$/.test(cell.author[0].text)) cell.lp.push(cell.author.shift());
    const isNew = num || cell.lp.length || !rows.length || (!lp && cell.author.length && cell.title.length);
    if (isNew) rows.push({ lp: cell.lp, author: cell.author, title: cell.title, part: cell.part, note: cell.note });
    else {
      const last = rows[rows.length - 1];
      for (const k of ['author', 'title', 'part', 'note']) last[k].push(...cell[k]);
    }
  }
  const body = rows
    .filter((r) => r.author.length || r.title.length)
    .map((r, i) => {
      const n = r.lp.length ? r.lp.map((w) => w.text).join('').replace(/[^\d]/g, '') || String(i + 1) : String(i + 1);
      const note = joinWords(r.note).replace(/[[\]]/g, '');
      return `${n}.\t${fixOcr(joinWords(r.author), 'author')}\t${fixOcr(joinWords(r.title))}\t${fixOcr(joinWords(r.part), 'part')}${note ? `\t[uwagi: ${note}]` : ''}`;
    });
  return [...pre, ...body].join('\n');
}
