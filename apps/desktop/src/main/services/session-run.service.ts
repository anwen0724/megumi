import path from 'node:path';
import {
  buildModelStepInputContextFromSources,
  createModelStepInputContextId,
} from '@megumi/context-management/model-step-input-context';
import { runTurn } from '@megumi/core/run-runtime/run-turn';
import type { RunHostBoundaryPort, RunIdFactory } from '@megumi/core/run-runtime/types';
import {
  runModelToolLoop,
  type PendingToolApprovalContinuation,
  type ToolApprovalResumeInput,
  type ToolApprovalResumeOutcome,
  type ToolApprovalResumePort,
  type ToolCallHandlerPort,
} from '@megumi/core/run-runtime/tool-loop';
import {
  createRunCompletedEvent,
  createRunFailedEvent,
  createRunStartedEvent,
  createRunStatusChangedEvent,
  createStepCompletedEvent,
  createStepFailedEvent,
  createStepStatusChangedEvent,
} from '@megumi/core/run-runtime/events';
import { createDatabase } from '@megumi/db/connection';
import { SessionRunRepository } from '@megumi/db/repos/session-run.repo';
import { SessionActivePathRepository } from '@megumi/db/repos/session-active-path.repo';
import { RunModeRepository } from '@megumi/db/repos/run-mode.repo';
import { migrateDatabase } from '@megumi/db/schema/migrations';
import type { ContextBudgetPolicy } from '@megumi/shared/context-budget-contracts';
import type { ModelStepRuntimeConstraintInput } from '@megumi/context-management/model-step-input-context';
import type {
  RunContext,
  ModelCapabilitySummary,
} from '@megumi/shared/run-context-contracts';
import type {
  AgentInstructionSourceSnapshot,
  ModelInputContextSourceRef,
} from '@megumi/shared/model-input-context-contracts';
import type { SessionContextInput } from '@megumi/shared/session-context-contracts';
import type { Run, RunStep, Session, SessionMessage } from '@megumi/shared/session-run-contracts';
import type { SessionActivePath, SessionBranchMarker, SessionSourceEntry } from '@megumi/shared/session-active-path-contracts';
import {
  isPermissionMode,
  type PermissionMode,
  type PermissionModeSnapshot,
} from '@megumi/shared/permission-mode-contracts';
import type { JsonObject } from '@megumi/shared/json';
import type {
  RunStartPayload,
  PlanStatusUpdatePayload,
  SessionCreatePayload,
  SessionMessageCancelPayload,
  SessionMessageSendData,
  SessionMessageSendPayload,
  SessionTimelineListData,
  SessionTimelineListPayload,
} from '@megumi/shared/ipc-schemas';
import { createChatStreamEvent } from '@megumi/shared/chat-stream-event-factory';
import type { TimelineMessage } from '@megumi/shared/timeline-message-blocks';
import type { ModelStepRuntimeRequest } from '@megumi/shared/model-step-contracts';
import type { ImplementationPlanArtifactRecord, RunMode, RunModeSnapshot } from '@megumi/shared/run-mode-contracts';
import type { RuntimeContext } from '@megumi/shared/runtime-context';
import type { RuntimeError } from '@megumi/shared/runtime-errors';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';
import {
  createRuntimeEvent,
  createSessionActiveLeafChangedEvent,
  createSessionBranchDraftCancelledEvent,
  createSessionBranchMarkerCreatedEvent,
  createToolResultCreatedEvent,
  createWorkspaceChangesDetectedBeforeRetryEvent,
} from '@megumi/shared/runtime-event-factory';
import type { SessionRetryAttempt } from '@megumi/shared/session-active-path-contracts';
import type { ToolDefinition, ToolResult } from '@megumi/shared/tool-contracts';
import type { WorkspaceChangedFile } from '@megumi/shared/workspace-change-contracts';
import { RunModeService } from './run-mode.service';
import type { MegumiHomePaths } from './megumi-home.service';
import {
  createChatStreamEventAdapter,
  type ChatStreamEventAdapter,
  type ChatStreamEventSink,
} from './chat-stream-event-adapter.service';
import {
  AgentInstructionSourceService,
  type LoadInstructionSourcesInput,
} from './agent-instruction-source.service';
import {
  SessionContextInputService,
  type BuildSessionContextInputFromRepositoryInput,
} from './session-context-input.service';
import {
  SessionCompactionOrchestrator,
  type CompactIfNeededInput,
  type SessionCompactionOrchestrationResult,
} from './session-compaction-orchestrator.service';
import {
  classifyAutomaticModelStepRetry,
  createAutomaticRetryBackoffMs,
} from './session-retry-policy.service';
import {
  createWorkspaceChangeFooterProjectorService,
  isWorkspaceChangeFooterProjectorPort,
  type WorkspaceChangeFooterProjectorService,
} from './workspace-change-footer-projector.service';

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

