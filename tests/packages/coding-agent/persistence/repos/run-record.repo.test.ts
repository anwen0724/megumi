// @vitest-environment node
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateDatabase } from '@megumi/coding-agent/persistence/schema/migrations';
import { RunRecordRepository } from '@megumi/coding-agent/persistence/repos/run-record.repo';
import { SessionRecordRepository } from '@megumi/coding-agent/persistence/repos/session-record.repo';

let db: Database.Database | null = null;

function createRepositories(): {
  runRecordRepository: RunRecordRepository;
  sessionRecordRepository: SessionRecordRepository;
} {
  db = new Database(':memory:');
  migrateDatabase(db);
  return {
    runRecordRepository: new RunRecordRepository(db),
    sessionRecordRepository: new SessionRecordRepository(db),
  };
}

afterEach(() => {
  db?.close();
  db = null;
});

describe('RunRecordRepository', () => {
  it('saves, updates, gets, lists by session, and lists by statuses', () => {
    const { runRecordRepository, sessionRecordRepository } = createRepositories();
    sessionRecordRepository.saveSession({
      sessionId: 'session-1',
      title: 'Session',
      status: 'active',
      createdAt: '2026-05-15T00:00:00.000Z',
      updatedAt: '2026-05-15T00:00:00.000Z',
    });

    runRecordRepository.saveRun({
      runId: 'run-2',
      sessionId: 'session-1',
      mode: 'plan',
      goal: 'Second',
      status: 'running',
      createdAt: '2026-05-15T00:00:02.000Z',
      startedAt: '2026-05-15T00:00:03.000Z',
      metadata: { attempt: 2 },
    });
    runRecordRepository.saveRun({
      runId: 'run-1',
      sessionId: 'session-1',
      mode: 'default',
      goal: 'First',
      status: 'running',
      createdAt: '2026-05-15T00:00:01.000Z',
    });

    const updated = runRecordRepository.saveRun({
      runId: 'run-1',
      sessionId: 'session-1',
      mode: 'default',
      goal: 'First updated',
      status: 'failed',
      createdAt: '2026-05-15T00:00:01.000Z',
      startedAt: '2026-05-15T00:00:01.500Z',
      completedAt: '2026-05-15T00:00:04.000Z',
      error: { code: 'runtime_unknown', message: 'failed', severity: 'error', retryable: false, source: 'unknown' },
      sourcePlanId: 'plan-1',
      policySnapshotRef: 'policy-1',
    });

    expect(runRecordRepository.getRun('run-1')).toEqual(updated);
    expect(runRecordRepository.getRun('missing-run')).toBeUndefined();
    expect(runRecordRepository.listRunsBySession('session-1')).toEqual([
      updated,
      expect.objectContaining({ runId: 'run-2', metadata: { attempt: 2 } }),
    ]);
    expect(runRecordRepository.listRunsByStatuses(['running']).map((run) => run.runId)).toEqual(['run-2']);
    expect(runRecordRepository.listRunsByStatuses(['failed', 'running']).map((run) => run.runId)).toEqual([
      'run-1',
      'run-2',
    ]);
    expect(runRecordRepository.listRunsByStatuses([])).toEqual([]);
  });
});
