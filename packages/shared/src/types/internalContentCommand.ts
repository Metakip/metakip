import { z } from 'zod';
import { MAX_YDOC_BYTES } from '../constants/collaboration.js';
import { fitsPageMarkdownSize } from '../utils/pageMarkdownSize.js';

export const INTERNAL_CONTENT_HEADERS = {
  secret: 'x-metakip-internal-secret',
  userId: 'x-metakip-user-id',
  requestId: 'x-metakip-request-id',
  tokenId: 'x-metakip-token-id',
  idempotencyPrincipal: 'x-metakip-idempotency-principal',
} as const;

export const MAX_EXACT_EDITS = 100;
export const MAX_CONTENT_BOUNDARY_OPERATION_ID_LENGTH = 200;
export const MAX_EXACT_EDIT_REPLACEMENT_BYTES = MAX_YDOC_BYTES;
/** Maximum cumulative Markdown bytes parsed while validating one exact-edit command. */
export const MAX_EXACT_EDIT_VALIDATION_BYTES = MAX_YDOC_BYTES * 4;
export const MAX_INTERNAL_CONTENT_COMMAND_BYTES = MAX_YDOC_BYTES * 2 + 64 * 1024;

export type InternalContentPrincipal = {
  userId: string;
  requestId: string;
  tokenId: string | null;
  idempotencyPrincipal: string;
};

export type ApiTokenAuditOperation =
  | 'page.create'
  | 'page.update'
  | 'page.lifecycle'
  | 'folder.lifecycle'
  | 'trash.lifecycle'
  | 'import.lifecycle'
  | 'image.upload'
  | 'page.content.edit'
  | 'page.content.replace';
export type ApiTokenAuditResult = 'success' | 'conflict';
export type ContentAuditOperation = Extract<
  ApiTokenAuditOperation,
  'page.content.edit' | 'page.content.replace'
>;

export const exactEditSchema = z.object({
  id: z.string().refine((value) => value.trim().length > 0, 'Edit ID must not be empty'),
  oldText: z.string(),
  newText: z.string(),
});

function validateExactEdits(
  request: { edits: Array<z.infer<typeof exactEditSchema>> },
  context: z.RefinementCtx,
): void {
  const ids = new Set<string>();
  let replacementBytes = 0;
  request.edits.forEach((edit, index) => {
    if (ids.has(edit.id)) {
      context.addIssue({
        code: 'custom',
        path: ['edits', index, 'id'],
        message: 'Edit IDs must be unique',
      });
    }
    ids.add(edit.id);
    replacementBytes += new TextEncoder().encode(edit.newText).byteLength;
  });
  if (replacementBytes > MAX_EXACT_EDIT_REPLACEMENT_BYTES) {
    context.addIssue({
      code: 'custom',
      path: ['edits'],
      message: `Replacement text must be ${MAX_EXACT_EDIT_REPLACEMENT_BYTES} bytes or less`,
    });
  }
}

const exactEditsShape = {
  edits: z.array(exactEditSchema).min(1).max(MAX_EXACT_EDITS),
};

export const exactEditsRequestSchema = z
  .object(exactEditsShape)
  .superRefine(validateExactEdits)
  .meta({
    example: {
      edits: [{ id: 'rename-heading', oldText: '# Draft', newText: '# Notes' }],
    },
  });

export const contentIdempotencyReservationSchema = z.object({
  recordId: z.uuid(),
  key: z.string().min(1).max(200),
  requestHash: z.string().min(1),
});

export const applyExactEditsCommandSchema = z
  .object({
    ...exactEditsShape,
    idempotency: contentIdempotencyReservationSchema.optional(),
  })
  .superRefine(validateExactEdits);

export const contentBoundaryOperationSchema = z
  .object({
    id: z
      .string()
      .max(
        MAX_CONTENT_BOUNDARY_OPERATION_ID_LENGTH,
        `Operation ID must be ${MAX_CONTENT_BOUNDARY_OPERATION_ID_LENGTH} characters or less`,
      )
      .refine((value) => value.trim().length > 0, 'Operation ID must not be empty'),
    operation: z.enum(['append', 'prepend']),
    content: z
      .string()
      .min(1, 'Content must not be empty')
      .refine(fitsPageMarkdownSize, `Content must be ${MAX_YDOC_BYTES} bytes or less`),
  })
  .meta({
    example: {
      id: 'append-summary',
      operation: 'append',
      content: '\n\n## Summary\n',
    },
  });

export const applyContentBoundaryOperationCommandSchema = z.object({
  ...contentBoundaryOperationSchema.shape,
  idempotency: contentIdempotencyReservationSchema.optional(),
});

export const exactEditCommandResultSchema = z.discriminatedUnion('status', [
  z.object({ id: z.string().min(1), status: z.literal('applied') }),
  z.object({ id: z.string().min(1), status: z.literal('conflict'), reason: z.string() }),
  z.object({ id: z.string().min(1), status: z.literal('invalid'), reason: z.string() }),
]);

export const exactEditCommandResponseSchema = z.object({
  results: z.array(exactEditCommandResultSchema),
  etag: z.string().min(1),
});

export const contentBoundaryOperationResponseSchema = z.object({
  id: z.string().min(1).max(MAX_CONTENT_BOUNDARY_OPERATION_ID_LENGTH),
  etag: z.string().min(1),
});

export const readPageMarkdownCommandResponseSchema = z.object({
  markdown: z.string(),
  etag: z.string().min(1),
});

export const replacePageMarkdownCommandResponseSchema = z.object({ etag: z.string().min(1) });

export const internalContentErrorResponseSchema = z.object({
  message: z.string().min(1),
  etag: z.string().min(1).optional(),
  code: z.string().min(1).optional(),
  retryAfterSeconds: z.number().int().nonnegative().optional(),
});

export type ExactEditCommandResult = z.infer<typeof exactEditCommandResultSchema>;
export type ExactEditCommandResponse = z.infer<typeof exactEditCommandResponseSchema>;
export type ContentIdempotencyReservation = z.infer<typeof contentIdempotencyReservationSchema>;
export type ReadPageMarkdownCommandResponse = z.infer<typeof readPageMarkdownCommandResponseSchema>;
export type ReplacePageMarkdownCommandResponse = z.infer<
  typeof replacePageMarkdownCommandResponseSchema
>;
export type ApplyExactEditsCommand = z.infer<typeof applyExactEditsCommandSchema>;
export type ContentBoundaryOperation = z.infer<typeof contentBoundaryOperationSchema>;
export type ApplyContentBoundaryOperationCommand = z.infer<
  typeof applyContentBoundaryOperationCommandSchema
>;
export type ContentBoundaryOperationResponse = z.infer<
  typeof contentBoundaryOperationResponseSchema
>;
