// Orchestrates Desktop Main session runs by bridging IPC payloads, persistence,
// permission snapshots, context construction, and model-step execution.
import path from 'node:path';
import {
  assertRunStatusTransition,
  canCancelRunStatus,
  canResumeApprovalFromRunStatus,
  createTerminalRuntimeError,
  isTerminalRunStatus,
  runTurn,
} from '@megumi/core/agent-runtime';
import type { RunHostBoundaryPort, RunIdFactory } from '@megumi/core/agent-runtime';
import type { AiModelStepCompletionResult } from '@megumi/ai/types';
import {
  runModelToolLoop,
  type PendingToolApprovalContinuation,
  type ToolApprovalResumeInput,
  type ToolApprovalResumeOutcome,
  type ToolApprovalResumePort,
  type ToolCallHandlerPort,
} from '@megumi/core/agent-runtime';
import type { ModelInputMemoryRecallSource } from '@megumi/context-management/model-step-input-context';
import {
  createRunCompletedEvent,
  createRunFailedEvent,
  createRunStartedEvent,
  createRunStatusChangedEvent,
  createStepCompletedEvent,
  createStepFailedEvent,
  createStepStatusChangedEvent,
} from '@megumi/core/agent-runtime';
import { createDatabase } from '@megumi/db/connection';
import { SessionRunRepository } from '@megumi/db/repos/session-run.repo';
import { SessionActivePathRepository } from '@megumi/db/repos/session-active-path.repo';
import { PermissionSnapshotRepository } from '@megumi/db/repos/permission-snapshot.repo';
import { ToolRepository } from '@megumi/db/repos/tool.repo';
import { createInterruptedExecutionObservation } from '@megumi/tools/observation-shaper';
import { migrateDatabase } from '@megumi/db/schema/migrations';
import type { ContextBudgetPolicy } from '@megumi/shared/context';
import type {
  RunContext,
  ModelCapabilitySummary,
} from '@megumi/shared/run';
import { isProviderId, type ProviderId } from '@megumi/shared/provider';
import type {
  AgentInstructionSourceSnapshot,
  ModelInputContextBuildRequest,
  ModelInputContextSourceRef,
  SessionInstructionSourceSnapshot,
} from '@megumi/shared/model';
import type { SessionContextInput } from '@megumi/shared/session';
import type { Run, RunStep, Session, SessionMessage } from '@megumi/shared/session';
import type {
  SessionActivePath,
  SessionBranchMarker,
  SessionRetryAttempt,
  SessionSourceEntry,
} from '@megumi/shared/session';
import {
  isPermissionMode,
  type PermissionMode,
  type PermissionModeSnapshot,
  type PermissionModeSelectionSource,
} from '@megumi/shared/permission';
import type { InputPreprocessingResult } from '@megumi/shared/input';
import type { JsonObject } from '@megumi/shared/primitives';
import type {
  RunStartPayload,
  PlanStatusUpdatePayload,
  SessionCreatePayload,
  SessionMessageCancelPayload,
  SessionMessageSendData,
  SessionMessageSendPayload,
  SessionTimelineListData,
  SessionTimelineListPayload,
} from '@megumi/shared/ipc';
import { createChatStreamEvent } from '@megumi/shared/chat-stream';
import type { TimelineMessage } from '@megumi/shared/timeline';
import type { ModelStepRuntimeRequest } from '@megumi/shared/model';
import type {
  ImplementationPlanArtifactRecord,
  PermissionModeState,
  PermissionSnapshotRecord,
} from '@megumi/shared/permission';
import type { RuntimeContext } from '@megumi/shared/runtime';
import type { RuntimeError } from '@megumi/shared/runtime';
import type { RuntimeEvent } from '@megumi/shared/runtime';
import {
  createRuntimeEvent,
  createSessionActiveLeafChangedEvent,
  createSessionBranchDraftCancelledEvent,
  createSessionBranchMarkerCreatedEvent,
  createToolRegistryEntryResolvedEvent,
  createToolRegistryModelVisibleToolsDerivedEvent,
  createToolRegistrySnapshotCreatedEvent,
  createToolRegistrySourcesEnsuredEvent,
  createToolContinuationEmittedEvent,
  createToolResultCreatedEvent,
} from '@megumi/shared/runtime';
import type { ToolDefinition, ToolResult } from '@megumi/shared/tool';
import type { MemoryCaptureSignal } from '@megumi/shared/memory';
import type {
  WorkspaceChangedFile,
  WorkspaceChangeSet,
  WorkspaceChangeSummary,
} from '@megumi/shared/workspace';
import {
  normalizeSessionMessageInputPreprocessing,
  type NormalizedSessionMessageInputPreprocessing,
} from '../runtime/runtime-input.service';
import { PermissionSnapshotService } from '../security/permission-snapshot.service';
import type { MegumiHomePaths } from '../project/megumi-home.service';
import {
  createChatStreamEventAdapter,
  type ChatStreamEventAdapter,
  type ChatStreamEventSink,
} from '../../projections/chat-stream/chat-stream-event-adapter.service';
import {
  AgentInstructionSourceService,
  type LoadInstructionSourcesInput,
} from './agent-instruction-source.service';
import {
  SessionContextInputService,
  type BuildSessionContextInputFromRepositoryInput,
} from './session-context-input.service';
import {
  ModelStepInputBuildService,
  type BuildModelStepInputFailure,
  type BuildModelStepInputInput,
  type BuildModelStepInputResult,
} from './model-step-input-build.service';
import {
  SessionCompactionOrchestrator,
  type CompactIfNeededInput,
  type SessionCompactionOrchestrationResult,
} from './session-compaction-orchestrator.service';
import {
  createWorkspaceChangeFooterProjectorService,
  isWorkspaceChangeFooterProjectorPort,
  type WorkspaceChangeFooterProjectorService,
} from '../../projections/workspace/workspace-change-footer-projector.service';
import {
  ToolRegistrySnapshotService,
  type RunToolRegistrySnapshotBuildInput,
  type RunToolRegistrySnapshotBuildResult,
} from '../tool/tool-registry-snapshot.service';

export interface SessionRunServiceClock {
  now(): string;
}

export interface SessionRunServiceIds extends RunIdFactory {
  compactionId(): string;
  retryAttemptId(): string;
  sessionId(): string;
  sourceEntryId(): string;
  branchMarkerId(): string;
  chatStreamEventId(): string;
  chatStreamId(input: { runId: string }): string;
  chatTextId(): string;
  chatThinkingId(): string;
}

export interface SessionRunContextService {
  createBaselineContext(input: {
    runId: string;
    goal: string;
    workspaceId: string;
    workspacePath: string;
    modelCapabilitySummary: ModelCapabilitySummary;
    contextBudgetPolicy: ContextBudgetPolicy;
  }): RunContext;
}

export interface SessionRunModelStepProvider {
  streamModelStep(request: ModelStepRuntimeRequest): AsyncIterable<RuntimeEvent>;
  completeModelStep(request: ModelStepRuntimeRequest): Promise<AiModelStepCompletionResult>;
  cancelModelStep(requestId: string): boolean;
}

export interface SessionBranchDraftView {
  branchMarkerId: string;
  sessionId: string;
  sourceMessageId: string;
  seedText: string;
  label: string;
  intent: 'branch' | 'rerun';
  createdAt: string;
}

export interface SessionRunToolRuntimeFactory {
  create(input: {
    projectRoot: string;
    permissionMode: PermissionMode;
  }): Promise<ToolCallHandlerPort & ToolApprovalResumePort>;
}

export interface SessionRunToolDefinitionProvider {
  listDefinitions(input: {
    runId: string;
    permissionMode: PermissionMode;
    providerCapabilitySummary?: {
      supportsToolCall?: boolean;
    };
  }): ToolDefinition[];
}

export interface SessionRunProviderCapabilitySummaryProvider {
  getProviderCapabilitySummary(input: {
    providerId: string;
    modelId: string;
  }): { supportsToolCall?: boolean };
}

export interface SessionRunToolRegistrySnapshotService {
  createRunSnapshot(input: RunToolRegistrySnapshotBuildInput): RunToolRegistrySnapshotBuildResult;
}

export interface SessionRunAgentInstructionSourceService {
  loadInstructionSources(input: LoadInstructionSourcesInput): Promise<AgentInstructionSourceSnapshot[]>;
}

export interface SessionRunSessionContextInputService {
  buildSessionContextInput(input: BuildSessionContextInputFromRepositoryInput): SessionContextInput;
}

export interface SessionRunModelStepInputBuildService {
  buildModelStepInput(input: BuildModelStepInputInput): Promise<BuildModelStepInputResult>;
}

export interface SessionRunMemoryRecallInput {
  enabled?: boolean;
  homePath: string;
  sessionId: string;
  runId: string;
  modelStepId?: string | null;
  projectId?: string | null;
  projectRoot?: string | null;
  effectiveCwd?: string | null;
  queryText: string;
  providerId?: string | null;
  modelId?: string | null;
  maxResults?: number;
  maxTokens?: number;
  createdAt?: string;
  toolSummaryMetadata?: JsonObject;
}

export interface SessionRunMemoryRecallService {
  recallForNewUserInput(input: SessionRunMemoryRecallInput): Promise<{
    memoryRecallSources: ModelInputMemoryRecallSource[];
    memoryRecallSeed?: ModelInputContextBuildRequest['memoryRecallSeed'];
  }>;
}

export interface SessionRunMemoryCaptureService {
  evaluateRunCompletedCapture(input: {
    homePath: string;
    runId: string;
    sessionId: string;
    projectId?: string | null;
    providerId?: ProviderId | null;
    modelId?: string | null;
    runStatus: 'completed';
    userText: string;
    assistantText?: string;
    toolActivitySummary?: string;
    signals?: MemoryCaptureSignal[];
    memoryEnabled?: boolean;
    hasProject?: boolean;
  }): Promise<{ status: string; reason?: string; savedMemoryIds?: string[] }>;
}

export interface SessionRunMemorySettingsProvider {
  isMemoryEnabled(): boolean;
}

export interface SessionRunMemoryMarkdownSyncService {
  syncProjectMirrorOnProjectOpened(input: { homePath: string; projectId: string }): Promise<unknown>;
}

export interface SessionRunGlobalInstructionDirectoryProvider {
  listGlobalInstructionDirs(input: { sessionId: string; runId: string; stepId: string }): string[];
}

export interface SessionRunSessionInstructionSourceProvider {
  listSessionInstructionSources(input: {
    sessionId: string;
    runId: string;
    stepId: string;
    builtAt: string;
  }): SessionInstructionSourceSnapshot[];
}

export interface SessionRunEffectiveCwdProvider {
  getRunEffectiveCwd(input: { sessionId: string; runId: string; stepId: string }): string | undefined;
}

export interface SessionRunWorkspaceChangeReadPort {
  listChangedFilesByRun(runId: string): WorkspaceChangedFile[];
  listChangeSetsByRun?(runId: string): WorkspaceChangeSet[];
  getChangeSummary?(changeSetId: string): WorkspaceChangeSummary | undefined;
  listChangedFilesByChangeSet?(changeSetId: string): WorkspaceChangedFile[];
}

interface ApprovalContinuationGroup {
  groupId: string;
  request: ModelStepRuntimeRequest;
  run: Run;
  step: RunStep;
  projectId?: string;
  projectRoot?: string;
  permissionMode?: PermissionMode;
  userMessageId: string;
  pendingByApprovalId: Map<string, PendingToolApprovalContinuation>;
  resolvedResults: ToolResult[];
  toolRuntime: ToolCallHandlerPort & ToolApprovalResumePort;
  memoryRecallSources?: ModelInputMemoryRecallSource[];
  memoryRecallSeed?: ModelInputContextBuildRequest['memoryRecallSeed'];
  chatStreamAdapter?: ChatStreamEventAdapter;
}

interface SessionRunMemoryRecallSnapshot {
  memoryRecallSources?: ModelInputMemoryRecallSource[];
  memoryRecallSeed?: ModelInputContextBuildRequest['memoryRecallSeed'];
}

export interface SessionRunServiceOptions {
  repository: SessionRunRepository;
  contextService?: SessionRunContextService;
  permissionSnapshotService?: Pick<
    PermissionSnapshotService,
    | 'createPermissionSnapshot'
    | 'linkAcceptedSourcePlan'
    | 'createPlanRecordForRun'
    | 'getPlanByRun'
    | 'updatePlanStatus'
  >;
  modelStepProvider?: SessionRunModelStepProvider;
  toolRuntimeFactory?: SessionRunToolRuntimeFactory;
  toolDefinitionProvider?: SessionRunToolDefinitionProvider;
  toolRegistrySnapshotService?: SessionRunToolRegistrySnapshotService;
  providerCapabilitySummaryProvider?: SessionRunProviderCapabilitySummaryProvider;
  toolRepository?: Pick<
    ToolRepository,
    'cancelPendingApprovalRequestsByRun' | 'cancelPendingToolExecutionsByRun' | 'failRunningToolExecutionsByRun' | 'markToolContinuationEmitted'
  >;
  agentInstructionSourceService?: SessionRunAgentInstructionSourceService;
  modelStepInputBuildService?: SessionRunModelStepInputBuildService;
  memoryRecallService?: SessionRunMemoryRecallService;
  memoryCaptureService?: SessionRunMemoryCaptureService;
  memorySettingsProvider?: SessionRunMemorySettingsProvider;
  memoryMarkdownSyncService?: SessionRunMemoryMarkdownSyncService;
  megumiHomePath?: string;
  globalInstructionDirectoryProvider?: SessionRunGlobalInstructionDirectoryProvider;
  sessionInstructionSourceProvider?: SessionRunSessionInstructionSourceProvider;
  runEffectiveCwdProvider?: SessionRunEffectiveCwdProvider;
  sessionContextInputService?: SessionRunSessionContextInputService;
  sessionCompactionOrchestrator?: {
    compactIfNeeded(input: CompactIfNeededInput): Promise<SessionCompactionOrchestrationResult>;
  };
  activePathRepository?: SessionActivePathRepository;
  workspaceChanges?: SessionRunWorkspaceChangeReadPort;
  hostBoundary?: RunHostBoundaryPort;
  chatStreamEventSink?: ChatStreamEventSink;
  timelineMessageRepository?: {
    listCommittedMessagesBySession(input: {
      projectId: string;
      sessionId: string;
    }): SessionTimelineListData;
  };
  clock?: SessionRunServiceClock;
  ids?: Partial<SessionRunServiceIds>;
}

const defaultClock: SessionRunServiceClock = {
  now: () => new Date().toISOString(),
};

const DEFAULT_MODEL_CAPABILITY_SUMMARY: ModelCapabilitySummary = {
  providerId: 'unknown',
  modelId: 'unknown',
  modelContextWindow: 8192,
};

const DEFAULT_CONTEXT_BUDGET_POLICY: ContextBudgetPolicy = {
  modelContextWindow: 8192,
  reservedOutputTokens: 1024,
  keepRecentTokens: 7168,
};

class EmptySessionActivePathRepository {
  getActivePath(sessionId: string): SessionActivePath {
    return {
      sessionId,
      entries: [],
    };
  }
}

function createDefaultIds(): SessionRunServiceIds {
  return {
    sessionId: () => `session:${crypto.randomUUID()}`,
    runId: () => `run:${crypto.randomUUID()}`,
    stepId: () => `step:${crypto.randomUUID()}`,
    actionId: () => `action:${crypto.randomUUID()}`,
    observationId: () => `observation:${crypto.randomUUID()}`,
    checkpointId: () => `checkpoint:${crypto.randomUUID()}`,
    resumeRequestId: () => `resume-request:${crypto.randomUUID()}`,
    cancelRequestId: () => `cancel-request:${crypto.randomUUID()}`,
    retryRequestId: () => `retry-request:${crypto.randomUUID()}`,
    compactionId: () => `compaction:${crypto.randomUUID()}`,
    retryAttemptId: () => `retry-attempt:${crypto.randomUUID()}`,
    sourceEntryId: () => `source-entry:${crypto.randomUUID()}`,
    branchMarkerId: () => `branch-marker:${crypto.randomUUID()}`,
    eventId: () => `event:${crypto.randomUUID()}`,
    messageId: () => `message:${crypto.randomUUID()}`,
    debugId: () => `debug:${crypto.randomUUID()}`,
    chatStreamEventId: () => `chat-stream-event:${crypto.randomUUID()}`,
    chatStreamId: ({ runId }) => `chat-stream:${runId}:${crypto.randomUUID()}`,
    chatTextId: () => `text:${crypto.randomUUID()}`,
    chatThinkingId: () => `thinking:${crypto.randomUUID()}`,
  };
}

