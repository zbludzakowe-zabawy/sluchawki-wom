// Uzupełnia sw.js w katalogu publikacji: wersja = skrót wszystkich plików,
// ASSETS = lista wszystkich plików. Każda publikacja ze zmianami to nowy
// service worker, więc zainstalowana aplikacja pokaże „Dostępna nowa wersja”.
// Użycie: node tools/build-sw.mjs _site
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const dir = process.argv[2] || '_site';
const list = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? list(join(d, e.name)) : [join(d, e.name)]);

const files = list(dir)
  .map((f) => relative(dir, f).split('\\').join('/'))
  .filter((f) => f !== 'sw.js' && !f.startsWith('.'))
  .sort();
const hash = createHash('sha256');
for (const f of files) hash.update(f).update(readFileSync(join(dir, f)));
const version = hash.digest('hex').slice(0, 12);
const assets = ['./', ...files.map((f) => './' + f)];

const swPath = join(dir, 'sw.js');
const sw = readFileSync(swPath, 'utf8');
const out = sw
  .replace(/const VERSION = '[^']*';/, `const VERSION = '${version}';`)
  .replace(/const ASSETS = \[[\s\S]*?\];/, `const ASSETS = ${JSON.stringify(assets, null, 2)};`);
if (out === sw || !out.includes(version)) throw new Error('Nie udało się uzupełnić sw.js');
writeFileSync(swPath, out);
console.log(`sw.js: wersja ${version}, ${assets.length} plików`);
