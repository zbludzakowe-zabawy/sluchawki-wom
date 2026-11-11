// Słuchawki – pamięć w przeglądarce (IndexedDB): zbiory, pobrane nagrania, wyniki quizów.
const DB_NAME = 'sluchawki';
const DB_VER = 1;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('sets')) db.createObjectStore('sets', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio'); // klucz: fileId, wartość: Blob
      if (!db.objectStoreNames.contains('results')) {
        const r = db.createObjectStore('results', { keyPath: 'id', autoIncrement: true });
        r.createIndex('setId', 'setId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    Promise.resolve(fn(s)).then((v) => { out = v; });
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Przerwano zapis'));
  });
}

const req2p = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const listSets = () => tx('sets', 'readonly', (s) => req2p(s.getAll()));
export const getSet = (id) => tx('sets', 'readonly', (s) => req2p(s.get(id)));
export const putSet = (set) => tx('sets', 'readwrite', (s) => { set.updatedAt = Date.now(); s.put(set); });
export const deleteSet = (id) => tx('sets', 'readwrite', (s) => { s.delete(id); });

export const getAudio = (fileId) => tx('audio', 'readonly', (s) => req2p(s.get(fileId)));
export const putAudio = (fileId, blob) => tx('audio', 'readwrite', (s) => { s.put(blob, fileId); });
export const deleteAudio = (fileId) => tx('audio', 'readwrite', (s) => { s.delete(fileId); });
export const audioKeys = () => tx('audio', 'readonly', (s) => req2p(s.getAllKeys()));

export const addResult = (r) => tx('results', 'readwrite', (s) => { s.add(r); });
export const resultsFor = (setId) => tx('results', 'readonly', (s) => req2p(s.index('setId').getAll(setId)));
export const deleteResultsFor = async (setId) => {
  const all = await resultsFor(setId);
  await tx('results', 'readwrite', (s) => { for (const r of all) s.delete(r.id); });
};
