import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { render } from '../../test-utils/render';
import { apiFetch } from '../../utils/api';
import { CommentsPanel } from './CommentsPanel';

vi.mock('../../utils/api', () => ({
  apiFetch: vi.fn(),
  ApiError: class ApiError extends Error {},
}));
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ data: { user: { id: '00000000-0000-4000-8000-000000000001' } } }),
}));

const pageId = '00000000-0000-4000-8000-000000000002';

describe('CommentsPanel', () => {
  it('requires a text selection before showing the new comment composer', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ data: [], nextCursor: null });

    render(
      <CommentsPanel
        pageId={pageId}
        selectedAnchor={null}
        canModerate={false}
        onClose={() => {}}
        onClearSelection={() => {}}
      />,
    );

    expect(
      await screen.findByText('Select text in the page to start a comment thread.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'New comment' })).not.toBeInTheDocument();
  });

  it('activates the matching text anchor while a panel thread is hovered', async () => {
    const anchor = { quote: 'important phrase', prefix: 'before ', suffix: ' after' };
    const threadId = '00000000-0000-4000-8000-000000000003';
    vi.mocked(apiFetch).mockResolvedValue({
      data: [
        {
          id: threadId,
          pageId,
          anchor,
          status: 'open',
          createdBy: '00000000-0000-4000-8000-000000000001',
          createdAt: '2026-10-01T00:00:00.000Z',
          updatedAt: '2026-10-01T00:00:00.000Z',
          resolvedBy: null,
          resolvedAt: null,
          comments: [
            {
              id: '00000000-0000-4000-8000-000000000004',
              threadId,
              authorId: '00000000-0000-4000-8000-000000000001',
              authorName: 'Reviewer',
              authorImage: null,
              body: 'Review this.',
              createdAt: '2026-10-01T00:00:00.000Z',
              updatedAt: '2026-10-01T00:00:00.000Z',
              deletedAt: null,
            },
          ],
        },
      ],
      nextCursor: null,
    });
    const onCommentAnchorHoverChange = vi.fn();

    const { container } = render(
      <CommentsPanel
        pageId={pageId}
        selectedAnchor={null}
        canModerate={false}
        onClose={() => {}}
        onClearSelection={() => {}}
        onCommentAnchorHoverChange={onCommentAnchorHoverChange}
      />,
    );

    await screen.findByText('“important phrase”');
    const threadCard = container.querySelector('[data-comment-anchor-key]');
    if (!threadCard) throw new Error('Expected a comment thread card');
    fireEvent.mouseEnter(threadCard);
    expect(onCommentAnchorHoverChange).toHaveBeenLastCalledWith(anchor);
    fireEvent.mouseLeave(threadCard);
    expect(onCommentAnchorHoverChange).toHaveBeenLastCalledWith(null);
  });

  it.each([
    ['Ctrl+Enter', { ctrlKey: true }],
    ['Cmd+Enter', { metaKey: true }],
  ])('creates an inline thread with %s and preserves its quote context', async (_shortcut, modifiers) => {
    vi.mocked(apiFetch).mockImplementation(async (path, init) => {
      if (path.includes('?status=')) return { data: [], nextCursor: null };
      const body = JSON.parse(String(init?.body)) as { body: string; anchor?: unknown };
      return {
        thread: {
          id: '00000000-0000-4000-8000-000000000003',
          pageId,
          anchor: body.anchor,
          status: 'open',
          createdBy: '00000000-0000-4000-8000-000000000001',
          createdAt: '2026-10-01T00:00:00.000Z',
          updatedAt: '2026-10-01T00:00:00.000Z',
          resolvedBy: null,
          resolvedAt: null,
          comments: [
            {
              id: '00000000-0000-4000-8000-000000000004',
              threadId: '00000000-0000-4000-8000-000000000003',
              authorId: '00000000-0000-4000-8000-000000000001',
              authorName: 'Reviewer',
              authorImage: null,
              body: body.body,
              createdAt: '2026-10-01T00:00:00.000Z',
              updatedAt: '2026-10-01T00:00:00.000Z',
              deletedAt: null,
            },
          ],
        },
      };
    });

    render(
      <CommentsPanel
        pageId={pageId}
        selectedAnchor={{ quote: 'important phrase', prefix: 'before ', suffix: ' after' }}
        canModerate={false}
        onClose={() => {}}
        onClearSelection={() => {}}
      />,
    );

    const input = screen.getByRole('textbox', { name: 'New comment' });
    expect(screen.getByText('Comment on selection')).toBeInTheDocument();
    expect(screen.queryByText('important phrase')).not.toBeInTheDocument();
    expect(screen.queryByText(/Plain text|0\/10,000/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Comment' }).querySelector('svg')).toBeNull();
    fireEvent.change(input, {
      target: { value: 'Please clarify this.' },
    });
    fireEvent.keyDown(input, { key: 'Enter', ...modifiers });

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        `/v1/pages/${pageId}/comments`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            body: 'Please clarify this.',
            anchor: { quote: 'important phrase', prefix: 'before ', suffix: ' after' },
          }),
        }),
      ),
    );
  });
});
