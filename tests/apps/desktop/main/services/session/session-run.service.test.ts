// @vitest-environment node
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { migrateDatabase } from '@megumi/db/schema/migrations';
import { SessionRunRepository } from '@megumi/db/repos/session-run.repo';
import { SessionActivePathRepository } from '@megumi/db/repos/session-active-path.repo';
import { PermissionSnapshotRepository } from '@megumi/db/repos/permission-snapshot.repo';
import { ToolRepository } from '@megumi/db/repos/tool.repo';
import { TimelineMessageRepository } from '@megumi/db/repos/timeline-message.repo';
import {
  SessionRunService,
  type SessionRunContextService,
  type SessionRunServiceOptions,
  type SessionRunWorkspaceChangeReadPort,
} from '@megumi/desktop/main/services/session/session-run.service';
import { TimelineHistoryCommitProjectorService } from '@megumi/desktop/main/services/session/timeline-history-commit-projector.service';
import type {
  BuildModelStepInputInput,
  BuildModelStepInputResult,
} from '@megumi/desktop/main/services/session/model-step-input-build.service';
import type { SessionCompactionOrchestrationResult } from '@megumi/desktop/main/services/session/session-compaction-orchestrator.service';
import { PermissionSnapshotService } from '@megumi/desktop/main/services/security/permission-snapshot.service';
import type { ChatStreamEvent } from '@megumi/shared';
import type { ModelInputContext, ModelStepRuntimeRequest, SessionInstructionSourceSnapshot } from '@megumi/shared/model';
import type { ModelInputContextSourceKind } from '@megumi/shared/model';
import type { RunContext } from '@megumi/shared/run';
import type { RunAction } from '@megumi/shared/session';
import type { SessionSourceEntry } from '@megumi/shared/session';
import type { ApprovalRequest, ToolCall, ToolDefinition, ToolExecution, ToolResult } from '@megumi/shared/tool';
import type { RuntimeEvent } from '@megumi/shared/runtime';
import type { RuntimeError } from '@megumi/shared/runtime';
import type {
  WorkspaceChangedFile,
  WorkspaceChangeSet,
  WorkspaceChangeSummary,
} from '@megumi/shared/workspace';

let db: Database.Database | null = null;

function workspaceChangedFile(overrides: Partial<WorkspaceChangedFile> = {}): WorkspaceChangedFile {
  return {
    changedFileId: 'changed-file-1',
    changeSetId: 'change-set-1',
    workspaceCheckpointId: 'workspace-checkpoint-1',
    sessionId: 'session-1',
    runId: 'run-1',
    stepId: 'step-1',
    projectPath: 'src/app.ts',
    changeKind: 'modified',
    restoreState: 'restorable',
    beforeExists: true,
    beforeContentRefId: 'snapshot-before-1',
    beforeHash: 'a'.repeat(64),
    beforeByteLength: 6,
    afterExists: true,
    afterContentRefId: 'snapshot-after-1',
    afterHash: 'b'.repeat(64),
    afterByteLength: 5,
    createdAt: '2026-06-01T10:00:00.000Z',
    updatedAt: '2026-06-01T10:00:00.000Z',
    ...overrides,
  };
}

