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
const brandAssetSize = 512;
const markContentSize = 460;

const sourceMark = await readFile(sourceMarkPath);
const trimmedMark = await sharp(sourceMark)
  .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 0 })
  .png()
  .toBuffer();
const scaledMark = await sharp(trimmedMark)
  .resize(markContentSize, markContentSize, { fit: 'inside' })
  .png()
  .toBuffer();
const squareLightMark = await sharp({
  create: {
    width: brandAssetSize,
    height: brandAssetSize,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  },
})
  .composite([{ input: scaledMark, gravity: 'centre' }])
  .png()
  .toBuffer();
await writeFile(sourceMarkPath, squareLightMark);

const darkMark = await sharp(squareLightMark).negate({ alpha: false }).png().toBuffer();
const lightPng = await sharp(squareLightMark).flatten({ background: '#ffffff' }).png().toBuffer();
const darkPng = await sharp(darkMark).flatten({ background: '#111111' }).png().toBuffer();

await writeFile(lightPngPath, lightPng);
await writeFile(darkPngPath, darkPng);
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
