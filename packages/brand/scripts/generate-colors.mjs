import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageDirectory = path.resolve(scriptDirectory, '..');
const tokensPath = path.join(packageDirectory, 'tokens/colors.json');
const cssPath = path.join(packageDirectory, 'colors.css');
const rustPath = path.join(packageDirectory, 'colors.rs');

const parsedTokens = JSON.parse(await readFile(tokensPath, 'utf8'));
const hexColor = /^#[0-9a-f]{6}$/i;
const tokenReference = /^\{([a-zA-Z0-9]+(?:\.[a-zA-Z0-9]+)*)\}$/;

function collectTokens(value, pathParts = []) {
  if (typeof value === 'string') {
    return [[pathParts.join('.'), value]];
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Expected a color token or group at ${pathParts.join('.')}`);
  }

  return Object.entries(value).flatMap(([key, child]) => collectTokens(child, [...pathParts, key]));
}

const values = new Map(collectTokens(parsedTokens));
const tokens = Array.from(values, ([name, value]) => {
  if (hexColor.test(value)) return { name, hex: value.toLowerCase() };

  const reference = tokenReference.exec(value)?.[1];
  if (!reference) throw new Error(`Expected a six-digit hex color or token reference at ${name}`);
  const target = values.get(reference);
  if (!target || !hexColor.test(target)) {
    throw new Error(`Token ${name} must reference a literal color: ${value}`);
  }
  return { name, reference };
});
const cssName = (name) =>
  `--metakip-${name.replace(/\./g, '-').replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
const rustName = (name) => name.replace(/\./g, '_').replace(/[A-Z]/g, '_$&').toUpperCase();
const css = [
  '/* Generated from tokens/colors.json by scripts/generate-colors.mjs. */',
  ':root {',
  ...tokens.map(
    ({ name, hex, reference }) =>
      `  ${cssName(name)}: ${reference ? `var(${cssName(reference)})` : hex};`,
  ),
  '}',
  '',
].join('\n');
const rust = [
  '// Generated from tokens/colors.json by scripts/generate-colors.mjs.',
  ...tokens.map(
    ({ name, hex, reference }) =>
      `pub const ${rustName(name)}: u32 = ${reference ? rustName(reference) : `0x${hex.slice(1)}`};`,
  ),
  '',
].join('\n');

if (process.argv.includes('--check')) {
  const [currentCss, currentRust] = await Promise.all([
    readFile(cssPath, 'utf8'),
    readFile(rustPath, 'utf8'),
  ]);
  if (currentCss !== css || currentRust !== rust) {
    throw new Error(
      'Generated color exports are stale; run pnpm --filter @metakip/brand generate:colors',
    );
  }
} else {
  await Promise.all([writeFile(cssPath, css), writeFile(rustPath, rust)]);
}
