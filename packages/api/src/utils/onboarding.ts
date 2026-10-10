import { sql } from 'drizzle-orm';
import { executeQuery, type QueryExecutor } from '../db/query';

export async function completeOnboarding(executor: QueryExecutor, userId: string): Promise<void> {
  await executeQuery(
    executor,
    sql`update users
        set onboarding_completed_at = coalesce(onboarding_completed_at, now()), updated_at = now()
        where id = ${userId}`,
  );
}
