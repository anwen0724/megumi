// @vitest-environment node
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateDatabase } from '@megumi/coding-agent/persistence/schema/migrations';
import { ModelStepRepository, type ModelStepRecord } from '@megumi/coding-agent/persistence/repos/model-step.repo';
import { SessionRunRepository } from '@megumi/coding-agent/persistence/repos/session-run.repo';

let db: Database.Database | null = null;

function createRepositories(): {
  modelStepRepository: ModelStepRepository;
  sessionRunRepository: SessionRunRepository;
} {
  db = new Database(':memory:');
  migrateDatabase(db);
  return {
    modelStepRepository: new ModelStepRepository(db),
    sessionRunRepository: new SessionRunRepository(db),
  };
}

afterEach(() => {
  db?.close();
  db = null;
});

describe('ModelStepRepository', () => {
  it('saves, updates, and reads model step records', () => {
    const { modelStepRepository, sessionRunRepository } = createRepositories();
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
    sessionRunRepository.saveStep({
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
