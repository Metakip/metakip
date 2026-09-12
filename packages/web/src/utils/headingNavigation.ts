export function getHeadingId(heading: string): string {
  return heading.toLowerCase().trim().replace(/\s+/g, '-');
}

/**
 * Prefer the actual rendered ID, then find headings whose text would produce
 * the requested default Markdown ID. The fallback also supports headings with
 * explicit custom IDs.
 */
export function findRenderedHeading(
  editorElement: HTMLElement,
  requestedId: string,
): HTMLElement | null {
  const headings = editorElement.querySelectorAll<HTMLElement>('.cm-md-heading');
  for (const heading of headings) {
    if (heading.id === requestedId) return heading;
  }
  for (const heading of headings) {
    if (getHeadingId(heading.textContent ?? '') === requestedId) return heading;
  }
  return null;
}
