import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

interface PwaInstallContextValue {
  canInstall: boolean;
  isInstalled: boolean;
  isStandalone: boolean;
  install: () => Promise<void>;
}

const PwaInstallContext = createContext<PwaInstallContextValue | null>(null);

function isRunningAsInstalledApp(): boolean {
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
  const navigatorWithStandalone = window.navigator as Navigator & { standalone?: boolean };

  return isStandalone || navigatorWithStandalone.standalone === true;
}

export function PwaInstallProvider({ children }: { children: ReactNode }) {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isStandalone, setIsStandalone] = useState(
    () => typeof window !== 'undefined' && isRunningAsInstalledApp(),
  );

  useEffect(() => {
    const displayModeQuery = window.matchMedia('(display-mode: standalone)');
    const updateStandaloneState = () => {
      const navigatorWithStandalone = window.navigator as Navigator & { standalone?: boolean };
      setIsStandalone(displayModeQuery.matches || navigatorWithStandalone.standalone === true);
    };
    updateStandaloneState();

    const handleBeforeInstallPrompt = (event: Event) => {
      const installEvent = event as BeforeInstallPromptEvent;
      if (typeof installEvent.prompt !== 'function') return;

      setDeferredPrompt(installEvent);
      // Chrome may use the same offer for its own install UI. Don't keep our button
      // pointing at an offer that the browser has already handled.
      const clearConsumedPrompt = () => {
        setDeferredPrompt((current) => (current === installEvent ? null : current));
      };
      void installEvent.userChoice.then(clearConsumedPrompt, clearConsumedPrompt);
    };
    const handleAppInstalled = () => {
      setDeferredPrompt(null);
      setIsInstalled(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    displayModeQuery.addEventListener('change', updateStandaloneState);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
      displayModeQuery.removeEventListener('change', updateStandaloneState);
    };
  }, []);

  const install = useCallback(async (): Promise<void> => {
    if (!deferredPrompt) return;

    setDeferredPrompt(null);
    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') setIsInstalled(true);
    } catch {
      // The consumed offer falls back to the browser installation instructions.
      return;
    }
  }, [deferredPrompt]);

  return (
    <PwaInstallContext.Provider
      value={{ canInstall: deferredPrompt !== null, isInstalled, isStandalone, install }}
    >
      {children}
    </PwaInstallContext.Provider>
  );
}

export function usePwaInstall(): PwaInstallContextValue {
  const context = useContext(PwaInstallContext);
  if (!context) {
    throw new Error('usePwaInstall must be used within a PwaInstallProvider');
  }
  return context;
}
