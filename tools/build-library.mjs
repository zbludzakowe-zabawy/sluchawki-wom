// Buduje spis biblioteki zbiorów: <katalog>/zbiory/index.json z plików *.json
// wyeksportowanych z aplikacji („Eksportuj do pliku”) i wrzuconych do folderu zbiory/ w repozytorium.
// Użycie: node tools/build-library.mjs _site
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(process.argv[2] || '_site', 'zbiory');
if (!existsSync(dir)) {
  console.log('biblioteka: brak folderu zbiory/ – pomijam');
  process.exit(0);
}
const sets = [];
for (const file of readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'index.json').sort((a, b) => a.localeCompare(b, 'pl'))) {
  const raw = readFileSync(join(dir, file));
  let d;
  try { d = JSON.parse(raw); } catch { throw new Error(`zbiory/${file}: to nie jest poprawny JSON`); }
  if (d.app !== 'sluchawki' || !Array.isArray(d.tracks)) throw new Error(`zbiory/${file}: to nie jest plik pojedynczego zbioru Słuchawek`);
  sets.push({ file, name: String(d.name || file), count: d.tracks.length, hash: createHash('sha256').update(raw).digest('hex').slice(0, 12) });
}
sets.sort((a, b) => a.name.localeCompare(b.name, 'pl'));
writeFileSync(join(dir, 'index.json'), JSON.stringify({ sets }, null, 1));
console.log(`biblioteka: ${sets.length} zbiorów`);
