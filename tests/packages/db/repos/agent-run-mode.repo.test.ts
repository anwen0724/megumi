import { describe, expect, it } from 'vitest';
import { createDatabase } from '@megumi/db/connection';
import { migrateDatabase } from '@megumi/db/schema/migrations';
import { AgentLifecycleRepository } from '@megumi/db/repos/agent-lifecycle.repo';
import { AgentRunModeRepository } from '@megumi/db/repos/agent-run-mode.repo';
import { RUN_MODE_PRESET_DEFAULTS } from '@megumi/shared/agent-run-mode-contracts';

function createTestDatabase() {
  const database = createDatabase(':memory:');
  migrateDatabase(database);
  return database;
}

function seedRun(database: ReturnType<typeof createTestDatabase>, runId = 'run:1') {
  const lifecycle = new AgentLifecycleRepository(database);
  lifecycle.saveSession({
    sessionId: 'session:1',
    title: 'Session',
    status: 'active',
    createdAt: '2026-05-15T00:00:00.000Z',
    updatedAt: '2026-05-15T00:00:00.000Z',
  });
  lifecycle.saveRun({
    runId,
    sessionId: 'session:1',
    mode: 'plan',
    goal: 'Write a plan',
    status: 'queued',
    createdAt: '2026-05-15T00:00:00.000Z',
  });
}

describe('AgentRunModeRepository', () => {
  it('saves and loads a mode snapshot by run id', () => {
    const database = createTestDatabase();
    seedRun(database);
    const repo = new AgentRunModeRepository(database);

    repo.saveModeSnapshot({
      modeSnapshotId: 'mode-snapshot:1',
      runId: 'run:1',
      modeLabel: 'plan',
      mode: RUN_MODE_PRESET_DEFAULTS.plan,
      createdAt: '2026-05-15T00:00:00.000Z',
      metadata: { source: 'test' },
    });

    expect(repo.getModeSnapshotByRun('run:1')).toEqual({
      modeSnapshotId: 'mode-snapshot:1',
      runId: 'run:1',
      modeLabel: 'plan',
      mode: RUN_MODE_PRESET_DEFAULTS.plan,
      createdAt: '2026-05-15T00:00:00.000Z',
      metadata: { source: 'test' },
    });
  });

  it('saves plan-specific artifact status without content storage', () => {
    const database = createTestDatabase();
    seedRun(database);
    const repo = new AgentRunModeRepository(database);

    repo.saveImplementationPlan({
      planArtifactId: 'plan:1',
      producingRunId: 'run:1',
      title: 'Plan',
      status: 'proposed',
      createdAt: '2026-05-15T00:00:00.000Z',
      updatedAt: '2026-05-15T00:00:00.000Z',
      metadata: { summary: 'metadata only' },
    });

    const plan = repo.getImplementationPlan('plan:1');

    expect(plan?.status).toBe('proposed');
    expect(plan?.metadata).toEqual({ summary: 'metadata only' });
    expect(JSON.stringify(plan)).not.toContain('content');
  });

  it('updates plan status and preserves accepted timestamp', () => {
    const database = createTestDatabase();
    seedRun(database);
    const repo = new AgentRunModeRepository(database);

    repo.saveImplementationPlan({
      planArtifactId: 'plan:1',
      producingRunId: 'run:1',
      title: 'Plan',
      status: 'proposed',
      createdAt: '2026-05-15T00:00:00.000Z',
      updatedAt: '2026-05-15T00:00:00.000Z',
    });

    const updated = repo.updateImplementationPlanStatus({
      planArtifactId: 'plan:1',
      status: 'accepted',
      updatedAt: '2026-05-15T00:00:01.000Z',
    });

    expect(updated?.status).toBe('accepted');
    expect(updated?.acceptedAt).toBe('2026-05-15T00:00:01.000Z');
  });

  it('saves source plan relation for execute runs', () => {
    const database = createTestDatabase();
    seedRun(database, 'run:plan');
    seedRun(database, 'run:execute');
    const repo = new AgentRunModeRepository(database);

    repo.saveImplementationPlan({
      planArtifactId: 'plan:1',
      producingRunId: 'run:plan',
      title: 'Plan',
      status: 'accepted',
      createdAt: '2026-05-15T00:00:00.000Z',
      updatedAt: '2026-05-15T00:00:00.000Z',
      acceptedAt: '2026-05-15T00:00:00.000Z',
    });
    repo.saveSourcePlanRelation({
      runId: 'run:execute',
      sourcePlanId: 'plan:1',
      linkedAt: '2026-05-15T00:00:02.000Z',
    });

    expect(repo.getSourcePlanRelation('run:execute')?.sourcePlanId).toBe('plan:1');
    expect(repo.listRunsBySourcePlan('plan:1').map((item) => item.runId)).toEqual(['run:execute']);
  });
});
