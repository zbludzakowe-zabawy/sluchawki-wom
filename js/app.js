// Słuchawki – Kanony na WOM. Interfejs aplikacji.
import * as db from './db.js';
import * as drive from './drive.js';
import { readFileText } from './ocr.js';
import { confetti } from './confetti.js';
import {
  parseList, matchAll, matchScore, fixFromFileName, fragmentSuggestions, sortFragments, confidence, MATCH_MIN, trackFromFileName, checkAnswer, explainAnswer, shuffle, spreadOrder, questionCount, fold, surname,
} from './textmatch.js';

// ---------- narzędzia ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const view = $('#view');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const fmtMB = (b) => (b / 1048576).toFixed(b < 10 * 1048576 ? 1 : 0).replace('.', ',') + ' MB';
const fmtDate = (t) => new Date(t).toLocaleString('pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const pl = (n, one, few, many) => `${n} ${n === 1 ? one : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) ? few : many}`;
const utwory = (n) => pl(n, 'utwór', 'utwory', 'utworów');
export const trackLabel = (t) => `${t.author ? t.author + ' – ' : ''}${t.title || '(bez tytułu)'}${t.part ? ', ' + t.part : ''}`;
/** pliki utworu: pierwszy (fileId) + kolejne fragmenty (extra) – rzadko utwór jest nagrany w kilku plikach */
const trackFiles = (t) => [t, ...(t.extra || [])];
const isDownloaded = (t) => trackFiles(t).every((f) => downloaded.has(f.fileId));
const filesBadge = (t) => (t.extra && t.extra.length ? ` <small class="muted">· ${t.extra.length + 1} pliki</small>` : '');
/** uwagi do utworu (np. czerwony dopisek na liście) – osobno, nie są częścią opisu utworu */
const noteHtml = (t, tag = 'small') => (t && t.note ? `<${tag} class="note">Uwagi: ${esc(t.note)}</${tag}>` : '');

const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* pełna pamięć – trudno */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* trudno */ } },
};
const K = { prefs: 'sluchawki-prefs', player: 'sluchawki-player', quiz: 'sluchawki-quiz', draft: 'sluchawki-draft', result: 'sluchawki-last-result' };
const prefs = Object.assign({ fragment: 0, count: 'all' }, ls.get(K.prefs, {})); // fragment 0 = cały utwór
if (!['75', 'all', '150'].includes(prefs.count)) prefs.count = 'all'; // dawne 10/20/30
const savePrefs = () => ls.set(K.prefs, prefs);

function toast(msg, kind = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => t.classList.add('out'), kind === 'error' ? 6000 : 3200);
  setTimeout(() => t.remove(), kind === 'error' ? 6500 : 3700);
}

function setHeader(title, back) {
  $('#hdr-sub').textContent = title || 'Kanony na WOM';
  const b = $('#btn-back');
  b.hidden = !back;
  b.dataset.to = back || '';
}
let navCount = 0;
window.addEventListener('hashchange', () => { navCount++; route(); });
$('#btn-back').addEventListener('click', () => {
  const to = $('#btn-back').dataset.to || '#/';
  if (navCount > 0) history.back();
  else location.replace(to);
});
const go = (h) => { if (location.hash === h) route(); else location.hash = h; };

function render(html) {
  view.innerHTML = html;
  window.scrollTo(0, 0);
}

let downloaded = new Set();
async function refreshDownloaded() { try { downloaded = new Set(await db.audioKeys()); } catch { downloaded = new Set(); } }

// ---------- odtwarzanie ----------
const audio = $('#audio');
let owner = null; // 'player' | 'quiz' | 'preview'
let objUrl = null;
let unlocked = false;

// iPhone pozwala odtwarzać dźwięk dopiero po stuknięciu – „odblokowujemy” odtwarzacz przy pierwszym dotyku
function silentWav() {
  const n = 800;
  const b = new ArrayBuffer(44 + n);
  const v = new DataView(b);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  w(36, 'data'); v.setUint32(40, n, true);
  for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
  return URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
}
document.addEventListener('pointerdown', () => {
  if (unlocked || audio.src) return;
  unlocked = true;
  audio.src = silentWav();
  audio.play().then(() => audio.pause()).catch(() => undefined);
}, { capture: true });

async function srcFor(track) {
  let blob = null;
  if (downloaded.has(track.fileId)) blob = await db.getAudio(track.fileId).catch(() => null);
  if (objUrl) { URL.revokeObjectURL(objUrl); objUrl = null; }
  if (blob) { objUrl = URL.createObjectURL(blob); return objUrl; }
  if (!navigator.onLine) throw new Error('Ten utwór nie jest pobrany na urządzenie, a nie ma internetu.');
  if (!drive.hasApiKey()) throw new Error('Brak klucza Google API – wpisz go w Ustawieniach.');
  return drive.streamUrl(track.fileId);
}

let playToken = 0;
async function playTrack(track, who) {
  const my = ++playToken;
  owner = who;
  audio.pause();
  const src = await srcFor(track);
  if (my !== playToken) return false;
  audio.src = src;
  audio.currentTime = 0;
  try {
    await audio.play();
  } catch (e) {
    if (e && e.name === 'AbortError') return false;
    if (e && e.name === 'NotAllowedError') { toast('Stuknij ▶, żeby odtworzyć.'); return false; }
    throw e;
  }
  return true;
}
function stopAudio() {
  playToken++;
  audio.pause();
  owner = null;
  updateMini();
}
audio.addEventListener('error', () => {
  if (!owner) return;
  toast('Nie udało się odtworzyć nagrania. Sprawdź internet, klucz API i udostępnienie folderu.', 'error');
});

// ---------- strona główna ----------
async function home() {
  setHeader('', null);
  const sets = (await db.listSets()).sort((a, b) => a.name.localeCompare(b.name, 'pl'));
  await refreshDownloaded();
  const cards = sets.map((s) => {
    const n = s.tracks.length;
    const off = n && s.tracks.every(isDownloaded);
    return `<a class="card set-card" href="#/zbior/${esc(s.id)}">
      <span class="set-ico" aria-hidden="true">♫</span>
      <span class="set-main"><strong>${esc(s.name)}</strong><small>${utwory(n)}${off ? ' · <span class="ok">dostępny offline</span>' : ''}</small></span>
      <span class="chev" aria-hidden="true">›</span></a>`;
  }).join('');
  render(`
    <section class="hero">
      <h1>Słuchawki</h1>
      <p>Kanony na WOM – ucz się rozpoznawać utwory ze słuchu.</p>
    </section>
    <h2 class="sec-title">Nauka – wybierz zbiór</h2>
    ${sets.length ? `<div class="list">${cards}</div>` : `<div class="empty card">Nie masz jeszcze żadnego zbioru utworów.<br>Dodaj go z biblioteki, zaimportuj z pliku lub z linku albo utwórz własny.</div>`}
    <div id="library"></div>
    <h2 class="sec-title">Dodawanie, import i eksport</h2>
    <div class="grid2">
      <a class="btn big" href="#/dodaj">＋ Nowy zbiór</a>
      <label class="btn big">⇩ Importuj z pliku<small>plik .sluchawki.json</small><input type="file" id="imp-file" accept=".json,application/json" multiple hidden></label>
    </div>
    <a class="btn wide" href="#/import">🔗 Importuj z linku<small>link „Udostępnij”, plik na Dysku Google albo w internecie</small></a>
    ${sets.length ? '<button class="btn wide" id="exp-all">⇪ Eksportuj wszystkie zbiory do pliku</button>' : ''}
    ${!drive.hasApiKey() ? `<p class="hint">Do słuchania z Dysku Google potrzebny jest klucz API – <a href="#/ustawienia">ustaw go w Ustawieniach</a>.</p>` : ''}
  `);
  $('#imp-file').addEventListener('change', async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    await importFiles(files);
  });
  const ea = $('#exp-all');
  if (ea) ea.addEventListener('click', exportAll);
  renderLibrary(sets);
}

async function renderLibrary(sets) {
  const box = $('#library');
  const lib = await loadLibrary();
  if (!box || !box.isConnected || !lib.length) return;
  box.innerHTML = `<h2 class="sec-title">Biblioteka zbiorów</h2>
    <div class="list">${lib.map((e, i) => {
      const mine = sets.find((x) => x.lib && x.lib.file === e.file);
      const state = !mine ? `<button class="btn primary" data-lib="${i}">＋ Dodaj</button>`
        : mine.lib.hash !== e.hash ? `<button class="btn" data-lib="${i}">↻ Aktualizuj</button>` : '<span class="badge-ok">✓ masz</span>';
      return `<div class="card lib-card"><span class="set-ico" aria-hidden="true">♫</span>
        <span class="set-main"><strong>${esc(e.name)}</strong><small>${utwory(e.count || 0)}</small></span>${state}</div>`;
    }).join('')}</div>`;
  $$('[data-lib]', box).forEach((b) => b.addEventListener('click', () => { b.disabled = true; importFromLibrary(lib[Number(b.dataset.lib)]); }));
}

