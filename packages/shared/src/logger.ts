import { configure, getConsoleSink, getLogger, type Logger } from '@logtape/logtape';

let isConfigured = false;

export async function setupLogger(): Promise<void> {
  if (isConfigured) {
    return;
  }

  const _isProduction = process.env.NODE_ENV === 'production';

  await configure({
    sinks: {
      console: getConsoleSink(),
    },
    loggers: [
      { category: ['metakip', 'api'], lowestLevel: 'info', sinks: ['console'] },
      { category: ['metakip', 'http'], lowestLevel: 'debug', sinks: ['console'] },
      { category: ['metakip', 'db'], lowestLevel: 'debug', sinks: ['console'] },
      { category: ['metakip', 'auth'], lowestLevel: 'info', sinks: ['console'] },
      { category: ['metakip', 'collab'], lowestLevel: 'info', sinks: ['console'] },
      { category: ['metakip', 'web'], lowestLevel: 'debug', sinks: ['console'] },
      { category: ['metakip'], lowestLevel: 'info', sinks: ['console'] },
    ],
  });

  isConfigured = true;
}

export function getApiLogger(): Logger {
  return getLogger(['metakip', 'api']);
}

export function getDbLogger(): Logger {
  return getLogger(['metakip', 'db']);
}

export function getAuthLogger(): Logger {
  return getLogger(['metakip', 'auth']);
}

export function getCollabLogger(): Logger {
  return getLogger(['metakip', 'collab']);
}

export function getWebLogger(): Logger {
  return getLogger(['metakip', 'web']);
}

export function getAppLogger(): Logger {
  return getLogger(['metakip']);
}
