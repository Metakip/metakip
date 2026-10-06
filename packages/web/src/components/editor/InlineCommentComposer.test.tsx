import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { render } from '../../test-utils/render';
import { InlineCommentComposer } from './InlineCommentComposer';

describe('InlineCommentComposer', () => {
  it('keeps the selected text out of the composer and offers Cancel before Comment', () => {
    const onCancel = vi.fn();
    render(
      <InlineCommentComposer
        position={{ left: 100, right: 150, top: 100, bottom: 120 }}
        onSubmit={async () => {}}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByRole('textbox', { name: 'New comment on selection' })).toHaveClass(
      'focus-visible:ring-0',
    );
    expect(screen.queryByText(/0\/10,000/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Cancel comment')).not.toBeInTheDocument();
    expect(screen.queryByText('selected text')).not.toBeInTheDocument();

    const cancelButton = screen.getByRole('button', { name: 'Cancel' });
    const commentButton = screen.getByRole('button', { name: 'Comment' });
    expect(
      cancelButton.compareDocumentPosition(commentButton) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(commentButton.querySelector('svg')).toBeNull();

    fireEvent.click(cancelButton);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('submits with Ctrl+Enter', async () => {
    const onSubmit = vi.fn(async (_body: string) => {});
    render(
      <InlineCommentComposer
        position={{ left: 100, right: 150, top: 100, bottom: 120 }}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );
    const input = screen.getByRole('textbox', { name: 'New comment on selection' });
    fireEvent.change(input, { target: { value: 'A comment' } });
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('A comment'));
  });

  it('submits with Cmd+Enter', async () => {
    const onSubmit = vi.fn(async (_body: string) => {});
    render(
      <InlineCommentComposer
        position={{ left: 100, right: 150, top: 100, bottom: 120 }}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );
    const input = screen.getByRole('textbox', { name: 'New comment on selection' });
    fireEvent.change(input, { target: { value: 'A comment' } });
    fireEvent.keyDown(input, { key: 'Enter', metaKey: true });

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('A comment'));
  });
});
