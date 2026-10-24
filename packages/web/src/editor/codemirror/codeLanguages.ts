import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';

const plainTextFenceLabels = new Set([
  'plain',
  'plain text',
  'plaintext',
  'text',
  'text/plain',
  'txt',
]);

export function resolveCodeFenceLanguage(label: string): LanguageDescription | null {
  const normalizedLabel = label.trim().toLowerCase();
  if (plainTextFenceLabels.has(normalizedLabel)) return null;

  const languageByName = LanguageDescription.matchLanguageName(languages, normalizedLabel, false);
  if (languageByName) return languageByName;

  return (
    languages.find((language) =>
      language.extensions.some((extension) => extension.toLowerCase() === normalizedLabel),
    ) ?? null
  );
}
