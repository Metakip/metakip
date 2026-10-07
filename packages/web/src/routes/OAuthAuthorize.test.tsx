import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  consent: vi.fn(),
  session: { data: { user: { id: 'user-1' } }, isPending: false },
}));

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => mocks.session,
}));
vi.mock('../lib/auth-client', () => ({
  authClient: { oauth2: { consent: mocks.consent } },
}));

import OAuthAuthorize from './OAuthAuthorize';

function SwitchAuthorizationRequest() {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() =>
        navigate('/oauth/authorize?client_id=client-1&scope=pages%3Aread+pages%3Awrite+openid')
      }
    >
      Switch request
    </button>
  );
}

describe('OAuthAuthorize', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.consent.mockReset();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ client_id: 'client-1', client_name: 'Test application' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    );
  });

  it('resets selected scopes when navigation changes the authorization request', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter
        initialEntries={['/oauth/authorize?client_id=client-1&scope=pages%3Aread+pages%3Awrite']}
      >
        <Routes>
          <Route
            path="/oauth/authorize"
            element={
              <>
                <OAuthAuthorize />
                <SwitchAuthorizationRequest />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    const writeScope = await screen.findByRole('checkbox', {
      name: 'Modify pages and folders (includes comment access)',
    });
    expect(writeScope).toBeChecked();

    fireEvent.click(writeScope);
    await waitFor(() => expect(writeScope).not.toBeChecked());
    await user.click(screen.getByRole('button', { name: 'Switch request' }));

    await waitFor(() =>
      expect(
        screen.getByRole('checkbox', {
          name: 'Modify pages and folders (includes comment access)',
        }),
      ).toBeChecked(),
    );
  });

  it('ignores a nested request that differs from the displayed client and scopes', async () => {
    const user = userEvent.setup();
    mocks.consent.mockResolvedValue({ error: { message: 'Stop before redirect' } });

    render(
      <MemoryRouter
        initialEntries={[
          '/oauth/authorize?client_id=client-1&scope=pages%3Aread&oauth_query=client_id%3Dother-client%26scope%3Dpages%253Aread%2Bpages%253Awrite',
        ]}
      >
        <Routes>
          <Route path="/oauth/authorize" element={<OAuthAuthorize />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Test application' })).toBeInTheDocument();
    expect(
      screen.queryByText('Modify pages and folders (includes comment access)'),
    ).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith('/api/auth/oauth2/public-client?client_id=client-1');

    await user.click(screen.getByRole('button', { name: 'Connect' }));

    await waitFor(() =>
      expect(mocks.consent).toHaveBeenCalledWith({
        accept: true,
        scope: 'pages:read',
      }),
    );
  });

  it('discloses and preserves offline access', async () => {
    const user = userEvent.setup();
    mocks.consent.mockResolvedValue({ error: { message: 'Stop before redirect' } });

    render(
      <MemoryRouter
        initialEntries={['/oauth/authorize?client_id=client-1&scope=pages%3Aread+offline_access']}
      >
        <Routes>
          <Route path="/oauth/authorize" element={<OAuthAuthorize />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Stay connected when you are away')).toBeInTheDocument();
    expect(
      screen.getByText('This application can remain connected after your browser session ends.'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Connect' }));

    await waitFor(() =>
      expect(mocks.consent).toHaveBeenCalledWith({
        accept: true,
        scope: 'pages:read offline_access',
      }),
    );
  });

  it('displays and grants the comment permission level with implied page read access', async () => {
    const user = userEvent.setup();
    mocks.consent.mockResolvedValue({ error: { message: 'Stop before redirect' } });

    render(
      <MemoryRouter
        initialEntries={['/oauth/authorize?client_id=client-1&scope=pages%3Acomment+openid']}
      >
        <Routes>
          <Route path="/oauth/authorize" element={<OAuthAuthorize />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Test application' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'This application is requesting access to your Metakip pages, folders, and comments.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: 'Read and comment on pages and folders' }),
    ).toBeChecked();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Connect' }));

    await waitFor(() =>
      expect(mocks.consent).toHaveBeenCalledWith({
        accept: true,
        scope: 'pages:comment openid',
      }),
    );
  });
});
