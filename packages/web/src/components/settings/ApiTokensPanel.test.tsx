import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiTokensPanel } from './ApiTokensPanel';

const hooks = vi.hoisted(() => ({
  create: vi.fn(),
  revoke: vi.fn(),
  tokens: [] as Array<{
    id: string;
    name: string;
    scopes: string[];
    expiresAt: string | null;
    lastUsedAt: string | null;
    createdAt: string;
  }>,
}));

vi.mock('../../hooks/useApiTokens', () => ({
  useApiTokens: () => ({ data: hooks.tokens, isLoading: false, isError: false }),
  useCreateApiToken: () => ({ mutate: hooks.create, isPending: false }),
  useRevokeApiToken: () => ({ mutate: hooks.revoke }),
}));

describe('ApiTokensPanel', () => {
  beforeEach(() => {
    hooks.create.mockReset();
    hooks.revoke.mockReset();
    hooks.tokens = [];
  });

  it('renders token dates in day/month/year order', () => {
    hooks.tokens = [
      {
        id: 'token-1',
        name: 'Build agent',
        scopes: ['pages:read', 'pages:write'],
        lastUsedAt: '2026-07-27T12:00:00.000Z',
        expiresAt: '2026-08-01T12:00:00.000Z',
        createdAt: '2026-07-01T12:00:00.000Z',
      },
    ];

    render(<ApiTokensPanel />);

    expect(screen.getByText(/Last used 27\/07\/2026/)).toBeInTheDocument();
    expect(screen.getByText(/Expires 01\/08\/2026/)).toBeInTheDocument();
  });

  it('defaults to no expiry and supports selecting an expiry', async () => {
    const user = userEvent.setup();
    render(<ApiTokensPanel />);

    expect(screen.getByRole('combobox', { name: 'Token access' })).toHaveTextContent('Read only');
    expect(screen.getByRole('combobox', { name: 'Expiry' })).toHaveTextContent('No expiry');
    await user.type(screen.getByLabelText('Token name'), 'Build agent');
    await user.click(screen.getByRole('combobox', { name: 'Token access' }));
    await user.click(screen.getByRole('option', { name: 'Read, comment, and write' }));
    await user.click(screen.getByRole('combobox', { name: 'Expiry' }));
    await user.click(screen.getByRole('option', { name: '30 days' }));
    const beforeCreate = Date.now();
    await user.click(screen.getByRole('button', { name: 'Create token' }));

    expect(hooks.create).toHaveBeenCalledOnce();
    const request = hooks.create.mock.calls[0]?.[0] as {
      name: string;
      access: 'read' | 'comment' | 'write';
      expiresAt: string | null;
    };
    expect(request).toMatchObject({
      name: 'Build agent',
      access: 'write',
    });
    expect(new Date(request.expiresAt ?? '').getTime()).toBeGreaterThanOrEqual(
      beforeCreate + 30 * 24 * 60 * 60 * 1000,
    );
  });

  it('allows creating a comment-level token', async () => {
    const user = userEvent.setup();
    render(<ApiTokensPanel />);

    await user.type(screen.getByLabelText('Token name'), 'Comment agent');
    await user.click(screen.getByRole('combobox', { name: 'Token access' }));
    await user.click(screen.getByRole('option', { name: 'Read and comment' }));
    await user.click(screen.getByRole('button', { name: 'Create token' }));

    expect(hooks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Comment agent',
        access: 'comment',
      }),
      expect.any(Object),
    );
  });
});
