// Słuchawki – odczyt tekstu z obrazu (Tesseract.js) i z PDF (pdf.js). Biblioteki ładowane dopiero przy użyciu.
const TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

const loaded = {};
function loadScript(src) {
  if (!loaded[src]) {
    loaded[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.crossOrigin = 'anonymous';
      s.onload = resolve;
      s.onerror = () => { delete loaded[src]; reject(new Error('Nie udało się wczytać modułu rozpoznawania tekstu (potrzebny internet).')); };
      document.head.appendChild(s);
    });
  }
  return loaded[src];
}

let workerP = null;
// Tesseract zgłasza część błędów (np. brak sieci przy pobieraniu słownika) tylko przez errorHandler
let failOcr = () => undefined;
const ocrFailure = () => new Promise((_, reject) => {
  failOcr = (e) => {
    workerP = null;
    reject(new Error('Rozpoznawanie tekstu nie powiodło się (potrzebny internet przy pierwszym użyciu). ' + (e && e.message ? e.message : '')));
  };
});
let progressCb = null;
async function worker() {
  if (!workerP) {
    workerP = (async () => {
      await loadScript(TESSERACT);
      const w = await Promise.race([
        window.Tesseract.createWorker('pol+eng', 1, {
          logger: (m) => progressCb && progressCb(m),
          errorHandler: (e) => failOcr(e),
        }),
        ocrFailure(),
      ]);
      await w.setParameters({ preserve_interword_spaces: '1', tessedit_pageseg_mode: '6' });
      return w;
    })().catch((e) => { workerP = null; throw e; });
  }
  return workerP;
}

/** obraz → kanwa czarno-biała, powiększona, bez linii tabeli (ramki mylą rozpoznawanie) */
async function prepare(source) {
  const img = source instanceof HTMLCanvasElement ? source : await createImageBitmap(source);
  const w0 = img.width;
  const h0 = img.height;
  const scale = Math.min(3, Math.max(0.5, 2400 / Math.max(w0, h0)));
  const c = document.createElement('canvas');
  const W = (c.width = Math.round(w0 * scale));
  const H = (c.height = Math.round(h0 * scale));
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, W, H);
  const d = g.getImageData(0, 0, W, H);
  const p = d.data;
  // odcienie szarości + obraz całkowy do progowania lokalnego (nierówne oświetlenie zdjęcia)
  const gray = new Float32Array(W * H);
  const integ = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const v = 0.299 * p[i * 4] + 0.587 * p[i * 4 + 1] + 0.114 * p[i * 4 + 2];
      gray[i] = v;
      row += v;
      integ[(y + 1) * (W + 1) + x + 1] = integ[y * (W + 1) + x + 1] + row;
    }
  }
  const r = Math.max(8, Math.round(Math.min(W, H) / 40));
  const dark = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(H, y + r + 1);
    for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(W, x + r + 1);
      const sum = integ[y1 * (W + 1) + x1] - integ[y0 * (W + 1) + x1] - integ[y1 * (W + 1) + x0] + integ[y0 * (W + 1) + x0];
      const mean = sum / ((x1 - x0) * (y1 - y0));
      dark[y * W + x] = gray[y * W + x] < mean * 0.85 && gray[y * W + x] < 200 ? 1 : 0;
    }
  }
  // usuwanie długich linii poziomych i pionowych (z tolerancją na lekko krzywe zdjęcie)
  const L = Math.max(60, Math.round(Math.max(W, H) * 0.045));
  const erase = new Uint8Array(W * H);
  const at = (x, y) => (x >= 0 && y >= 0 && x < W && y < H ? dark[y * W + x] : 0);
  for (let y = 0; y < H; y++) {
    let start = -1;
    for (let x = 0; x <= W; x++) {
      const on = x < W && (at(x, y) || (at(x, y - 1) && at(x - 1, y)) || (at(x, y + 1) && at(x - 1, y)));
      if (on && start < 0) start = x;
      if (!on && start >= 0) {
        if (x - start >= L) for (let k = start; k < x; k++) for (let dy = -2; dy <= 2; dy++) if (y + dy >= 0 && y + dy < H) erase[(y + dy) * W + k] |= at(k, y + dy) && (dy === 0 || at(k, y)) ? 1 : 0;
        start = -1;
      }
    }
  }
  for (let x = 0; x < W; x++) {
    let start = -1;
    for (let y = 0; y <= H; y++) {
      const on = y < H && (at(x, y) || (at(x - 1, y) && at(x, y - 1)) || (at(x + 1, y) && at(x, y - 1)));
      if (on && start < 0) start = y;
      if (!on && start >= 0) {
        if (y - start >= L) for (let k = start; k < y; k++) for (let dx = -2; dx <= 2; dx++) if (x + dx >= 0 && x + dx < W) erase[k * W + x + dx] |= at(x + dx, k) && (dx === 0 || at(x, k)) ? 1 : 0;
        start = -1;
      }
    }
  }
  for (let i = 0; i < W * H; i++) {
    const v = dark[i] && !erase[i] ? 0 : 255;
    p[i * 4] = p[i * 4 + 1] = p[i * 4 + 2] = v;
    p[i * 4 + 3] = 255;
  }
  g.putImageData(d, 0, 0);
  return c;
}