export class SessionRunService {
  private readonly repository: SessionRunRepository;
  private readonly activePathRepository?: SessionActivePathRepository;
  private readonly contextService?: SessionRunContextService;
  private readonly permissionSnapshotService?: Pick<
    PermissionSnapshotService,
    | 'createPermissionSnapshot'
    | 'linkAcceptedSourcePlan'
    | 'createPlanRecordForRun'
    | 'getPlanByRun'
    | 'updatePlanStatus'
  >;
  private readonly modelStepProvider?: SessionRunModelStepProvider;
  private readonly toolRuntimeFactory?: SessionRunToolRuntimeFactory;
  private readonly toolDefinitionProvider?: SessionRunToolDefinitionProvider;
  private readonly toolRegistrySnapshotService?: SessionRunToolRegistrySnapshotService;
  private readonly providerCapabilitySummaryProvider?: SessionRunProviderCapabilitySummaryProvider;
  private readonly toolRepository?: Pick<
    ToolRepository,
    'cancelPendingApprovalRequestsByRun' | 'cancelPendingToolExecutionsByRun' | 'failRunningToolExecutionsByRun' | 'markToolContinuationEmitted'
  >;
  private readonly modelStepInputBuildService: SessionRunModelStepInputBuildService;
  private readonly memoryRecallService?: SessionRunMemoryRecallService;
  private readonly memoryCaptureService?: SessionRunMemoryCaptureService;
  private readonly memorySettingsProvider?: SessionRunMemorySettingsProvider;
  private readonly memoryMarkdownSyncService?: SessionRunMemoryMarkdownSyncService;
  private readonly megumiHomePath?: string;
  private readonly globalInstructionDirectoryProvider?: SessionRunGlobalInstructionDirectoryProvider;
  private readonly sessionInstructionSourceProvider?: SessionRunSessionInstructionSourceProvider;
  private readonly runEffectiveCwdProvider?: SessionRunEffectiveCwdProvider;
  private readonly sessionContextInputService: SessionRunSessionContextInputService;
  private readonly sessionCompactionOrchestrator?: {
    compactIfNeeded(input: CompactIfNeededInput): Promise<SessionCompactionOrchestrationResult>;
  };
  private readonly hostBoundary: RunHostBoundaryPort;
  private readonly chatStreamEventSink?: ChatStreamEventSink;
  private readonly workspaceChangeFooterProjector?: WorkspaceChangeFooterProjectorService;
  private readonly timelineMessageRepository?: SessionRunServiceOptions['timelineMessageRepository'];
  private readonly clock: SessionRunServiceClock;
  private readonly ids: SessionRunServiceIds;
  private readonly workspaceChanges?: SessionRunWorkspaceChangeReadPort;
  private readonly pendingApprovals = new Map<string, ApprovalContinuationGroup>();
  private readonly pendingApprovalGroups = new Map<string, ApprovalContinuationGroup>();
  private readonly activeSessionMessageRuns = new Map<string, {
    runId: string;
    sessionId: string;
    stepId: string;
    chatStreamAdapter?: ChatStreamEventAdapter;
  }>();

  constructor(options: SessionRunServiceOptions) {
    this.repository = options.repository;
    this.activePathRepository = options.activePathRepository;
    this.contextService = options.contextService;
    this.permissionSnapshotService = options.permissionSnapshotService;
    this.modelStepProvider = options.modelStepProvider;
    this.toolRuntimeFactory = options.toolRuntimeFactory;
    this.toolDefinitionProvider = options.toolDefinitionProvider;
    this.toolRegistrySnapshotService = options.toolRegistrySnapshotService;
    this.providerCapabilitySummaryProvider = options.providerCapabilitySummaryProvider;
    this.toolRepository = options.toolRepository;
    this.memoryRecallService = options.memoryRecallService;
    this.memoryCaptureService = options.memoryCaptureService;
    this.memorySettingsProvider = options.memorySettingsProvider;
    this.memoryMarkdownSyncService = options.memoryMarkdownSyncService;
    this.megumiHomePath = options.megumiHomePath;
    this.globalInstructionDirectoryProvider = options.globalInstructionDirectoryProvider;
    this.sessionInstructionSourceProvider = options.sessionInstructionSourceProvider;
    this.runEffectiveCwdProvider = options.runEffectiveCwdProvider;
    this.sessionContextInputService = options.sessionContextInputService
      ?? new SessionContextInputService({
        repository: this.repository,
        activePathRepository: this.activePathRepository ?? new EmptySessionActivePathRepository(),
      });
    this.modelStepInputBuildService = options.modelStepInputBuildService
      ?? new ModelStepInputBuildService({
        instructionSourceService: options.agentInstructionSourceService,
        defaultBudgetPolicy: DEFAULT_CONTEXT_BUDGET_POLICY,
      });
    this.chatStreamEventSink = options.chatStreamEventSink;
    this.timelineMessageRepository = options.timelineMessageRepository;
    this.workspaceChangeFooterProjector = isWorkspaceChangeFooterProjectorPort(options.workspaceChanges)
      ? createWorkspaceChangeFooterProjectorService({ workspaceChanges: options.workspaceChanges })
      : undefined;
    this.clock = options.clock ?? defaultClock;
    this.ids = { ...createDefaultIds(), ...options.ids };
    this.workspaceChanges = options.workspaceChanges;
    this.sessionCompactionOrchestrator = options.sessionCompactionOrchestrator
      ?? (options.modelStepProvider
        ? new SessionCompactionOrchestrator({
            repository: this.repository,
            modelStepProvider: options.modelStepProvider,
            clock: this.clock,
            ids: {
              compactionId: this.ids.compactionId,
              eventId: this.ids.eventId,
              sourceEntryId: this.ids.sourceEntryId,
            },
            ...(this.activePathRepository ? { activePathRepository: this.activePathRepository } : {}),
          })
        : undefined);
    this.hostBoundary = options.hostBoundary ?? defaultHostBoundary(this.clock, this.ids);
  }

  private modelInputRuntimeSourceOverrides(input: {
    sessionId: string;
    runId: string;
    stepId: string;
    builtAt: string;
  }): Partial<Pick<
    BuildModelStepInputInput,
    'globalInstructionDirs' | 'sessionInstructionSources' | 'requestedCwd'
  >> {
    const globalInstructionDirs = this.globalInstructionDirectoryProvider?.listGlobalInstructionDirs(input) ?? [];
    const sessionInstructionSources = this.sessionInstructionSourceProvider?.listSessionInstructionSources(input) ?? [];
    const requestedCwd = this.runEffectiveCwdProvider?.getRunEffectiveCwd(input);
    return {
      ...(globalInstructionDirs.length > 0 ? { globalInstructionDirs } : {}),
      ...(sessionInstructionSources.length > 0 ? { sessionInstructionSources } : {}),
      ...(requestedCwd ? { requestedCwd } : {}),
    };
  }

  private async recallMemoryForNewUserInput(input: {
    projectId?: string;
    projectRoot?: string;
    effectiveCwd?: string;
    sessionId: string;
    runId: string;
    modelStepId: string;
    queryText: string;
    providerId?: string;
    modelId?: string;
    enabled?: boolean;
    createdAt: string;
  }): Promise<SessionRunMemoryRecallSnapshot> {
    if (!this.memoryRecallService || !this.megumiHomePath) {
      return {};
    }

    try {
      const result = await this.memoryRecallService.recallForNewUserInput({
        homePath: this.megumiHomePath,
        ...(input.projectId ? { projectId: input.projectId } : {}),
        ...(input.projectRoot ? { projectRoot: input.projectRoot } : {}),
        ...(input.effectiveCwd ? { effectiveCwd: input.effectiveCwd } : {}),
        sessionId: input.sessionId,
        runId: input.runId,
        modelStepId: input.modelStepId,
        queryText: input.queryText,
        ...(input.providerId ? { providerId: input.providerId } : {}),
        ...(input.modelId ? { modelId: input.modelId } : {}),
        ...(typeof input.enabled === 'boolean' ? { enabled: input.enabled } : {}),
        createdAt: input.createdAt,
      });

      return {
        ...(result.memoryRecallSources.length > 0 ? { memoryRecallSources: result.memoryRecallSources } : {}),
        ...(result.memoryRecallSeed ? { memoryRecallSeed: result.memoryRecallSeed } : {}),
      };
    } catch {
      return {};
    }
  }

  private resolveMemoryEnabled(): boolean {
    if (!this.memorySettingsProvider) {
      return false;
    }
    try {
      return this.memorySettingsProvider.isMemoryEnabled();
    } catch {
      return false;
    }
  }

  private scheduleProjectMemoryMirrorSync(session: Session): void {
    if (!this.megumiHomePath || !this.memoryMarkdownSyncService || !session.workspaceId) {
      return;
    }
    if (!this.resolveMemoryEnabled()) {
      return;
    }

    void this.memoryMarkdownSyncService.syncProjectMirrorOnProjectOpened({
      homePath: this.megumiHomePath,
      projectId: String(session.workspaceId),
    }).catch(() => {
      // Memory Markdown sync is best-effort and must not block session creation.
    });
  }

  createSession(payload: SessionCreatePayload): Session {
    const session = this.repository.saveSession({
      sessionId: this.ids.sessionId(),
      title: payload.title,
      ...(payload.workspaceId ? { workspaceId: payload.workspaceId } : {}),
      ...(payload.workspacePath ? { workspacePath: payload.workspacePath } : {}),
      status: 'active',
      createdAt: payload.createdAt,
      updatedAt: payload.createdAt,
    });
    this.scheduleProjectMemoryMirrorSync(session);
    return session;
  }

  listSessions(): Session[] {
    return this.repository.listSessions();
  }

  listMessagesBySession(sessionId: string): SessionMessage[] {
    return this.repository.listMessagesBySession(sessionId);
  }

  listTimelineMessagesBySession(input: SessionTimelineListPayload): SessionTimelineListData {
    if (!this.timelineMessageRepository) {
      return { messages: [], diagnostics: [] };
    }

    const result = this.timelineMessageRepository.listCommittedMessagesBySession(input);
    return {
      ...result,
      messages: result.messages.filter((message) => this.shouldHydrateTimelineMessage(message)),
    };
  }

  listRunsBySession(sessionId: string): Run[] {
    return this.repository.listRunsBySession(sessionId);
  }

  async startRun(payload: RunStartPayload): Promise<{ run: Run; events: RuntimeEvent[] }> {
    const session = this.repository.getSession(payload.sessionId);
    const runId = this.ids.runId();
    const permissionModeState = getRunStartPermissionModeState(payload);
    const permissionSnapshot = this.permissionSnapshotService?.createPermissionSnapshot({
      runId,
      permissionMode: payload.mode,
      permissionModeState,
      createdAt: payload.createdAt,
    });

    if (payload.sourcePlanId && this.permissionSnapshotService) {
      this.permissionSnapshotService.linkAcceptedSourcePlan({
        runId,
        sourcePlanId: payload.sourcePlanId,
        linkedAt: payload.createdAt,
      });
    }

    const initialContext = this.createInitialContextForRun({
      runId,
      payload,
      session,
    });

    const result = await runTurn({
      sessionId: payload.sessionId,
      ...(payload.triggerMessageId ? { triggerMessageId: payload.triggerMessageId } : {}),
      permissionMode: payload.mode,
      ...(permissionSnapshot ? {
        permissionModeState: permissionSnapshot.permissionModeState,
        permissionSnapshotRef: permissionSnapshot.permissionSnapshotId,
      } : permissionModeState ? { permissionModeState } : {}),
      ...(payload.sourcePlanId ? { sourcePlanId: payload.sourcePlanId } : {}),
      goal: payload.goal,
      clock: this.clock,
      ids: {
        ...this.ids,
        runId: () => runId,
      },
      ...(initialContext ? { initialContext } : {}),
      lifecycle: {
        saveRun: (run) => {
          this.repository.saveRun(run);
        },
        saveStep: (step) => {
          this.repository.saveStep(step);
        },
        saveAction: (action) => {
          this.repository.saveAction(action);
        },
        saveObservation: (observation) => {
          this.repository.saveObservation(observation);
        },
        appendEvent: (event) => {
          this.repository.appendRuntimeEvent(event);
        },
      },
      hostBoundary: this.hostBoundary,
    });

    if (permissionSnapshot && this.permissionSnapshotService && result.run.status === 'completed') {
      this.permissionSnapshotService.createPlanRecordForRun({
        runId,
        goal: payload.goal,
        permissionModeState: permissionSnapshot.permissionModeState,
        createdAt: result.run.completedAt ?? payload.createdAt,
      });
    }

    return { run: result.run, events: result.events };
  }

  getPlanByRun(runId: string): ImplementationPlanArtifactRecord | undefined {
    return this.requirePermissionSnapshotService().getPlanByRun(runId);
  }

  updatePlanStatus(input: PlanStatusUpdatePayload): ImplementationPlanArtifactRecord {
    return this.requirePermissionSnapshotService().updatePlanStatus(input);
  }

  async sendSessionMessage(input: {
    requestId: string;
    payload: SessionMessageSendPayload;
    runtimeContext?: RuntimeContext;
  }): Promise<{ data: SessionMessageSendData; events: AsyncIterable<RuntimeEvent> }> {
    let branchDraftMarker: SessionBranchMarker | undefined;
    if (input.payload.branchDraft) {
      if (!input.payload.sessionId) {
        throw new Error('Branch draft requires an existing session.');
      }
      branchDraftMarker = this.assertActiveBranchDraftMarker({
        sessionId: input.payload.sessionId,
        branchMarkerId: input.payload.branchDraft.branchMarkerId,
      });
    }

    const session = this.resolveSessionForMessage(input.payload);
    const runId = this.ids.runId();
    const stepId = this.ids.stepId();
    const createdAt = input.payload.createdAt;
    const currentUserMessage = currentUserChatMessage(input.payload);
    // Renderer preprocessing is treated as transport metadata here; this
    // runtime normalization is the trust boundary before persistence and model input.
    const normalizedInput: NormalizedSessionMessageInputPreprocessing = normalizeSessionMessageInputPreprocessing({
      rawText: currentUserMessage?.content ?? '',
      requestedPermissionMode: input.payload.context?.permissionMode,
      requestedPermissionSource: input.payload.context?.permissionSource,
      preprocessing: input.payload.context?.preprocessing,
      createdAt,
    });
    const permissionMode = normalizedInput.permissionMode;
    const permissionSource = normalizedInput.permissionSource;
    const mode = permissionMode;
    const inputMetadata = normalizedInput.metadata;
    if (!currentUserMessage) {
      throw new Error('Session message send requires a user message.');
    }

    const userMessage = this.repository.saveMessage({
      messageId: this.ids.messageId(),
      sessionId: session.sessionId,
      runId,
      role: 'user',
      content: currentUserMessage.content,
      status: 'completed',
      createdAt: currentUserMessage.createdAt,
      completedAt: currentUserMessage.createdAt,
    });
    this.appendSourceAndMoveLeaf({
      sessionId: String(session.sessionId),
      sourceRef: sessionMessageSourceRef(String(userMessage.messageId), currentUserMessage.createdAt),
      createdAt: currentUserMessage.createdAt,
    });
    const initialRun = this.repository.saveRun({
      runId,
      sessionId: session.sessionId,
      triggerMessageId: userMessage.messageId,
      mode,
      goal: userMessage.content,
      status: 'running',
      createdAt,
      startedAt: createdAt,
    });
    const permissionSnapshot = this.permissionSnapshotService?.createPermissionSnapshot({
      runId,
      permissionMode: mode,
      permissionModeState: createPermissionModeState(permissionMode, permissionSource),
      ...(inputMetadata ? { metadata: inputMetadata } : {}),
      createdAt,
    });
    const run = permissionSnapshot
      ? this.repository.saveRun({
          ...initialRun,
          permissionSnapshotRef: permissionSnapshot.permissionSnapshotId,
        })
      : initialRun;
    this.appendSourceAndMoveLeaf({
      sessionId: String(session.sessionId),
      sourceRef: sessionRunSourceRef(String(run.runId), createdAt),
      createdAt,
    });
    let manualRerunAuditEvent: RuntimeEvent | undefined;
    if (input.payload.branchDraft?.intent === 'rerun') {
      if (!branchDraftMarker) {
        throw new Error('Branch draft marker was not found.');
      }
      manualRerunAuditEvent = this.recordManualRerunAttemptForBranchDraft({
        requestId: input.requestId,
        sessionId: String(session.sessionId),
        runId: String(run.runId),
        branchMarkerId: input.payload.branchDraft.branchMarkerId,
        marker: branchDraftMarker,
        createdAt,
        runtimeContext: input.runtimeContext,
      });
    }
    const step = this.repository.saveStep({
      stepId,
      runId,
      kind: 'model',
      status: 'running',
      title: 'Model response',
      startedAt: createdAt,
    });
    const chatStreamAdapter = this.chatStreamEventSink
      ? createChatStreamEventAdapter({
          sink: this.chatStreamEventSink,
          projectId: String(session.workspaceId ?? session.sessionId),
          sessionId: String(session.sessionId),
          runId: String(runId),
          streamId: this.ids.chatStreamId({ runId: String(runId) }),
          streamKind: 'main',
          userMessageId: String(userMessage.messageId),
          clientMessageId: String(currentUserMessage.id),
          userMessageText: userMessage.content,
          createdAt,
          now: () => this.clock.now(),
          ids: {
            eventId: this.ids.chatStreamEventId,
            textId: this.ids.chatTextId,
            thinkingId: this.ids.chatThinkingId,
          },
        })
      : undefined;
    chatStreamAdapter?.startTurn();
    if (manualRerunAuditEvent) {
      this.appendRuntimeEvent(manualRerunAuditEvent, chatStreamAdapter);
    }
    this.activeSessionMessageRuns.set(input.requestId, {
      runId,
      sessionId: session.sessionId,
      stepId,
      ...(chatStreamAdapter ? { chatStreamAdapter } : {}),
    });

    return {
      data: { requestId: input.requestId },
      events: this.trackActiveSessionMessageRun(input.requestId, this.runInitialSessionMessageModelStep({
        requestId: input.requestId,
        payload: input.payload,
        runtimeContext: input.runtimeContext,
        session,
        run,
        step,
        userMessage,
        currentUserMessage,
        permissionMode,
        inputPreprocessing: normalizedInput.inputPreprocessing,
        ...(permissionSnapshot ? { permissionSnapshot } : {}),
        ...(chatStreamAdapter ? { chatStreamAdapter } : {}),
      })),
    };
  }

