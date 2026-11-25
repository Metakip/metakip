import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import sharp from 'sharp';

const packageDirectory = fileURLToPath(new URL('..', import.meta.url));
const logoDirectory = path.join(packageDirectory, 'assets/logos');
const marketingDirectory = path.resolve(packageDirectory, '../marketing-site');
const publicDirectory = path.join(marketingDirectory, 'public');
const sharedFaviconDirectory = path.resolve(packageDirectory, '../shared/assets/app-favicon');
const marketingAssetDirectory = path.join(marketingDirectory, 'src/assets');
const archivePath = path.join(publicDirectory, 'metakip-brand-assets.zip');
const faviconBackground = '#f7f7f5';
const faviconArtworkRatio = 0.66;
const check = process.argv.includes('--check');

async function renderFavicon(svg, size) {
  const artworkSize = Math.round(size * faviconArtworkRatio);
  const mark = await sharp(svg)
    .resize(artworkSize, artworkSize, { fit: 'contain' })
    .png()
    .toBuffer();
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: faviconBackground,
    },
  })
    .composite([{ input: mark, gravity: 'centre' }])
    .png()
    .toBuffer();
}

const logoSvg = await readFile(path.join(logoDirectory, 'metakip.svg'));
const [logoPng, transparentMark, touchIcon, icon192, icon512] = await Promise.all([
  sharp(logoSvg).flatten({ background: '#ffffff' }).png().toBuffer(),
  sharp(logoSvg).png().toBuffer(),
  renderFavicon(logoSvg, 180),
  renderFavicon(logoSvg, 192),
  renderFavicon(logoSvg, 512),
]);

const archiveEntries = [
  ['metakip.png', logoPng],
  ['metakip.svg', logoSvg],
];
const outputs = [
  ...archiveEntries.map(([name, data]) => [path.join(publicDirectory, name), data]),
  [path.join(marketingAssetDirectory, 'metakip-mark.png'), transparentMark],
  [path.join(sharedFaviconDirectory, 'apple-touch-icon.png'), touchIcon],
  [path.join(sharedFaviconDirectory, 'icon-light-192.png'), icon192],
  [path.join(sharedFaviconDirectory, 'icon-light-512.png'), icon512],
];

async function readIfPresent(file) {
  try {
    return await readFile(file);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return null;
  }
}

async function archiveMatches(bytes) {
  if (!bytes) return false;
  const archive = await JSZip.loadAsync(bytes, { checkCRC32: true }).catch(() => null);
  if (!archive || Object.keys(archive.files).length !== archiveEntries.length) return false;
  const matches = await Promise.all(
    archiveEntries.map(async ([name, expected]) => {
      const entry = archive.file(name);
      return (
        entry?.unsafeOriginalName === name && (await entry.async('nodebuffer')).equals(expected)
      );
    }),
  );
  return matches.every(Boolean);
}

if (check) {
  const results = await Promise.all([
    ...outputs.map(async ([file, expected]) =>
      (await readIfPresent(file))?.equals(expected) ? null : file,
    ),
    readIfPresent(archivePath)
      .then(archiveMatches)
      .then((matches) => (matches ? null : archivePath)),
  ]);
  const repositoryRoot = path.resolve(packageDirectory, '../..');
  const stale = results.filter(Boolean).map((file) => path.relative(repositoryRoot, file));
  if (stale.length > 0) {
    throw new Error(
      `Generated brand assets are stale:\n${stale.join('\n')}\nRun pnpm --filter @metakip/brand generate:brand-assets`,
    );
  }
} else {
  const archive = new JSZip();
  const date = new Date('1980-01-01T00:00:00Z');
  for (const [name, data] of archiveEntries) archive.file(name, data, { date });
  const archiveBytes = await archive.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

  // Stage every output before replacing any public file.
  const stagingDirectory = await mkdtemp(path.join(packageDirectory, '.brand-assets-'));
  const files = [...outputs, [archivePath, archiveBytes]].map(([destination, data]) => ({
    destination,
    data,
    temporary: path.join(stagingDirectory, path.basename(destination)),
  }));
  try {
    await Promise.all(files.map(({ temporary, data }) => writeFile(temporary, data)));
    for (const { temporary, destination } of files) {
      await rename(temporary, destination);
    }
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true });
  }
}
