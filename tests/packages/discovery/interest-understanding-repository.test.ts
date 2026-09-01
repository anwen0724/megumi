/* Verifies Interest Understanding receipts and terminal results are durable Owner facts. */
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase, migrateDatabase, type DatabaseConnection } from '@megumi/database';
import { createDiscoveryRepository } from '@megumi/discovery';

describe('Interest Understanding repository', () => {
  let database: DatabaseConnection | undefined;
  afterEach(() => database?.close());

  it('persists a receipt and its no-durable-evidence terminal result', () => {
    database = createDatabase({ filename: ':memory:' });
    migrateDatabase({ database });
    const repository = createDiscoveryRepository({ database });
    const queued = repository.createInterestUnderstanding({
      interestUnderstandingId: 'interest-understanding:1',
      executionId: 'execution:1',
      sessionId: 'session:1',
      userMessageId: 'message:user:1',
      assistantMessageId: 'message:assistant:1',
      status: 'queued',
      queuedAt: '2026-01-01T00:00:00.000Z',
    });
    repository.updateInterestUnderstanding({
      ...queued,
      status: 'completed',
      outcome: 'no_durable_evidence',
      changedInterestIds: [],
      evidenceIds: [],
      startedAt: '2026-01-01T00:00:01.000Z',
      completedAt: '2026-01-01T00:00:02.000Z',
    });
    expect(repository.findInterestUnderstandingByExecution('execution:1')).toMatchObject({
      interestUnderstandingId: 'interest-understanding:1',
      status: 'completed',
      outcome: 'no_durable_evidence',
    });
  });
});