  createBranchFromUserMessage(input: {
    requestId: string;
    sessionId: string;
    messageId: string;
    createdAt: string;
    runtimeContext?: RuntimeContext;
  }): {
    branchMarker: SessionBranchMarker;
    branchMarkerSourceEntry: SessionSourceEntry;
    seedMessage: SessionMessage;
    events: RuntimeEvent[];
  } {
    const activePathRepository = this.requireActivePathRepository();
    const seedMessage = this.repository.getMessage(input.messageId);
    if (
      !seedMessage
      || String(seedMessage.sessionId) !== input.sessionId
      || seedMessage.role !== 'user'
      || seedMessage.status !== 'completed'
    ) {
      throw new Error('Branch can only start from a completed user message.');
    }

    const selectedEntry = activePathRepository.findActivePathEntryBySourceRef(input.sessionId, {
      sourceKind: 'session_message',
      sourceId: input.messageId,
    });
    if (!selectedEntry) {
      throw new Error('Branch source entry was not found in the active path.');
    }

    const previousLeafSourceEntryId = activePathRepository.getActiveLeaf(input.sessionId)?.leafSourceEntryId ?? undefined;
    const targetLeafSourceEntryId = selectedEntry.parentSourceEntryId;
    const branchMarkerId = this.ids.branchMarkerId();
    const branchMarker: SessionBranchMarker = activePathRepository.recordBranchMarker({
      branchMarkerId,
      sessionId: input.sessionId,
      ...(previousLeafSourceEntryId ? { previousLeafSourceEntryId } : {}),
      ...(targetLeafSourceEntryId ? { targetLeafSourceEntryId } : {}),
      selectedSourceRef: selectedEntry.sourceRef,
      seedSourceRef: selectedEntry.sourceRef,
      reason: 'branch_from_user_message',
      createdAt: input.createdAt,
    });
    const markerSourceRef = branchMarkerSourceRef(branchMarker.branchMarkerId, input.createdAt);
    const branchMarkerSourceEntryId = this.ids.sourceEntryId();
    const branchMarkerSourceEntry = activePathRepository.appendSourceEntryAndSetActiveLeaf({
      sourceEntryId: branchMarkerSourceEntryId,
      sessionId: input.sessionId,
      ...(targetLeafSourceEntryId ? { parentSourceEntryId: targetLeafSourceEntryId } : {}),
      sourceRef: markerSourceRef,
      createdAt: input.createdAt,
      metadata: {
        requestId: input.requestId,
        selectedSourceEntryId: selectedEntry.sourceEntryId,
      },
    }, {
      sessionId: input.sessionId,
      leafSourceEntryId: branchMarkerSourceEntryId,
      updatedAt: input.createdAt,
      reason: 'branch_marker',
    });

    const events = [
      createSessionBranchMarkerCreatedEvent({
        eventId: this.ids.eventId(),
        sessionId: input.sessionId,
        requestId: input.requestId,
        ...(input.runtimeContext ? { context: input.runtimeContext } : {}),
        sequence: 1,
        createdAt: input.createdAt,
        payload: {
          branchMarkerId: branchMarker.branchMarkerId,
          branchMarkerSourceEntryId: branchMarkerSourceEntry.sourceEntryId,
          ...(previousLeafSourceEntryId ? { previousLeafSourceEntryId } : {}),
          ...(targetLeafSourceEntryId ? { targetLeafSourceEntryId } : {}),
          selectedSourceRef: selectedEntry.sourceRef,
          seedSourceRef: selectedEntry.sourceRef,
          reason: 'branch_from_user_message',
        },
      }),
      createSessionActiveLeafChangedEvent({
        eventId: this.ids.eventId(),
        sessionId: input.sessionId,
        requestId: input.requestId,
        ...(input.runtimeContext ? { context: input.runtimeContext } : {}),
        sequence: 2,
        createdAt: input.createdAt,
        payload: {
          ...(previousLeafSourceEntryId ? { previousLeafSourceEntryId } : {}),
          leafSourceEntryId: branchMarkerSourceEntry.sourceEntryId,
          reason: 'branch_marker',
          sourceRef: markerSourceRef,
        },
      }),
    ];
    for (const event of events) {
      this.repository.appendRuntimeEvent(event);
    }

    return {
      branchMarker,
      branchMarkerSourceEntry,
      seedMessage,
      events,
    };
  }

  createBranchDraft(input: {
    requestId: string;
    sessionId: string;
    messageId: string;
    intent: 'branch' | 'rerun';
    createdAt: string;
    runtimeContext?: RuntimeContext;
  }): {
    branchDraft: SessionBranchDraftView;
    events: RuntimeEvent[];
  } {
    const result = this.createBranchFromUserMessage(input);
    const branchDraft: SessionBranchDraftView = {
      branchMarkerId: result.branchMarker.branchMarkerId,
      sessionId: input.sessionId,
      sourceMessageId: input.messageId,
      seedText: result.seedMessage.content,
      label: formatBranchDraftTime(result.seedMessage.createdAt),
      intent: input.intent,
      createdAt: input.createdAt,
    };
    this.publishBranchSeparatorForDraft({
      branchDraft,
      seedRunId: String(result.seedMessage.runId ?? result.branchMarker.branchMarkerId),
    });
    return {
      branchDraft,
      events: result.events,
    };
  }

  createManualRetryFromRun(input: {
    requestId: string;
    runId: string;
    createdAt: string;
    runtimeContext?: RuntimeContext;
  }): {
    retryAttempt: SessionRetryAttempt;
    retryAttemptSourceEntry: SessionSourceEntry;
    events: RuntimeEvent[];
  } {
    const activePathRepository = this.requireActivePathRepository();
    const run = this.repository.getRun(input.runId);
    if (!run || !['failed', 'cancelled', 'cancelling', 'running', 'queued'].includes(run.status)) {
      throw new Error('Manual retry requires a failed, cancelled, interrupted, or running-like run.');
    }

    const runSourceEntry = activePathRepository.getSourceEntryBySourceRef(run.sessionId, {
      sourceKind: 'session_run',
      sourceId: String(run.runId),
    });
    const retryAttemptId = this.ids.retryAttemptId();
    const retryAttempt = activePathRepository.saveRetryAttempt({
      retryAttemptId,
      sessionId: run.sessionId,
      runId: String(run.runId),
      baseRunId: String(run.runId),
      ...(runSourceEntry ? { baseSourceEntryId: runSourceEntry.sourceEntryId } : {}),
      attemptNumber: activePathRepository.listRetryAttemptsByRun(String(run.runId)).length + 1,
      retryKind: 'manual_retry',
      reason: manualRetryReasonForRunStatus(run.status),
      status: 'pending',
      retryable: true,
      createdAt: input.createdAt,
      metadata: {
        requestId: input.requestId,
        previousStatus: run.status,
        ...(run.error?.message ? { previousErrorMessage: run.error.message } : {}),
      },
    });
    const retryAttemptSourceEntry = this.appendSourceAndMoveLeaf({
      sessionId: run.sessionId,
      sourceRef: retryAttemptSourceRef(retryAttempt.retryAttemptId, input.createdAt),
      createdAt: input.createdAt,
      metadata: {
        requestId: input.requestId,
        baseRunId: String(run.runId),
      },
    });
    if (!retryAttemptSourceEntry) {
      throw new Error('Manual retry requires active path repository.');
    }

    const events = [
      createRuntimeEvent({
        eventId: this.ids.eventId(),
        eventType: 'run.retry.requested',
        runId: String(run.runId),
        sessionId: run.sessionId,
        requestId: input.requestId,
        ...(input.runtimeContext ? { context: input.runtimeContext } : {}),
        sequence: 1,
        createdAt: input.createdAt,
        source: 'main',
        visibility: 'system',
        persist: 'required',
        payload: {
          retryRequestId: retryAttempt.retryAttemptId,
          requestedBy: 'user',
          retryKind: 'manual_retry',
          reason: retryAttempt.reason,
        },
      }),
      createRuntimeEvent({
        eventId: this.ids.eventId(),
        eventType: 'retry.started',
        runId: String(run.runId),
        sessionId: run.sessionId,
        requestId: input.requestId,
        ...(input.runtimeContext ? { context: input.runtimeContext } : {}),
        sequence: 2,
        createdAt: input.createdAt,
        source: 'main',
        visibility: 'system',
        persist: 'required',
        payload: {
          retryRequestId: retryAttempt.retryAttemptId,
          retryKind: 'manual_retry',
        },
      }),
    ];
    for (const event of events) {
      this.repository.appendRuntimeEvent(event);
    }

    return { retryAttempt, retryAttemptSourceEntry, events };
  }

  createManualRerunFromUserMessage(input: {
    requestId: string;
    sessionId: string;
    messageId: string;
    createdAt: string;
    runtimeContext?: RuntimeContext;
  }): {
    branchMarker: SessionBranchMarker;
    branchMarkerSourceEntry: SessionSourceEntry;
    seedMessage: SessionMessage;
    retryAttempt: SessionRetryAttempt;
    retryAttemptSourceEntry: SessionSourceEntry;
    events: RuntimeEvent[];
  } {
    const branch = this.createBranchFromUserMessage(input);
    const retryAttemptId = this.ids.retryAttemptId();
    const retryAttempt = this.requireActivePathRepository().saveRetryAttempt({
      retryAttemptId,
      sessionId: input.sessionId,
      runId: String(branch.seedMessage.runId),
      baseSourceEntryId: branch.branchMarkerSourceEntry.sourceEntryId,
      attemptNumber: 1,
      retryKind: 'manual_rerun',
      reason: 'user_requested',
      status: 'pending',
      retryable: true,
      createdAt: input.createdAt,
      metadata: {
        requestId: input.requestId,
        seedMessageId: input.messageId,
        branchMarkerId: branch.branchMarker.branchMarkerId,
      },
    });
    const retryAttemptSourceEntry = this.appendSourceAndMoveLeaf({
      sessionId: input.sessionId,
      sourceRef: retryAttemptSourceRef(retryAttempt.retryAttemptId, input.createdAt),
      createdAt: input.createdAt,
      metadata: {
        requestId: input.requestId,
        branchMarkerId: branch.branchMarker.branchMarkerId,
      },
    });
    if (!retryAttemptSourceEntry) {
      throw new Error('Manual rerun requires active path repository.');
    }

    return {
      ...branch,
      retryAttempt,
      retryAttemptSourceEntry,
      events: branch.events,
    };
  }

  cancelBranchDraft(input: {
    requestId: string;
    sessionId: string;
    branchMarkerId: string;
    createdAt: string;
    runtimeContext?: RuntimeContext;
  }): {
    cancelled: boolean;
    reason?: 'branch_has_new_sources' | 'branch_marker_not_active' | 'branch_marker_not_found';
    events: RuntimeEvent[];
  } {
    const activePathRepository = this.requireActivePathRepository();
    const marker = activePathRepository.getBranchMarker(input.branchMarkerId);
    if (!marker || marker.sessionId !== input.sessionId) {
      return { cancelled: false, reason: 'branch_marker_not_found', events: [] };
    }

    const markerSourceEntry = activePathRepository.getSourceEntryBySourceRef(input.sessionId, {
      sourceKind: 'branch_marker',
      sourceId: input.branchMarkerId,
    });
    if (!markerSourceEntry) {
      return { cancelled: false, reason: 'branch_marker_not_found', events: [] };
    }

    if (activePathRepository.listChildSourceEntries(markerSourceEntry.sourceEntryId).length > 0) {
      return { cancelled: false, reason: 'branch_has_new_sources', events: [] };
    }

    const activeLeaf = activePathRepository.getActiveLeaf(input.sessionId);
    if (activeLeaf?.leafSourceEntryId !== markerSourceEntry.sourceEntryId) {
      return { cancelled: false, reason: 'branch_marker_not_active', events: [] };
    }

    activePathRepository.setActiveLeaf({
      sessionId: input.sessionId,
      leafSourceEntryId: marker.previousLeafSourceEntryId,
      updatedAt: input.createdAt,
      reason: 'branch_cancelled',
    });
    const markerSourceRef = branchMarkerSourceRef(marker.branchMarkerId, input.createdAt);
    const events = [
      createSessionBranchDraftCancelledEvent({
        eventId: this.ids.eventId(),
        sessionId: input.sessionId,
        requestId: input.requestId,
        ...(input.runtimeContext ? { context: input.runtimeContext } : {}),
        sequence: 1,
        createdAt: input.createdAt,
        payload: {
          branchMarkerId: marker.branchMarkerId,
          branchMarkerSourceEntryId: markerSourceEntry.sourceEntryId,
          ...(marker.previousLeafSourceEntryId ? { restoredLeafSourceEntryId: marker.previousLeafSourceEntryId } : {}),
          reason: 'branch_cancelled',
        },
      }),
      createSessionActiveLeafChangedEvent({
        eventId: this.ids.eventId(),
        sessionId: input.sessionId,
        requestId: input.requestId,
        ...(input.runtimeContext ? { context: input.runtimeContext } : {}),
        sequence: 2,
        createdAt: input.createdAt,
        payload: {
          previousLeafSourceEntryId: markerSourceEntry.sourceEntryId,
          ...(marker.previousLeafSourceEntryId ? { leafSourceEntryId: marker.previousLeafSourceEntryId } : {}),
          reason: 'branch_cancelled',
          sourceRef: markerSourceRef,
        },
      }),
    ];
    for (const event of events) {
      this.repository.appendRuntimeEvent(event);
    }
    this.publishBranchSeparatorRemovalForDraft({
      sessionId: input.sessionId,
      branchMarkerId: marker.branchMarkerId,
      seedRunId: this.seedRunIdForBranchMarker(marker),
      createdAt: input.createdAt,
    });

    return { cancelled: true, events };
  }

