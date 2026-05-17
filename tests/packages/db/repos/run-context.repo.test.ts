// @vitest-environment node
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateDatabase } from '@megumi/db/schema/migrations';
import { SessionRunRepository } from '@megumi/db/repos/session-run.repo';
import { RunContextRepository } from '@megumi/db/repos/run-context.repo';

let db: Database.Database | null = null;

function createRepos() {
  db = new Database(':memory:');
  migrateDatabase(db);
  const lifecycle = new SessionRunRepository(db);
  const context = new RunContextRepository(db);

  lifecycle.saveSession({
    sessionId: 'session-1',
    title: 'Context persistence',
    workspaceId: 'workspace-1',
    workspacePath: 'C:/all/work/study/megumi',
    status: 'active',
    createdAt: '2026-05-15T00:00:00.000Z',
    updatedAt: '2026-05-15T00:00:00.000Z',
  });
  lifecycle.saveRun({
    runId: 'run-1',
    sessionId: 'session-1',
    mode: 'chat',
    goal: 'Understand workspace context',
    status: 'running',
    createdAt: '2026-05-15T00:00:01.000Z',
  });

  return { lifecycle, context };
}

afterEach(() => {
  db?.close();
  db = null;
});

describe('RunContextRepository', () => {
  it('saves baseline, source refs, patch, and effective build records', () => {
    const { context } = createRepos();

    context.saveBaseline({
      contextId: 'context-1',
      runId: 'run-1',
      workspaceBoundary: {
        workspaceId: 'workspace-1',
        rootPath: 'C:/all/work/study/megumi',
        displayName: 'megumi',
        symlinkPolicy: 'deny_outside_workspace',
        outsideWorkspacePolicy: 'deny',
        secretPolicySummary: 'secret-like files are blocked',
        createdAt: '2026-05-15T00:00:00.000Z',
      },
      goal: 'Understand workspace context',
      constraints: ['Do not read secrets'],
      inlineContents: [],
      resourceRefs: [],
      conversationRefs: [],
      messageSummaries: [],
      workspaceSources: [],
      toolObservationRefs: [],
      memoryRecallRefs: [],
      policySummary: {
        workspaceAccess: 'workspace-read',
        restrictedResources: ['.env'],
        approvalSummary: 'No approval implied.',
        sandboxSummary: 'Read-only context acquisition.',
      },
      modelCapabilitySummary: {
        providerId: 'deepseek',
        modelId: 'deepseek-chat',
        modelContextWindow: 64000,
        reservedOutputTokens: 4096,
        availableInputTokens: 59904,
      },
      budget: {
        modelContextWindow: 64000,
        reservedOutputTokens: 4096,
        availableInputTokens: 59904,
        budgetPolicy: 'balanced',
        packingStrategy: 'priority_then_recent',
        truncationRecords: [],
      },
      buildMetadata: {
        buildReason: 'run_baseline',
        builtAt: '2026-05-15T00:00:02.000Z',
        selectionRecordIds: [],
        redactionRecordIds: [],
        truncationRecordIds: [],
      },
      createdAt: '2026-05-15T00:00:02.000Z',
    });

    context.saveSourceRef({
      sourceId: 'source-1',
      runId: 'run-1',
      sourceKind: 'workspace_file',
      sourceUri: 'workspace://workspace-1/packages/shared/index.ts',
      workspaceId: 'workspace-1',
      workspacePath: 'C:/all/work/study/megumi',
      relativePath: 'packages/shared/index.ts',
      contentHash: 'sha256:abc123',
      mtime: '2026-05-15T00:00:03.000Z',
      range: { startLine: 1, endLine: 12 },
      loadedAt: '2026-05-15T00:00:04.000Z',
      freshness: 'fresh',
      redactionState: 'none',
      selectionReason: 'agent_requested',
    });

    context.savePatch({
      patchId: 'patch-1',
      runId: 'run-1',
      requestedBy: 'agent',
      operation: 'add',
      sourceRef: 'source-1',
      reason: 'Need shared exports.',
      createdAt: '2026-05-15T00:00:05.000Z',
      appliedAt: '2026-05-15T00:00:06.000Z',
      status: 'applied',
    });

    context.saveEffectiveBuild({
      buildId: 'build-1',
      contextId: 'context-1',
      runId: 'run-1',
      sourceIds: ['source-1'],
      selectionRecordIds: ['selection-1'],
      redactionRecordIds: [],
      truncationRecordIds: [],
      builtAt: '2026-05-15T00:00:07.000Z',
      snapshotPolicy: 'metadata_only',
    });

    expect(context.getBaseline('context-1')?.goal).toBe('Understand workspace context');
    expect(context.listSourcesByRun('run-1')).toHaveLength(1);
    expect(context.listPatchesByRun('run-1')[0]).toMatchObject({ status: 'applied' });
    expect(context.listEffectiveBuildsByRun('run-1')[0]).toMatchObject({ snapshotPolicy: 'metadata_only' });
  });

  it('rejects unsafe raw prompt or secret-like snapshot metadata', () => {
    const { context } = createRepos();

    expect(() => context.saveEffectiveBuild({
      buildId: 'build-secret',
      contextId: 'context-1',
      runId: 'run-1',
      sourceIds: [],
      selectionRecordIds: [],
      redactionRecordIds: [],
      truncationRecordIds: [],
      builtAt: '2026-05-15T00:00:07.000Z',
      snapshotPolicy: 'redacted_snapshot',
      metadata: {
        exactPromptInputSnapshot: 'raw full prompt sk-test-1234567890abcdef',
      },
    })).toThrow(/Unsafe context snapshot metadata/);
  });
});
