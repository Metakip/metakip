let nextDiagramId = 0;

export const MAX_DIAGRAM_SOURCE_LENGTH = 50_000;
const MAX_DIAGRAM_OUTPUT_LENGTH = 4_000_000;
const MAX_DIAGRAM_EDGES = 500;
const MAX_ERROR_MESSAGE_LENGTH = 200;

export function mermaidErrorMessage(error: unknown): string {
  const firstLine = error instanceof Error ? error.message.split(/\r?\n/, 1)[0]?.trim() : undefined;
  if (!firstLine) return 'Unknown rendering error';
  return firstLine.length > MAX_ERROR_MESSAGE_LENGTH
    ? `${firstLine.slice(0, MAX_ERROR_MESSAGE_LENGTH)}…`
    : firstLine;
}

export async function renderMermaidSvg(source: string): Promise<SVGSVGElement> {
  const { renderAsync } = await import('pele/lazy');
  const { svg } = await renderAsync(source, {
    idPrefix: `metakip-mermaid-${nextDiagramId++}`,
    images: false,
    links: false,
    limit: MAX_DIAGRAM_SOURCE_LENGTH,
    outputLimit: MAX_DIAGRAM_OUTPUT_LENGTH,
    maxEdges: MAX_DIAGRAM_EDGES,
    responsive: true,
  });
  const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = parsed.documentElement;
  if (!(root instanceof SVGSVGElement) || parsed.querySelector('parsererror')) {
    throw new Error('Pele returned invalid SVG');
  }

  // Pele emits SVG elements only; disabling links and images above keeps its output inert.
  // Inline SVG inherits the editor's Pele theme variables, unlike an SVG loaded through <img>.
  return parsed.importNode(root, true);
}
