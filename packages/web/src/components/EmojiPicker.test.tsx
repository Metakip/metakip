import * as stylex from '@stylexjs/stylex';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmojiPicker } from './EmojiPicker';
import { styles } from './EmojiPicker.stylex';

const emojiData = [
  {
    emoji: '😀',
    group: 0,
    label: 'Grinning face',
    tags: [],
    version: 1,
  },
];

const emojiMessages = {
  groups: [{ key: 'smileys-emotion', message: 'Smileys & emotion', order: 0 }],
  skinTones: [],
  subgroups: [],
};

function responseFor(url: string): Response {
  const body = url.endsWith('/messages.json') ? emojiMessages : emojiData;
  return new Response(JSON.stringify(body), {
    headers: { etag: 'emoji-picker-test' },
  });
}

function mockEmojiDataFetch() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    return responseFor(String(input));
  });
}

function mockBrowserMeasurements(width: number) {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.hasAttribute('frimousse-root') || this.hasAttribute('frimousse-viewport')) {
      return width;
    }

    return 0;
  });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.hasAttribute('frimousse-viewport')) return 320;
    if (this.hasAttribute('frimousse-emoji')) return 32;
    if (this.hasAttribute('frimousse-row')) {
      return this.firstElementChild instanceof HTMLElement
        ? this.firstElementChild.clientHeight
        : 0;
    }
    if (this.hasAttribute('frimousse-row-sizer')) {
      return this.firstElementChild instanceof HTMLElement
        ? this.firstElementChild.clientHeight
        : 0;
    }
    if (this.hasAttribute('frimousse-category-header-sizer')) return 24;

    return 0;
  });
}

function mockRootFontSize(fontSize: number) {
  const originalGetComputedStyle = window.getComputedStyle;
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudoElement) => {
    const computedStyle = originalGetComputedStyle(element, pseudoElement);

    if (element !== document.documentElement && !element.hasAttribute('frimousse-root')) {
      return computedStyle;
    }

    const originalGetPropertyValue = computedStyle.getPropertyValue.bind(computedStyle);
    Object.defineProperties(computedStyle, {
      fontSize: { configurable: true, value: `${fontSize}px` },
      getPropertyValue: {
        configurable: true,
        value: (property: string) => {
          if (property === '--emoji-picker-cell-size-rem') return '2';
          if (property === '--emoji-picker-row-padding-rem') return '0.5';
          return originalGetPropertyValue(property);
        },
      },
    });

    return computedStyle;
  });
}

describe('EmojiPicker', () => {
  it('loads emoji data from the bundled self-hosted path', async () => {
    const fetchMock = mockEmojiDataFetch();
    mockBrowserMeasurements(320);
    const user = userEvent.setup();

    render(
      <EmojiPicker icon={null} onChange={vi.fn()}>
        <span>Open picker</span>
      </EmojiPicker>,
    );

    await user.click(screen.getByRole('button', { name: 'Add page icon' }));
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    await screen.findByRole('gridcell', { name: 'Grinning face' });

    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual(
      expect.arrayContaining(['/emojibase-data/en/data.json', '/emojibase-data/en/messages.json']),
    );
  });

  it('selects an emoji and closes the popup', async () => {
    mockEmojiDataFetch();
    mockBrowserMeasurements(320);
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(
      <EmojiPicker icon={null} onChange={onChange}>
        <span>Open picker</span>
      </EmojiPicker>,
    );

    await user.click(screen.getByRole('button', { name: 'Add page icon' }));
    await user.click(await screen.findByRole('gridcell', { name: 'Grinning face' }));

    expect(onChange).toHaveBeenCalledWith('😀');
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Emoji picker' })).not.toBeInTheDocument();
    });
  });

  it('reduces the column count for a narrow picker', async () => {
    mockEmojiDataFetch();
    mockBrowserMeasurements(100);
    const user = userEvent.setup();

    render(
      <EmojiPicker icon={null} onChange={vi.fn()}>
        <span>Open picker</span>
      </EmojiPicker>,
    );

    await user.click(screen.getByRole('button', { name: 'Add page icon' }));
    await screen.findByRole('gridcell', { name: 'Grinning face' });

    expect(screen.getByRole('grid').parentElement).toHaveClass(
      stylex.props(styles.viewport).className ?? '',
    );
    expect(screen.getByRole('row')).toHaveClass(stylex.props(styles.row).className ?? '');
    await waitFor(() => {
      expect(screen.getByRole('grid')).toHaveStyle('--frimousse-list-columns: 2');
    });
  });

  it('matches the rendered cell sizing when the root font size changes', async () => {
    mockEmojiDataFetch();
    mockBrowserMeasurements(90);
    mockRootFontSize(20);
    const user = userEvent.setup();

    render(
      <EmojiPicker icon={null} onChange={vi.fn()}>
        <span>Open picker</span>
      </EmojiPicker>,
    );

    await user.click(screen.getByRole('button', { name: 'Add page icon' }));
    await screen.findByRole('gridcell', { name: 'Grinning face' });

    await waitFor(() => {
      expect(screen.getByRole('grid')).toHaveStyle('--frimousse-list-columns: 1');
    });
  });

  it('shows a retry action when emoji data does not load', async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise<Response>(() => {}));
    mockBrowserMeasurements(320);

    render(
      <EmojiPicker icon={null} onChange={vi.fn()}>
        <span>Open picker</span>
      </EmojiPicker>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add page icon' }));
    expect(screen.getByText('Loading…')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.getByText('Unable to initialize emoji picker.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });
});

afterEach(() => {
  vi.useRealTimers();
});
