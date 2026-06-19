// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  openSqliteDatabase,
  runDatabaseMigrations,
  SqliteRecoveryRepository,
  SqliteSessionStateRepository,
} from '../../../src/database';
import { createSessionStateManager } from '../../../src/session';

function createId(prefix: string, value: string): string {
  return `${prefix}-${value}`;
}

describe('SqliteRecoveryRepository', () => {
  it('stores cancel and retry requests and lists recoverable runs from session run facts', () => {
    const database = openSqliteDatabase(':memory:');
    runDatabaseMigrations(database, { now: () => '2026-06-20T00:00:00.000Z' });
    const sessionRepository = new SqliteSessionStateRepository(database);
    const sessions = createSessionStateManager({
      repository: sessionRepository,
      now: () => '2026-06-20T00:00:00.000Z',
      createId,
    });
    const recovery = new SqliteRecoveryRepository(database, sessionRepository);

    sessions.createSession({ idSeed: '1', title: 'Broken run', workspaceId: 'workspace-1' });
    const { run } = sessions.recordRun({
      idSeed: '1',
      sourceEntryIdSeed: 'run-1',
      sessionId: 'session-1',
      inputSummary: 'fix bug',
      status: 'running',
    });
    sessions.updateRunStatus({
      runId: run.id,
      status: 'failed',
      endedAt: '2026-06-20T00:01:00.000Z',
      error: { code: 'agent_failed', message: 'Agent failed.' },
    });

    const cancel = recovery.saveCancelRequest({
      cancelRequestId: 'cancel-1',
      runId: run.id,
      sessionId: 'session-1',
      workspaceId: 'workspace-1',
      reason: 'user_requested',
      createdAt: '2026-06-20T00:02:00.000Z',
    });
    const retry = recovery.saveRetryRequest({
      retryRequestId: 'retry-1',
      runId: run.id,
      sessionId: 'session-1',
      workspaceId: 'workspace-1',
      retryKind: 'manual_retry',
      reason: 'failed',
      createdAt: '2026-06-20T00:03:00.000Z',
    });

    expect(recovery.listCancelRequestsByRun(run.id)).toEqual([cancel]);
    expect(recovery.listRetryRequestsByRun(run.id)).toEqual([retry]);
    expect(recovery.listRecoverableRuns()).toEqual([
      expect.objectContaining({
        runId: run.id,
        sessionId: 'session-1',
        status: 'failed',
        reason: 'failed',
        title: 'Broken run',
        preview: 'fix bug',
      }),
    ]);
    database.close();
  });
});
