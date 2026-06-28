// @vitest-environment node
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateDatabase } from '@megumi/coding-agent/persistence/schema/migrations';
import { ModelStepRepository, type ModelStepRecord } from '@megumi/coding-agent/persistence/repos/model-step.repo';
import { RunExecutionFactRepository } from '@megumi/coding-agent/persistence/repos/run-execution-fact.repo';
import { RunRecordRepository } from '@megumi/coding-agent/persistence/repos/run-record.repo';
import { SessionRecordRepository } from '@megumi/coding-agent/persistence/repos/session-record.repo';

let db: Database.Database | null = null;

function createRepositories(): {
  modelStepRepository: ModelStepRepository;
  runExecutionFactRepository: RunExecutionFactRepository;
  runRecordRepository: RunRecordRepository;
  sessionRecordRepository: SessionRecordRepository;
} {
  db = new Database(':memory:');
  migrateDatabase(db);
  return {
    modelStepRepository: new ModelStepRepository(db),
    runExecutionFactRepository: new RunExecutionFactRepository(db),
    runRecordRepository: new RunRecordRepository(db),
    sessionRecordRepository: new SessionRecordRepository(db),
  };
}

afterEach(() => {
  db?.close();
  db = null;
});

describe('ModelStepRepository', () => {
  it('saves, updates, and reads model step records', () => {
    const {
      modelStepRepository,
      runExecutionFactRepository,
      runRecordRepository,
      sessionRecordRepository,
    } = createRepositories();
    sessionRecordRepository.saveSession({
      sessionId: 'session-1',
      title: 'Lifecycle',
      status: 'active',
      createdAt: '2026-05-15T00:00:00.000Z',
      updatedAt: '2026-05-15T00:00:00.000Z',
    });
    runRecordRepository.saveRun({
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
      status: 'running',
      startedAt: '2026-05-15T00:00:02.000Z',
    });

    const record: ModelStepRecord = {
      modelStepId: 'model-step-1',
      runId: 'run-1',
      stepId: 'step-1',
      providerId: 'openai-compatible',
      modelId: 'gpt-5',
      status: 'running',
      startedAt: '2026-05-15T00:00:02.000Z',
      metadata: { requestKind: 'chat' },
    };

    expect(modelStepRepository.saveModelStep(record)).toEqual(record);
    expect(modelStepRepository.getModelStep('model-step-1')).toEqual(record);

    const completed: ModelStepRecord = {
      ...record,
      status: 'succeeded',
      completedAt: '2026-05-15T00:00:03.000Z',
      metadata: { requestKind: 'chat', finishReason: 'stop' },
    };

    expect(modelStepRepository.saveModelStep(completed)).toEqual(completed);
    expect(modelStepRepository.getModelStep('model-step-1')).toEqual(completed);
    expect(modelStepRepository.getModelStep('missing-model-step')).toBeUndefined();
  });
});