async function ocrCanvas(canvas, onStatus, label) {
  progressCb = (m) => {
    if (!onStatus) return;
    if (m.status === 'recognizing text') onStatus(`${label}rozpoznawanie tekstu… ${Math.round(m.progress * 100)}%`);
    else if (/load|initializ/i.test(m.status)) onStatus('Przygotowanie rozpoznawania tekstu (za pierwszym razem chwilę to trwa)…');
  };
  const w = await worker();
  const { data } = await Promise.race([w.recognize(canvas), ocrFailure()]);
  return data.text;
}

async function pdfText(file, onStatus) {
  await loadScript(PDFJS);
  const pdfjs = window.pdfjsLib;
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const parts = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    // składamy linie według współrzędnej y
    const rows = new Map();
    for (const it of content.items) {
      const y = Math.round(it.transform[5]);
      const key = [...rows.keys()].find((k) => Math.abs(k - y) <= 2) ?? y;
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key).push({ x: it.transform[4], s: it.str, w: it.width });
    }
    const lines = [...rows.entries()].sort((a, b) => b[0] - a[0]).map(([, items]) => {
      items.sort((a, b) => a.x - b.x);
      let line = '';
      let end = null;
      for (const it of items) {
        if (end !== null) line += it.x - end > 12 ? '   ' : (it.x - end > 1 ? ' ' : '');
        line += it.s;
        end = it.x + it.w;
      }
      return line;
    });
    const text = lines.join('\n').trim();
    if (text.length > 20) { parts.push(text); continue; }
    // strona bez warstwy tekstu (skan) – rysujemy i rozpoznajemy
    const vp = page.getViewport({ scale: 2.5 });
    const c = document.createElement('canvas');
    c.width = vp.width;
    c.height = vp.height;
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    parts.push(await ocrCanvas(await prepare(c), onStatus, `Strona ${n}/${doc.numPages}: `));
  }
  return parts.join('\n');
}

/** plik (obraz, PDF, tekst) → tekst */
export async function readFileText(file, onStatus = () => {}) {
  const name = (file.name || '').toLowerCase();
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) {
    onStatus('Czytanie PDF…');
    return pdfText(file, onStatus);
  }
  if (file.type.startsWith('text/') || /\.(txt|csv|tsv)$/.test(name)) return file.text();
  if (!file.type.startsWith('image/') && !/\.(jpe?g|png|webp|gif|bmp|heic)$/.test(name)) {
    throw new Error('Nieobsługiwany typ pliku. Wybierz zdjęcie (JPG, PNG), PDF albo plik tekstowy.');
  }
  onStatus('Przygotowanie obrazu…');
  let canvas;
  try { canvas = await prepare(file); } catch {
    throw new Error('Nie udało się otworzyć obrazu. Jeśli to zdjęcie HEIC z iPhone’a, zapisz je jako JPG.');
  }
  return ocrCanvas(canvas, onStatus, '');
}
