import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PwaInstallProvider } from '../../contexts/PwaInstallContext';
import { InstallAppCard } from './InstallAppCard';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

function renderCard() {
  return render(
    <PwaInstallProvider>
      <InstallAppCard />
    </PwaInstallProvider>,
  );
}

function createInstallPromptEvent(prompt: () => Promise<void>): {
  event: BeforeInstallPromptEvent;
  choose: (outcome: 'accepted' | 'dismissed') => void;
} {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as BeforeInstallPromptEvent;
  event.prompt = prompt;
  let choose!: (outcome: 'accepted' | 'dismissed') => void;
  event.userChoice = new Promise((resolve) => {
    choose = (outcome) => resolve({ outcome, platform: 'web' });
  });
  return { event, choose };
}

function mockStandaloneMode(isStandalone: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query) =>
      ({
        matches: query === '(display-mode: standalone)' && isStandalone,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }) as MediaQueryList,
  );
}

describe('InstallAppCard', () => {
  it('shows browser installation instructions when the browser has no install prompt', () => {
    renderCard();

    expect(screen.getByRole('heading', { name: 'Install Metakip' })).toBeInTheDocument();
    expect(screen.getByText(/An internet connection is required/)).toBeInTheDocument();
    expect(screen.getByText(/open your browser menu/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Install Metakip' })).not.toBeInTheDocument();
  });

  it('opens the browser install prompt when available', async () => {
    const user = userEvent.setup();
    const prompt = vi.fn().mockResolvedValue(undefined);
    renderCard();

    const { event, choose } = createInstallPromptEvent(prompt);
    act(() => {
      window.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Install Metakip' }));

    expect(prompt).toHaveBeenCalledOnce();
    await act(async () => choose('accepted'));
    expect(await screen.findByRole('heading', { name: 'Install requested' })).toBeInTheDocument();
    expect(
      screen.getByText('Metakip may take a moment to appear in your apps.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('This device is using the installed app.')).not.toBeInTheDocument();
  });

  it('only says the installed app is in use when running in standalone mode', () => {
    mockStandaloneMode(true);

    renderCard();

    expect(screen.getByText('This device is using the installed app.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Install Metakip' })).not.toBeInTheDocument();
  });

  it('falls back to browser instructions if the install prompt is dismissed', async () => {
    const user = userEvent.setup();
    mockStandaloneMode(false);
    renderCard();

    const { event, choose } = createInstallPromptEvent(vi.fn().mockResolvedValue(undefined));
    act(() => window.dispatchEvent(event));

    await user.click(screen.getByRole('button', { name: 'Install Metakip' }));
    await act(async () => choose('dismissed'));

    expect(screen.queryByRole('button', { name: 'Install Metakip' })).not.toBeInTheDocument();
    expect(screen.getByText(/open your browser menu/)).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(createInstallPromptEvent(vi.fn().mockResolvedValue(undefined)).event);
    });

    expect(screen.getByRole('button', { name: 'Install Metakip' })).toBeInTheDocument();
    expect(screen.queryByText(/open your browser menu/)).not.toBeInTheDocument();
  });

  it('clears the button if Chrome handles its install suggestion instead', async () => {
    renderCard();
    const { event, choose } = createInstallPromptEvent(vi.fn().mockResolvedValue(undefined));
    act(() => window.dispatchEvent(event));

    expect(event.defaultPrevented).toBe(false);
    expect(screen.getByRole('button', { name: 'Install Metakip' })).toBeInTheDocument();

    await act(async () => choose('dismissed'));

    expect(screen.queryByRole('button', { name: 'Install Metakip' })).not.toBeInTheDocument();
    expect(screen.getByText(/open your browser menu/)).toBeInTheDocument();
  });
});