// ---------- widok zbioru ----------
async function setView(id) {
  const set = await db.getSet(id);
  if (!set) { toast('Nie ma takiego zbioru.'); return go('#/'); }
  setHeader(set.name, '#/');
  await refreshDownloaded();
  const n = set.tracks.length;
  const have = set.tracks.filter(isDownloaded).length;
  const size = set.tracks.flatMap(trackFiles).reduce((s, f) => s + (f.size || 0), 0);
  const authors = groupAuthors(set.tracks);
  const nq = questionKeys(set).length; // pytań w quizie (utwór z kilku plików = kilka pytań)
  const results = (await db.resultsFor(id).catch(() => [])).sort((a, b) => b.date - a.date).slice(0, 5);
  const locked = !!set.lib;
  render(`
    <div class="title-row">
      <div><h1 class="page-title">${esc(set.name)}</h1><p class="muted">${utwory(n)}${locked ? ' · 🔒 z biblioteki' : ''}</p></div>
      ${locked ? '<button class="btn" data-copy>⧉ Własna kopia</button>' : `<a class="btn" href="#/edytuj/${esc(id)}">✎ Edytuj</a>`}
    </div>
    ${!n && !locked ? `<div class="empty card">Ten zbiór jest pusty. <a href="#/dodaj/${esc(id)}">Dodaj utwory</a>.</div>` : ''}
    <h2 class="sec-title">Słuchanie</h2>
    <div class="grid2">
      <button class="btn big" data-play="order">▶ Po kolei</button>
      <button class="btn big" data-play="shuffle">🔀 Losowo</button>
    </div>
    <div class="row-inline">
      <select id="author-pick" aria-label="Autor"><option value="">Utwory autora…</option>
        ${authors.map((a) => `<option value="${esc(a.key)}">${esc(a.name)} (${a.ids.length})</option>`).join('')}</select>
      <button class="btn" id="play-author">▶ Słuchaj</button>
    </div>
    <h2 class="sec-title">Quiz</h2>
    <div class="grid2">
      <button class="btn big primary" data-quiz="choice">🎯 Quiz wyboru<small>wybierz utwór z listy</small></button>
      <button class="btn big primary" data-quiz="text">⌨ Quiz tekstowy<small>wpisz autora, tytuł, część</small></button>
    </div>
    <div class="opts">
      <label>Pytań: <select id="q-count">
        ${['75', 'all', '150'].map((v) => `<option value="${v}" ${prefs.count === v ? 'selected' : ''}>${{ 75: `ok. 75% (${questionCount('75', nq)})`, all: `wszystkie (${nq})`, 150: `150% (${questionCount('150', nq)}) – niektóre 2 razy` }[v]}</option>`).join('')}
      </select></label>
      <label>Odtwarzaj: <select id="q-frag">
        ${[0, 15, 30, 60].map((v) => `<option value="${v}" ${prefs.fragment === v ? 'selected' : ''}>${v ? `pierwsze ${v} s` : 'cały utwór'}</option>`).join('')}
      </select></label>
    </div>
    ${results.length ? `<h2 class="sec-title">Ostatnie wyniki</h2><ul class="results">${results.map((r) =>
      `<li><span>${r.type === 'text' ? '⌨' : '🎯'} ${fmtDate(r.date)}</span><b>${r.correct}/${r.total} (${Math.round(100 * r.correct / r.total)}%)</b></li>`).join('')}</ul>` : ''}
    <h2 class="sec-title">Bez internetu</h2>
    <div class="card offline-box">
      ${have === n && n ? `<p><span class="ok">✓ Wszystkie utwory są zapisane na tym urządzeniu.</span></p><button class="btn" id="off-del">Usuń z urządzenia</button>`
        : `<p>${have ? `Pobrano ${have} z ${n}. ` : ''}Zapisz utwory na tym urządzeniu, żeby słuchać i robić quizy bez internetu${size ? ` (ok. ${fmtMB(size)})` : ''}.</p>
           <button class="btn primary" id="off-get">⇩ Pobierz na urządzenie</button> ${have ? '<button class="btn" id="off-del">Usuń pobrane</button>' : ''}`}
      <div id="off-progress" hidden><div class="bar"><i></i></div><p class="muted" id="off-status"></p><button class="btn" id="off-cancel">Przerwij</button></div>
    </div>
    ${n ? `<details class="card tracks-box"><summary>Utwory w zbiorze (${n})</summary><ol class="track-list">${set.tracks.map((t) =>
      `<li>${esc(trackLabel(t))}${filesBadge(t)}${isDownloaded(t) ? ' <span class="dl" title="pobrany">⇩</span>' : ''}${noteHtml(t)}</li>`).join('')}</ol>
      ${locked ? '' : `<a class="btn wide" href="#/edytuj/${esc(id)}">✎ Edytuj utwory i kolejność</a>`}</details>` : ''}
    <h2 class="sec-title">Eksport i udostępnianie</h2>
    <div class="grid2">
      <button class="btn" id="export">⇪ Eksportuj do pliku<small>do importu na innym urządzeniu</small></button>
      <button class="btn" id="share">↗ Udostępnij link<small>import jednym stuknięciem</small></button>
    </div>
    <h2 class="sec-title">Zarządzanie</h2>
    ${locked ? `<div class="card lock-box"><p>🔒 To zbiór z biblioteki – nie można go edytować, żeby wszyscy uczyli się z tej samej wersji.
      Chcesz coś zmienić? Utwórz własną kopię: będzie Twoja i dowolnie ją zmienisz.</p>
      <button class="btn primary wide" data-copy>⧉ Utwórz własną kopię do edycji</button></div>`
    : `<div class="grid2">
      <a class="btn" href="#/dodaj/${esc(id)}">＋ Dodaj utwory</a>
      <a class="btn" href="#/edytuj/${esc(id)}">✎ Edytuj zbiór</a>
    </div>`}
    <button class="btn danger wide" id="del-set">Usuń zbiór</button>
  `);
  $$('[data-play]').forEach((b) => b.addEventListener('click', () => startPlayer(set, b.dataset.play)));
  $('#play-author').addEventListener('click', () => {
    const a = authors.find((x) => x.key === $('#author-pick').value);
    if (!a) return toast('Najpierw wybierz autora z listy.');
    startPlayer(set, 'author', a);
  });
  $('#author-pick').addEventListener('change', () => { if ($('#author-pick').value) $('#play-author').focus(); });
  $('#q-count').addEventListener('change', (e) => { prefs.count = e.target.value; savePrefs(); });
  $('#q-frag').addEventListener('change', (e) => { prefs.fragment = Number(e.target.value); savePrefs(); });
  $$('[data-quiz]').forEach((b) => b.addEventListener('click', () => startQuiz(set, b.dataset.quiz)));
  $('#share').addEventListener('click', () => shareSet(set));
  $('#export').addEventListener('click', () => exportSet(set));
  $$('[data-copy]').forEach((b) => b.addEventListener('click', () => makeCopy(set)));
  $('#del-set').addEventListener('click', async () => {
    if (!confirm(`Usunąć zbiór „${set.name}”? Pliki na Dysku Google zostaną nietknięte.`)) return;
    await db.deleteSet(id);
    await db.deleteResultsFor(id).catch(() => undefined);
    await cleanupAudio();
    toast('Zbiór usunięty.');
    location.replace('#/');
  });
  const get = $('#off-get');
  if (get) get.addEventListener('click', () => downloadSet(set));
  const del = $('#off-del');
  if (del) del.addEventListener('click', async () => {
    if (!confirm('Usunąć pobrane nagrania tego zbioru z urządzenia?')) return;
    const keep = await usedElsewhere(set.id);
    for (const f of set.tracks.flatMap(trackFiles)) if (!keep.has(f.fileId)) await db.deleteAudio(f.fileId);
    toast('Usunięto pobrane nagrania.');
    setView(id);
  });
}

/** własna (edytowalna) kopia zbioru z biblioteki */
async function makeCopy(set) {
  const taken = new Set((await db.listSets()).map((x) => x.name));
  let name = `${set.name} (moja kopia)`;
  for (let i = 2; taken.has(name); i++) name = `${set.name} (moja kopia ${i})`;
  const copy = {
    id: uid(), name, createdAt: Date.now(), folders: set.folders.slice(), files: set.files.slice(),
    tracks: set.tracks.map((t) => ({ ...t, id: uid() })),
  };
  await db.putSet(copy);
  toast(`Utworzono „${name}” – możesz ją teraz edytować.`, 'good');
  location.hash = `#/edytuj/${copy.id}`;
}

function groupAuthors(tracks) {
  const m = new Map();
  for (const t of tracks) {
    const key = surname(t.author) || fold(t.author).trim() || '?';
    if (!m.has(key)) m.set(key, { key, names: new Map(), ids: [] });
    const g = m.get(key);
    g.ids.push(t.id);
    const nm = t.author || '(bez autora)';
    g.names.set(nm, (g.names.get(nm) || 0) + 1);
  }
  return [...m.values()].map((g) => ({
    key: g.key, ids: g.ids,
    name: [...g.names.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0][0],
  })).sort((a, b) => a.key.localeCompare(b.key, 'pl'));
}

async function usedElsewhere(setId) {
  const keep = new Set();
  for (const s of await db.listSets()) if (s.id !== setId) for (const f of s.tracks.flatMap(trackFiles)) keep.add(f.fileId);
  return keep;
}
async function cleanupAudio() {
  const used = await usedElsewhere(null);
  for (const k of await db.audioKeys()) if (!used.has(k)) await db.deleteAudio(k);
}

let dlCancel = false;
async function downloadSet(set) {
  if (!navigator.onLine) return toast('Do pobrania potrzebny jest internet.', 'error');
  if (!drive.hasApiKey()) return toast('Brak klucza Google API – wpisz go w Ustawieniach.', 'error');
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch { /* trudno */ }
  await refreshDownloaded();
  const todo = set.tracks.flatMap((t) => trackFiles(t).map((f, k, all) => ({ ...f, label: trackLabel(t) + (all.length > 1 ? ` (fragment ${k + 1})` : '') })))
    .filter((f, i, a) => !downloaded.has(f.fileId) && a.findIndex((x) => x.fileId === f.fileId) === i);
  const box = $('#off-progress');
  const bar = $('#off-progress .bar i');
  const st = $('#off-status');
  box.hidden = false;
  $('#off-get').disabled = true;
  dlCancel = false;
  $('#off-cancel').onclick = () => { dlCancel = true; };
  let done = 0;
  let failed = 0;
  for (const t of todo) {
    if (dlCancel) break;
    st.textContent = `Pobieranie ${done + 1} z ${todo.length}: ${t.label}`;
    try {
      const blob = await drive.download(t, (f) => { bar.style.width = `${((done + f) / todo.length) * 100}%`; });
      await db.putAudio(t.fileId, blob);
    } catch (e) {
      failed++;
      toast(e.name === 'QuotaExceededError' ? 'Brak miejsca na urządzeniu.' : e.message, 'error');
      if (e.name === 'QuotaExceededError' || e.code === 'offline') break;
    }
    done++;
    bar.style.width = `${(done / todo.length) * 100}%`;
  }
  if (!dlCancel && !failed) toast('Gotowe – zbiór działa bez internetu.', 'good');
  if (location.hash === `#/zbior/${set.id}`) setView(set.id);
}

// ---------- odtwarzacz ----------
let player = ls.get(K.player, null); // { setId, title, queue:[trackId], index, frag } – frag: który plik utworu z kilku plików
let playerSet = null;

function lastOrderKey(id) { return `sluchawki-last-order-${id}`; }
function freshShuffle(ids, setId) {
  // nowa kolejność za każdym razem – inna niż ostatnio
  const last = ls.get(lastOrderKey(setId), '');
  let order = shuffle(ids);
  for (let i = 0; i < 5 && ids.length > 2 && order.join() === last; i++) order = shuffle(ids);
  ls.set(lastOrderKey(setId), order.join());
  return order;
}

async function startPlayer(set, mode, author) {
  if (!set.tracks.length) return toast('Ten zbiór jest pusty.');
  let queue = set.tracks.map((t) => t.id);
  let title = 'Po kolei';
  if (mode === 'shuffle') { queue = freshShuffle(queue, set.id); title = 'Losowo'; }
  if (mode === 'author') { queue = author.ids; title = author.name; }
  player = { setId: set.id, title, queue, index: 0, frag: 0 };
  playerSet = set;
  ls.set(K.player, player);
  go('#/sluchaj');
  playCurrent();
}

function currentTrack() {
  if (!player || !playerSet) return null;
  return playerSet.tracks.find((t) => t.id === player.queue[player.index]) || null;
}

async function playCurrent() {
  const t = currentTrack();
  if (!t) return;
  ls.set(K.player, player);
  setMediaSession(t);
  renderPlayerState();
  const files = trackFiles(t);
  try { await playTrack(files[Math.min(player.frag || 0, files.length - 1)], 'player'); } catch (e) { toast(e.message, 'error'); }
  renderPlayerState();
}

function step(d) {
  if (!player) return;
  // utwór z kilku plików: najpierw kolejny / poprzedni fragment
  const t = currentTrack();
  const fr = (player.frag || 0) + d;
  if (t && fr >= 0 && fr < trackFiles(t).length) { player.frag = fr; playCurrent(); return; }
  player.frag = 0;
  const n = player.queue.length;
  const i = player.index + d;
  if (i < 0) { audio.currentTime = 0; return; }
  if (i >= n) { stopAudio(); player.index = 0; ls.set(K.player, player); renderPlayerState(); toast('Koniec listy.'); return; }
  player.index = i;
  playCurrent();
}

audio.addEventListener('ended', () => {
  if (owner === 'player') step(1);
  else if (owner === 'quiz') updateFragUi();
});

function setMediaSession(t) {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title + (t.part ? `, ${t.part}` : '') + fragText(t), artist: t.author, album: playerSet ? playerSet.name : 'Słuchawki',
      artwork: [{ src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }],
    });
    navigator.mediaSession.setActionHandler('nexttrack', () => step(1));
    navigator.mediaSession.setActionHandler('previoustrack', () => step(-1));
  } catch { /* stare przeglądarki */ }
}

