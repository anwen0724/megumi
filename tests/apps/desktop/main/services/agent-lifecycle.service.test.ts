// @vitest-environment node
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateDatabase } from '@megumi/db/schema/migrations';
import { AgentLifecycleRepository } from '@megumi/db/repos/agent-lifecycle.repo';
import { AgentLifecycleService } from '@megumi/desktop/main/services/agent-lifecycle.service';
import type { AgentContext } from '@megumi/shared/agent-context-contracts';
import type { AgentAction } from '@megumi/shared/agent-lifecycle-contracts';
import { RUN_MODE_PRESET_DEFAULTS } from '@megumi/shared/agent-run-mode-contracts';

let db: Database.Database | null = null;

function createService() {
  db = new Database(':memory:');
  migrateDatabase(db);
  const repository = new AgentLifecycleRepository(db);
  return new AgentLifecycleService({
    repository,
    clock: { now: () => '2026-05-15T00:00:00.000Z' },
    ids: {
      sessionId: () => 'session-1',
      runId: () => 'run-1',
      stepId: () => 'step-1',
      actionId: () => 'action-1',
      observationId: () => 'observation-1',
      eventId: () => `event-${Math.random().toString(36).slice(2)}`,
      messageId: () => 'message-1',
    },
  });
}

function createServiceWithContextRecorder(records: unknown[]) {
  db = new Database(':memory:');
  migrateDatabase(db);
  const repository = new AgentLifecycleRepository(db);
  return new AgentLifecycleService({
    repository,
    contextService: {
      createBaselineContext: (input) => {
        records.push(input);
        return {
          contextId: `context:${input.runId}`,
          runId: input.runId,
          workspaceBoundary: {
            workspaceId: input.workspaceId,
            rootPath: input.workspacePath,
            symlinkPolicy: 'deny_outside_workspace',
            outsideWorkspacePolicy: 'deny',
            secretPolicySummary: 'No secrets.',
            createdAt: '2026-05-15T00:00:00.000Z',
          },
          goal: input.goal,
          constraints: [],
          inlineContents: [],
          resourceRefs: [],
          conversationRefs: [],
          messageSummaries: [],
          workspaceSources: [],
          toolObservationRefs: [],
          memoryRecallRefs: [],
          policySummary: {
            workspaceAccess: 'workspace-read',
            restrictedResources: [],
            approvalSummary: 'No approval.',
            sandboxSummary: 'Read-only.',
          },
          modelCapabilitySummary: input.modelCapabilitySummary,
          budget: {
            modelContextWindow: input.modelCapabilitySummary.modelContextWindow,
            reservedOutputTokens: input.modelCapabilitySummary.reservedOutputTokens,
            availableInputTokens: input.modelCapabilitySummary.availableInputTokens,
            budgetPolicy: 'balanced',
            packingStrategy: 'priority_then_recent',
            truncationRecords: [],
          },
          buildMetadata: {
            buildReason: 'run_baseline',
            builtAt: '2026-05-15T00:00:00.000Z',
            selectionRecordIds: [],
            redactionRecordIds: [],
            truncationRecordIds: [],
          },
          createdAt: '2026-05-15T00:00:00.000Z',
        } satisfies AgentContext;
      },
    },
    clock: { now: () => '2026-05-15T00:00:00.000Z' },
    ids: {
      sessionId: () => 'session-1',
      runId: () => 'run-1',
      stepId: () => 'step-1',
      actionId: () => 'action-1',
      observationId: () => 'observation-1',
      eventId: () => `event-${Math.random().toString(36).slice(2)}`,
      messageId: () => 'message-1',
    },
  });
}

function createServiceWithRunModeRecorder(records: unknown[]) {
  db = new Database(':memory:');
  migrateDatabase(db);
  const repository = new AgentLifecycleRepository(db);
  return new AgentLifecycleService({
    repository,
    runModeService: {
      createModeSnapshot: (input) => {
        records.push({ type: 'snapshot', input });
        return {
          modeSnapshotId: 'mode-snapshot:1',
          runId: input.runId,
          modeLabel: input.mode,
          mode: input.modeSnapshot ?? RUN_MODE_PRESET_DEFAULTS.chat,
          createdAt: input.createdAt,
        };
      },
      linkAcceptedSourcePlan: (input) => {
        records.push({ type: 'sourcePlan', input });
        return input;
      },
      createPlanRecordForRun: (input) => {
        records.push({ type: 'planRecord', input });
        return undefined;
      },
      getPlanByRun: () => undefined,
      updatePlanStatus: () => {
        throw new Error('not implemented');
      },
    },
    clock: { now: () => '2026-05-15T00:00:00.000Z' },
    ids: {
      sessionId: () => 'session-1',
      runId: () => 'run-1',
      stepId: () => 'step-1',
      actionId: () => 'action-1',
      observationId: () => 'observation-1',
      eventId: () => `event-${Math.random().toString(36).slice(2)}`,
      messageId: () => 'message-1',
    },
  });
}

