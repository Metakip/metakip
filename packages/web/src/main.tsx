import { QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import './index.css';
import App from './App';
import { createQueryClient } from './lib/query-client';
import { getLogger, initLogger } from './logger-init';
import { getCollaborationUrl } from './utils/collaborationUrl';
import { ToastProvider } from './utils/toast';

initLogger().then(() => {
  const logger = getLogger();
  logger.info('[app] starting metakip web');
  logger.debug(`[env] NODE_ENV: ${import.meta.env.MODE}`);
  logger.debug(`[env] VITE_API_URL: ${import.meta.env.VITE_API_URL ?? 'not set'}`);
  logger.debug(`[env] collaboration URL: ${getCollaborationUrl()}`);
});

const queryClient = createQueryClient();

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element not found');
ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ToastProvider>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ToastProvider>
  </React.StrictMode>,
);