async function playerView() {
  if (!player) return go('#/');
  if (!playerSet || playerSet.id !== player.setId) playerSet = await db.getSet(player.setId);
  if (!playerSet) { player = null; ls.del(K.player); return go('#/'); }
  setHeader(`${playerSet.name} · ${player.title}`, `#/zbior/${playerSet.id}`);
  await refreshDownloaded();
  const items = player.queue.map((id, i) => {
    const t = playerSet.tracks.find((x) => x.id === id);
    return t ? `<li><button data-i="${i}"><span class="qn">${i + 1}</span><span>${esc(trackLabel(t))}${filesBadge(t)}</span>${isDownloaded(t) ? '<span class="dl" title="pobrany">⇩</span>' : ''}</button></li>` : '';
  }).join('');
  render(`
    <div class="player card">
      <div class="now"><div class="disc" aria-hidden="true">♫</div>
        <div><div class="now-author" id="p-author"></div><div class="now-title" id="p-title"></div><div class="note" id="p-note" hidden></div><div class="muted" id="p-pos"></div></div></div>
      <input type="range" id="p-seek" min="0" max="1000" value="0" aria-label="Pozycja">
      <div class="times"><span id="p-cur">0:00</span><span id="p-dur">0:00</span></div>
      <div class="controls">
        <button class="round" id="p-prev" aria-label="Poprzedni">⏮</button>
        <button class="round main" id="p-play" aria-label="Odtwórz">▶</button>
        <button class="round" id="p-next" aria-label="Następny">⏭</button>
      </div>
    </div>
    <h2 class="sec-title">Kolejka · ${esc(player.title)}</h2>
    <ol class="queue">${items}</ol>
  `);
  $('#p-prev').onclick = () => step(-1);
  $('#p-next').onclick = () => step(1);
  $('#p-play').onclick = () => {
    if (owner === 'player' && audio.src) { if (audio.paused) audio.play().catch(() => undefined); else audio.pause(); }
    else playCurrent();
  };
  $('#p-seek').oninput = (e) => { if (audio.duration) audio.currentTime = (e.target.value / 1000) * audio.duration; };
  $$('.queue button').forEach((b) => b.addEventListener('click', () => { player.index = Number(b.dataset.i); player.frag = 0; playCurrent(); }));
  renderPlayerState();
}

/** „ (fragment 1 z 2)” dla utworu z kilku plików */
function fragText(t) {
  const n = trackFiles(t).length;
  return n > 1 ? ` (fragment ${Math.min(player.frag || 0, n - 1) + 1} z ${n})` : '';
}
const fmtT = (s) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00');
function renderPlayerState() {
  updateMini();
  if (!$('#p-title')) return;
  const t = currentTrack();
  if (!t) return;
  $('#p-author').textContent = t.author || '';
  $('#p-title').textContent = t.title + (t.part ? `, ${t.part}` : '');
  $('#p-note').hidden = !t.note;
  $('#p-note').textContent = t.note ? `Uwagi: ${t.note}` : '';
  const nf = trackFiles(t).length;
  $('#p-pos').textContent = nf > 1
    ? `Pozycja ${player.index + 1} z ${player.queue.length} · fragment ${Math.min(player.frag || 0, nf - 1) + 1} z ${nf}`
    : `${player.index + 1} / ${player.queue.length}`;
  const playing = owner === 'player' && !audio.paused;
  $('#p-play').textContent = playing ? '⏸' : '▶';
  $('#p-play').setAttribute('aria-label', playing ? 'Pauza' : 'Odtwórz');
  $$('.queue button').forEach((b) => b.classList.toggle('current', Number(b.dataset.i) === player.index));
  const cur = $('.queue button.current');
  if (cur && !renderPlayerState.scrolled) { cur.scrollIntoView({ block: 'nearest' }); }
}
audio.addEventListener('play', renderPlayerState);
audio.addEventListener('pause', renderPlayerState);
audio.addEventListener('timeupdate', () => {
  if (owner === 'player' && $('#p-seek')) {
    $('#p-seek').value = audio.duration ? (audio.currentTime / audio.duration) * 1000 : 0;
    $('#p-cur').textContent = fmtT(audio.currentTime);
    $('#p-dur').textContent = fmtT(audio.duration);
  }
  if (owner === 'quiz') quizTick();
});

// mały pasek „teraz gra” na innych ekranach
function updateMini() {
  const m = $('#mini');
  const t = owner === 'player' ? currentTrack() : null;
  const show = t && location.hash !== '#/sluchaj' && !(audio.paused && audio.currentTime === 0);
  m.hidden = !show;
  document.body.classList.toggle('has-mini', !!show);
  if (!show) return;
  $('#mini-title').textContent = trackLabel(t) + fragText(t);
  $('#mini-play').textContent = audio.paused ? '▶' : '⏸';
}
$('#mini-play').addEventListener('click', () => { if (audio.paused) audio.play().catch(() => undefined); else audio.pause(); });
$('#mini-open').addEventListener('click', () => go('#/sluchaj'));

