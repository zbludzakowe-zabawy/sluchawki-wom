// Słuchawki – Kanony na WOM. Interfejs aplikacji.
import * as db from './db.js';
import * as drive from './drive.js';
import { readFileText } from './ocr.js';
import { confetti } from './confetti.js';
import {
  parseList, matchAll, matchScore, confidence, MATCH_MIN, trackFromFileName, checkAnswer, shuffle, fold, surname,
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

const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* pełna pamięć – trudno */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* trudno */ } },
};
const K = { prefs: 'sluchawki-prefs', player: 'sluchawki-player', quiz: 'sluchawki-quiz', draft: 'sluchawki-draft', result: 'sluchawki-last-result' };
const prefs = Object.assign({ fragment: 15, count: 'all' }, ls.get(K.prefs, {}));
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
    const off = n && s.tracks.every((t) => downloaded.has(t.fileId));
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
    ${sets.length ? `<div class="list">${cards}</div>` : `<div class="empty card">Nie masz jeszcze żadnego zbioru utworów.<br>Dodaj pierwszy albo zaimportuj zbiór od kogoś.</div>`}
    <h2 class="sec-title">Dodawanie</h2>
    <div class="grid2">
      <a class="btn big" href="#/dodaj">＋ Nowy zbiór</a>
      <label class="btn big">⇩ Importuj z pliku<input type="file" id="imp-file" accept=".json,application/json" hidden></label>
    </div>
    ${!drive.hasApiKey() ? `<p class="hint">Do słuchania z Dysku Google potrzebny jest klucz API – <a href="#/ustawienia">ustaw go w Ustawieniach</a>.</p>` : ''}
  `);
  $('#imp-file').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try { importData(JSON.parse(await f.text())); } catch { toast('To nie jest plik zbioru Słuchawek.', 'error'); }
  });
}

// ---------- widok zbioru ----------
async function setView(id) {
  const set = await db.getSet(id);
  if (!set) { toast('Nie ma takiego zbioru.'); return go('#/'); }
  setHeader(set.name, '#/');
  await refreshDownloaded();
  const n = set.tracks.length;
  const have = set.tracks.filter((t) => downloaded.has(t.fileId)).length;
  const size = set.tracks.reduce((s, t) => s + (t.size || 0), 0);
  const authors = groupAuthors(set.tracks);
  const results = (await db.resultsFor(id).catch(() => [])).sort((a, b) => b.date - a.date).slice(0, 5);
  render(`
    <h1 class="page-title">${esc(set.name)}</h1>
    <p class="muted">${utwory(n)}</p>
    ${!n ? `<div class="empty card">Ten zbiór jest pusty. <a href="#/dodaj/${esc(id)}">Dodaj utwory</a>.</div>` : ''}
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
        ${['all', '10', '20', '30'].map((v) => `<option value="${v}" ${prefs.count === v ? 'selected' : ''}>${v === 'all' ? `wszystkie (${n})` : v}</option>`).join('')}
      </select></label>
      <label>Fragment: <select id="q-frag">
        ${[5, 10, 15, 20, 30, 45].map((v) => `<option value="${v}" ${prefs.fragment === v ? 'selected' : ''}>${v} s</option>`).join('')}
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
    <h2 class="sec-title">Zarządzanie</h2>
    <div class="grid2">
      <a class="btn" href="#/dodaj/${esc(id)}">＋ Dodaj utwory</a>
      <a class="btn" href="#/edytuj/${esc(id)}">✎ Edytuj zbiór</a>
      <button class="btn" id="share">↗ Udostępnij link</button>
      <button class="btn" id="export">⇪ Zapisz do pliku</button>
    </div>
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
    for (const t of set.tracks) if (!keep.has(t.fileId)) await db.deleteAudio(t.fileId);
    toast('Usunięto pobrane nagrania.');
    setView(id);
  });
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
  for (const s of await db.listSets()) if (s.id !== setId) for (const t of s.tracks) keep.add(t.fileId);
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
  const todo = set.tracks.filter((t, i, a) => !downloaded.has(t.fileId) && a.findIndex((x) => x.fileId === t.fileId) === i);
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
    st.textContent = `Pobieranie ${done + 1} z ${todo.length}: ${trackLabel(t)}`;
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
let player = ls.get(K.player, null); // { setId, title, queue:[trackId], index }
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
  player = { setId: set.id, title, queue, index: 0 };
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
  try { await playTrack(t, 'player'); } catch (e) { toast(e.message, 'error'); }
  renderPlayerState();
}