  cancelSessionMessage(payload: SessionMessageCancelPayload): boolean {
    const providerCancelled = this.modelStepProvider?.cancelModelStep(payload.targetRequestId) ?? false;
    const activeRun = this.activeSessionMessageRuns.get(payload.targetRequestId);

    if (!activeRun) {
      return providerCancelled;
    }

    const persistedRun = this.repository.getRun(activeRun.runId);
    if (!persistedRun || isTerminalRunStatus(persistedRun.status)) {
      this.activeSessionMessageRuns.delete(payload.targetRequestId);
      return providerCancelled;
    }
    if (!canCancelRunStatus(persistedRun.status)) {
      return providerCancelled;
    }

    const cancelledAt = this.clock.now();
    const lastSequence = nextRuntimeSequence(this.repository.listRuntimeEventsByRun(activeRun.runId));
    const runningStep = this.repository.listStepsByRun(activeRun.runId)
      .reverse()
      .find((step) => ['running', 'waiting_for_approval'].includes(step.status));

    if (runningStep) {
      this.repository.saveStep({
        ...runningStep,
        status: 'cancelled',
        completedAt: cancelledAt,
      });
    }

    assertRunStatusTransition(persistedRun.status, 'cancelling');
    const cancellingRun = this.repository.saveRun({
      ...persistedRun,
      status: 'cancelling',
    });
    const cancelRequestId = this.ids.cancelRequestId();
    this.appendRuntimeEvent(createRunStatusChangedEvent({
      eventId: this.ids.eventId(),
      sessionId: activeRun.sessionId,
      runId: activeRun.runId,
      sequence: lastSequence + 1,
      createdAt: cancelledAt,
      from: persistedRun.status,
      to: 'cancelling',
    }), activeRun.chatStreamAdapter);
    this.appendRuntimeEvent(createRuntimeEvent({
      eventId: this.ids.eventId(),
      eventType: 'run.cancelling',
      runId: activeRun.runId,
      sessionId: activeRun.sessionId,
      stepId: runningStep?.stepId ?? activeRun.stepId,
      requestId: payload.targetRequestId,
      sequence: lastSequence + 2,
      createdAt: cancelledAt,
      source: 'core',
      visibility: 'user',
      persist: 'required',
      payload: { cancelRequestId },
    }), activeRun.chatStreamAdapter);
    this.cancelPendingApprovalGroupsByRun(activeRun.runId);
    this.toolRepository?.cancelPendingApprovalRequestsByRun({
      runId: activeRun.runId,
      resolvedAt: cancelledAt,
    });
    this.toolRepository?.cancelPendingToolExecutionsByRun({
      runId: activeRun.runId,
      completedAt: cancelledAt,
    });
    assertRunStatusTransition(cancellingRun.status, 'cancelled');
    this.repository.saveRun({
      ...cancellingRun,
      status: 'cancelled',
      cancelledAt,
    });
    const cancelledEvent = createRuntimeEvent({
      eventId: this.ids.eventId(),
      eventType: 'run.cancelled',
      runId: activeRun.runId,
      sessionId: activeRun.sessionId,
      stepId: runningStep?.stepId ?? activeRun.stepId,
      requestId: payload.targetRequestId,
      sequence: lastSequence + 3,
      createdAt: cancelledAt,
      source: 'core',
      visibility: 'user',
      persist: 'required',
      payload: {
        reason: providerCancelled
          ? 'Provider request was cancelled.'
          : 'Session message run was cancelled by the user.',
      },
    });
    this.appendRuntimeEvent(cancelledEvent, activeRun.chatStreamAdapter);
    this.appendRuntimeEvent(createRunStatusChangedEvent({
      eventId: this.ids.eventId(),
      sessionId: activeRun.sessionId,
      runId: activeRun.runId,
      sequence: lastSequence + 4,
      createdAt: cancelledAt,
      from: 'cancelling',
      to: 'cancelled',
    }), activeRun.chatStreamAdapter);
    this.activeSessionMessageRuns.delete(payload.targetRequestId);
    return true;
  }

  resumeApproval(input: ToolApprovalResumeInput): AsyncIterable<RuntimeEvent> | undefined {
    const continuation = this.pendingApprovals.get(input.approvalRequestId);
    if (!continuation) {
      return undefined;
    }
    const persistedRun = this.repository.getRun(continuation.request.runId) ?? continuation.run;
    if (!canResumeApprovalFromRunStatus(persistedRun.status)) {
      this.cancelPendingApprovalGroupsByRun(continuation.request.runId);
      return undefined;
    }

    return this.resumeApprovalContinuation(continuation, input);
  }

  cleanupInterruptedRunsOnStartup(): { cleanedRunIds: string[] } {
    const cleanupAt = this.clock.now();
    const activeRuns = this.repository.listRunsByStatuses([
      'running',
      'waiting_for_approval',
      'cancelling',
    ]);
    const cleanedRunIds: string[] = [];

    for (const run of activeRuns) {
      const lastSequence = nextRuntimeSequence(this.repository.listRuntimeEventsByRun(String(run.runId)));
      const error = createTerminalRuntimeError({
        reason: 'runtime_restarted_with_active_run',
        code: 'runtime_restarted_with_active_run',
        message: 'Runtime restarted while this run was active; pending continuation is not recoverable in 19.01.',
        source: 'main',
        retryable: false,
        details: {
          previousStatus: run.status,
          startupCleanup: true,
        },
      });
      this.toolRepository?.cancelPendingApprovalRequestsByRun({
        runId: String(run.runId),
        resolvedAt: cleanupAt,
      });
      this.toolRepository?.failRunningToolExecutionsByRun({
        runId: String(run.runId),
        completedAt: cleanupAt,
        createObservation: (record) => createInterruptedExecutionObservation({
          record,
          ids: { observationId: () => `tool-observation:${record.toolExecutionId}:interrupted` },
          now: () => cleanupAt,
        }),
      });
      this.toolRepository?.cancelPendingToolExecutionsByRun({
        runId: String(run.runId),
        completedAt: cleanupAt,
        statuses: ['created', 'awaitingApproval', 'queued'],
      });
      this.repository.saveRun({
        ...run,
        status: 'failed',
        completedAt: cleanupAt,
        error,
      });
      this.repository.appendRuntimeEvent(createRuntimeEvent({
        eventId: this.ids.eventId(),
        eventType: 'run.failed',
        runId: String(run.runId),
        sessionId: String(run.sessionId),
        sequence: lastSequence + 1,
        createdAt: cleanupAt,
        source: 'main',
        visibility: 'user',
        persist: 'required',
        payload: { error },
      }));
      this.repository.appendRuntimeEvent(createRunStatusChangedEvent({
        eventId: this.ids.eventId(),
        sessionId: String(run.sessionId),
        runId: String(run.runId),
        sequence: lastSequence + 2,
        createdAt: cleanupAt,
        from: run.status,
        to: 'failed',
      }));
      cleanedRunIds.push(String(run.runId));
    }

    return { cleanedRunIds };
  }

  private createInitialContextForRun(input: {
    runId: string;
    payload: RunStartPayload;
    session: Session | undefined;
  }): RunContext | undefined {
    if (!this.contextService || !input.session?.workspacePath) {
      return undefined;
    }

    return this.contextService.createBaselineContext({
      runId: input.runId,
      goal: input.payload.goal,
      workspaceId: String(input.session.workspaceId ?? `workspace:${input.session.sessionId}`),
      workspacePath: input.session.workspacePath,
      modelCapabilitySummary: DEFAULT_MODEL_CAPABILITY_SUMMARY,
      contextBudgetPolicy: DEFAULT_CONTEXT_BUDGET_POLICY,
    });
  }

  private createInitialContextForSessionMessage(input: {
    runId: string;
    goal: string;
    session: Session;
  }): RunContext | undefined {
    if (!this.contextService || !input.session.workspacePath) {
      return undefined;
    }

    return this.contextService.createBaselineContext({
      runId: input.runId,
      goal: input.goal,
      workspaceId: String(input.session.workspaceId ?? `workspace:${input.session.sessionId}`),
      workspacePath: input.session.workspacePath,
      modelCapabilitySummary: DEFAULT_MODEL_CAPABILITY_SUMMARY,
      contextBudgetPolicy: DEFAULT_CONTEXT_BUDGET_POLICY,
    });
  }

  listRuntimeEventsByRun(runId: string): RuntimeEvent[] {
    return this.repository.listRuntimeEventsByRun(runId);
  }

  private async *trackActiveSessionMessageRun(
    requestId: string,
    events: AsyncIterable<RuntimeEvent>,
  ): AsyncIterable<RuntimeEvent> {
    try {
      yield* events;
    } finally {
      const activeRun = this.activeSessionMessageRuns.get(requestId);
      const persistedRun = activeRun ? this.repository.getRun(activeRun.runId) : undefined;
      if (persistedRun?.status !== 'waiting_for_approval') {
        this.activeSessionMessageRuns.delete(requestId);
      }
    }
  }

  private resolveSessionForMessage(payload: SessionMessageSendPayload): Session {
    if (payload.sessionId) {
      const existing = this.repository.getSession(payload.sessionId);
      if (existing) {
        return existing;
      }
    }

    const createdAt = payload.createdAt;
    return this.repository.saveSession({
      sessionId: payload.sessionId ?? this.ids.sessionId(),
      title: payload.context?.sessionTitle ?? 'New session',
      ...(payload.context?.workspaceId ? { workspaceId: payload.context.workspaceId } : {}),
      ...(payload.context?.workspacePath ? { workspacePath: payload.context.workspacePath } : {}),
      status: 'active',
      createdAt,
      updatedAt: createdAt,
    });
  }

