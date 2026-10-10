import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetDocumentMetadata } from './documentMeta';

describe('resetDocumentMetadata', () => {
  let favicon: HTMLLinkElement;

  beforeEach(() => {
    favicon = document.createElement('link');
    favicon.rel = 'icon';
    favicon.href = 'data:image/svg+xml,custom-page-icon';
    document.head.append(favicon);
  });

  afterEach(() => {
    favicon.remove();
    document.documentElement.classList.remove('dark');
  });

  it('restores the light app favicon by default', () => {
    resetDocumentMetadata();

    expect(favicon.getAttribute('href')).toBe('/icon-light-192.png');
    expect(favicon.dataset.themeIcon).toBe('192');
  });

  it('restores the dark app favicon when dark mode is active', () => {
    document.documentElement.classList.add('dark');

    resetDocumentMetadata();

    expect(favicon.getAttribute('href')).toBe('/icon-dark-192.png');
    expect(favicon.dataset.themeIcon).toBe('192');
  });
});
