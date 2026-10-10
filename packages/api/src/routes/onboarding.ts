import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/connection';
import { query } from '../db/query';
import { requireAuth } from '../middleware/auth';
import { completeOnboarding } from '../utils/onboarding';

const onboardingRoute = new Hono();

onboardingRoute.use('*', requireAuth);

onboardingRoute.get('/', async (c) => {
  const user = c.get('user');
  const result = await query<{ onboarding_completed_at: Date | null }>(
    sql`select onboarding_completed_at from users where id = ${user.id} limit 1`,
  );

  return c.json({ completed: Boolean(result.rows[0]?.onboarding_completed_at) });
});

onboardingRoute.post('/complete', async (c) => {
  const user = c.get('user');
  await completeOnboarding(db, user.id);

  return c.json({ completed: true });
});

export default onboardingRoute;