function createServiceWithFailingHostBoundary(records: unknown[]) {
  db = new Database(':memory:');
  migrateDatabase(db);
  const repository = new AgentLifecycleRepository(db);
  return new AgentLifecycleService({
    repository,
    runModeService: {
      createModeSnapshot: (input) => {
        records.push({ type: 'snapshot', input });
        return {
          modeSnapshotId: 'mode-snapshot:1',
          runId: input.runId,
          modeLabel: input.mode,
          mode: input.modeSnapshot ?? RUN_MODE_PRESET_DEFAULTS.plan,
          createdAt: input.createdAt,
        };
      },
      linkAcceptedSourcePlan: (input) => {
        records.push({ type: 'sourcePlan', input });
        return input;
      },
      createPlanRecordForRun: (input) => {
        records.push({ type: 'planRecord', input });
        return undefined;
      },
      getPlanByRun: () => undefined,
      updatePlanStatus: () => {
        throw new Error('not implemented');
      },
    },
    hostBoundary: {
      handleAction: (_action: AgentAction) => {
        throw new Error('plan failed');
      },
    },
    clock: { now: () => '2026-05-15T00:00:00.000Z' },
    ids: {
      sessionId: () => 'session-1',
      runId: () => 'run-1',
      stepId: () => 'step-1',
      actionId: () => 'action-1',
      observationId: () => 'observation-1',
      eventId: () => `event-${Math.random().toString(36).slice(2)}`,
      messageId: () => 'message-1',
      debugId: () => 'debug-1',
    },
  });
}

afterEach(() => {
  db?.close();
  db = null;
});

describe('AgentLifecycleService', () => {
  it('creates durable sessions', () => {
    const service = createService();

    const session = service.createSession({
      title: 'Agent work',
      createdAt: '2026-05-15T00:00:00.000Z',
    });

    expect(session).toMatchObject({
      sessionId: 'session-1',
      status: 'active',
      title: 'Agent work',
    });
    expect(service.listSessions()).toEqual([session]);
  });

  it('starts a minimal agent run and persists lifecycle facts', async () => {
    const service = createService();
    service.createSession({
      title: 'Agent work',
      createdAt: '2026-05-15T00:00:00.000Z',
    });

    const result = await service.startRun({
      sessionId: 'session-1',
      goal: 'Answer',
      mode: 'chat',
      createdAt: '2026-05-15T00:00:00.000Z',
    });

    expect(result.run).toMatchObject({
      runId: 'run-1',
      status: 'completed',
    });
    expect(service.listRuntimeEventsByRun('run-1').map((event) => event.eventType)).toContain('run.completed');
  });

  it('creates a baseline context for workspace-bound runs before invoking the runtime', async () => {
    const baselineInputs: unknown[] = [];
    const service = createServiceWithContextRecorder(baselineInputs);
    service.createSession({
      title: 'Agent work',
      workspaceId: 'workspace-1',
      workspacePath: 'C:/all/work/study/megumi',
      createdAt: '2026-05-15T00:00:00.000Z',
    });

    await service.startRun({
      sessionId: 'session-1',
      goal: 'Use workspace context',
      mode: 'chat',
      createdAt: '2026-05-15T00:00:00.000Z',
    });

    expect(baselineInputs).toEqual([
      expect.objectContaining({
        runId: 'run-1',
        goal: 'Use workspace context',
        workspaceId: 'workspace-1',
        workspacePath: 'C:/all/work/study/megumi',
      }),
    ]);
  });

  it('passes mode snapshots and source plan ids into the core run', async () => {
    const records: unknown[] = [];
    const service = createServiceWithRunModeRecorder(records);
    service.createSession({
      title: 'Session',
      createdAt: '2026-05-15T00:00:00.000Z',
    });

    const result = await service.startRun({
      sessionId: 'session-1',
      goal: 'Execute plan',
      mode: 'execute',
      modeSnapshot: RUN_MODE_PRESET_DEFAULTS.execute,
      sourcePlanId: 'plan:accepted',
      createdAt: '2026-05-15T00:00:00.000Z',
    });

    expect(result.run.modeSnapshotRef).toBe('mode-snapshot:1');
    expect(result.run.sourcePlanId).toBe('plan:accepted');
    expect(records).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'snapshot' }),
      expect.objectContaining({ type: 'sourcePlan' }),
    ]));
  });

  it('does not create a proposed plan artifact for failed plan runs', async () => {
    const records: unknown[] = [];
    const service = createServiceWithFailingHostBoundary(records);
    service.createSession({
      title: 'Session',
      createdAt: '2026-05-15T00:00:00.000Z',
    });

    const result = await service.startRun({
      sessionId: 'session-1',
      goal: 'Write a plan',
      mode: 'plan',
      modeSnapshot: RUN_MODE_PRESET_DEFAULTS.plan,
      createdAt: '2026-05-15T00:00:00.000Z',
    });

    expect(result.run.status).toBe('failed');
    expect(records).toEqual([
      expect.objectContaining({ type: 'snapshot' }),
    ]);
  });
});
