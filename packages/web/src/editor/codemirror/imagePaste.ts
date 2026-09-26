const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

export function supportedImage(file: File): boolean {
  return SUPPORTED_IMAGE_TYPES.has(file.type.toLowerCase());
}

export type ImageSlot = { offset: number; files: File[] };
export type HtmlImagePaste = { text: string; slots: ImageSlot[] };

const BLOCK_ELEMENTS = new Set([
  'ADDRESS',
  'ARTICLE',
  'BLOCKQUOTE',
  'DIV',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'LI',
  'OL',
  'P',
  'PRE',
  'SECTION',
  'TABLE',
  'TD',
  'TH',
  'TR',
  'UL',
]);
const IGNORED_ELEMENTS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE']);

function imageFileFromDataUrl(image: Element, index: number): File | null {
  const source = image.getAttribute('src') ?? '';
  const match = /^data:(image\/(?:jpeg|png|gif|webp));base64,([a-z\d+/=]+)$/i.exec(source);
  const mimeType = match?.[1]?.toLowerCase();
  const encoded = match?.[2];
  if (!mimeType || !encoded || !SUPPORTED_IMAGE_TYPES.has(mimeType)) return null;
  try {
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    const extension = mimeType === 'image/jpeg' ? 'jpg' : mimeType.slice('image/'.length);
    const alt = image.getAttribute('alt')?.trim();
    return new File([bytes], alt || `pasted-image-${index + 1}.${extension}`, { type: mimeType });
  } catch {
    return null;
  }
}

/** Preserve visible prose and image order instead of consuming the whole rich paste as an image. */
export function parseHtmlImagePaste(
  html: string,
  clipboardFiles: readonly File[],
): HtmlImagePaste | null {
  if (!html || typeof DOMParser === 'undefined') return null;
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const images = [...parsed.body.querySelectorAll('img')];
  const dataImages = images.filter((image) => image.getAttribute('src')?.startsWith('data:image/'));
  const mappedImages = new Map<Element, File>();
  if (clipboardFiles.length > 0) {
    const matching =
      dataImages.length === clipboardFiles.length
        ? dataImages
        : images.length === clipboardFiles.length
          ? images
          : [];
    matching.forEach((image, index) => {
      const file = clipboardFiles[index];
      if (file) mappedImages.set(image, file);
    });
  } else {
    dataImages.forEach((image, index) => {
      const file = imageFileFromDataUrl(image, index);
      if (file) mappedImages.set(image, file);
    });
  }

  let text = '';
  const slots: ImageSlot[] = [];
  const lineBreak = () => {
    if (
      (text || slots.length > 0) &&
      (!text.endsWith('\n') || slots.at(-1)?.offset === text.length)
    ) {
      text += '\n';
    }
  };
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? '';
      return;
    }
    if (!(node instanceof Element) || IGNORED_ELEMENTS.has(node.tagName)) return;
    if (node.tagName === 'IMG') {
      const file = mappedImages.get(node);
      if (file) {
        const last = slots.at(-1);
        if (last?.offset === text.length) last.files.push(file);
        else slots.push({ offset: text.length, files: [file] });
      }
      return;
    }
    if (node.tagName === 'BR') {
      text += '\n';
      return;
    }
    if (BLOCK_ELEMENTS.has(node.tagName)) lineBreak();
    for (const child of node.childNodes) walk(child);
    if (BLOCK_ELEMENTS.has(node.tagName)) lineBreak();
  };
  for (const child of parsed.body.childNodes) walk(child);

  // Some clipboards expose image files without matching <img> elements. Keep
  // the prose and append those files instead of silently discarding either.
  if (clipboardFiles.length > 0 && mappedImages.size === 0) {
    slots.push({ offset: text.length, files: [...clipboardFiles] });
  }
  return slots.length > 0 ? { text, slots } : null;
}
