// Copies the self-hosted Fontsource woff2 files into the style tile.
// The copies are committed, so the tile runs without node_modules.
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'style-tile', 'fonts');
const files = [
  ['bricolage-grotesque', 'bricolage-grotesque-latin-standard-normal.woff2'],
  ['martian-mono', 'martian-mono-latin-standard-normal.woff2'],
];

await mkdir(out, { recursive: true });
for (const [pkg, file] of files) {
  await copyFile(join(root, 'node_modules', '@fontsource-variable', pkg, 'files', file), join(out, file));
  console.log('copied', file);
}
