import './env';
import { honoLogger } from '@logtape/hono';
import { getApiLogger, setupLogger } from '@metakip/shared';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { timing } from 'hono/timing';
import { auth } from './auth';
import { v1ErrorResponse, v1NotFound } from './middleware/v1Errors';
import { authRoutes } from './routes';
import backlinksRoute from './routes/backlinks';
import bulkRemovalRoute from './routes/bulk-removal';
import collaboratorDisplayRoute from './routes/collaborators';
import exportRoute from './routes/export';
import favoritesRoute from './routes/favorites';
import foldersRoute, { foldersPublicRoute } from './routes/folders';
import importRoute from './routes/import';
import obsidianImportRoute from './routes/obsidian-import';
import onboardingRoute from './routes/onboarding';
import pagesRoute, { pagesPublicRoute } from './routes/pages';
import searchRoute from './routes/search';
import sharesRoute from './routes/shares';
import tagsRoute from './routes/tags';
import templatesRoute from './routes/templates';
import testSetupRoute from './routes/test-setup';
import trashRoute from './routes/trash';
import uploadsRoute from './routes/uploads';
import foldersV1Route from './routes/v1/folders';
import { lifecycleRoute } from './routes/v1/lifecycle';
import meV1Route from './routes/v1/me';
import openApiV1Route from './routes/v1/openapi';
import pagesV1Route from './routes/v1/pages';
import tokensV1Route from './routes/v1/tokens';
import versionsRoute from './routes/versions';
import workspaceRoute from './routes/workspace';

export async function createApp() {
  await setupLogger();
  const appLogger = getApiLogger();

  type OriginDecision = string | undefined;

  const app = new Hono();

  const isProduction = process.env.NODE_ENV === 'production';
  const allowedOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.use(
    '*',
    cors({
      allowHeaders: ['Authorization', 'Content-Type', 'If-Match', 'Idempotency-Key'],
      exposeHeaders: ['ETag'],
      origin: (origin: string | undefined): OriginDecision => {
        if (!isProduction) {
          return origin ?? '*';
        }
        if (!origin) {
          return allowedOrigins[0];
        }
        return allowedOrigins.includes(origin) ? origin : undefined;
      },
    }),
  );

  app.use(
    '*',
    honoLogger({
      category: ['metakip', 'http'],
      skip: (c) => c.req.path === '/api/health',
    }),
  );
  app.use('*', timing());

  app.get('/api/health', (c) => {
    return c.json({ status: 'ok', timestamp: Date.now() });
  });

  // Better Auth's MCP plugin serves protected-resource metadata at the
  // resource-server well-known root rather than under /api/auth.
  app.on(['GET', 'HEAD'], '/.well-known/*', (c) => auth.handler(c.req.raw));

  const v1App = new Hono();
  v1App.route('/me', meV1Route);
  v1App.route('/openapi.json', openApiV1Route);
  v1App.route('/tokens', tokensV1Route);
  v1App.route('/pages', pagesV1Route);
  v1App.route('/folders', foldersV1Route);
  v1App.route('/', lifecycleRoute);
  v1App.all('*', v1NotFound);
  v1App.notFound(v1NotFound);
  v1App.onError((error, context) => v1ErrorResponse(context, error));
  app.route('/api/v1', v1App);

  app.route('/api/pages', pagesPublicRoute);
  app.route('/api/pages', exportRoute);
  app.route('/api/pages', pagesRoute);

  app.route('/api/folders', foldersPublicRoute);
  app.route('/api/folders', foldersRoute);
  app.route('/api/trash', trashRoute);

  // workspaces API removed

  app.route('/api/search', searchRoute);

  app.route('/api/shares', collaboratorDisplayRoute);
  app.route('/api/shares', sharesRoute);

  app.route('/api/favorites', favoritesRoute);

  app.route('/api/pages', versionsRoute);

  app.route('/api/templates', templatesRoute);

  app.route('/api/uploads', uploadsRoute);
  app.route('/api/import', importRoute);
  app.route('/api/import/obsidian', obsidianImportRoute);
  app.route('/api/onboarding', onboardingRoute);
  app.route('/api/tags', tagsRoute);
  app.route('/api/backlinks', backlinksRoute);
  app.route('/api/bulk-removal', bulkRemovalRoute);

  app.route('/api/workspace', workspaceRoute);

  app.route('/api', testSetupRoute);

  // Legacy /api/public routes removed — public pages are now served at /api/pages/:id
  app.route('/api', authRoutes);

  app.notFound((c) => c.json({ message: 'Not Found' }, 404));

  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      const cause = err.cause;
      const code =
        cause && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string'
          ? cause.code
          : undefined;
      return c.json(code ? { message: err.message, code } : { message: err.message }, err.status);
    }
    appLogger.error(`Unhandled error: ${err.message}`, { stack: err.stack });
    return c.json({ message: 'Internal Server Error' }, 500);
  });

  return app;
}

export type AppType = Hono;
