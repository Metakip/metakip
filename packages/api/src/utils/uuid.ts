import { HTTPException } from 'hono/http-exception';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireUuid(value: string, label: string): string {
  if (!UUID_PATTERN.test(value)) throw new HTTPException(400, { message: `Invalid ${label}` });
  return value;
}