function step(d) {
  if (!player) return;
  const n = player.queue.length;
  const i = player.index + d;
  if (i < 0) { audio.currentTime = 0; return; }
  if (i >= n) { stopAudio(); player.index = 0; ls.set(K.player, player); renderPlayerState(); toast('Koniec listy.'); return; }
  player.index = i;
  playCurrent();
}

audio.addEventListener('ended', () => { if (owner === 'player') step(1); });

function setMediaSession(t) {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title + (t.part ? `, ${t.part}` : ''), artist: t.author, album: playerSet ? playerSet.name : 'Słuchawki',
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
    return t ? `<li><button data-i="${i}"><span class="qn">${i + 1}</span><span>${esc(trackLabel(t))}</span>${downloaded.has(t.fileId) ? '<span class="dl" title="pobrany">⇩</span>' : ''}</button></li>` : '';
  }).join('');
  render(`
    <div class="player card">
      <div class="now"><div class="disc" aria-hidden="true">♫</div>
        <div><div class="now-author" id="p-author"></div><div class="now-title" id="p-title"></div><div class="muted" id="p-pos"></div></div></div>
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
  $$('.queue button').forEach((b) => b.addEventListener('click', () => { player.index = Number(b.dataset.i); playCurrent(); }));
  renderPlayerState();
}

const fmtT = (s) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00');
function renderPlayerState() {
  updateMini();
  if (!$('#p-title')) return;
  const t = currentTrack();
  if (!t) return;
  $('#p-author').textContent = t.author || '';
  $('#p-title').textContent = t.title + (t.part ? `, ${t.part}` : '');
  $('#p-pos').textContent = `${player.index + 1} / ${player.queue.length}`;
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
  $('#mini-title').textContent = trackLabel(t);
  $('#mini-play').textContent = audio.paused ? '▶' : '⏸';
}
$('#mini-play').addEventListener('click', () => { if (audio.paused) audio.play().catch(() => undefined); else audio.pause(); });
$('#mini-open').addEventListener('click', () => go('#/sluchaj'));

// ---------- quiz ----------
let quiz = ls.get(K.quiz, null);
let quizSet = null;
const saveQuiz = () => ls.set(K.quiz, quiz);

function startQuiz(set, type, ids) {
  if (!set.tracks.length) return toast('Ten zbiór jest pusty.');
  if (type === 'choice' && set.tracks.length < 2) return toast('Do quizu wyboru potrzeba co najmniej 2 utworów.');
  let order = ids ? shuffle(ids) : freshShuffle(set.tracks.map((t) => t.id), set.id + '-quiz');
  if (!ids && prefs.count !== 'all') order = order.slice(0, Number(prefs.count));
  quiz = { setId: set.id, type, order, idx: 0, answers: [], fragment: prefs.fragment, phase: 'ask', draft: null };
  quizSet = set;
  saveQuiz();
  go('#/quiz');
}

const quizTrack = () => quizSet && quizSet.tracks.find((t) => t.id === quiz.order[quiz.idx]);

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
    body = `
      <form id="q-form" class="qform" autocomplete="off">
        <label class="${mark('author')}">Autor (imię i nazwisko)<input name="author" value="${esc(d.author)}" ${answered ? 'readonly' : ''} autocapitalize="words" spellcheck="false"></label>
        <label class="${mark('title')}">Tytuł<input name="title" value="${esc(d.title)}" ${answered ? 'readonly' : ''} spellcheck="false"></label>
        <label class="${mark('part')}">Część / fragment<input name="part" value="${esc(d.part)}" ${answered ? 'readonly' : ''} spellcheck="false"></label>
        ${answered ? '' : '<div class="grid2"><button type="button" class="btn" id="q-skip">Nie wiem</button><button class="btn primary">Sprawdź</button></div>'}
      </form>`;
  }
  const fb = answered ? `<div class="feedback ${answered.ok ? 'good' : 'bad'}">
      <strong>${answered.ok ? 'Brawo! +1 punkt' : 'Niestety nie.'}</strong>
      <span>To był: ${esc(trackLabel(t))}</span></div>
      <button class="btn primary wide" id="q-next">${quiz.idx + 1 < n ? 'Dalej ›' : 'Zobacz wynik'}</button>` : '';
  render(`
    <div class="quiz-top">
      <span>Pytanie <b>${quiz.idx + 1}</b> / ${n}</span><span>Punkty: <b>${score}</b></span>
    </div>
    <div class="card fragment">
      <button class="round main" id="q-play" aria-label="Odtwórz fragment">▶</button>
      <div class="frag-info"><div class="bar"><i id="q-bar"></i></div><small class="muted" id="q-status">Fragment ${quiz.fragment} s</small></div>
    </div>
    ${fb}
    ${body}
    <button class="btn ghost wide" id="q-end">Zakończ quiz</button>
  `);
  $('#q-play').addEventListener('click', () => playFragment());
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

let fragTimer = null;
async function playFragment() {
  const t = quizTrack();
  if (!t) return;
  clearTimeout(fragTimer);
  try {
    $('#q-status').textContent = 'Ładowanie…';
    const ok = await playTrack(t, 'quiz');
    if (!ok) { updateFragUi(); return; }
  } catch (e) { toast(e.message, 'error'); updateFragUi(); return; }
  updateFragUi();
}
function quizTick() {
  if (!quiz) return;
  if (audio.currentTime >= quiz.fragment) audio.pause();
  updateFragUi();
}
function updateFragUi() {
  const bar = $('#q-bar');
  if (!bar || !quiz) return;
  const p = owner === 'quiz' ? Math.min(1, audio.currentTime / quiz.fragment) : 0;
  bar.style.width = `${p * 100}%`;
  const playing = owner === 'quiz' && !audio.paused;
  $('#q-play').textContent = playing ? '⏸' : '▶';
  $('#q-status').textContent = playing ? `Słuchaj… ${Math.max(0, Math.ceil(quiz.fragment - audio.currentTime))} s` : (p >= 1 ? 'Koniec fragmentu – stuknij ▶, żeby posłuchać jeszcze raz' : `Fragment ${quiz.fragment} s`);
  $('#q-play').onclick = playing ? () => audio.pause() : () => playFragment();
}
audio.addEventListener('pause', () => { if (owner === 'quiz') updateFragUi(); });
audio.addEventListener('play', () => { if (owner === 'quiz') updateFragUi(); });

function answerChoice(id) {
  const t = quizTrack();
  const chosen = quizSet.tracks.find((x) => x.id === id);
  const ok = id === t.id || (chosen && fold(trackLabel(chosen)) === fold(trackLabel(t)));
  quiz.answers.push({ id: t.id, ok, given: id });
  quiz.phase = 'feedback';
  saveQuiz();
  renderQuestion(false);
}

function answerText(given, skipped) {
  const t = quizTrack();
  const detail = skipped ? { author: false, title: false, part: false, ok: false } : checkAnswer(given, t);
  quiz.answers.push({ id: t.id, ok: detail.ok, given, detail });
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
    const f = (k, l) => `<span class="${a.detail[k] ? 'ok' : 'bad'}">${l}: ${esc(g[k] || '—')}</span>`;
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
  if (again) again.addEventListener('click', () => startQuiz(set, res.type, bad.map((a) => a.id).filter((id) => byId(id))));
  $('#r-again').addEventListener('click', () => startQuiz(set, res.type));
}

// ---------- tabela utworów (dodawanie i edycja) ----------
// model: { rows:[{key,id?,author,title,part,fileId,score,manual}], files:[{id,name,size,mimeType,resourceKey}], blocked:Set(fileId) }
function rowRanking(model, row) {
  return model.files
    .filter((f) => !model.blocked.has(f.id))
    .map((f) => ({ f, s: matchScore(row, f.name) }))
    .sort((a, b) => b.s - a.s || a.f.name.localeCompare(b.f.name, 'pl'));
}

function autoMatch(model, all) {
  const rows = model.rows.filter((r) => all || !r.manual);
  const taken = new Set(model.rows.filter((r) => !all && r.manual && r.fileId).map((r) => r.fileId));
  const files = model.files.filter((f) => !taken.has(f.id) && !model.blocked.has(f.id));
  const { result } = matchAll(rows, files);
  rows.forEach((r, i) => { r.fileId = result[i].fileId; r.score = result[i].score; if (all) r.manual = false; });
}

function renderTable(root, model, onChange) {
  const counts = {};
  for (const r of model.rows) if (r.fileId) counts[r.fileId] = (counts[r.fileId] || 0) + 1;
  const used = new Set(model.rows.map((r) => r.fileId).filter(Boolean));
  const unused = model.files.filter((f) => !used.has(f.id) && !model.blocked.has(f.id));
  const nHigh = model.rows.filter((r) => r.fileId && (r.manual || confidence(r.score) === 'high')).length;
  const nNone = model.rows.filter((r) => !r.fileId).length;
  const rowHtml = (r, i) => {
    const conf = !r.fileId ? 'none' : r.manual ? 'manual' : confidence(r.score);
    const rank = model.files.length ? rowRanking(model, r) : [];
    const opts = rank.map(({ f, s }) => `<option value="${esc(f.id)}" ${f.id === r.fileId ? 'selected' : ''}>${s >= MATCH_MIN ? '★ ' : ''}${esc(f.name)}</option>`).join('');
    const dup = r.fileId && counts[r.fileId] > 1;
    const badge = { none: 'brak pliku', manual: 'wybrany ręcznie', high: `pewne ${Math.round(r.score * 100)}%`, mid: `sprawdź ${Math.round(r.score * 100)}%`, low: `wątpliwe ${Math.round(r.score * 100)}%` }[conf];
    return `<div class="trow conf-${conf}${dup ? ' dup' : ''}" data-i="${i}">
      <div class="tnum">${i + 1}</div>
      <div class="tfields">
        <input data-f="author" placeholder="Autor" value="${esc(r.author)}" aria-label="Autor">
        <input data-f="title" placeholder="Tytuł" value="${esc(r.title)}" aria-label="Tytuł">
        <input data-f="part" placeholder="Część / fragment (jeśli jest)" value="${esc(r.part)}" aria-label="Część lub fragment">
        <div class="tfile">
          <select data-f="fileId" aria-label="Plik nagrania"><option value="">— brak pliku —</option>${opts}</select>
          <button type="button" class="round sm" data-act="listen" aria-label="Posłuchaj" ${r.fileId ? '' : 'disabled'}>▶</button>
        </div>
        <div class="tmeta"><span class="badge">${badge}</span>${dup ? ' <span class="warn">ten sam plik w kilku wierszach</span>' : ''}</div>
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
    if (el.dataset.f === 'fileId') {
      r.fileId = el.value || null;
      r.manual = true;
      const f = model.files.find((x) => x.id === r.fileId);
      r.score = f ? matchScore(r, f.name) : 0;
      return rerender();
    }
    if (el.dataset.f && !r.manual) {
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
    } else if (act === 'listen') {
      const r = model.rows[i];
      const f = model.files.find((x) => x.id === r.fileId);
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
  const sets = (await db.listSets()).sort((a, b) => a.name.localeCompare(b.name, 'pl'));
  draft = ls.get(K.draft, null) || { target: 'new', setId: '', name: '', text: '', rows: [], folderLink: '', folders: [], files: [] };
  if (setId && sets.some((s) => s.id === setId)) { draft.target = 'existing'; draft.setId = setId; }
  if (draft.target === 'existing' && !sets.some((s) => s.id === draft.setId)) { draft.target = 'new'; draft.setId = ''; }
  setHeader('Dodawanie utworów', setId ? `#/zbior/${setId}` : '#/');
  const model = { rows: draft.rows, files: draft.files, blocked: new Set() };
  const updateBlocked = () => {
    model.blocked = new Set();
    const s = sets.find((x) => x.id === draft.setId);
    if (draft.target === 'existing' && s) for (const t of s.tracks) model.blocked.add(t.fileId);
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
      <p class="muted">Wybierz zdjęcie lub skan listy (albo PDF). Aplikacja odczyta tekst – potem możesz go poprawić. Możesz też wkleić listę: jeden utwór w linii, np. <i>J.S. Bach – Koncert brandenburski nr 3, cz. I</i>.</p>
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
      for (const r of model.rows) if (r.fileId && ids.has(r.fileId)) { r.fileId = null; r.score = 0; r.manual = false; }
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
      set.tracks.push({ id: uid(), author: r.author.trim(), title: r.title.trim(), part: (r.part || '').trim(), fileId: r.fileId, fileName: f.name || '', size: f.size || 0, mimeType: f.mimeType || '', resourceKey: f.resourceKey || '' });
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
  setHeader('Edycja zbioru', `#/zbior/${id}`);
  const model = {
    rows: set.tracks.map((t) => ({ key: t.id, id: t.id, author: t.author, title: t.title, part: t.part, fileId: t.fileId, score: 1, manual: true })),
    files: set.files.slice(),
    blocked: new Set(),
  };
  let dirty = false;
  render(`
    <h1 class="page-title">Edycja zbioru</h1>
    <section class="card step">
      <label>Nazwa zbioru<input id="e-name" value="${esc(set.name)}"></label>
      ${set.folders.length ? `<p class="muted">Foldery: ${set.folders.map((f) => esc(f.name)).join(', ')} <button class="btn sm" id="e-refresh">↻ Odśwież listę plików</button></p>` : ''}
    </section>
    <section class="card step"><h2>Utwory (kolejność = kolejność słuchania)</h2><div id="table"></div></section>
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
      return { id: r.id || uid(), author: r.author.trim(), title: r.title.trim(), part: (r.part || '').trim(), fileId: r.fileId, fileName: f.name || '', size: f.size || 0, mimeType: f.mimeType || '', resourceKey: f.resourceKey || '' };
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
      <p class="muted">Słuchawki – Kanony na WOM. Zbiory utworów i wyniki są zapisane tylko na tym urządzeniu. Aby przenieść zbiór na inne urządzenie, użyj „Udostępnij link” albo „Zapisz do pliku”.</p>
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
function packSet(set) {
  return {
    app: 'sluchawki', v: 1, name: set.name, folders: set.folders,
    tracks: set.tracks.map((t) => [t.author, t.title, t.part, t.fileId, t.fileName, t.size, t.mimeType, t.resourceKey || '']),
  };
}
function unpackSet(d) {
  if (!d || d.app !== 'sluchawki' || !Array.isArray(d.tracks)) throw new Error('To nie jest zbiór Słuchawek.');
  return {
    name: String(d.name || 'Zbiór'), folders: Array.isArray(d.folders) ? d.folders : [],
    tracks: d.tracks.map((a) => ({ id: uid(), author: a[0] || '', title: a[1] || '', part: a[2] || '', fileId: a[3], fileName: a[4] || '', size: a[5] || 0, mimeType: a[6] || '', resourceKey: a[7] || '' }))
      .filter((t) => typeof t.fileId === 'string' && t.fileId),
  };
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

function exportSet(set) {
  const blob = new Blob([JSON.stringify(packSet(set), null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${set.name.replace(/[\\/:*?"<>|]+/g, '_')}.sluchawki.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

async function importData(d) {
  let s;
  try { s = unpackSet(d); } catch (e) { return toast(e.message, 'error'); }
  const sets = await db.listSets();
  const same = sets.find((x) => x.name === s.name);
  let set;
  if (same && confirm(`Masz już zbiór „${s.name}”. Zastąpić go importowanym? („Anuluj” zapisze kopię.)`)) {
    set = { ...same, folders: s.folders, tracks: s.tracks, files: same.files };
  } else {
    set = { id: uid(), name: same ? `${s.name} (2)` : s.name, createdAt: Date.now(), folders: s.folders, files: s.tracks.map((t) => ({ id: t.fileId, name: t.fileName, size: t.size, mimeType: t.mimeType, resourceKey: t.resourceKey })), tracks: s.tracks };
  }
  await db.putSet(set);
  toast(`Zaimportowano „${set.name}” (${utwory(set.tracks.length)}).`, 'good');
  location.replace(`#/zbior/${set.id}`);
}

async function importView(data) {
  setHeader('Import zbioru', '#/');
  let d;
  try { d = await decodeShare(data); unpackSet(d); } catch {
    render('<div class="card empty">Ten link jest uszkodzony albo niekompletny.</div><a class="btn wide" href="#/">Strona główna</a>');
    return;
  }
  const s = unpackSet(d);
  render(`
    <h1 class="page-title">Import zbioru</h1>
    <div class="card"><p>Ktoś udostępnił Ci zbiór <b>${esc(s.name)}</b> (${utwory(s.tracks.length)}).</p>
    <ol class="mini-list">${s.tracks.slice(0, 8).map((t) => `<li>${esc(trackLabel(t))}</li>`).join('')}${s.tracks.length > 8 ? '<li>…</li>' : ''}</ol></div>
    <div class="grid2"><a class="btn" href="#/">Anuluj</a><button class="btn primary" id="imp-ok">Zapisz zbiór</button></div>
  `);
  $('#imp-ok').addEventListener('click', () => importData(d));
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
