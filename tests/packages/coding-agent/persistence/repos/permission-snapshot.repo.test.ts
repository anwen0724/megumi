import { describe, expect, it } from 'vitest';
import { createDatabase } from '@megumi/coding-agent/persistence/connection';
import { migrateDatabase } from '@megumi/coding-agent/persistence/schema/migrations';
import { PermissionSnapshotRepository } from '@megumi/coding-agent/persistence/repos/permission-snapshot.repo';
import { RunRecordRepository } from '@megumi/coding-agent/persistence/repos/run-record.repo';
import { SessionRecordRepository } from '@megumi/coding-agent/persistence/repos/session-record.repo';

function createTestDatabase() {
  const database = createDatabase(':memory:');
  migrateDatabase(database);
  return database;
}

function seedRun(database: ReturnType<typeof createTestDatabase>, runId = 'run:1') {
  const sessionRepository = new SessionRecordRepository(database);
  const runRepository = new RunRecordRepository(database);
  sessionRepository.saveSession({
    sessionId: 'session:1',
    title: 'Session',
    status: 'active',
    createdAt: '2026-05-15T00:00:00.000Z',
    updatedAt: '2026-05-15T00:00:00.000Z',
  });
  runRepository.saveRun({
    runId,
    sessionId: 'session:1',
    mode: 'plan',
    goal: 'Write a plan',
    status: 'queued',
    createdAt: '2026-05-15T00:00:00.000Z',
  });
}

describe('PermissionSnapshotRepository', () => {
  it('saves and loads a permission snapshot by run id using permission_snapshots storage', () => {
    const database = createTestDatabase();
    seedRun(database);
    const repo = new PermissionSnapshotRepository(database);

    repo.savePermissionSnapshot({
      permissionSnapshotId: 'permission-snapshot:1',
      runId: 'run:1',
      permissionLabel: 'plan',
      permissionModeState: {
        permissionMode: 'plan',
        source: 'intent_default',
      },
      createdAt: '2026-05-15T00:00:00.000Z',
      metadata: { source: 'test' },
    });

    expect(database.prepare(`
      SELECT permission_snapshot_id, permission_label, permission_mode_state_json, permission_mode, permission_source
      FROM permission_snapshots
      WHERE run_id = ?
    `).get('run:1')).toEqual({
      permission_snapshot_id: 'permission-snapshot:1',
      permission_label: 'plan',
      permission_mode_state_json: JSON.stringify({
        permissionMode: 'plan',
        source: 'intent_default',
      }),
      permission_mode: 'plan',
      permission_source: 'intent_default',
    });

    expect(repo.getPermissionSnapshotByRun('run:1')).toEqual({
      permissionSnapshotId: 'permission-snapshot:1',
      runId: 'run:1',
      permissionLabel: 'plan',
      permissionModeState: {
        permissionMode: 'plan',
        source: 'intent_default',
      },
      createdAt: '2026-05-15T00:00:00.000Z',
      metadata: { source: 'test' },
    });
  });

  it('keeps implementation plan persistence behavior unchanged', () => {
    const database = createTestDatabase();
    seedRun(database);
    const repo = new PermissionSnapshotRepository(database);

    repo.saveImplementationPlan({
      planArtifactId: 'plan:1',
      producingRunId: 'run:1',
      title: 'Plan',
      status: 'proposed',
      createdAt: '2026-05-15T00:00:00.000Z',
      updatedAt: '2026-05-15T00:00:00.000Z',
      metadata: { summary: 'metadata only' },
    });

    expect(repo.getImplementationPlan('plan:1')).toMatchObject({
      planArtifactId: 'plan:1',
      status: 'proposed',
      metadata: { summary: 'metadata only' },
    });
  });
});
