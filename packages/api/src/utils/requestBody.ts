import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';

export async function parseJsonRequestBody(context: Context): Promise<unknown> {
  try {
    return await context.req.json();
  } catch (error) {
    // Request decoding is the HTTP transport boundary. Malformed JSON is a
    // client error, so preserve the original cause while translating it to 400.
    throw new HTTPException(400, { message: 'Malformed JSON body', cause: error });
  }
}
