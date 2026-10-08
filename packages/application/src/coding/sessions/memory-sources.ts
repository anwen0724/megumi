/* Captures original conversation branches in one database read transaction. */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  DatabaseConnectionClosedError,
  DatabaseStatementError,
  DatabaseTransactionError,
} from '../../storage/index';
import type {
  MemorySources,
  MemorySourceSnapshot,
  MemorySourceResult,
} from '../../memory/source-contracts';
import { buildActiveConversationPath } from './session-branches';
import type { SessionStore } from './session-storage';

const SourceReference = z
  .object({
    sessionId: z.string().min(1),
    workspaceId: z.string().min(1),
    branchId: z.string().min(1).optional(),
    firstMessageId: z.string().optional(),
    lastMessageId: z.string().optional(),
    sourceVersion: z.string().regex(/^[a-f0-9]{64}$/),
    contentUpdatedAt: z.string().min(1),
  })
  .strict();

export function createMemorySources(options: {
  readonly store: SessionStore;
  readonly isSessionRunning: (sessionId: string) => boolean;
}): MemorySources {
  const { store } = options;

  function snapshot(
    sessionId: string,
    branch?: { branchId?: string },
  ): MemorySourceSnapshot | undefined {
    const metadata = store.listSourceSessions({ sessionId })[0];
    if (!metadata) return undefined;

    const session = metadata.session;
    const entries = buildActiveConversationPath({
      session_id: sessionId,
      active_entry_id: branch ? branch.branchId : session.active_entry_id,
      entries: store.listEntriesBySessionId(sessionId),
      compactions: store
        .listCompactionsBySessionId(sessionId)
        .flatMap(record => (record.summary ? [record.summary] : [])),
    });
    const messages = entries.map(entry => {
      const message = entry.message_id ? store.findMessageById(entry.message_id) : undefined;
      if (!message || message.session_id !== sessionId)
        throw new Error('Original source message is unavailable.');

      return message;
    });
    const attachments = store
      .listAttachmentsByMessageIds(messages.map(message => message.message_id))
      .sort((left, right) => left.attachment_id.localeCompare(right.attachment_id));
    const branchId = entries.at(-1)?.entry_id;
    const identity = {
      sessionId,
      workspaceId: session.workspace_id,
      branchId,
    };
    const sourceVersion = createHash('sha256')
      .update(
        JSON.stringify({
          ...identity,
          messages,
          attachments,
        }),
      )
      .digest('hex');
    const reference = {
      ...identity,
      firstMessageId: messages[0]?.message_id,
      lastMessageId: messages.at(-1)?.message_id,
      sourceVersion,
      contentUpdatedAt: metadata.contentUpdatedAt,
    };

    return {
      ...identity,
      sourceVersion,
      sourceRef: `session:v1:${Buffer.from(JSON.stringify(reference)).toString('base64url')}`,
      contentUpdatedAt: metadata.contentUpdatedAt,
      messages,
      attachments,
    };
  }

  function read(operation: () => MemorySourceResult): MemorySourceResult {
    try {
      return store.runInTransaction(operation);
    } catch (error) {
      const storageFailed =
        error instanceof DatabaseConnectionClosedError ||
        error instanceof DatabaseStatementError ||
        error instanceof DatabaseTransactionError;
      return {
        status: 'failed',
        error: {
          code: storageFailed ? 'STORAGE_FAILED' : 'SOURCE_UNAVAILABLE',
          message: error instanceof Error ? error.message : 'Source could not be read.',
        },
      };
    }
  }

  return {
    listSources: request =>
      store.listSourceSessions(request).map(({ session, contentUpdatedAt }) => ({
        kind: 'conversation' as const,
        sessionId: session.session_id,
        workspaceId: session.workspace_id,
        title: session.title,
        archived: session.status === 'archived',
        running: options.isSessionRunning(session.session_id),
        contentUpdatedAt,
      })),
    readSnapshot: sessionId =>
      read(() => {
        const source = snapshot(sessionId);
        return source
          ? {
              status: 'found',
              snapshot: source,
              sourceChanged: false,
            }
          : { status: 'notFound' };
      }),
    readSource: sourceRef => {
      let reference: z.infer<typeof SourceReference>;
      try {
        if (!sourceRef.startsWith('session:v1:') || sourceRef.length > 4096)
          throw new Error('Invalid reference.');

        reference = SourceReference.parse(
          JSON.parse(Buffer.from(sourceRef.slice(11), 'base64url').toString('utf8')),
        );
      } catch {
        return {
          status: 'failed',
          error: {
            code: 'INVALID_ARGUMENT',
            message: 'Invalid source reference.',
          },
        };
      }

      return read(() => {
        if (!store.findSessionById(reference.sessionId)) return { status: 'notFound' };
        if (reference.branchId && !store.findEntryById(reference.branchId))
          return { status: 'notFound' };

        const original = snapshot(reference.sessionId, reference);
        if (!original) return { status: 'notFound' };
        if (
          original.workspaceId !== reference.workspaceId ||
          original.messages[0]?.message_id !== reference.firstMessageId ||
          original.messages.at(-1)?.message_id !== reference.lastMessageId ||
          original.sourceVersion !== reference.sourceVersion
        ) {
          return {
            status: 'failed',
            error: {
              code: 'SOURCE_UNAVAILABLE',
              message: 'Referenced source content is no longer available.',
            },
          };
        }

        return {
          status: 'found',
          snapshot: {
            ...original,
            sourceRef,
            contentUpdatedAt: reference.contentUpdatedAt,
          },
          sourceChanged: snapshot(reference.sessionId)?.sourceVersion !== reference.sourceVersion,
        };
      });
    },
    getReplyCursor: () => store.getReplyCursor(),
    listReplies: request => {
      const valid = z
        .object({
          afterCursor: z.number().int().nonnegative(),
          limit: z.number().int().min(1).max(200),
        })
        .parse(request);
      return store.listRepliesAfter(valid.afterCursor, valid.limit);
    },
  };
}
