import { getApiLogger } from '@metakip/shared';
import { createMiddleware } from 'hono/factory';
import { auth } from '../auth';

type AuthUser = {
  id: string;
};

declare module 'hono' {
  interface ContextVariableMap {
    user: AuthUser;
  }
}

export const requireAuth = createMiddleware(async (c, next) => {
  const logger = getApiLogger();
  const session = await auth.api.getSession({ headers: c.req.raw.headers });

  if (!session?.user) {
    logger.debug(`[auth] unauthenticated: ${c.req.method} ${c.req.path}`);
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const user = session.user as AuthUser;
  if (!user.id) {
    logger.debug(`[auth] invalid session: ${c.req.method} ${c.req.path}`);
    return c.json({ error: 'Unauthorized' }, 401);
  }

  logger.debug(`[auth] authenticated user=${user.id}: ${c.req.method} ${c.req.path}`);
  c.set('user', user);
  await next();
  return;
});
