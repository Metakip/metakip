import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { render } from '../../test-utils/render';
import { apiFetch } from '../../utils/api';
import { InlineCommentCard } from './InlineCommentCard';

vi.mock('../../utils/api', () => ({
  apiFetch: vi.fn(),
  ApiError: class ApiError extends Error {},
}));

const pageId = '00000000-0000-4000-8000-000000000002';
const authorId = '00000000-0000-4000-8000-000000000001';
const threadId = '00000000-0000-4000-8000-000000000003';
const commentId = '00000000-0000-4000-8000-000000000004';

function createThread() {
  return {
    id: threadId,
    pageId,
    anchor: { quote: 'important phrase' },
    status: 'open' as const,
    createdBy: authorId,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    resolvedBy: null,
    resolvedAt: null,
    comments: [
      {
        id: commentId,
        threadId,
        authorId,
        authorName: 'Reviewer',
        authorImage: null,
        body: 'Please clarify this.',
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-01T00:00:00.000Z',
        deletedAt: null,
      },
    ],
  };
}

function renderCard() {
  return render(
    <InlineCommentCard
      pageId={pageId}
      thread={createThread()}
      anchorKey='["important phrase",null,null]'
      currentUserId={authorId}
      canComment
      canModerate={false}
      active={false}
      onHoverChange={() => {}}
      onHeightChange={() => {}}
      style={{ top: 20, right: 0 }}
    />,
  );
}

describe('InlineCommentCard', () => {
  it('opens an inline reply composer and submits replies without opening the comments panel', async () => {
    vi.mocked(apiFetch).mockImplementation(async () => ({ thread: createThread() }));
    renderCard();

    fireEvent.click(screen.getByRole('button', { name: 'Please clarify this.' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Reply to comment thread' }), {
      target: { value: 'Here is more detail.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        `/v1/pages/${pageId}/comments/${threadId}/replies`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ body: 'Here is more detail.' }),
        }),
      ),
    );
  });

  it.each([
    ['Ctrl+Enter', { ctrlKey: true }],
    ['Cmd+Enter', { metaKey: true }],
  ])('submits an inline reply with %s', async (_shortcut, modifiers) => {
    vi.mocked(apiFetch).mockImplementation(async () => ({ thread: createThread() }));
    renderCard();

    fireEvent.click(screen.getByText('Reviewer'));
    const replyInput = await screen.findByRole('textbox', { name: 'Reply to comment thread' });
    fireEvent.change(replyInput, { target: { value: 'Shortcut reply.' } });
    fireEvent.keyDown(replyInput, { key: 'Enter', ...modifiers });

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        `/v1/pages/${pageId}/comments/${threadId}/replies`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ body: 'Shortcut reply.' }),
        }),
      ),
    );
  });

  it('opens reply when the comment card is clicked and focuses the reply field', async () => {
    vi.mocked(apiFetch).mockImplementation(async () => ({ thread: createThread() }));
    renderCard();

    fireEvent.click(screen.getByText('Reviewer'));

    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Reply to comment thread' })).toHaveFocus(),
    );
  });

  it('cancels and clears an inline reply with the Cancel button', async () => {
    vi.mocked(apiFetch).mockImplementation(async () => ({ thread: createThread() }));
    renderCard();

    fireEvent.click(screen.getByText('Reviewer'));
    const replyInput = await screen.findByRole('textbox', { name: 'Reply to comment thread' });
    fireEvent.change(replyInput, { target: { value: 'Draft reply' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(
      screen.queryByRole('textbox', { name: 'Reply to comment thread' }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Reviewer'));
    expect(await screen.findByRole('textbox', { name: 'Reply to comment thread' })).toHaveValue('');
  });

  it('shows edit inline from the more-actions menu', async () => {
    vi.mocked(apiFetch).mockImplementation(async () => ({ thread: createThread() }));
    renderCard();

    fireEvent.click(screen.getByRole('button', { name: 'More actions for comment by Reviewer' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit comment' }), {
      target: { value: 'Updated comment text.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        `/v1/pages/${pageId}/comments/${commentId}`,
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ body: 'Updated comment text.' }),
        }),
      ),
    );
  });

  it('offers a quick resolve action on hover', async () => {
    vi.mocked(apiFetch).mockImplementation(async () => ({ thread: createThread() }));
    renderCard();

    fireEvent.click(screen.getByRole('button', { name: 'Resolve comment thread' }));

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        `/v1/pages/${pageId}/comments/${threadId}/status`,
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ status: 'resolved' }),
        }),
      ),
    );
  });
});