  private async *runInitialSessionMessageModelStep(input: {
    requestId: string;
    payload: SessionMessageSendPayload;
    runtimeContext?: RuntimeContext;
    session: Session;
    run: Run;
    step: RunStep;
    userMessage: SessionMessage;
    currentUserMessage: SessionMessageSendCurrentMessage;
    permissionMode: PermissionMode;
    inputPreprocessing: InputPreprocessingResult;
    permissionSnapshot?: PermissionSnapshotRecord;
    chatStreamAdapter?: ChatStreamEventAdapter;
  }): AsyncIterable<RuntimeEvent> {
    let lastSequence = 0;
    const runStarted = withSessionMessageRequestMetadata(createRunStartedEvent({
      eventId: this.ids.eventId(),
      sessionId: input.session.sessionId,
      runId: input.run.runId,
      sequence: lastSequence += 1,
      createdAt: input.payload.createdAt,
    }), {
      requestId: input.requestId,
      runtimeContext: input.runtimeContext,
    });
    this.appendRuntimeEvent(runStarted, input.chatStreamAdapter);
    let runStartedYielded = false;

    try {
      const context = this.createInitialContextForSessionMessage({
        runId: String(input.run.runId),
        goal: input.userMessage.content,
        session: input.session,
      });
      const budgetPolicy = context?.contextBudgetPolicy ?? DEFAULT_CONTEXT_BUDGET_POLICY;
      const providerCapabilitySummary = this.providerCapabilitySummaryProvider?.getProviderCapabilitySummary({
        providerId: input.payload.providerId,
        modelId: input.payload.modelId,
      }) ?? { supportsToolCall: true };
      let toolDefinitions: ToolDefinition[] | undefined;
      if (input.session.workspacePath && input.session.workspaceId && this.toolRegistrySnapshotService) {
        const registrySnapshotResult = this.toolRegistrySnapshotService.createRunSnapshot({
          runId: String(input.run.runId),
          projectId: String(input.session.workspaceId),
          permissionMode: input.permissionMode,
          modelId: input.payload.modelId,
          createdAt: input.payload.createdAt,
          providerCapabilitySummary,
        });
        toolDefinitions = registrySnapshotResult.modelVisibleToolDefinitions;
        const registryEvents = [
          createToolRegistrySourcesEnsuredEvent({
            eventId: this.ids.eventId(),
            runId: String(input.run.runId),
            sessionId: String(input.session.sessionId),
            sequence: lastSequence += 1,
            createdAt: input.payload.createdAt,
            payload: {
              sourceIds: registrySnapshotResult.diagnostics.sourceIds,
              createdSourceIds: registrySnapshotResult.diagnostics.createdSourceIds,
            },
          }),
          createToolRegistrySnapshotCreatedEvent({
            eventId: this.ids.eventId(),
            runId: String(input.run.runId),
            sessionId: String(input.session.sessionId),
            sequence: lastSequence += 1,
            createdAt: input.payload.createdAt,
            payload: {
              snapshotId: registrySnapshotResult.snapshot.snapshotId,
              projectId: registrySnapshotResult.snapshot.projectId,
              permissionMode: registrySnapshotResult.snapshot.permissionMode,
              modelId: registrySnapshotResult.snapshot.modelId,
              registryVersion: registrySnapshotResult.snapshot.registryVersion,
              sourceVersionHash: registrySnapshotResult.snapshot.sourceVersionHash,
              sourceCount: registrySnapshotResult.snapshot.sourceEntries.length,
              entryCount: registrySnapshotResult.snapshot.entries.length,
              exposedCount: registrySnapshotResult.snapshot.entries.filter((entry) => entry.exposedToModel).length,
            },
          }),
          ...registrySnapshotResult.snapshot.entries.map((entry) => createToolRegistryEntryResolvedEvent({
            eventId: this.ids.eventId(),
            runId: String(input.run.runId),
            sessionId: String(input.session.sessionId),
            sequence: lastSequence += 1,
            createdAt: input.payload.createdAt,
            payload: {
              snapshotId: entry.snapshotId,
              snapshotEntryId: entry.snapshotEntryId,
              registrationId: entry.registrationId,
              canonicalToolId: entry.canonicalToolId,
              modelVisibleName: entry.modelVisibleName,
              sourceId: entry.sourceId,
              namespace: entry.namespace,
              sourceToolName: entry.sourceToolName,
              effectiveStatus: entry.effectiveStatus,
              exposedToModel: entry.exposedToModel,
              ...(entry.disabledReason ? { disabledReason: entry.disabledReason } : {}),
              ...(entry.unavailableReason ? { unavailableReason: entry.unavailableReason } : {}),
              ...(entry.conflictReason ? { conflictReason: entry.conflictReason } : {}),
            },
          })),
          createToolRegistryModelVisibleToolsDerivedEvent({
            eventId: this.ids.eventId(),
            runId: String(input.run.runId),
            sessionId: String(input.session.sessionId),
            sequence: lastSequence += 1,
            createdAt: input.payload.createdAt,
            payload: {
              snapshotId: registrySnapshotResult.snapshot.snapshotId,
              modelId: registrySnapshotResult.snapshot.modelId,
              modelSupportsToolCall: registrySnapshotResult.diagnostics.modelSupportsToolCall,
              toolNames: registrySnapshotResult.diagnostics.modelVisibleToolNames,
              hiddenCount: registrySnapshotResult.diagnostics.hiddenCount,
            },
          }),
        ].map((event) => withSessionMessageRequestMetadata(event, {
          requestId: input.requestId,
          runtimeContext: input.runtimeContext,
        }));

        for (const event of registryEvents) {
          this.appendRuntimeEvent(event, input.chatStreamAdapter);
        }
      } else if (input.session.workspacePath && this.toolDefinitionProvider) {
        toolDefinitions = this.toolDefinitionProvider.listDefinitions({
            runId: String(input.run.runId),
            permissionMode: input.permissionMode,
            providerCapabilitySummary,
          });
      }
      const sessionContext = this.sessionContextInputService.buildSessionContextInput({
        sessionId: String(input.session.sessionId),
        currentRunId: String(input.run.runId),
        currentMessageId: String(input.userMessage.messageId),
        builtAt: input.payload.createdAt,
      });
      const modelInputSourceOverrides = this.modelInputRuntimeSourceOverrides({
        sessionId: String(input.session.sessionId),
        runId: String(input.run.runId),
        stepId: String(input.step.stepId),
        builtAt: input.payload.createdAt,
      });
      const memoryRecallEffectiveCwd = resolveRecallEffectiveCwd(
        input.session.workspacePath,
        modelInputSourceOverrides.requestedCwd,
      );
      const memoryEnabled = this.resolveMemoryEnabled();
      const memoryRecall = await this.recallMemoryForNewUserInput({
        ...(input.session.workspaceId ? { projectId: String(input.session.workspaceId) } : {}),
        ...(input.session.workspacePath ? { projectRoot: input.session.workspacePath } : {}),
        ...(memoryRecallEffectiveCwd ? { effectiveCwd: memoryRecallEffectiveCwd } : {}),
        sessionId: String(input.session.sessionId),
        runId: String(input.run.runId),
        modelStepId: String(input.step.stepId),
        queryText: input.inputPreprocessing.effectiveUserText,
        providerId: input.payload.providerId,
        modelId: input.payload.modelId,
        enabled: memoryEnabled,
        createdAt: input.payload.createdAt,
      });
      const compactionProbeModelInput = await this.modelStepInputBuildService.buildModelStepInput({
        requestId: input.requestId,
        sessionId: String(input.session.sessionId),
        runId: String(input.run.runId),
        stepId: String(input.step.stepId),
        contextKind: 'compaction-probe',
        providerId: input.payload.providerId,
        modelId: input.payload.modelId,
        modelContextWindow: budgetPolicy.modelContextWindow,
        ...(input.session.workspaceId ? { projectId: String(input.session.workspaceId) } : {}),
        ...(input.session.workspacePath ? { projectRoot: input.session.workspacePath } : {}),
        ...modelInputSourceOverrides,
        permissionMode: input.permissionMode,
        ...(input.permissionSnapshot ? {
          permissionSnapshot: toModelVisiblePermissionSnapshot(input.permissionSnapshot, input.payload.createdAt),
          permissionSnapshotRef: input.permissionSnapshot.permissionSnapshotId,
        } : {}),
        currentMessage: input.userMessage,
        inputPreprocessing: input.inputPreprocessing,
        sessionContext,
        ...memoryRecall,
        ...(toolDefinitions ? { toolDefinitions } : {}),
        budgetPolicy: {
          modelContextWindow: Number.MAX_SAFE_INTEGER,
          reservedOutputTokens: 0,
          keepRecentTokens: Number.MAX_SAFE_INTEGER,
        },
        builtAt: input.payload.createdAt,
      });
      const compactionPromise = compactionProbeModelInput.failure
        ? Promise.resolve({
            status: 'failed' as const,
            events: [],
            failure: modelStepInputBuildFailureToRuntimeError(compactionProbeModelInput.failure),
          })
        : this.sessionCompactionOrchestrator
        ? this.sessionCompactionOrchestrator.compactIfNeeded({
            requestId: input.requestId,
            sessionId: String(input.session.sessionId),
            runId: String(input.run.runId),
            stepId: String(input.step.stepId),
            providerId: input.payload.providerId,
            modelId: input.payload.modelId,
            runtimeContext: input.runtimeContext,
            createdAt: input.payload.createdAt,
            sessionContext,
            budgetProbeInputContext: compactionProbeModelInput.inputContext,
            budgetPolicy,
            startSequence: lastSequence,
        })
        : Promise.resolve({ status: 'skipped' as const, events: [] });

      yield runStarted;
      runStartedYielded = true;
      for (const event of this.repository.listRuntimeEventsByRun(String(input.run.runId)).filter((event) =>
        event.sequence > runStarted.sequence && event.eventType.startsWith('tool.registry.'))) {
        yield event;
      }
      const compaction = await compactionPromise;

      for (const event of compaction.events) {
        lastSequence = Math.max(lastSequence, nextRuntimeSequence(this.repository.listRuntimeEventsByRun(String(input.run.runId))));
        const eventWithRequest = withSessionMessageRequestMetadata(event, {
          requestId: input.requestId,
          runtimeContext: input.runtimeContext,
        });
        const sequencedEvent = withSequenceAfter(eventWithRequest, lastSequence);
        lastSequence = sequencedEvent.sequence;
        this.appendRuntimeEvent(sequencedEvent, input.chatStreamAdapter);
        yield sequencedEvent;
      }

      const persistedRun = this.repository.getRun(String(input.run.runId));
      if (persistedRun?.status === 'cancelled') {
        return;
      }

      if (compaction.status === 'failed') {
        yield* this.failRunBeforeModelStep({
          requestId: input.requestId,
          runtimeContext: input.runtimeContext,
          sessionId: String(input.session.sessionId),
          run: input.run,
          step: input.step,
          error: compaction.failure,
          startSequence: lastSequence,
          createdAt: this.clock.now(),
          chatStreamAdapter: input.chatStreamAdapter,
        });
        return;
      }

      const finalSessionContext = this.sessionContextInputService.buildSessionContextInput({
        sessionId: String(input.session.sessionId),
        currentRunId: String(input.run.runId),
        currentMessageId: String(input.userMessage.messageId),
        builtAt: input.payload.createdAt,
      });
      const initialModelInput = await this.modelStepInputBuildService.buildModelStepInput({
        requestId: input.requestId,
        sessionId: String(input.session.sessionId),
        runId: String(input.run.runId),
        stepId: String(input.step.stepId),
        contextKind: 'initial',
        providerId: input.payload.providerId,
        modelId: input.payload.modelId,
        modelContextWindow: budgetPolicy.modelContextWindow,
        ...(input.session.workspaceId ? { projectId: String(input.session.workspaceId) } : {}),
        ...(input.session.workspacePath ? { projectRoot: input.session.workspacePath } : {}),
        ...modelInputSourceOverrides,
        permissionMode: input.permissionMode,
        ...(input.permissionSnapshot ? {
          permissionSnapshot: toModelVisiblePermissionSnapshot(input.permissionSnapshot, input.payload.createdAt),
          permissionSnapshotRef: input.permissionSnapshot.permissionSnapshotId,
        } : {}),
        currentMessage: input.userMessage,
        inputPreprocessing: input.inputPreprocessing,
        sessionContext: finalSessionContext,
        ...memoryRecall,
        ...(toolDefinitions ? { toolDefinitions } : {}),
        budgetPolicy,
        builtAt: input.payload.createdAt,
      });
      if (initialModelInput.failure) {
        yield* this.failRunBeforeModelStep({
          requestId: input.requestId,
          runtimeContext: input.runtimeContext,
          sessionId: String(input.session.sessionId),
          run: input.run,
          step: input.step,
          error: modelStepInputBuildFailureToRuntimeError(initialModelInput.failure),
          startSequence: lastSequence,
          createdAt: this.clock.now(),
          chatStreamAdapter: input.chatStreamAdapter,
        });
        return;
      }
      const request: ModelStepRuntimeRequest = {
        requestId: input.requestId,
        sessionId: input.session.sessionId,
        runId: input.run.runId,
        stepId: input.step.stepId,
        providerId: input.payload.providerId,
        modelId: input.payload.modelId,
        inputContext: initialModelInput.inputContext,
        ...(initialModelInput.toolDefinitions.length > 0 ? { toolDefinitions: initialModelInput.toolDefinitions } : {}),
        runtimeContext: input.runtimeContext,
        createdAt: input.payload.createdAt,
      };
      const toolRuntime = input.session.workspacePath
        ? await this.toolRuntimeFactory?.create({
            projectRoot: input.session.workspacePath,
            permissionMode: input.permissionMode,
          })
        : undefined;

      yield* this.streamAndPersistModelStep({
        request,
        run: input.run,
        step: input.step,
        userMessageId: input.userMessage.messageId,
        ...(input.session.workspaceId ? { projectId: String(input.session.workspaceId) } : {}),
        ...(input.session.workspacePath ? { projectRoot: input.session.workspacePath } : {}),
        ...(toolRuntime ? { toolRuntime } : {}),
        ...(input.chatStreamAdapter ? { chatStreamAdapter: input.chatStreamAdapter } : {}),
        startSequence: lastSequence,
        emitRunStarted: false,
        permissionMode: input.permissionMode,
        ...memoryRecall,
      });
    } catch (error) {
      if (!runStartedYielded) {
        yield runStarted;
      }
      yield* this.failRunBeforeModelStep({
        requestId: input.requestId,
        runtimeContext: input.runtimeContext,
        sessionId: String(input.session.sessionId),
        run: input.run,
        step: input.step,
        error: createRuntimeErrorFromUnknown(error),
        startSequence: lastSequence,
        createdAt: this.clock.now(),
        chatStreamAdapter: input.chatStreamAdapter,
      });
    }
  }

  private scheduleRunCompletedMemoryCapture(input: {
    runId: string;
    sessionId: string;
    projectId?: string | null;
    providerId?: string | null;
    modelId?: string | null;
    userText: string;
    assistantText: string;
    hasProject: boolean;
    memoryEnabled?: boolean;
  }): void {
    if (!this.memoryCaptureService || !this.megumiHomePath) {
      return;
    }

    // Capture is a hidden post-completion hook. It must never write transcript
    // messages or alter the already completed user-visible run stream.
    const activity = this.createMemoryCaptureActivitySummary(input.runId);
    void this.memoryCaptureService.evaluateRunCompletedCapture({
      homePath: this.megumiHomePath,
      runId: input.runId,
      sessionId: input.sessionId,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      ...(input.providerId && isProviderId(input.providerId) ? { providerId: input.providerId } : {}),
      ...(input.modelId ? { modelId: input.modelId } : {}),
      runStatus: 'completed',
      userText: input.userText,
      assistantText: input.assistantText,
      ...(activity.summary ? { toolActivitySummary: activity.summary } : {}),
      ...(activity.signals.length > 0 ? { signals: activity.signals } : {}),
      ...(typeof input.memoryEnabled === 'boolean' ? { memoryEnabled: input.memoryEnabled } : {}),
      hasProject: input.hasProject,
    }).catch(() => {
      // Memory capture is best-effort. Runtime diagnostics are handled inside
      // the memory service when available; session-run must not fail here.
    });
  }

  private createMemoryCaptureActivitySummary(runId: string): { signals: MemoryCaptureSignal[]; summary?: string } {
    const summaryParts: string[] = [];
    const signals = new Set<MemoryCaptureSignal>();
    const sourceFiles = this.listSourceOfTruthChangedFiles(runId);
    if (sourceFiles.length > 0) {
      signals.add('source_of_truth_doc_changed');
      summaryParts.push(`Source-of-truth files changed: ${sourceFiles.slice(0, 5).join(', ')}`);
    }

    const toolSummaries = this.repository.listRuntimeEventsByRun(runId)
      .filter((event) => event.eventType === 'tool.result.created')
      .map((event) => {
        if (!isObjectRecord(event.payload) || typeof event.payload.summary !== 'string') {
          return undefined;
        }
        return clipMemoryRuntimeSummary(event.payload.summary);
      })
      .filter((summary): summary is string => Boolean(summary));
    if (toolSummaries.length > 0) {
      summaryParts.push(`Tool results observed: ${toolSummaries.slice(0, 5).join(' | ')}`);
    }

    const summary = clipMemoryRuntimeSummary(summaryParts.join('\n'), 1200);
    return {
      signals: [...signals],
      ...(summary ? { summary } : {}),
    };
  }

  private listSourceOfTruthChangedFiles(runId: string): string[] {
    if (!this.workspaceChanges) {
      return [];
    }
    try {
      return this.workspaceChanges.listChangedFilesByRun(runId)
        .map((file) => file.projectPath)
        .filter((projectPath) => isSourceOfTruthMemoryPath(projectPath));
    } catch {
      return [];
    }
  }

  private async *failRunBeforeModelStep(input: {
    requestId: string;
    runtimeContext?: RuntimeContext;
    sessionId: string;
    run: Run;
    step: RunStep;
    error: RuntimeError;
    startSequence: number;
    createdAt: string;
    chatStreamAdapter?: ChatStreamEventAdapter;
  }): AsyncIterable<RuntimeEvent> {
    let sequence = input.startSequence;
    const failedRun = this.repository.saveRun({
      ...input.run,
      status: 'failed',
      completedAt: input.createdAt,
      error: input.error,
    });
    const failedStep = this.repository.saveStep({
      ...input.step,
      status: 'failed',
      completedAt: input.createdAt,
      error: input.error,
    });

    for (const event of [
      createRunFailedEvent({
        eventId: this.ids.eventId(),
        sessionId: input.sessionId,
        runId: String(failedRun.runId),
        sequence: sequence += 1,
        createdAt: input.createdAt,
        error: input.error,
      }),
      createStepStatusChangedEvent({
        eventId: this.ids.eventId(),
        sessionId: input.sessionId,
        runId: String(failedRun.runId),
        stepId: String(failedStep.stepId),
        sequence: sequence += 1,
        createdAt: input.createdAt,
        from: 'running',
        to: 'failed',
      }),
      createStepFailedEvent({
        eventId: this.ids.eventId(),
        sessionId: input.sessionId,
        runId: String(failedRun.runId),
        sequence: sequence += 1,
        createdAt: input.createdAt,
        step: failedStep,
        error: input.error,
      }),
      createRunStatusChangedEvent({
        eventId: this.ids.eventId(),
        sessionId: input.sessionId,
        runId: String(failedRun.runId),
        sequence: sequence += 1,
        createdAt: input.createdAt,
        from: 'running',
        to: 'failed',
      }),
    ]) {
      const eventWithRequest = withSessionMessageRequestMetadata(event, {
        requestId: input.requestId,
        runtimeContext: input.runtimeContext,
      });
      this.appendRuntimeEvent(eventWithRequest, input.chatStreamAdapter);
      yield eventWithRequest;
    }
  }

