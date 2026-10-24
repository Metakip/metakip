import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { StrictMode } from 'react';
import { useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePwaLaunchAction } from '../hooks/usePwaLaunchAction';
import { render } from '../test-utils/render';
import { CommandPalette } from './CommandPalette';

const mockNavigate = vi.fn();
const mockMutate = vi.fn();
const mockCreatePage = vi.fn();
const { mockUserId } = vi.hoisted(() => ({ mockUserId: { current: 'first-user' } }));

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ data: { user: { id: mockUserId.current } } }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({}),
  };
});

vi.mock('../hooks/use-pages', () => ({
  useCreatePage: () => ({
    mutate: mockMutate,
    mutateAsync: mockCreatePage,
    isPending: false,
  }),
}));

function WorkspacePalette() {
  const openSearch = usePwaLaunchAction();
  const location = useLocation();
  return (
    <>
      <CommandPalette openSearch={openSearch} />
      <output data-testid="location-search">{location.search}</output>
    </>
  );
}

describe('CommandPalette', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockUserId.current = 'first-user';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is initially hidden', () => {
    render(<CommandPalette />);

    expect(screen.queryByPlaceholderText('Search pages and folders...')).not.toBeInTheDocument();
  });

  it('opens when the app shell requests search', async () => {
    const view = render(<CommandPalette openSearch />);
    view.rerender(<CommandPalette openSearch={false} />);

    expect(await screen.findByPlaceholderText('Search pages and folders...')).toBeInTheDocument();
  });

  it('opens search from a PWA shortcut after consuming its URL', async () => {
    render(<WorkspacePalette />, { route: '/?action=search&filter=owned-by-me' });

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search pages and folders...')).toBeInTheDocument();
      expect(screen.getByTestId('location-search')).toHaveTextContent('?filter=owned-by-me');
    });
  });

  it('creates one page from the PWA new-page shortcut', async () => {
    mockCreatePage.mockResolvedValue({ id: 'page-id', title: 'Untitled' });
    render(
      <StrictMode>
        <WorkspacePalette />
      </StrictMode>,
      { route: '/?action=new-page' },
    );

    await waitFor(() => {
      expect(mockCreatePage).toHaveBeenCalledTimes(1);
      expect(mockNavigate).toHaveBeenCalledWith('/untitled-page-id');
      expect(screen.getByTestId('location-search')).toBeEmptyDOMElement();
    });
  });

  it('opens when Ctrl+K is pressed', async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);

    await user.keyboard('{Control>}k{/Control}');

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search pages and folders...')).toBeInTheDocument();
    });
  });

  it('closes when Escape is pressed', async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);

    await user.keyboard('{Control>}k{/Control}');
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search pages and folders...')).toBeInTheDocument();
    });

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
    });
    await waitFor(() => {
      expect(screen.queryByPlaceholderText('Search pages and folders...')).not.toBeInTheDocument();
    });
  });

  it('shows quick actions immediately when the query is empty', async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);

    await user.keyboard('{Control>}k{/Control}');

    await waitFor(() => {
      expect(screen.getByText('Quick actions')).toBeInTheDocument();
    });
    expect(screen.queryByText(/search your workspace|type to search/i)).not.toBeInTheDocument();
  });

  it('shows "No results found" when query has no matches', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ results: [] }),
    } as Response);

    render(<CommandPalette />);

    await user.keyboard('{Control>}k{/Control}');
    await user.type(screen.getByPlaceholderText('Search pages and folders...'), 'xyz');

    await waitFor(() => {
      expect(screen.getByText(/no results found/i)).toBeInTheDocument();
    });
  });

  it('displays search results', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          results: [
            {
              id: 'p1',
              type: 'page',
              title: 'Test Page',
              icon: null,
              breadcrumb: ['Projects'],
              titleMatches: [{ start: 0, end: 4 }],
              snippet: {
                text: 'A relevant phrase from the body',
                matches: [{ start: 11, end: 17 }],
              },
            },
          ],
        }),
    } as Response);

    render(<CommandPalette />);

    await user.keyboard('{Control>}k{/Control}');
    await user.type(screen.getByPlaceholderText('Search pages and folders...'), 'test');

    await waitFor(() => {
      expect(screen.getByRole('option', { name: /test page/i })).toBeInTheDocument();
    });
    expect(screen.getByText('Test', { selector: 'mark' })).toBeInTheDocument();
    expect(screen.getByText('phrase', { selector: 'mark' })).toBeInTheDocument();
    expect(screen.getByText('Projects')).toBeInTheDocument();
    expect(screen.getByTestId('search-result-snippet')).toHaveTextContent(
      'A relevant phrase from the body',
    );
    expect(screen.queryByText('Quick actions')).not.toBeInTheDocument();
  });

  it('opens the selected search result with the keyboard', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          results: [
            { id: 'p1', type: 'page', title: 'First Page', icon: null, breadcrumb: [] },
            { id: 'p2', type: 'page', title: 'Second Page', icon: null, breadcrumb: [] },
          ],
        }),
    } as Response);

    render(<CommandPalette />);
    await user.keyboard('{Control>}k{/Control}');
    await user.type(screen.getByPlaceholderText('Search pages and folders...'), 'test');
    await waitFor(() =>
      expect(screen.getByRole('option', { name: /second page/i })).toBeInTheDocument(),
    );

    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(screen.getByRole('option', { name: /second page/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await user.keyboard('{Enter}');

    expect(mockNavigate).toHaveBeenCalledWith(expect.stringContaining('p2'));
  });

  it('shows and reuses recently searched terms', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            results: [{ id: 'p1', type: 'page', title: 'Guide page', icon: null, breadcrumb: [] }],
          }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            results: [{ id: 'p1', type: 'page', title: 'Guide page', icon: null, breadcrumb: [] }],
          }),
      } as Response);

    render(<CommandPalette />);
    await user.keyboard('{Control>}k{/Control}');
    await user.type(screen.getByPlaceholderText('Search pages and folders...'), 'guide');
    await waitFor(() => expect(screen.getByText('Guide page')).toBeInTheDocument());
    await user.click(screen.getByText('Guide page'));

    await user.keyboard('{Control>}k{/Control}');
    await waitFor(() => expect(screen.getByRole('option', { name: 'guide' })).toBeInTheDocument());
    await user.click(screen.getByRole('option', { name: 'guide' }));

    await waitFor(() => expect(screen.getByText('Guide page')).toBeInTheDocument());
    expect(screen.getByPlaceholderText('Search pages and folders...')).toHaveValue('guide');
  });

  it('does not show a previous account’s searches after the identity changes', async () => {
    const user = userEvent.setup();
    localStorage.setItem('metakip:recentSearches', JSON.stringify(['old global query']));
    localStorage.setItem('metakip:recentSearches:first-user', JSON.stringify(['private query']));
    const view = render(<CommandPalette />);

    await user.keyboard('{Control>}k{/Control}');
    expect(screen.getByRole('option', { name: 'private query' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'old global query' })).not.toBeInTheDocument();

    mockUserId.current = 'second-user';
    view.rerender(<CommandPalette />);
    await user.keyboard('{Control>}k{/Control}');
    expect(screen.queryByRole('option', { name: 'private query' })).not.toBeInTheDocument();
    expect(localStorage.getItem('metakip:recentSearches')).toBeNull();
  });

  it('navigates when a result is clicked', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          results: [{ id: 'p1', type: 'page', title: 'Test Page', icon: null, breadcrumb: [] }],
        }),
    } as Response);

    render(<CommandPalette />);

    await user.keyboard('{Control>}k{/Control}');
    await user.type(screen.getByPlaceholderText('Search pages and folders...'), 'test');

    await waitFor(() => {
      expect(screen.getByText('Test Page')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Test Page'));

    expect(mockNavigate).toHaveBeenCalled();
  });

  it('opens folder search results in the folder route', async () => {
    const user = userEvent.setup();
    const folderId = '11111111-1111-1111-1111-111111111111';
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          results: [
            { id: folderId, type: 'folder', title: 'Research', icon: null, breadcrumb: [] },
          ],
        }),
    } as Response);

    render(<CommandPalette />);
    await user.keyboard('{Control>}k{/Control}');
    await user.type(screen.getByPlaceholderText('Search pages and folders...'), 'research');
    await waitFor(() => expect(screen.getByText('Research')).toBeInTheDocument());
    await user.click(screen.getByText('Research'));

    expect(mockNavigate).toHaveBeenCalledWith(`/folder/research-${folderId}`);
  });

  it('shows "New Page" quick action', async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);

    await user.keyboard('{Control>}k{/Control}');

    await waitFor(() => {
      expect(screen.getByText('New Page')).toBeInTheDocument();
    });
  });

  it('shows "Go to Trash" quick action', async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);

    await user.keyboard('{Control>}k{/Control}');

    await waitFor(() => {
      expect(screen.getByText('Go to Trash')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Go to Trash'));

    expect(mockNavigate).toHaveBeenCalledWith('/trash');
  });

  it('keeps focus in the palette and opens quick actions with the keyboard', async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);

    await user.keyboard('{Control>}k{/Control}');
    const input = screen.getByPlaceholderText('Search pages and folders...');
    expect(input).toHaveFocus();

    await user.tab();
    expect(input).toHaveFocus();

    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');

    expect(mockNavigate).toHaveBeenCalledWith('/trash');
  });

  it('has no accessibility violations when open', async () => {
    const user = userEvent.setup();
    const { container } = render(<CommandPalette />);

    await user.keyboard('{Control>}k{/Control}');
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search pages and folders...')).toBeInTheDocument();
    });

    const results = await axe(container);
    expect(results.violations).toHaveLength(0);
  });
});