// ---------- quiz ----------
let quiz = ls.get(K.quiz, null);
let quizSet = null;
const saveQuiz = () => ls.set(K.quiz, quiz);
/** pytania quizu: utwór z kilku plików = kilka pytań („id”, „id#2”, …) – każdy plik jest puszczany */
const questionKeys = (set) => set.tracks.flatMap((t) => trackFiles(t).map((f, k) => (k ? `${t.id}#${k + 1}` : t.id)));
const splitKey = (key) => { const m = String(key).match(/^(.*)#(\d+)$/); return m ? { id: m[1], frag: Number(m[2]) - 1 } : { id: key, frag: 0 }; };

function startQuiz(set, type, ids) {
  if (!set.tracks.length) return toast('Ten zbiór jest pusty.');
  if (type === 'choice' && set.tracks.length < 2) return toast('Do quizu wyboru potrzeba co najmniej 2 utworów.');
  const all = questionKeys(set);
  let order;
  if (ids) order = shuffle([...new Set(ids)]);
  else if (prefs.count === '150') order = spreadOrder(all, questionCount('150', all.length) - all.length);
  else order = freshShuffle(all, set.id + '-quiz').slice(0, questionCount(prefs.count, all.length));
  quiz = { setId: set.id, type, order, idx: 0, answers: [], fragment: prefs.fragment, phase: 'ask', draft: null };
  quizLoaded = null;
  quizSet = set;
  saveQuiz();
  go('#/quiz');
}

const quizKey = () => quiz.order[quiz.idx];
const quizTrack = () => quizSet && quizSet.tracks.find((t) => t.id === splitKey(quizKey()).id);

async function quizView() {
  if (!quiz) return go('#/');
  if (!quizSet || quizSet.id !== quiz.setId) quizSet = await db.getSet(quiz.setId);
  if (!quizSet) { quiz = null; ls.del(K.quiz); return go('#/'); }
  if (owner === 'player') stopAudio();
  await refreshDownloaded();
  setHeader(`${quizSet.name} · ${quiz.type === 'text' ? 'Quiz tekstowy' : 'Quiz wyboru'}`, `#/zbior/${quizSet.id}`);
  renderQuestion(true);
}

function renderQuestion(autoplay) {
  const t = quizTrack();
  if (!t) return finishQuiz();
  const n = quiz.order.length;
  const score = quiz.answers.filter((a) => a.ok).length;
  const answered = quiz.phase === 'feedback' ? quiz.answers[quiz.answers.length - 1] : null;
  let body = '';
  if (quiz.type === 'choice') {
    const opts = quizSet.tracks.slice();
    body = `
      ${opts.length > 8 ? `<input type="search" id="q-filter" placeholder="Szukaj na liście…" autocomplete="off" ${answered ? 'disabled' : ''}>` : ''}
      <ul class="choices">${opts.map((o) => {
        let cls = '';
        if (answered) { if (o.id === t.id) cls = 'right'; else if (o.id === answered.given) cls = 'wrong'; }
        return `<li><button data-id="${esc(o.id)}" class="${cls}" ${answered ? 'disabled' : ''} data-s="${esc(fold(trackLabel(o)))}">${esc(trackLabel(o))}</button></li>`;
      }).join('')}</ul>`;
  } else {
    const d = answered ? answered.given : (quiz.draft || { author: '', title: '', part: '' });
    const mark = (f) => (answered ? (answered.detail[f] ? 'right' : 'wrong') : '');
    const ex = answered && !answered.skipped ? explainAnswer(d, t) : null;
    const why = (f) => (ex ? whyHtml(ex[f], answered.detail[f]) : '');
    body = `
      <form id="q-form" class="qform" autocomplete="off">
        <label class="${mark('author')}">Autor (imię i nazwisko)<input name="author" value="${esc(d.author)}" ${answered ? 'readonly' : ''} autocapitalize="words" spellcheck="false"></label>${why('author')}
        <label class="${mark('title')}">Tytuł<input name="title" value="${esc(d.title)}" ${answered ? 'readonly' : ''} spellcheck="false"></label>${why('title')}
        <label class="${mark('part')}">Część / fragment<input name="part" value="${esc(d.part)}" ${answered ? 'readonly' : ''} spellcheck="false"></label>${why('part')}
        ${answered ? '' : '<div class="grid2"><button type="button" class="btn" id="q-skip">Nie wiem</button><button class="btn primary">Sprawdź</button></div>'}
      </form>`;
  }
  const fb = answered ? `<div class="feedback ${answered.ok ? 'good' : 'bad'}">
      <strong>${answered.ok ? 'Brawo! +1 punkt' : 'Niestety nie.'}</strong>
      <span>To był: ${esc(trackLabel(t))}</span>${noteHtml(t, 'span')}</div>
      <button class="btn primary wide" id="q-next">${quiz.idx + 1 < n ? 'Dalej ›' : 'Zobacz wynik'}</button>` : '';
  render(`
    <div class="quiz-top">
      <span>Pytanie <b>${quiz.idx + 1}</b> / ${n}</span><span>Punkty: <b>${score}</b></span>
    </div>
    <div class="card fragment">
      <button class="round main" id="q-play" aria-label="Odtwórz">▶</button>
      <div class="frag-info">
        <input type="range" id="q-seek" min="0" max="1000" value="0" aria-label="Pozycja w utworze">
        <div class="frag-row"><small class="muted" id="q-status"></small><button class="btn sm" id="q-restart" type="button">↺ Od początku</button></div>
      </div>
    </div>
    ${fb}
    ${body}
    <button class="btn ghost wide" id="q-end">Zakończ quiz</button>
  `);
  $('#q-restart').addEventListener('click', () => playFragment());
  $('#q-seek').addEventListener('input', (e) => {
    if (owner !== 'quiz' || !audio.duration) return;
    const max = quiz.fragment ? Math.min(quiz.fragment, audio.duration) : audio.duration;
    audio.currentTime = (e.target.value / 1000) * max;
  });
  $('#q-end').addEventListener('click', () => {
    if (quiz.answers.length && !confirm('Zakończyć quiz? Zobaczysz wynik z dotychczasowych odpowiedzi.')) return;
    if (!quiz.answers.length) { stopAudio(); quiz = null; ls.del(K.quiz); return history.length > 1 ? history.back() : go('#/'); }
    finishQuiz();
  });
  if (answered) {
    $('#q-next').addEventListener('click', () => {
      quiz.idx++;
      quiz.phase = 'ask';
      quiz.draft = null;
      saveQuiz();
      renderQuestion(true);
    });
    $('#q-next').focus();
  } else if (quiz.type === 'choice') {
    $$('.choices button').forEach((b) => b.addEventListener('click', () => answerChoice(b.dataset.id)));
    const f = $('#q-filter');
    if (f) f.addEventListener('input', () => {
      const q = fold(f.value).trim();
      $$('.choices button').forEach((b) => { b.parentElement.hidden = q && !b.dataset.s.includes(q); });
    });
  } else {
    const form = $('#q-form');
    form.addEventListener('input', () => { quiz.draft = Object.fromEntries(new FormData(form)); saveQuiz(); });
    form.addEventListener('submit', (e) => { e.preventDefault(); answerText(Object.fromEntries(new FormData(form))); });
    $('#q-skip').addEventListener('click', () => answerText({ author: '', title: '', part: '' }, true));
  }
  if (autoplay && !answered) playFragment();
  else updateFragUi();
}

let quizLoaded = null; // id utworu załadowanego w odtwarzaczu quizu
async function playFragment() {
  const t = quizTrack();
  if (!t) return;
  const files = trackFiles(t);
  const key = quizKey();
  try {
    $('#q-status').textContent = 'Ładowanie…';
    const ok = await playTrack(files[Math.min(splitKey(key).frag, files.length - 1)], 'quiz');
    quizLoaded = ok ? key : null;
  } catch (e) { toast(e.message, 'error'); quizLoaded = null; }
  updateFragUi();
}
function quizToggle() {
  const t = quizTrack();
  if (owner === 'quiz' && t && quizLoaded === quizKey() && audio.src) {
    if (!audio.paused) { audio.pause(); return; }
    const limit = quiz.fragment || Infinity;
    if (audio.ended || audio.currentTime >= limit) audio.currentTime = 0;
    audio.play().catch(() => undefined);
  } else playFragment();
}
function quizTick() {
  if (!quiz) return;
  if (quiz.fragment && audio.currentTime >= quiz.fragment) audio.pause();
  updateFragUi();
}
function updateFragUi() {
  const seek = $('#q-seek');
  if (!seek || !quiz) return;
  const mine = owner === 'quiz' && !!quizTrack() && quizLoaded === quizKey();
  const dur = mine && Number.isFinite(audio.duration) ? audio.duration : 0;
  const max = quiz.fragment ? Math.min(quiz.fragment, dur || quiz.fragment) : dur;
  const cur = mine ? Math.min(audio.currentTime, max || 0) : 0;
  seek.value = max ? (cur / max) * 1000 : 0;
  seek.disabled = !mine || !max;
  const playing = mine && !audio.paused;
  $('#q-play').textContent = playing ? '⏸' : '▶';
  $('#q-play').setAttribute('aria-label', playing ? 'Pauza' : 'Odtwórz');
  $('#q-play').onclick = quizToggle;
  const done = mine && (audio.ended || (quiz.fragment && cur >= quiz.fragment));
  $('#q-status').textContent = !mine ? (quiz.fragment ? `Pierwsze ${quiz.fragment} s utworu` : 'Cały utwór – zatrzymaj, kiedy chcesz')
    : done ? 'Koniec – ▶ posłuchaj jeszcze raz'
      : `${fmtT(cur)} / ${max ? fmtT(max) : '…'}${playing ? '' : ' · pauza'}`;
}
audio.addEventListener('pause', () => { if (owner === 'quiz') updateFragUi(); });
audio.addEventListener('play', () => { if (owner === 'quiz') updateFragUi(); });

function answerChoice(id) {
  const t = quizTrack();
  const chosen = quizSet.tracks.find((x) => x.id === id);
  const ok = id === t.id || (chosen && fold(trackLabel(chosen)) === fold(trackLabel(t)));
  quiz.answers.push({ id: t.id, q: quizKey(), ok, given: id });
  quiz.phase = 'feedback';
  saveQuiz();
  renderQuestion(false);
}

/** opis pomyłek w polu odpowiedzi (literówki – zaliczone, złe słowa i liczby, braki) */
function whyHtml(notes, ok, inline) {
  if (!notes || !notes.length) return '';
  const q = (x) => `„${esc(x)}”`;
  // braki zbieramy w jedną listę: „brakuje: „g-moll”, „6”, „8””
  const missing = notes.filter((n) => n.kind === 'missing').map((n) => q(n.fix));
  const items = notes.map((n, i) => {
    if (n.kind === 'typo') return `<span class="typo">${q(n.given)} → ${q(n.fix)}</span>`;
    if (n.kind === 'wrong') return `<span class="err">„<s>${esc(n.given)}</s>”${n.fix ? ` → ${q(n.fix)}` : ' – nie pasuje'}${n.key ? ' (tonacja: wielka litera = dur, mała = moll)' : ''}</span>`;
    if (n.kind === 'missing') return notes.findIndex((m) => m.kind === 'missing') === i ? `<span class="err">brakuje: ${missing.join(', ')}</span>` : '';
    if (n.kind === 'keymissing') return `<span class="typo">brakuje tonacji ${q(n.fix)}</span>`;
    if (n.kind === 'fulltitle') return `<span class="typo">pełny tytuł to ${q(n.fix)}</span>`;
    if (n.kind === 'empty') return '<span class="err">brak odpowiedzi</span>';
    if (n.kind === 'nopart') return '<span class="err">ten utwór nie ma części – pole zostaw puste</span>';
    return '';
  });
  const typosOnly = notes.every((n) => n.kind === 'typo');
  const lead = ok ? (typosOnly ? 'Zaliczone mimo literówki: ' : 'Zaliczone, ale: ') : typosOnly ? 'Literówka: ' : 'Błąd: ';
  return `<${inline ? 'span' : 'div'} class="why${ok ? ' ok-note' : ''}">${inline ? ' (' : ''}${lead}${items.filter(Boolean).join(', ')}${inline ? ')' : ''}</${inline ? 'span' : 'div'}>`;
}

function answerText(given, skipped) {
  const t = quizTrack();
  const detail = skipped ? { author: false, title: false, part: false, ok: false } : checkAnswer(given, t);
  quiz.answers.push({ id: t.id, q: quizKey(), ok: detail.ok, given, detail, ...(skipped ? { skipped: true } : {}) });
  quiz.phase = 'feedback';
  saveQuiz();
  renderQuestion(false);
}

async function finishQuiz() {
  stopAudio();
  const total = quiz.answers.length;
  const correct = quiz.answers.filter((a) => a.ok).length;
  const res = { setId: quiz.setId, type: quiz.type, date: Date.now(), total, correct, answers: quiz.answers };
  if (total) await db.addResult({ setId: res.setId, type: res.type, date: res.date, total, correct }).catch(() => undefined);
  ls.set(K.result, res);
  quiz = null;
  ls.del(K.quiz);
  resultFresh = true;
  if (location.hash === '#/wynik') route();
  else location.replace('#/wynik');
}
let resultFresh = false;

async function resultView() {
  const res = ls.get(K.result, null);
  if (!res) return go('#/');
  const set = await db.getSet(res.setId);
  if (!set) return go('#/');
  setHeader(set.name, `#/zbior/${set.id}`);
  const pct = res.total ? Math.round((100 * res.correct) / res.total) : 0;
  const msg = pct >= 90 ? 'Fantastycznie! Masz świetne ucho! 🎉' : pct >= 70 ? 'Bardzo dobrze! Jeszcze trochę i będzie perfekcyjnie.'
    : pct >= 40 ? 'Nieźle! Posłuchaj jeszcze tych, które sprawiły kłopot.' : 'Początki bywają trudne – posłuchaj zbioru i spróbuj znowu. Dasz radę!';
  const byId = (id) => set.tracks.find((t) => t.id === id);
  const good = res.answers.filter((a) => a.ok);
  const bad = res.answers.filter((a) => !a.ok);
  const givenTxt = (a) => {
    if (res.type === 'choice') { const g = byId(a.given); return g ? `Twoja odpowiedź: ${trackLabel(g)}` : ''; }
    const g = a.given || {};
    if (!g.author && !g.title && !g.part) return 'Bez odpowiedzi';
    const t = byId(a.id);
    const ex = t ? explainAnswer(g, t) : null;
    const f = (k, l) => `<span class="${a.detail[k] ? 'ok' : 'bad'}">${l}: ${esc(g[k] || '—')}</span>${ex ? whyHtml(ex[k], a.detail[k], true) : ''}`;
    return `${f('author', 'autor')} · ${f('title', 'tytuł')} · ${f('part', 'część')}`;
  };
  render(`
    <div class="card score-card ${pct >= 90 ? 'great' : ''}">
      <div class="score">${res.correct}<small>/${res.total}</small></div>
      <div class="pct">${pct}%</div>
      <p>${msg}</p>
    </div>
    ${bad.length ? `<h2 class="sec-title bad">Do powtórki (${bad.length})</h2><ul class="res-list">${bad.map((a) => {
      const t = byId(a.id);
      return `<li class="bad"><strong>✗ ${esc(t ? trackLabel(t) : '(usunięty utwór)')}</strong><small>${res.type === 'choice' ? esc(givenTxt(a)) : givenTxt(a)}</small></li>`;
    }).join('')}</ul>` : ''}
    ${good.length ? `<h2 class="sec-title ok">Rozpoznane (${good.length})</h2><ul class="res-list">${good.map((a) => {
      const t = byId(a.id);
      return `<li class="ok"><strong>✓ ${esc(t ? trackLabel(t) : '(usunięty utwór)')}</strong></li>`;
    }).join('')}</ul>` : ''}
    <div class="grid2">
      ${bad.length ? '<button class="btn primary" id="r-again-bad">Powtórz błędne</button>' : ''}
      <button class="btn" id="r-again">Nowy quiz</button>
      <a class="btn" href="#/zbior/${esc(set.id)}">Wróć do zbioru</a>
    </div>
  `);
  if (pct >= 90 && resultFresh) setTimeout(() => confetti(), 150);
  resultFresh = false;
  const again = $('#r-again-bad');
  if (again) again.addEventListener('click', () => startQuiz(set, res.type, bad.filter((a) => byId(a.id)).map((a) => a.q || a.id)));
  $('#r-again').addEventListener('click', () => startQuiz(set, res.type));
}

// ---------- tabela utworów (dodawanie i edycja) ----------
// model: { rows:[{key,id?,author,title,part,note?,fileId,extra?:[fileId],score,manual}], files:[{id,name,size,mimeType,resourceKey}], blocked:Set(fileId) }
function rowRanking(model, row) {
  return model.files
    .filter((f) => !model.blocked.has(f.id))
    .map((f) => ({ f, s: matchScore(row, f.name) }))
    .sort((a, b) => b.s - a.s || a.f.name.localeCompare(b.f.name, 'pl'));
}

function autoMatch(model, all) {
  const rows = model.rows.filter((r) => all || !r.manual);
  const taken = new Set(model.rows.filter((r) => !all && r.manual && r.fileId).map((r) => r.fileId));
  for (const r of model.rows) for (const id of r.extra || []) taken.add(id); // kolejne fragmenty zostają przy swoich utworach
  const files = model.files.filter((f) => !taken.has(f.id) && !model.blocked.has(f.id));
  const { result } = matchAll(rows, files);
  rows.forEach((r, i) => { r.fileId = result[i].fileId; r.score = result[i].score; if (all) r.manual = false; });
  if (model.fixWords) fixWordsFromFiles(model, rows);
}

/** przy dodawaniu: błędy odczytu poprawiane według nazw dopasowanych plików (tylko pewne i „sprawdź”) */
function fixWordsFromFiles(model, rows) {
  const byId = new Map(model.files.map((f) => [f.id, f]));
  let n = 0;
  for (const r of rows) {
    const f = r.fileId && byId.get(r.fileId);
    if (!f || confidence(r.score) === 'low') continue;
    const k = fixFromFileName(r, f.name);
    if (k) { n += k; r.score = matchScore(r, f.name); }
  }
  if (n) toast(`Poprawiono ${pl(n, 'słowo', 'słowa', 'słów')} według nazw plików – sprawdź listę.`, 'good');
}

/** dodaje plik jako kolejny fragment utworu; fragmenty ułożone według nazw plików */
function addFragment(model, r, id) {
  const name = (x) => (model.files.find((f) => f.id === x) || {}).name || '';
  const ids = sortFragments([...new Set([r.fileId, ...(r.extra || []), id].filter(Boolean))], name);
  r.fileId = ids[0];
  r.extra = ids.slice(1);
  r.manual = true;
  r.score = matchScore(r, name(r.fileId));
}

function renderTable(root, model, onChange) {
  const counts = {};
  for (const r of model.rows) for (const id of [r.fileId, ...(r.extra || [])]) if (id) counts[id] = (counts[id] || 0) + 1;
  const used = new Set(Object.keys(counts));
  const unused = model.files.filter((f) => !used.has(f.id) && !model.blocked.has(f.id));
  const nameOf = (id) => (model.files.find((f) => f.id === id) || {}).name || '(plik usunięty z folderu)';
  // pliki prawie identyczne z przypisanymi – może utwór jest nagrany w kilku plikach
  const sugg = unused.length ? fragmentSuggestions(model.rows, unused, model.files) : new Map();
  const nSugg = [...sugg.values()].reduce((a, l) => a + l.length, 0);
  const nHigh = model.rows.filter((r) => r.fileId && (r.manual || confidence(r.score) === 'high')).length;
  const nNone = model.rows.filter((r) => !r.fileId).length;
  const rowHtml = (r, i) => {
    const conf = !r.fileId ? 'none' : r.manual ? 'manual' : confidence(r.score);
    const rank = model.files.length ? rowRanking(model, r) : [];
    const opts = rank.map(({ f, s }) => `<option value="${esc(f.id)}" ${f.id === r.fileId ? 'selected' : ''}>${s >= MATCH_MIN ? '★ ' : ''}${esc(f.name)}</option>`).join('');
    const dup = r.fileId && counts[r.fileId] > 1;
    const extra = r.extra || [];
    const fragHtml = extra.map((id, k) => `<div class="tfile tfrag"><span class="fragn">Fragment ${k + 2}:</span><span class="fname">${esc(nameOf(id))}</span>
          <button type="button" class="round sm" data-act="listen" data-id="${esc(id)}" aria-label="Posłuchaj fragmentu ${k + 2}">▶</button>
          <button type="button" class="round sm" data-act="rm-frag" data-id="${esc(id)}" aria-label="Usuń fragment ${k + 2}">✕</button></div>`).join('');
    const hint = (sugg.get(i) || []).map((f) => `<div class="frag-hint"><span>W folderze jest prawie taki sam plik: <b>${esc(f.name)}</b>. Może ten utwór jest nagrany w kilku plikach?</span>
          <span class="frag-btns"><button type="button" class="btn sm primary" data-act="add-frag" data-id="${esc(f.id)}">＋ Dodaj jako fragment ${extra.length + 2}</button>
          <button type="button" class="round sm" data-act="listen" data-id="${esc(f.id)}" aria-label="Posłuchaj">▶</button></span></div>`).join('');
    const pick = r.fileId && unused.length ? `<select data-act="pick-frag" class="pick-frag" aria-label="Dodaj kolejny plik tego utworu">
          <option value="">＋ kolejny plik tego utworu (fragment ${extra.length + 2})…</option>${unused.map((f) => `<option value="${esc(f.id)}">${esc(f.name)}</option>`).join('')}</select>` : '';
    const badge = { none: 'brak pliku', manual: 'wybrany ręcznie', high: `pewne ${Math.round(r.score * 100)}%`, mid: `sprawdź ${Math.round(r.score * 100)}%`, low: `wątpliwe ${Math.round(r.score * 100)}%` }[conf];
    return `<div class="trow conf-${conf}${dup ? ' dup' : ''}${sugg.has(i) ? ' has-frag-hint' : ''}" data-i="${i}">
      <div class="tnum">${i + 1}</div>
      <div class="tfields">
        <input data-f="author" placeholder="Autor" value="${esc(r.author)}" aria-label="Autor">
        <input data-f="title" placeholder="Tytuł" value="${esc(r.title)}" aria-label="Tytuł">
        <input data-f="part" placeholder="Część / fragment (jeśli jest)" value="${esc(r.part)}" aria-label="Część lub fragment">
        <input data-f="note" class="note-input" placeholder="Uwagi (jeśli są)" value="${esc(r.note || '')}" aria-label="Uwagi">
        <div class="tfile">
          <select data-f="fileId" aria-label="Plik nagrania"><option value="">— brak pliku —</option>${opts}</select>
          <button type="button" class="round sm" data-act="listen" aria-label="Posłuchaj" ${r.fileId ? '' : 'disabled'}>▶</button>
        </div>
        ${fragHtml}${hint}
        <div class="tmeta"><span class="badge">${badge}</span>${extra.length ? ` <span class="badge">${extra.length + 1} pliki</span>` : ''}${dup ? ' <span class="warn">ten sam plik w kilku wierszach</span>' : ''}</div>
        ${pick}
      </div>
      <div class="tactions">
        <button type="button" data-act="up" aria-label="W górę" ${i ? '' : 'disabled'}>↑</button>
        <button type="button" data-act="down" aria-label="W dół" ${i < model.rows.length - 1 ? '' : 'disabled'}>↓</button>
        <button type="button" data-act="del" aria-label="Usuń wiersz">✕</button>
      </div>
    </div>`;
  };
  root.innerHTML = `
    ${model.rows.length ? `<p class="summary">${utwory(model.rows.length)} · <span class="ok">${nHigh} pewnych</span> · <span class="warn">${model.rows.length - nHigh - nNone} do sprawdzenia</span> · <span class="bad">${nNone} bez pliku</span></p>` : ''}
    ${nSugg ? `<div class="frag-alert">⚠ W folderze jest więcej plików (${model.files.length - model.blocked.size}) niż utworów na liście (${model.rows.length}), a ${pl(nSugg, 'plik prawie nie różni', 'pliki prawie nie różnią', 'plików prawie nie różni')} się nazwą od już przypisanych. Możliwe, że utwór jest nagrany w kilku plikach – sprawdź wiersze oznaczone ⚠ (▶ – posłuchaj).</div>` : ''}
    <div class="tlist">${model.rows.map(rowHtml).join('')}</div>
    <div class="grid2">
      <button type="button" class="btn" data-act="add">＋ Dodaj wiersz</button>
      ${model.files.length && model.rows.length ? '<button type="button" class="btn" data-act="rematch">↻ Dopasuj wszystko od nowa</button>' : ''}
    </div>
    ${unused.length ? `<details class="unused"><summary>Pliki bez przypisania (${unused.length})</summary><ul>${unused.map((f) =>
      `<li><span>${esc(f.name)}</span><button type="button" class="btn sm" data-add-file="${esc(f.id)}">＋ dodaj jako utwór</button></li>`).join('')}</ul></details>` : ''}
  `;
  const rerender = () => { renderTable(root, model, onChange); onChange(); };
  root.oninput = (e) => {
    const inp = e.target.closest('input[data-f]');
    if (!inp) return;
    model.rows[Number(inp.closest('.trow').dataset.i)][inp.dataset.f] = inp.value;
    onChange();
  };
  root.onchange = (e) => {
    const el = e.target;
    const tr = el.closest('.trow');
    if (!tr) return;
    const r = model.rows[Number(tr.dataset.i)];
    if (el.dataset.act === 'pick-frag') { if (el.value) addFragment(model, r, el.value); return rerender(); }
    if (el.dataset.f === 'fileId') {
      r.fileId = el.value || null;
      if (r.extra) r.extra = r.extra.filter((x) => x !== r.fileId);
      if (!r.fileId && r.extra && r.extra.length) r.fileId = r.extra.shift();
      r.manual = true;
      const f = model.files.find((x) => x.id === r.fileId);
      r.score = f ? matchScore(r, f.name) : 0;
      return rerender();
    }
    if (el.dataset.f && el.dataset.f !== 'note' && !r.manual) {
      // opis poprawiony – poszukaj lepszego pliku wśród wolnych
      const taken = new Set(model.rows.filter((x) => x !== r && x.fileId).map((x) => x.fileId));
      const best = rowRanking(model, r).find(({ f }) => !taken.has(f.id));
      if (best && best.s >= MATCH_MIN) { r.fileId = best.f.id; r.score = best.s; } else if (r.fileId) r.score = matchScore(r, (model.files.find((x) => x.id === r.fileId) || {}).name || '');
      const old = tr;
      const i = Number(tr.dataset.i);
      const tmp = document.createElement('div');
      tmp.innerHTML = rowHtml(r, i);
      old.replaceWith(tmp.firstElementChild);
      onChange();
    }
  };
  root.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const tr = b.closest('.trow');
    const i = tr ? Number(tr.dataset.i) : -1;
    const act = b.dataset.act;
    if (act === 'up' && i > 0) { [model.rows[i - 1], model.rows[i]] = [model.rows[i], model.rows[i - 1]]; rerender(); }
    else if (act === 'down' && i < model.rows.length - 1) { [model.rows[i + 1], model.rows[i]] = [model.rows[i], model.rows[i + 1]]; rerender(); }
    else if (act === 'del') {
      const r = model.rows[i];
      if ((r.author || r.title) && !confirm(`Usunąć wiersz „${trackLabel(r)}”?`)) return;
      model.rows.splice(i, 1);
      rerender();
    } else if (act === 'add') {
      model.rows.push({ key: uid(), author: '', title: '', part: '', fileId: null, score: 0, manual: false });
      rerender();
      const last = $$('.trow', root).pop();
      if (last) $('input', last).focus();
    } else if (act === 'rematch') {
      if (!confirm('Dopasować wszystkie wiersze automatycznie? Ręczne wybory zostaną zastąpione.')) return;
      autoMatch(model, true);
      rerender();
    } else if (act === 'add-frag') {
      addFragment(model, model.rows[i], b.dataset.id);
      rerender();
    } else if (act === 'rm-frag') {
      const r = model.rows[i];
      r.extra = (r.extra || []).filter((x) => x !== b.dataset.id);
      rerender();
    } else if (act === 'listen') {
      const r = model.rows[i];
      const f = model.files.find((x) => x.id === (b.dataset.id || r.fileId));
      if (!f) return;
      if (owner === 'preview' && !audio.paused && b.classList.contains('playing')) { stopAudio(); b.classList.remove('playing'); b.textContent = '▶'; return; }
      $$('[data-act="listen"].playing', root).forEach((x) => { x.classList.remove('playing'); x.textContent = '▶'; });
      b.classList.add('playing');
      b.textContent = '■';
      playTrack({ fileId: f.id }, 'preview').catch((err) => toast(err.message, 'error'));
    } else if (b.dataset.addFile) {
      const f = model.files.find((x) => x.id === b.dataset.addFile);
      const t = trackFromFileName(f.name.split(' / ').pop());
      model.rows.push({ key: uid(), ...t, fileId: f.id, score: 1, manual: true });
      rerender();
    }
  };
}

// ---------- dodawanie ----------
let draft = null;
const saveDraft = () => ls.set(K.draft, { ...draft, blocked: undefined });
let draftTimer = null;
const saveDraftSoon = () => { clearTimeout(draftTimer); draftTimer = setTimeout(saveDraft, 400); };

async function addView(setId) {
  // do zbiorów z biblioteki nie można dopisywać utworów
  const sets = (await db.listSets()).filter((x) => !x.lib).sort((a, b) => a.name.localeCompare(b.name, 'pl'));
  draft = ls.get(K.draft, null) || { target: 'new', setId: '', name: '', text: '', rows: [], folderLink: '', folders: [], files: [] };
  if (setId && sets.some((s) => s.id === setId)) { draft.target = 'existing'; draft.setId = setId; }
  if (draft.target === 'existing' && !sets.some((s) => s.id === draft.setId)) { draft.target = 'new'; draft.setId = ''; }
  setHeader('Dodawanie utworów', setId ? `#/zbior/${setId}` : '#/');
  const model = { rows: draft.rows, files: draft.files, blocked: new Set(), fixWords: true };
  const updateBlocked = () => {
    model.blocked = new Set();
    const s = sets.find((x) => x.id === draft.setId);
    if (draft.target === 'existing' && s) for (const f of s.tracks.flatMap(trackFiles)) model.blocked.add(f.fileId);
  };
  updateBlocked();
  render(`
    <h1 class="page-title">Dodawanie utworów</h1>
    <section class="card step">
      <h2><span class="stepn">1</span> Zbiór</h2>
      <label class="radio"><input type="radio" name="target" value="new" ${draft.target === 'new' ? 'checked' : ''}> Nowy zbiór</label>
      <input id="set-name" placeholder="Nazwa zbioru, np. 2.1 – wstęp do form, tańce" value="${esc(draft.name)}" ${draft.target === 'new' ? '' : 'disabled'}>
      <label class="radio"><input type="radio" name="target" value="existing" ${draft.target === 'existing' ? 'checked' : ''} ${sets.length ? '' : 'disabled'}> Dodaj do istniejącego</label>
      <select id="set-pick" ${draft.target === 'existing' ? '' : 'disabled'}>
        <option value="">— wybierz zbiór —</option>
        ${sets.map((s) => `<option value="${esc(s.id)}" ${s.id === draft.setId ? 'selected' : ''}>${esc(s.name)} (${s.tracks.length})</option>`).join('')}
      </select>
    </section>
    <section class="card step">
      <h2><span class="stepn">2</span> Lista utworów</h2>
      <p class="muted">Wybierz zdjęcie lub skan listy (albo PDF). Aplikacja odczyta tekst – potem możesz go poprawić. Możesz też wkleić listę: jeden utwór w linii, np. <i>J.S. Bach – Koncert brandenburski nr 3, cz. I</i>. Tekst w innym kolorze (np. czerwone uwagi) trafia do <i>[uwagi: …]</i> – nie jest częścią tytułu ani fragmentu.</p>
      <label class="btn primary wide">📷 Wybierz zdjęcie / plik listy<input type="file" id="list-file" accept="image/*,application/pdf,.pdf,.txt" multiple hidden></label>
      <div id="ocr-status" class="muted" hidden></div>
      <div id="thumbs" class="thumbs"></div>
      <textarea id="list-text" rows="7" placeholder="Tu pojawi się odczytany tekst (możesz go poprawić lub wkleić listę)">${esc(draft.text)}</textarea>
      <button class="btn wide" id="parse">⇣ Utwórz listę z tekstu</button>
    </section>
    <section class="card step">
      <h2><span class="stepn">3</span> Folder z nagraniami na Dysku Google</h2>
      <p class="muted">W Dysku Google: <b>Udostępnij → Ogólny dostęp: „Każdy, kto ma link”</b>, potem <b>Kopiuj link</b> i wklej tutaj.</p>
      <div class="row-inline"><input id="folder-link" inputmode="url" placeholder="https://drive.google.com/drive/folders/…" value="${esc(draft.folderLink)}"><button class="btn primary" id="folder-load">Wczytaj</button></div>
      <div id="folders"></div>
      ${!drive.hasApiKey() ? '<p class="hint bad">Najpierw ustaw klucz Google API w <a href="#/ustawienia">Ustawieniach</a>.</p>' : ''}
    </section>
    <section class="card step">
      <h2><span class="stepn">4</span> Sprawdź dopasowanie</h2>
      <p class="muted" id="match-hint"></p>
      <div id="table"></div>
    </section>
    <div class="savebar">
      <button class="btn ghost" id="draft-clear">Wyczyść</button>
      <button class="btn primary" id="save">✓ Zatwierdź i zapisz</button>
    </div>
  `);
  const onChange = () => { refreshHint(); saveDraftSoon(); };
  const table = $('#table');
  const refreshHint = () => {
    $('#match-hint').textContent = !model.rows.length ? 'Najpierw utwórz listę utworów (krok 2).'
      : !model.files.length ? 'Wczytaj folder z nagraniami (krok 3), żeby dopasować pliki.'
        : 'Zielone – pewne, żółte i czerwone – sprawdź (▶ pozwala posłuchać). Plik możesz zmienić z listy; ★ to najlepsze propozycje.';
  };
  const redraw = () => { renderTable(table, model, onChange); onChange(); };
  const renderFolders = () => {
    $('#folders').innerHTML = draft.folders.map((f, i) => `<div class="folder"><span>📁 ${esc(f.name)} · ${pl(f.count, 'plik', 'pliki', 'plików')}</span><button class="btn sm" data-rm="${i}">✕</button></div>`).join('')
      + (model.files.length && !model.rows.length ? '<button class="btn wide" id="from-names">Nie mam listy – utwórz ją z nazw plików</button>' : '');
    $$('#folders [data-rm]').forEach((b) => b.addEventListener('click', () => {
      const f = draft.folders.splice(Number(b.dataset.rm), 1)[0];
      const ids = new Set(f.fileIds);
      draft.files = model.files = model.files.filter((x) => !ids.has(x.id));
      for (const r of model.rows) {
        if (r.extra) r.extra = r.extra.filter((x) => !ids.has(x));
        if (r.fileId && ids.has(r.fileId)) { r.fileId = (r.extra && r.extra.shift()) || null; r.score = 0; r.manual = !!r.fileId; }
      }
      renderFolders();
      redraw();
    }));
    const fn = $('#from-names');
    if (fn) fn.addEventListener('click', () => {
      for (const f of model.files.filter((x) => !model.blocked.has(x.id))) {
        model.rows.push({ key: uid(), ...trackFromFileName(f.name.split(' / ').pop()), fileId: f.id, score: 1, manual: true });
      }
      renderFolders();
      redraw();
    });
  };
  renderFolders();
  redraw();

  $$('input[name="target"]').forEach((r) => r.addEventListener('change', () => {
    draft.target = r.value;
    $('#set-name').disabled = draft.target !== 'new';
    $('#set-pick').disabled = draft.target !== 'existing';
    updateBlocked();
    redraw();
  }));
  $('#set-name').addEventListener('input', (e) => { draft.name = e.target.value; saveDraftSoon(); });
  $('#set-pick').addEventListener('change', (e) => { draft.setId = e.target.value; updateBlocked(); autoMatch(model, false); redraw(); });
  $('#list-text').addEventListener('input', (e) => { draft.text = e.target.value; saveDraftSoon(); });

  $('#list-file').addEventListener('change', async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    const st = $('#ocr-status');
    st.hidden = false;
    const thumbs = $('#thumbs');
    thumbs.innerHTML = files.filter((f) => f.type.startsWith('image/')).map((f) => `<a href="${URL.createObjectURL(f)}" target="_blank" rel="noopener"><img src="${URL.createObjectURL(f)}" alt="podgląd listy"></a>`).join('');
    const texts = [];
    for (const [i, f] of files.entries()) {
      try {
        texts.push(await readFileText(f, (s) => { st.textContent = (files.length > 1 ? `Plik ${i + 1}/${files.length}: ` : '') + s; }));
      } catch (err) { toast(err.message, 'error'); }
    }
    st.hidden = true;
    const text = texts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!text) return toast('Nie udało się odczytać tekstu.', 'error');
    draft.text = $('#list-text').value = (draft.text.trim() ? draft.text.trim() + '\n' : '') + text;
    saveDraft();
    toast('Tekst odczytany – sprawdź go i stuknij „Utwórz listę z tekstu”.', 'good');
    $('#list-text').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  $('#parse').addEventListener('click', () => {
    const list = parseList($('#list-text').value);
    if (!list.length) return toast('Nie znalazłem utworów w tekście.', 'error');
    if (model.rows.length && !confirm(`Lista ma już ${utwory(model.rows.length)}. Zastąpić ją nową (${list.length})? „Anuluj” dopisze nowe na końcu.`)) {
      model.rows.push(...list.map((t) => ({ key: uid(), ...t, fileId: null, score: 0, manual: false })));
    } else {
      model.rows.splice(0, model.rows.length, ...list.map((t) => ({ key: uid(), ...t, fileId: null, score: 0, manual: false })));
    }
    if (model.files.length) autoMatch(model, false);
    renderFolders();
    redraw();
    toast(`Rozpoznano ${utwory(list.length)}.`, 'good');
    $('#table').scrollIntoView({ behavior: 'smooth' });
  });

  $('#folder-link').addEventListener('input', (e) => { draft.folderLink = e.target.value; saveDraftSoon(); });
  $('#folder-load').addEventListener('click', async () => {
    const folder = drive.parseFolderLink($('#folder-link').value);
    if (!folder) return toast('To nie wygląda na link do folderu Dysku Google.', 'error');
    if (draft.folders.some((f) => f.id === folder.id)) return toast('Ten folder jest już wczytany.');
    const btn = $('#folder-load');
    btn.disabled = true;
    btn.textContent = 'Wczytuję…';
    try {
      const info = await drive.folderInfo(folder);
      const files = await drive.listAudio(folder);
      if (!files.length) toast('W tym folderze nie ma plików audio.', 'error');
      const known = new Set(model.files.map((f) => f.id));
      const fresh = files.filter((f) => !known.has(f.id));
      model.files.push(...fresh);
      draft.files = model.files;
      draft.folders.push({ id: folder.id, resourceKey: folder.resourceKey, name: info.name, count: files.length, fileIds: fresh.map((f) => f.id) });
      draft.folderLink = '';
      $('#folder-link').value = '';
      autoMatch(model, false);
      renderFolders();
      redraw();
      if (files.length) toast(`Wczytano ${pl(files.length, 'plik', 'pliki', 'plików')} z „${info.name}”.`, 'good');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Wczytaj';
    }
  });

  $('#draft-clear').addEventListener('click', () => {
    if (!confirm('Wyczyścić wszystko w tym formularzu?')) return;
    ls.del(K.draft);
    stopAudio();
    addView(setId);
  });

  $('#save').addEventListener('click', async () => {
    let set;
    if (draft.target === 'new') {
      const name = $('#set-name').value.trim();
      if (!name) { $('#set-name').focus(); return toast('Wpisz nazwę zbioru.', 'error'); }
      set = { id: uid(), name, createdAt: Date.now(), folders: [], files: [], tracks: [] };
    } else {
      set = await db.getSet(draft.setId);
      if (!set) return toast('Wybierz zbiór, do którego dodać utwory.', 'error');
    }
    const rows = model.rows.filter((r) => (r.author || r.title).trim());
    const withFile = rows.filter((r) => r.fileId);
    if (!withFile.length) return toast('Żaden utwór nie ma przypisanego pliku nagrania.', 'error');
    const missing = rows.length - withFile.length;
    if (missing && !confirm(`${utwory(missing)} bez pliku zostanie pominiętych. Zapisać pozostałe (${withFile.length})?`)) return;
    const seen = new Set();
    const dups = withFile.filter((r) => (seen.has(r.fileId) ? true : (seen.add(r.fileId), false))).length;
    if (dups && !confirm('Ten sam plik jest przypisany do kilku utworów. Zapisać mimo to?')) return;
    const byId = new Map(model.files.map((f) => [f.id, f]));
    for (const r of withFile) {
      const f = byId.get(r.fileId) || {};
      set.tracks.push({ id: uid(), author: r.author.trim(), title: r.title.trim(), part: (r.part || '').trim(), ...noteOf(r), fileId: r.fileId, fileName: f.name || '', size: f.size || 0, mimeType: f.mimeType || '', resourceKey: f.resourceKey || '', ...extraOf(r, byId) });
    }
    const fileIds = new Set(set.files.map((f) => f.id));
    for (const f of model.files) if (!fileIds.has(f.id)) set.files.push(f);
    const folderIds = new Set(set.folders.map((f) => f.id));
    for (const f of draft.folders) if (!folderIds.has(f.id)) set.folders.push({ id: f.id, resourceKey: f.resourceKey, name: f.name });
    await db.putSet(set);
    ls.del(K.draft);
    stopAudio();
    toast(`Zapisano ${utwory(withFile.length)} w zbiorze „${set.name}”.`, 'good');
    location.replace(`#/zbior/${set.id}`);
  });
}

// ---------- edycja zbioru ----------
async function editView(id) {
  const set = await db.getSet(id);
  if (!set) return go('#/');
  if (set.lib) {
    toast('Zbioru z biblioteki nie można edytować – utwórz własną kopię.', 'error');
    return location.replace(`#/zbior/${id}`);
  }
  setHeader('Edycja zbioru', `#/zbior/${id}`);
  const model = {
    rows: set.tracks.map((t) => ({ key: t.id, id: t.id, author: t.author, title: t.title, part: t.part, note: t.note || '', fileId: t.fileId, extra: (t.extra || []).map((f) => f.fileId), score: 1, manual: true })),
    files: set.files.slice(),
    blocked: new Set(),
  };
  let dirty = false;
  render(`
    <h1 class="page-title">Edycja zbioru</h1>
    <section class="card step">
      <label>Nazwa zbioru<input id="e-name" value="${esc(set.name)}"></label>
      ${set.folders.length ? `<p class="muted">Foldery: ${set.folders.map((f) => esc(f.name)).join(', ')} <button class="btn sm" id="e-refresh">↻ Odśwież listę plików</button></p>` : ''}
      <details><summary>Dodaj nagrania z innego folderu Dysku Google</summary>
        <div class="row-inline"><input id="e-folder" inputmode="url" placeholder="https://drive.google.com/drive/folders/…"><button class="btn primary" id="e-folder-load">Wczytaj</button></div>
        <p class="muted">Nowe pliki pojawią się na dole w „Pliki bez przypisania” – stamtąd dodasz je jako utwory albo wybierzesz w wierszu.</p>
      </details>
    </section>
    <section class="card step"><h2>Utwory (kolejność = kolejność słuchania)</h2>
      <p class="muted">Popraw autora, tytuł lub część, zmień plik nagrania (▶ – odsłuch), kolejność (↑ ↓) albo usuń utwór (✕).</p>
      <div id="table"></div></section>
    <div class="savebar"><a class="btn ghost" href="#/zbior/${esc(id)}">Anuluj</a><button class="btn primary" id="e-save">✓ Zapisz zmiany</button></div>
  `);
  const table = $('#table');
  renderTable(table, model, () => { dirty = true; });
  $('#e-name').addEventListener('input', () => { dirty = true; });
  const rf = $('#e-refresh');
  if (rf) rf.addEventListener('click', async () => {
    rf.disabled = true;
    try {
      const known = new Set(model.files.map((f) => f.id));
      for (const fo of set.folders) for (const f of await drive.listAudio(fo)) if (!known.has(f.id)) { model.files.push(f); known.add(f.id); }
      renderTable(table, model, () => { dirty = true; });
      toast(`Lista plików: ${model.files.length}.`, 'good');
    } catch (e) { toast(e.message, 'error'); }
    rf.disabled = false;
  });
  $('#e-folder-load').addEventListener('click', async () => {
    const folder = drive.parseFolderLink($('#e-folder').value);
    if (!folder) return toast('To nie wygląda na link do folderu Dysku Google.', 'error');
    const btn = $('#e-folder-load');
    btn.disabled = true;
    try {
      const info = await drive.folderInfo(folder);
      const files = await drive.listAudio(folder);
      const known = new Set(model.files.map((f) => f.id));
      const fresh = files.filter((f) => !known.has(f.id));
      model.files.push(...fresh);
      if (!set.folders.some((f) => f.id === folder.id)) set.folders.push({ id: folder.id, resourceKey: folder.resourceKey, name: info.name });
      dirty = true;
      $('#e-folder').value = '';
      renderTable(table, model, () => { dirty = true; });
      toast(`Wczytano ${pl(fresh.length, 'nowy plik', 'nowe pliki', 'nowych plików')} z „${info.name}”.`, 'good');
      const un = $('.unused', table);
      if (un) { un.open = true; un.scrollIntoView({ behavior: 'smooth' }); }
    } catch (e) { toast(e.message, 'error'); }
    btn.disabled = false;
  });
  $('#e-save').addEventListener('click', async () => {
    const name = $('#e-name').value.trim();
    if (!name) return toast('Wpisz nazwę zbioru.', 'error');
    const byId = new Map(model.files.map((f) => [f.id, f]));
    const rows = model.rows.filter((r) => (r.author || r.title).trim());
    const noFile = rows.filter((r) => !r.fileId).length;
    if (noFile && !confirm(`${utwory(noFile)} bez pliku zostanie usuniętych ze zbioru. Kontynuować?`)) return;
    set.name = name;
    set.tracks = rows.filter((r) => r.fileId).map((r) => {
      const f = byId.get(r.fileId) || {};
      return { id: r.id || uid(), author: r.author.trim(), title: r.title.trim(), part: (r.part || '').trim(), ...noteOf(r), fileId: r.fileId, fileName: f.name || '', size: f.size || 0, mimeType: f.mimeType || '', resourceKey: f.resourceKey || '', ...extraOf(r, byId) };
    });
    set.files = model.files;
    await db.putSet(set);
    await cleanupAudio();
    dirty = false;
    stopAudio();
    toast('Zapisano zmiany.', 'good');
    location.replace(`#/zbior/${id}`);
  });
  editView.isDirty = () => dirty;
}

// ---------- ustawienia ----------
async function settingsView() {
  setHeader('Ustawienia', '#/');
  let usage = '';
  try {
    const e = await navigator.storage.estimate();
    usage = `Zajęte przez aplikację: ${fmtMB(e.usage || 0)}${e.quota ? ` (dostępne ok. ${fmtMB(e.quota)})` : ''}.`;
  } catch { /* brak danych */ }
  const own = (() => { try { return localStorage.getItem('sluchawki-api-key') || ''; } catch { return ''; } })();
  render(`
    <h1 class="page-title">Ustawienia</h1>
    <section class="card step">
      <h2>Klucz Google API</h2>
      <p class="muted">Potrzebny, żeby czytać listę plików i odtwarzać nagrania z udostępnionych folderów Dysku Google.
      ${drive.hasApiKey() && !own ? '<br><span class="ok">Aplikacja ma wbudowany wspólny klucz – nic nie musisz robić.</span>' : ''}</p>
      <div class="row-inline"><input id="api-key" value="${esc(own)}" placeholder="AIza…" autocomplete="off" spellcheck="false"><button class="btn primary" id="api-save">Zapisz</button></div>
      <details><summary>Jak zdobyć klucz (5 minut, za darmo)</summary><ol class="howto">
        <li>Wejdź na <a href="https://console.cloud.google.com/" target="_blank" rel="noopener">console.cloud.google.com</a> i zaloguj się kontem Google. Utwórz projekt (np. „Słuchawki”).</li>
        <li>Menu → <b>Interfejsy API i usługi → Biblioteka</b> → wyszukaj <b>Google Drive API</b> → <b>Włącz</b>.</li>
        <li><b>Interfejsy API i usługi → Dane logowania → Utwórz dane logowania → Klucz interfejsu API</b>.</li>
        <li>Kliknij klucz i ustaw ograniczenia: <b>Witryny</b> → adres tej strony (<code>${esc(location.origin)}/*</code>) oraz <b>Ogranicz klucz → Google Drive API</b>. Zapisz.</li>
        <li>Skopiuj klucz i wklej powyżej.</li>
      </ol></details>
    </section>
    <section class="card step">
      <h2>Pamięć urządzenia</h2>
      <p class="muted">${usage}</p>
      <button class="btn danger" id="clear-audio">Usuń wszystkie pobrane nagrania</button>
    </section>
    <section class="card step">
      <h2>O aplikacji</h2>
      <p><strong>Aplikacja do użytku wewnętrznego, utworzona na potrzeby nauki na WOM.</strong></p>
      <p class="muted">Słuchawki – Kanony na WOM. Zbiory utworów i wyniki są zapisane tylko na tym urządzeniu. Aby przenieść zbiory na inne urządzenie, użyj „Eksportuj do pliku” (w zbiorze) albo „Eksportuj wszystkie zbiory” (na stronie głównej), a potem „Importuj z pliku” na drugim urządzeniu.</p>
    </section>
  `);
  $('#api-save').addEventListener('click', () => {
    drive.setApiKey($('#api-key').value);
    toast($('#api-key').value.trim() ? 'Zapisano klucz.' : 'Usunięto własny klucz.', 'good');
  });
  $('#clear-audio').addEventListener('click', async () => {
    if (!confirm('Usunąć wszystkie pobrane nagrania? Zbiory zostaną.')) return;
    stopAudio();
    for (const k of await db.audioKeys()) await db.deleteAudio(k);
    toast('Usunięto pobrane nagrania.');
    settingsView();
  });
}

// ---------- udostępnianie, eksport, import ----------
/** { extra:[plik] } tylko gdy utwór ma kolejne fragmenty (pliki) */
function extraOf(r, byId) {
  const ids = (r.extra || []).filter((id) => id && id !== r.fileId);
  if (!ids.length) return {};
  return { extra: ids.map((id) => { const f = byId.get(id) || {}; return { fileId: id, fileName: f.name || '', size: f.size || 0, mimeType: f.mimeType || '', resourceKey: f.resourceKey || '' }; }) };
}
/** { note } tylko gdy uwagi są niepuste */
function noteOf(r) {
  const n = typeof r.note === 'string' ? r.note.trim() : '';
  return n ? { note: n } : {};
}
function packSet(set) {
  return {
    app: 'sluchawki', v: 1, id: set.id, name: set.name, folders: set.folders, exportedAt: Date.now(),
    // 9. pole (uwagi) i 10. (kolejne pliki utworu) tylko gdy są – starsze pliki i linki zostają bez zmian
    tracks: set.tracks.map((t) => {
      const a = [t.author, t.title, t.part, t.fileId, t.fileName, t.size, t.mimeType, t.resourceKey || ''];
      const ex = t.extra && t.extra.length ? [t.extra.map((f) => [f.fileId, f.fileName, f.size, f.mimeType, f.resourceKey || ''])] : [];
      return t.note || ex.length ? [...a, t.note || '', ...ex] : a;
    }),
  };
}
function unpackSet(d) {
  if (!d || d.app !== 'sluchawki' || !Array.isArray(d.tracks)) throw new Error('To nie jest zbiór Słuchawek.');
  return {
    id: typeof d.id === 'string' && /^[\w-]{4,80}$/.test(d.id) ? d.id : '',
    name: String(d.name || 'Zbiór'), folders: Array.isArray(d.folders) ? d.folders : [],
    tracks: d.tracks.map((a) => ({ id: uid(), author: a[0] || '', title: a[1] || '', part: a[2] || '', fileId: a[3], fileName: a[4] || '', size: a[5] || 0, mimeType: a[6] || '', resourceKey: a[7] || '', ...noteOf({ note: a[8] }), ...unpackExtra(a[9]) }))
      .filter((t) => typeof t.fileId === 'string' && t.fileId),
  };
}
function unpackExtra(x) {
  if (!Array.isArray(x)) return {};
  const extra = x.filter((f) => Array.isArray(f) && typeof f[0] === 'string' && f[0])
    .map((f) => ({ fileId: f[0], fileName: f[1] || '', size: f[2] || 0, mimeType: f[3] || '', resourceKey: f[4] || '' }));
  return extra.length ? { extra } : {};
}
/** plik/link może zawierać jeden zbiór albo kilka ({ app, sets: [...] }) */
function unpackAny(d) {
  if (d && d.app === 'sluchawki' && Array.isArray(d.sets)) return d.sets.map(unpackSet);
  return [unpackSet(d)];
}
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
async function streamBytes(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}
async function encodeShare(obj) {
  const raw = new TextEncoder().encode(JSON.stringify(obj));
  if (typeof CompressionStream === 'function') {
    const z = await streamBytes(raw, new CompressionStream('deflate-raw'));
    let s = '';
    for (let i = 0; i < z.length; i += 8192) s += String.fromCharCode(...z.subarray(i, i + 8192));
    return 'z' + btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  return 'j' + b64url(raw);
}
async function decodeShare(s) {
  const bytes = unb64url(s.slice(1));
  const raw = s[0] === 'z' ? await streamBytes(bytes, new DecompressionStream('deflate-raw')) : bytes;
  return JSON.parse(new TextDecoder().decode(raw));
}

async function shareSet(set) {
  const url = `${location.origin}${location.pathname}#/import/${await encodeShare(packSet(set))}`;
  if (navigator.share) {
    try { await navigator.share({ title: `Słuchawki – ${set.name}`, text: `Zbiór utworów „${set.name}” do nauki w aplikacji Słuchawki`, url }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(url); toast('Link skopiowany – wyślij go komuś.', 'good'); } catch { prompt('Skopiuj link:', url); }
}

function downloadJson(obj, name) {
  const blob = new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name.replace(/[\\/:*?"<>|]+/g, '_');
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
const exportSet = (set) => { downloadJson(packSet(set), `${set.name}.sluchawki.json`); toast('Zapisano plik zbioru.', 'good'); };
async function exportAll() {
  const sets = (await db.listSets()).sort((a, b) => a.name.localeCompare(b.name, 'pl'));
  if (!sets.length) return toast('Nie ma zbiorów do eksportu.');
  const day = new Date().toISOString().slice(0, 10);
  downloadJson({ app: 'sluchawki', v: 1, exportedAt: Date.now(), sets: sets.map(packSet) }, `Sluchawki-wszystkie-zbiory-${day}.sluchawki.json`);
  toast(`Zapisano plik z ${pl(sets.length, 'zbiorem', 'zbiorami', 'zbiorami')}.`, 'good');
}

/** zapisuje zbiór z importu (zastępuje albo dodaje jako nowy) */
async function saveImported(s, { lib = null, ask = true } = {}) {
  const sets = await db.listSets();
  let same = (s.id && sets.find((x) => x.id === s.id)) || (lib && sets.find((x) => x.lib && x.lib.file === lib.file)) || sets.find((x) => x.name === s.name);
  if (same && same.lib && !lib) same = null; // zbiór z biblioteki zmienia tylko aktualizacja z biblioteki
  const files = s.tracks.flatMap(trackFiles).map((t) => ({ id: t.fileId, name: t.fileName, size: t.size, mimeType: t.mimeType, resourceKey: t.resourceKey }));
  let set = null;
  if (same) {
    const replace = !ask || confirm(`Masz już zbiór „${same.name}”. Zastąpić go importowanym (${utwory(s.tracks.length)})?\n„Anuluj” zapisze go jako osobny zbiór.`);
    if (replace) {
      const known = new Set(same.files.map((f) => f.id));
      set = { ...same, name: s.name, folders: s.folders, tracks: s.tracks, files: [...same.files, ...files.filter((f) => !known.has(f.id))] };
    }
  }
  if (!set) {
    const taken = new Set(sets.map((x) => x.name));
    let name = s.name;
    for (let i = 2; taken.has(name); i++) name = `${s.name} (${i})`;
    set = { id: s.id && !sets.some((x) => x.id === s.id) ? s.id : uid(), name, createdAt: Date.now(), folders: s.folders, files, tracks: s.tracks };
  }
  if (lib) set.lib = lib;
  await db.putSet(set);
  await cleanupAudio();
  return set;
}

async function importData(d) {
  let list;
  try { list = unpackAny(d); } catch (e) { return toast(e.message, 'error'); }
  const saved = [];
  for (const s of list) saved.push(await saveImported(s));
  if (saved.length === 1) {
    toast(`Zaimportowano „${saved[0].name}” (${utwory(saved[0].tracks.length)}).`, 'good');
    location.replace(`#/zbior/${saved[0].id}`);
  } else {
    toast(`Zaimportowano ${pl(saved.length, 'zbiór', 'zbiory', 'zbiorów')}.`, 'good');
    if (location.hash === '#/' || !location.hash) home(); else location.replace('#/');
  }
}

async function importFiles(fileList) {
  for (const f of fileList) {
    let d;
    try { d = JSON.parse(await f.text()); } catch { toast(`„${f.name}” to nie jest plik zbioru Słuchawek.`, 'error'); continue; }
    await importData(d);
  }
}

// ---------- biblioteka zbiorów (pliki w folderze zbiory/ repozytorium) ----------
async function loadLibrary() {
  try {
    const res = await fetch('zbiory/index.json', { cache: 'no-cache' });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.sets) ? data.sets.filter((x) => x && x.file && x.name) : [];
  } catch { return []; }
}

async function importFromLibrary(entry) {
  let d;
  try {
    const res = await fetch(`zbiory/${encodeURIComponent(entry.file)}`, { cache: 'no-cache' });
    if (!res.ok) throw new Error('http');
    d = await res.json();
  } catch { toast('Nie udało się pobrać zbioru z biblioteki. Sprawdź internet.', 'error'); return home(); }
  let list;
  try { list = unpackAny(d); } catch (e) { toast(e.message, 'error'); return home(); }
  const sets = await db.listSets();
  const mine = sets.find((x) => x.lib && x.lib.file === entry.file);
  if (mine && !confirm(`Zaktualizować „${mine.name}” do wersji z biblioteki? Twoje zmiany w tym zbiorze zostaną zastąpione (wyniki quizów zostają).`)) return home();
  const set = await saveImported(list[0], { lib: { file: entry.file, hash: entry.hash }, ask: !mine });
  toast(`${mine ? 'Zaktualizowano' : 'Dodano'} „${set.name}”.`, 'good');
  home();
}

async function importView(data) {
  setHeader('Import zbioru', '#/');
  let d;
  try { d = await decodeShare(data); unpackSet(d); } catch {
    render('<div class="card empty">Ten link jest uszkodzony albo niekompletny.</div><a class="btn wide" href="#/">Strona główna</a>');
    return;
  }
  importPreview(d, 'Ktoś udostępnił Ci');
}

/** podgląd zbioru (albo kilku zbiorów) przed zapisem */
function importPreview(d, lead) {
  const list = unpackAny(d);
  const one = (s) => `<p>${lead} zbiór <b>${esc(s.name)}</b> (${utwory(s.tracks.length)}).</p>
    <ol class="mini-list">${s.tracks.slice(0, 8).map((t) => `<li>${esc(trackLabel(t))}</li>`).join('')}${s.tracks.length > 8 ? '<li>…</li>' : ''}</ol>`;
  render(`
    <h1 class="page-title">Import zbioru</h1>
    <div class="card">${list.length === 1 ? one(list[0])
    : `<p>${lead} ${pl(list.length, 'zbiór', 'zbiory', 'zbiorów')}:</p><ul class="mini-list">${list.map((s) => `<li><b>${esc(s.name)}</b> (${utwory(s.tracks.length)})</li>`).join('')}</ul>`}</div>
    <div class="grid2"><a class="btn" href="#/">Anuluj</a><button class="btn primary" id="imp-ok">${list.length === 1 ? 'Zapisz zbiór' : 'Zapisz zbiory'}</button></div>
  `);
  $('#imp-ok').addEventListener('click', () => importData(d));
}

/** link → dane zbioru: link „Udostępnij”, plik na Dysku Google albo plik .json w internecie */
async function fetchSetFromLink(link) {
  const s = String(link || '').trim();
  const share = s.match(/#\/import\/([\w-]+)/);
  if (share) {
    try { return await decodeShare(share[1]); } catch { throw new Error('Ten link „Udostępnij” jest uszkodzony albo niekompletny – skopiuj go jeszcze raz w całości.'); }
  }
  if (/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\//.test(s)) throw new Error('To link do folderu. Podaj link do pliku zbioru (.sluchawki.json) – w Dysku Google: plik → Udostępnij → Kopiuj link.');
  const gfile = drive.parseFileLink(s);
  let text;
  if (gfile) text = await drive.fileText(gfile);
  else {
    let url;
    try { url = new URL(s); } catch { throw new Error('To nie wygląda na link. Wklej cały adres zaczynający się od https://'); }
    if (!/^https?:$/.test(url.protocol)) throw new Error('To nie wygląda na link. Wklej cały adres zaczynający się od https://');
    let res;
    try { res = await fetch(url.href, { cache: 'no-cache' }); } catch {
      throw new Error('Nie udało się pobrać pliku. Brak internetu albo ta strona nie pozwala na pobieranie przez aplikację – pobierz plik i użyj „Importuj z pliku”.');
    }
    if (!res.ok) throw new Error(`Nie udało się pobrać pliku (błąd ${res.status}). Sprawdź link.`);
    text = await res.text();
  }
  try { return JSON.parse(text); } catch { throw new Error('Pod tym linkiem nie ma pliku zbioru Słuchawek.'); }
}

async function importLinkView() {
  setHeader('Import z linku', '#/');
  render(`
    <h1 class="page-title">Import z linku</h1>
    <section class="card step">
      <p class="muted">Wklej link do zbioru:</p>
      <ul class="muted">
        <li>link z przycisku <b>↗ Udostępnij link</b> w aplikacji,</li>
        <li>link do pliku <i>.sluchawki.json</i> na Dysku Google (udostępnionego „Każdy, kto ma link”),</li>
        <li>albo adres pliku <i>.json</i> w internecie.</li>
      </ul>
      <div class="row-inline"><input id="imp-link" inputmode="url" autocomplete="off" placeholder="https://…" aria-label="Link do zbioru"><button class="btn primary" id="imp-go">Wczytaj</button></div>
      <p class="muted" id="imp-status" hidden></p>
    </section>
  `);
  const go = async () => {
    const link = $('#imp-link').value.trim();
    if (!link) return toast('Wklej link.', 'error');
    const btn = $('#imp-go');
    btn.disabled = true;
    $('#imp-status').hidden = false;
    $('#imp-status').textContent = 'Wczytywanie…';
    let d;
    try {
      d = await fetchSetFromLink(link);
      unpackAny(d);
    } catch (e) {
      btn.disabled = false;
      $('#imp-status').hidden = true;
      return toast(e.message, 'error');
    }
    importPreview(d, 'Pod linkiem jest');
  };
  $('#imp-go').addEventListener('click', go);
  $('#imp-link').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  $('#imp-link').focus();
}

// ---------- router ----------
const routes = [
  [/^#?\/?$/, home],
  [/^#\/zbior\/([\w-]+)$/, setView],
  [/^#\/dodaj(?:\/([\w-]+))?$/, addView],
  [/^#\/edytuj\/([\w-]+)$/, editView],
  [/^#\/sluchaj$/, playerView],
  [/^#\/quiz$/, quizView],
  [/^#\/wynik$/, resultView],
  [/^#\/ustawienia$/, settingsView],
  [/^#\/import\/([\w-]+)$/, importView],
  [/^#\/import$/, importLinkView],
];
let lastHash = null;
async function route() {
  const h = location.hash || '#/';
  if (lastHash === '#/quiz' && h !== '#/quiz' && owner === 'quiz') stopAudio();
  if (lastHash && lastHash.startsWith('#/dodaj') && owner === 'preview') stopAudio();
  lastHash = h;
  for (const [re, fn] of routes) {
    const m = h.match(re);
    if (m) {
      try { await fn(m[1]); } catch (e) { console.error(e); toast('Coś poszło nie tak: ' + e.message, 'error'); }
      updateMini();
      return;
    }
  }
  location.replace('#/');
}

$('#btn-settings').addEventListener('click', () => go('#/ustawienia'));
window.addEventListener('beforeunload', (e) => { if (location.hash.startsWith('#/edytuj') && editView.isDirty && editView.isDirty()) e.preventDefault(); });
const flush = () => { if (draft && location.hash.startsWith('#/dodaj')) saveDraft(); if (quiz) saveQuiz(); if (player) ls.set(K.player, player); };
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
window.addEventListener('pagehide', flush);
window.addEventListener('online', () => document.body.classList.remove('offline'));
window.addEventListener('offline', () => document.body.classList.add('offline'));
if (!navigator.onLine) document.body.classList.add('offline');

(async () => {
  if (player) playerSet = await db.getSet(player.setId).catch(() => null);
  if (location.hash === '#/sluchaj' && !player) location.replace('#/');
  route();
})();
