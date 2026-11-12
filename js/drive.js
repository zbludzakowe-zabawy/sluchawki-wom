// Słuchawki – Dysk Google (tylko odczyt plików udostępnionych „każdemu, kto ma link”).
import { GOOGLE_API_KEY } from './config.js';

const KEY_LS = 'sluchawki-api-key';
const API = 'https://www.googleapis.com/drive/v3/files';
const AUDIO_EXT = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|wma|mp4)$/i;

export function apiKey() {
  try { return localStorage.getItem(KEY_LS) || GOOGLE_API_KEY; } catch { return GOOGLE_API_KEY; }
}
export function setApiKey(k) {
  try { k ? localStorage.setItem(KEY_LS, k.trim()) : localStorage.removeItem(KEY_LS); } catch { /* trudno */ }
}
export const hasApiKey = () => !!apiKey();

/** z linku do folderu wyciąga { id, resourceKey } */
export function parseFolderLink(link) {
  const s = String(link || '').trim();
  let id = (s.match(/\/folders\/([a-zA-Z0-9_-]{10,})/) || s.match(/[?&]id=([a-zA-Z0-9_-]{10,})/) || [])[1];
  if (!id && /^[a-zA-Z0-9_-]{20,}$/.test(s)) id = s;
  const resourceKey = (s.match(/[?&]resourcekey=([a-zA-Z0-9_-]+)/i) || [])[1] || '';
  return id ? { id, resourceKey } : null;
}

function headers(resKeys) {
  const h = {};
  const list = resKeys.filter((r) => r.resourceKey).map((r) => `${r.id}/${r.resourceKey}`);
  if (list.length) h['X-Goog-Drive-Resource-Keys'] = list.join(',');
  return h;
}

async function api(url, resKeys = []) {
  const key = apiKey();
  if (!key) throw new DriveError('Brak klucza Google API – wpisz go w Ustawieniach.', 'nokey');
  let res;
  try {
    res = await fetch(url + (url.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(key), { headers: headers(resKeys) });
  } catch {
    throw new DriveError('Brak połączenia z Dyskiem Google. Sprawdź internet.', 'offline');
  }
  if (!res.ok) {
    let msg = '';
    try { msg = (await res.json()).error.message; } catch { /* brak treści */ }
    if (res.status === 404) throw new DriveError('Nie znaleziono folderu. Sprawdź link i czy folder jest udostępniony „Każdy, kto ma link”.', 'notfound');
    if (res.status === 403 || res.status === 400) throw new DriveError('Dysk Google odmówił dostępu' + (msg ? `: ${msg}` : '.') + ' Sprawdź klucz API i udostępnienie folderu.', 'denied');
    throw new DriveError(`Błąd Dysku Google (${res.status})${msg ? ': ' + msg : ''}`, 'error');
  }
  return res.json();
}

export class DriveError extends Error {
  constructor(msg, code) { super(msg); this.code = code; }
}

/** nazwa folderu */
export async function folderInfo(folder) {
  return api(`${API}/${folder.id}?fields=id,name,mimeType&supportsAllDrives=true`, [folder]);
}

/** lista plików audio w folderze (z podfolderami, do 3 poziomów); nazwy podfolderów jako prefiks */
export async function listAudio(folder, depth = 0, prefix = '') {
  const out = [];
  let pageToken = '';
  do {
    const q = encodeURIComponent(`'${folder.id}' in parents and trashed = false`);
    const data = await api(`${API}?q=${q}&pageSize=1000&orderBy=name_natural&supportsAllDrives=true&includeItemsFromAllDrives=true`
      + `&fields=nextPageToken,files(id,name,mimeType,size,resourceKey)${pageToken ? '&pageToken=' + pageToken : ''}`, [folder]);
    for (const f of data.files || []) {
      if (f.mimeType === 'application/vnd.google-apps.folder') {
        if (depth < 3) out.push(...await listAudio({ id: f.id, resourceKey: f.resourceKey || '' }, depth + 1, prefix + f.name + ' / '));
      } else if ((f.mimeType || '').startsWith('audio/') || AUDIO_EXT.test(f.name)) {
        out.push({ id: f.id, name: prefix + f.name, mimeType: f.mimeType, size: Number(f.size) || 0, resourceKey: f.resourceKey || '' });
      }
    }
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return out;
}

/** adres do odtwarzania strumieniowego */
export function streamUrl(fileId) {
  return `${API}/${fileId}?alt=media&key=${encodeURIComponent(apiKey())}`;
}

/** pobiera cały plik (do zapisania offline); onProgress(ułamek) */
export async function download(file, onProgress) {
  let res;
  try {
    res = await fetch(streamUrl(file.fileId), { headers: headers([{ id: file.fileId, resourceKey: file.resourceKey }]) });
  } catch {
    throw new DriveError('Brak połączenia z Dyskiem Google.', 'offline');
  }
  if (!res.ok) throw new DriveError(`Nie udało się pobrać „${file.fileName}” (${res.status}).`, 'error');
  const total = Number(res.headers.get('Content-Length')) || file.size || 0;
  if (!res.body || !total) return res.blob();
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress && onProgress(Math.min(1, got / total));
  }
  return new Blob(chunks, { type: res.headers.get('Content-Type') || file.mimeType || 'audio/mpeg' });
}

/** z linku do pliku na Dysku („/file/d/ID/…”, „open?id=ID”, „uc?id=ID”) wyciąga { id, resourceKey } */
export function parseFileLink(link) {
  const s = String(link || '').trim();
  if (!/drive\.google\.com|docs\.google\.com/.test(s) || /\/folders\//.test(s)) return null;
  const id = (s.match(/\/(?:file\/)?d\/([a-zA-Z0-9_-]{10,})/) || s.match(/[?&]id=([a-zA-Z0-9_-]{10,})/) || [])[1];
  const resourceKey = (s.match(/[?&]resourcekey=([a-zA-Z0-9_-]+)/i) || [])[1] || '';
  return id ? { id, resourceKey } : null;
}

/** treść pliku z Dysku (udostępnionego „każdemu, kto ma link”) jako tekst */
export async function fileText(file) {
  const key = apiKey();
  if (!key) throw new DriveError('Brak klucza Google API – wpisz go w Ustawieniach.', 'nokey');
  let res;
  try {
    res = await fetch(`${API}/${file.id}?alt=media&supportsAllDrives=true&key=${encodeURIComponent(key)}`, { headers: headers([file]) });
  } catch {
    throw new DriveError('Brak połączenia z Dyskiem Google. Sprawdź internet.', 'offline');
  }
  if (res.status === 404) throw new DriveError('Nie znaleziono pliku. Sprawdź link i czy plik jest udostępniony „Każdy, kto ma link”.', 'notfound');
  if (!res.ok) throw new DriveError(`Dysk Google odmówił dostępu do pliku (${res.status}). Sprawdź, czy plik jest udostępniony „Każdy, kto ma link”.`, 'denied');
  return res.text();
}
