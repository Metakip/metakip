import { execFileSync } from 'node:child_process';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageDirectory = path.resolve(scriptDirectory, '..');
const publicDirectory = path.join(packageDirectory, 'public');
const sourceMarkPath = path.join(packageDirectory, 'src/assets/metakip-mark.png');
const lightPngPath = path.join(publicDirectory, 'metakip.png');
const darkPngPath = path.join(publicDirectory, 'metakip-dark.png');
const archivePath = path.join(publicDirectory, 'metakip-brand-assets.zip');

const lightMark = await readFile(sourceMarkPath);
const darkMark = await sharp(lightMark).negate({ alpha: false }).png().toBuffer();

await writeFile(lightPngPath, lightMark);
await writeFile(darkPngPath, darkMark);
await rm(archivePath, { force: true });

execFileSync(
  'zip',
  [
    '-q',
    '-j',
    'metakip-brand-assets.zip',
    'metakip.png',
    'metakip-dark.png',
    'metakip.svg',
    'metakip-dark.svg',
  ],
  { cwd: publicDirectory, stdio: 'inherit' },
);
