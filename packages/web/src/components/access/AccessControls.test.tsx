import { fireEvent, render, screen } from '@testing-library/react';
import type { FormEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AccessLoadError, InviteAccessForm } from './AccessControls';

describe('Shared access controls', () => {
  it('leaves form state and submission with its feature owner', () => {
    const onSubmit = vi.fn((event: FormEvent) => event.preventDefault());
    render(
      <InviteAccessForm title="Grant Access" onSubmit={onSubmit}>
        <input type="email" aria-label="Invite email" defaultValue="reader@example.com" />
        <button type="submit">Add</button>
      </InviteAccessForm>,
    );

    expect(screen.getByText('Grant Access')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(screen.getByRole('textbox', { name: 'Invite email' })).toHaveValue('reader@example.com');
  });

  it('keeps retry behavior with the feature owner', () => {
    const onRetry = vi.fn();
    render(
      <AccessLoadError
        title="Access Could Not Be Loaded"
        description="No changes have been made."
        onRetry={onRetry}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('No changes have been made.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
