/* Defines renderer-safe Memory request, response, and change-event contracts. */
import { z } from 'zod';
import type { MemoryHost, MemoryFailure } from './contracts';

const Collection = z.enum(['summary', 'memory', 'rollouts', 'skills', 'raw']);
export const MemorySearchSchema = z
  .object({
    terms: z.array(z.string().trim().min(1).max(128)).min(1).max(5),
    collections: z.array(Collection).min(1).max(5).optional(),
    match: z.enum(['any', 'all']).optional(),
    limit: z.number().int().min(1).max(50).optional(),
    cursor: z.string().max(4096).optional(),
  })
  .strict();
export const MemoryReadSchema = z
  .object({
    path: z.string().min(1),
    startLine: z.number().int().positive().optional(),
    lineCount: z.number().int().min(1).max(400).optional(),
    startCharacter: z.number().int().nonnegative().optional(),
    expectedVersion: z.string().optional(),
  })
  .strict();
export const MemorySourceSchema = z
  .object({
    sourceRef: z.string().min(1).max(4096),
    cursor: z.string().max(4096).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict();
export type MemorySearchRequest = z.infer<typeof MemorySearchSchema>;
export type MemoryReadRequest = z.infer<typeof MemoryReadSchema>;
export type MemorySourceRequest = z.infer<typeof MemorySourceSchema>;

const Id = z.string().min(1).max(200);
const ErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
});
const NotFound = z.object({ status: z.literal('notFound') });
const Page = z
  .object({
    cursor: z.string().max(4096).optional(),
    limit: z.number().int().min(1).max(200).optional(),
  })
  .strict();
const Selection = z.object({
  providerId: z.string(),
  modelId: z.string(),
});
const Capability = z.discriminatedUnion('status', [
  z.object({ status: z.literal('unconfigured') }),
  z.object({
    status: z.literal('configured'),
    selection: Selection,
  }),
  z.object({
    status: z.literal('unavailable'),
    selection: Selection,
    message: z.string(),
  }),
]);
const DocumentSlice = z.object({
  path: z.string(),
  version: z.string(),
  content: z.string(),
  startLine: z.number(),
  nextLine: z.number(),
  truncated: z.boolean(),
  lastLineComplete: z.boolean().optional(),
  firstLineComplete: z.boolean().optional(),
  nextCharacter: z.number().int().nonnegative().optional(),
});
const DocumentEntry = z.object({
  path: z.string(),
  version: z.string(),
  readOnly: z.boolean(),
});
const Started = z.union([
  z.object({
    status: z.enum(['started', 'reused']),
    runId: z.string(),
  }),
  z.object({
    status: z.literal('skipped'),
    reason: z.enum(['disabled', 'stopped']),
  }),
]);
export const MemoryRunSchema = z.object({
  runId: z.string(),
  status: z.enum(['pending', 'running', 'completed', 'failed', 'cancelled']),
  kind: z.string(),
  createdAt: z.string(),
  completedAt: z.string().optional(),
  result: z
    .object({
      result: z.enum(['generated', 'unchanged', 'empty', 'partial']).optional(),
      extractionRunId: z.string().optional(),
      error: ErrorSchema.optional(),
    })
    .optional(),
  jobs: z.array(
    z.object({
      jobId: z.string(),
      stage: z.enum(['extract', 'consolidate']),
      status: z.enum(['pending', 'running', 'succeeded', 'failed', 'cancelled', 'superseded']),
      attempt: z.number(),
      retryGroupId: z.string(),
      retryOfJobId: z.string().optional(),
      retryAt: z.string().optional(),
      sourceId: z.string().optional(),
      sourceVersion: z.string().optional(),
      targetRevision: z.number().optional(),
      error: ErrorSchema.optional(),
      result: z
        .object({
          coverage: z
            .object({
              includedMessageIds: z.array(z.string()),
              omittedMessageIds: z.array(z.string()),
              truncated: z.boolean(),
              estimatedInputTokens: z.number(),
              inputBudgetTokens: z.number(),
            })
            .optional(),
          versions: z.record(z.string(), z.string()).optional(),
          inputTokens: z.number().optional(),
          outputTokens: z.number().optional(),
          modelCalls: z.number().optional(),
          durationMs: z.number().optional(),
        })
        .optional(),
    }),
  ),
});
export const MemoryChangedSchema = z
  .object({
    processInstanceId: z.string().min(1),
    sequence: z.number().int().positive(),
    revision: z.number().int().nonnegative(),
    runId: z.string().min(1).optional(),
  })
  .strict();
export type MemoryChanged = z.infer<typeof MemoryChangedSchema>;

