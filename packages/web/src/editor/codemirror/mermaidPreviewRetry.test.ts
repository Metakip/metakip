import { expect, it, vi } from 'vitest';
import { createView } from './livePreviewTestView';

const mockRender = vi.hoisted(() => vi.fn<(source: string) => Promise<SVGSVGElement>>());

vi.mock('./mermaidRenderer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./mermaidRenderer')>()),
  renderMermaidSvg: mockRender,
}));

it('retries a failed render when unchanged Mermaid source is previewed again', async () => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  mockRender.mockReset();
  mockRender.mockRejectedValueOnce(new Error('Temporary failure')).mockResolvedValue(svg);
  const view = createView('Before\n\n```mermaid\nflowchart LR\nA --> B\n```');

  await vi.waitFor(() => {
    expect(view.dom.querySelector('.cm-md-mermaid-error')).not.toBeNull();
  });
  view.dom.querySelector<HTMLElement>('.cm-md-mermaid-widget')?.click();
  view.dispatch({ selection: { anchor: 0 } });

  await vi.waitFor(() => {
    expect(view.dom.querySelector('.cm-md-mermaid-widget > svg')).not.toBeNull();
  });
  expect(mockRender).toHaveBeenCalledTimes(2);
  view.destroy();
});
