import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  socialSignIn: vi.fn(),
  useAuth: vi.fn(),
}));

vi.mock('../lib/auth-client', () => ({
  authClient: { signIn: { social: mocks.socialSignIn } },
}));
vi.mock('../hooks/useAuth', () => ({ useAuth: mocks.useAuth }));
vi.mock('../components/HeaderActions', () => ({ HeaderActions: () => null }));

import Login from './Login';

function renderLogin() {
  return render(
    <MemoryRouter
      initialEntries={[
        {
          pathname: '/login',
          state: {
            from: { pathname: '/invite/invitation-token' },
            invitationEmail: 'invitee@example.com',
          },
        },
      ]}
    >
      <Routes>
        <Route path="/login" element={<Login />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Login', () => {
  beforeEach(() => {
    mocks.socialSignIn.mockReset().mockResolvedValue(undefined);
    mocks.useAuth.mockReturnValue({ data: null, isPending: false, isRefetching: false });
  });

  it('hints Google with the invited email and returns to the invitation', async () => {
    renderLogin();

    fireEvent.click(screen.getByRole('button', { name: /Continue with Google/ }));

    await waitFor(() =>
      expect(mocks.socialSignIn).toHaveBeenCalledWith({
        provider: 'google',
        additionalParams: { login_hint: 'invitee@example.com' },
        callbackURL: '/invite/invitation-token',
        errorCallbackURL: '/login',
      }),
    );
  });

  it('leaves GitHub sign-in parameters unchanged', async () => {
    renderLogin();

    fireEvent.click(screen.getByRole('button', { name: /Continue with GitHub/ }));

    await waitFor(() =>
      expect(mocks.socialSignIn).toHaveBeenCalledWith({
        provider: 'github',
        callbackURL: '/invite/invitation-token',
        errorCallbackURL: '/login',
      }),
    );
  });
});