  private async *streamAndPersistModelStep(input: {
    request: ModelStepRuntimeRequest;
    run: Run;
    step: RunStep;
    userMessageId: string;
    toolRuntime?: ToolCallHandlerPort & ToolApprovalResumePort;
    chatStreamAdapter?: ChatStreamEventAdapter;
    projectId?: string;
    projectRoot?: string;
    permissionMode?: PermissionMode;
    memoryRecallSources?: ModelInputMemoryRecallSource[];
    memoryRecallSeed?: ModelInputContextBuildRequest['memoryRecallSeed'];
    startSequence?: number;
    emitRunStarted?: boolean;
  }): AsyncIterable<RuntimeEvent> {
    let assistantContent = '';
    let sawAssistantOutputCompleted = false;
    let sawFinalModelStepCompleted = false;
    let lastSequence = input.startSequence ?? 0;
    let terminalEvent: RuntimeEvent | undefined;
    let currentModelStep = input.step;
    const pendingContinuations: PendingToolApprovalContinuation[] = [];
    let registeredPendingGroup: ApprovalContinuationGroup | undefined;
    const modelStepsById = new Map<string, RunStep>([[input.step.stepId, input.step]]);

    const registerPendingApprovalGroup = (): ApprovalContinuationGroup | undefined => {
      if (registeredPendingGroup || pendingContinuations.length === 0 || !toolRuntime) {
        return registeredPendingGroup;
      }

      const currentRun = this.repository.getRun(input.request.runId) ?? input.run;
      assertRunStatusTransition(currentRun.status, 'waiting_for_approval');
      const waitingRun = this.repository.saveRun({
        ...currentRun,
        status: 'waiting_for_approval',
      });
      const waitingStep = this.repository.saveStep({
        ...currentModelStep,
        status: 'waiting_for_approval',
      });
      currentModelStep = waitingStep;
      const groupId = `${input.request.runId}:${input.request.stepId}:${this.ids.eventId()}`;
      const group: ApprovalContinuationGroup = {
        groupId,
        request: input.request,
        run: waitingRun,
        step: waitingStep,
        ...(input.projectId ? { projectId: input.projectId } : {}),
        ...(input.projectRoot ? { projectRoot: input.projectRoot } : {}),
        ...(input.permissionMode ? { permissionMode: input.permissionMode } : {}),
        userMessageId: input.userMessageId,
        pendingByApprovalId: new Map(pendingContinuations.map((pending) => [
          pending.pendingApproval.approvalRequest.approvalRequestId,
          pending,
        ])),
        resolvedResults: [],
        toolRuntime,
        ...(input.memoryRecallSources ? { memoryRecallSources: input.memoryRecallSources } : {}),
        ...(input.memoryRecallSeed ? { memoryRecallSeed: input.memoryRecallSeed } : {}),
        ...(input.chatStreamAdapter ? { chatStreamAdapter: input.chatStreamAdapter } : {}),
      };
      this.pendingApprovalGroups.set(groupId, group);
      for (const approvalRequestId of group.pendingByApprovalId.keys()) {
        this.pendingApprovals.set(approvalRequestId, group);
      }
      registeredPendingGroup = group;
      return group;
    };

    if (input.emitRunStarted !== false) {
      const startedEvent = withRequestMetadata(createRunStartedEvent({
        eventId: this.ids.eventId(),
        sessionId: input.request.sessionId,
        runId: input.request.runId,
        sequence: lastSequence += 1,
        createdAt: input.request.createdAt,
      }), input.request);
      this.appendRuntimeEvent(startedEvent, input.chatStreamAdapter);
      yield startedEvent;
    }

    const modelStepProvider = this.requireModelStepProvider();
    const toolRuntime = input.toolRuntime;
    const streamProviderModelStep = (request: ModelStepRuntimeRequest) =>
      modelStepProvider.streamModelStep(request);
    const modelEvents = toolRuntime
      ? runModelToolLoop({
          request: input.request,
          aiPort: {
            streamModelStep: ({ request }) => streamProviderModelStep(request),
          },
          toolCallHandler: toolRuntime,
          ids: {
            nextEventId: this.ids.eventId,
            nextStepId: () => {
              const step = this.repository.saveStep({
                stepId: this.ids.stepId(),
                runId: input.request.runId,
                kind: 'model',
                status: 'running',
                title: 'Model response',
                startedAt: this.clock.now(),
              });
              currentModelStep = step;
              modelStepsById.set(step.stepId, step);
              return step.stepId;
            },
            nextModelStepId: () => `model-step:${crypto.randomUUID()}`,
          },
          onPendingApproval: (pending) => {
            pendingContinuations.push(pending);
          },
          onToolContinuationEmitted: ({ request, toolResults, emittedAt }) => {
            const event = this.markToolContinuationEmitted({
              request,
              stepId: request.stepId,
              toolResults,
              emittedAt,
              sequence: 0,
            });
            return event ? [event] : [];
          },
          buildContinuationInputContext: async (contextInput) => {
            const continuationInput = await this.modelStepInputBuildService.buildModelStepInput({
              baseInputContext: contextInput.baseInputContext,
              requestId: input.request.requestId,
              sessionId: contextInput.sessionId,
              runId: contextInput.runId,
              stepId: contextInput.stepId,
              contextKind: 'tool-continuation',
              providerId: input.request.providerId,
              modelId: String(input.request.modelId),
              ...(input.projectRoot ? { projectRoot: input.projectRoot } : {}),
              ...this.modelInputRuntimeSourceOverrides({
                sessionId: contextInput.sessionId,
                runId: contextInput.runId,
                stepId: contextInput.stepId,
                builtAt: contextInput.builtAt,
              }),
              permissionMode: input.permissionMode ?? 'default',
              toolDefinitions: input.request.toolDefinitions ?? [],
              toolCalls: contextInput.toolCalls,
              toolResults: contextInput.toolResults,
              providerStates: contextInput.providerStates,
              ...(input.memoryRecallSources ? { memoryRecallSources: input.memoryRecallSources } : {}),
              ...(input.memoryRecallSeed ? { memoryRecallSeed: input.memoryRecallSeed } : {}),
              builtAt: contextInput.builtAt,
            });
            if (continuationInput.failure) {
              throw modelStepInputBuildFailureToRuntimeError(continuationInput.failure);
            }
            return continuationInput.inputContext;
          },
        })
      : streamProviderModelStep(input.request);

    try {
      for await (const event of coalesceTextDeltaRuntimeEvents(modelEvents)) {
        registerPendingApprovalGroup();
        lastSequence = Math.max(lastSequence, nextRuntimeSequence(this.repository.listRuntimeEventsByRun(input.request.runId)));
        const eventWithRequest = withSequenceAfter(withRequestMetadata(event, input.request), lastSequence);
        lastSequence = eventWithRequest.sequence;
        this.persistModelStepRecordFromEvent(input.request, eventWithRequest, currentModelStep.stepId);
        this.appendRuntimeEvent(eventWithRequest, input.chatStreamAdapter);
        if (eventWithRequest.eventType === 'assistant.output.delta' || eventWithRequest.eventType === 'model.output.delta') {
          assistantContent += getAssistantDeltaContent(eventWithRequest.payload);
        }
        if (eventWithRequest.eventType === 'assistant.output.completed') {
          sawAssistantOutputCompleted = true;
          const content = getAssistantCompletedContent(eventWithRequest.payload);
          if (content) {
            assistantContent = content;
          }
        }
        if (eventWithRequest.eventType === 'model.step.completed') {
          const modelStepId = getModelStepId(eventWithRequest.payload);
          if (modelStepId) {
            this.persistModelStepRecordFromEvent(input.request, eventWithRequest, currentModelStep.stepId, {
              status: 'succeeded',
              completedAt: eventWithRequest.createdAt,
            });
          }
          const completedStep = this.markModelStepSucceeded(
            modelStepsById,
            eventWithRequest.stepId ?? currentModelStep.stepId,
            eventWithRequest.createdAt,
          );
          if (completedStep && completedStep.stepId === currentModelStep.stepId) {
            currentModelStep = completedStep;
          }
          if (!isToolCallModelStepCompletion(eventWithRequest.payload)) {
            sawFinalModelStepCompleted = true;
          }
        }
        if (eventWithRequest.eventType === 'run.failed' || eventWithRequest.eventType === 'run.cancelled') {
          terminalEvent = eventWithRequest;
        }
        yield eventWithRequest;
      }
    } catch (error) {
      if (this.repository.getRun(input.request.runId)?.status === 'cancelled') {
        return;
      }
      lastSequence = Math.max(lastSequence, nextRuntimeSequence(this.repository.listRuntimeEventsByRun(input.request.runId)));
      const failedEvent = withRequestMetadata(createRunFailedEvent({
        eventId: this.ids.eventId(),
        sessionId: input.request.sessionId,
        runId: input.request.runId,
        sequence: lastSequence += 1,
        createdAt: this.clock.now(),
        error: createRuntimeErrorFromUnknown(error),
      }), input.request);
      this.appendRuntimeEvent(failedEvent, input.chatStreamAdapter);
      terminalEvent = failedEvent;
      yield failedEvent;
    }

    if (pendingContinuations.length > 0 && toolRuntime) {
      const waitingAt = this.clock.now();
      registerPendingApprovalGroup();
      const waitingEvent = withRequestMetadata(createRunStatusChangedEvent({
        eventId: this.ids.eventId(),
        sessionId: input.request.sessionId,
        runId: input.request.runId,
        sequence: lastSequence += 1,
        createdAt: waitingAt,
        from: 'running',
        to: 'waiting_for_approval',
      }), input.request);
      this.appendRuntimeEvent(waitingEvent, input.chatStreamAdapter);
      yield waitingEvent;
      return;
    }

    const completedAt = this.clock.now();
    if (terminalEvent?.eventType === 'run.failed') {
      const error = getRunFailedError(terminalEvent.payload) ?? createFallbackRuntimeError('Run failed.');
      const failedStep = this.repository.saveStep({
        ...currentModelStep,
        status: 'failed',
        completedAt,
        error,
      });
      this.repository.saveRun({
        ...input.run,
        status: 'failed',
        completedAt,
        error,
      });
      for (const event of [
        createStepStatusChangedEvent({
          eventId: this.ids.eventId(),
          sessionId: input.request.sessionId,
          runId: input.request.runId,
          stepId: failedStep.stepId,
          sequence: lastSequence += 1,
          createdAt: completedAt,
          from: 'running',
          to: 'failed',
        }),
        createStepFailedEvent({
          eventId: this.ids.eventId(),
          sessionId: input.request.sessionId,
          runId: input.request.runId,
          sequence: lastSequence += 1,
          createdAt: completedAt,
          step: failedStep,
          error,
        }),
        createRunStatusChangedEvent({
          eventId: this.ids.eventId(),
          sessionId: input.request.sessionId,
          runId: input.request.runId,
          sequence: lastSequence += 1,
          createdAt: completedAt,
          from: 'running',
          to: 'failed',
        }),
      ]) {
        const eventWithRequest = withRequestMetadata(event, input.request);
        this.appendRuntimeEvent(eventWithRequest, input.chatStreamAdapter);
        yield eventWithRequest;
      }
      return;
    }

    if (terminalEvent?.eventType === 'run.cancelled') {
      const cancelledStep = this.repository.saveStep({
        ...currentModelStep,
        status: 'cancelled',
        completedAt,
      });
      this.repository.saveRun({
        ...input.run,
        status: 'cancelled',
        cancelledAt: completedAt,
      });
      for (const event of [
        createStepStatusChangedEvent({
          eventId: this.ids.eventId(),
          sessionId: input.request.sessionId,
          runId: input.request.runId,
          stepId: cancelledStep.stepId,
          sequence: lastSequence += 1,
          createdAt: completedAt,
          from: 'running',
          to: 'cancelled',
        }),
        createRunStatusChangedEvent({
          eventId: this.ids.eventId(),
          sessionId: input.request.sessionId,
          runId: input.request.runId,
          sequence: lastSequence += 1,
          createdAt: completedAt,
          from: 'running',
          to: 'cancelled',
        }),
      ]) {
        const eventWithRequest = withRequestMetadata(event, input.request);
        this.appendRuntimeEvent(eventWithRequest, input.chatStreamAdapter);
        yield eventWithRequest;
      }
      return;
    }

    if (!(sawAssistantOutputCompleted || sawFinalModelStepCompleted) || assistantContent.length === 0) {
      return;
    }

    const assistantMessage = this.repository.saveMessage({
      messageId: this.ids.messageId(),
      sessionId: input.request.sessionId,
      runId: input.request.runId,
      role: 'assistant',
      content: assistantContent,
      status: 'completed',
      createdAt: completedAt,
      completedAt,
    });
    this.appendSourceAndMoveLeaf({
      sessionId: input.request.sessionId,
      sourceRef: sessionMessageSourceRef(String(assistantMessage.messageId), completedAt),
      createdAt: completedAt,
    });

    const completedStep = this.repository.saveStep({
      ...currentModelStep,
      status: 'succeeded',
      completedAt,
    });
    this.repository.saveRun({
      ...input.run,
      status: 'completed',
      completedAt,
    });

    for (const event of [
      createStepStatusChangedEvent({
        eventId: this.ids.eventId(),
        sessionId: input.request.sessionId,
        runId: input.request.runId,
        stepId: completedStep.stepId,
        sequence: lastSequence += 1,
        createdAt: completedAt,
        from: 'running',
        to: 'succeeded',
      }),
      createStepCompletedEvent({
        eventId: this.ids.eventId(),
        sessionId: input.request.sessionId,
        runId: input.request.runId,
        sequence: lastSequence += 1,
        createdAt: completedAt,
        step: completedStep,
      }),
      createRunStatusChangedEvent({
        eventId: this.ids.eventId(),
        sessionId: input.request.sessionId,
        runId: input.request.runId,
        sequence: lastSequence += 1,
        createdAt: completedAt,
        from: 'running',
        to: 'completed',
      }),
      createRunCompletedEvent({
        eventId: this.ids.eventId(),
        sessionId: input.request.sessionId,
        runId: input.request.runId,
        sequence: lastSequence += 1,
        createdAt: completedAt,
      }),
    ]) {
      const eventWithRequest = withRequestMetadata(event, input.request);
      this.appendRuntimeEvent(eventWithRequest, input.chatStreamAdapter);
      if (eventWithRequest.eventType === 'run.completed') {
        this.scheduleRunCompletedMemoryCapture({
          runId: String(input.request.runId),
          sessionId: String(input.request.sessionId),
          ...(input.projectId ? { projectId: input.projectId } : {}),
          providerId: isProviderId(input.request.providerId) ? input.request.providerId : null,
          modelId: String(input.request.modelId),
          userText: input.request.inputContext.parts
            .filter((part) => part.kind === 'current_turn' && part.role === 'user')
            .map((part) => part.text)
            .join('\n')
            .trim(),
          assistantText: assistantContent,
          hasProject: Boolean(input.projectRoot),
          memoryEnabled: this.resolveMemoryEnabled(),
        });
      }
      yield eventWithRequest;
    }
  }

  private recordManualRerunAttemptForBranchDraft(input: {
    requestId: string;
    sessionId: string;
    runId: string;
    branchMarkerId: string;
    marker: SessionBranchMarker;
    createdAt: string;
    runtimeContext?: RuntimeContext;
  }): RuntimeEvent {
    const activePathRepository = this.requireActivePathRepository();
    const marker = input.marker;

    const seedRunId = marker.seedSourceRef?.sourceKind === 'session_message'
      ? this.repository.getMessage(marker.seedSourceRef.sourceId)?.runId
      : undefined;
    const runId = String(seedRunId ?? input.runId);
    const retryAttemptId = this.ids.retryAttemptId();
    const retryAttempt = activePathRepository.saveRetryAttempt({
      retryAttemptId,
      sessionId: input.sessionId,
      runId,
      ...(marker.targetLeafSourceEntryId ? { baseSourceEntryId: marker.targetLeafSourceEntryId } : {}),
      attemptNumber: activePathRepository.listRetryAttemptsByRun(runId).length + 1,
      retryKind: 'manual_rerun',
      reason: 'user_requested',
      status: 'pending',
      retryable: true,
      createdAt: input.createdAt,
      metadata: {
        requestId: input.requestId,
        branchMarkerId: input.branchMarkerId,
      },
    });

    return createRuntimeEvent({
      eventId: this.ids.eventId(),
      eventType: 'run.retry.requested',
      runId,
      sessionId: input.sessionId,
      requestId: input.requestId,
      ...(input.runtimeContext ? { context: input.runtimeContext } : {}),
      sequence: nextRuntimeSequence(this.repository.listRuntimeEventsByRun(runId)),
      createdAt: input.createdAt,
      source: 'main',
      visibility: 'system',
      persist: 'required',
      payload: {
        retryRequestId: retryAttempt.retryAttemptId,
        requestedBy: 'user',
        retryKind: 'manual_rerun',
        reason: 'user_requested',
        attemptNumber: retryAttempt.attemptNumber,
      },
    });
  }

  private assertActiveBranchDraftMarker(input: {
    sessionId: string;
    branchMarkerId: string;
  }): SessionBranchMarker {
    const activePathRepository = this.requireActivePathRepository();
    const marker = activePathRepository.getBranchMarker(input.branchMarkerId);
    if (!marker || marker.sessionId !== input.sessionId) {
      throw new Error('Branch draft marker was not found.');
    }

    const markerSourceEntry = activePathRepository.getSourceEntryBySourceRef(input.sessionId, {
      sourceKind: 'branch_marker',
      sourceId: input.branchMarkerId,
    });
    if (!markerSourceEntry) {
      throw new Error('Branch draft marker was not found.');
    }

    const activeLeaf = activePathRepository.getActiveLeaf(input.sessionId);
    if (activeLeaf?.leafSourceEntryId !== markerSourceEntry.sourceEntryId) {
      throw new Error('Branch draft marker is not active.');
    }

    if (activePathRepository.listChildSourceEntries(markerSourceEntry.sourceEntryId).length > 0) {
      throw new Error('Branch draft marker is not active.');
    }

    return marker;
  }

  private publishBranchSeparatorForDraft(input: {
    branchDraft: SessionBranchDraftView;
    seedRunId: string;
  }): void {
    if (!this.chatStreamEventSink) {
      return;
    }

    const session = this.repository.getSession(input.branchDraft.sessionId);
    this.chatStreamEventSink.publish(createChatStreamEvent({
      eventId: this.ids.chatStreamEventId(),
      eventType: 'branch.separator.created',
      projectId: String(session?.workspaceId ?? input.branchDraft.sessionId),
      sessionId: input.branchDraft.sessionId,
      runId: input.seedRunId,
      streamId: `branch-draft:${input.branchDraft.branchMarkerId}`,
      streamKind: 'main',
      seq: 1,
      createdAt: input.branchDraft.createdAt,
      branchMarkerId: input.branchDraft.branchMarkerId,
      sourceMessageId: input.branchDraft.sourceMessageId,
      label: input.branchDraft.label,
    }));
  }

