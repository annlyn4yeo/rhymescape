// Builds src/engine/data/cmudict.json from the `cmu-pronouncing-dictionary` npm package.
// Output shape (see CmuDict in src/engine/types.ts):
//   { "hello": "HH AH0 L OW1", "read": ["R IY1 D", "R EH1 D"] }
// Alternate pronunciations arrive upstream as "word(2)", "word(3)" and are folded into arrays.
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dictionary } from 'cmu-pronouncing-dictionary';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'src', 'engine', 'data', 'cmudict.json');

const folded = new Map();
for (const [key, pron] of Object.entries(dictionary)) {
  const m = /^(.*)\((\d+)\)$/.exec(key);
  const word = (m ? m[1] : key).toLowerCase();
  const clean = pron.replace(/\s*#.*$/, '').trim(); // some entries carry a trailing '# place, danish' comment
  if (!clean) continue;
  const list = folded.get(word) ?? [];
  list.push(clean);
  folded.set(word, list);
}

// A Map avoids inherited keys like "constructor"; single pronunciations are stored as plain strings.
const sorted = Object.fromEntries([...folded].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([w, list]) => [w, list.length === 1 ? list[0] : list]));
await mkdir(dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(sorted));
console.log(`wrote ${Object.keys(sorted).length} words to ${out}`);