export interface SessionRunAgentInstructionSourceService {
  loadInstructionSources(input: LoadInstructionSourcesInput): Promise<AgentInstructionSourceSnapshot[]>;
}

export interface SessionRunSessionContextInputService {
  buildSessionContextInput(input: BuildSessionContextInputFromRepositoryInput): SessionContextInput;
}

export interface SessionRunAutomaticRetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  sleep?: (input: { delayMs: number; attemptNumber: number; runId: string }) => Promise<void>;
}

export interface SessionRunWorkspaceChangeReadPort {
  listChangedFilesByRun(runId: string): WorkspaceChangedFile[];
}

interface ApprovalContinuationGroup {
  groupId: string;
  request: ModelStepRuntimeRequest;
  run: Run;
  step: RunStep;
  projectRoot?: string;
  userMessageId: string;
  pendingByApprovalId: Map<string, PendingToolApprovalContinuation>;
  resolvedResults: ToolResult[];
  toolRuntime: ToolCallHandlerPort & ToolApprovalResumePort;
  chatStreamAdapter?: ChatStreamEventAdapter;
}

export interface SessionRunServiceOptions {
  repository: SessionRunRepository;
  contextService?: SessionRunContextService;
  runModeService?: Pick<
    RunModeService,
    | 'createModeSnapshot'
    | 'linkAcceptedSourcePlan'
    | 'createPlanRecordForRun'
    | 'getPlanByRun'
    | 'updatePlanStatus'
  >;
  modelStepProvider?: SessionRunModelStepProvider;
  toolRuntimeFactory?: SessionRunToolRuntimeFactory;
  toolDefinitionProvider?: SessionRunToolDefinitionProvider;
  agentInstructionSourceService?: SessionRunAgentInstructionSourceService;
  sessionContextInputService?: SessionRunSessionContextInputService;
  sessionCompactionOrchestrator?: {
    compactIfNeeded(input: CompactIfNeededInput): Promise<SessionCompactionOrchestrationResult>;
  };
  activePathRepository?: SessionActivePathRepository;
  automaticRetry?: Partial<SessionRunAutomaticRetryOptions>;
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

const DEFAULT_AUTOMATIC_RETRY: SessionRunAutomaticRetryOptions = {
  maxAttempts: 3,
  baseDelayMs: 2000,
  maxDelayMs: 8000,
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
  private readonly runModeService?: Pick<
    RunModeService,
    | 'createModeSnapshot'
    | 'linkAcceptedSourcePlan'
    | 'createPlanRecordForRun'
    | 'getPlanByRun'
    | 'updatePlanStatus'
  >;
  private readonly modelStepProvider?: SessionRunModelStepProvider;
  private readonly toolRuntimeFactory?: SessionRunToolRuntimeFactory;
  private readonly toolDefinitionProvider?: SessionRunToolDefinitionProvider;
  private readonly agentInstructionSourceService?: SessionRunAgentInstructionSourceService;
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
  private readonly automaticRetry: SessionRunAutomaticRetryOptions;
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
    this.runModeService = options.runModeService;
    this.modelStepProvider = options.modelStepProvider;
    this.toolRuntimeFactory = options.toolRuntimeFactory;
    this.toolDefinitionProvider = options.toolDefinitionProvider;
    this.agentInstructionSourceService = options.agentInstructionSourceService;
    this.sessionContextInputService = options.sessionContextInputService
      ?? new SessionContextInputService({
        repository: this.repository,
        activePathRepository: this.activePathRepository ?? new EmptySessionActivePathRepository(),
    });
    this.chatStreamEventSink = options.chatStreamEventSink;
    this.timelineMessageRepository = options.timelineMessageRepository;
    this.workspaceChangeFooterProjector = isWorkspaceChangeFooterProjectorPort(options.workspaceChanges)
      ? createWorkspaceChangeFooterProjectorService({ workspaceChanges: options.workspaceChanges })
      : undefined;
    this.clock = options.clock ?? defaultClock;
    this.ids = { ...createDefaultIds(), ...options.ids };
    this.automaticRetry = {
      ...DEFAULT_AUTOMATIC_RETRY,
      ...(options.automaticRetry ?? {}),
    };
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

  createSession(payload: SessionCreatePayload): Session {
    return this.repository.saveSession({
      sessionId: this.ids.sessionId(),
      title: payload.title,
      ...(payload.workspaceId ? { workspaceId: payload.workspaceId } : {}),
      ...(payload.workspacePath ? { workspacePath: payload.workspacePath } : {}),
      status: 'active',
      createdAt: payload.createdAt,
      updatedAt: payload.createdAt,
    });
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
    const modeSnapshot = this.runModeService?.createModeSnapshot({
      runId,
      mode: payload.mode,
      modeSnapshot: payload.modeSnapshot,
      createdAt: payload.createdAt,
    });

    if (payload.sourcePlanId && this.runModeService) {
      this.runModeService.linkAcceptedSourcePlan({
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
      mode: payload.mode,
      ...(modeSnapshot ? {
        modeSnapshot: modeSnapshot.mode,
        modeSnapshotRef: modeSnapshot.modeSnapshotId,
      } : payload.modeSnapshot ? { modeSnapshot: payload.modeSnapshot } : {}),
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

    if (modeSnapshot && this.runModeService && result.run.status === 'completed') {
      this.runModeService.createPlanRecordForRun({
        runId,
        goal: payload.goal,
        mode: modeSnapshot.mode,
        createdAt: result.run.completedAt ?? payload.createdAt,
      });
    }

    return { run: result.run, events: result.events };
  }

  getPlanByRun(runId: string): ImplementationPlanArtifactRecord | undefined {
    return this.requireRunModeService().getPlanByRun(runId);
  }

  updatePlanStatus(input: PlanStatusUpdatePayload): ImplementationPlanArtifactRecord {
    return this.requireRunModeService().updatePlanStatus(input);
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
    const permissionMode = input.payload.context?.permissionMode ?? 'default';
    const mode = permissionMode;

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
    const modeSnapshot = this.runModeService?.createModeSnapshot({
      runId,
      mode,
      modeSnapshot: createPermissionModeRunMode(permissionMode),
      createdAt,
    });
    const run = modeSnapshot
      ? this.repository.saveRun({
          ...initialRun,
          modeSnapshotRef: modeSnapshot.modeSnapshotId,
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
        ...(modeSnapshot ? { modeSnapshot } : {}),
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
    if (!persistedRun || ['completed', 'failed', 'cancelled'].includes(persistedRun.status)) {
      this.activeSessionMessageRuns.delete(payload.targetRequestId);
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

    this.repository.saveRun({
      ...persistedRun,
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
      sequence: lastSequence + 1,
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
      sequence: lastSequence + 2,
      createdAt: cancelledAt,
      from: persistedRun.status,
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

    return this.resumeApprovalContinuation(continuation, input);
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
      this.activeSessionMessageRuns.delete(requestId);
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
    modeSnapshot?: RunModeSnapshot;
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

    const context = this.createInitialContextForSessionMessage({
      runId: String(input.run.runId),
      goal: input.userMessage.content,
      session: input.session,
    });
    const budgetPolicy = context?.contextBudgetPolicy ?? DEFAULT_CONTEXT_BUDGET_POLICY;
    const toolDefinitions = input.session.workspacePath && this.toolDefinitionProvider
      ? this.toolDefinitionProvider.listDefinitions({
          runId: String(input.run.runId),
          permissionMode: input.permissionMode,
          providerCapabilitySummary: { supportsToolCall: true },
        })
      : undefined;
    const sessionContext = this.sessionContextInputService.buildSessionContextInput({
      sessionId: String(input.session.sessionId),
      currentRunId: String(input.run.runId),
      currentMessageId: String(input.userMessage.messageId),
      builtAt: input.payload.createdAt,
    });
    const instructionSources = await this.loadInstructionSourcesForModelStep({
      ...(input.session.workspacePath ? { projectRoot: input.session.workspacePath } : {}),
      loadedAt: input.payload.createdAt,
    });
    const preflightInputContext = buildModelStepInputContextFromSources({
      contextId: createModelStepInputContextId({
        stepId: String(input.step.stepId),
        contextKind: 'preflight',
      }),
      sessionId: String(input.session.sessionId),
      runId: String(input.run.runId),
      stepId: String(input.step.stepId),
      buildReason: 'initial_model_step_preflight',
      builtAt: input.payload.createdAt,
      currentMessage: input.userMessage,
      sessionContext,
      instructionSources,
      ...(context ? {
        runtimeConstraints: runtimeConstraintsFromRunContext(context, input.payload.createdAt),
      } : {}),
      budgetPolicy: {
        modelContextWindow: Number.MAX_SAFE_INTEGER,
        reservedOutputTokens: 0,
        keepRecentTokens: Number.MAX_SAFE_INTEGER,
      },
      ...(input.modeSnapshot ? {
        modeSnapshot: toPermissionModeSnapshot(input.modeSnapshot, input.payload.createdAt),
        modeSnapshotRef: input.modeSnapshot.modeSnapshotId,
      } : {}),
    });
    const compactionPromise = this.sessionCompactionOrchestrator
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
          preflightInputContext,
          budgetPolicy,
          startSequence: lastSequence,
        })
      : Promise.resolve({ status: 'skipped' as const, events: [] });

    yield runStarted;
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
    const inputContext = buildModelStepInputContextFromSources({
      contextId: createModelStepInputContextId({
        stepId: String(input.step.stepId),
        contextKind: 'initial',
      }),
      sessionId: String(input.session.sessionId),
      runId: String(input.run.runId),
      stepId: String(input.step.stepId),
      buildReason: 'initial_model_step',
      builtAt: input.payload.createdAt,
      currentMessage: input.userMessage,
      sessionContext: finalSessionContext,
      instructionSources,
      ...(context ? {
        runtimeConstraints: runtimeConstraintsFromRunContext(context, input.payload.createdAt),
      } : {}),
      budgetPolicy,
      ...(input.modeSnapshot ? {
        modeSnapshot: toPermissionModeSnapshot(input.modeSnapshot, input.payload.createdAt),
        modeSnapshotRef: input.modeSnapshot.modeSnapshotId,
      } : {}),
    });
    const request: ModelStepRuntimeRequest = {
      requestId: input.requestId,
      sessionId: input.session.sessionId,
      runId: input.run.runId,
      stepId: input.step.stepId,
      providerId: input.payload.providerId,
      modelId: input.payload.modelId,
      inputContext,
      ...(toolDefinitions && toolDefinitions.length > 0 ? { toolDefinitions } : {}),
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
      ...(input.session.workspacePath ? { projectRoot: input.session.workspacePath } : {}),
      ...(toolRuntime ? { toolRuntime } : {}),
      ...(input.chatStreamAdapter ? { chatStreamAdapter: input.chatStreamAdapter } : {}),
      startSequence: lastSequence,
      emitRunStarted: false,
    });
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
    projectRoot?: string;
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

      const waitingRun = this.repository.saveRun({
        ...input.run,
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
        ...(input.projectRoot ? { projectRoot: input.projectRoot } : {}),
        userMessageId: input.userMessageId,
        pendingByApprovalId: new Map(pendingContinuations.map((pending) => [
          pending.pendingApproval.approvalRequest.approvalRequestId,
          pending,
        ])),
        resolvedResults: [],
        toolRuntime,
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
      this.streamModelStepWithAutomaticRetry({
        request,
        run: input.run,
        stream: (nextRequest) => modelStepProvider.streamModelStep(nextRequest),
      });
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
          buildContinuationInputContext: async (contextInput) => buildModelStepInputContextFromSources({
            ...contextInput,
            instructionSources: await this.loadInstructionSourcesForModelStep({
              ...(input.projectRoot ? { projectRoot: input.projectRoot } : {}),
              loadedAt: contextInput.builtAt,
            }),
          }),
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
      yield eventWithRequest;
    }
  }

  private streamModelStepWithAutomaticRetry(input: {
    request: ModelStepRuntimeRequest;
    run: Run;
    stream: (request: ModelStepRuntimeRequest) => AsyncIterable<RuntimeEvent>;
  }): AsyncIterable<RuntimeEvent> {
    return this.doStreamModelStepWithAutomaticRetry(input);
  }

  private async *doStreamModelStepWithAutomaticRetry(input: {
    request: ModelStepRuntimeRequest;
    run: Run;
    stream: (request: ModelStepRuntimeRequest) => AsyncIterable<RuntimeEvent>;
  }): AsyncIterable<RuntimeEvent> {
    let retryAttemptNumber = 0;
    let currentAttempt: SessionRetryAttempt | undefined;

    while (true) {
      const bufferedEvents: RuntimeEvent[] = currentAttempt ? [] : [];
      let retryableFailureEvent: RuntimeEvent | undefined;
      let retryableFailureError: RuntimeError | undefined;
      let shouldRetry = false;
      let terminalAttemptStatus: SessionRetryAttempt['status'] = 'exhausted';

      try {
        for await (const event of input.stream(input.request)) {
          if (event.eventType === 'run.failed') {
            const error = getRunFailedError(event.payload);
            const decision = error ? classifyAutomaticModelStepRetry(error) : { retryable: false };
            if (error && decision.retryable) {
              retryableFailureEvent = event;
              retryableFailureError = error;
              shouldRetry = retryAttemptNumber < this.automaticRetry.maxAttempts;
              break;
            }
            if (error && currentAttempt) {
              retryableFailureEvent = event;
              retryableFailureError = error;
              terminalAttemptStatus = 'failed';
              break;
            }
          }

          if (currentAttempt) {
            bufferedEvents.push(event);
          } else {
            yield event;
          }
        }
      } catch (error) {
        const runtimeError = createModelStepRuntimeErrorFromUnknown(error);
        const decision = classifyAutomaticModelStepRetry(runtimeError);
        if (!decision.retryable) {
          if (currentAttempt) {
            this.saveRetryAttemptUpdate(currentAttempt, 'failed', {
              completedAt: this.clock.now(),
              error: runtimeError,
            });
          }
          throw runtimeError;
        }
        retryableFailureError = runtimeError;
        shouldRetry = retryAttemptNumber < this.automaticRetry.maxAttempts;
        if (!shouldRetry) {
          if (currentAttempt) {
            this.saveRetryAttemptUpdate(currentAttempt, 'exhausted', {
              completedAt: this.clock.now(),
              error: runtimeError,
            });
          }
          throw runtimeError;
        }
      }

      if (!retryableFailureError) {
        if (currentAttempt) {
          const completedAt = this.clock.now();
          this.saveRetryAttemptUpdate(currentAttempt, 'succeeded', { completedAt });
          for (const event of bufferedEvents) {
            yield event;
          }
          yield this.createRetryAuditEvent({
            request: input.request,
            eventType: 'retry.completed',
            retryAttemptId: currentAttempt.retryAttemptId,
            createdAt: completedAt,
          });
        }
        return;
      }

      if (!shouldRetry) {
        if (currentAttempt) {
          this.saveRetryAttemptUpdate(currentAttempt, terminalAttemptStatus, {
            completedAt: this.clock.now(),
            error: retryableFailureError,
          });
        }
        if (retryableFailureEvent) {
          for (const event of bufferedEvents) {
            yield event;
          }
          yield retryableFailureEvent;
          return;
        }
        throw retryableFailureError;
      }

      const retryBlockingChanges = this.getRetryBlockingWorkspaceChanges(input.request.runId);
      if (retryBlockingChanges.length > 0) {
        if (currentAttempt) {
          this.saveRetryAttemptUpdate(currentAttempt, 'failed', {
            completedAt: this.clock.now(),
            error: retryableFailureError,
          });
        }
        yield this.createWorkspaceChangesDetectedBeforeRetryEvent({
          request: input.request,
          changedFiles: retryBlockingChanges,
          createdAt: this.clock.now(),
        });
        if (retryableFailureEvent) {
          for (const event of bufferedEvents) {
            yield event;
          }
          yield retryableFailureEvent;
          return;
        }
        throw retryableFailureError;
      }

      if (currentAttempt) {
        this.saveRetryAttemptUpdate(currentAttempt, 'failed', {
          completedAt: this.clock.now(),
          error: retryableFailureError,
        });
      }

      retryAttemptNumber += 1;
      currentAttempt = this.createRunningAutomaticRetryAttempt({
        request: input.request,
        run: input.run,
        attemptNumber: retryAttemptNumber,
        error: retryableFailureError,
      });
      yield this.createRetryAuditEvent({
        request: input.request,
        eventType: 'retry.started',
        retryAttemptId: currentAttempt.retryAttemptId,
        createdAt: currentAttempt.createdAt,
      });

      if (this.repository.getRun(input.request.runId)?.status === 'cancelled') {
        this.saveRetryAttemptUpdate(currentAttempt, 'cancelled', {
          completedAt: this.clock.now(),
        });
        return;
      }

      const delayMs = createAutomaticRetryBackoffMs({
        attemptNumber: retryAttemptNumber,
        baseDelayMs: this.automaticRetry.baseDelayMs,
        maxDelayMs: this.automaticRetry.maxDelayMs,
      });
      await (this.automaticRetry.sleep ?? sleepRetryBackoff)({
        delayMs,
        attemptNumber: retryAttemptNumber,
        runId: input.request.runId,
      });

      if (this.repository.getRun(input.request.runId)?.status === 'cancelled') {
        this.saveRetryAttemptUpdate(currentAttempt, 'cancelled', {
          completedAt: this.clock.now(),
        });
        return;
      }
    }
  }

  private getRetryBlockingWorkspaceChanges(runId: string): WorkspaceChangedFile[] {
    return (this.workspaceChanges?.listChangedFilesByRun(runId) ?? [])
      .filter((changedFile) => (
        changedFile.restoreState === 'restorable'
        || changedFile.restoreState === 'conflict'
        || changedFile.restoreState === 'restore_failed'
      ));
  }

  private createRunningAutomaticRetryAttempt(input: {
    request: ModelStepRuntimeRequest;
    run: Run;
    attemptNumber: number;
    error: RuntimeError;
  }): SessionRetryAttempt {
    const decision = classifyAutomaticModelStepRetry(input.error);
    return this.requireActivePathRepository().saveRetryAttempt({
      retryAttemptId: this.ids.retryAttemptId(),
      sessionId: input.request.sessionId,
      runId: input.request.runId,
      baseRunId: input.run.runId,
      attemptNumber: input.attemptNumber,
      retryKind: 'automatic_model_step',
      reason: decision.reason ?? 'runtime_provider_error',
      status: 'running',
      retryable: true,
      createdAt: this.clock.now(),
      metadata: {
        requestId: input.request.requestId,
        providerId: input.request.providerId,
        modelId: input.request.modelId,
      },
    });
  }

  private saveRetryAttemptUpdate(
    attempt: SessionRetryAttempt,
    status: SessionRetryAttempt['status'],
    updates: Pick<SessionRetryAttempt, 'completedAt'> & Partial<Pick<SessionRetryAttempt, 'error'>>,
  ): SessionRetryAttempt {
    return this.requireActivePathRepository().saveRetryAttempt({
      ...attempt,
      status,
      completedAt: updates.completedAt,
      ...(updates.error ? { error: updates.error } : {}),
    });
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

  private createRetryAuditEvent(input: {
    request: ModelStepRuntimeRequest;
    eventType: 'retry.started' | 'retry.completed';
    retryAttemptId: string;
    createdAt: string;
  }): RuntimeEvent {
    return createRuntimeEvent({
      eventId: this.ids.eventId(),
      eventType: input.eventType,
      sessionId: input.request.sessionId,
      runId: input.request.runId,
      stepId: input.request.stepId,
      requestId: input.request.requestId,
      sequence: 0,
      createdAt: input.createdAt,
      source: 'main',
      visibility: 'system',
      persist: 'required',
      payload: {
        retryRequestId: input.retryAttemptId,
        retryKind: 'automatic_model_step',
      },
    });
  }

  private createWorkspaceChangesDetectedBeforeRetryEvent(input: {
    request: ModelStepRuntimeRequest;
    changedFiles: WorkspaceChangedFile[];
    createdAt: string;
  }): RuntimeEvent {
    const changeSetIds = [...new Set(input.changedFiles.map((changedFile) => changedFile.changeSetId))];

    return createWorkspaceChangesDetectedBeforeRetryEvent({
      eventId: this.ids.eventId(),
      sessionId: input.request.sessionId,
      runId: input.request.runId,
      stepId: input.request.stepId,
      requestId: input.request.requestId,
      sequence: 0,
      createdAt: input.createdAt,
      source: 'main',
      payload: {
        runId: input.request.runId,
        changedFileCount: input.changedFiles.length,
        restorableCount: input.changedFiles.filter((changedFile) => changedFile.restoreState === 'restorable').length,
        changeSetIds,
      },
    });
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
        runId: event.runId,
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

  private async loadInstructionSourcesForModelStep(input: {
    projectRoot?: string;
    loadedAt: string;
  }): Promise<AgentInstructionSourceSnapshot[]> {
    if (!this.agentInstructionSourceService) {
      return [];
    }

    return this.agentInstructionSourceService.loadInstructionSources(input);
  }

  private requireRunModeService(): NonNullable<SessionRunServiceOptions['runModeService']> {
    if (!this.runModeService) {
      throw new Error('Run mode service is not configured.');
    }

    return this.runModeService;
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
    const { toolResult } = resumeOutcome;
    const chatStreamAdapter = continuation.chatStreamAdapter;

    let lastSequence = nextRuntimeSequence(this.repository.listRuntimeEventsByRun(continuation.request.runId));
    continuation.pendingByApprovalId.delete(input.approvalRequestId);
    this.pendingApprovals.delete(input.approvalRequestId);
    continuation.resolvedResults.push(toolResult);

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

    if (continuation.pendingByApprovalId.size > 0) {
      const resumeEvents = this.persistResumeRuntimeEvents({
        request: continuation.request,
        stepId: continuation.step.stepId,
        lastSequence,
        outcome: resumeOutcome,
      });
      lastSequence = resumeEvents.lastSequence;
      for (const event of resumeEvents.events) {
        chatStreamAdapter?.handleRuntimeEvent(event);
        if (isRunTerminalRuntimeEvent(event)) {
          chatStreamAdapter?.dispose();
        }
        yield event;
      }
      if (!resumeEvents.hasToolResultEvent) {
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
      chatStreamAdapter?.handleRuntimeEvent(event);
      if (isRunTerminalRuntimeEvent(event)) {
        chatStreamAdapter?.dispose();
      }
      yield event;
    }

    if (!resumeEvents.hasToolResultEvent) {
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
    const resumedInstructionSources = await this.loadInstructionSourcesForModelStep({
      ...(continuation.projectRoot ? { projectRoot: continuation.projectRoot } : {}),
      loadedAt: input.decidedAt,
    });
    const resumedRequest: ModelStepRuntimeRequest = {
      ...pending.request,
      stepId: resumedStep.stepId,
      modelStepId: `model-step:${crypto.randomUUID()}`,
      inputContext: buildModelStepInputContextFromSources({
        baseInputContext: pending.request.inputContext,
        contextId: createModelStepInputContextId({
          stepId: String(resumedStep.stepId),
          contextKind: 'approval-resume',
        }),
        sessionId: pending.request.sessionId,
        runId: String(pending.request.runId),
        stepId: String(resumedStep.stepId),
        buildReason: 'approval_resume_continuation',
        builtAt: input.decidedAt,
        toolCalls: pending.accumulatedToolCalls,
        toolResults: resumedToolResults,
        providerStates: pending.accumulatedProviderStates,
        instructionSources: resumedInstructionSources,
      }),
      createdAt: input.decidedAt,
    };

    yield* this.streamAndPersistModelStep({
      request: resumedRequest,
      run: runningRun,
      step: resumedStep,
      userMessageId: continuation.userMessageId,
      startSequence: lastSequence,
      toolRuntime: continuation.toolRuntime,
      ...(continuation.projectRoot ? { projectRoot: continuation.projectRoot } : {}),
      ...(chatStreamAdapter ? { chatStreamAdapter } : {}),
      emitRunStarted: false,
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
    hasToolResultEvent: boolean;
  } {
    let lastSequence = input.lastSequence;
    const events: RuntimeEvent[] = [];
    let hasToolResultEvent = false;

    for (const event of input.outcome.runtimeEvents ?? []) {
      const eventWithRequest = withSequenceAfter(withRequestMetadata({
        ...event,
        sessionId: event.sessionId ?? input.request.sessionId,
        stepId: event.stepId ?? String(input.stepId),
      }, input.request), lastSequence);
      lastSequence = eventWithRequest.sequence;
      hasToolResultEvent ||= eventWithRequest.eventType === 'tool.result.created'
        && getToolResultEventId(eventWithRequest.payload) === String(input.outcome.toolResult.toolResultId);
      this.repository.appendRuntimeEvent(eventWithRequest);
      events.push(eventWithRequest);
    }

    return { events, lastSequence, hasToolResultEvent };
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

function runtimeConstraintsFromRunContext(
  context: RunContext,
  loadedAt: string,
): ModelStepRuntimeConstraintInput[] {
  return [{
    constraintId: `${context.contextId}:project-boundary`,
    projectRoot: context.workspaceBoundary.rootPath,
    workspaceAccess: context.policySummary.workspaceAccess,
    sandboxSummary: context.policySummary.sandboxSummary,
    approvalSummary: context.policySummary.approvalSummary,
    loadedAt,
  }];
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

function createModelStepRuntimeErrorFromUnknown(error: unknown): RuntimeError {
  if (isRuntimeError(error)) {
    return error;
  }

  const message = error instanceof Error && error.message
    ? error.message
    : 'Model step provider failed.';
  const looksProviderTransient = /rate.?limit|too many requests|429|timeout|timed out|network|overload|503|unavailable|premature|stream ended/i
    .test(message);

  return {
    code: looksProviderTransient ? 'provider_network_error' : 'runtime_unknown',
    message,
    severity: 'error',
    retryable: looksProviderTransient,
    source: looksProviderTransient ? 'provider' : 'core',
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

async function sleepRetryBackoff(input: { delayMs: number }): Promise<void> {
  if (input.delayMs <= 0) {
    return;
  }

  await new Promise<void>((resolve) => {
    setTimeout(resolve, input.delayMs);
  });
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toPermissionModeSnapshot(
  value: RunModeSnapshot | RunMode,
  requestCreatedAt: string,
): PermissionModeSnapshot {
  const mode = 'mode' in value ? value.mode : value;

  return {
    permissionMode: isPermissionMode(mode.permissionMode) ? mode.permissionMode : 'default',
    source: mode.source ?? 'system',
    createdAt: 'createdAt' in value ? value.createdAt : requestCreatedAt,
  };
}

function createPermissionModeRunMode(permissionMode: PermissionMode): RunMode {
  return {
    permissionMode,
    source: 'user',
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
  const runModeRepository = new RunModeRepository(database);
  const activePathRepository = new SessionActivePathRepository(database);

  return new SessionRunService({
    repository: new SessionRunRepository(database),
    activePathRepository,
    runModeService: new RunModeService({ repository: runModeRepository }),
    ...(options.contextService ? { contextService: options.contextService } : {}),
    ...(options.toolRuntimeFactory ? { toolRuntimeFactory: options.toolRuntimeFactory } : {}),
    agentInstructionSourceService: options.agentInstructionSourceService ?? new AgentInstructionSourceService(),
  });
}
