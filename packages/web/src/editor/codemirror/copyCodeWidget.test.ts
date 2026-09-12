import { afterEach, describe, expect, it, vi } from 'vitest';
import { CopyCodeWidget } from './livePreviewWidgets';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('copy code', () => {
  it('copies exact whitespace and resets its accessible status', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const widget = new CopyCodeWidget('  code\n\n');
    const button = widget.toDOM();
    expect(button.textContent).toBe('');
    expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    const copyPath = button.querySelector('path')?.getAttribute('d');
    button.click();
    await vi.waitFor(() => expect(button.getAttribute('aria-label')).toBe('Copied'));
    expect(button.querySelector('path')?.getAttribute('d')).not.toBe(copyPath);
    expect(writeText).toHaveBeenCalledWith('  code\n\n');
    expect(button.getAttribute('aria-label')).toBe('Copied');
    await vi.advanceTimersByTimeAsync(1500);
    expect(button.getAttribute('aria-label')).toBe('Copy code');
    expect(button.querySelector('path')?.getAttribute('d')).toBe(copyPath);
    widget.destroy(button);
  });

  it('handles clipboard permission failures without an unhandled rejection', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('Denied')) },
    });
    const widget = new CopyCodeWidget('code');
    const button = widget.toDOM();
    button.click();
    await vi.waitFor(() => expect(button.getAttribute('aria-label')).toBe('Copy failed'));
    expect(button.getAttribute('aria-label')).toBe('Copy failed');
    widget.destroy(button);
  });

  it('handles browsers without the clipboard API', async () => {
    vi.stubGlobal('navigator', {});
    const widget = new CopyCodeWidget('code');
    const button = widget.toDOM();
    button.click();
    await vi.waitFor(() => expect(button.getAttribute('aria-label')).toBe('Copy failed'));
    widget.destroy(button);
  });

  it('preserves the native selection on mouse down and cleans up its timer', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    const widget = new CopyCodeWidget('code');
    const button = widget.toDOM();
    const event = new MouseEvent('mousedown', { cancelable: true });
    button.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    button.click();
    await vi.waitFor(() => expect(button.getAttribute('aria-label')).toBe('Copied'));
    widget.destroy(button);
    expect(vi.getTimerCount()).toBe(0);
  });
});
