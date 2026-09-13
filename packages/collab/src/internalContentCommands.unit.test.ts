import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Logger } from '@logtape/logtape';
import { INTERNAL_CONTENT_HEADERS, MAX_INTERNAL_CONTENT_COMMAND_BYTES } from '@metakip/shared';
import { describe, expect, it, vi } from 'vitest';
import { createContentCommandAdmission } from './contentCommandAdmission';
import type { InternalContentCommandOptions } from './internalContentCommandExecution';
import { createInternalContentCommands } from './internalContentCommands';

function commandRequest(
  pageId: string,
  userId: string,
  body: AsyncIterable<Uint8Array>,
): IncomingMessage {
  return {
    method: 'POST',
    url: `/internal/pages/${pageId}/apply-exact-edits`,
    headers: {
      [INTERNAL_CONTENT_HEADERS.secret]: 'internal-secret',
      [INTERNAL_CONTENT_HEADERS.userId]: userId,
      [INTERNAL_CONTENT_HEADERS.requestId]: randomUUID(),
      [INTERNAL_CONTENT_HEADERS.idempotencyPrincipal]: `session:${randomUUID()}`,
    },
    [Symbol.asyncIterator]: () => body[Symbol.asyncIterator](),
  } as unknown as IncomingMessage;
}

function commandResponse(): {
  response: ServerResponse;
  status: () => number | undefined;
  body: () => unknown;
} {
  let responseStatus: number | undefined;
  let responseBody: unknown;
  const response = {
    writeHead: (status: number) => {
      responseStatus = status;
      return response;
    },
    end: (body: string) => {
      responseBody = JSON.parse(body) as unknown;
      return response;
    },
  } as unknown as ServerResponse;
  return { response, status: () => responseStatus, body: () => responseBody };
}

describe('internal content command admission', () => {
  it('rejects a concurrent oversized command before reading its body', async () => {
    const pageId = randomUUID();
    const userId = randomUUID();
    const admission = createContentCommandAdmission({ maxConcurrent: 1, maxPerDocument: 1 });
    const options = {
      internalSecret: 'internal-secret',
      tryAcquireContentCommand: admission.tryAcquire,
      logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger,
    } as unknown as InternalContentCommandOptions;
    const handle = createInternalContentCommands(options);

    let markFirstBodyStarted: (() => void) | undefined;
    const firstBodyStarted = new Promise<void>((resolve) => {
      markFirstBodyStarted = resolve;
    });
    let finishFirstBody: (() => void) | undefined;
    const firstBodyCanFinish = new Promise<void>((resolve) => {
      finishFirstBody = resolve;
    });
    async function* firstBody(): AsyncGenerator<Uint8Array> {
      markFirstBodyStarted?.();
      await firstBodyCanFinish;
      yield Buffer.from('{}');
    }
    let oversizedBodyRead = false;
    async function* oversizedBody(): AsyncGenerator<Uint8Array> {
      oversizedBodyRead = true;
      yield Buffer.alloc(MAX_INTERNAL_CONTENT_COMMAND_BYTES + 1);
    }

    const firstResponse = commandResponse();
    const firstCommand = handle(
      commandRequest(pageId, userId, firstBody()),
      firstResponse.response,
    );
    await firstBodyStarted;

    const rejectedResponse = commandResponse();
    await handle(commandRequest(pageId, userId, oversizedBody()), rejectedResponse.response);
    expect(rejectedResponse.status()).toBe(503);
    expect(rejectedResponse.body()).toMatchObject({ code: 'collaboration_busy' });
    expect(oversizedBodyRead).toBe(false);

    finishFirstBody?.();
    await firstCommand;
    expect(firstResponse.status()).toBe(400);

    const afterReleaseResponse = commandResponse();
    await handle(commandRequest(pageId, userId, firstBody()), afterReleaseResponse.response);
    expect(afterReleaseResponse.status()).toBe(400);
  });
});