  private publishBranchSeparatorRemovalForDraft(input: {
    sessionId: string;
    branchMarkerId: string;
    seedRunId: string;
    createdAt: string;
  }): void {
    if (!this.chatStreamEventSink) {
      return;
    }

    const session = this.repository.getSession(input.sessionId);
    this.chatStreamEventSink.publish(createChatStreamEvent({
      eventId: this.ids.chatStreamEventId(),
      eventType: 'branch.separator.removed',
      projectId: String(session?.workspaceId ?? input.sessionId),
      sessionId: input.sessionId,
      runId: input.seedRunId,
      streamId: `branch-draft:${input.branchMarkerId}`,
      streamKind: 'main',
      seq: 2,
      createdAt: input.createdAt,
      branchMarkerId: input.branchMarkerId,
    }));
  }

  private seedRunIdForBranchMarker(marker: SessionBranchMarker): string {
    if (marker.seedSourceRef?.sourceKind === 'session_message') {
      return String(this.repository.getMessage(marker.seedSourceRef.sourceId)?.runId ?? marker.branchMarkerId);
    }
    return marker.branchMarkerId;
  }

  private shouldHydrateTimelineMessage(message: TimelineMessage): boolean {
    if (message.role !== 'separator') {
      return true;
    }

    const branchSeparator = message.blocks.find((block) => block.kind === 'branch_separator');
    if (!branchSeparator) {
      return true;
    }

    return this.shouldHydrateBranchSeparator({
      sessionId: String(message.sessionId),
      branchMarkerId: branchSeparator.branchMarkerId,
    });
  }

  private shouldHydrateBranchSeparator(input: {
    sessionId: string;
    branchMarkerId: string;
  }): boolean {
    const activePathRepository = this.activePathRepository;
    if (!activePathRepository) {
      return true;
    }

    const markerSourceEntry = activePathRepository.getSourceEntryBySourceRef(input.sessionId, {
      sourceKind: 'branch_marker',
      sourceId: input.branchMarkerId,
    });
    if (!markerSourceEntry) {
      return false;
    }

    const activeLeaf = activePathRepository.getActiveLeaf(input.sessionId);
    if (activeLeaf?.leafSourceEntryId === markerSourceEntry.sourceEntryId) {
      return true;
    }

    return activePathRepository.listChildSourceEntries(markerSourceEntry.sourceEntryId).length > 0;
  }

  private appendSourceAndMoveLeaf(input: {
    sessionId: string;
    sourceRef: ModelInputContextSourceRef;
    createdAt: string;
    reason?: 'source_appended' | 'branch_marker';
    metadata?: JsonObject;
  }): SessionSourceEntry | undefined {
    if (!this.activePathRepository) {
      return undefined;
    }

    const parentSourceEntryId = this.activePathRepository.getActiveLeaf(input.sessionId)?.leafSourceEntryId ?? undefined;
    const sourceEntryId = this.ids.sourceEntryId();
    return this.activePathRepository.appendSourceEntryAndSetActiveLeaf({
      sourceEntryId,
      sessionId: input.sessionId,
      ...(parentSourceEntryId ? { parentSourceEntryId } : {}),
      sourceRef: input.sourceRef,
      createdAt: input.createdAt,
      ...(input.metadata ? { metadata: input.metadata } : {}),
    }, {
      sessionId: input.sessionId,
      leafSourceEntryId: sourceEntryId,
      updatedAt: input.createdAt,
      reason: input.reason ?? 'source_appended',
      ...(input.metadata ? { metadata: input.metadata } : {}),
    });
  }

  private appendRuntimeEvent(event: RuntimeEvent, chatStreamAdapter?: ChatStreamEventAdapter): void {
    if (isRunTerminalRuntimeEvent(event)) {
      this.publishWorkspaceChangeFooter({
        runId: String(event.runId),
        createdAt: event.createdAt,
        chatStreamAdapter,
      });
    }
    this.repository.appendRuntimeEvent(event);
    chatStreamAdapter?.handleRuntimeEvent(event);
    if (isRunTerminalRuntimeEvent(event)) {
      chatStreamAdapter?.dispose();
    }
  }

  private cancelPendingApprovalGroupsByRun(runId: string): void {
    for (const [groupId, group] of this.pendingApprovalGroups.entries()) {
      if (group.request.runId !== runId) {
        continue;
      }
      for (const approvalRequestId of group.pendingByApprovalId.keys()) {
        this.pendingApprovals.delete(approvalRequestId);
      }
      this.pendingApprovalGroups.delete(groupId);
    }
  }

  private publishWorkspaceChangeFooter(input: {
    runId: string;
    createdAt: string;
    chatStreamAdapter?: ChatStreamEventAdapter;
  }): void {
    if (!input.chatStreamAdapter || !this.workspaceChangeFooterProjector) {
      return;
    }

    const footer = this.workspaceChangeFooterProjector.projectRunFooter(input.runId);
    if (!footer) {
      return;
    }

    input.chatStreamAdapter.publishWorkspaceChangeFooter(footer, input.createdAt);
  }

  private requireModelStepProvider(): SessionRunModelStepProvider {
    if (!this.modelStepProvider) {
      throw new Error('Model step provider service is not configured.');
    }

    return this.modelStepProvider;
  }

  private requireActivePathRepository(): SessionActivePathRepository {
    if (!this.activePathRepository) {
      throw new Error('Active path repository is not configured.');
    }

    return this.activePathRepository;
  }

  private requirePermissionSnapshotService(): NonNullable<SessionRunServiceOptions['permissionSnapshotService']> {
    if (!this.permissionSnapshotService) {
      throw new Error('Permission snapshot service is not configured.');
    }

    return this.permissionSnapshotService;
  }

  private async *resumeApprovalContinuation(
    continuation: ApprovalContinuationGroup,
    input: ToolApprovalResumeInput,
  ): AsyncIterable<RuntimeEvent> {
    const pending = continuation.pendingByApprovalId.get(input.approvalRequestId);
    if (!pending) {
      return;
    }

    const resumeOutcome = await continuation.toolRuntime.resumeToolApproval(input);
    if (!resumeOutcome) {
      return;
    }
    const toolResults = [...(resumeOutcome.toolResults ?? (resumeOutcome.toolResult ? [resumeOutcome.toolResult] : []))];
    const chatStreamAdapter = continuation.chatStreamAdapter;

    let lastSequence = nextRuntimeSequence(this.repository.listRuntimeEventsByRun(continuation.request.runId));
    continuation.pendingByApprovalId.delete(input.approvalRequestId);
    this.pendingApprovals.delete(input.approvalRequestId);
    continuation.resolvedResults.push(...toolResults);

    const approvalResolvedEvent = withRequestMetadata(createRuntimeEvent({
      eventId: this.ids.eventId(),
      eventType: 'approval.resolved',
      runId: continuation.request.runId,
      sessionId: continuation.request.sessionId,
      stepId: continuation.step.stepId,
      requestId: continuation.request.requestId,
      runtimeContext: continuation.request.runtimeContext,
      sequence: lastSequence += 1,
      createdAt: input.decidedAt,
      source: 'approval',
      visibility: 'user',
      persist: 'required',
      payload: {
        approvalRequestId: input.approvalRequestId,
        decision: input.decision,
        scope: pending.pendingApproval.approvalRequest.requestedScope,
        decidedAt: input.decidedAt,
      },
    }), continuation.request);
    this.appendRuntimeEvent(approvalResolvedEvent, chatStreamAdapter);
    yield approvalResolvedEvent;

    if (
      continuation.pendingByApprovalId.size > 0
      || (resumeOutcome.pendingApprovals?.length ?? 0) > 0
      || resumeOutcome.continuationReady === false
    ) {
      const resumeEvents = this.persistResumeRuntimeEvents({
        request: continuation.request,
        stepId: continuation.step.stepId,
        lastSequence,
        outcome: resumeOutcome,
      });
      lastSequence = resumeEvents.lastSequence;
      for (const event of resumeEvents.events) {
        this.appendRuntimeEvent(event, chatStreamAdapter);
        yield event;
      }
      for (const toolResult of toolResults) {
        if (resumeEvents.toolResultIdsWithEvents.has(String(toolResult.toolResultId))) {
          continue;
        }
        const toolResultEvent = this.createToolResultRuntimeEvent({
          request: continuation.request,
          stepId: continuation.step.stepId,
          sequence: lastSequence += 1,
          toolResult,
        });
        this.appendRuntimeEvent(toolResultEvent, chatStreamAdapter);
        yield toolResultEvent;
      }
      return;
    }

    this.pendingApprovalGroups.delete(continuation.groupId);
    const persistedRun = this.repository.getRun(continuation.request.runId) ?? continuation.run;
    assertRunStatusTransition(persistedRun.status, 'running');
    const runningRun = this.repository.saveRun({
      ...persistedRun,
      status: 'running',
    });

    const runningEvent = withRequestMetadata(createRunStatusChangedEvent({
      eventId: this.ids.eventId(),
      sessionId: continuation.request.sessionId,
      runId: continuation.request.runId,
      sequence: lastSequence += 1,
      createdAt: input.decidedAt,
      from: 'waiting_for_approval',
      to: 'running',
    }), continuation.request);
    this.appendRuntimeEvent(runningEvent, chatStreamAdapter);
    yield runningEvent;

    const resumeEvents = this.persistResumeRuntimeEvents({
      request: continuation.request,
      stepId: continuation.step.stepId,
      lastSequence,
      outcome: resumeOutcome,
    });
    lastSequence = resumeEvents.lastSequence;
    for (const event of resumeEvents.events) {
      this.appendRuntimeEvent(event, chatStreamAdapter);
      yield event;
    }

    for (const toolResult of toolResults) {
      if (resumeEvents.toolResultIdsWithEvents.has(String(toolResult.toolResultId))) {
        continue;
      }
      const toolResultEvent = this.createToolResultRuntimeEvent({
        request: continuation.request,
        stepId: continuation.step.stepId,
        sequence: lastSequence += 1,
        toolResult,
      });
      this.appendRuntimeEvent(toolResultEvent, chatStreamAdapter);
      yield toolResultEvent;
    }

    const resumedStep = this.repository.saveStep({
      stepId: this.ids.stepId(),
      runId: continuation.request.runId,
      kind: 'model',
      status: 'running',
      title: 'Model response',
      startedAt: input.decidedAt,
    });
    const resumedToolResults = [
      ...pending.accumulatedToolResults,
      ...continuation.resolvedResults,
    ];
    const resumedModelInput = await this.modelStepInputBuildService.buildModelStepInput({
      baseInputContext: pending.request.inputContext,
      requestId: pending.request.requestId,
      sessionId: pending.request.sessionId,
      runId: String(pending.request.runId),
      stepId: String(resumedStep.stepId),
      contextKind: 'approval-resume',
      providerId: pending.request.providerId,
      modelId: String(pending.request.modelId),
      ...(continuation.projectRoot ? { projectRoot: continuation.projectRoot } : {}),
      ...this.modelInputRuntimeSourceOverrides({
        sessionId: pending.request.sessionId,
        runId: String(pending.request.runId),
        stepId: String(resumedStep.stepId),
        builtAt: input.decidedAt,
      }),
      permissionMode: continuation.permissionMode ?? 'default',
      toolDefinitions: pending.request.toolDefinitions ?? [],
      toolCalls: pending.accumulatedToolCalls,
      toolResults: resumedToolResults,
      providerStates: pending.accumulatedProviderStates,
      ...(continuation.memoryRecallSources ? { memoryRecallSources: continuation.memoryRecallSources } : {}),
      ...(continuation.memoryRecallSeed ? { memoryRecallSeed: continuation.memoryRecallSeed } : {}),
      builtAt: input.decidedAt,
    });
    if (resumedModelInput.failure) {
      yield* this.failRunBeforeModelStep({
        requestId: pending.request.requestId,
        sessionId: pending.request.sessionId,
        run: runningRun,
        step: resumedStep,
        error: modelStepInputBuildFailureToRuntimeError(resumedModelInput.failure),
        startSequence: lastSequence,
        createdAt: input.decidedAt,
        chatStreamAdapter,
      });
      return;
    }
    const continuationEmittedEvent = this.markToolContinuationEmitted({
      request: pending.request,
      stepId: resumedStep.stepId,
      toolResults: resumedToolResults,
      emittedAt: input.decidedAt,
      sequence: lastSequence += 1,
    });
    if (continuationEmittedEvent) {
      this.appendRuntimeEvent(continuationEmittedEvent, chatStreamAdapter);
      yield continuationEmittedEvent;
    }
    const resumedRequest: ModelStepRuntimeRequest = {
      ...pending.request,
      stepId: resumedStep.stepId,
      modelStepId: `model-step:${crypto.randomUUID()}`,
      inputContext: resumedModelInput.inputContext,
      createdAt: input.decidedAt,
    };

    yield* this.streamAndPersistModelStep({
      request: resumedRequest,
      run: runningRun,
      step: resumedStep,
      userMessageId: continuation.userMessageId,
      startSequence: lastSequence,
      toolRuntime: continuation.toolRuntime,
      ...(continuation.projectId ? { projectId: continuation.projectId } : {}),
      ...(continuation.projectRoot ? { projectRoot: continuation.projectRoot } : {}),
      ...(chatStreamAdapter ? { chatStreamAdapter } : {}),
      emitRunStarted: false,
      ...(continuation.permissionMode ? { permissionMode: continuation.permissionMode } : {}),
      ...(continuation.memoryRecallSources ? { memoryRecallSources: continuation.memoryRecallSources } : {}),
      ...(continuation.memoryRecallSeed ? { memoryRecallSeed: continuation.memoryRecallSeed } : {}),
    });
  }

  private persistResumeRuntimeEvents(input: {
    request: ModelStepRuntimeRequest;
    stepId: RunStep['stepId'];
    lastSequence: number;
    outcome: ToolApprovalResumeOutcome;
  }): {
    events: RuntimeEvent[];
    lastSequence: number;
    toolResultIdsWithEvents: Set<string>;
  } {
    let lastSequence = input.lastSequence;
    const events: RuntimeEvent[] = [];
    const toolResultIdsWithEvents = new Set<string>();

    for (const event of input.outcome.runtimeEvents ?? []) {
      const eventWithRequest = withSequenceAfter(withRequestMetadata({
        ...event,
        sessionId: event.sessionId ?? input.request.sessionId,
        stepId: event.stepId ?? String(input.stepId),
      }, input.request), lastSequence);
      lastSequence = eventWithRequest.sequence;
      if (eventWithRequest.eventType === 'tool.result.created') {
        const toolResultId = getToolResultEventId(eventWithRequest.payload);
        if (toolResultId) {
          toolResultIdsWithEvents.add(toolResultId);
        }
      }
      events.push(eventWithRequest);
    }

    return { events, lastSequence, toolResultIdsWithEvents };
  }

  private markToolContinuationEmitted(input: {
    request: ModelStepRuntimeRequest;
    stepId: RunStep['stepId'];
    toolResults: readonly ToolResult[];
    emittedAt: string;
    sequence: number;
  }): RuntimeEvent | undefined {
    const toolExecutionIds = [
      ...new Set(input.toolResults
        .map((result) => result.toolExecutionId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)),
    ];
    if (toolExecutionIds.length === 0) {
      return undefined;
    }

    this.toolRepository?.markToolContinuationEmitted({
      toolExecutionIds,
      emittedAt: input.emittedAt,
    });

    const assistantMessageId = input.toolResults
      .map((result) => result.metadata?.assistantMessageId)
      .find((value): value is string => typeof value === 'string' && value.length > 0)
      ?? String(input.request.modelStepId ?? input.request.stepId);

    return withRequestMetadata(createToolContinuationEmittedEvent({
      eventId: this.ids.eventId(),
      eventType: 'tool.continuation.emitted',
      runId: input.request.runId,
      sessionId: input.request.sessionId,
      stepId: String(input.stepId),
      requestId: input.request.requestId,
      runtimeContext: input.request.runtimeContext,
      sequence: input.sequence,
      createdAt: input.emittedAt,
      source: 'tool',
      visibility: 'system',
      persist: 'required',
      payload: {
        assistantMessageId,
        toolExecutionIds,
        emittedAt: input.emittedAt,
      },
    }), input.request);
  }

