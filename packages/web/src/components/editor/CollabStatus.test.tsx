import { WebSocketStatus } from '@hocuspocus/provider';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CollabStatus } from './CollabStatus';

const mockAwareness = {
  getStates: vi.fn().mockReturnValue(
    new Map([
      ['u1', { user: { userId: 'user-1', name: 'User 1', color: '#ff0000' } }],
      ['u2', { user: { userId: 'user-2', name: 'User 2', color: '#00ff00' } }],
    ]),
  ),
  on: vi.fn(),
  off: vi.fn(),
};

function createMockProvider(status: WebSocketStatus) {
  return {
    status,
    awareness: mockAwareness,
  } as unknown as Parameters<typeof CollabStatus>[0]['provider'];
}

describe('CollabStatus', () => {
  it('shows status indicator but no avatars when provider is null', () => {
    render(<CollabStatus provider={null} status={WebSocketStatus.Connecting} />);

    // Status indicator should still render (it's independent of provider)
    expect(screen.getByText('Connecting')).toBeInTheDocument();
    // User avatars should NOT render (they depend on provider.awareness)
    expect(screen.queryByText('User 1')).not.toBeInTheDocument();
  });

  it('shows connecting status label and amber dot', () => {
    const provider = createMockProvider(WebSocketStatus.Connecting);
    render(<CollabStatus provider={provider} status={WebSocketStatus.Connecting} />);

    expect(screen.getByText('User 1')).toBeInTheDocument();
    expect(screen.getByText('Connecting')).toBeInTheDocument();
    const dot = document.querySelector('.bg-amber-500');
    expect(dot).toBeInTheDocument();
  });

  it('shows connected status label and emerald dot', () => {
    const provider = createMockProvider(WebSocketStatus.Connected);
    render(<CollabStatus provider={provider} status={WebSocketStatus.Connected} />);

    expect(screen.getByText('User 1')).toBeInTheDocument();
    expect(screen.getByText('Live')).toBeInTheDocument();
    const dot = document.querySelector('.bg-emerald-500');
    expect(dot).toBeInTheDocument();
  });

  it('includes the collaborator role in page avatar tooltips', () => {
    const provider = createMockProvider(WebSocketStatus.Connected);
    mockAwareness.getStates.mockReturnValueOnce(
      new Map([
        ['u1', { user: { userId: 'user-1', name: 'User 1', color: '#ff0000' } }],
        ['u2', { user: { userId: 'user-2', name: 'User 1', color: '#00ff00' } }],
      ]),
    );
    render(
      <CollabStatus
        provider={provider}
        status={WebSocketStatus.Connected}
        collaborators={[
          { userId: 'user-2', name: 'User 1', avatarUrl: null, permission: 'view', isOwner: false },
          { userId: 'user-1', name: 'User 1', avatarUrl: null, permission: 'edit', isOwner: true },
        ]}
      />,
    );

    expect(screen.getByText('User 1 (Owner)')).toBeInTheDocument();
    expect(screen.getByText('User 1 (Viewer)')).toBeInTheDocument();
  });

  it('shows disconnected status label and rose dot', () => {
    const provider = createMockProvider(WebSocketStatus.Disconnected);
    render(<CollabStatus provider={provider} status={WebSocketStatus.Disconnected} />);

    expect(screen.getByText('User 1')).toBeInTheDocument();
    expect(screen.getByText('Offline')).toBeInTheDocument();
    const dot = document.querySelector('.bg-rose-500');
    expect(dot).toBeInTheDocument();
  });

  it('registers awareness change listener', () => {
    const provider = createMockProvider(WebSocketStatus.Connected);
    render(<CollabStatus provider={provider} status={WebSocketStatus.Connected} />);

    expect(mockAwareness.on).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('cleans up awareness listener on unmount', () => {
    const provider = createMockProvider(WebSocketStatus.Connected);
    const { unmount } = render(
      <CollabStatus provider={provider} status={WebSocketStatus.Connected} />,
    );
    unmount();

    expect(mockAwareness.off).toHaveBeenCalledWith('change', expect.any(Function));
  });
});
