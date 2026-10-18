import { describe, expect, it } from 'vitest';
import { mermaidErrorMessage } from './mermaidRenderer';

describe('Mermaid error presentation', () => {
  it('shows the diagnostic without echoing the diagram source', () => {
    expect(mermaidErrorMessage(new Error(`Parse error on line 3:\n${'A'.repeat(10_000)}`))).toBe(
      'Parse error on line 3:',
    );
  });

  it('bounds even single-line dependency errors and handles unknown failures', () => {
    const message = mermaidErrorMessage(new Error('A'.repeat(10_000)));
    expect(message).toHaveLength(201);
    expect(message.endsWith('…')).toBe(true);
    expect(mermaidErrorMessage(null)).toBe('Unknown rendering error');
  });
});