  private createToolResultRuntimeEvent(input: {
    request: ModelStepRuntimeRequest;
    stepId: RunStep['stepId'];
    sequence: number;
    toolResult: ToolResult;
  }): RuntimeEvent {
    return withRequestMetadata(createToolResultCreatedEvent({
      eventId: this.ids.eventId(),
      eventType: 'tool.result.created',
      runId: input.request.runId,
      sessionId: input.request.sessionId,
      stepId: String(input.stepId),
      requestId: input.request.requestId,
      runtimeContext: input.request.runtimeContext,
      sequence: input.sequence,
      createdAt: input.toolResult.createdAt,
      source: 'tool',
      visibility: 'system',
      persist: 'required',
      payload: {
        toolResultId: String(input.toolResult.toolResultId),
        toolCallId: String(input.toolResult.toolCallId),
        ...(input.toolResult.toolExecutionId ? { toolExecutionId: String(input.toolResult.toolExecutionId) } : {}),
        kind: input.toolResult.kind,
        summary: createToolResultSummary(input.toolResult),
      },
    }), input.request);
  }

  private persistModelStepRecordFromEvent(
    request: ModelStepRuntimeRequest,
    event: RuntimeEvent,
    fallbackStepId: string,
    overrides: {
      status?: RunStep['status'];
      completedAt?: string;
      error?: RuntimeError;
    } = {},
  ) {
    if (
      event.eventType !== 'model.step.started' &&
      event.eventType !== 'model.step.completed' &&
      event.eventType !== 'tool.call.created'
    ) {
      return;
    }

    const modelStepId = getModelStepId(event.payload) ?? request.modelStepId;
    if (!modelStepId) {
      return;
    }

    const existing = this.repository.getModelStep(modelStepId);
    this.repository.saveModelStep({
      modelStepId,
      runId: request.runId,
      stepId: event.stepId ?? request.stepId ?? existing?.stepId ?? fallbackStepId,
      providerId: request.providerId,
      modelId: request.modelId,
      status: overrides.status ?? existing?.status ?? 'running',
      startedAt: existing?.startedAt ?? event.createdAt,
      ...(overrides.completedAt ?? existing?.completedAt ? {
        completedAt: overrides.completedAt ?? existing?.completedAt,
      } : {}),
      ...(overrides.error ?? existing?.error ? { error: overrides.error ?? existing?.error } : {}),
      metadata: {
        ...(existing?.metadata ?? {}),
        sourceEventType: event.eventType,
      },
    });
  }

  private markModelStepSucceeded(
    modelStepsById: Map<string, RunStep>,
    stepId: string,
    completedAt: string,
  ): RunStep | undefined {
    const step = modelStepsById.get(stepId);

    if (!step || step.status !== 'running') {
      return step;
    }

    const completedStep = this.repository.saveStep({
      ...step,
      status: 'succeeded',
      completedAt,
    });
    modelStepsById.set(stepId, completedStep);
    return completedStep;
  }
}

function defaultHostBoundary(
  clock: SessionRunServiceClock,
  ids: SessionRunServiceIds,
): RunHostBoundaryPort {
  return {
    handleAction: (action) => ({
      observationId: ids.observationId(),
      runId: action.runId,
      stepId: action.stepId,
      actionId: action.actionId,
      source: 'runtime',
      kind: 'message_emitted',
      receivedAt: clock.now(),
      summary: 'Session run run completed without tool execution.',
    }),
  };
}

function sessionMessageSourceRef(messageId: string, builtAt: string): ModelInputContextSourceRef {
  return {
    sourceKind: 'session_message',
    sourceId: messageId,
    sourceUri: `session-message://${messageId}`,
    loadedAt: builtAt,
  };
}

function sessionRunSourceRef(runId: string, builtAt: string): ModelInputContextSourceRef {
  return {
    sourceKind: 'session_run',
    sourceId: runId,
    sourceUri: `session-run://${runId}`,
    loadedAt: builtAt,
  };
}

function branchMarkerSourceRef(branchMarkerId: string, builtAt: string): ModelInputContextSourceRef {
  return {
    sourceKind: 'branch_marker',
    sourceId: branchMarkerId,
    sourceUri: `branch-marker://${branchMarkerId}`,
    loadedAt: builtAt,
  };
}

function retryAttemptSourceRef(retryAttemptId: string, builtAt: string): ModelInputContextSourceRef {
  return {
    sourceKind: 'retry_attempt',
    sourceId: retryAttemptId,
    sourceUri: `retry-attempt://${retryAttemptId}`,
    loadedAt: builtAt,
  };
}

function formatBranchDraftTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return 'Branch from message';
  }
  return `Branch from ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function manualRetryReasonForRunStatus(status: Run['status']): SessionRetryAttempt['reason'] {
  if (status === 'cancelled') {
    return 'cancelled';
  }
  if (status === 'running' || status === 'queued' || status === 'cancelling') {
    return 'interrupted';
  }
  return 'failed';
}

type SessionMessageSendHistoryMessage = NonNullable<SessionMessageSendPayload['messages']>[number];
type SessionMessageSendCurrentMessage = NonNullable<SessionMessageSendPayload['message']>;

function currentUserChatMessage(payload: SessionMessageSendPayload): SessionMessageSendCurrentMessage | undefined {
  if (payload.message) {
    return payload.message;
  }

  const lastUserMessage = findLastUserChatMessage(payload.messages ?? []);
  return lastUserMessage
    ? {
        id: lastUserMessage.id,
        content: lastUserMessage.content,
        createdAt: lastUserMessage.createdAt,
      }
    : undefined;
}

function findLastUserChatMessage(
  messages: SessionMessageSendHistoryMessage[],
): SessionMessageSendHistoryMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'user') {
      return message;
    }
  }
  return undefined;
}

function getAssistantCompletedContent(payload: RuntimeEvent['payload']): string {
  if (!isObjectRecord(payload)) {
    return '';
  }

  return typeof payload.content === 'string' ? payload.content : '';
}

function getAssistantDeltaContent(payload: RuntimeEvent['payload']): string {
  if (!isObjectRecord(payload)) {
    return '';
  }

  return typeof payload.delta === 'string' ? payload.delta : '';
}

function isToolCallModelStepCompletion(payload: RuntimeEvent['payload']): boolean {
  if (!isObjectRecord(payload)) {
    return false;
  }

  return payload.finishReason === 'tool_calls';
}

function isRunTerminalRuntimeEvent(event: RuntimeEvent): boolean {
  return event.eventType === 'run.completed'
    || event.eventType === 'run.failed'
    || event.eventType === 'run.cancelled';
}

function getRunFailedError(payload: RuntimeEvent['payload']): RuntimeError | undefined {
  if (!isObjectRecord(payload)) {
    return undefined;
  }

  return isRuntimeError(payload.error) ? payload.error : undefined;
}

function getModelStepId(payload: RuntimeEvent['payload']): string | undefined {
  if (!isObjectRecord(payload)) {
    return undefined;
  }

  return typeof payload.modelStepId === 'string' ? payload.modelStepId : undefined;
}

function getToolResultEventId(payload: RuntimeEvent['payload']): string | undefined {
  if (!isObjectRecord(payload)) {
    return undefined;
  }

  return typeof payload.toolResultId === 'string' ? payload.toolResultId : undefined;
}

function createFallbackRuntimeError(message: string): RuntimeError {
  return {
    code: 'runtime_unknown',
    message,
    severity: 'error',
    retryable: false,
    source: 'core',
  };
}

function modelStepInputBuildFailureToRuntimeError(failure: BuildModelStepInputFailure): RuntimeError {
  return {
    code: 'context_budget_exceeded',
    message: failure.message,
    severity: 'error',
    retryable: failure.retryable,
    source: 'main',
  };
}

function createRuntimeErrorFromUnknown(error: unknown): RuntimeError {
  if (isRuntimeError(error)) {
    return error;
  }

  return {
    code: 'runtime_unknown',
    message: error instanceof Error && error.message
      ? error.message
      : 'Session message run failed.',
    severity: 'error',
    retryable: false,
    source: 'core',
  };
}

function isRuntimeError(value: unknown): value is RuntimeError {
  return isObjectRecord(value)
    && typeof value.code === 'string'
    && typeof value.message === 'string'
    && typeof value.severity === 'string'
    && typeof value.retryable === 'boolean'
    && typeof value.source === 'string';
}

function withRequestMetadata(event: RuntimeEvent, request: ModelStepRuntimeRequest): RuntimeEvent {
  return {
    ...event,
    requestId: event.requestId ?? request.requestId,
    ...(event.context ? { context: event.context } : request.runtimeContext ? { context: request.runtimeContext } : {}),
  };
}

function withSessionMessageRequestMetadata(
  event: RuntimeEvent,
  input: {
    requestId: string;
    runtimeContext?: RuntimeContext;
  },
): RuntimeEvent {
  return {
    ...event,
    requestId: event.requestId ?? input.requestId,
    ...(event.context ? { context: event.context } : input.runtimeContext ? { context: input.runtimeContext } : {}),
  };
}

function withSequenceAfter(event: RuntimeEvent, lastSequence: number): RuntimeEvent {
  if (event.sequence > lastSequence) {
    return event;
  }

  return {
    ...event,
    sequence: lastSequence + 1,
  };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isSourceOfTruthMemoryPath(projectPath: string): boolean {
  const normalized = projectPath.replace(/\\/g, '/').toLowerCase();
  return normalized === 'agents.md'
    || normalized === 'readme.md'
    || normalized.startsWith('.local-docs/specs/')
    || normalized.startsWith('.local-docs/architecture/')
    || normalized.startsWith('.local-docs/decisions/');
}

function clipMemoryRuntimeSummary(value: string, maxLength = 240): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

function toModelVisiblePermissionSnapshot(
  input: PermissionSnapshotRecord,
  requestCreatedAt: string,
): PermissionModeSnapshot {
  return {
    permissionMode: isPermissionMode(input.permissionModeState.permissionMode)
      ? input.permissionModeState.permissionMode
      : 'default',
    source: input.permissionModeState.source ?? 'system',
    createdAt: input.createdAt ?? requestCreatedAt,
  };
}

function getRunStartPermissionModeState(payload: RunStartPayload): PermissionModeState | undefined {
  return payload.permissionModeState;
}

function createPermissionModeState(
  permissionMode: PermissionMode,
  source: PermissionModeSelectionSource,
): PermissionModeState {
  return {
    permissionMode,
    source,
  };
}

function nextRuntimeSequence(events: RuntimeEvent[]): number {
  return events.reduce((max, event) => Math.max(max, event.sequence), 0);
}

const TEXT_DELTA_FLUSH_DELAY_MS = 50;
const TEXT_DELTA_MAX_CHARS = 512;

async function* coalesceTextDeltaRuntimeEvents(
  events: AsyncIterable<RuntimeEvent>,
  options: {
    flushDelayMs?: number;
    maxChars?: number;
  } = {},
): AsyncIterable<RuntimeEvent> {
  const flushDelayMs = options.flushDelayMs ?? TEXT_DELTA_FLUSH_DELAY_MS;
  const maxChars = options.maxChars ?? TEXT_DELTA_MAX_CHARS;
  const iterator = events[Symbol.asyncIterator]();
  let pendingNext = iterator.next();
  let bufferedEvent: RuntimeEvent | null = null;
  let bufferedDelta = '';
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let flushPromise: Promise<'flush'> | null = null;

  const clearFlushTimer = () => {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    flushPromise = null;
  };

  const startFlushTimer = () => {
    if (flushPromise) {
      return;
    }
    flushPromise = new Promise((resolve) => {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        flushPromise = null;
        resolve('flush');
      }, flushDelayMs);
    });
  };

  const flush = (): RuntimeEvent | null => {
    if (!bufferedEvent) {
      return null;
    }
    const event = withTextDelta(bufferedEvent, bufferedDelta);
    bufferedEvent = null;
    bufferedDelta = '';
    clearFlushTimer();
    return event;
  };

  const buffer = (event: RuntimeEvent) => {
    bufferedEvent = event;
    bufferedDelta = getAssistantDeltaContent(event.payload);
    startFlushTimer();
  };

  while (true) {
    if (!bufferedEvent) {
      const result = await pendingNext;
      pendingNext = iterator.next();

      if (result.done) {
        return;
      }

      if (isTextDeltaRuntimeEvent(result.value)) {
        buffer(result.value);
        if (bufferedDelta.length >= maxChars) {
          const event = flush();
          if (event) {
            yield event;
          }
        }
      } else {
        yield result.value;
      }
      continue;
    }

    const result = await Promise.race([
      pendingNext.then((next) => ({ kind: 'next' as const, next })),
      (flushPromise ?? Promise.resolve('flush')).then(() => ({ kind: 'flush' as const })),
    ]);

    if (result.kind === 'flush') {
      const event = flush();
      if (event) {
        yield event;
      }
      continue;
    }

    pendingNext = iterator.next();

    if (result.next.done) {
      const event = flush();
      if (event) {
        yield event;
      }
      return;
    }

    if (canMergeTextDelta(bufferedEvent, result.next.value)) {
      bufferedDelta += getAssistantDeltaContent(result.next.value.payload);
      if (bufferedDelta.length >= maxChars) {
        const event = flush();
        if (event) {
          yield event;
        }
      }
      continue;
    }

    const event = flush();
    if (event) {
      yield event;
    }

    if (isTextDeltaRuntimeEvent(result.next.value)) {
      buffer(result.next.value);
    } else {
      yield result.next.value;
    }
  }
}

function isTextDeltaRuntimeEvent(event: RuntimeEvent): boolean {
  return event.eventType === 'assistant.output.delta' || event.eventType === 'model.output.delta';
}

function canMergeTextDelta(left: RuntimeEvent, right: RuntimeEvent): boolean {
  if (!isTextDeltaRuntimeEvent(left) || !isTextDeltaRuntimeEvent(right) || left.eventType !== right.eventType) {
    return false;
  }

  if (left.eventType === 'model.output.delta') {
    const leftModelStepId = (left.payload as { modelStepId?: unknown }).modelStepId;
    const rightModelStepId = (right.payload as { modelStepId?: unknown }).modelStepId;
    return leftModelStepId === rightModelStepId;
  }

  return true;
}

function withTextDelta(event: RuntimeEvent, delta: string): RuntimeEvent {
  return {
    ...event,
    payload: {
      ...(event.payload as Record<string, unknown>),
      delta,
    },
  };
}

function resolveRecallEffectiveCwd(projectRoot: string | undefined, requestedCwd: string | undefined): string | undefined {
  if (!requestedCwd) {
    return projectRoot;
  }
  if (path.isAbsolute(requestedCwd)) {
    return requestedCwd;
  }
  return projectRoot ? path.join(projectRoot, requestedCwd) : requestedCwd;
}

function createToolResultSummary(toolResult: ToolResult): string {
  if (toolResult.textContent && toolResult.textContent.length > 0) {
    return toolResult.textContent;
  }

  if (toolResult.denialReason && toolResult.denialReason.length > 0) {
    return toolResult.denialReason;
  }

  if (toolResult.error) {
    return toolResult.error.message;
  }

  if (toolResult.structuredContent !== undefined) {
    return JSON.stringify(toolResult.structuredContent);
  }

  return toolResult.kind;
}

export interface CreateDefaultSessionRunServiceOptions {
  contextService?: SessionRunContextService;
  toolRuntimeFactory?: SessionRunToolRuntimeFactory;
  agentInstructionSourceService?: SessionRunAgentInstructionSourceService;
}

export function createDefaultSessionRunService(
  homePaths: MegumiHomePaths,
  options: CreateDefaultSessionRunServiceOptions = {},
): SessionRunService {
  const database = createDatabase(path.join(homePaths.sqlitePath, 'megumi.sqlite3'));
  migrateDatabase(database);
  const permissionSnapshotRepository = new PermissionSnapshotRepository(database);
  const activePathRepository = new SessionActivePathRepository(database);
  const toolRepository = new ToolRepository(database);

  const service = new SessionRunService({
    repository: new SessionRunRepository(database),
    activePathRepository,
    toolRepository,
    toolRegistrySnapshotService: new ToolRegistrySnapshotService(toolRepository),
    permissionSnapshotService: new PermissionSnapshotService({ repository: permissionSnapshotRepository }),
    ...(options.contextService ? { contextService: options.contextService } : {}),
    ...(options.toolRuntimeFactory ? { toolRuntimeFactory: options.toolRuntimeFactory } : {}),
    agentInstructionSourceService: options.agentInstructionSourceService ?? new AgentInstructionSourceService(),
    megumiHomePath: homePaths.homePath,
    globalInstructionDirectoryProvider: {
      listGlobalInstructionDirs: () => [homePaths.homePath],
    },
  });
  service.cleanupInterruptedRunsOnStartup();
  return service;
}