function createService() {
  db = new Database(':memory:');
  migrateDatabase(db);
  const repository = new SessionRunRepository(db);
  return new SessionRunService({
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
  const repository = new SessionRunRepository(db);
  return new SessionRunService({
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
          contextBudgetPolicy: input.contextBudgetPolicy,
          buildMetadata: {
            buildReason: 'run_baseline',
            builtAt: '2026-05-15T00:00:00.000Z',
            selectionRecordIds: [],
            redactionRecordIds: [],
            truncationRecordIds: [],
          },
          createdAt: '2026-05-15T00:00:00.000Z',
        } satisfies RunContext;
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

function createServiceWithPermissionSnapshotRecorder(records: unknown[]) {
  db = new Database(':memory:');
  migrateDatabase(db);
  const repository = new SessionRunRepository(db);
  return new SessionRunService({
    repository,
    permissionSnapshotService: {
      createPermissionSnapshot: (input) => {
        records.push({ type: 'snapshot', input });
        return {
          permissionSnapshotId: 'permission-snapshot:1',
          runId: input.runId,
          permissionLabel: input.permissionMode,
          permissionModeState: input.permissionModeState ?? {
            permissionMode: 'default',
            source: 'system',
          },
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
  const repository = new SessionRunRepository(db);
  return new SessionRunService({
    repository,
    permissionSnapshotService: {
      createPermissionSnapshot: (input) => {
        records.push({ type: 'snapshot', input });
        return {
          permissionSnapshotId: 'permission-snapshot:1',
          runId: input.runId,
          permissionLabel: input.permissionMode,
          permissionModeState: input.permissionModeState ?? {
            permissionMode: 'plan',
            source: 'system',
          },
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
      handleAction: (_action: RunAction) => {
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

function createServiceWithModelStepStream(
  events: RuntimeEvent[] | ((request: ModelStepRuntimeRequest, callIndex: number) => RuntimeEvent[]),
  options?: {
  contextService?: SessionRunContextService;
  permissionSnapshotService?: SessionRunServiceOptions['permissionSnapshotService'];
  toolRuntimeFactory?: SessionRunServiceOptions['toolRuntimeFactory'];
  toolDefinitionProvider?: SessionRunServiceOptions['toolDefinitionProvider'];
  providerCapabilitySummaryProvider?: SessionRunServiceOptions['providerCapabilitySummaryProvider'];
  timelineMessageRepository?: SessionRunServiceOptions['timelineMessageRepository'];
  agentInstructionSourceService?: SessionRunServiceOptions['agentInstructionSourceService'];
  sessionContextInputService?: SessionRunServiceOptions['sessionContextInputService'];
  sessionCompactionOrchestrator?: SessionRunServiceOptions['sessionCompactionOrchestrator'];
  modelStepInputBuildService?: SessionRunServiceOptions['modelStepInputBuildService'];
  memoryRecallService?: SessionRunServiceOptions['memoryRecallService'];
  memoryCaptureService?: SessionRunServiceOptions['memoryCaptureService'];
  memorySettingsProvider?: SessionRunServiceOptions['memorySettingsProvider'];
  memoryMarkdownSyncService?: SessionRunServiceOptions['memoryMarkdownSyncService'];
  megumiHomePath?: string;
  globalInstructionDirectoryProvider?: SessionRunServiceOptions['globalInstructionDirectoryProvider'];
  sessionInstructionSourceProvider?: SessionRunServiceOptions['sessionInstructionSourceProvider'];
  runEffectiveCwdProvider?: SessionRunServiceOptions['runEffectiveCwdProvider'];
  activePathRepository?: SessionActivePathRepository;
  workspaceChanges?: SessionRunServiceOptions['workspaceChanges'];
  createToolRepository?: (database: Database.Database) => ToolRepository;
  runId?: () => string;
  onRequest?: (request: ModelStepRuntimeRequest) => void;
}) {
  db = new Database(':memory:');
  migrateDatabase(db);
  const repository = new SessionRunRepository(db);
  const toolRepository = options?.createToolRepository?.(db);
  let callIndex = 0;
  const serviceOptions: SessionRunServiceOptions & { toolRepository?: ToolRepository } = {
    repository,
    ...(options?.contextService ? { contextService: options.contextService } : {}),
    ...(options?.permissionSnapshotService ? { permissionSnapshotService: options.permissionSnapshotService } : {}),
    ...(options?.toolRuntimeFactory ? { toolRuntimeFactory: options.toolRuntimeFactory } : {}),
    ...(options?.toolDefinitionProvider ? { toolDefinitionProvider: options.toolDefinitionProvider } : {}),
    ...(options?.providerCapabilitySummaryProvider ? {
      providerCapabilitySummaryProvider: options.providerCapabilitySummaryProvider,
    } : {}),
    ...(options?.timelineMessageRepository ? { timelineMessageRepository: options.timelineMessageRepository } : {}),
    ...(options?.agentInstructionSourceService ? { agentInstructionSourceService: options.agentInstructionSourceService } : {}),
    ...(options?.sessionContextInputService ? { sessionContextInputService: options.sessionContextInputService } : {}),
    ...(options?.sessionCompactionOrchestrator ? {
      sessionCompactionOrchestrator: options.sessionCompactionOrchestrator,
    } : {}),
    ...(options?.modelStepInputBuildService ? { modelStepInputBuildService: options.modelStepInputBuildService } : {}),
    ...(options?.memoryRecallService ? { memoryRecallService: options.memoryRecallService } : {}),
    ...(options?.memoryCaptureService ? { memoryCaptureService: options.memoryCaptureService } : {}),
    ...(options?.memorySettingsProvider ? { memorySettingsProvider: options.memorySettingsProvider } : {}),
    ...(options?.memoryMarkdownSyncService ? { memoryMarkdownSyncService: options.memoryMarkdownSyncService } : {}),
    ...(options?.megumiHomePath ? { megumiHomePath: options.megumiHomePath } : {}),
    ...(options?.globalInstructionDirectoryProvider ? {
      globalInstructionDirectoryProvider: options.globalInstructionDirectoryProvider,
    } : {}),
    ...(options?.sessionInstructionSourceProvider ? {
      sessionInstructionSourceProvider: options.sessionInstructionSourceProvider,
    } : {}),
    ...(options?.runEffectiveCwdProvider ? { runEffectiveCwdProvider: options.runEffectiveCwdProvider } : {}),
    ...(options?.activePathRepository ? { activePathRepository: options.activePathRepository } : {}),
    ...(options?.workspaceChanges ? { workspaceChanges: options.workspaceChanges } : {}),
    ...(toolRepository ? { toolRepository } : {}),
    modelStepProvider: {
      streamModelStep: async function* (request) {
        callIndex += 1;
        options?.onRequest?.(request);
        yield* (typeof events === 'function' ? events(request, callIndex) : events);
      },
      completeModelStep: async () => ({ ok: true, text: '' }),
      cancelModelStep: () => true,
    },
    clock: { now: () => '2026-05-17T00:00:00.000Z' },
    ids: {
      sessionId: () => 'session-1',
      runId: options?.runId ?? (() => 'run-1'),
      stepId: () => 'step-1',
      actionId: () => 'action-1',
      observationId: () => 'observation-1',
      eventId: () => `event-${Math.random().toString(36).slice(2)}`,
      messageId: (() => {
        let index = 0;
        return () => {
          index += 1;
          return `message-${index}`;
        };
      })(),
      sourceEntryId: (() => {
        let index = 0;
        return () => {
          index += 1;
          return `source-entry-${index}`;
        };
      })(),
      branchMarkerId: (() => {
        let index = 0;
        return () => {
          index += 1;
          return `branch-marker-${index}`;
        };
      })(),
    },
  };
  return new SessionRunService(serviceOptions);
}

function createServiceWithActivePathModelStepStream(events: RuntimeEvent[]) {
  db = new Database(':memory:');
  migrateDatabase(db);
  const repository = new SessionRunRepository(db);
  const activePathRepo = new SessionActivePathRepository(db);
  let messageIndex = 0;
  let sourceEntryIndex = 0;
  let branchMarkerIndex = 0;
  const service = new SessionRunService({
    repository,
    activePathRepository: activePathRepo,
    modelStepProvider: {
      streamModelStep: async function* () {
        yield* events;
      },
      completeModelStep: async () => ({ ok: true, text: '' }),
      cancelModelStep: () => true,
    },
    clock: { now: () => '2026-06-01T08:00:00.000Z' },
    ids: {
      sessionId: () => 'session-1',
      runId: () => 'run-1',
      stepId: () => 'step-1',
      eventId: (() => {
        let index = 0;
        return () => {
          index += 1;
          return `event-${index}`;
        };
      })(),
      messageId: () => {
        messageIndex += 1;
        return messageIndex === 1 ? 'message-user-1' : 'message-assistant-1';
      },
      sourceEntryId: () => {
        sourceEntryIndex += 1;
        return `source-entry-${sourceEntryIndex}`;
      },
      branchMarkerId: () => {
        branchMarkerIndex += 1;
        return `branch-marker-${branchMarkerIndex}`;
      },
    },
  });

  return { service, repository, activePathRepo };
}

function modelInputContextFromBuildInput(input: BuildModelStepInputInput): ModelInputContext {
  const sourceId = input.currentMessage
    ? `session-message:${input.currentMessage.messageId}`
    : `run:${input.runId}`;
  const sourceKind: ModelInputContextSourceKind = input.currentMessage ? 'current_user_message' : 'session_run';
  const partId = `part:current-turn:${input.stepId}`;
  const memoryParts = (input.memoryRecallSources ?? []).map((source, index) => ({
    partId: `part:memory:${index + 1}:${source.sourceId}`,
    kind: 'memory' as const,
    memoryKind: 'memory_recall' as const,
    text: source.text,
    memoryIds: source.memoryIds,
    sourceRefs: [{
      sourceId: source.sourceId,
      sourceKind: 'memory_recall' as const,
      sourceUri: `memory-recall://${source.sourceId}`,
      loadedAt: source.loadedAt ?? input.builtAt,
      ...(source.metadata ? { metadata: source.metadata } : {}),
    }],
    priority: 55,
    tokenEstimate: 3,
    budgetStatus: 'included_full' as const,
    budgetClass: 'contextual' as const,
    required: false as const,
  }));
  const part = input.currentMessage
    ? {
        partId,
        kind: 'current_turn' as const,
        role: 'user' as const,
        text: input.currentMessage.content,
        sourceRefs: [{
          sourceId,
          sourceKind,
          loadedAt: input.builtAt,
        }],
        priority: 100,
        tokenEstimate: 2,
        budgetStatus: 'included_full' as const,
        budgetClass: 'required' as const,
      }
    : {
        partId,
        kind: 'runtime_constraint' as const,
        constraintKind: 'other' as const,
        text: 'Continue.',
        sourceRefs: [{
          sourceId,
          sourceKind,
          loadedAt: input.builtAt,
        }],
        priority: 100,
        tokenEstimate: 2,
        budgetStatus: 'included_full' as const,
        budgetClass: 'required' as const,
      };
  const parts = [part, ...memoryParts];
  return {
    contextId: `model-input-context:${input.stepId}:${input.contextKind}`,
    sessionId: input.sessionId,
    runId: input.runId,
    stepId: input.stepId,
    builtAt: input.builtAt,
    parts,
    budget: {
      modelContextWindow: 8192,
      reservedOutputTokens: 1024,
      availableInputTokens: 7168,
      keepRecentTokens: 4096,
      inputTokenEstimate: parts.reduce((sum, nextPart) => sum + (nextPart.tokenEstimate ?? 0), 0),
      partBudgets: parts.map((nextPart) => ({
        partId: nextPart.partId,
        tokenEstimate: nextPart.tokenEstimate ?? 0,
        budgetStatus: nextPart.budgetStatus,
      })),
    },
    trace: {
      buildReason: input.contextKind,
      selectedSources: [{
        sourceId,
        sourceKind,
        reason: input.currentMessage ? 'current_turn' : 'runtime_fact',
        budgetClass: 'required',
        partId,
      }, ...memoryParts.map((memoryPart) => ({
        sourceId: memoryPart.sourceRefs[0].sourceId,
        sourceKind: 'memory_recall' as const,
        reason: 'memory',
        budgetClass: 'contextual' as const,
        partId: memoryPart.partId,
      }))],
      excludedSources: [],
      ...(input.memoryRecallSeed ? { metadata: { memoryRecallSeed: input.memoryRecallSeed } } : {}),
    },
  };
}

function successfulModelStepInputBuild(input: BuildModelStepInputInput): BuildModelStepInputResult {
  const inputContext = modelInputContextFromBuildInput(input);
  return {
    buildRequest: {
      requestId: `model-input-build:${input.runId}:${input.stepId}:${input.contextKind}`,
      contextId: inputContext.contextId,
      sessionId: input.sessionId,
      runId: input.runId,
      modelStepId: input.stepId,
      permissionMode: input.permissionMode,
      modelTarget: {
        providerId: input.providerId,
        modelId: input.modelId,
      },
      availableCapabilitySummary: 'Available tools: none.',
      runtimeFacts: [],
      traceId: `trace:${input.runId}:${input.stepId}:${input.contextKind}`,
      builtAt: input.builtAt,
    },
    inputContext,
    toolDefinitions: input.toolDefinitions ?? [],
    instructionSources: [],
    availableCapabilitySummary: 'Available tools: none.',
  };
}

function createServiceWithAutomaticRetryStream(
  events: (request: ModelStepRuntimeRequest, callIndex: number) => RuntimeEvent[],
  options?: {
    maxAutomaticModelStepRetries?: number;
    retrySleep?: (input: { delayMs: number; attemptNumber: number; runId: string }) => Promise<void>;
    workspaceChanges?: SessionRunWorkspaceChangeReadPort;
  },
) {
  db = new Database(':memory:');
  migrateDatabase(db);
  const repository = new SessionRunRepository(db);
  const activePathRepo = new SessionActivePathRepository(db);
  let callIndex = 0;
  let messageIndex = 0;
  let sourceEntryIndex = 0;
  let retryAttemptIndex = 0;
  const service = new SessionRunService({
    repository,
    activePathRepository: activePathRepo,
    automaticRetry: {
      maxAttempts: options?.maxAutomaticModelStepRetries ?? 2,
      baseDelayMs: 0,
      maxDelayMs: 0,
      sleep: options?.retrySleep,
    },
    modelStepProvider: {
      streamModelStep: async function* (request) {
        callIndex += 1;
        yield* events(request, callIndex);
      },
      completeModelStep: async () => ({ ok: true, text: '' }),
      cancelModelStep: () => true,
    },
    workspaceChanges: options?.workspaceChanges,
    clock: { now: () => '2026-06-01T10:00:00.000Z' },
    ids: {
      sessionId: () => 'session-1',
      runId: () => 'run-1',
      stepId: (() => {
        let index = 0;
        return () => {
          index += 1;
          return `step-${index}`;
        };
      })(),
      eventId: (() => {
        let index = 0;
        return () => {
          index += 1;
          return `event-retry-${index}`;
        };
      })(),
      messageId: () => {
        messageIndex += 1;
        return `message-${messageIndex}`;
      },
      sourceEntryId: () => {
        sourceEntryIndex += 1;
        return `source-entry-${sourceEntryIndex}`;
      },
      retryAttemptId: () => {
        retryAttemptIndex += 1;
        return `retry-attempt-${retryAttemptIndex}`;
      },
    },
  });
  return { service, repository, activePathRepo };
}

function createBranchServiceFixture(options: {
  chatEvents?: ChatStreamEvent[];
  chatStreamEventSink?: SessionRunServiceOptions['chatStreamEventSink'];
  timelineMessageRepository?: SessionRunServiceOptions['timelineMessageRepository'];
  useTimelineProjector?: boolean;
} = {}) {
  db = new Database(':memory:');
  migrateDatabase(db);
  const repository = new SessionRunRepository(db);
  const activePathRepo = new SessionActivePathRepository(db);
  const timelineRepository = options.useTimelineProjector
    ? new TimelineMessageRepository(db)
    : undefined;
  const timelineProjector = timelineRepository
    ? new TimelineHistoryCommitProjectorService({
        repository: timelineRepository,
        ids: { diagnosticId: () => 'diagnostic-branch-1' },
      })
    : undefined;
  let branchMarkerIndex = 0;
  const service = new SessionRunService({
    repository,
    activePathRepository: activePathRepo,
    ...(timelineRepository ? { timelineMessageRepository: timelineRepository } : {}),
    ...(options.timelineMessageRepository ? { timelineMessageRepository: options.timelineMessageRepository } : {}),
    ...(timelineProjector ? { chatStreamEventSink: timelineProjector } : {}),
    ...(options.chatStreamEventSink ? { chatStreamEventSink: options.chatStreamEventSink } : {}),
    ...(options.chatEvents ? {
      chatStreamEventSink: {
        publish: (event) => options.chatEvents?.push(event),
      },
    } : {}),
    clock: { now: () => '2026-06-01T08:00:00.000Z' },
    ids: {
      sessionId: () => 'session-1',
      eventId: (() => {
        let index = 0;
        return () => {
          index += 1;
          return `event-branch-${index}`;
        };
      })(),
      sourceEntryId: (() => {
        let index = 0;
        return () => {
          index += 1;
          return `source-entry-branch-marker-${index}`;
        };
      })(),
      branchMarkerId: () => {
        branchMarkerIndex += 1;
        return `branch-marker-${branchMarkerIndex}`;
      },
    },
  });
  seedBranchHistory(repository, activePathRepo);
  return { service, repository, activePathRepo, timelineRepository };
}

function createManualRetryFixture() {
  db = new Database(':memory:');
  migrateDatabase(db);
  const repository = new SessionRunRepository(db);
  const activePathRepo = new SessionActivePathRepository(db);
  let sourceEntryIndex = 0;
  let branchMarkerIndex = 0;
  let retryAttemptIndex = 0;
  const service = new SessionRunService({
    repository,
    activePathRepository: activePathRepo,
    clock: { now: () => '2026-06-01T11:00:00.000Z' },
    ids: {
      eventId: (() => {
        let index = 0;
        return () => {
          index += 1;
          return `event-manual-${index}`;
        };
      })(),
      sourceEntryId: () => {
        sourceEntryIndex += 1;
        return `source-entry-manual-${sourceEntryIndex}`;
      },
      branchMarkerId: () => {
        branchMarkerIndex += 1;
        return `branch-marker-manual-${branchMarkerIndex}`;
      },
      retryAttemptId: () => {
        retryAttemptIndex += 1;
        return `retry-attempt-manual-${retryAttemptIndex}`;
      },
    },
  });

  repository.saveSession({
    sessionId: 'session-1',
    title: 'Manual retry session',
    status: 'active',
    createdAt: '2026-06-01T10:00:00.000Z',
    updatedAt: '2026-06-01T10:00:00.000Z',
  });
  repository.saveMessage({
    messageId: 'message-user-1',
    sessionId: 'session-1',
    runId: 'run-failed',
    role: 'user',
    content: 'Original prompt',
    status: 'completed',
    createdAt: '2026-06-01T10:01:00.000Z',
    completedAt: '2026-06-01T10:01:00.000Z',
  });
  const userEntry = activePathRepo.appendSourceEntryAndSetActiveLeaf({
    sourceEntryId: 'source-entry-user-1',
    sessionId: 'session-1',
    sourceRef: {
      sourceKind: 'session_message',
      sourceId: 'message-user-1',
      sourceUri: 'session-message://message-user-1',
      loadedAt: '2026-06-01T10:01:00.000Z',
    },
    createdAt: '2026-06-01T10:01:00.000Z',
  }, {
    sessionId: 'session-1',
    leafSourceEntryId: 'source-entry-user-1',
    updatedAt: '2026-06-01T10:01:00.000Z',
    reason: 'source_appended',
  });
  repository.saveRun({
    runId: 'run-failed',
    sessionId: 'session-1',
    triggerMessageId: 'message-user-1',
    mode: 'default',
    goal: 'Original prompt',
    status: 'failed',
    createdAt: '2026-06-01T10:01:00.000Z',
    completedAt: '2026-06-01T10:02:00.000Z',
    error: {
      code: 'provider_network_error',
      message: 'Provider failed.',
      severity: 'error',
      retryable: true,
      source: 'provider',
    },
  });
  activePathRepo.appendSourceEntryAndSetActiveLeaf({
    sourceEntryId: 'source-entry-run-failed',
    sessionId: 'session-1',
    parentSourceEntryId: userEntry.sourceEntryId,
    sourceRef: {
      sourceKind: 'session_run',
      sourceId: 'run-failed',
      sourceUri: 'session-run://run-failed',
      loadedAt: '2026-06-01T10:01:00.000Z',
    },
    createdAt: '2026-06-01T10:01:00.000Z',
  }, {
    sessionId: 'session-1',
    leafSourceEntryId: 'source-entry-run-failed',
    updatedAt: '2026-06-01T10:01:00.000Z',
    reason: 'source_appended',
  });

  return { service, repository, activePathRepo };
}

function seedBranchHistory(
  repository: SessionRunRepository,
  activePathRepo: SessionActivePathRepository,
) {
  repository.saveSession({
    sessionId: 'session-1',
    title: 'Branch session',
    status: 'active',
    createdAt: '2026-06-01T08:00:00.000Z',
    updatedAt: '2026-06-01T08:00:00.000Z',
  });
  repository.saveMessage({
    messageId: 'message-1',
    sessionId: 'session-1',
    runId: 'run-1',
    role: 'user',
    content: 'Initial approach.',
    status: 'completed',
    createdAt: '2026-06-01T08:01:00.000Z',
    completedAt: '2026-06-01T08:01:00.000Z',
  });
  repository.saveRun({
    runId: 'run-1',
    sessionId: 'session-1',
    triggerMessageId: 'message-1',
    mode: 'default',
    goal: 'Initial approach.',
    status: 'completed',
    createdAt: '2026-06-01T08:01:00.000Z',
    startedAt: '2026-06-01T08:01:00.000Z',
    completedAt: '2026-06-01T08:02:00.000Z',
  });
  repository.saveMessage({
    messageId: 'message-2',
    sessionId: 'session-1',
    runId: 'run-1',
    role: 'assistant',
    content: 'Initial answer.',
    status: 'completed',
    createdAt: '2026-06-01T08:02:00.000Z',
    completedAt: '2026-06-01T08:02:00.000Z',
  });
  repository.saveMessage({
    messageId: 'message-3',
    sessionId: 'session-1',
    runId: 'run-2',
    role: 'user',
    content: 'Try a different approach.',
    status: 'completed',
    createdAt: '2026-06-01T08:03:00.000Z',
    completedAt: '2026-06-01T08:03:00.000Z',
  });
  repository.saveRun({
    runId: 'run-2',
    sessionId: 'session-1',
    triggerMessageId: 'message-3',
    mode: 'default',
    goal: 'Try a different approach.',
    status: 'completed',
    createdAt: '2026-06-01T08:03:00.000Z',
    startedAt: '2026-06-01T08:03:00.000Z',
    completedAt: '2026-06-01T08:04:00.000Z',
  });
  repository.saveMessage({
    messageId: 'message-4',
    sessionId: 'session-1',
    runId: 'run-2',
    role: 'assistant',
    content: 'Different answer.',
    status: 'completed',
    createdAt: '2026-06-01T08:04:00.000Z',
    completedAt: '2026-06-01T08:04:00.000Z',
  });

  appendSeedSource(activePathRepo, 'source-entry-message-1', 'session_message', 'message-1', undefined, '2026-06-01T08:01:00.000Z');
  appendSeedSource(activePathRepo, 'source-entry-run-1', 'session_run', 'run-1', 'source-entry-message-1', '2026-06-01T08:01:30.000Z');
  appendSeedSource(activePathRepo, 'source-entry-message-2', 'session_message', 'message-2', 'source-entry-run-1', '2026-06-01T08:02:00.000Z');
  appendSeedSource(activePathRepo, 'source-entry-message-3', 'session_message', 'message-3', 'source-entry-message-2', '2026-06-01T08:03:00.000Z');
  appendSeedSource(activePathRepo, 'source-entry-run-2', 'session_run', 'run-2', 'source-entry-message-3', '2026-06-01T08:03:30.000Z');
  const leaf = appendSeedSource(activePathRepo, 'source-entry-message-4', 'session_message', 'message-4', 'source-entry-run-2', '2026-06-01T08:04:00.000Z');
  activePathRepo.setActiveLeaf({
    sessionId: 'session-1',
    leafSourceEntryId: leaf.sourceEntryId,
    updatedAt: '2026-06-01T08:04:00.000Z',
    reason: 'source_appended',
  });
}

function appendSeedSource(
  activePathRepo: SessionActivePathRepository,
  sourceEntryId: string,
  sourceKind: ModelInputContextSourceKind,
  sourceId: string,
  parentSourceEntryId: string | undefined,
  createdAt: string,
): SessionSourceEntry {
  return activePathRepo.appendSourceEntry({
    sourceEntryId,
    sessionId: 'session-1',
    ...(parentSourceEntryId ? { parentSourceEntryId } : {}),
    sourceRef: {
      sourceKind,
      sourceId,
      sourceUri: `${sourceUriScheme(sourceKind)}://${sourceId}`,
      loadedAt: createdAt,
    },
    createdAt,
  });
}

function sourceUriScheme(sourceKind: ModelInputContextSourceKind): string {
  switch (sourceKind) {
    case 'session_message':
      return 'session-message';
    case 'session_run':
      return 'session-run';
    case 'session_summary':
      return 'session-compaction';
    default:
      return sourceKind;
  }
}

function createServiceWithChatStreamSink(
  events: RuntimeEvent[] | ((request: ModelStepRuntimeRequest, callIndex: number) => RuntimeEvent[]),
  chatEvents: ChatStreamEvent[],
  options?: {
    toolRuntimeFactory?: SessionRunServiceOptions['toolRuntimeFactory'];
    toolDefinitionProvider?: SessionRunServiceOptions['toolDefinitionProvider'];
    workspaceChanges?: SessionRunServiceOptions['workspaceChanges'];
  },
) {
  db = new Database(':memory:');
  migrateDatabase(db);
  const repository = new SessionRunRepository(db);
  let callIndex = 0;
  return new SessionRunService({
    repository,
    ...(options?.toolRuntimeFactory ? { toolRuntimeFactory: options.toolRuntimeFactory } : {}),
    ...(options?.toolDefinitionProvider ? { toolDefinitionProvider: options.toolDefinitionProvider } : {}),
    ...(options?.workspaceChanges ? { workspaceChanges: options.workspaceChanges } : {}),
    modelStepProvider: {
      streamModelStep: async function* (request) {
        callIndex += 1;
        yield* (typeof events === 'function' ? events(request, callIndex) : events);
      },
      completeModelStep: async () => ({ ok: true, text: '' }),
      cancelModelStep: () => true,
    },
    chatStreamEventSink: {
      publish: (event) => chatEvents.push(event),
    },
    clock: { now: () => '2026-05-24T00:00:00.000Z' },
    ids: {
      sessionId: () => 'session-1',
      runId: () => 'run-1',
      stepId: (() => {
        let index = 0;
        return () => {
          index += 1;
          return `step-${index}`;
        };
      })(),
      eventId: (() => {
        let index = 0;
        return () => {
          index += 1;
          return `event-${index}`;
        };
      })(),
      messageId: (() => {
        let index = 0;
        return () => {
          index += 1;
          return `message-${index}`;
        };
      })(),
      chatStreamEventId: (() => {
        let index = 0;
        return () => {
          index += 1;
          return `chat-stream-event-${index}`;
        };
      })(),
      chatStreamId: () => 'stream-main-1',
      chatTextId: (() => {
        let index = 0;
        return () => {
          index += 1;
          return `text-${index}`;
        };
      })(),
      chatThinkingId: (() => {
        let index = 0;
        return () => {
          index += 1;
          return `thinking-${index}`;
        };
      })(),
    },
  });
}

function createServiceWithChatStreamSinkAndRepository(
  events: RuntimeEvent[] | ((request: ModelStepRuntimeRequest, callIndex: number) => RuntimeEvent[]),
  chatEvents: ChatStreamEvent[],
  options?: Parameters<typeof createServiceWithChatStreamSink>[2],
) {
  const service = createServiceWithChatStreamSink(events, chatEvents, options);
  if (!db) {
    throw new Error('Expected test database to be initialized.');
  }
  return {
    service,
    repository: new SessionRunRepository(db),
  };
}

function toolUseCreatedEvent(sequence: number): RuntimeEvent {
  return toolUseCreatedEventFor({
    sequence,
    toolCallId: 'tool-call-1',
    providerToolCallId: 'provider-tool-call-1',
    input: { path: 'package.json' },
  });
}

function toolUseCreatedEventFor(input: {
  sequence: number;
  toolCallId: string;
  providerToolCallId: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  input?: Record<string, unknown>;
}): RuntimeEvent {
  return {
    eventId: `event-tool-call-${input.sequence}`,
    schemaVersion: 1,
    eventType: 'tool.call.created',
    sessionId: 'session-1',
    runId: 'run-1',
    stepId: 'step-1',
    sequence: input.sequence,
    createdAt: '2026-05-17T00:00:01.000Z',
    source: 'provider',
    visibility: 'system',
    persist: 'required',
    payload: {
      toolCallId: input.toolCallId,
      modelStepId: 'model-step-1',
      providerToolCallId: input.providerToolCallId,
      toolName: input.toolName ?? 'read_file',
      input: input.input ?? input.toolInput ?? { path: 'package.json' },
    },
  };
}

function modelStepCompletedEvent(sequence: number): RuntimeEvent {
  return {
    eventId: `event-model-step-completed-${sequence}`,
    schemaVersion: 1,
    eventType: 'model.step.completed',
    sessionId: 'session-1',
    runId: 'run-1',
    stepId: 'step-1',
    sequence,
    createdAt: '2026-05-17T00:00:02.000Z',
    source: 'provider',
    visibility: 'system',
    persist: 'required',
    payload: {
      modelStepId: 'model-step-1',
      finishReason: 'tool_calls',
    },
  };
}

function modelStepProviderStateRecordedEvent(sequence: number): RuntimeEvent {
  return {
    eventId: `event-model-step-provider-state-${sequence}`,
    schemaVersion: 1,
    eventType: 'model.step.provider_state.recorded',
    sessionId: 'session-1',
    runId: 'run-1',
    stepId: 'step-1',
    sequence,
    createdAt: '2026-05-17T00:00:02.000Z',
    source: 'provider',
    visibility: 'system',
    persist: 'required',
    payload: {
      modelStepId: 'model-step-1',
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      blocks: [{
        type: 'reasoning_content',
        text: 'Need to read package.json before answering.',
      }],
    },
  };
}

function modelOutputDeltaEvent(input: {
  sequence: number;
  delta: string;
  stepId?: string;
  modelStepId?: string;
}): RuntimeEvent {
  return {
    eventId: `event-model-output-delta-${input.sequence}`,
    schemaVersion: 1,
    eventType: 'model.output.delta',
    sessionId: 'session-1',
    runId: 'run-1',
    stepId: input.stepId ?? 'step-1',
    sequence: input.sequence,
    createdAt: '2026-05-17T00:00:01.000Z',
    source: 'provider',
    visibility: 'user',
    persist: 'transient',
    payload: {
      modelStepId: input.modelStepId ?? 'model-step-1',
      delta: input.delta,
    },
  };
}

function assistantOutputCompletedEvent(sequence: number): RuntimeEvent {
  return {
    eventId: `event-assistant-completed-${sequence}`,
    schemaVersion: 1,
    eventType: 'assistant.output.completed',
    sessionId: 'session-1',
    runId: 'run-1',
    stepId: 'step-1',
    sequence,
    createdAt: '2026-05-17T00:00:03.000Z',
    source: 'provider',
    visibility: 'user',
    persist: 'required',
    payload: {
      content: 'Final answer after tool result.',
    },
  };
}

function providerRunFailedEvent(input: {
  eventId: string;
  stepId: string;
  error: RuntimeError;
}): RuntimeEvent {
  return {
    eventId: input.eventId,
    schemaVersion: 1,
    eventType: 'run.failed',
    sessionId: 'session-1',
    runId: 'run-1',
    stepId: input.stepId,
    sequence: 1,
    createdAt: '2026-06-01T10:00:01.000Z',
    source: 'provider',
    visibility: 'user',
    persist: 'required',
    payload: {
      error: input.error,
    },
  };
}

function toolCallRequestedRuntimeEvent(): RuntimeEvent {
  return {
    eventId: 'event-tool-call-requested',
    schemaVersion: 1,
    eventType: 'tool.execution.requested',
    runId: 'run-1',
    sessionId: 'session-1',
    stepId: 'step-1',
    sequence: 1,
    createdAt: '2026-05-20T00:00:01.000Z',
    source: 'tool',
    visibility: 'user',
    persist: 'required',
    payload: {
      toolExecution: {
        toolExecutionId: 'tool-execution-1',
        toolCallId: 'tool-call-1',
        runId: 'run-1',
        stepId: 'step-1',
        toolName: 'read_file',
        input: { path: 'package.json' },
        inputPreview: {
          summary: 'read_file',
          targets: [],
          redactionState: 'none',
        },
        capabilities: ['project_read'],
        riskLevel: 'low',
        sideEffect: 'none',
        status: 'running',
        requestedAt: '2026-05-20T00:00:01.000Z',
      },
    },
  };
}

function approvalResumeRuntimeEvents(toolResult: ToolResult, status: 'success' | 'failure' | 'denied'): RuntimeEvent[] {
  const toolCallId = String(toolResult.toolCallId ?? 'tool-call-1');
  const toolExecutionId = String(toolResult.toolExecutionId ?? 'tool-execution-1');
  const started: RuntimeEvent = {
    eventId: `event-${toolExecutionId}-started`,
    schemaVersion: 1,
    eventType: 'tool.execution.started',
    runId: 'run-1',
    sessionId: 'session-1',
    stepId: 'step-1',
    sequence: 1,
    createdAt: '2026-05-17T00:00:05.000Z',
    source: 'tool',
    visibility: 'user',
    persist: 'required',
    payload: {
      toolExecutionId,
      startedAt: '2026-05-17T00:00:05.000Z',
    },
  };
  const terminal: RuntimeEvent = status === 'denied'
    ? {
        eventId: `event-${toolExecutionId}-denied`,
        schemaVersion: 1,
        eventType: 'tool.execution.denied',
        runId: 'run-1',
        sessionId: 'session-1',
        stepId: 'step-1',
        sequence: 2,
        createdAt: toolResult.createdAt,
        source: 'security',
        visibility: 'user',
        persist: 'required',
        payload: {
          toolExecutionId,
          reason: toolResult.denialReason ?? 'User rejected the requested tool call.',
        },
      }
    : status === 'failure'
      ? {
          eventId: `event-${toolExecutionId}-failed`,
          schemaVersion: 1,
          eventType: 'tool.execution.failed',
          runId: 'run-1',
          sessionId: 'session-1',
          stepId: 'step-1',
          sequence: 2,
          createdAt: toolResult.createdAt,
          source: 'tool',
          visibility: 'user',
          persist: 'required',
          payload: {
            toolExecutionId,
            error: toolResult.error ?? {
              code: 'runtime_unknown',
              message: 'Tool failed.',
              severity: 'error',
              retryable: false,
              source: 'tool',
            },
            completedAt: toolResult.createdAt,
          },
        }
      : {
          eventId: `event-${toolExecutionId}-completed`,
          schemaVersion: 1,
          eventType: 'tool.execution.completed',
          runId: 'run-1',
          sessionId: 'session-1',
          stepId: 'step-1',
          sequence: 2,
          createdAt: toolResult.createdAt,
          source: 'tool',
          visibility: 'user',
          persist: 'required',
          payload: {
            toolExecutionId,
            completedAt: toolResult.createdAt,
          },
        };
  const result: RuntimeEvent = {
    eventId: `event-${toolResult.toolResultId}-created`,
    schemaVersion: 1,
    eventType: 'tool.result.created',
    runId: 'run-1',
    sessionId: 'session-1',
    stepId: 'step-1',
    sequence: 3,
    createdAt: toolResult.createdAt,
    source: 'tool',
    visibility: 'system',
    persist: 'required',
    payload: {
      toolResultId: String(toolResult.toolResultId),
      toolCallId,
      ...(toolResult.toolExecutionId ? { toolExecutionId: String(toolResult.toolExecutionId) } : {}),
      kind: toolResult.kind,
      summary: toolResult.textContent ?? toolResult.denialReason ?? toolResult.kind,
    },
  };

  return status === 'denied' ? [terminal, result] : [started, terminal, result];
}

function createToolResult(overrides: Partial<ToolResult> = {}): ToolResult {
  return {
    toolResultId: 'tool-result-1',
    toolCallId: 'tool-call-1',
    runId: 'run-1',
    kind: 'success',
    structuredContent: { text: 'package contents' },
    textContent: 'package contents',
    redactionState: 'none',
    createdAt: '2026-05-17T00:00:02.500Z',
    ...overrides,
  };
}

function createDurablePendingApprovalRows(toolRepository: ToolRepository, input: {
  runId?: string;
  stepId?: string;
  modelStepId?: string;
  toolCallId?: string;
  toolExecutionId?: string;
  approvalRequestId?: string;
} = {}): void {
  const runId = input.runId ?? 'run-1';
  const stepId = input.stepId ?? 'step-1';
  const modelStepId = input.modelStepId ?? 'model-step-1';
  const toolCallId = input.toolCallId ?? 'tool-call-1';
  const toolExecutionId = input.toolExecutionId ?? 'tool-execution-1';
  const approvalRequestId = input.approvalRequestId ?? 'approval-request-1';
  const toolCall: ToolCall = {
    toolCallId,
    runId,
    modelStepId,
    providerToolCallId: 'provider-tool-call-1',
    toolName: 'read_file',
    input: { path: 'package.json' },
    inputPreview: {
      summary: 'Read package.json',
      redacted: false,
    },
    status: 'created',
    createdAt: '2026-05-17T00:00:02.000Z',
  };
  const toolExecution: ToolExecution = {
    toolExecutionId,
    toolCallId,
    runId,
    stepId,
    toolName: 'read_file',
    input: toolCall.input,
    inputPreview: toolCall.inputPreview,
    capabilities: ['project_read'],
    riskLevel: 'low',
    sideEffect: 'none',
    approvalRequestId,
    status: 'pending_approval',
    requestedAt: '2026-05-17T00:00:02.250Z',
  };
  const approvalRequest: ApprovalRequest = {
    approvalRequestId,
    toolCallId,
    toolExecutionId,
    runId,
    stepId,
    toolName: 'read_file',
    capabilities: ['project_read'],
    riskLevel: 'low',
    title: 'Approve read_file',
    summary: 'User approval is required.',
    preview: {
      action: 'read_file',
      targets: [],
    },
    requestedScope: 'once',
    status: 'pending',
    createdAt: '2026-05-17T00:00:02.300Z',
  };

  toolRepository.saveToolCall(toolCall);
  toolRepository.saveToolExecution(toolExecution);
  toolRepository.saveApprovalRequest(approvalRequest);
}

afterEach(() => {
  db?.close();
  db = null;
});

describe('SessionRunService', () => {
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

  it('attaches session message sends to the active path', async () => {
    const { service, repository, activePathRepo } = createServiceWithActivePathModelStepStream([{
      eventId: 'event-assistant-completed-1',
      schemaVersion: 1,
      eventType: 'assistant.output.completed',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1',
      sequence: 1,
      createdAt: '2026-06-01T08:00:03.000Z',
      source: 'provider',
      visibility: 'user',
      persist: 'required',
      payload: {
        content: 'Assistant answer.',
      },
    }]);
    service.createSession({
      title: 'Session',
      createdAt: '2026-06-01T08:00:00.000Z',
    });

    const result = await service.sendSessionMessage({
      requestId: 'request-1',
      payload: {
        sessionId: 'session-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: 'User question.',
          createdAt: '2026-06-01T08:00:00.000Z',
        }],
        createdAt: '2026-06-01T08:00:00.000Z',
      },
    });

    for await (const _event of result.events) {
      // Drain stream so assistant persistence can complete.
    }

    expect(activePathRepo.getActivePath('session-1').entries.map((entry) => [
      entry.sourceRef.sourceKind,
      entry.sourceRef.sourceId,
    ])).toEqual([
      ['session_message', 'message-user-1'],
      ['session_run', 'run-1'],
      ['session_message', 'message-assistant-1'],
    ]);
    expect(repository.getMessage('message-assistant-1')).toMatchObject({
      role: 'assistant',
      content: 'Assistant answer.',
      status: 'completed',
      runId: 'run-1',
    });
  });

  it('automatically retries transient provider model-step failures and keeps attempt audit', async () => {
    const providerRequests: ModelStepRuntimeRequest[] = [];
    const { service, activePathRepo } = createServiceWithAutomaticRetryStream((request, callIndex) => {
      providerRequests.push(request);
      if (callIndex === 1) {
        return [{
          eventId: 'event-provider-failed',
          schemaVersion: 1,
          eventType: 'run.failed',
          sessionId: 'session-1',
          runId: 'run-1',
          stepId: request.stepId,
          sequence: 1,
          createdAt: '2026-06-01T10:00:01.000Z',
          source: 'provider',
          visibility: 'user',
          persist: 'required',
          payload: {
            error: {
              code: 'provider_rate_limited',
              message: '429 rate limit',
              severity: 'error',
              retryable: true,
              source: 'provider',
            },
          },
        }];
      }
      return [{
        ...assistantOutputCompletedEvent(1),
        stepId: request.stepId,
      }];
    });
    service.createSession({
      title: 'Retry session',
      createdAt: '2026-06-01T10:00:00.000Z',
    });

    const result = await service.sendSessionMessage({
      requestId: 'request-1',
      payload: {
        sessionId: 'session-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: 'Hello',
          createdAt: '2026-06-01T10:00:00.000Z',
        }],
        createdAt: '2026-06-01T10:00:00.000Z',
      },
    });

    const streamed: RuntimeEvent[] = [];
    for await (const event of result.events) {
      streamed.push(event);
    }

    expect(providerRequests).toHaveLength(2);
    expect(streamed.map((event) => event.eventType)).toEqual(expect.arrayContaining([
      'retry.started',
      'retry.completed',
      'assistant.output.completed',
      'run.completed',
    ]));
    expect(streamed.map((event) => event.eventType)).not.toContain('run.failed');
    expect(activePathRepo.listRetryAttemptsByRun('run-1')).toEqual([
      expect.objectContaining({
        runId: 'run-1',
        attemptNumber: 1,
        retryKind: 'automatic_model_step',
        reason: 'rate_limited',
        status: 'succeeded',
        retryable: true,
      }),
    ]);
  });

  it('does not retry context overflow or quota style provider failures', async () => {
    const providerRequests: ModelStepRuntimeRequest[] = [];
    const { service, activePathRepo } = createServiceWithAutomaticRetryStream((request) => {
      providerRequests.push(request);
      return [{
        eventId: 'event-provider-failed',
        schemaVersion: 1,
        eventType: 'run.failed',
        sessionId: 'session-1',
        runId: 'run-1',
        stepId: request.stepId,
        sequence: 1,
        createdAt: '2026-06-01T10:00:01.000Z',
        source: 'provider',
        visibility: 'user',
        persist: 'required',
        payload: {
          error: {
            code: 'context_budget_exceeded',
            message: 'maximum context window exceeded',
            severity: 'error',
            retryable: false,
            source: 'provider',
          },
        },
      }];
    });
    service.createSession({
      title: 'Retry session',
      createdAt: '2026-06-01T10:00:00.000Z',
    });

    const result = await service.sendSessionMessage({
      requestId: 'request-1',
      payload: {
        sessionId: 'session-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: 'Overflow',
          createdAt: '2026-06-01T10:00:00.000Z',
        }],
        createdAt: '2026-06-01T10:00:00.000Z',
      },
    });

    const streamed: RuntimeEvent[] = [];
    for await (const event of result.events) {
      streamed.push(event);
    }

    expect(providerRequests).toHaveLength(1);
    expect(streamed.map((event) => event.eventType)).toContain('run.failed');
    expect(activePathRepo.listRetryAttemptsByRun('run-1')).toEqual([]);
  });

  it.each([
    {
      code: 'provider_auth_failed',
      message: '401 unauthorized',
    },
    {
      code: 'provider_forbidden',
      message: '403 forbidden',
    },
    {
      code: 'provider_invalid_model',
      message: 'invalid model',
    },
    {
      code: 'provider_invalid_request',
      message: 'request payload invalid',
    },
    {
      code: 'runtime_protocol_violation',
      message: 'protocol violation',
    },
  ] as const)('does not retry provider non-transient failure $code', async ({ code, message }) => {
    const failure: RuntimeError = {
      code,
      message,
      severity: 'error',
      retryable: true,
      source: 'provider',
    };
    const providerRequests: ModelStepRuntimeRequest[] = [];
    const { service, activePathRepo } = createServiceWithAutomaticRetryStream((request) => {
      providerRequests.push(request);
      return [providerRunFailedEvent({
        eventId: `event-${failure.code}`,
        stepId: request.stepId,
        error: failure,
      })];
    });
    service.createSession({
      title: `Retry classification ${failure.code}`,
      createdAt: '2026-06-14T00:00:00.000Z',
    });

    const result = await service.sendSessionMessage({
      requestId: `request-${failure.code}`,
      payload: {
        sessionId: 'session-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: failure.code,
          createdAt: '2026-06-14T00:00:00.000Z',
        }],
        createdAt: '2026-06-14T00:00:00.000Z',
      },
    });

    const streamed: RuntimeEvent[] = [];
    for await (const event of result.events) {
      streamed.push(event);
    }

    expect(providerRequests).toHaveLength(1);
    expect(streamed.map((event) => event.eventType)).not.toContain('retry.started');
    expect(activePathRepo.listRetryAttemptsByRun('run-1')).toEqual([]);
  });

  it('does not persist failed-attempt assistant deltas when provider retry succeeds', async () => {
    const { service } = createServiceWithAutomaticRetryStream((request, callIndex) => {
      if (callIndex === 1) {
        return [
          {
            eventId: 'event-partial-delta',
            schemaVersion: 1,
            eventType: 'assistant.output.delta',
            sessionId: 'session-1',
            runId: 'run-1',
            stepId: request.stepId,
            sequence: 1,
            createdAt: '2026-06-14T00:00:01.000Z',
            source: 'provider',
            visibility: 'user',
            persist: 'transient',
            payload: { delta: 'partial failed attempt' },
          },
          providerRunFailedEvent({
            eventId: 'event-provider-timeout',
            stepId: request.stepId,
            error: {
              code: 'provider_network_error',
              message: 'request timed out',
              severity: 'error',
              retryable: true,
              source: 'provider',
            },
          }),
        ];
      }
      return [assistantOutputCompletedEvent(1)];
    });
    service.createSession({
      title: 'Partial delta retry',
      createdAt: '2026-06-14T00:00:00.000Z',
    });

    const result = await service.sendSessionMessage({
      requestId: 'request-partial-delta',
      payload: {
        sessionId: 'session-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: 'Retry after partial delta',
          createdAt: '2026-06-14T00:00:00.000Z',
        }],
        createdAt: '2026-06-14T00:00:00.000Z',
      },
    });

    for await (const _event of result.events) {
      // Drain.
    }

    expect(JSON.stringify(service.listRuntimeEventsByRun('run-1'))).not.toContain('partial failed attempt');
  });

  it('does not automatically retry a transient provider failure after managed file changes', async () => {
    const providerRequests: ModelStepRuntimeRequest[] = [];
    const workspaceChangedFiles: WorkspaceChangedFile[] = [
      workspaceChangedFile({
        changedFileId: 'changed-file-restorable',
        changeSetId: 'change-set-restorable',
        restoreState: 'restorable',
      }),
      workspaceChangedFile({
        changedFileId: 'changed-file-conflict',
        changeSetId: 'change-set-conflict',
        restoreState: 'conflict',
      }),
      workspaceChangedFile({
        changedFileId: 'changed-file-failed',
        changeSetId: 'change-set-failed',
        restoreState: 'restore_failed',
      }),
      workspaceChangedFile({
        changedFileId: 'changed-file-restored',
        changeSetId: 'change-set-restored',
        restoreState: 'restored',
      }),
    ];
    const workspaceChanges = {
      listChangedFilesByRun: vi.fn(() => workspaceChangedFiles),
    };
    const { service, activePathRepo } = createServiceWithAutomaticRetryStream((request) => {
      providerRequests.push(request);
      return [{
        eventId: 'event-provider-failed',
        schemaVersion: 1,
        eventType: 'run.failed',
        sessionId: 'session-1',
        runId: 'run-1',
        stepId: request.stepId,
        sequence: 1,
        createdAt: '2026-06-01T10:00:01.000Z',
        source: 'provider',
        visibility: 'user',
        persist: 'required',
        payload: {
          error: {
            code: 'provider_unavailable',
            message: 'service unavailable',
            severity: 'error',
            retryable: true,
            source: 'provider',
          },
        },
      }];
    }, {
      workspaceChanges,
    });
    service.createSession({
      title: 'Retry session',
      createdAt: '2026-06-01T10:00:00.000Z',
    });

    const result = await service.sendSessionMessage({
      requestId: 'request-1',
      payload: {
        sessionId: 'session-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: 'Change then fail',
          createdAt: '2026-06-01T10:00:00.000Z',
        }],
        createdAt: '2026-06-01T10:00:00.000Z',
      },
    });

    const streamed: RuntimeEvent[] = [];
    for await (const event of result.events) {
      streamed.push(event);
    }

    const eventTypes = streamed.map((event) => event.eventType);
    const detectedEvent = streamed.find((event) => event.eventType === 'workspace.changes.detected_before_retry');

    expect(providerRequests).toHaveLength(1);
    expect(workspaceChanges.listChangedFilesByRun).toHaveBeenCalledWith('run-1');
    expect(eventTypes).toContain('workspace.changes.detected_before_retry');
    expect(eventTypes).not.toContain('retry.started');
    expect(activePathRepo.listRetryAttemptsByRun('run-1')).toEqual([]);
    expect(detectedEvent?.payload).toEqual({
      runId: 'run-1',
      changedFileCount: 3,
      restorableCount: 1,
      changeSetIds: ['change-set-restorable', 'change-set-conflict', 'change-set-failed'],
    });
    expect(Object.keys(detectedEvent?.payload ?? {}).sort()).toEqual([
      'changeSetIds',
      'changedFileCount',
      'restorableCount',
      'runId',
    ]);
    expect(JSON.stringify(detectedEvent)).not.toContain('C:\\project');
    expect(JSON.stringify(detectedEvent)).not.toContain('src/app.ts');
    expect(eventTypes).toContain('run.failed');
  });

  it('fails the run after automatic retry attempts are exhausted', async () => {
    const { service, activePathRepo } = createServiceWithAutomaticRetryStream((request) => [{
      eventId: `event-provider-failed-${Math.random()}`,
      schemaVersion: 1,
      eventType: 'run.failed',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: request.stepId,
      sequence: 1,
      createdAt: '2026-06-01T10:00:01.000Z',
      source: 'provider',
      visibility: 'user',
      persist: 'required',
      payload: {
        error: {
          code: 'provider_network_error',
          message: 'request timed out',
          severity: 'error',
          retryable: true,
          source: 'provider',
        },
      },
    }], {
      maxAutomaticModelStepRetries: 2,
    });
    service.createSession({
      title: 'Retry session',
      createdAt: '2026-06-01T10:00:00.000Z',
    });

    const result = await service.sendSessionMessage({
      requestId: 'request-1',
      payload: {
        sessionId: 'session-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: 'Timeout',
          createdAt: '2026-06-01T10:00:00.000Z',
        }],
        createdAt: '2026-06-01T10:00:00.000Z',
      },
    });

    const streamed: RuntimeEvent[] = [];
    for await (const event of result.events) {
      streamed.push(event);
    }

    expect(streamed.map((event) => event.eventType).filter((type) => type === 'retry.started')).toHaveLength(2);
    expect(streamed.map((event) => event.eventType)).toContain('run.failed');
    expect(activePathRepo.listRetryAttemptsByRun('run-1').map((attempt) => attempt.attemptNumber)).toEqual([1, 2]);
    expect(activePathRepo.listRetryAttemptsByRun('run-1').at(-1)).toMatchObject({
      attemptNumber: 2,
      status: 'exhausted',
      reason: 'network_timeout',
    });
  });

  it('marks a retry attempt failed when the retried stream returns a non-retryable failure', async () => {
    const { service, activePathRepo } = createServiceWithAutomaticRetryStream((request, callIndex) => {
      if (callIndex === 1) {
        return [providerRunFailedEvent({
          eventId: 'event-provider-rate-limit',
          stepId: request.stepId,
          error: {
            code: 'provider_rate_limited',
            message: '429 rate limit',
            severity: 'error',
            retryable: true,
            source: 'provider',
          },
        })];
      }

      return [providerRunFailedEvent({
        eventId: 'event-provider-auth-failed',
        stepId: request.stepId,
        error: {
          code: 'provider_auth_failed',
          message: 'provider authentication failed',
          severity: 'error',
          retryable: false,
          source: 'provider',
        },
      })];
    });
    service.createSession({
      title: 'Retry session',
      createdAt: '2026-06-01T10:00:00.000Z',
    });

    const result = await service.sendSessionMessage({
      requestId: 'request-1',
      payload: {
        sessionId: 'session-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: 'Retry then fail',
          createdAt: '2026-06-01T10:00:00.000Z',
        }],
        createdAt: '2026-06-01T10:00:00.000Z',
      },
    });

    const streamed: RuntimeEvent[] = [];
    for await (const event of result.events) {
      streamed.push(event);
    }

    expect(streamed.map((event) => event.eventType)).toContain('run.failed');
    expect(streamed.map((event) => event.eventType)).not.toContain('retry.completed');
    expect(activePathRepo.listRetryAttemptsByRun('run-1')).toEqual([
      expect.objectContaining({
        attemptNumber: 1,
        status: 'failed',
        reason: 'rate_limited',
        error: expect.objectContaining({
          code: 'provider_auth_failed',
        }),
      }),
    ]);
  });

  it('marks an active retry attempt failed when the retried stream throws a non-retryable runtime error', async () => {
    const authError: RuntimeError = {
      code: 'provider_auth_failed',
      message: 'provider authentication failed',
      severity: 'error',
      retryable: false,
      source: 'provider',
    };
    const { service, activePathRepo } = createServiceWithAutomaticRetryStream((request, callIndex) => {
      if (callIndex === 1) {
        return [providerRunFailedEvent({
          eventId: 'event-provider-rate-limit',
          stepId: request.stepId,
          error: {
            code: 'provider_rate_limited',
            message: '429 rate limit',
            severity: 'error',
            retryable: true,
            source: 'provider',
          },
        })];
      }

      throw authError;
    });
    service.createSession({
      title: 'Retry session',
      createdAt: '2026-06-01T10:00:00.000Z',
    });

    const result = await service.sendSessionMessage({
      requestId: 'request-1',
      payload: {
        sessionId: 'session-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: 'Retry then throw',
          createdAt: '2026-06-01T10:00:00.000Z',
        }],
        createdAt: '2026-06-01T10:00:00.000Z',
      },
    });

    const streamed: RuntimeEvent[] = [];
    for await (const event of result.events) {
      streamed.push(event);
    }

    expect(activePathRepo.listRetryAttemptsByRun('run-1')).toEqual([
      expect.objectContaining({
        attemptNumber: 1,
        status: 'failed',
        error: expect.objectContaining({
          code: 'provider_auth_failed',
        }),
      }),
    ]);
    expect(streamed.find((event) => event.eventType === 'run.failed')?.payload).toMatchObject({
      error: {
        code: 'provider_auth_failed',
      },
    });
  });

  it('preserves provider runtime errors when thrown retries are exhausted', async () => {
    const timeoutError: RuntimeError = {
      code: 'provider_network_error',
      message: 'request timed out',
      severity: 'error',
      retryable: true,
      source: 'provider',
    };
    const { service, activePathRepo } = createServiceWithAutomaticRetryStream(() => {
      throw timeoutError;
    }, {
      maxAutomaticModelStepRetries: 1,
    });
    service.createSession({
      title: 'Retry session',
      createdAt: '2026-06-01T10:00:00.000Z',
    });

    const result = await service.sendSessionMessage({
      requestId: 'request-1',
      payload: {
        sessionId: 'session-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: 'Timeout',
          createdAt: '2026-06-01T10:00:00.000Z',
        }],
        createdAt: '2026-06-01T10:00:00.000Z',
      },
    });

    const streamed: RuntimeEvent[] = [];
    for await (const event of result.events) {
      streamed.push(event);
    }

    expect(activePathRepo.listRetryAttemptsByRun('run-1').at(-1)).toMatchObject({
      status: 'exhausted',
      error: expect.objectContaining({
        code: 'provider_network_error',
      }),
    });
    expect(streamed.find((event) => event.eventType === 'run.failed')?.payload).toMatchObject({
      error: {
        code: 'provider_network_error',
      },
    });
  });

  it('does not retry plain provider auth or config errors thrown by the stream', async () => {
    const providerRequests: ModelStepRuntimeRequest[] = [];
    const { service, activePathRepo } = createServiceWithAutomaticRetryStream((request) => {
      providerRequests.push(request);
      throw new Error('provider authentication failed');
    });
    service.createSession({
      title: 'Retry session',
      createdAt: '2026-06-01T10:00:00.000Z',
    });

    const result = await service.sendSessionMessage({
      requestId: 'request-1',
      payload: {
        sessionId: 'session-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: 'Auth error',
          createdAt: '2026-06-01T10:00:00.000Z',
        }],
        createdAt: '2026-06-01T10:00:00.000Z',
      },
    });

    const streamed: RuntimeEvent[] = [];
    for await (const event of result.events) {
      streamed.push(event);
    }

    expect(providerRequests).toHaveLength(1);
    expect(activePathRepo.listRetryAttemptsByRun('run-1')).toEqual([]);
    expect(streamed.find((event) => event.eventType === 'run.failed')?.payload).toMatchObject({
      error: {
        code: 'runtime_unknown',
      },
    });
  });

  it('cancels automatic retry while waiting in backoff', async () => {
    let releaseBackoff: (() => void) | undefined;
    let markBackoffStarted: (() => void) | undefined;
    const backoffStarted = new Promise<void>((resolve) => {
      markBackoffStarted = resolve;
    });
    const { service, activePathRepo } = createServiceWithAutomaticRetryStream((request) => [{
      eventId: 'event-provider-failed',
      schemaVersion: 1,
      eventType: 'run.failed',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: request.stepId,
      sequence: 1,
      createdAt: '2026-06-01T10:00:01.000Z',
      source: 'provider',
      visibility: 'user',
      persist: 'required',
      payload: {
        error: {
          code: 'provider_rate_limited',
          message: '429 rate limit',
          severity: 'error',
          retryable: true,
          source: 'provider',
        },
      },
    }], {
      retrySleep: async () => {
        markBackoffStarted?.();
        await new Promise<void>((resolve) => {
          releaseBackoff = resolve;
        });
      },
    });
    service.createSession({
      title: 'Retry session',
      createdAt: '2026-06-01T10:00:00.000Z',
    });
    const result = await service.sendSessionMessage({
      requestId: 'request-1',
      payload: {
        sessionId: 'session-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: 'Stop retry',
          createdAt: '2026-06-01T10:00:00.000Z',
        }],
        createdAt: '2026-06-01T10:00:00.000Z',
      },
    });

    const streamed: RuntimeEvent[] = [];
    const consume = (async () => {
      for await (const event of result.events) {
        streamed.push(event);
      }
    })();
    await backoffStarted;
    service.cancelSessionMessage({ targetRequestId: 'request-1' });
    releaseBackoff?.();
    await consume;

    expect(streamed.map((event) => event.eventType)).not.toContain('assistant.output.completed');
    expect(activePathRepo.listRetryAttemptsByRun('run-1').at(-1)).toMatchObject({
      status: 'cancelled',
    });
  });

  it('creates a manual retry attempt for a failed run without overwriting the original run', async () => {
    const { service, repository, activePathRepo } = createManualRetryFixture();

    const result = await service.createManualRetryFromRun({
      requestId: 'retry-request-1',
      runId: 'run-failed',
      createdAt: '2026-06-01T11:00:00.000Z',
    });

    expect(repository.getRun('run-failed')?.status).toBe('failed');
    expect(result.retryAttempt).toMatchObject({
      retryKind: 'manual_retry',
      reason: 'failed',
      baseRunId: 'run-failed',
      status: 'pending',
      retryable: true,
    });
    expect(activePathRepo.getActiveLeaf('session-1')?.leafSourceEntryId).toBe(result.retryAttemptSourceEntry.sourceEntryId);
    expect(result.events.map((event) => event.eventType)).toEqual([
      'run.retry.requested',
      'retry.started',
    ]);
  });

  it('creates a manual rerun branch from a historical completed user message', () => {
    const { service, repository, activePathRepo } = createManualRetryFixture();

    const result = service.createManualRerunFromUserMessage({
      requestId: 'rerun-request-1',
      sessionId: 'session-1',
      messageId: 'message-user-1',
      createdAt: '2026-06-01T11:00:00.000Z',
    });

    expect(repository.getMessage('message-user-1')?.status).toBe('completed');
    expect(result.branchMarker.reason).toBe('branch_from_user_message');
    expect(result.retryAttempt).toMatchObject({
      retryKind: 'manual_rerun',
      reason: 'user_requested',
      status: 'pending',
    });
    expect(activePathRepo.getActiveLeaf('session-1')?.leafSourceEntryId).toBe(result.retryAttemptSourceEntry.sourceEntryId);
    expect(result.seedMessage.content).toBe('Original prompt');
  });

  it('creates a branch marker from a historical completed user message', () => {
    const { service, activePathRepo } = createBranchServiceFixture();

    const result = service.createBranchFromUserMessage({
      requestId: 'request-branch-1',
      sessionId: 'session-1',
      messageId: 'message-3',
      createdAt: '2026-06-01T08:30:00.000Z',
    });

    expect(result.seedMessage).toMatchObject({
      messageId: 'message-3',
      role: 'user',
      content: 'Try a different approach.',
    });
    expect(result.branchMarker).toMatchObject({
      sessionId: 'session-1',
      previousLeafSourceEntryId: 'source-entry-message-4',
      targetLeafSourceEntryId: 'source-entry-message-2',
      reason: 'branch_from_user_message',
    });
    expect(activePathRepo.getActivePath('session-1').entries.map((entry) => entry.sourceEntryId)).toEqual([
      'source-entry-message-1',
      'source-entry-run-1',
      'source-entry-message-2',
      'source-entry-branch-marker-1',
    ]);
    expect(JSON.stringify(activePathRepo.getActivePath('session-1'))).not.toContain('message-4');
    expect(result.events.map((event) => event.eventType)).toEqual([
      'session.branch_marker.created',
      'session.active_leaf.changed',
    ]);
  });

  it('publishes a canonical branch separator when creating a branch draft with a chat stream sink', () => {
    const chatEvents: ChatStreamEvent[] = [];
    const { service } = createBranchServiceFixture({ chatEvents });

    const result = service.createBranchDraft({
      requestId: 'request-branch-draft-1',
      sessionId: 'session-1',
      messageId: 'message-3',
      intent: 'branch',
      createdAt: '2026-06-01T10:00:00.000Z',
    });

    expect(chatEvents).toContainEqual(expect.objectContaining({
      eventType: 'branch.separator.created',
      branchMarkerId: result.branchDraft.branchMarkerId,
      sourceMessageId: 'message-3',
      label: result.branchDraft.label,
    }));
    expect(JSON.stringify(chatEvents)).not.toContain('source-entry-branch-marker');
  });

  it('publishes a branch separator removal when cancelling a draft before send', () => {
    const chatEvents: ChatStreamEvent[] = [];
    const { service } = createBranchServiceFixture({ chatEvents });

    const result = service.createBranchDraft({
      requestId: 'request-branch-draft-1',
      sessionId: 'session-1',
      messageId: 'message-3',
      intent: 'branch',
      createdAt: '2026-06-01T10:00:00.000Z',
    });

    const cancelResult = service.cancelBranchDraft({
      requestId: 'request-branch-cancel-1',
      sessionId: 'session-1',
      branchMarkerId: result.branchDraft.branchMarkerId,
      createdAt: '2026-06-01T10:00:01.000Z',
    });

    expect(cancelResult.cancelled).toBe(true);
    expect(chatEvents).toContainEqual(expect.objectContaining({
      eventType: 'branch.separator.removed',
      branchMarkerId: result.branchDraft.branchMarkerId,
    }));
  });

  it('persists branch draft separators for timeline hydration without waiting for a terminal run event', () => {
    const { service } = createBranchServiceFixture({ useTimelineProjector: true });

    const result = service.createBranchDraft({
      requestId: 'request-branch-draft-1',
      sessionId: 'session-1',
      messageId: 'message-3',
      intent: 'branch',
      createdAt: '2026-06-01T10:00:00.000Z',
    });

    expect(service.listTimelineMessagesBySession({
      projectId: 'session-1',
      sessionId: 'session-1',
    })).toMatchObject({
      diagnostics: [],
      messages: [
        {
          role: 'separator',
          blocks: [{
            kind: 'branch_separator',
            branchMarkerId: result.branchDraft.branchMarkerId,
            sourceMessageId: 'message-3',
            label: result.branchDraft.label,
          }],
        },
      ],
    });
  });

  it('removes hydrated branch draft separators when cancelling before send', () => {
    const { service } = createBranchServiceFixture({ useTimelineProjector: true });

    const result = service.createBranchDraft({
      requestId: 'request-branch-draft-1',
      sessionId: 'session-1',
      messageId: 'message-3',
      intent: 'branch',
      createdAt: '2026-06-01T10:00:00.000Z',
    });

    const cancelResult = service.cancelBranchDraft({
      requestId: 'request-branch-cancel-1',
      sessionId: 'session-1',
      branchMarkerId: result.branchDraft.branchMarkerId,
      createdAt: '2026-06-01T10:00:01.000Z',
    });

    expect(cancelResult.cancelled).toBe(true);
    expect(service.listTimelineMessagesBySession({
      projectId: 'session-1',
      sessionId: 'session-1',
    })).toMatchObject({
      diagnostics: [],
      messages: [],
    });
  });

  it('rejects branching from an assistant message', () => {
    const { service } = createBranchServiceFixture();

    expect(() => service.createBranchFromUserMessage({
      requestId: 'request-branch-1',
      sessionId: 'session-1',
      messageId: 'message-2',
      createdAt: '2026-06-01T08:30:00.000Z',
    })).toThrow('Branch can only start from a completed user message.');
  });

  it('rejects branching from a non-completed user message', () => {
    const { service, repository } = createBranchServiceFixture();
    repository.saveMessage({
      messageId: 'message-draft',
      sessionId: 'session-1',
      role: 'user',
      content: 'Still drafting.',
      status: 'created',
      createdAt: '2026-06-01T08:05:00.000Z',
    });

    expect(() => service.createBranchFromUserMessage({
      requestId: 'request-branch-1',
      sessionId: 'session-1',
      messageId: 'message-draft',
      createdAt: '2026-06-01T08:30:00.000Z',
    })).toThrow('Branch can only start from a completed user message.');
  });

  it('rejects branching when the user message is outside the active path', () => {
    const { service, repository } = createBranchServiceFixture();
    repository.saveMessage({
      messageId: 'message-off-path',
      sessionId: 'session-1',
      role: 'user',
      content: 'Off path.',
      status: 'completed',
      createdAt: '2026-06-01T08:05:00.000Z',
      completedAt: '2026-06-01T08:05:00.000Z',
    });

    expect(() => service.createBranchFromUserMessage({
      requestId: 'request-branch-1',
      sessionId: 'session-1',
      messageId: 'message-off-path',
      createdAt: '2026-06-01T08:30:00.000Z',
    })).toThrow('Branch source entry was not found in the active path.');
  });

  it('cancels a branch draft and restores the previous active leaf', () => {
    const { service, activePathRepo } = createBranchServiceFixture();
    const branch = service.createBranchFromUserMessage({
      requestId: 'request-branch-1',
      sessionId: 'session-1',
      messageId: 'message-3',
      createdAt: '2026-06-01T08:30:00.000Z',
    });

    const cancelled = service.cancelBranchDraft({
      requestId: 'request-branch-cancel-1',
      sessionId: 'session-1',
      branchMarkerId: branch.branchMarker.branchMarkerId,
      createdAt: '2026-06-01T08:31:00.000Z',
    });

    expect(cancelled.cancelled).toBe(true);
    expect(activePathRepo.getActiveLeaf('session-1')?.leafSourceEntryId).toBe('source-entry-message-4');
    expect(cancelled.events.map((event) => event.eventType)).toEqual([
      'session.branch_draft.cancelled',
      'session.active_leaf.changed',
    ]);
  });

  it('records manual rerun intent when sending a branch draft while keeping the draft cancellable before send', async () => {
    const chatEvents: ChatStreamEvent[] = [];
    const { service, activePathRepo } = createBranchServiceFixture({ chatEvents });
    const branch = service.createBranchFromUserMessage({
      requestId: 'request-branch-1',
      sessionId: 'session-1',
      messageId: 'message-3',
      createdAt: '2026-06-01T10:00:00.000Z',
    });

    expect(service.cancelBranchDraft({
      requestId: 'request-cancel-before-send',
      sessionId: 'session-1',
      branchMarkerId: branch.branchMarker.branchMarkerId,
      createdAt: '2026-06-01T10:00:01.000Z',
    }).cancelled).toBe(true);

    const secondBranch = service.createBranchFromUserMessage({
      requestId: 'request-branch-2',
      sessionId: 'session-1',
      messageId: 'message-3',
      createdAt: '2026-06-01T10:00:02.000Z',
    });

    await service.sendSessionMessage({
      requestId: 'request-send-rerun-draft',
      payload: {
        sessionId: 'session-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        message: {
          id: 'message-rerun-new',
          content: 'rerun edited prompt',
          createdAt: '2026-06-01T10:00:03.000Z',
        },
        branchDraft: {
          branchMarkerId: secondBranch.branchMarker.branchMarkerId,
          intent: 'rerun',
        },
        createdAt: '2026-06-01T10:00:03.000Z',
      },
    });

    const attempts = activePathRepo.listRetryAttemptsByRun(String(secondBranch.seedMessage.runId));
    expect(attempts.at(-1)).toMatchObject({
      retryKind: 'manual_rerun',
      reason: 'user_requested',
      status: 'pending',
      retryable: true,
    });
    expect(chatEvents).toContainEqual(expect.objectContaining({
      eventType: 'process.retry.recorded',
      retryAttemptId: attempts.at(-1)?.retryAttemptId,
      status: 'started',
      label: 'Retry attempt 1 started',
      reason: 'user_requested',
    }));
  });

  it('labels manual rerun draft audits with the persisted retry attempt number', async () => {
    const chatEvents: ChatStreamEvent[] = [];
    const { service, activePathRepo } = createBranchServiceFixture({ chatEvents });
    const branch = service.createBranchFromUserMessage({
      requestId: 'request-branch-1',
      sessionId: 'session-1',
      messageId: 'message-3',
      createdAt: '2026-06-01T10:00:00.000Z',
    });
    activePathRepo.saveRetryAttempt({
      retryAttemptId: 'retry-existing-1',
      sessionId: 'session-1',
      runId: String(branch.seedMessage.runId),
      ...(branch.branchMarker.targetLeafSourceEntryId
        ? { baseSourceEntryId: branch.branchMarker.targetLeafSourceEntryId }
        : {}),
      attemptNumber: 1,
      retryKind: 'manual_rerun',
      reason: 'user_requested',
      status: 'failed',
      retryable: true,
      createdAt: '2026-06-01T09:59:00.000Z',
      completedAt: '2026-06-01T09:59:01.000Z',
    });

    await service.sendSessionMessage({
      requestId: 'request-send-rerun-draft',
      payload: {
        sessionId: 'session-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        message: {
          id: 'message-rerun-new',
          content: 'rerun edited prompt',
          createdAt: '2026-06-01T10:00:03.000Z',
        },
        branchDraft: {
          branchMarkerId: branch.branchMarker.branchMarkerId,
          intent: 'rerun',
        },
        createdAt: '2026-06-01T10:00:03.000Z',
      },
    });

    const attempts = activePathRepo.listRetryAttemptsByRun(String(branch.seedMessage.runId));
    expect(attempts.at(-1)).toMatchObject({
      attemptNumber: 2,
      retryKind: 'manual_rerun',
    });
    expect(chatEvents).toContainEqual(expect.objectContaining({
      eventType: 'process.retry.recorded',
      retryAttemptId: attempts.at(-1)?.retryAttemptId,
      attemptNumber: 2,
      status: 'started',
      label: 'Retry attempt 2 started',
    }));
  });

  it('rejects stale rerun branch drafts before creating new message run or active path entries', async () => {
    const { service, repository, activePathRepo } = createBranchServiceFixture();
    const branch = service.createBranchFromUserMessage({
      requestId: 'request-branch-1',
      sessionId: 'session-1',
      messageId: 'message-3',
      createdAt: '2026-06-01T10:00:00.000Z',
    });
    expect(service.cancelBranchDraft({
      requestId: 'request-cancel-before-send',
      sessionId: 'session-1',
      branchMarkerId: branch.branchMarker.branchMarkerId,
      createdAt: '2026-06-01T10:00:01.000Z',
    }).cancelled).toBe(true);
    const messageCount = repository.listMessagesBySession('session-1').length;
    const runCount = repository.listRunsBySession('session-1').length;
    const sourceEntryIds = activePathRepo.listSourceEntriesBySession('session-1')
      .map((entry) => entry.sourceEntryId);

    await expect(service.sendSessionMessage({
      requestId: 'request-send-stale-rerun-draft',
      payload: {
        sessionId: 'session-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        message: {
          id: 'message-rerun-new',
          content: 'rerun edited prompt',
          createdAt: '2026-06-01T10:00:03.000Z',
        },
        branchDraft: {
          branchMarkerId: branch.branchMarker.branchMarkerId,
          intent: 'rerun',
        },
        createdAt: '2026-06-01T10:00:03.000Z',
      },
    })).rejects.toThrow('Branch draft marker is not active.');

    expect(repository.listMessagesBySession('session-1')).toHaveLength(messageCount);
    expect(repository.listRunsBySession('session-1')).toHaveLength(runCount);
    expect(activePathRepo.listSourceEntriesBySession('session-1').map((entry) => entry.sourceEntryId))
      .toEqual(sourceEntryIds);
  });

  it('does not cancel a branch draft after new sources are appended', () => {
    const { service, activePathRepo } = createBranchServiceFixture();
    const branch = service.createBranchFromUserMessage({
      requestId: 'request-branch-1',
      sessionId: 'session-1',
      messageId: 'message-3',
      createdAt: '2026-06-01T08:30:00.000Z',
    });
    activePathRepo.appendSourceEntryAndSetActiveLeaf({
      sourceEntryId: 'source-entry-new-user',
      sessionId: 'session-1',
      parentSourceEntryId: branch.branchMarkerSourceEntry.sourceEntryId,
      sourceRef: {
        sourceKind: 'session_message',
        sourceId: 'message-new-user',
        sourceUri: 'session-message://message-new-user',
        loadedAt: '2026-06-01T08:30:30.000Z',
      },
      createdAt: '2026-06-01T08:30:30.000Z',
    }, {
      sessionId: 'session-1',
      leafSourceEntryId: 'source-entry-new-user',
      updatedAt: '2026-06-01T08:30:30.000Z',
      reason: 'source_appended',
    });

    const cancelled = service.cancelBranchDraft({
      requestId: 'request-branch-cancel-1',
      sessionId: 'session-1',
      branchMarkerId: branch.branchMarker.branchMarkerId,
      createdAt: '2026-06-01T08:31:00.000Z',
    });

    expect(cancelled).toEqual({
      cancelled: false,
      reason: 'branch_has_new_sources',
      events: [],
    });
    expect(activePathRepo.getActiveLeaf('session-1')?.leafSourceEntryId).toBe('source-entry-new-user');
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
      mode: 'default',
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
      mode: 'default',
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

  it('passes permission snapshots and source plan ids into the core run', async () => {
    const records: unknown[] = [];
    const service = createServiceWithPermissionSnapshotRecorder(records);
    service.createSession({
      title: 'Session',
      createdAt: '2026-05-15T00:00:00.000Z',
    });

    const result = await service.startRun({
      sessionId: 'session-1',
      goal: 'Execute plan',
      mode: 'default',
      permissionModeState: {
        permissionMode: 'default',
        source: 'user',
      },
      sourcePlanId: 'plan:accepted',
      createdAt: '2026-05-15T00:00:00.000Z',
    });

    expect(result.run.permissionSnapshotRef).toBe('permission-snapshot:1');
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
      permissionModeState: {
        permissionMode: 'plan',
        source: 'user',
      },
      createdAt: '2026-05-15T00:00:00.000Z',
    });

    expect(result.run.status).toBe('failed');
    expect(records).toEqual([
      expect.objectContaining({ type: 'snapshot' }),
    ]);
  });

  it('sends a session message by persisting user message, run, and model step', async () => {
    const requests: ModelStepRuntimeRequest[] = [];
    const service = createServiceWithModelStepStream([
      {
        eventId: 'event-assistant-delta',
        schemaVersion: 1,
        eventType: 'assistant.output.delta',
        sessionId: 'session-1',
        runId: 'run-1',
        stepId: 'step-1',
        sequence: 1,
        createdAt: '2026-05-17T00:00:01.000Z',
        source: 'provider',
        visibility: 'user',
        persist: 'transient',
        payload: { delta: 'Hello' },
      },
      {
        eventId: 'event-assistant-completed',
        schemaVersion: 1,
        eventType: 'assistant.output.completed',
        sessionId: 'session-1',
        runId: 'run-1',
        stepId: 'step-1',
        sequence: 2,
        createdAt: '2026-05-17T00:00:02.000Z',
        source: 'provider',
        visibility: 'user',
        persist: 'required',
        payload: { content: 'Hello' },
      },
    ], {
      onRequest: (request) => requests.push(request),
    });
    service.createSession({
      title: 'Session',
      createdAt: '2026-05-17T00:00:00.000Z',
    });

    const longRequestId = `ipc-${'a'.repeat(124)}`;
    const result = await service.sendSessionMessage({
      requestId: longRequestId,
      payload: {
        sessionId: 'session-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: 'Hello',
          createdAt: '2026-05-17T00:00:00.000Z',
        }],
        createdAt: '2026-05-17T00:00:00.000Z',
      },
    });
    const streamed = [];
    for await (const event of result.events) {
      streamed.push(event);
    }

    expect(result.data).toEqual({ requestId: longRequestId });
    expect(requests[0]?.inputContext.contextId.length).toBeLessThanOrEqual(128);
    expect(streamed.map((event) => event.eventType)).toEqual([
      'run.started',
      'assistant.output.delta',
      'assistant.output.completed',
      'step.status.changed',
      'step.completed',
      'run.status.changed',
      'run.completed',
    ]);
    expect(streamed[0]).toMatchObject({
      eventType: 'run.started',
      requestId: longRequestId,
      runId: 'run-1',
      sessionId: 'session-1',
      sequence: 1,
    });
    expect(streamed.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(service.listRuntimeEventsByRun('run-1').map((event) => event.eventType)).toContain('assistant.output.completed');
    expect(service.listMessagesBySession('session-1')).toEqual([
      expect.objectContaining({ role: 'user', content: 'Hello', runId: 'run-1' }),
      expect.objectContaining({ role: 'assistant', content: 'Hello', runId: 'run-1', status: 'completed' }),
    ]);
  });

  it('runs compaction before the normal initial model step when budget pressure is reported', async () => {
    const requests: ModelStepRuntimeRequest[] = [];
    const compactionCalls: unknown[] = [];
    const service = createServiceWithModelStepStream([assistantOutputCompletedEvent(1)], {
      onRequest: (request) => requests.push(request),
      sessionContextInputService: {
        buildSessionContextInput: () => ({
          historyEntries: [{
            entryId: 'message-old',
            role: 'user',
            text: 'old context',
            status: 'completed',
            sourceRef: {
              sourceId: 'session-message:message-old',
              sourceKind: 'session_message',
            },
          }, {
            entryId: 'message-recent',
            role: 'assistant',
            text: 'recent context',
            status: 'completed',
            sourceRef: {
              sourceId: 'session-message:message-recent',
              sourceKind: 'session_message',
            },
          }],
        }),
      },
      contextService: {
        createBaselineContext: (input) => ({
          contextId: `context:${input.runId}`,
          runId: input.runId,
          workspaceBoundary: {
            workspaceId: input.workspaceId,
            rootPath: input.workspacePath,
            symlinkPolicy: 'deny_outside_workspace',
            outsideWorkspacePolicy: 'deny',
            secretPolicySummary: 'No secrets.',
            createdAt: '2026-05-17T00:00:00.000Z',
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
          contextBudgetPolicy: {
            modelContextWindow: 400,
            reservedOutputTokens: 10,
            keepRecentTokens: 3,
          },
          buildMetadata: {
            buildReason: 'run_baseline',
            builtAt: '2026-05-17T00:00:00.000Z',
            selectionRecordIds: [],
            redactionRecordIds: [],
            truncationRecordIds: [],
          },
          createdAt: '2026-05-17T00:00:00.000Z',
        }),
      },
      sessionCompactionOrchestrator: {
        async compactIfNeeded(input): Promise<SessionCompactionOrchestrationResult> {
          compactionCalls.push(input);
          return {
            status: 'completed',
            events: [{
              eventId: 'event-compaction-started',
              schemaVersion: 1,
              eventType: 'context.compaction.started',
              runId: input.runId,
              sessionId: input.sessionId,
              stepId: input.stepId,
              requestId: input.requestId,
              sequence: input.startSequence + 1,
              createdAt: '2026-05-17T00:00:00.000Z',
              source: 'main',
              visibility: 'system',
              persist: 'required',
              payload: {
                compactionId: 'compaction-1',
                triggerReason: 'context_budget_pressure',
                tokensBefore: 100,
                firstKeptSourceRef: {
                  sourceId: 'session-message:message-recent',
                  sourceKind: 'session_message',
                },
                summarizedSourceCount: 1,
              },
            }, {
              eventId: 'event-compaction-completed',
              schemaVersion: 1,
              eventType: 'context.compaction.completed',
              runId: input.runId,
              sessionId: input.sessionId,
              stepId: input.stepId,
              requestId: input.requestId,
              sequence: input.startSequence + 2,
              createdAt: '2026-05-17T00:00:00.000Z',
              source: 'main',
              visibility: 'system',
              persist: 'required',
              payload: {
                compactionId: 'compaction-1',
                triggerReason: 'context_budget_pressure',
                tokensBefore: 100,
                firstKeptSourceRef: {
                  sourceId: 'session-message:message-recent',
                  sourceKind: 'session_message',
                },
                summarizedSourceCount: 1,
              },
            }],
            compaction: {
              compactionId: 'compaction-1',
              sessionId: input.sessionId,
              summary: 'summary',
              summaryKind: 'compaction',
              firstKeptSourceRef: {
                sourceId: 'session-message:message-recent',
                sourceKind: 'session_message',
              },
              tokensBefore: 100,
              triggerReason: 'context_budget_pressure',
              status: 'completed',
              createdAt: '2026-05-17T00:00:00.000Z',
            },
          };
        },
      },
    });
    service.createSession({
      title: 'Project session',
      workspaceId: 'workspace-1',
      workspacePath: 'C:/project',
      createdAt: '2026-05-17T00:00:00.000Z',
    });

    const result = await service.sendSessionMessage({
      requestId: 'request-1',
      payload: {
        sessionId: 'session-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: 'Continue',
          createdAt: '2026-05-17T00:00:00.000Z',
        }],
        createdAt: '2026-05-17T00:00:00.000Z',
        context: {
          workspaceId: 'workspace-1',
          workspacePath: 'C:/project',
          permissionMode: 'default',
        },
      },
    });

    const streamed: RuntimeEvent[] = [];
    for await (const event of result.events) {
      streamed.push(event);
    }

    expect(compactionCalls).toHaveLength(1);
    expect(requests).toHaveLength(1);
    expect(streamed.map((event) => event.eventType)).toEqual(expect.arrayContaining([
      'run.started',
      'context.compaction.started',
      'context.compaction.completed',
      'assistant.output.completed',
      'run.completed',
    ]));
    expect(streamed.find((event) => event.eventType === 'run.started')?.sequence).toBe(1);
    expect(streamed.find((event) => event.eventType === 'context.compaction.started')?.sequence).toBe(2);
  });

  it('blocks provider streaming when the initial model step input build fails', async () => {
    const requests: ModelStepRuntimeRequest[] = [];
    const buildInputs: BuildModelStepInputInput[] = [];
    const service = createServiceWithModelStepStream([assistantOutputCompletedEvent(1)], {
      onRequest: (request) => requests.push(request),
      sessionCompactionOrchestrator: {
        async compactIfNeeded(): Promise<SessionCompactionOrchestrationResult> {
          return { status: 'skipped', events: [] };
        },
      },
      modelStepInputBuildService: {
        async buildModelStepInput(input): Promise<BuildModelStepInputResult> {
          buildInputs.push(input);
          const result = successfulModelStepInputBuild(input);
          if (input.contextKind === 'initial') {
            return {
              ...result,
              failure: {
                code: 'context_required_over_budget',
                message: 'Required model input exceeds the available context budget.',
                retryable: false,
              },
            };
          }
          return result;
        },
      },
    });
    service.createSession({
      title: 'Project session',
      workspaceId: 'workspace-1',
      workspacePath: 'C:/project',
      createdAt: '2026-05-17T00:00:00.000Z',
    });

    const result = await service.sendSessionMessage({
      requestId: 'request-1',
      payload: {
        sessionId: 'session-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: 'x'.repeat(1000),
          createdAt: '2026-05-17T00:00:00.000Z',
        }],
        createdAt: '2026-05-17T00:00:00.000Z',
        context: {
          workspaceId: 'workspace-1',
          workspacePath: 'C:/project',
          permissionMode: 'default',
        },
      },
    });

    const streamed: RuntimeEvent[] = [];
    for await (const event of result.events) {
      streamed.push(event);
    }

    expect(buildInputs.map((input) => input.contextKind)).toEqual(['compaction-probe', 'initial']);
    expect(requests).toEqual([]);
    expect(streamed.map((event) => event.eventType)).toEqual([
      'run.started',
      'run.failed',
      'step.status.changed',
      'step.failed',
      'run.status.changed',
    ]);
    expect(streamed.find((event) => event.eventType === 'run.failed')?.payload).toMatchObject({
      error: {
        code: 'context_budget_exceeded',
        retryable: false,
        source: 'main',
      },
    });
  });

  it('fails the run when the compaction probe model input build throws before provider streaming', async () => {
    const requests: ModelStepRuntimeRequest[] = [];
    const service = createServiceWithModelStepStream([assistantOutputCompletedEvent(1)], {
      onRequest: (request) => requests.push(request),
      modelStepInputBuildService: {
        async buildModelStepInput(input): Promise<BuildModelStepInputResult> {
          if (input.contextKind === 'compaction-probe') {
            throw new Error('compaction probe build exploded');
          }
          return successfulModelStepInputBuild(input);
        },
      },
    });
    service.createSession({
      title: 'Project session',
      workspaceId: 'workspace-1',
      workspacePath: 'C:/project',
      createdAt: '2026-05-17T00:00:00.000Z',
    });

    const result = await service.sendSessionMessage({
      requestId: 'request-1',
      payload: {
        sessionId: 'session-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: 'x'.repeat(1000),
          createdAt: '2026-05-17T00:00:00.000Z',
        }],
        createdAt: '2026-05-17T00:00:00.000Z',
        context: {
          workspaceId: 'workspace-1',
          workspacePath: 'C:/project',
          permissionMode: 'default',
        },
      },
    });

    const streamed: RuntimeEvent[] = [];
    for await (const event of result.events) {
      streamed.push(event);
    }

    const repository = new SessionRunRepository(db!);
    expect(requests).toEqual([]);
    expect(streamed.map((event) => event.eventType)).toEqual([
      'run.started',
      'run.failed',
      'step.status.changed',
      'step.failed',
      'run.status.changed',
    ]);
    expect(streamed.find((event) => event.eventType === 'run.failed')?.payload).toMatchObject({
      error: {
        code: 'runtime_unknown',
        message: 'compaction probe build exploded',
        retryable: false,
        source: 'core',
      },
    });
    expect(repository.getRun('run-1')?.status).toBe('failed');
    expect(repository.listStepsByRun('run-1').map((step) => step.status)).toEqual(['failed']);
  });

  it('fails the run when tool runtime creation throws before provider streaming', async () => {
    const requests: ModelStepRuntimeRequest[] = [];
    const service = createServiceWithModelStepStream([assistantOutputCompletedEvent(1)], {
      onRequest: (request) => requests.push(request),
      toolRuntimeFactory: {
        async create() {
          throw new Error('tool runtime create exploded');
        },
      },
    });
    service.createSession({
      title: 'Project session',
      workspaceId: 'workspace-1',
      workspacePath: 'C:/project',
      createdAt: '2026-05-17T00:00:00.000Z',
    });

    const result = await service.sendSessionMessage({
      requestId: 'request-1',
      payload: {
        sessionId: 'session-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: 'Run a project task.',
          createdAt: '2026-05-17T00:00:00.000Z',
        }],
        createdAt: '2026-05-17T00:00:00.000Z',
        context: {
          workspaceId: 'workspace-1',
          workspacePath: 'C:/project',
          permissionMode: 'default',
        },
      },
    });

    const streamed: RuntimeEvent[] = [];
    for await (const event of result.events) {
      streamed.push(event);
    }

    const repository = new SessionRunRepository(db!);
    expect(requests).toEqual([]);
    expect(streamed.map((event) => event.eventType)).toEqual([
      'run.started',
      'run.failed',
      'step.status.changed',
      'step.failed',
      'run.status.changed',
    ]);
    expect(streamed.find((event) => event.eventType === 'run.failed')?.payload).toMatchObject({
      error: {
        code: 'runtime_unknown',
        message: 'tool runtime create exploded',
        retryable: false,
        source: 'core',
      },
    });
    expect(repository.getRun('run-1')?.status).toBe('failed');
    expect(repository.listStepsByRun('run-1').map((step) => step.status)).toEqual(['failed']);
  });

  it('recalls memory before the compaction probe and reuses that source for the initial build', async () => {
    const requests: ModelStepRuntimeRequest[] = [];
    const buildInputs: BuildModelStepInputInput[] = [];
    const order: string[] = [];
    const memoryRecallSources = [{
      sourceId: 'memory-recall:snapshot-1',
      text: 'Relevant long-term memory:\n\n1. [user/preference] Prefer pnpm commands.',
      memoryIds: ['memory-user-1'],
      loadedAt: '2026-05-17T00:00:00.000Z',
      metadata: {
        snapshotId: 'memory-recall-snapshot-1',
        recallRequestId: 'memory-recall-request-1',
        selectedCount: 1,
      },
    }];
    const memoryRecallSeed = {
      queryText: 'Review package scripts',
      metadata: {
        snapshotId: 'memory-recall-snapshot-1',
        recallRequestId: 'memory-recall-request-1',
        selectedCount: 1,
      },
    };
    const recallForNewUserInput = vi.fn(async (input) => {
      order.push('recall');
      expect(input).toMatchObject({
        homePath: 'C:/megumi-home',
        projectId: 'workspace-1',
        projectRoot: 'C:/project',
        effectiveCwd: 'C:/project',
        sessionId: 'session-1',
        runId: 'run-1',
        modelStepId: 'step-1',
        queryText: 'Review package scripts',
        createdAt: '2026-05-17T00:00:00.000Z',
      });
      return {
        status: 'ok' as const,
        memoryRecallSources,
        memoryRecallSeed,
        diagnostics: [],
      };
    });
    const service = createServiceWithModelStepStream([assistantOutputCompletedEvent(1)], {
      onRequest: (request) => requests.push(request),
      megumiHomePath: 'C:/megumi-home',
      memoryRecallService: { recallForNewUserInput },
      sessionCompactionOrchestrator: {
        async compactIfNeeded(input): Promise<SessionCompactionOrchestrationResult> {
          order.push('compact');
          expect(input.budgetProbeInputContext.parts).toEqual(expect.arrayContaining([
            expect.objectContaining({
              kind: 'memory',
              memoryKind: 'memory_recall',
              text: expect.stringContaining('Prefer pnpm commands.'),
            }),
          ]));
          return { status: 'skipped', events: [] };
        },
      },
      modelStepInputBuildService: {
        async buildModelStepInput(input): Promise<BuildModelStepInputResult> {
          order.push(`build:${input.contextKind}`);
          buildInputs.push(input);
          return successfulModelStepInputBuild(input);
        },
      },
    });
    service.createSession({
      title: 'Project session',
      workspaceId: 'workspace-1',
      workspacePath: 'C:/project',
      createdAt: '2026-05-17T00:00:00.000Z',
    });

    const result = await service.sendSessionMessage({
      requestId: 'request-1',
      payload: {
        sessionId: 'session-1',
        providerId: 'openai',
        modelId: 'gpt-4.1',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: 'Review package scripts',
          createdAt: '2026-05-17T00:00:00.000Z',
        }],
        createdAt: '2026-05-17T00:00:00.000Z',
        context: {
          workspaceId: 'workspace-1',
          workspacePath: 'C:/project',
          permissionMode: 'default',
        },
      },
    });
    for await (const _event of result.events) {
      // drain stream
    }

    expect(order).toEqual(['recall', 'build:compaction-probe', 'compact', 'build:initial']);
    expect(buildInputs.map((input) => input.contextKind)).toEqual(['compaction-probe', 'initial']);
    expect(buildInputs[0]?.memoryRecallSources).toBe(memoryRecallSources);
    expect(buildInputs[1]?.memoryRecallSources).toBe(memoryRecallSources);
    expect(buildInputs[0]?.memoryRecallSeed).toBe(memoryRecallSeed);
    expect(buildInputs[1]?.memoryRecallSeed).toBe(memoryRecallSeed);
    expect(requests[0]?.inputContext.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'memory',
        memoryKind: 'memory_recall',
        required: false,
        text: expect.stringContaining('Prefer pnpm commands.'),
      }),
    ]));
    expect(service.listMessagesBySession('session-1').some((message) => (
      message.content.includes('Prefer pnpm commands.')
    ))).toBe(false);
    expect(recallForNewUserInput).toHaveBeenCalledTimes(1);
  });

  it('reuses the run-scoped recalled memory snapshot for tool continuation without recalling again', async () => {
    const requests: ModelStepRuntimeRequest[] = [];
    const memoryRecallSources = [{
      sourceId: 'memory-recall:snapshot-tool',
      text: 'Relevant long-term memory:\n\n1. [project/fact] Use the existing session service tests.',
      memoryIds: ['memory-project-1'],
      loadedAt: '2026-05-17T00:00:00.000Z',
      metadata: {
        snapshotId: 'memory-recall-snapshot-tool',
        recallRequestId: 'memory-recall-request-tool',
        selectedCount: 1,
      },
    }];
    const memoryRecallSeed = {
      queryText: 'Read package.json',
      metadata: {
        snapshotId: 'memory-recall-snapshot-tool',
        recallRequestId: 'memory-recall-request-tool',
        selectedCount: 1,
      },
    };
    const recallForNewUserInput = vi.fn(async () => ({
      status: 'ok' as const,
      memoryRecallSources,
      memoryRecallSeed,
      diagnostics: [],
    }));
    const service = createServiceWithModelStepStream((request, callIndex) => {
      requests.push(request);
      if (callIndex === 1) {
        return [
          toolUseCreatedEvent(1),
          modelStepCompletedEvent(2),
        ];
      }
      return [{ ...assistantOutputCompletedEvent(1), stepId: request.stepId }];
    }, {
      megumiHomePath: 'C:/megumi-home',
      memoryRecallService: { recallForNewUserInput },
      toolRuntimeFactory: {
        async create() {
          return {
            async handleToolCalls() {
              return {
                toolResults: [createToolResult({
                  createdAt: '2026-05-17T00:00:02.500Z',
                  toolCallId: 'tool-call-1',
                })],
                runtimeEvents: [],
              };
            },
            async resumeToolApproval() {
              return undefined;
            },
          };
        },
      },
      toolDefinitionProvider: {
        listDefinitions: () => [{
          name: 'read_file',
          title: 'Read file',
          description: 'Read a file.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
          capabilities: ['project_read'],
          riskLevel: 'low',
          sideEffect: 'none',
          availability: { status: 'available' },
        }],
      },
    });
    service.createSession({
      title: 'Project session',
      workspaceId: 'workspace-1',
      workspacePath: 'C:/project',
      createdAt: '2026-05-17T00:00:00.000Z',
    });

    const result = await service.sendSessionMessage({
      requestId: 'request-1',
      payload: {
        sessionId: 'session-1',
        providerId: 'openai',
        modelId: 'gpt-4.1',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: 'Read package.json',
          createdAt: '2026-05-17T00:00:00.000Z',
        }],
        createdAt: '2026-05-17T00:00:00.000Z',
        context: {
          workspaceId: 'workspace-1',
          workspacePath: 'C:/project',
          permissionMode: 'default',
        },
      },
    });
    for await (const _event of result.events) {
      // drain stream
    }

    expect(recallForNewUserInput).toHaveBeenCalledTimes(1);
    expect(requests).toHaveLength(2);
    expect(requests[1]?.inputContext.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'memory',
        memoryKind: 'memory_recall',
        text: expect.stringContaining('existing session service tests'),
      }),
    ]));
    expect(requests[1]?.inputContext.trace.metadata).toMatchObject({
      memoryRecallSeed,
    });
  });

  it('recalls for each independent new user input while tool continuation reuses the same run snapshot', async () => {
    const requests: ModelStepRuntimeRequest[] = [];
    const recallForNewUserInput = vi.fn(async (input) => ({
      memoryRecallSources: [{
        sourceId: `memory-recall:snapshot-${input.runId}`,
        text: `Relevant long-term memory:\n\n1. [user/fact] Recall for ${input.runId}.`,
        memoryIds: [`memory-${input.runId}`],
        loadedAt: '2026-05-17T00:00:00.000Z',
        metadata: {
          snapshotId: `memory-recall-snapshot-${input.runId}`,
          recallRequestId: `memory-recall-request-${input.runId}`,
          selectedCount: 1,
        },
      }],
      memoryRecallSeed: {
        queryText: input.queryText,
        metadata: {
          snapshotId: `memory-recall-snapshot-${input.runId}`,
          recallRequestId: `memory-recall-request-${input.runId}`,
          selectedCount: 1,
        },
      },
    }));
    let nextRun = 0;
    const service = createServiceWithModelStepStream((request, callIndex) => {
      requests.push(request);
      if (callIndex === 1) {
        return [
          toolUseCreatedEvent(1),
          modelStepCompletedEvent(2),
        ];
      }
      return [{ ...assistantOutputCompletedEvent(1), stepId: request.stepId }];
    }, {
      runId: () => {
        nextRun += 1;
        return `run-${nextRun}`;
      },
      megumiHomePath: 'C:/megumi-home',
      memoryRecallService: { recallForNewUserInput },
      toolRuntimeFactory: {
        async create() {
          return {
            async handleToolCalls() {
              return {
                toolResults: [createToolResult({
                  createdAt: '2026-05-17T00:00:02.500Z',
                  toolCallId: 'tool-call-1',
                })],
                runtimeEvents: [],
              };
            },
            async resumeToolApproval() {
              return undefined;
            },
          };
        },
      },
      toolDefinitionProvider: {
        listDefinitions: () => [{
          name: 'read_file',
          title: 'Read file',
          description: 'Read a file.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
          capabilities: ['project_read'],
          riskLevel: 'low',
          sideEffect: 'none',
          availability: { status: 'available' },
        }],
      },
    });
    service.createSession({
      title: 'Project session',
      workspaceId: 'workspace-1',
      workspacePath: 'C:/project',
      createdAt: '2026-05-17T00:00:00.000Z',
    });

    const first = await service.sendSessionMessage({
      requestId: 'request-1',
      payload: {
        sessionId: 'session-1',
        providerId: 'openai',
        modelId: 'gpt-4.1',
        messages: [{
          id: 'message-local-user-1',
          role: 'user',
          content: 'Read package.json',
          createdAt: '2026-05-17T00:00:00.000Z',
        }],
        createdAt: '2026-05-17T00:00:00.000Z',
        context: {
          workspaceId: 'workspace-1',
          workspacePath: 'C:/project',
          permissionMode: 'default',
        },
      },
    });
    for await (const _event of first.events) {
      // drain first run including tool continuation
    }

    const second = await service.sendSessionMessage({
      requestId: 'request-2',
      payload: {
        sessionId: 'session-1',
        providerId: 'openai',
        modelId: 'gpt-4.1',
        messages: [{
          id: 'message-local-user-2',
          role: 'user',
          content: 'Summarize the result',
          createdAt: '2026-05-17T00:00:05.000Z',
        }],
        createdAt: '2026-05-17T00:00:05.000Z',
        context: {
          workspaceId: 'workspace-1',
          workspacePath: 'C:/project',
          permissionMode: 'default',
        },
      },
    });
    for await (const _event of second.events) {
      // drain second run
    }

    expect(recallForNewUserInput).toHaveBeenCalledTimes(2);
    expect(recallForNewUserInput.mock.calls.map(([input]) => [input.runId, input.queryText])).toEqual([
      ['run-1', 'Read package.json'],
      ['run-2', 'Summarize the result'],
    ]);
    expect(requests.map((request) => request.runId)).toEqual(['run-1', 'run-1', 'run-2']);
    expect(requests[1]?.inputContext.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'memory',
        text: expect.stringContaining('Recall for run-1.'),
      }),
    ]));
    expect(requests[2]?.inputContext.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'memory',
        text: expect.stringContaining('Recall for run-2.'),
      }),
    ]));
  });

  it('keeps memory recall optional when only megumiHomePath is configured', async () => {
    const requests: ModelStepRuntimeRequest[] = [];
    const service = createServiceWithModelStepStream([assistantOutputCompletedEvent(1)], {
      megumiHomePath: 'C:/megumi-home',
      onRequest: (request) => requests.push(request),
    });
    service.createSession({
      title: 'Project session',
      workspaceId: 'workspace-1',
      workspacePath: 'C:/project',
      createdAt: '2026-05-17T00:00:00.000Z',
    });

    const result = await service.sendSessionMessage({
      requestId: 'request-1',
      payload: {
        sessionId: 'session-1',
        providerId: 'openai',
        modelId: 'gpt-4.1',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: 'No recall service configured',
          createdAt: '2026-05-17T00:00:00.000Z',
        }],
        createdAt: '2026-05-17T00:00:00.000Z',
        context: {
          workspaceId: 'workspace-1',
          workspacePath: 'C:/project',
          permissionMode: 'default',
        },
      },
    });
    for await (const _event of result.events) {
      // drain stream
    }

    expect(requests).toHaveLength(1);
    expect(requests[0]?.inputContext.parts.some((part) => part.kind === 'memory')).toBe(false);
  });

  it('passes disabled memory settings to recall and completed-run capture', async () => {
    const recallForNewUserInput = vi.fn(async () => ({
      memoryRecallSources: [],
      diagnostics: [],
    }));
    const isMemoryEnabled = vi.fn(() => false);
    const memoryCaptureService = {
      calls: [] as unknown[],
      async evaluateRunCompletedCapture(input: unknown) {
        this.calls.push(input);
        return { status: 'skipped' as const, reason: 'memory_disabled' };
      },
    };
    const service = createServiceWithModelStepStream([assistantOutputCompletedEvent(1)], {
      megumiHomePath: 'C:/megumi-home',
      memoryRecallService: { recallForNewUserInput },
      memoryCaptureService,
      memorySettingsProvider: {
        isMemoryEnabled,
      },
    });
    service.createSession({
      title: 'Project session',
      workspaceId: 'workspace-1',
      workspacePath: 'C:/project',
      createdAt: '2026-05-17T00:00:00.000Z',
    });

    const result = await service.sendSessionMessage({
      requestId: 'request-memory-disabled',
      payload: {
        sessionId: 'session-1',
        providerId: 'openai',
        modelId: 'gpt-4.1',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: 'Please remember this preference.',
          createdAt: '2026-05-17T00:00:00.000Z',
        }],
        createdAt: '2026-05-17T00:00:00.000Z',
        context: {
          workspaceId: 'workspace-1',
          workspacePath: 'C:/project',
          permissionMode: 'default',
        },
      },
    });
    for await (const _event of result.events) {
      // drain stream
    }

    expect(recallForNewUserInput).toHaveBeenCalledWith(expect.objectContaining({
      enabled: false,
    }));
    expect(isMemoryEnabled).toHaveBeenCalledWith();
    expect(memoryCaptureService.calls).toEqual([
      expect.objectContaining({
        memoryEnabled: false,
      }),
    ]);
  });

  it('defaults missing memory settings to disabled for recall and completed-run capture', async () => {
    const recallForNewUserInput = vi.fn(async () => ({
      memoryRecallSources: [],
      diagnostics: [],
    }));
    const isMemoryEnabled = vi.fn(() => false);
    const memoryCaptureService = {
      calls: [] as unknown[],
      async evaluateRunCompletedCapture(input: unknown) {
        this.calls.push(input);
        return { status: 'skipped' as const, reason: 'memory_disabled' };
      },
    };
    const service = createServiceWithModelStepStream([assistantOutputCompletedEvent(1)], {
      megumiHomePath: 'C:/megumi-home',
      memoryRecallService: { recallForNewUserInput },
      memoryCaptureService,
      memorySettingsProvider: {
        isMemoryEnabled,
      },
    });
    service.createSession({
      title: 'Project session',
      workspaceId: 'workspace-1',
      workspacePath: 'C:/project',
      createdAt: '2026-05-17T00:00:00.000Z',
    });

    const result = await service.sendSessionMessage({
      requestId: 'request-memory-missing-settings',
      payload: {
        sessionId: 'session-1',
        providerId: 'openai',
        modelId: 'gpt-4.1',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: 'Please remember this preference.',
          createdAt: '2026-05-17T00:00:00.000Z',
        }],
        createdAt: '2026-05-17T00:00:00.000Z',
        context: {
          workspaceId: 'workspace-1',
          workspacePath: 'C:/project',
          permissionMode: 'default',
        },
      },
    });
    for await (const _event of result.events) {
      // drain stream
    }

    expect(recallForNewUserInput).toHaveBeenCalledWith(expect.objectContaining({
      enabled: false,
    }));
    expect(isMemoryEnabled).toHaveBeenCalledWith();
    expect(memoryCaptureService.calls).toEqual([
      expect.objectContaining({
        memoryEnabled: false,
      }),
    ]);
  });

  it('schedules project markdown sync when creating a project session', () => {
    const memoryMarkdownSyncService = {
      calls: [] as unknown[],
      async syncProjectMirrorOnProjectOpened(input: unknown) {
        this.calls.push(input);
        return { status: 'synced' as const };
      },
    };
    const service = createServiceWithModelStepStream([assistantOutputCompletedEvent(1)], {
      megumiHomePath: 'C:/megumi-home',
      memoryMarkdownSyncService,
      memorySettingsProvider: {
        isMemoryEnabled: () => true,
      },
    });

    service.createSession({
      title: 'Project session',
      workspaceId: 'workspace-1',
      workspacePath: 'C:/project',
      createdAt: '2026-05-17T00:00:00.000Z',
    });

    expect(memoryMarkdownSyncService.calls).toEqual([
      {
        homePath: 'C:/megumi-home',
        projectId: 'workspace-1',
      },
    ]);
  });

  it('schedules memory capture after a completed run without writing memory to transcript', async () => {
    const memoryCaptureService = {
      calls: [] as unknown[],
      async evaluateRunCompletedCapture(input: unknown) {
        this.calls.push(input);
        return { status: 'skipped' as const, reason: 'no_long_term_signal' };
      },
    };
    const service = createServiceWithModelStepStream([assistantOutputCompletedEvent(1)], {
      memoryCaptureService,
      megumiHomePath: 'C:/megumi-home',
    });
    service.createSession({
      title: 'Session',
      workspaceId: 'project-1',
      workspacePath: 'C:/workspace/project',
      createdAt: '2026-06-13T00:00:00.000Z',
    });

    const result = await service.sendSessionMessage({
      requestId: 'ipc-session-message-send-1',
      payload: {
        sessionId: 'session-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: 'Please remember that I prefer concise answers.',
          createdAt: '2026-06-13T00:00:00.000Z',
        }],
        createdAt: '2026-06-13T00:00:00.000Z',
      },
    });
    const streamed = [];
    for await (const event of result.events) streamed.push(event);

    expect(streamed.map((event) => event.eventType)).toContain('run.completed');
    expect(memoryCaptureService.calls).toEqual([
      expect.objectContaining({
        homePath: 'C:/megumi-home',
        runId: 'run-1',
        sessionId: 'session-1',
        projectId: 'project-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        runStatus: 'completed',
        userText: 'Please remember that I prefer concise answers.',
        assistantText: 'Final answer after tool result.',
        hasProject: true,
      }),
    ]);
    const transcriptRoles = service.listMessagesBySession('session-1').map((message) => message.role);
    expect(transcriptRoles).toHaveLength(2);
    expect(transcriptRoles).toEqual(expect.arrayContaining(['user', 'assistant']));
  });

  it('passes source-of-truth workspace change metadata to completed-run capture', async () => {
    const memoryCaptureService = {
      calls: [] as unknown[],
      async evaluateRunCompletedCapture(input: unknown) {
        this.calls.push(input);
        return { status: 'skipped' as const, reason: 'no_long_term_signal' };
      },
    };
    const workspaceChanges = {
      listChangedFilesByRun: vi.fn(() => [
        workspaceChangedFile({
          projectPath: '.local-docs/specs/18-context-instruction-and-long-term-memory-foundation/02-long-term-memory-runtime-loop.md',
        }),
      ]),
    };
    const service = createServiceWithModelStepStream([assistantOutputCompletedEvent(1)], {
      memoryCaptureService,
      megumiHomePath: 'C:/megumi-home',
      workspaceChanges,
    });
    service.createSession({
      title: 'Session',
      workspaceId: 'project-1',
      workspacePath: 'C:/workspace/project',
      createdAt: '2026-06-13T00:00:00.000Z',
    });

    const result = await service.sendSessionMessage({
      requestId: 'ipc-session-message-send-1',
      payload: {
        sessionId: 'session-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: '同意，按这个 spec 执行。',
          createdAt: '2026-06-13T00:00:00.000Z',
        }],
        createdAt: '2026-06-13T00:00:00.000Z',
      },
    });
    for await (const _event of result.events) {
      // drain stream
    }

    expect(workspaceChanges.listChangedFilesByRun).toHaveBeenCalledWith('run-1');
    expect(memoryCaptureService.calls).toEqual([
      expect.objectContaining({
        signals: expect.arrayContaining(['source_of_truth_doc_changed']),
        toolActivitySummary: expect.stringContaining('02-long-term-memory-runtime-loop.md'),
      }),
    ]);
  });

  it('does not schedule memory capture for provider failed runs', async () => {
    const memoryCaptureService = {
      calls: [] as unknown[],
      async evaluateRunCompletedCapture(input: unknown) {
        this.calls.push(input);
        return { status: 'skipped' as const, reason: 'not_expected' };
      },
    };
    const service = createServiceWithModelStepStream([
      providerRunFailedEvent({
        eventId: 'event-provider-failed',
        stepId: 'step-1',
        error: {
          code: 'provider_auth_failed',
          message: 'Provider failed.',
          severity: 'error',
          retryable: false,
          source: 'provider',
        },
      }),
    ], {
      memoryCaptureService,
      megumiHomePath: 'C:/megumi-home',
    });
    service.createSession({
      title: 'Session',
      createdAt: '2026-06-13T00:00:00.000Z',
    });

    const result = await service.sendSessionMessage({
      requestId: 'ipc-session-message-send-1',
      payload: {
        sessionId: 'session-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: 'Remember this.',
          createdAt: '2026-06-13T00:00:00.000Z',
        }],
        createdAt: '2026-06-13T00:00:00.000Z',
      },
    });
    for await (const _event of result.events) {
      // drain
    }

    expect(memoryCaptureService.calls).toEqual([]);
  });

  it('does not let memory capture failures change completed run output', async () => {
    const memoryCaptureService = {
      async evaluateRunCompletedCapture() {
        throw new Error('capture failed');
      },
    };
    const service = createServiceWithModelStepStream([assistantOutputCompletedEvent(1)], {
      memoryCaptureService,
      megumiHomePath: 'C:/megumi-home',
    });
    service.createSession({
      title: 'Session',
      createdAt: '2026-06-13T00:00:00.000Z',
    });

    const result = await service.sendSessionMessage({
      requestId: 'ipc-session-message-send-1',
      payload: {
        sessionId: 'session-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: 'Remember this.',
          createdAt: '2026-06-13T00:00:00.000Z',
        }],
        createdAt: '2026-06-13T00:00:00.000Z',
      },
    });
    const streamed = [];
    for await (const event of result.events) streamed.push(event);

    expect(streamed.at(-1)?.eventType).toBe('run.completed');
    expect(service.listRuntimeEventsByRun('run-1').at(-1)?.eventType).toBe('run.completed');
  });

  it('uses the latest completed compaction when building the normal model step after maintenance compaction', async () => {
    const requests: ModelStepRuntimeRequest[] = [];
    db = new Database(':memory:');
    migrateDatabase(db);
    const repository = new SessionRunRepository(db);
    const activePathRepo = new SessionActivePathRepository(db);
    const service = new SessionRunService({
      repository,
      activePathRepository: activePathRepo,
      sessionCompactionOrchestrator: {
        async compactIfNeeded(input): Promise<SessionCompactionOrchestrationResult> {
          repository.saveSessionCompaction({
            compactionId: 'compaction-1',
            sessionId: input.sessionId,
            summary: 'Compacted context summary from prior turns.',
            summaryKind: 'compaction',
            firstKeptSourceRef: {
              sourceId: 'message-kept',
              sourceKind: 'session_message',
              sourceUri: 'session-message://message-kept',
              loadedAt: '2026-05-31T11:02:00.000Z',
            },
            tokensBefore: 9000,
            triggerReason: 'context_budget_pressure',
            status: 'completed',
            createdAt: '2026-05-31T11:04:00.000Z',
          });
          const parent = activePathRepo.getActiveLeaf(input.sessionId)?.leafSourceEntryId;
          activePathRepo.appendSourceEntry({
            sourceEntryId: 'source-entry-compaction-1',
            sessionId: input.sessionId,
            ...(parent ? { parentSourceEntryId: parent } : {}),
            sourceRef: {
              sourceKind: 'session_summary',
              sourceId: 'compaction-1',
              sourceUri: 'session-compaction://compaction-1',
              loadedAt: '2026-05-31T11:04:00.000Z',
            },
            createdAt: '2026-05-31T11:04:00.000Z',
          });
          activePathRepo.setActiveLeaf({
            sessionId: input.sessionId,
            leafSourceEntryId: 'source-entry-compaction-1',
            updatedAt: '2026-05-31T11:04:00.000Z',
            reason: 'source_appended',
          });
          return { status: 'completed', events: [], compaction: repository.getSessionCompaction('compaction-1')! };
        },
      },
      modelStepProvider: {
        streamModelStep: async function* (request) {
          requests.push(request);
          yield assistantOutputCompletedEvent(1);
        },
        completeModelStep: async () => ({ ok: true, text: '' }),
      cancelModelStep: () => true,
      },
      clock: { now: () => '2026-05-31T11:05:00.000Z' },
      ids: {
        sessionId: () => 'session-1',
        runId: () => 'run-1',
        stepId: () => 'step-1',
        actionId: () => 'action-1',
        observationId: () => 'observation-1',
        checkpointId: () => 'checkpoint-1',
        resumeRequestId: () => 'resume-request-1',
        cancelRequestId: () => 'cancel-request-1',
        retryRequestId: () => 'retry-request-1',
        compactionId: () => 'compaction-1',
        eventId: () => `event-${Math.random().toString(36).slice(2)}`,
        messageId: (() => {
          let index = 0;
          return () => {
            index += 1;
            return index === 1 ? 'message-current' : `message-generated-${index}`;
          };
        })(),
        debugId: () => 'debug-1',
        chatStreamEventId: () => 'chat-stream-event-1',
        chatStreamId: () => 'chat-stream-1',
        chatTextId: () => 'text-1',
        chatThinkingId: () => 'thinking-1',
        sourceEntryId: (() => {
          let index = 0;
          return () => {
            index += 1;
            return `source-entry-current-${index}`;
          };
        })(),
      },
    });
    repository.saveSession({
      sessionId: 'session-1',
      title: 'Session',
      status: 'active',
      createdAt: '2026-05-31T11:00:00.000Z',
      updatedAt: '2026-05-31T11:00:00.000Z',
    });
    repository.saveMessage({
      messageId: 'message-old',
      sessionId: 'session-1',
      runId: 'run-old',
      role: 'user',
      content: 'Old context before compaction.',
      status: 'completed',
      createdAt: '2026-05-31T11:01:00.000Z',
      completedAt: '2026-05-31T11:01:00.000Z',
    });
    repository.saveMessage({
      messageId: 'message-kept',
      sessionId: 'session-1',
      runId: 'run-old',
      role: 'assistant',
      content: 'Kept context after compaction boundary.',
      status: 'completed',
      createdAt: '2026-05-31T11:02:00.000Z',
      completedAt: '2026-05-31T11:02:00.000Z',
    });
    appendSeedSource(activePathRepo, 'source-entry-message-old', 'session_message', 'message-old', undefined, '2026-05-31T11:01:00.000Z');
    const keptSource = appendSeedSource(activePathRepo, 'source-entry-message-kept', 'session_message', 'message-kept', 'source-entry-message-old', '2026-05-31T11:02:00.000Z');
    activePathRepo.setActiveLeaf({
      sessionId: 'session-1',
      leafSourceEntryId: keptSource.sourceEntryId,
      updatedAt: '2026-05-31T11:02:00.000Z',
      reason: 'source_appended',
    });

    const result = await service.sendSessionMessage({
      requestId: 'request-1',
      payload: {
        sessionId: 'session-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: 'Continue after compaction.',
          createdAt: '2026-05-31T11:05:00.000Z',
        }],
        createdAt: '2026-05-31T11:05:00.000Z',
      },
    });

    for await (const _event of result.events) {
      // Drain the async iterable so the normal model request is built.
    }

    expect(requests).toHaveLength(1);
    const sessionParts = requests[0]!.inputContext.parts.filter((part) => part.kind === 'session');
    expect(sessionParts.map((part) => part.sessionKind)).toEqual([
      'session_summary',
      'session_history',
    ]);
    expect(JSON.stringify(sessionParts)).toContain('Compacted context summary from prior turns.');
    expect(JSON.stringify(sessionParts)).toContain('Kept context after compaction boundary.');
    expect(JSON.stringify(sessionParts)).not.toContain('Old context before compaction.');
  });

  it('excludes a compaction summary saved on the old path when the active leaf moved during maintenance compaction', async () => {
    const requests: ModelStepRuntimeRequest[] = [];
    db = new Database(':memory:');
    migrateDatabase(db);
    const repository = new SessionRunRepository(db);
    const activePathRepo = new SessionActivePathRepository(db);
    const service = new SessionRunService({
      repository,
      activePathRepository: activePathRepo,
      sessionCompactionOrchestrator: {
        async compactIfNeeded(input): Promise<SessionCompactionOrchestrationResult> {
          const parentAtStart = activePathRepo.getActiveLeaf(input.sessionId)?.leafSourceEntryId;
          activePathRepo.appendSourceEntry({
            sourceEntryId: 'source-entry-new-branch',
            sessionId: input.sessionId,
            parentSourceEntryId: 'source-entry-message-kept',
            sourceRef: {
              sourceKind: 'session_message',
              sourceId: 'message-new-branch',
              sourceUri: 'session-message://message-new-branch',
              loadedAt: '2026-05-31T11:04:30.000Z',
            },
            createdAt: '2026-05-31T11:04:30.000Z',
          });
          activePathRepo.setActiveLeaf({
            sessionId: input.sessionId,
            leafSourceEntryId: 'source-entry-new-branch',
            updatedAt: '2026-05-31T11:04:30.000Z',
            reason: 'source_appended',
          });
          repository.saveSessionCompaction({
            compactionId: 'compaction-old-path',
            sessionId: input.sessionId,
            summary: 'Old path compaction must not enter the final prompt.',
            summaryKind: 'compaction',
            firstKeptSourceRef: {
              sourceId: 'message-kept',
              sourceKind: 'session_message',
              sourceUri: 'session-message://message-kept',
              loadedAt: '2026-05-31T11:02:00.000Z',
            },
            tokensBefore: 9000,
            triggerReason: 'context_budget_pressure',
            status: 'completed',
            createdAt: '2026-05-31T11:04:00.000Z',
          });
          activePathRepo.appendSourceEntry({
            sourceEntryId: 'source-entry-compaction-old-path',
            sessionId: input.sessionId,
            ...(parentAtStart ? { parentSourceEntryId: parentAtStart } : {}),
            sourceRef: {
              sourceKind: 'session_summary',
              sourceId: 'compaction-old-path',
              sourceUri: 'session-compaction://compaction-old-path',
              loadedAt: '2026-05-31T11:04:00.000Z',
            },
            createdAt: '2026-05-31T11:04:00.000Z',
          });
          return {
            status: 'completed',
            events: [],
            compaction: repository.getSessionCompaction('compaction-old-path')!,
          };
        },
      },
      modelStepProvider: {
        streamModelStep: async function* (request) {
          requests.push(request);
          yield assistantOutputCompletedEvent(1);
        },
        completeModelStep: async () => ({ ok: true, text: '' }),
      cancelModelStep: () => true,
      },
      clock: { now: () => '2026-05-31T11:05:00.000Z' },
      ids: {
        sessionId: () => 'session-1',
        runId: () => 'run-1',
        stepId: () => 'step-1',
        eventId: () => `event-${Math.random().toString(36).slice(2)}`,
        messageId: (() => {
          let index = 0;
          return () => {
            index += 1;
            return index === 1 ? 'message-current' : `message-generated-${index}`;
          };
        })(),
        sourceEntryId: (() => {
          let index = 0;
          return () => {
            index += 1;
            return `source-entry-current-${index}`;
          };
        })(),
      },
    });
    repository.saveSession({
      sessionId: 'session-1',
      title: 'Session',
      status: 'active',
      createdAt: '2026-05-31T11:00:00.000Z',
      updatedAt: '2026-05-31T11:00:00.000Z',
    });
    repository.saveMessage({
      messageId: 'message-kept',
      sessionId: 'session-1',
      runId: 'run-old',
      role: 'assistant',
      content: 'Kept context on the active branch.',
      status: 'completed',
      createdAt: '2026-05-31T11:02:00.000Z',
      completedAt: '2026-05-31T11:02:00.000Z',
    });
    repository.saveMessage({
      messageId: 'message-new-branch',
      sessionId: 'session-1',
      runId: 'run-branch',
      role: 'user',
      content: 'New branch context wins.',
      status: 'completed',
      createdAt: '2026-05-31T11:04:30.000Z',
      completedAt: '2026-05-31T11:04:30.000Z',
    });
    const keptSource = appendSeedSource(activePathRepo, 'source-entry-message-kept', 'session_message', 'message-kept', undefined, '2026-05-31T11:02:00.000Z');
    activePathRepo.setActiveLeaf({
      sessionId: 'session-1',
      leafSourceEntryId: keptSource.sourceEntryId,
      updatedAt: '2026-05-31T11:02:00.000Z',
      reason: 'source_appended',
    });

    const result = await service.sendSessionMessage({
      requestId: 'request-1',
      payload: {
        sessionId: 'session-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: 'Continue after branch moved.',
          createdAt: '2026-05-31T11:05:00.000Z',
        }],
        createdAt: '2026-05-31T11:05:00.000Z',
      },
    });

    for await (const _event of result.events) {
      // Drain the async iterable so the normal model request is built.
    }

    const sessionPartsJson = JSON.stringify(requests[0]?.inputContext.parts.filter((part) => part.kind === 'session'));
    expect(sessionPartsJson).not.toContain('Old path compaction must not enter the final prompt.');
    expect(sessionPartsJson).toContain('New branch context wins.');
  });

  it('fails the run and does not call the normal model step when compaction fails', async () => {
    const requests: ModelStepRuntimeRequest[] = [];
    const service = createServiceWithModelStepStream([assistantOutputCompletedEvent(1)], {
      onRequest: (request) => requests.push(request),
      sessionCompactionOrchestrator: {
        async compactIfNeeded(input): Promise<SessionCompactionOrchestrationResult> {
          return {
            status: 'failed',
            events: [{
              eventId: 'event-compaction-failed',
              schemaVersion: 1,
              eventType: 'context.compaction.failed',
              runId: input.runId,
              sessionId: input.sessionId,
              stepId: input.stepId,
              requestId: input.requestId,
              sequence: input.startSequence + 1,
              createdAt: '2026-05-17T00:00:00.000Z',
              source: 'main',
              visibility: 'system',
              persist: 'required',
              payload: {
                triggerReason: 'context_budget_pressure',
                tokensBefore: 100,
                error: {
                  code: 'provider_network_error',
                  message: 'Summary failed.',
                  severity: 'error',
                  retryable: true,
                  source: 'provider',
                },
              },
            }],
            failure: {
              code: 'provider_network_error',
              message: 'Summary failed.',
              severity: 'error',
              retryable: true,
              source: 'provider',
            },
          };
        },
      },
    });
    service.createSession({
      title: 'Session',
      createdAt: '2026-05-17T00:00:00.000Z',
    });

    const result = await service.sendSessionMessage({
      requestId: 'request-1',
      payload: {
        sessionId: 'session-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: 'Continue',
          createdAt: '2026-05-17T00:00:00.000Z',
        }],
        createdAt: '2026-05-17T00:00:00.000Z',
      },
    });

    const streamed: RuntimeEvent[] = [];
    for await (const event of result.events) {
      streamed.push(event);
    }

    expect(requests).toEqual([]);
    expect(streamed.map((event) => event.eventType)).toEqual([
      'run.started',
      'context.compaction.failed',
      'run.failed',
      'step.status.changed',
      'step.failed',
      'run.status.changed',
    ]);
  });

  it('allows an already-started maintenance compaction to finish after user cancellation without continuing the normal model step', async () => {
    const requests: ModelStepRuntimeRequest[] = [];
    let resolveCompaction: (() => void) | undefined;
    const service = createServiceWithModelStepStream([assistantOutputCompletedEvent(1)], {
      onRequest: (request) => requests.push(request),
      sessionCompactionOrchestrator: {
        async compactIfNeeded(input): Promise<SessionCompactionOrchestrationResult> {
          await new Promise<void>((resolve) => {
            resolveCompaction = resolve;
          });
          return {
            status: 'completed',
            events: [{
              eventId: 'event-compaction-completed',
              schemaVersion: 1,
              eventType: 'context.compaction.completed',
              runId: input.runId,
              sessionId: input.sessionId,
              stepId: input.stepId,
              requestId: input.requestId,
              sequence: input.startSequence + 1,
              createdAt: '2026-05-17T00:00:00.000Z',
              source: 'main',
              visibility: 'system',
              persist: 'required',
              payload: {
                compactionId: 'compaction-1',
                triggerReason: 'context_budget_pressure',
                tokensBefore: 100,
                firstKeptSourceRef: {
                  sourceId: 'session-message:message-recent',
                  sourceKind: 'session_message',
                },
                summarizedSourceCount: 1,
              },
            }],
            compaction: {
              compactionId: 'compaction-1',
              sessionId: input.sessionId,
              summary: 'summary',
              summaryKind: 'compaction',
              firstKeptSourceRef: {
                sourceId: 'session-message:message-recent',
                sourceKind: 'session_message',
              },
              tokensBefore: 100,
              triggerReason: 'context_budget_pressure',
              status: 'completed',
              createdAt: '2026-05-17T00:00:00.000Z',
            },
          };
        },
      },
    });
    service.createSession({
      title: 'Session',
      createdAt: '2026-05-17T00:00:00.000Z',
    });

    const result = await service.sendSessionMessage({
      requestId: 'request-1',
      payload: {
        sessionId: 'session-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: 'Continue',
          createdAt: '2026-05-17T00:00:00.000Z',
        }],
        createdAt: '2026-05-17T00:00:00.000Z',
      },
    });

    const iterator = result.events[Symbol.asyncIterator]();
    expect((await iterator.next()).value.eventType).toBe('run.started');
    expect(service.cancelSessionMessage({
      targetRequestId: 'request-1',
    })).toBe(true);
    resolveCompaction?.();

    const remaining: RuntimeEvent[] = [];
    while (true) {
      const next = await iterator.next();
      if (next.done) {
        break;
      }
      remaining.push(next.value);
    }

    expect(requests).toEqual([]);
    expect(remaining.map((event) => event.eventType)).toEqual([
      'context.compaction.completed',
    ]);
  });

  it('does not overwrite a cancelled run when an already-started maintenance compaction fails', async () => {
    const requests: ModelStepRuntimeRequest[] = [];
    let resolveCompaction: (() => void) | undefined;
    const service = createServiceWithModelStepStream([assistantOutputCompletedEvent(1)], {
      onRequest: (request) => requests.push(request),
      sessionCompactionOrchestrator: {
        async compactIfNeeded(input): Promise<SessionCompactionOrchestrationResult> {
          await new Promise<void>((resolve) => {
            resolveCompaction = resolve;
          });
          return {
            status: 'failed',
            events: [{
              eventId: 'event-compaction-failed',
              schemaVersion: 1,
              eventType: 'context.compaction.failed',
              runId: input.runId,
              sessionId: input.sessionId,
              stepId: input.stepId,
              requestId: input.requestId,
              sequence: input.startSequence + 1,
              createdAt: '2026-05-17T00:00:00.000Z',
              source: 'main',
              visibility: 'system',
              persist: 'required',
              payload: {
                triggerReason: 'context_budget_pressure',
                tokensBefore: 100,
                error: {
                  code: 'provider_network_error',
                  message: 'Summary failed.',
                  severity: 'error',
                  retryable: true,
                  source: 'provider',
                },
              },
            }],
            failure: {
              code: 'provider_network_error',
              message: 'Summary failed.',
              severity: 'error',
              retryable: true,
              source: 'provider',
            },
          };
        },
      },
    });
    service.createSession({
      title: 'Session',
      createdAt: '2026-05-17T00:00:00.000Z',
    });

    const result = await service.sendSessionMessage({
      requestId: 'request-1',
      payload: {
        sessionId: 'session-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: 'Continue',
          createdAt: '2026-05-17T00:00:00.000Z',
        }],
        createdAt: '2026-05-17T00:00:00.000Z',
      },
    });

    const iterator = result.events[Symbol.asyncIterator]();
    expect((await iterator.next()).value.eventType).toBe('run.started');
    expect(service.cancelSessionMessage({
      targetRequestId: 'request-1',
    })).toBe(true);
    resolveCompaction?.();

    const remaining: RuntimeEvent[] = [];
    while (true) {
      const next = await iterator.next();
      if (next.done) {
        break;
      }
      remaining.push(next.value);
    }

    expect(requests).toEqual([]);
    expect(remaining.map((event) => event.eventType)).toEqual([
      'context.compaction.failed',
    ]);
    expect(service.listRunsBySession('session-1')).toEqual([
      expect.objectContaining({ runId: 'run-1', status: 'cancelled' }),
    ]);
  });

  it('passes available project tool definitions to the provider request when a session has a workspace', async () => {
    const requests: ModelStepRuntimeRequest[] = [];
    const toolDefinitions: ToolDefinition[] = [{
      name: 'list_directory',
      title: 'List directory',
      description: 'List files in a project directory.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
        },
        required: ['path'],
      },
      capabilities: ['project_read'],
      riskLevel: 'low',
      sideEffect: 'none',
      availability: { status: 'available' },
    }];
    const service = createServiceWithModelStepStream([
      assistantOutputCompletedEvent(1),
    ], {
      toolRuntimeFactory: {
        async create() {
          return {
            async handleToolCalls() {
              return { toolResults: [], runtimeEvents: [] };
            },
            async resumeToolApproval() {
              return undefined;
            },
          };
        },
      },
      toolDefinitionProvider: {
        listDefinitions(input) {
          expect(input).toEqual({
            runId: 'run-1',
            permissionMode: 'default',
            providerCapabilitySummary: { supportsToolCall: true },
          });
          return toolDefinitions;
        },
      },
      onRequest: (request) => requests.push(request),
    });
    service.createSession({
      title: 'Session',
      workspacePath: 'C:/all/work/study/megumi',
      createdAt: '2026-05-17T00:00:00.000Z',
    });

    const longRequestId = `ipc-${'b'.repeat(124)}`;
    const result = await service.sendSessionMessage({
      requestId: longRequestId,
      payload: {
        sessionId: 'session-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: 'List docs files',
          createdAt: '2026-05-17T00:00:00.000Z',
        }],
        createdAt: '2026-05-17T00:00:00.000Z',
      },
    });
    for await (const _event of result.events) {
      // drain stream
    }

    expect(requests).toHaveLength(1);
    expect(requests[0]?.inputContext.contextId.length).toBeLessThanOrEqual(128);
    expect(requests[0]?.toolDefinitions).toEqual(toolDefinitions);
    expect(requests[0]?.inputContext.trace.metadata).toMatchObject({
      traceId: 'trace:model-input:run-1:step-1:initial',
      effectiveCwd: 'C:\\all\\work\\study\\megumi',
      modelTarget: {
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
      },
    });
    expect(requests[0]?.inputContext.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'runtime_constraint',
        constraintKind: 'available_capability_summary',
        text: 'Available tools: list_directory (project_read).',
      }),
      expect.objectContaining({
        kind: 'runtime_constraint',
        constraintKind: 'effective_cwd',
        text: expect.stringContaining('Current working directory: .'),
      }),
    ]));
  });

  it('does not expose tool definitions when provider capability says tool calls are unsupported', async () => {
    const requests: ModelStepRuntimeRequest[] = [];
    const listDefinitions = vi.fn((): ToolDefinition[] => []);
    const service = createServiceWithModelStepStream((request) => {
      requests.push(request);
      return [assistantOutputCompletedEvent(1)];
    }, {
      toolDefinitionProvider: { listDefinitions },
      providerCapabilitySummaryProvider: {
        getProviderCapabilitySummary: () => ({ supportsToolCall: false }),
      },
    });
    service.createSession({
      title: 'Provider without tool calling',
      workspacePath: 'C:/all/work/study/megumi',
      createdAt: '2026-06-14T00:00:00.000Z',
    });

    const result = await service.sendSessionMessage({
      requestId: 'request-provider-no-tools',
      payload: {
        sessionId: 'session-1',
        providerId: 'basic-chat',
        modelId: 'chat-only',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: 'Read package.json',
          createdAt: '2026-06-14T00:00:00.000Z',
        }],
        createdAt: '2026-06-14T00:00:00.000Z',
      },
    });
    for await (const _event of result.events) {
      // Drain.
    }

    expect(listDefinitions).toHaveBeenCalledWith(expect.objectContaining({
      providerCapabilitySummary: { supportsToolCall: false },
    }));
    expect(requests[0]?.toolDefinitions ?? []).toEqual([]);
  });

  it('builds session message model input from persisted SessionContextInput', async () => {
    const requests: ModelStepRuntimeRequest[] = [];
    db = new Database(':memory:');
    migrateDatabase(db);
    const repository = new SessionRunRepository(db);
    const activePathRepo = new SessionActivePathRepository(db);
    const service = new SessionRunService({
      repository,
      activePathRepository: activePathRepo,
      modelStepProvider: {
        streamModelStep: async function* (request) {
          requests.push(request);
          yield assistantOutputCompletedEvent(1);
        },
        completeModelStep: async () => ({ ok: true, text: '' }),
      cancelModelStep: () => true,
      },
      clock: { now: () => '2026-05-28T00:01:00.000Z' },
      ids: {
        sessionId: () => 'session-1',
        runId: () => 'run-current',
        stepId: () => 'step-current',
        messageId: () => 'message-current',
      },
    });

    repository.saveSession({
      sessionId: 'session-1',
      title: 'Session',
      workspaceId: 'workspace-1',
      workspacePath: 'C:/all/work/study/megumi',
      status: 'active',
      summary: 'Session summary should be injected as session_summary.',
      createdAt: '2026-05-28T00:00:00.000Z',
      updatedAt: '2026-05-28T00:00:00.000Z',
    });
    repository.saveMessage({
      messageId: 'message-prev-user',
      sessionId: 'session-1',
      runId: 'run-prev',
      role: 'user',
      content: 'Previous persisted user message.',
      status: 'completed',
      createdAt: '2026-05-28T00:00:01.000Z',
      completedAt: '2026-05-28T00:00:01.000Z',
    });
    repository.saveMessage({
      messageId: 'message-prev-assistant',
      sessionId: 'session-1',
      runId: 'run-prev',
      role: 'assistant',
      content: 'Previous persisted assistant answer.',
      status: 'completed',
      createdAt: '2026-05-28T00:00:02.000Z',
      completedAt: '2026-05-28T00:00:02.000Z',
    });
    repository.saveRun({
      runId: 'run-prev',
      sessionId: 'session-1',
      mode: 'default',
      goal: 'Previous turn',
      status: 'failed',
      createdAt: '2026-05-28T00:00:03.000Z',
      error: {
        code: 'runtime_unknown',
        message: 'Previous provider failure.',
        severity: 'error',
        retryable: false,
        source: 'provider',
      },
    });
    appendSeedSource(activePathRepo, 'source-entry-prev-user', 'session_message', 'message-prev-user', undefined, '2026-05-28T00:00:01.000Z');
    appendSeedSource(activePathRepo, 'source-entry-prev-assistant', 'session_message', 'message-prev-assistant', 'source-entry-prev-user', '2026-05-28T00:00:02.000Z');
    const previousRunSource = appendSeedSource(activePathRepo, 'source-entry-prev-run', 'session_run', 'run-prev', 'source-entry-prev-assistant', '2026-05-28T00:00:03.000Z');
    activePathRepo.setActiveLeaf({
      sessionId: 'session-1',
      leafSourceEntryId: previousRunSource.sourceEntryId,
      updatedAt: '2026-05-28T00:00:03.000Z',
      reason: 'source_appended',
    });

    const result = await service.sendSessionMessage({
      requestId: 'ipc-session-message-send-1',
      payload: {
        sessionId: 'session-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        messages: [
          {
            id: 'renderer-history-should-not-be-used',
            role: 'assistant',
            content: 'Renderer-only timeline text must not enter model input.',
            createdAt: '2026-05-28T00:00:30.000Z',
          },
          {
            id: 'message-local-user',
            role: 'user',
            content: 'Continue from persisted context.',
            createdAt: '2026-05-28T00:01:00.000Z',
          },
        ],
        createdAt: '2026-05-28T00:01:00.000Z',
      },
    });
    for await (const _event of result.events) {
      // drain stream
    }

    expect(requests[0]?.inputContext.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'session',
        sessionKind: 'session_summary',
        text: 'Session summary should be injected as session_summary.',
      }),
      expect.objectContaining({
        kind: 'session',
        sessionKind: 'session_history',
        text: '[user] Previous persisted user message.',
      }),
      expect.objectContaining({
        kind: 'session',
        sessionKind: 'session_history',
        text: '[assistant] Previous persisted assistant answer.',
      }),
      expect.objectContaining({
        kind: 'session',
        sessionKind: 'session_runtime_fact',
        text: '[run_failed] Previous run failed before a final answer. Error: Previous provider failure.',
      }),
      expect.objectContaining({
        kind: 'current_turn',
        role: 'user',
        text: 'Continue from persisted context.',
      }),
    ]));
    expect(JSON.stringify(requests[0]?.inputContext.parts)).not.toContain('Renderer-only timeline text');
  });

  it('continues session message runs through tool results before completing with final assistant output', async () => {
    const requests: ModelStepRuntimeRequest[] = [];
    const toolResult = createToolResult();
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migrateDatabase(db);
    const repository = new SessionRunRepository(db);
    const service = new SessionRunService({
      repository,
      modelStepProvider: {
        streamModelStep: async function* (request) {
          requests.push(request);

          if (requests.length === 1) {
            yield toolUseCreatedEvent(1);
            yield modelStepCompletedEvent(2);
            return;
          }

          yield {
            ...assistantOutputCompletedEvent(1),
            stepId: request.stepId,
          };
        },
        completeModelStep: async () => ({ ok: true, text: '' }),
      cancelModelStep: () => true,
      },
      toolRuntimeFactory: {
        async create(input) {
          expect(input).toEqual({
            projectRoot: 'C:/all/work/study/megumi',
            permissionMode: 'default',
          });
          return {
            async handleToolCalls() {
              return {
                toolResults: [toolResult],
                runtimeEvents: [toolCallRequestedRuntimeEvent()],
              };
            },
            async resumeToolApproval() {
              return undefined;
            },
          };
        },
      },
      clock: { now: () => '2026-05-17T00:00:04.000Z' },
      ids: {
        sessionId: () => 'session-1',
        runId: () => 'run-1',
        stepId: (() => {
          let index = 0;
          return () => {
            index += 1;
            return `step-${index}`;
          };
        })(),
        eventId: (() => {
          let index = 0;
          return () => {
            index += 1;
            return `service-event-${index}`;
          };
        })(),
        messageId: (() => {
          let index = 0;
          return () => {
            index += 1;
            return `message-${index}`;
          };
        })(),
      },
    });
    service.createSession({
      title: 'Session',
      workspacePath: 'C:/all/work/study/megumi',
      createdAt: '2026-05-17T00:00:00.000Z',
    });

    const toolContinuationLongRequestId = `ipc-${'d'.repeat(124)}`;
    const result = await service.sendSessionMessage({
      requestId: toolContinuationLongRequestId,
      payload: {
        sessionId: 'session-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: 'Read package.json',
          createdAt: '2026-05-17T00:00:00.000Z',
        }],
        createdAt: '2026-05-17T00:00:00.000Z',
      },
    });
    const streamed = [];
    for await (const event of result.events) {
      streamed.push(event);
    }

    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({
      stepId: 'step-2',
      modelStepId: expect.stringMatching(/^model-step:/),
    });
    expect(requests[1]?.modelStepId).not.toBe(requests[1]?.stepId);
    expect(repository.listStepsByRun('run-1')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        stepId: 'step-1',
        kind: 'model',
        status: 'succeeded',
      }),
      expect.objectContaining({
        stepId: 'step-2',
        kind: 'model',
        status: 'succeeded',
      }),
    ]));
    expect(requests[1]?.inputContext.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'tool_continuation',
        toolResultId: 'tool-result-1',
      }),
    ]));
    expect(streamed.map((event) => event.eventType)).toEqual([
      'run.started',
      'tool.call.created',
      'model.step.completed',
      'tool.execution.requested',
      'tool.result.created',
      'assistant.output.completed',
      'step.status.changed',
      'step.completed',
      'run.status.changed',
      'run.completed',
    ]);
    expect(streamed.at(-1)?.eventType).toBe('run.completed');
    expect(service.listRuntimeEventsByRun('run-1').map((event) => event.eventType)).toContain('tool.result.created');
    expect(service.listMessagesBySession('session-1')).toEqual([
      expect.objectContaining({
        role: 'user',
        content: 'Read package.json',
        runId: 'run-1',
      }),
      expect.objectContaining({
        role: 'assistant',
        content: 'Final answer after tool result.',
        runId: 'run-1',
        status: 'completed',
      }),
    ]);
  });

  it('persists model step records before tool handlers persist model tool uses', async () => {
    const requests: ModelStepRuntimeRequest[] = [];
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migrateDatabase(db);
    const repository = new SessionRunRepository(db);
    const toolRepository = new ToolRepository(db);
    const service = new SessionRunService({
      repository,
      modelStepProvider: {
        streamModelStep: async function* (request) {
          requests.push(request);

          if (requests.length === 1) {
            yield toolUseCreatedEvent(1);
            yield modelStepCompletedEvent(2);
            return;
          }

          yield {
            ...assistantOutputCompletedEvent(1),
            stepId: request.stepId,
          };
        },
        completeModelStep: async () => ({ ok: true, text: '' }),
      cancelModelStep: () => true,
      },
      toolRuntimeFactory: {
        async create() {
          return {
            async handleToolCalls(input) {
              const [toolUse] = input.toolCalls;
              expect(toolUse).toMatchObject({
                toolCallId: 'tool-call-1',
                modelStepId: 'model-step-1',
              });
              toolRepository.saveToolCall(toolUse);
              return {
                toolResults: [createToolResult({ toolCallId: toolUse.toolCallId })],
              };
            },
            async resumeToolApproval() {
              return undefined;
            },
          };
        },
      },
      clock: { now: () => '2026-05-17T00:00:04.000Z' },
      ids: {
        sessionId: () => 'session-1',
        runId: () => 'run-1',
        stepId: (() => {
          let index = 0;
          return () => {
            index += 1;
            return `step-${index}`;
          };
        })(),
        eventId: (() => {
          let index = 0;
          return () => {
            index += 1;
            return `service-event-${index}`;
          };
        })(),
        messageId: (() => {
          let index = 0;
          return () => {
            index += 1;
            return `message-${index}`;
          };
        })(),
      },
    });
    service.createSession({
      title: 'Session',
      workspacePath: 'C:/all/work/study/megumi',
      createdAt: '2026-05-17T00:00:00.000Z',
    });

    const modelRecordLongRequestId = `ipc-${'e'.repeat(124)}`;
    const result = await service.sendSessionMessage({
      requestId: modelRecordLongRequestId,
      payload: {
        sessionId: 'session-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: 'Read package.json',
          createdAt: '2026-05-17T00:00:00.000Z',
        }],
        createdAt: '2026-05-17T00:00:00.000Z',
      },
    });

    const streamed = [];
    for await (const event of result.events) {
      streamed.push(event);
    }

    expect(toolRepository.listToolCallsByRun('run-1')).toEqual([
      expect.objectContaining({
        toolCallId: 'tool-call-1',
        modelStepId: 'model-step-1',
      }),
    ]);
    expect(streamed.at(-1)?.eventType).toBe('run.completed');
  });

  it('marks session message runs failed when the tool runtime throws after model tool use', async () => {
    const service = createServiceWithModelStepStream([
      toolUseCreatedEvent(1),
      modelStepCompletedEvent(2),
    ], {
      toolRuntimeFactory: {
        async create() {
          return {
            async handleToolCalls() {
              throw new Error('tool persistence failed');
            },
            async resumeToolApproval() {
              return undefined;
            },
          };
        },
      },
    });
    service.createSession({
      title: 'Session',
      workspacePath: 'C:/all/work/study/megumi',
      createdAt: '2026-05-17T00:00:00.000Z',
    });

    const result = await service.sendSessionMessage({
      requestId: 'ipc-session-message-send-1',
      payload: {
        sessionId: 'session-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: 'Read package.json',
          createdAt: '2026-05-17T00:00:00.000Z',
        }],
        createdAt: '2026-05-17T00:00:00.000Z',
      },
    });

    const streamed = [];
    for await (const event of result.events) {
      streamed.push(event);
    }

    expect(streamed.map((event) => event.eventType)).toEqual([
      'run.started',
      'tool.call.created',
      'model.step.completed',
      'run.failed',
      'step.status.changed',
      'step.failed',
      'run.status.changed',
    ]);
    expect(service.listRuntimeEventsByRun('run-1').map((event) => event.eventType)).toEqual([
      'run.started',
      'tool.call.created',
      'model.step.completed',
      'run.failed',
      'step.status.changed',
      'step.failed',
      'run.status.changed',
    ]);
  });

  it('does not emit action.requested for model tool use runs', async () => {
    const requests: ModelStepRuntimeRequest[] = [];
    const toolResult = createToolResult({
      toolCallId: 'tool-call-1',
    });
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migrateDatabase(db);
    const repository = new SessionRunRepository(db);
    const service = new SessionRunService({
      repository,
      modelStepProvider: {
        streamModelStep: async function* (request) {
          requests.push(request);

          if (requests.length === 1) {
            yield toolUseCreatedEvent(1);
            yield modelStepCompletedEvent(2);
            return;
          }

          yield {
            ...assistantOutputCompletedEvent(1),
            stepId: request.stepId,
          };
        },
        completeModelStep: async () => ({ ok: true, text: '' }),
      cancelModelStep: () => true,
      },
      toolRuntimeFactory: {
        async create() {
          return {
            async handleToolCalls() {
              return {
                toolResults: [toolResult],
                runtimeEvents: [toolCallRequestedRuntimeEvent()],
              };
            },
            async resumeToolApproval() {
              return undefined;
            },
          };
        },
      },
      clock: { now: () => '2026-05-17T00:00:04.000Z' },
      ids: {
        sessionId: () => 'session-1',
        runId: () => 'run-1',
        stepId: (() => {
          let index = 0;
          return () => {
            index += 1;
            return `step-${index}`;
          };
        })(),
        eventId: (() => {
          let index = 0;
          return () => {
            index += 1;
            return `service-event-${index}`;
          };
        })(),
        messageId: (() => {
          let index = 0;
          return () => {
            index += 1;
            return `message-${index}`;
          };
        })(),
      },
    });
    service.createSession({
      title: 'Session',
      workspacePath: 'C:/all/work/study/megumi',
      createdAt: '2026-05-17T00:00:00.000Z',
    });

    const result = await service.sendSessionMessage({
      requestId: 'ipc-session-message-send-1',
      payload: {
        sessionId: 'session-1',
        providerId: 'openai',
        modelId: 'gpt-5.2',
        messages: [{
          id: 'message-input-1',
          role: 'user',
          content: 'Read package.json',
          createdAt: '2026-05-20T00:00:00.000Z',
        }],
        context: {
          sessionTitle: 'Read package.json',
          permissionMode: 'default',
        },
        createdAt: '2026-05-20T00:00:00.000Z',
      },
    });
    const events = [];
    for await (const event of result.events) {
      events.push(event);
    }
    const eventTypes = events.map((event) => event.eventType);

    expect(eventTypes).toContain('tool.call.created');
    expect(eventTypes).toContain('tool.execution.requested');
    expect(eventTypes).toContain('tool.result.created');
    expect(eventTypes).not.toContain('action.requested');
  });

  it('completes session message runs from real adapter model output deltas and model step completion', async () => {
    const service = createServiceWithModelStepStream([
      {
        eventId: 'event-model-step-started',
        schemaVersion: 1,
        eventType: 'model.step.started',
        sessionId: 'session-1',
        runId: 'run-1',
        stepId: 'step-1',
        sequence: 1,
        createdAt: '2026-05-17T00:00:01.000Z',
        source: 'provider',
        visibility: 'system',
        persist: 'required',
        payload: {
          modelStepId: 'model-step-1',
          providerId: 'openai',
          modelId: 'gpt-5.5',
        },
      },
      modelOutputDeltaEvent({ sequence: 2, delta: 'Hello ' }),
      modelOutputDeltaEvent({ sequence: 3, delta: 'Megumi.' }),
      {
        ...modelStepCompletedEvent(4),
        payload: {
          modelStepId: 'model-step-1',
          finishReason: 'stop',
        },
      },
    ]);
    service.createSession({
      title: 'Session',
      createdAt: '2026-05-17T00:00:00.000Z',
    });

    const result = await service.sendSessionMessage({
      requestId: 'ipc-session-message-send-1',
      payload: {
        sessionId: 'session-1',
        providerId: 'openai',
        modelId: 'gpt-5.5',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: 'Hello',
          createdAt: '2026-05-17T00:00:00.000Z',
        }],
        createdAt: '2026-05-17T00:00:00.000Z',
      },
    });
    const streamed = [];
    for await (const event of result.events) {
      streamed.push(event);
    }

    expect(streamed.map((event) => event.eventType)).toEqual([
      'run.started',
      'model.step.started',
      'model.output.delta',
      'model.step.completed',
      'step.status.changed',
      'step.completed',
      'run.status.changed',
      'run.completed',
    ]);
    expect(streamed.find((event) => event.eventType === 'model.output.delta')?.payload).toMatchObject({
      delta: 'Hello Megumi.',
    });
    expect(service.listMessagesBySession('session-1')).toEqual([
      expect.objectContaining({
        role: 'user',
        content: 'Hello',
        runId: 'run-1',
      }),
      expect.objectContaining({
        role: 'assistant',
        content: 'Hello Megumi.',
        runId: 'run-1',
        status: 'completed',
      }),
    ]);
  });

  it('publishes chat stream events through the injected sink while keeping runtime events unchanged', async () => {
    const chatEvents: ChatStreamEvent[] = [];
    const service = createServiceWithChatStreamSink([
      modelOutputDeltaEvent({ sequence: 1, delta: 'Hel' }),
      modelOutputDeltaEvent({ sequence: 2, delta: 'lo' }),
      {
        eventId: 'event-model-step-completed',
        schemaVersion: 1,
        eventType: 'model.step.completed',
        sessionId: 'session-1',
        runId: 'run-1',
        stepId: 'step-1',
        sequence: 3,
        createdAt: '2026-05-24T00:00:01.000Z',
        source: 'provider',
        visibility: 'system',
        persist: 'required',
        payload: { modelStepId: 'model-step-1', finishReason: 'stop' },
      },
    ], chatEvents);
    service.createSession({
      title: 'Session',
      workspaceId: 'project-1',
      createdAt: '2026-05-24T00:00:00.000Z',
    });

    const result = await service.sendSessionMessage({
      requestId: 'ipc-session-message-send-1',
      payload: {
        sessionId: 'session-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: 'Hello',
          createdAt: '2026-05-24T00:00:00.000Z',
        }],
        createdAt: '2026-05-24T00:00:00.000Z',
      },
    });
    const runtimeEvents = [];
    for await (const event of result.events) {
      runtimeEvents.push(event);
    }

    expect(runtimeEvents.map((event) => event.eventType)).toEqual([
      'run.started',
      'model.output.delta',
      'model.step.completed',
      'step.status.changed',
      'step.completed',
      'run.status.changed',
      'run.completed',
    ]);
    expect(runtimeEvents.find((event) => event.eventType === 'model.output.delta')?.payload).toMatchObject({
      delta: 'Hello',
    });
    expect(chatEvents.map((event) => event.eventType)).toEqual([
      'turn.started',
      'user.message.committed',
      'assistant.text.started',
      'assistant.text.delta',
      'assistant.text.completed',
      'turn.completed',
    ]);
    expect(chatEvents.find((event) => event.eventType === 'assistant.text.delta')).toMatchObject({
      delta: 'Hello',
      phase: 'answer',
    });
    expect(chatEvents.every((event) => event.projectId === 'project-1')).toBe(true);
    expect(chatEvents.every((event) => event.streamId === 'stream-main-1')).toBe(true);
    expect(chatEvents.every((event) => event.streamId !== 'run-1')).toBe(true);
    expect(chatEvents.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('publishes workspace change footer facts before terminal chat stream events', async () => {
    const chatEvents: ChatStreamEvent[] = [];
    const changeSet: WorkspaceChangeSet = {
      changeSetId: 'workspace-change-set-1',
      sessionId: 'session-1',
      runId: 'run-1',
      status: 'finalized',
      changedFileCount: 1,
      createdAt: '2026-05-24T00:00:00.000Z',
      finalizedAt: '2026-05-24T00:00:01.000Z',
    };
    const summary: WorkspaceChangeSummary = {
      changeSetId: 'workspace-change-set-1',
      sessionId: 'session-1',
      runId: 'run-1',
      changedFileCount: 1,
      restorableCount: 1,
      restoredCount: 0,
      conflictCount: 0,
      failedCount: 0,
      hasRestorableChanges: true,
      updatedAt: '2026-05-24T00:00:01.000Z',
    };
    const service = createServiceWithChatStreamSink([
      modelOutputDeltaEvent({ sequence: 1, delta: 'Changed file.' }),
      {
        ...modelStepCompletedEvent(2),
        payload: { modelStepId: 'model-step-1', finishReason: 'stop' },
      },
    ], chatEvents, {
      workspaceChanges: {
        listChangedFilesByRun: vi.fn(() => []),
        listChangeSetsByRun: vi.fn(() => [changeSet]),
        getChangeSummary: vi.fn(() => summary),
        listChangedFilesByChangeSet: vi.fn(() => [
          workspaceChangedFile({
            changedFileId: 'workspace-changed-file-1',
            changeSetId: 'workspace-change-set-1',
            runId: 'run-1',
            sessionId: 'session-1',
            projectPath: 'src/app.ts',
          }),
        ]),
      },
    });
    service.createSession({
      title: 'Session',
      workspaceId: 'project-1',
      createdAt: '2026-05-24T00:00:00.000Z',
    });

    const result = await service.sendSessionMessage({
      requestId: 'ipc-session-message-send-1',
      payload: {
        sessionId: 'session-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: 'Change a file',
          createdAt: '2026-05-24T00:00:00.000Z',
        }],
        createdAt: '2026-05-24T00:00:00.000Z',
      },
    });
    for await (const _event of result.events) {
      // Drain the stream so terminal chat events are published.
    }

    expect(chatEvents.map((event) => event.eventType)).toEqual([
      'turn.started',
      'user.message.committed',
      'assistant.text.started',
      'assistant.text.delta',
      'workspace.change.footer.updated',
      'assistant.text.completed',
      'turn.completed',
    ]);
    const footerEvent = chatEvents.find((event) => event.eventType === 'workspace.change.footer.updated');
    expect(footerEvent).toMatchObject({
      eventType: 'workspace.change.footer.updated',
      footer: {
        changeSets: [{
          changeSetId: 'workspace-change-set-1',
          files: [{
            projectPath: 'src/app.ts',
            restoreState: 'restorable',
          }],
        }],
      },
    });
    expect(JSON.stringify(footerEvent)).not.toContain('beforeHash');
    expect(JSON.stringify(footerEvent)).not.toContain('afterHash');
    expect(chatEvents.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('publishes terminal chat stream events without saving old flat assistant history', async () => {
    const chatEvents: ChatStreamEvent[] = [];
    const { service, repository } = createServiceWithChatStreamSinkAndRepository([
      {
        eventId: 'event-assistant-completed',
        schemaVersion: 1,
        eventType: 'assistant.output.completed',
        sessionId: 'session-1',
        runId: 'run-1',
        stepId: 'step-1',
        sequence: 1,
        createdAt: '2026-05-24T00:00:01.000Z',
        source: 'provider',
        visibility: 'user',
        persist: 'required',
        payload: { content: 'Hello' },
      },
    ], chatEvents);
    service.createSession({
      title: 'Session',
      workspaceId: 'project-1',
      createdAt: '2026-05-24T00:00:00.000Z',
    });

    const result = await service.sendSessionMessage({
      requestId: 'ipc-session-message-send-1',
      payload: {
        sessionId: 'session-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: 'Hello',
          createdAt: '2026-05-24T00:00:00.000Z',
        }],
        createdAt: '2026-05-24T00:00:00.000Z',
      },
    });
    for await (const _event of result.events) {
      // Drain the stream so terminal chat events are published.
    }

    expect(chatEvents.map((event) => event.eventType)).toContain('turn.completed');
    expect(repository.listMessagesBySession('session-1')).toEqual([
      expect.objectContaining({ role: 'user', content: 'Hello', runId: 'run-1' }),
      expect.objectContaining({ role: 'assistant', content: 'Hello', runId: 'run-1', status: 'completed' }),
    ]);
  });

  it('keeps the same chat stream across approval resume', async () => {
    const chatEvents: ChatStreamEvent[] = [];
    const toolResult = createToolResult({
      toolCallId: 'tool-use-1',
      kind: 'success',
      textContent: 'Wrote src/app.ts',
    });
    let resumeCalled = false;
    const service = createServiceWithChatStreamSink((_request, callIndex) => {
      if (callIndex === 1) {
        return [
          {
            ...toolUseCreatedEventFor({
              sequence: 1,
              toolCallId: 'tool-use-1',
              providerToolCallId: 'provider-tool-use-1',
              toolName: 'write_file',
              input: { path: 'src/app.ts' },
            }),
            createdAt: '2026-05-24T00:00:00.000Z',
          },
          {
            ...modelStepCompletedEvent(2),
            createdAt: '2026-05-24T00:00:00.000Z',
          },
        ];
      }

      return [
        {
          ...assistantOutputCompletedEvent(1),
          stepId: `step-${callIndex}`,
          createdAt: '2026-05-24T00:00:03.000Z',
        },
      ];
    }, chatEvents, {
      toolRuntimeFactory: {
        async create() {
          return {
            async handleToolCalls(input) {
              const toolUse = input.toolCalls[0];
              if (!toolUse) {
                throw new Error('Expected one tool use.');
              }
              const toolExecution: ToolExecution = {
                toolExecutionId: 'tool-execution-1',
                toolCallId: toolUse.toolCallId,
                runId: toolUse.runId,
                stepId: 'step-1',
                toolName: toolUse.toolName,
                input: toolUse.input,
                inputPreview: toolUse.inputPreview,
                capabilities: ['project_write'],
                riskLevel: 'medium',
                sideEffect: 'project_file_operation',
                status: 'pending_approval',
                requestedAt: '2026-05-24T00:00:00.000Z',
              };
              const approvalRequest: ApprovalRequest = {
                approvalRequestId: 'approval-request-1',
                toolCallId: toolUse.toolCallId,
                toolExecutionId: toolExecution.toolExecutionId,
                runId: toolUse.runId,
                stepId: toolExecution.stepId,
                toolName: toolUse.toolName,
                capabilities: toolExecution.capabilities,
                riskLevel: toolExecution.riskLevel,
                title: 'Approve write_file',
                summary: 'Writing project file requires approval.',
                preview: { action: 'write_file', targets: [] },
                requestedScope: 'project',
                status: 'pending',
                createdAt: '2026-05-24T00:00:00.000Z',
              };

              return {
                toolResults: [],
                pendingApprovals: [{
                  approvalRequest,
                  toolCall: toolUse,
                  toolExecution,
                }],
                runtimeEvents: [{
                  eventId: 'event-approval-requested',
                  schemaVersion: 1,
                  eventType: 'approval.requested',
                  runId: 'run-1',
                  sessionId: 'session-1',
                  stepId: 'step-1',
                  sequence: 3,
                  createdAt: '2026-05-24T00:00:00.000Z',
                  source: 'approval',
                  visibility: 'user',
                  persist: 'required',
                  payload: { approvalRequest },
                }],
              };
            },
            async resumeToolApproval() {
              resumeCalled = true;
              return { toolResult };
            },
          };
        },
      },
      toolDefinitionProvider: {
        listDefinitions: () => [{
          name: 'write_file',
          description: 'Write project file.',
          inputSchema: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path'],
            additionalProperties: true,
          },
          capabilities: ['project_write'],
          riskLevel: 'medium',
          sideEffect: 'project_file_operation',
          availability: { status: 'available' },
        }],
      },
    });
    service.createSession({
      title: 'Session',
      workspaceId: 'project-1',
      workspacePath: 'C:/all/work/study/megumi',
      createdAt: '2026-05-24T00:00:00.000Z',
    });

    const result = await service.sendSessionMessage({
      requestId: 'ipc-session-message-send-1',
      payload: {
        sessionId: 'session-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        context: { permissionMode: 'default' },
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: 'Write a file',
          createdAt: '2026-05-24T00:00:00.000Z',
        }],
        createdAt: '2026-05-24T00:00:00.000Z',
      },
    });
    for await (const _event of result.events) {
      // Drain initial run until waiting for approval.
    }
    const beforeResumeCount = chatEvents.length;

    const resumeEvents = service.resumeApproval({
      approvalRequestId: 'approval-request-1',
      decision: 'approved',
      decidedAt: '2026-05-24T00:00:02.000Z',
    });
    expect(resumeEvents).toBeDefined();
    for await (const _event of resumeEvents ?? []) {
      // Drain resumed run.
    }

    expect(resumeCalled).toBe(true);
    expect(chatEvents.filter((event) => event.eventType === 'turn.started')).toHaveLength(1);
    expect(new Set(chatEvents.map((event) => event.streamId))).toEqual(new Set(['stream-main-1']));
    expect(chatEvents.map((event) => event.seq)).toEqual(chatEvents.map((_, index) => index + 1));
    expect(chatEvents.slice(beforeResumeCount).map((event) => event.eventType)).toEqual(expect.arrayContaining([
      'approval.resolved',
      'tool.completed',
    ]));
    expect(chatEvents.at(-1)?.eventType).toBe('turn.completed');
  });

  it('marks session message runs waiting and resumes live continuation after approval resolution', async () => {
    const requests: ModelStepRuntimeRequest[] = [];
    const resumeInputs: unknown[] = [];
    const toolResult = createToolResult();
    db = new Database(':memory:');
    migrateDatabase(db);
    const repository = new SessionRunRepository(db);
    const service = new SessionRunService({
      repository,
      modelStepProvider: {
        streamModelStep: async function* (request) {
          requests.push(request);
          if (requests.length === 1) {
            yield toolUseCreatedEvent(1);
            yield modelStepProviderStateRecordedEvent(2);
            yield modelStepCompletedEvent(3);
            return;
          }
          yield {
            ...assistantOutputCompletedEvent(1),
            stepId: request.stepId,
          };
        },
        completeModelStep: async () => ({ ok: true, text: '' }),
      cancelModelStep: () => true,
      },
      toolRuntimeFactory: {
        async create(input) {
          expect(input).toEqual({
            projectRoot: 'C:/all/work/study/megumi',
            permissionMode: 'plan',
          });

          return {
            async handleToolCalls(handleInput) {
              const toolUse = handleInput.toolCalls[0];
              if (!toolUse) {
                throw new Error('Expected one tool use.');
              }

              const toolExecution: ToolExecution = {
                toolExecutionId: 'tool-execution-1',
                toolCallId: toolUse.toolCallId,
                runId: toolUse.runId,
                stepId: 'step-1',
                toolName: toolUse.toolName,
                input: toolUse.input,
                inputPreview: toolUse.inputPreview,
                capabilities: ['project_read'],
                riskLevel: 'low',
                sideEffect: 'none',
                status: 'pending_approval',
                requestedAt: '2026-05-17T00:00:02.250Z',
              };
              const approvalRequest: ApprovalRequest = {
                approvalRequestId: 'approval-request-1',
                toolCallId: toolUse.toolCallId,
                toolExecutionId: toolExecution.toolExecutionId,
                runId: toolUse.runId,
                stepId: toolExecution.stepId,
                toolName: toolUse.toolName,
                capabilities: toolExecution.capabilities,
                riskLevel: toolExecution.riskLevel,
                title: 'Approve read_file',
                summary: 'User approval is required.',
                preview: {
                  action: 'read_file',
                  targets: [{
                    kind: 'file',
                    label: 'package.json',
                    sensitivity: 'normal',
                  }],
                },
                requestedScope: 'once',
                status: 'pending',
                createdAt: '2026-05-17T00:00:02.300Z',
              };

              return {
                toolResults: [],
                pendingApprovals: [{
                  approvalRequest,
                  toolCall: toolUse,
                  toolExecution,
                }],
              };
            },
            async resumeToolApproval(input) {
              resumeInputs.push(input);
              return {
                toolResult,
                runtimeEvents: approvalResumeRuntimeEvents(toolResult, 'success'),
              };
            },
          };
        },
      },
      clock: { now: () => '2026-05-17T00:00:04.000Z' },
      ids: {
        sessionId: () => 'session-1',
        runId: () => 'run-1',
        stepId: () => 'step-1',
        eventId: (() => {
          let index = 0;
          return () => {
            index += 1;
            return `service-event-${index}`;
          };
        })(),
        messageId: (() => {
          let index = 0;
          return () => {
            index += 1;
            return `message-${index}`;
          };
        })(),
      },
    });
    service.createSession({
      title: 'Session',
      workspacePath: 'C:/all/work/study/megumi',
      createdAt: '2026-05-17T00:00:00.000Z',
    });

    const waitingApprovalLongRequestId = `ipc-${'f'.repeat(124)}`;
    const result = await service.sendSessionMessage({
      requestId: waitingApprovalLongRequestId,
      payload: {
        sessionId: 'session-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: 'Read package.json',
          createdAt: '2026-05-17T00:00:00.000Z',
        }],
        context: {
          permissionMode: 'plan',
        },
        createdAt: '2026-05-17T00:00:00.000Z',
      },
    });
    const streamed = [];
    for await (const event of result.events) {
      streamed.push(event);
    }

    expect(requests).toHaveLength(1);
    expect(streamed.map((event) => event.eventType)).toEqual([
      'run.started',
      'tool.call.created',
      'model.step.provider_state.recorded',
      'model.step.completed',
      'run.status.changed',
    ]);
    expect(streamed.map((event) => event.eventType)).not.toContain('run.completed');
    expect(repository.getRun('run-1')).toMatchObject({
      status: 'waiting_for_approval',
    });
    expect(service.listMessagesBySession('session-1')).toEqual([
      expect.objectContaining({
        role: 'user',
        content: 'Read package.json',
      }),
    ]);

    const resumed = [];
    const resumeEvents = service.resumeApproval({
      approvalRequestId: 'approval-request-1',
      decision: 'approved',
      decidedAt: '2026-05-17T00:00:05.000Z',
    });
    expect(resumeEvents).toBeDefined();
    for await (const event of resumeEvents ?? []) {
      resumed.push(event);
    }

    expect(resumeInputs).toEqual([{
      approvalRequestId: 'approval-request-1',
      decision: 'approved',
      decidedAt: '2026-05-17T00:00:05.000Z',
    }]);
    expect(requests).toHaveLength(2);
    expect(requests[1]?.inputContext.contextId.length).toBeLessThanOrEqual(128);
    const resumedParts = requests[1]?.inputContext.parts ?? [];
    expect(resumedParts.filter((part) => part.kind === 'tool_continuation').length).toBeGreaterThan(0);
    expect(JSON.stringify(resumedParts.filter((part) => part.kind === 'session'))).not.toContain('package contents');
    expect(requests[1]?.inputContext.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'tool_continuation',
        toolCallId: 'tool-call-1',
        modelStepId: 'model-step-1',
        toolName: 'read_file',
      }),
      expect.objectContaining({
        kind: 'tool_continuation',
        toolResultId: 'tool-result-1',
      }),
      expect.objectContaining({
        kind: 'tool_continuation',
        text: expect.stringContaining('Need to read package.json before answering.'),
      }),
    ]));
    expect(resumed.map((event) => event.eventType)).toEqual([
      'approval.resolved',
      'run.status.changed',
      'tool.execution.started',
      'tool.execution.completed',
      'tool.result.created',
      'assistant.output.completed',
      'step.status.changed',
      'step.completed',
      'run.status.changed',
      'run.completed',
    ]);
    expect([
      ...streamed,
      ...resumed,
    ].filter((event) => event.eventType === 'run.started')).toHaveLength(1);
    expect(resumed.filter((event) => event.eventType === 'tool.result.created')).toHaveLength(1);
    expect(service.listRuntimeEventsByRun('run-1')
      .filter((event) => event.eventType === 'run.started')).toHaveLength(1);
    expect(repository.getRun('run-1')).toMatchObject({
      status: 'completed',
    });
    expect(service.resumeApproval({
      approvalRequestId: 'approval-request-1',
      decision: 'approved',
      decidedAt: '2026-05-17T00:00:06.000Z',
    })).toBeUndefined();
    expect(resumeInputs).toHaveLength(1);
  });

  it('continues the model loop with a user_rejected tool result after approval denial', async () => {
    const requests: ModelStepRuntimeRequest[] = [];
    const rejectedToolResult = createToolResult({
      toolResultId: 'tool-result-denied',
      toolExecutionId: 'tool-execution-1',
      kind: 'user_rejected',
      structuredContent: undefined,
      textContent: undefined,
      denialReason: 'User denied the request.',
    });
    const service = createServiceWithModelStepStream((request, callIndex) => {
      requests.push(request);
      if (callIndex === 1) {
        return [
          toolUseCreatedEvent(1),
          modelStepCompletedEvent(2),
        ];
      }
      return [assistantOutputCompletedEvent(1)];
    }, {
      toolRuntimeFactory: {
        async create() {
          return {
            async handleToolCalls(input) {
              const toolUse = input.toolCalls[0];
              if (!toolUse) {
                throw new Error('Expected one tool use.');
              }
              const toolExecution: ToolExecution = {
                toolExecutionId: 'tool-execution-1',
                toolCallId: toolUse.toolCallId,
                runId: toolUse.runId,
                stepId: 'step-1',
                toolName: toolUse.toolName,
                input: toolUse.input,
                inputPreview: toolUse.inputPreview,
                capabilities: ['project_read'],
                riskLevel: 'low',
                sideEffect: 'none',
                status: 'pending_approval',
                requestedAt: '2026-05-17T00:00:02.250Z',
              };
              const approvalRequest: ApprovalRequest = {
                approvalRequestId: 'approval-request-1',
                toolCallId: toolUse.toolCallId,
                toolExecutionId: toolExecution.toolExecutionId,
                runId: toolUse.runId,
                stepId: toolExecution.stepId,
                toolName: toolUse.toolName,
                capabilities: toolExecution.capabilities,
                riskLevel: toolExecution.riskLevel,
                title: 'Approve read_file',
                summary: 'User approval is required.',
                preview: { action: 'read_file', targets: [] },
                requestedScope: 'once',
                status: 'pending',
                createdAt: '2026-05-17T00:00:02.300Z',
              };

              return {
                toolResults: [],
                pendingApprovals: [{
                  approvalRequest,
                  toolCall: toolUse,
                  toolExecution,
                }],
              };
            },
            async resumeToolApproval() {
              return {
                toolResult: rejectedToolResult,
                runtimeEvents: approvalResumeRuntimeEvents(rejectedToolResult, 'denied'),
              };
            },
          };
        },
      },
    });
    service.createSession({
      title: 'Session',
      workspacePath: 'C:/all/work/study/megumi',
      createdAt: '2026-05-17T00:00:00.000Z',
    });

    const result = await service.sendSessionMessage({
      requestId: 'ipc-session-message-send-1',
      payload: {
        sessionId: 'session-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: 'Read package.json',
          createdAt: '2026-05-17T00:00:00.000Z',
        }],
        createdAt: '2026-05-17T00:00:00.000Z',
      },
    });
    for await (const _event of result.events) {
      // Drain until waiting for approval.
    }

    const resumeEvents = service.resumeApproval({
      approvalRequestId: 'approval-request-1',
      decision: 'denied',
      decidedAt: '2026-05-17T00:00:05.000Z',
    });
    expect(resumeEvents).toBeDefined();
    for await (const _event of resumeEvents ?? []) {
      // Drain resumed run.
    }

    expect(requests).toHaveLength(2);
    expect(requests[1]?.inputContext.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'tool_continuation',
        toolResultId: 'tool-result-denied',
        text: expect.stringContaining('User denied the request.'),
      }),
    ]));
    expect(JSON.stringify(requests[1]?.inputContext.parts)).toContain('user_rejected');
  });

  it('cancels a waiting approval run without resuming approval continuation', async () => {
    let toolRepository: ToolRepository | undefined;
    const resumeToolApproval = vi.fn(async () => ({
      toolResult: createToolResult(),
    }));
    const service = createServiceWithModelStepStream((request, callIndex) => {
      if (callIndex === 1) {
        return [
          toolUseCreatedEvent(1),
          modelStepCompletedEvent(2),
        ];
      }
      return [assistantOutputCompletedEvent(1)];
    }, {
      createToolRepository(database) {
        toolRepository = new ToolRepository(database);
        return toolRepository;
      },
      toolRuntimeFactory: {
        async create() {
          return {
            async handleToolCalls(input) {
              const toolUse = input.toolCalls[0];
              if (!toolUse) {
                throw new Error('Expected one tool use.');
              }
              const toolExecution: ToolExecution = {
                toolExecutionId: 'tool-execution-1',
                toolCallId: toolUse.toolCallId,
                runId: toolUse.runId,
                stepId: 'step-1',
                toolName: toolUse.toolName,
                input: toolUse.input,
                inputPreview: toolUse.inputPreview,
                capabilities: ['project_read'],
                riskLevel: 'low',
                sideEffect: 'none',
                status: 'pending_approval',
                requestedAt: '2026-05-17T00:00:02.250Z',
              };
              const approvalRequest: ApprovalRequest = {
                approvalRequestId: 'approval-request-1',
                toolCallId: toolUse.toolCallId,
                toolExecutionId: toolExecution.toolExecutionId,
                runId: toolUse.runId,
                stepId: toolExecution.stepId,
                toolName: toolUse.toolName,
                capabilities: toolExecution.capabilities,
                riskLevel: toolExecution.riskLevel,
                title: 'Approve read_file',
                summary: 'User approval is required.',
                preview: { action: 'read_file', targets: [] },
                requestedScope: 'once',
                status: 'pending',
                createdAt: '2026-05-17T00:00:02.300Z',
              };

              return {
                toolResults: [],
                pendingApprovals: [{
                  approvalRequest,
                  toolCall: toolUse,
                  toolExecution,
                }],
              };
            },
            resumeToolApproval,
          };
        },
      },
    });
    service.createSession({
      title: 'Session',
      workspacePath: 'C:/all/work/study/megumi',
      createdAt: '2026-05-17T00:00:00.000Z',
    });

    const result = await service.sendSessionMessage({
      requestId: 'ipc-session-message-send-1',
      payload: {
        sessionId: 'session-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: 'Read package.json',
          createdAt: '2026-05-17T00:00:00.000Z',
        }],
        createdAt: '2026-05-17T00:00:00.000Z',
      },
    });
    for await (const _event of result.events) {
      // Drain until waiting for approval.
    }
    if (!toolRepository) {
      throw new Error('Expected test tool repository.');
    }
    createDurablePendingApprovalRows(toolRepository);
    expect(toolRepository.listPendingApprovalRequestsByRun('run-1')).toHaveLength(1);
    expect(toolRepository.listPendingToolExecutionsByRun('run-1')).toHaveLength(1);

    expect(service.cancelSessionMessage({ targetRequestId: 'ipc-session-message-send-1' })).toBe(true);

    expect(toolRepository.getApprovalRequest('approval-request-1')).toMatchObject({
      status: 'cancelled',
      resolvedAt: '2026-05-17T00:00:00.000Z',
    });
    expect(toolRepository.getToolExecution('tool-execution-1')).toMatchObject({
      status: 'cancelled',
      completedAt: '2026-05-17T00:00:00.000Z',
    });
    expect(service.resumeApproval({
      approvalRequestId: 'approval-request-1',
      decision: 'approved',
      decidedAt: '2026-05-17T00:00:05.000Z',
    })).toBeUndefined();
    expect(resumeToolApproval).not.toHaveBeenCalled();
    expect(service.listRuntimeEventsByRun('run-1').map((event) => event.eventType)).not.toContain('tool.result.created');
  });

  it('cleans up active runs left from a previous runtime on startup', () => {
    db = new Database(':memory:');
    migrateDatabase(db);
    const repository = new SessionRunRepository(db);
    const toolRepository = new ToolRepository(db);
    repository.saveSession({
      sessionId: 'session-1',
      title: 'Startup cleanup',
      status: 'active',
      createdAt: '2026-06-14T00:00:00.000Z',
      updatedAt: '2026-06-14T00:00:00.000Z',
    });
    repository.saveRun({
      runId: 'run-waiting',
      sessionId: 'session-1',
      mode: 'default',
      goal: 'Waiting',
      status: 'waiting_for_approval',
      createdAt: '2026-06-14T00:00:00.000Z',
    });
    repository.saveStep({
      stepId: 'step-waiting',
      runId: 'run-waiting',
      kind: 'model',
      status: 'waiting_for_approval',
    });
    repository.saveModelStep({
      modelStepId: 'model-step-waiting',
      runId: 'run-waiting',
      stepId: 'step-waiting',
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      status: 'waiting_for_approval',
      startedAt: '2026-06-14T00:00:00.000Z',
    });
    createDurablePendingApprovalRows(toolRepository, {
      runId: 'run-waiting',
      stepId: 'step-waiting',
      modelStepId: 'model-step-waiting',
      toolCallId: 'tool-call-waiting',
      toolExecutionId: 'tool-execution-waiting',
      approvalRequestId: 'approval-waiting',
    });
    const service = new SessionRunService({
      repository,
      toolRepository,
      clock: { now: () => '2026-06-14T00:01:00.000Z' },
      ids: {
        eventId: (() => {
          let index = 0;
          return () => {
            index += 1;
            return `cleanup-event-${index}`;
          };
        })(),
      },
    });

    const result = service.cleanupInterruptedRunsOnStartup();

    expect(result.cleanedRunIds).toEqual(['run-waiting']);
    expect(repository.getRun('run-waiting')).toMatchObject({
      status: 'failed',
      completedAt: '2026-06-14T00:01:00.000Z',
      error: {
        code: 'runtime_restarted_with_active_run',
        details: {
          reason: 'runtime_restarted_with_active_run',
        },
      },
    });
    expect(toolRepository.getApprovalRequest('approval-waiting')).toMatchObject({
      status: 'cancelled',
      resolvedAt: '2026-06-14T00:01:00.000Z',
    });
    expect(toolRepository.getToolExecution('tool-execution-waiting')).toMatchObject({
      status: 'cancelled',
      completedAt: '2026-06-14T00:01:00.000Z',
    });
    expect(repository.listRuntimeEventsByRun('run-waiting').map((event) => event.eventType)).toEqual([
      'run.failed',
      'run.status.changed',
    ]);
    expect(repository.listRuntimeEventsByRun('run-waiting')[0]?.payload).toMatchObject({
      error: {
        details: {
          reason: 'runtime_restarted_with_active_run',
          previousStatus: 'waiting_for_approval',
          startupCleanup: true,
        },
      },
    });
  });

  it('waits for all pending approvals from one model step before resuming once with all tool results', async () => {
    const requests: ModelStepRuntimeRequest[] = [];
    const resumeInputs: unknown[] = [];
    const toolResultsByApproval = new Map([
      ['approval-request-1', createToolResult({
        toolResultId: 'tool-result-1',
        toolCallId: 'tool-call-1',
        toolExecutionId: 'tool-execution-1',
        textContent: 'first result',
      })],
      ['approval-request-2', createToolResult({
        toolResultId: 'tool-result-2',
        toolCallId: 'tool-call-2',
        toolExecutionId: 'tool-execution-2',
        textContent: 'second result',
      })],
    ]);
    db = new Database(':memory:');
    migrateDatabase(db);
    const repository = new SessionRunRepository(db);
    const service = new SessionRunService({
      repository,
      modelStepProvider: {
        streamModelStep: async function* (request) {
          requests.push(request);
          if (requests.length === 1) {
            yield toolUseCreatedEventFor({
              sequence: 1,
              toolCallId: 'tool-use-1',
              providerToolCallId: 'provider-tool-use-1',
              input: { path: 'package.json' },
            });
            yield toolUseCreatedEventFor({
              sequence: 2,
              toolCallId: 'tool-use-2',
              providerToolCallId: 'provider-tool-use-2',
              input: { path: 'README.md' },
            });
            yield modelStepCompletedEvent(3);
            return;
          }

          yield {
            ...assistantOutputCompletedEvent(1),
            stepId: request.stepId,
          };
        },
        completeModelStep: async () => ({ ok: true, text: '' }),
      cancelModelStep: () => true,
      },
      toolRuntimeFactory: {
        async create() {
          return {
            async handleToolCalls(input) {
              return {
                toolResults: [],
                pendingApprovals: input.toolCalls.map((toolUse, index) => {
                  const ordinal = index + 1;
                  const toolExecution: ToolExecution = {
                    toolExecutionId: `tool-execution-${ordinal}`,
                    toolCallId: toolUse.toolCallId,
                    runId: toolUse.runId,
                    stepId: 'step-1',
                    toolName: toolUse.toolName,
                    input: toolUse.input,
                    inputPreview: toolUse.inputPreview,
                    capabilities: ['project_read'],
                    riskLevel: 'low',
                    sideEffect: 'none',
                    status: 'pending_approval',
                    requestedAt: '2026-05-17T00:00:02.250Z',
                  };
                  const approvalRequest: ApprovalRequest = {
                    approvalRequestId: `approval-request-${ordinal}`,
                    toolCallId: toolUse.toolCallId,
                    toolExecutionId: toolExecution.toolExecutionId,
                    runId: toolUse.runId,
                    stepId: toolExecution.stepId,
                    toolName: toolUse.toolName,
                    capabilities: toolExecution.capabilities,
                    riskLevel: toolExecution.riskLevel,
                    title: `Approve ${toolUse.toolName}`,
                    summary: 'User approval is required.',
                    preview: {
                      action: toolUse.inputPreview.summary,
                      targets: [],
                    },
                    requestedScope: 'once',
                    status: 'pending',
                    createdAt: '2026-05-17T00:00:02.300Z',
                  };

                  return {
                    approvalRequest,
                    toolCall: toolUse,
                    toolExecution,
                  };
                }),
              };
            },
            async resumeToolApproval(input) {
              resumeInputs.push(input);
              const toolResult = toolResultsByApproval.get(input.approvalRequestId);
              return toolResult
                ? {
                    toolResult,
                    runtimeEvents: approvalResumeRuntimeEvents(toolResult, 'success'),
                  }
                : undefined;
            },
          };
        },
      },
      clock: { now: () => '2026-05-17T00:00:04.000Z' },
      ids: {
        sessionId: () => 'session-1',
        runId: () => 'run-1',
        stepId: (() => {
          let index = 0;
          return () => {
            index += 1;
            return `step-${index}`;
          };
        })(),
        eventId: (() => {
          let index = 0;
          return () => {
            index += 1;
            return `service-event-${index}`;
          };
        })(),
        messageId: (() => {
          let index = 0;
          return () => {
            index += 1;
            return `message-${index}`;
          };
        })(),
      },
    });
    service.createSession({
      title: 'Session',
      workspacePath: 'C:/all/work/study/megumi',
      createdAt: '2026-05-17T00:00:00.000Z',
    });

    const result = await service.sendSessionMessage({
      requestId: 'ipc-session-message-send-1',
      payload: {
        sessionId: 'session-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: 'Read two files',
          createdAt: '2026-05-17T00:00:00.000Z',
        }],
        createdAt: '2026-05-17T00:00:00.000Z',
      },
    });
    const streamed = [];
    for await (const event of result.events) {
      streamed.push(event);
    }
    expect(repository.getRun('run-1')).toMatchObject({ status: 'waiting_for_approval' });

    const firstResume = [];
    for await (const event of service.resumeApproval({
      approvalRequestId: 'approval-request-1',
      decision: 'approved',
      decidedAt: '2026-05-17T00:00:05.000Z',
    }) ?? []) {
      firstResume.push(event);
    }

    expect(requests).toHaveLength(1);
    expect(firstResume.map((event) => event.eventType)).toEqual([
      'approval.resolved',
      'tool.execution.started',
      'tool.execution.completed',
      'tool.result.created',
    ]);
    expect(repository.getRun('run-1')).toMatchObject({ status: 'waiting_for_approval' });

    const secondResume = [];
    for await (const event of service.resumeApproval({
      approvalRequestId: 'approval-request-2',
      decision: 'approved',
      decidedAt: '2026-05-17T00:00:06.000Z',
    }) ?? []) {
      secondResume.push(event);
    }

    expect(resumeInputs).toEqual([
      expect.objectContaining({ approvalRequestId: 'approval-request-1' }),
      expect.objectContaining({ approvalRequestId: 'approval-request-2' }),
    ]);
    expect(requests).toHaveLength(2);
    expect(requests[1]?.inputContext.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'tool_continuation',
        toolResultId: 'tool-result-1',
      }),
      expect.objectContaining({
        kind: 'tool_continuation',
        toolResultId: 'tool-result-2',
      }),
    ]));
    expect(secondResume.map((event) => event.eventType)).toEqual([
      'approval.resolved',
      'run.status.changed',
      'tool.execution.started',
      'tool.execution.completed',
      'tool.result.created',
      'assistant.output.completed',
      'step.status.changed',
      'step.completed',
      'run.status.changed',
      'run.completed',
    ]);
    expect([
      ...streamed,
      ...firstResume,
      ...secondResume,
    ].filter((event) => event.eventType === 'run.started')).toHaveLength(1);
    expect(service.listRuntimeEventsByRun('run-1')
      .filter((event) => event.eventType === 'run.started')).toHaveLength(1);
  });

  it('loads project instructions into the initial model step input context', async () => {
    const requests: ModelStepRuntimeRequest[] = [];
    const service = createServiceWithModelStepStream([
      assistantOutputCompletedEvent(1),
    ], {
      onRequest: (request) => requests.push(request),
      agentInstructionSourceService: {
        async loadInstructionSources({ projectRoot, effectiveCwd, loadedAt }) {
          expect(projectRoot).toBe('C:/project');
          expect(effectiveCwd).toBe('C:\\project');
          return [{
            sourceId: 'project-instruction:AGENTS.md',
            sourceKind: 'project_instruction',
            status: 'included',
            sourceUri: 'project-instruction://AGENTS.md',
            relativePath: 'AGENTS.md',
            text: `# rules for ${projectRoot}`,
            loadedAt,
            sizeBytes: 20,
            includedBytes: 20,
            hardCapBytes: 65536,
            truncated: false,
          }];
        },
      },
    });
    service.createSession({
      title: 'Project session',
      workspaceId: 'workspace-1',
      workspacePath: 'C:/project',
      createdAt: '2026-05-17T00:00:00.000Z',
    });

    const result = await service.sendSessionMessage({
      requestId: 'request-1',
      payload: {
        sessionId: 'session-1',
        providerId: 'openai',
        modelId: 'gpt-4.1',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: 'Continue',
          createdAt: '2026-05-17T00:00:00.000Z',
        }],
        createdAt: '2026-05-17T00:00:00.000Z',
        context: {
          workspaceId: 'workspace-1',
          workspacePath: 'C:/project',
          permissionMode: 'default',
        },
      },
    });
    const streamed: RuntimeEvent[] = [];
    for await (const event of result.events) {
      streamed.push(event);
    }

    expect(streamed.map((event) => event.eventType)).toContain('assistant.output.completed');
    expect(requests[0]?.inputContext.parts[0]).toMatchObject({
      kind: 'instruction',
      instructionKind: 'project',
      text: expect.stringContaining('# rules for C:/project'),
    });
  });

  it('passes host runtime sources into compaction probe and initial model input builds', async () => {
    const requests: ModelStepRuntimeRequest[] = [];
    const loadInstructionCalls: unknown[] = [];
    const sessionInstructionSources: SessionInstructionSourceSnapshot[] = [{
      sourceId: 'session-instruction:active',
      sourceKind: 'session_instruction',
      text: 'Prefer terse output for this session.',
      loadedAt: '2026-05-17T00:00:00.000Z',
    }, {
      sourceId: 'mode-instruction:debug',
      sourceKind: 'mode_instruction',
      text: 'Inspect evidence before changing files.',
      loadedAt: '2026-05-17T00:00:00.000Z',
    }];
    const service = createServiceWithModelStepStream([assistantOutputCompletedEvent(1)], {
      onRequest: (request) => requests.push(request),
      globalInstructionDirectoryProvider: {
        listGlobalInstructionDirs: () => ['C:/megumi/global-instructions'],
      },
      sessionInstructionSourceProvider: {
        listSessionInstructionSources: () => sessionInstructionSources,
      },
      runEffectiveCwdProvider: {
        getRunEffectiveCwd: () => 'src/app',
      },
      agentInstructionSourceService: {
        async loadInstructionSources(input) {
          loadInstructionCalls.push(input);
          return [{
            sourceId: 'global-instruction:CLAUDE.md',
            sourceKind: 'global_instruction',
            status: 'included',
            sourceUri: 'global-instruction://CLAUDE.md',
            relativePath: 'CLAUDE.md',
            text: '# global rules',
            loadedAt: input.loadedAt,
            sizeBytes: 14,
            includedBytes: 14,
            hardCapBytes: 65536,
            truncated: false,
          }];
        },
      },
      sessionCompactionOrchestrator: {
        async compactIfNeeded(input): Promise<SessionCompactionOrchestrationResult> {
          expect(input.budgetProbeInputContext.parts).toEqual(expect.arrayContaining([
            expect.objectContaining({ kind: 'instruction', instructionKind: 'session' }),
            expect.objectContaining({ kind: 'instruction', instructionKind: 'mode' }),
            expect.objectContaining({ kind: 'runtime_constraint', constraintKind: 'effective_cwd' }),
          ]));
          return { status: 'skipped', events: [] };
        },
      },
    });
    service.createSession({
      title: 'Project session',
      workspaceId: 'workspace-1',
      workspacePath: 'C:/project',
      createdAt: '2026-05-17T00:00:00.000Z',
    });

    const result = await service.sendSessionMessage({
      requestId: 'request-1',
      payload: {
        sessionId: 'session-1',
        providerId: 'openai',
        modelId: 'gpt-4.1',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: 'Continue',
          createdAt: '2026-05-17T00:00:00.000Z',
        }],
        createdAt: '2026-05-17T00:00:00.000Z',
        context: {
          workspaceId: 'workspace-1',
          workspacePath: 'C:/project',
          permissionMode: 'default',
        },
      },
    });
    for await (const _event of result.events) {
      // Drain the stream so the model request is built.
    }

    expect(loadInstructionCalls).toEqual([
      expect.objectContaining({
        projectRoot: 'C:/project',
        effectiveCwd: 'C:\\project\\src\\app',
        globalInstructionDirs: ['C:/megumi/global-instructions'],
      }),
      expect.objectContaining({
        projectRoot: 'C:/project',
        effectiveCwd: 'C:\\project\\src\\app',
        globalInstructionDirs: ['C:/megumi/global-instructions'],
      }),
    ]);
    expect(requests[0]?.inputContext.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'instruction', instructionKind: 'global' }),
      expect.objectContaining({ kind: 'instruction', instructionKind: 'session' }),
      expect.objectContaining({ kind: 'instruction', instructionKind: 'mode' }),
      expect.objectContaining({ kind: 'runtime_constraint', constraintKind: 'effective_cwd' }),
    ]));
  });

  it('refreshes project instructions for tool continuation model steps', async () => {
    const requests: ModelStepRuntimeRequest[] = [];
    const sessionInstructionSources: SessionInstructionSourceSnapshot[] = [{
      sourceId: 'session-instruction:continuation',
      sourceKind: 'session_instruction',
      text: 'Keep continuation scoped to the current run.',
      loadedAt: '2026-05-17T00:00:00.000Z',
    }];
    const service = createServiceWithModelStepStream((request, callIndex) => {
      if (callIndex === 1) {
        return [
          toolUseCreatedEvent(1),
          modelStepCompletedEvent(2),
        ];
      }

      return [{
        ...assistantOutputCompletedEvent(1),
        stepId: request.stepId,
      }];
    }, {
      onRequest: (request) => requests.push(request),
      toolRuntimeFactory: {
        async create() {
          return {
            async handleToolCalls() {
              return {
                toolResults: [{
                  toolResultId: 'tool-result-1',
                  toolCallId: 'tool-use-1',
                  runId: 'run-1',
                  kind: 'success',
                  textContent: 'file content',
                  redactionState: 'none',
                  createdAt: '2026-05-17T00:00:01.000Z',
                }],
              };
            },
            async resumeToolApproval() {
              return undefined;
            },
          };
        },
      },
      toolDefinitionProvider: {
        listDefinitions: () => [{
          name: 'read_file',
          title: 'Read file',
          description: 'Read a file.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
          capabilities: ['project_read'],
          riskLevel: 'low',
          sideEffect: 'none',
          availability: { status: 'available' },
        }],
      },
      globalInstructionDirectoryProvider: {
        listGlobalInstructionDirs: () => ['C:/megumi/global-instructions'],
      },
      sessionInstructionSourceProvider: {
        listSessionInstructionSources: () => sessionInstructionSources,
      },
      runEffectiveCwdProvider: {
        getRunEffectiveCwd: () => 'packages/core',
      },
      agentInstructionSourceService: {
        async loadInstructionSources({ projectRoot, effectiveCwd, loadedAt }) {
          expect(projectRoot).toBe('C:/project');
          expect(effectiveCwd).toBe('C:\\project\\packages\\core');
          return [{
            sourceId: 'project-instruction:AGENTS.md',
            sourceKind: 'project_instruction',
            status: 'included',
            sourceUri: 'project-instruction://AGENTS.md',
            relativePath: 'AGENTS.md',
            text: `# rules loaded at ${loadedAt}`,
            loadedAt,
            sizeBytes: 20,
            includedBytes: 20,
            hardCapBytes: 65536,
            truncated: false,
          }];
        },
      },
    });
    service.createSession({
      title: 'Project session',
      workspaceId: 'workspace-1',
      workspacePath: 'C:/project',
      createdAt: '2026-05-17T00:00:00.000Z',
    });

    const result = await service.sendSessionMessage({
      requestId: 'request-1',
      payload: {
        sessionId: 'session-1',
        providerId: 'openai',
        modelId: 'gpt-4.1',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: 'Read package.json',
          createdAt: '2026-05-17T00:00:00.000Z',
        }],
        createdAt: '2026-05-17T00:00:00.000Z',
        context: {
          workspaceId: 'workspace-1',
          workspacePath: 'C:/project',
          permissionMode: 'default',
        },
      },
    });
    const streamed: RuntimeEvent[] = [];
    for await (const event of result.events) {
      streamed.push(event);
    }

    expect(streamed.map((event) => event.eventType)).toContain('tool.result.created');
    expect(requests).toHaveLength(2);
    expect(requests[1]?.inputContext.trace.metadata).toMatchObject({
      traceId: 'trace:model-input:run-1:step-1:tool-continuation',
      modelTarget: {
        providerId: 'openai',
        modelId: 'gpt-4.1',
      },
    });
    expect(requests[1]?.inputContext.parts[0]).toMatchObject({
      kind: 'instruction',
      instructionKind: 'project',
      text: expect.stringContaining('# rules loaded at'),
    });
    expect(requests[1]?.inputContext.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'instruction', instructionKind: 'session' }),
      expect.objectContaining({ kind: 'runtime_constraint', constraintKind: 'effective_cwd' }),
      expect.objectContaining({ kind: 'tool_continuation' }),
    ]));
  });

  it('registers pending approvals before yielding approval runtime events', async () => {
    const requests: ModelStepRuntimeRequest[] = [];
    const sessionInstructionSources: SessionInstructionSourceSnapshot[] = [{
      sourceId: 'session-instruction:approval',
      sourceKind: 'session_instruction',
      text: 'Use the approved tool result before answering.',
      loadedAt: '2026-05-17T00:00:00.000Z',
    }];
    const memoryRecallSources = [{
      sourceId: 'memory-recall:snapshot-approval',
      text: 'Relevant long-term memory:\n\n1. [project/fact] Approval resumes should keep recalled memory.',
      memoryIds: ['memory-project-approval'],
      loadedAt: '2026-05-17T00:00:00.000Z',
      metadata: {
        snapshotId: 'memory-recall-snapshot-approval',
        recallRequestId: 'memory-recall-request-approval',
        selectedCount: 1,
      },
    }];
    const memoryRecallSeed = {
      queryText: 'Read package.json',
      metadata: {
        snapshotId: 'memory-recall-snapshot-approval',
        recallRequestId: 'memory-recall-request-approval',
        selectedCount: 1,
      },
    };
    const recallForNewUserInput = vi.fn(async () => ({
      status: 'ok' as const,
      memoryRecallSources,
      memoryRecallSeed,
      diagnostics: [],
    }));
    const service = createServiceWithModelStepStream((request, callIndex) => {
      requests.push(request);
      if (callIndex === 1) {
        return [
          toolUseCreatedEvent(1),
          modelStepCompletedEvent(2),
        ];
      }

      return [{
        ...assistantOutputCompletedEvent(1),
        stepId: request.stepId,
      }];
    }, {
      toolRuntimeFactory: {
        async create() {
          return {
            async handleToolCalls(input) {
              const toolUse = input.toolCalls[0];
              const toolExecution: ToolExecution = {
                toolExecutionId: 'tool-execution-1',
                toolCallId: toolUse.toolCallId,
                runId: toolUse.runId,
                stepId: 'step-1',
                toolName: toolUse.toolName,
                input: toolUse.input,
                inputPreview: toolUse.inputPreview,
                capabilities: ['project_read'],
                riskLevel: 'low',
                sideEffect: 'none',
                status: 'pending_approval',
                requestedAt: '2026-05-17T00:00:02.250Z',
              };
              const approvalRequest: ApprovalRequest = {
                approvalRequestId: 'approval-request-1',
                toolCallId: toolUse.toolCallId,
                toolExecutionId: toolExecution.toolExecutionId,
                runId: toolUse.runId,
                stepId: toolExecution.stepId,
                toolName: toolUse.toolName,
                capabilities: toolExecution.capabilities,
                riskLevel: toolExecution.riskLevel,
                title: `Approve ${toolUse.toolName}`,
                summary: 'User approval is required.',
                preview: {
                  action: toolUse.inputPreview.summary,
                  targets: [],
                },
                requestedScope: 'once',
                status: 'pending',
                createdAt: '2026-05-17T00:00:02.300Z',
              };

              return {
                pendingApprovals: [{
                  approvalRequest,
                  toolCall: toolUse,
                  toolExecution,
                }],
                runtimeEvents: [{
                  eventId: 'event-approval-requested',
                  schemaVersion: 1,
                  eventType: 'approval.requested',
                  runId: 'run-1',
                  sessionId: 'session-1',
                  stepId: 'step-1',
                  sequence: 3,
                  createdAt: approvalRequest.createdAt,
                  source: 'approval',
                  visibility: 'user',
                  persist: 'required',
                  payload: { approvalRequest },
                }],
              };
            },
            async resumeToolApproval() {
              const toolResult = createToolResult({
                createdAt: '2026-05-17T00:00:05.000Z',
                toolCallId: 'tool-call-1',
              });
              return {
                toolResult,
                runtimeEvents: approvalResumeRuntimeEvents(toolResult, 'success'),
              };
            },
          };
        },
      },
      toolDefinitionProvider: {
        listDefinitions: () => [{
          name: 'read_file',
          title: 'Read file',
          description: 'Read a file.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
          capabilities: ['project_read'],
          riskLevel: 'low',
          sideEffect: 'none',
          availability: { status: 'available' },
        }],
      },
      sessionInstructionSourceProvider: {
        listSessionInstructionSources: () => sessionInstructionSources,
      },
      megumiHomePath: 'C:/megumi-home',
      memoryRecallService: { recallForNewUserInput },
      runEffectiveCwdProvider: {
        getRunEffectiveCwd: () => 'packages/approval',
      },
      agentInstructionSourceService: {
        async loadInstructionSources({ effectiveCwd, loadedAt }) {
          expect(effectiveCwd).toBe('C:\\project\\packages\\approval');
          return [{
            sourceId: 'project-instruction:AGENTS.md',
            sourceKind: 'project_instruction',
            status: 'included',
            sourceUri: 'project://AGENTS.md',
            relativePath: 'AGENTS.md',
            text: `# approval rules loaded at ${loadedAt}`,
            loadedAt,
            sizeBytes: 20,
            includedBytes: 20,
            hardCapBytes: 65536,
            truncated: false,
          }];
        },
      },
    });
    service.createSession({
      title: 'Project session',
      workspaceId: 'workspace-1',
      workspacePath: 'C:/project',
      createdAt: '2026-05-17T00:00:00.000Z',
    });

    const result = await service.sendSessionMessage({
      requestId: 'request-1',
      payload: {
        sessionId: 'session-1',
        providerId: 'openai',
        modelId: 'gpt-4.1',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: 'Read package.json',
          createdAt: '2026-05-17T00:00:00.000Z',
        }],
        createdAt: '2026-05-17T00:00:00.000Z',
        context: {
          workspaceId: 'workspace-1',
          workspacePath: 'C:/project',
          permissionMode: 'default',
        },
      },
    });
    const iterator = result.events[Symbol.asyncIterator]();
    const initialEvents: RuntimeEvent[] = [];
    while (true) {
      const next = await iterator.next();
      if (next.done) {
        break;
      }
      initialEvents.push(next.value);
      if (next.value.eventType === 'approval.requested') {
        break;
      }
    }

    const resumeEvents = service.resumeApproval({
      approvalRequestId: 'approval-request-1',
      decision: 'approved',
      decidedAt: '2026-05-17T00:00:05.000Z',
    });

    expect(initialEvents.map((event) => event.eventType)).toContain('approval.requested');
    expect(resumeEvents).not.toBeUndefined();

    while (!(await iterator.next()).done) {
      // Drain the initial stream after proving immediate resume lookup worked.
    }

    const streamedResumeEvents: RuntimeEvent[] = [];
    for await (const event of resumeEvents ?? []) {
      streamedResumeEvents.push(event);
    }

    expect(streamedResumeEvents.map((event) => event.eventType)).toContain('assistant.output.completed');
    expect(requests[1]?.inputContext.trace.metadata).toMatchObject({
      traceId: 'trace:model-input:run-1:step-1:approval-resume',
      memoryRecallSeed,
      modelTarget: {
        providerId: 'openai',
        modelId: 'gpt-4.1',
      },
    });
    expect(requests[1]?.inputContext.parts[0]).toMatchObject({
      kind: 'instruction',
      instructionKind: 'project',
      text: expect.stringContaining('# approval rules loaded at 2026-05-17T00:00:05.000Z'),
    });
    expect(requests[1]?.inputContext.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'instruction', instructionKind: 'session' }),
      expect.objectContaining({ kind: 'runtime_constraint', constraintKind: 'effective_cwd' }),
      expect.objectContaining({
        kind: 'memory',
        memoryKind: 'memory_recall',
        text: expect.stringContaining('Approval resumes should keep recalled memory.'),
      }),
    ]));
    expect(recallForNewUserInput).toHaveBeenCalledTimes(1);
  });

  it('passes workspace baseline context to model step requests for session messages', async () => {
    const requests: ModelStepRuntimeRequest[] = [];
    const baselineInputs: unknown[] = [];
    const service = createServiceWithModelStepStream([], {
      contextService: {
        createBaselineContext: (input) => {
          baselineInputs.push(input);
          return {
            contextId: `context:${input.runId}`,
            runId: input.runId,
            workspaceBoundary: {
              workspaceId: input.workspaceId,
              rootPath: input.workspacePath,
              symlinkPolicy: 'deny_outside_workspace',
              outsideWorkspacePolicy: 'deny',
              secretPolicySummary: 'No secrets.',
              createdAt: '2026-05-17T00:00:00.000Z',
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
            contextBudgetPolicy: input.contextBudgetPolicy,
            buildMetadata: {
              buildReason: 'run_baseline',
              builtAt: '2026-05-17T00:00:00.000Z',
              selectionRecordIds: [],
              redactionRecordIds: [],
              truncationRecordIds: [],
            },
            createdAt: '2026-05-17T00:00:00.000Z',
          } satisfies RunContext;
        },
      },
      onRequest: (request) => requests.push(request),
    });

    const result = await service.sendSessionMessage({
      requestId: 'ipc-session-message-send-1',
      payload: {
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: 'Use workspace context',
          createdAt: '2026-05-17T00:00:00.000Z',
        }],
        context: {
          workspaceId: 'workspace-1',
          workspacePath: 'C:/all/work/study/megumi',
          sessionTitle: 'Workspace session',
          permissionMode: 'accept_edits',
        },
        createdAt: '2026-05-17T00:00:00.000Z',
      },
    });

    for await (const _event of result.events) {
      // Drain the stream so the provider request is observed.
    }

    expect(baselineInputs).toEqual([
      expect.objectContaining({
        runId: 'run-1',
        goal: 'Use workspace context',
        workspaceId: 'workspace-1',
        workspacePath: 'C:/all/work/study/megumi',
        contextBudgetPolicy: {
          modelContextWindow: 8192,
          reservedOutputTokens: 1024,
          keepRecentTokens: 7168,
        },
      }),
    ]);
    expect(requests[0]).not.toHaveProperty('context');
    expect(requests[0]?.inputContext.budget).toMatchObject({
      modelContextWindow: 8192,
      reservedOutputTokens: 1024,
      availableInputTokens: 7168,
      keepRecentTokens: 7168,
    });
    expect(requests[0]?.inputContext.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'runtime_constraint',
        constraintKind: 'effective_cwd',
        text: expect.stringContaining('Project root: C:/all/work/study/megumi'),
      }),
    ]));
    const source = fs.readFileSync(path.join(process.cwd(), 'apps/desktop/src/main/services/session/session-run.service.ts'), 'utf8');
    expect(source).not.toContain('runContext: context');
    expect(source).not.toContain('runContext:');
  });

  it('creates permission snapshots and passes them to model step requests for session messages', async () => {
    const records: unknown[] = [];
    const requests: ModelStepRuntimeRequest[] = [];
    const service = createServiceWithModelStepStream([], {
      permissionSnapshotService: {
        createPermissionSnapshot: (input) => {
          records.push(input);
          return {
            permissionSnapshotId: 'permission-snapshot:1',
            runId: input.runId,
            permissionLabel: input.permissionMode,
            permissionModeState: input.permissionModeState ?? {
              permissionMode: 'plan',
              source: 'system',
            },
            createdAt: input.createdAt,
          };
        },
        linkAcceptedSourcePlan: (input) => input,
        createPlanRecordForRun: () => undefined,
        getPlanByRun: () => undefined,
        updatePlanStatus: () => {
          throw new Error('not implemented');
        },
      },
      onRequest: (request) => requests.push(request),
    });
    service.createSession({
      title: 'Session',
      createdAt: '2026-05-17T00:00:00.000Z',
    });

    const result = await service.sendSessionMessage({
      requestId: 'ipc-session-message-send-1',
      payload: {
        sessionId: 'session-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: 'Write a plan',
          createdAt: '2026-05-17T00:00:00.000Z',
        }],
        context: {
          permissionMode: 'plan',
        },
        createdAt: '2026-05-17T00:00:00.000Z',
      },
    });

    for await (const _event of result.events) {
      // Drain the stream so the provider request is observed.
    }

    expect(records).toEqual([
      expect.objectContaining({
        runId: 'run-1',
        permissionMode: 'plan',
        createdAt: '2026-05-17T00:00:00.000Z',
      }),
    ]);
    expect(requests[0]).not.toHaveProperty('modeSnapshot');
    expect(requests[0]).not.toHaveProperty('permissionSnapshotRef');
    expect(requests[0]?.inputContext.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'runtime_constraint',
        constraintKind: 'permission_posture',
        text: expect.stringContaining('Permission mode:'),
      }),
    ]));
  });

  it('normalizes review preprocessing to plan mode and passes preprocessing into model input context', async () => {
    const records: unknown[] = [];
    const requests: ModelStepRuntimeRequest[] = [];
    const service = createServiceWithModelStepStream([], {
      permissionSnapshotService: {
        createPermissionSnapshot: (input) => {
          records.push(input);
          return {
            permissionSnapshotId: 'permission-snapshot:input-review',
            runId: input.runId,
            permissionLabel: input.permissionMode,
            permissionModeState: input.permissionModeState ?? { permissionMode: 'default', source: 'system' },
            createdAt: input.createdAt,
          };
        },
        linkAcceptedSourcePlan: (input) => input,
        createPlanRecordForRun: () => undefined,
        getPlanByRun: () => undefined,
        updatePlanStatus: () => {
          throw new Error('not implemented');
        },
      },
      onRequest: (request) => {
        requests.push(request);
      },
    });

    const result = await service.sendSessionMessage({
      requestId: 'ipc-session-message-send-1',
      payload: {
        sessionId: 'session-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: '/review 当前改动',
          createdAt: '2026-05-17T00:00:00.000Z',
        }],
        context: {
          permissionMode: 'default',
          permissionSource: 'user',
          preprocessing: {
            originalText: '/review 当前改动',
            effectiveUserText: '当前改动',
            entries: [
              {
                kind: 'intent',
                sourceId: 'input:intent:review',
                sourceName: '/review',
                visibility: 'model_visible',
                instructionText: 'Current input comes from the review intent.',
                intentId: 'review',
                commandName: 'review',
                defaultPermissionMode: 'plan',
                defaultPermissionSource: 'intent_default',
                metadata: {
                  intentName: 'code_review',
                  argsText: '当前改动',
                },
              },
            ],
            diagnostics: [],
          },
        },
        createdAt: '2026-05-17T00:00:00.000Z',
      },
    });

    for await (const _event of result.events) {
      // Drain events so the model request is created.
    }

    expect(records).toEqual([
      expect.objectContaining({
        permissionMode: 'plan',
        permissionModeState: {
          permissionMode: 'plan',
          source: 'intent_default',
        },
        metadata: {
          inputPreprocessing: expect.objectContaining({
            originalText: '/review 当前改动',
            effectiveUserText: '当前改动',
          }),
        },
      }),
    ]);
    expect(requests[0]?.inputContext.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'instruction',
        instructionKind: 'intent',
        text: 'Current input comes from the review intent.',
      }),
      expect.objectContaining({
        kind: 'current_turn',
        text: '当前改动',
      }),
    ]));
  });

  it('keeps summary preprocessing on selected permission mode and materializes prompt template instruction', async () => {
    const records: unknown[] = [];
    const requests: ModelStepRuntimeRequest[] = [];
    const service = createServiceWithModelStepStream([], {
      permissionSnapshotService: {
        createPermissionSnapshot: (input) => {
          records.push(input);
          return {
            permissionSnapshotId: 'permission-snapshot:summary',
            runId: input.runId,
            permissionLabel: input.permissionMode,
            permissionModeState: input.permissionModeState ?? { permissionMode: 'default', source: 'system' },
            createdAt: input.createdAt,
          };
        },
        linkAcceptedSourcePlan: (input) => input,
        createPlanRecordForRun: () => undefined,
        getPlanByRun: () => undefined,
        updatePlanStatus: () => {
          throw new Error('not implemented');
        },
      },
      onRequest: (request) => {
        requests.push(request);
      },
    });

    const result = await service.sendSessionMessage({
      requestId: 'ipc-session-message-send-1',
      payload: {
        sessionId: 'session-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: '/summary',
          createdAt: '2026-05-17T00:00:00.000Z',
        }],
        context: {
          permissionMode: 'accept_edits',
          permissionSource: 'user',
          preprocessing: {
            originalText: '/summary',
            effectiveUserText: '总结当前会话',
            entries: [
              {
                kind: 'prompt_template',
                sourceId: 'input:prompt-template:summary',
                sourceName: '/summary',
                visibility: 'model_visible',
                instructionText: '请总结当前会话。',
                templateId: 'summary',
                commandName: 'summary',
                templateSource: 'builtin',
              },
            ],
            diagnostics: [],
          },
        },
        createdAt: '2026-05-17T00:00:00.000Z',
      },
    });

    for await (const _event of result.events) {
      // Drain events so the model request is created.
    }

    expect(records).toEqual([
      expect.objectContaining({
        permissionMode: 'accept_edits',
        permissionModeState: {
          permissionMode: 'accept_edits',
          source: 'user',
        },
      }),
    ]);
    expect(requests[0]?.inputContext.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'instruction',
        instructionKind: 'prompt_template',
        text: '请总结当前会话。',
      }),
      expect.objectContaining({
        kind: 'current_turn',
        text: '总结当前会话',
      }),
    ]));
  });
  it('saves session message permission snapshots with the real permission snapshot repository', async () => {
    db = new Database(':memory:');
    migrateDatabase(db);
    const requests: ModelStepRuntimeRequest[] = [];
    const sessionRepository = new SessionRunRepository(db);
    const permissionSnapshotRepository = new PermissionSnapshotRepository(db);
    const service = new SessionRunService({
      repository: sessionRepository,
      permissionSnapshotService: new PermissionSnapshotService({
        repository: permissionSnapshotRepository,
        ids: {
          permissionSnapshotId: () => 'permission-snapshot:real-repo',
          planArtifactId: () => 'plan:real-repo',
        },
      }),
      modelStepProvider: {
        streamModelStep: async function* (request) {
          requests.push(request);
        },
        completeModelStep: async () => ({ ok: true, text: '' }),
      cancelModelStep: () => true,
      },
      clock: { now: () => '2026-05-17T00:00:00.000Z' },
      ids: {
        sessionId: () => 'session-1',
        runId: () => 'run-1',
        stepId: () => 'step-1',
        messageId: (() => {
          let index = 0;
          return () => {
            index += 1;
            return `message-${index}`;
          };
        })(),
      },
    });

    service.createSession({
      title: 'Session',
      createdAt: '2026-05-17T00:00:00.000Z',
    });

    const result = await service.sendSessionMessage({
      requestId: 'ipc-session-message-send-1',
      payload: {
        sessionId: 'session-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: 'Write a plan',
          createdAt: '2026-05-17T00:00:00.000Z',
        }],
        context: {
          permissionMode: 'plan',
        },
        createdAt: '2026-05-17T00:00:00.000Z',
      },
    });

    for await (const _event of result.events) {
      // Drain the stream so the provider request is observed.
    }

    expect(requests[0]).not.toHaveProperty('modeSnapshot');
    expect(requests[0]).not.toHaveProperty('permissionSnapshotRef');
    expect(sessionRepository.getRun('run-1')).toMatchObject({
      mode: 'plan',
      permissionSnapshotRef: 'permission-snapshot:real-repo',
    });
    expect(permissionSnapshotRepository.getPermissionSnapshotByRun('run-1')).toMatchObject({
      permissionModeState: expect.objectContaining({
        permissionMode: 'plan',
      }),
    });
  });

  it('persists input preprocessing metadata on session message permission snapshots with the real repository', async () => {
    db = new Database(':memory:');
    migrateDatabase(db);
    const sessionRepository = new SessionRunRepository(db);
    const permissionSnapshotRepository = new PermissionSnapshotRepository(db);
    const service = new SessionRunService({
      repository: sessionRepository,
      permissionSnapshotService: new PermissionSnapshotService({
        repository: permissionSnapshotRepository,
        ids: {
          permissionSnapshotId: () => 'permission-snapshot:workflow-real-repo',
          planArtifactId: () => 'plan:workflow-real-repo',
        },
      }),
      modelStepProvider: {
        streamModelStep: async function* () {
          // No provider events are needed for snapshot persistence.
        },
        completeModelStep: async () => ({ ok: true, text: '' }),
      cancelModelStep: () => true,
      },
      clock: { now: () => '2026-05-17T00:00:00.000Z' },
      ids: {
        sessionId: () => 'session-1',
        runId: () => 'run-1',
        stepId: () => 'step-1',
        messageId: (() => {
          let index = 0;
          return () => {
            index += 1;
            return `message-${index}`;
          };
        })(),
      },
    });

    service.createSession({
      title: 'Session',
      createdAt: '2026-05-17T00:00:00.000Z',
    });

    const result = await service.sendSessionMessage({
      requestId: 'ipc-session-message-send-1',
      payload: {
        sessionId: 'session-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: '/review 当前改动',
          createdAt: '2026-05-17T00:00:00.000Z',
        }],
        context: {
          preprocessing: {
            originalText: '/review 当前改动',
            effectiveUserText: '当前改动',
            entries: [
              {
                kind: 'intent',
                sourceId: 'input:intent:review',
                sourceName: '/review',
                visibility: 'model_visible',
                instructionText: 'Current input comes from the review intent.',
                intentId: 'review',
                commandName: 'review',
                defaultPermissionMode: 'plan',
                defaultPermissionSource: 'intent_default',
                metadata: {
                  intentName: 'code_review',
                  argsText: '当前改动',
                },
              },
            ],
            diagnostics: [],
          },
        },
        createdAt: '2026-05-17T00:00:00.000Z',
      },
    });

    for await (const _event of result.events) {
      // Drain the stream so the provider request is observed.
    }

    expect(sessionRepository.getRun('run-1')).toMatchObject({
      mode: 'plan',
      permissionSnapshotRef: 'permission-snapshot:workflow-real-repo',
    });
    expect(permissionSnapshotRepository.getPermissionSnapshotByRun('run-1')).toMatchObject({
      permissionModeState: {
        permissionMode: 'plan',
        source: 'intent_default',
      },
      metadata: {
        inputPreprocessing: expect.objectContaining({
          originalText: '/review 当前改动',
          effectiveUserText: '当前改动',
          entries: expect.arrayContaining([
            expect.objectContaining({
              kind: 'intent',
              intentId: 'review',
              commandName: 'review',
            }),
            expect.objectContaining({
              kind: 'input_hook',
              hookId: 'default',
            }),
          ]),
        }),
      },
    });
  });

  it('adds request metadata to session message runtime events', async () => {
    const service = createServiceWithModelStepStream([
      {
        eventId: 'event-assistant-delta',
        schemaVersion: 1,
        eventType: 'assistant.output.delta',
        sessionId: 'session-1',
        runId: 'run-1',
        stepId: 'step-1',
        sequence: 1,
        createdAt: '2026-05-17T00:00:01.000Z',
        source: 'provider',
        visibility: 'user',
        persist: 'transient',
        payload: { delta: 'Hello' },
      },
      {
        eventId: 'event-assistant-completed',
        schemaVersion: 1,
        eventType: 'assistant.output.completed',
        sessionId: 'session-1',
        runId: 'run-1',
        stepId: 'step-1',
        sequence: 2,
        createdAt: '2026-05-17T00:00:02.000Z',
        source: 'provider',
        visibility: 'user',
        persist: 'required',
        payload: { content: 'Hello' },
      },
    ]);
    service.createSession({
      title: 'Session',
      createdAt: '2026-05-17T00:00:00.000Z',
    });

    const result = await service.sendSessionMessage({
      requestId: 'ipc-session-message-send-1',
      payload: {
        sessionId: 'session-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: 'Hello',
          createdAt: '2026-05-17T00:00:00.000Z',
        }],
        createdAt: '2026-05-17T00:00:00.000Z',
      },
      runtimeContext: {
        requestId: 'ipc-session-message-send-1',
        traceId: 'trace-ipc-session-message-send-1',
        debugId: 'debug-ipc-session-message-send-1',
        operationName: 'session.message.send',
        source: 'renderer',
        createdAt: '2026-05-17T00:00:00.000Z',
      },
    });
    const streamed = [];
    for await (const event of result.events) {
      streamed.push(event);
    }

    expect(streamed).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventType: 'run.completed',
        requestId: 'ipc-session-message-send-1',
        context: expect.objectContaining({
          operationName: 'session.message.send',
        }),
      }),
    ]));
    expect(streamed.every((event) => event.requestId === 'ipc-session-message-send-1')).toBe(true);
  });

  it('does not mark a session message run completed after provider failure', async () => {
    const service = createServiceWithModelStepStream([
      {
        eventId: 'event-run-failed',
        schemaVersion: 1,
        eventType: 'run.failed',
        sessionId: 'session-1',
        runId: 'run-1',
        stepId: 'step-1',
        sequence: 1,
        createdAt: '2026-05-17T00:00:01.000Z',
        source: 'provider',
        visibility: 'user',
        persist: 'required',
        payload: {
          error: {
            code: 'provider_auth_failed',
            message: 'Provider failed.',
            severity: 'error',
            retryable: false,
            source: 'provider',
          },
        },
      },
    ]);
    service.createSession({
      title: 'Session',
      createdAt: '2026-05-17T00:00:00.000Z',
    });

    const result = await service.sendSessionMessage({
      requestId: 'ipc-session-message-send-1',
      payload: {
        sessionId: 'session-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        messages: [{
          id: 'message-local-user',
          role: 'user',
          content: 'Hello',
          createdAt: '2026-05-17T00:00:00.000Z',
        }],
        createdAt: '2026-05-17T00:00:00.000Z',
      },
    });
    const streamed = [];
    for await (const event of result.events) {
      streamed.push(event);
    }

    expect(streamed.map((event) => event.eventType)).toEqual([
      'run.started',
      'run.failed',
      'step.status.changed',
      'step.failed',
      'run.status.changed',
    ]);
    expect(streamed.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5]);
    expect(service.listRuntimeEventsByRun('run-1').map((event) => event.eventType)).toEqual([
      'run.started',
      'run.failed',
      'step.status.changed',
      'step.failed',
      'run.status.changed',
    ]);
  });
});