export const MemoryRequestSchemas = {
  getStatus: z.object({}).strict(),
  startGeneration: z
    .object({
      requestId: Id,
      reason: z.enum(['startup', 'manual', 'retry']),
      failedJobId: Id.optional(),
      triggerSessionId: Id.optional(),
    })
    .strict(),
  getRun: z.object({ runId: Id }).strict(),
  cancelRun: z
    .object({
      requestId: Id,
      runId: Id,
    })
    .strict(),
  listDocuments: Page,
  readDocument: MemoryReadSchema,
  searchDocuments: MemorySearchSchema,
  updateDocument: z
    .object({
      requestId: Id,
      path: z.string().min(1),
      content: z.string().max(1048576),
      expectedVersion: z.string().min(1),
    })
    .strict(),
  listSources: Page,
  readSource: MemorySourceSchema,
  setSourceEligibility: z
    .object({
      requestId: Id,
      sessionId: Id,
      eligibility: z.enum(['eligible', 'excluded']),
      expectedVersion: z.number().int().nonnegative(),
    })
    .strict(),
  clearMemory: z
    .object({
      requestId: Id,
      confirmed: z.literal(true),
    })
    .strict(),
};
export const MemoryResponseSchemas = {
  getStatus: z.object({
    status: z.literal('ok'),
    memory: z.object({
      generateMemories: z.boolean(),
      useMemories: z.boolean(),
      extractModel: Capability,
      consolidationModel: Capability,
      artifactState: z.enum(['empty', 'ready', 'updating', 'needsRepair', 'clearing']),
      dirty: z.boolean(),
      dirtyRevision: z.number(),
      processedRevision: z.number(),
      successfulSnapshotId: z.string().optional(),
      sourceCount: z.number(),
      recentRuns: z.array(MemoryRunSchema),
    }),
  }),
  startGeneration: Started,
  getRun: z.union([MemoryRunSchema, NotFound]),
  cancelRun: z.object({ status: z.enum(['cancelling', 'alreadyFinished', 'notFound']) }),
  listDocuments: z.object({
    status: z.literal('ok'),
    documents: z.array(DocumentEntry),
    nextCursor: z.string().optional(),
  }),
  readDocument: z.union([
    z.object({
      status: z.literal('found'),
      document: DocumentSlice,
    }),
    NotFound,
  ]),
  searchDocuments: z.object({
    status: z.literal('ok'),
    hits: z.array(DocumentSlice.extend({ line: z.number() })),
    nextCursor: z.string().optional(),
  }),
  updateDocument: z.object({
    status: z.literal('saved'),
    document: DocumentEntry.extend({ content: z.string() }),
  }),
  listSources: z.object({
    status: z.literal('ok'),
    sources: z.array(
      z.object({
        sessionId: z.string(),
        title: z.string(),
        workspaceId: z.string(),
        contentUpdatedAt: z.string(),
        sourceRef: z.string().optional(),
        eligibility: z.enum(['eligible', 'excluded']),
        version: z.number(),
        usageCount: z.number(),
        lastUsedAt: z.string().optional(),
        selected: z.boolean(),
        extractionVersion: z.string().optional(),
      }),
    ),
    nextCursor: z.string().optional(),
  }),
  readSource: z.union([
    z.object({
      status: z.literal('found'),
      sessionId: z.string(),
      workspaceId: z.string(),
      sourceVersion: z.string(),
      sourceChanged: z.boolean(),
      messages: z.array(
        z.object({
          messageId: z.string(),
          kind: z.string(),
          text: z.string(),
          characterOffset: z.number(),
          truncated: z.boolean(),
        }),
      ),
      nextCursor: z.string().optional(),
    }),
    NotFound,
  ]),
  setSourceEligibility: z.object({
    status: z.literal('saved'),
    version: z.number(),
    maintenance: z.enum(['pending', 'pendingModel', 'notRequired']),
    runId: z.string().optional(),
  }),
  clearMemory: Started,
} satisfies {
  [K in keyof typeof MemoryRequestSchemas]: z.ZodType<
    K extends 'getRun'
      ? NonNullable<ReturnType<MemoryHost[K]>> | { status: 'notFound' }
      : Exclude<ReturnType<MemoryHost[K]>, MemoryFailure>
  >;
};
export type MemoryOperation = keyof typeof MemoryRequestSchemas;
export type MemoryRequest<K extends MemoryOperation> = z.infer<(typeof MemoryRequestSchemas)[K]>;
export type MemoryResponse<K extends MemoryOperation> = z.infer<(typeof MemoryResponseSchemas)[K]>;
