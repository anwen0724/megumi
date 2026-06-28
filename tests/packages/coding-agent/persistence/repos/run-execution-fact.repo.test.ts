// @vitest-environment node
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateDatabase } from '@megumi/coding-agent/persistence/schema/migrations';
import { RunExecutionFactRepository } from '@megumi/coding-agent/persistence/repos/run-execution-fact.repo';
import { SessionRunRepository } from '@megumi/coding-agent/persistence/repos/session-run.repo';

let db: Database.Database | null = null;

function createRepositories(): {
  runExecutionFactRepository: RunExecutionFactRepository;
  sessionRunRepository: SessionRunRepository;
} {
  db = new Database(':memory:');
  migrateDatabase(db);
  return {
    runExecutionFactRepository: new RunExecutionFactRepository(db),
    sessionRunRepository: new SessionRunRepository(db),
  };
}

afterEach(() => {
  db?.close();
  db = null;
});

describe('RunExecutionFactRepository', () => {
  it('saves and lists run steps, actions, and observations by run', () => {
    const { runExecutionFactRepository, sessionRunRepository } = createRepositories();
    sessionRunRepository.saveSession({
      sessionId: 'session-1',
      title: 'Lifecycle',
      status: 'active',
      createdAt: '2026-05-15T00:00:00.000Z',
      updatedAt: '2026-05-15T00:00:00.000Z',
    });
    sessionRunRepository.saveRun({
      runId: 'run-1',
      sessionId: 'session-1',
      mode: 'chat',
      goal: 'Answer',
      status: 'running',
      createdAt: '2026-05-15T00:00:01.000Z',
    });

    runExecutionFactRepository.saveStep({
      stepId: 'step-1',
      runId: 'run-1',
      kind: 'model',
      status: 'pending',
      metadata: { attempt: 1 },
    });
    runExecutionFactRepository.saveAction({
      actionId: 'action-1',
      runId: 'run-1',
      stepId: 'step-1',
      kind: 'emit_message',
      status: 'requested',
      requestedAt: '2026-05-15T00:00:02.000Z',
      inputPreview: { text: 'hello' },
    });
    runExecutionFactRepository.saveObservation({
      observationId: 'observation-1',
      runId: 'run-1',
      stepId: 'step-1',
      actionId: 'action-1',
      source: 'runtime',
      kind: 'message_emitted',
      receivedAt: '2026-05-15T00:00:03.000Z',
      summary: 'Message emitted',
      metadata: { stream: true },
    });

    expect(runExecutionFactRepository.listStepsByRun('run-1')).toEqual([
      expect.objectContaining({ stepId: 'step-1', kind: 'model', metadata: { attempt: 1 } }),
    ]);
    expect(runExecutionFactRepository.listActionsByRun('run-1')).toEqual([
      expect.objectContaining({ actionId: 'action-1', inputPreview: { text: 'hello' } }),
    ]);
    expect(runExecutionFactRepository.listObservationsByRun('run-1')).toEqual([
      expect.objectContaining({ observationId: 'observation-1', summary: 'Message emitted', metadata: { stream: true } }),
    ]);
  });
});
