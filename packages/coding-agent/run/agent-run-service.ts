// Orchestrates Coding Agent product session runs by coordinating input facts,
// product persistence, permissions, context construction, tools, and model execution.
import {
  ActiveSessionMessageRunTracker,
  canResumeApprovalFromRunStatus,
  failAgentLoopBeforeModelCall,
  type RunRetryCoordinatorPort,
  type RunTerminalCoordinatorPort,
} from '../state';
import { runTurn, type RunHostBoundaryPort, type RunIdFactory } from '../state/lifecycle';
import {
  type ApprovalResumeGroup,
  ensureToolCallRunnerService,
  PendingApprovalRegistry,
  type ResumeToolApprovalInput,
} from '../agent-loop/tool-call';
import {
  DEFAULT_CONTEXT_BUDGET_POLICY,
  createBaselineContextForSession,
  createAgentLoopInitialModelInputMemoryRecallService,
  ModelCallInputBuildService,
  ModelInputSourceOverrideService,
  SessionCompactionOrchestrator,
  type AgentInstructionSourcePort,
  type AgentLoopInitialModelInputSourceOverrideProvider,
  type CompactIfNeededInput,
  type ModelCallInputBuildPort,
  type ModelInputMemoryRecallSource,
  type RunBaselineContextPort,
  type SessionCompactionOrchestratorRepository,
  type SessionCompactionOrchestrationResult,
} from '../context';
import {
  SessionContextInputService,
  SessionMessageService,
  type SessionBranchServicePort,
  type SessionContextInputBuildPort,
} from '@megumi/coding-agent/session';
import {
  AgentLoop,
  createAgentLoopEventRecorder,
  createToolSetSnapshotProvider,
  resumeToolApprovalAgentLoop,
  type AgentLoopOptions,
  ToolSetService,
  type ToolSetCapabilityProvider,
  type ToolSetRegistryProvider,
} from '../agent-loop';
import type { ModelCallProvider } from '../agent-loop/model-call';
import type { ToolRuntimeFactory } from '../agent-loop/tool-call';
import type { AgentRunPort } from '../product-runtime';
import { SubmitInputOperation } from '../product-runtime';
import {
  type ParsedInput,
  type SessionMessageInputMessage,
} from '@megumi/coding-agent/input';
import {
  RuntimeEventLog,
  RuntimeEventPublisher,
} from '../events';
import type { SessionActivePathRepository } from '../persistence/repos/session-active-path.repo';
import { persistLegacyModelStepRecordFromEvent } from '../persistence';
import type {
  AgentRunExecutionFactRepositoryPort,
  AgentRunMessageRepositoryPort,
  AgentRunModelStepRepositoryPort,
  AgentRunRunRecordRepositoryPort,
  AgentRunRuntimeEventRepositoryPort,
  AgentRunSessionContextRepositoryPort,
  AgentRunSessionRepositoryPort,
  AgentRunToolRepositoryPort,
} from '../persistence';
import type { ProviderId } from '@megumi/shared/provider';
import type { Run, RunStep, Session, SessionMessage } from '@megumi/shared/session';
import type {
  SessionActivePath,
  SessionBranchMarker,
  SessionRetryAttempt,
  SessionSourceEntry,
} from '@megumi/shared/session';
import {
  type PermissionMode,
} from '@megumi/shared/permission';
import type { InputPreprocessingResult } from '@megumi/shared/input';
import type { JsonObject } from '@megumi/shared/primitives';
import type {
  RunStartPayload,
  SessionTimelineListData,
  SessionMessageCancelPayload,
  SessionMessageSendData,
  SessionMessageSendPayload,
} from '@megumi/shared/ipc';
import {
  type ChatStreamEventAdapter,
  type ChatStreamEventSink,
} from '../projections/chat-stream';
import type {
  PermissionModeState,
  PermissionSnapshotRecord,
} from '@megumi/shared/permission';
import type { PlanArtifactServicePort } from '../artifacts';
import type { RuntimeContext } from '@megumi/shared/runtime';
import type { RuntimeEvent } from '@megumi/shared/runtime';
import {
  createRunPermissionSnapshot,
  toModelPermissionSnapshot,
  type RunPermissionSnapshotServicePort,
} from '../permissions';
import type { PostRunHooksPort } from '../hooks';
import type {
  MemoryProjectMirrorSyncPort,
  MemoryRecallPort,
} from '../memory';
import { resolveMemoryEnabled, type MemorySettingsPort } from '../settings';
import type { WorkspaceChangeReadPort } from '../workspace';
import type {
  ToolRegistrySnapshotServicePort,
} from '@megumi/coding-agent/tools/tool-registry-snapshot';
interface AgentRunServiceClock {
  now(): string;
}
interface AgentRunServiceIds extends RunIdFactory {
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

interface AgentRunServiceOptions {
  sessionRepository: AgentRunSessionRepositoryPort;
  messageRepository: AgentRunMessageRepositoryPort;
  runRecordRepository: AgentRunRunRecordRepositoryPort;
  runExecutionFactRepository: AgentRunExecutionFactRepositoryPort;
  modelStepRepository: AgentRunModelStepRepositoryPort;
  sessionContextRepository: AgentRunSessionContextRepositoryPort;
  runtimeEventRepository: AgentRunRuntimeEventRepositoryPort;
  postRunHooks: PostRunHooksPort;
  runTerminalCoordinator: RunTerminalCoordinatorPort;
  runRetryCoordinator: RunRetryCoordinatorPort;
  contextService?: RunBaselineContextPort;
  permissionSnapshotService?: RunPermissionSnapshotServicePort;
  planArtifactService?: PlanArtifactServicePort;
  modelCallProvider?: ModelCallProvider;
  toolRuntimeFactory?: ToolRuntimeFactory;
  toolDefinitionProvider?: ToolSetRegistryProvider;
  toolRegistrySnapshotService?: ToolRegistrySnapshotServicePort;
  providerCapabilitySummaryProvider?: ToolSetCapabilityProvider;
  toolRepository?: AgentRunToolRepositoryPort;
  agentInstructionSourceService?: AgentInstructionSourcePort;
  modelCallInputBuildService?: ModelCallInputBuildPort;
  memoryRecallService?: MemoryRecallPort;
  memorySettingsProvider?: MemorySettingsPort;
  memoryMarkdownSyncService?: MemoryProjectMirrorSyncPort;
  megumiHomePath?: string;
  modelInputSourceOverrideProvider?: AgentLoopInitialModelInputSourceOverrideProvider;
  sessionContextInputService?: SessionContextInputBuildPort;
  sessionCompactionOrchestrator?: {
    compactIfNeeded(input: CompactIfNeededInput): Promise<SessionCompactionOrchestrationResult>;
  };
  sessionCompactionRepository?: SessionCompactionOrchestratorRepository;
  activePathRepository?: SessionActivePathRepository;
  sessionBranchService?: SessionBranchServicePort;
  workspaceChanges?: WorkspaceChangeReadPort;
  hostBoundary?: RunHostBoundaryPort;
  chatStreamEventSink?: ChatStreamEventSink;
  timelineMessageRepository?: {
    listCommittedMessagesBySession(input: {
      projectId: string;
      sessionId: string;
    }): SessionTimelineListData;
  };
  clock?: AgentRunServiceClock;
  ids?: Partial<AgentRunServiceIds>;
}

type AgentRunApprovalResumeGroup = ApprovalResumeGroup<ChatStreamEventAdapter>;

const defaultClock: AgentRunServiceClock = {
  now: () => new Date().toISOString(),
};

function createDefaultAgentRunServiceIds(
  overrides: Partial<AgentRunServiceIds> = {},
): AgentRunServiceIds {
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
    ...overrides,
  };
}
class EmptySessionActivePathRepository {
  getActivePath(sessionId: string): SessionActivePath {
    return {
      sessionId,
      entries: [],
    };
  }
}

export class AgentRunService implements AgentRunPort {
  private readonly sessionRepository: AgentRunSessionRepositoryPort;
  private readonly messageRepository: AgentRunMessageRepositoryPort;
  private readonly runRecordRepository: AgentRunRunRecordRepositoryPort;
  private readonly runExecutionFactRepository: AgentRunExecutionFactRepositoryPort;
  private readonly modelStepRepository: AgentRunModelStepRepositoryPort;
  private readonly sessionContextRepository: AgentRunSessionContextRepositoryPort;
  private readonly runtimeEventRepository: AgentRunRuntimeEventRepositoryPort;
  private readonly runtimeEventLog: RuntimeEventLog;
  private readonly runtimeEventPublisher: RuntimeEventPublisher<ChatStreamEventAdapter>;
  private readonly activePathRepository?: SessionActivePathRepository;
  private readonly contextService?: RunBaselineContextPort;
  private readonly permissionSnapshotService?: RunPermissionSnapshotServicePort;
  private readonly planArtifactService?: PlanArtifactServicePort;
  private readonly modelCallProvider?: ModelCallProvider;
  private readonly toolRuntimeFactory?: ToolRuntimeFactory;
  private readonly toolDefinitionProvider?: ToolSetRegistryProvider;
  private readonly toolRegistrySnapshotService?: ToolRegistrySnapshotServicePort;
  private readonly providerCapabilitySummaryProvider?: ToolSetCapabilityProvider;
  private readonly toolRepository?: AgentRunToolRepositoryPort;
  private readonly modelCallInputBuildService: ModelCallInputBuildPort;
  private readonly memoryRecallService?: MemoryRecallPort;
  private readonly memorySettingsProvider?: MemorySettingsPort;
  private readonly memoryMarkdownSyncService?: MemoryProjectMirrorSyncPort;
  private readonly megumiHomePath?: string;
  private readonly modelInputSourceOverrideProvider: AgentLoopInitialModelInputSourceOverrideProvider;
  private readonly sessionContextInputService: SessionContextInputBuildPort;
  private readonly sessionMessageService: SessionMessageService;
  private readonly submitInputOperation: SubmitInputOperation;
  private readonly sessionCompactionOrchestrator?: {
    compactIfNeeded(input: CompactIfNeededInput): Promise<SessionCompactionOrchestrationResult>;
  };
  private readonly hostBoundary: RunHostBoundaryPort;
  private readonly clock: AgentRunServiceClock;
  private readonly ids: AgentRunServiceIds;
  private readonly runTerminalCoordinator: RunTerminalCoordinatorPort;
  private readonly runRetryCoordinator: RunRetryCoordinatorPort;
  private readonly postRunHooks: PostRunHooksPort;
  private readonly pendingApprovalRegistry = new PendingApprovalRegistry<AgentRunApprovalResumeGroup>({
    getRunId: (group) => group.request.runId,
  });
  private readonly activeSessionMessageRuns = new ActiveSessionMessageRunTracker<ChatStreamEventAdapter>();

  constructor(options: AgentRunServiceOptions) {
    this.sessionRepository = options.sessionRepository;
    this.messageRepository = options.messageRepository;
    this.runRecordRepository = options.runRecordRepository;
    this.runExecutionFactRepository = options.runExecutionFactRepository;
    this.modelStepRepository = options.modelStepRepository;
    this.sessionContextRepository = options.sessionContextRepository;
    this.runtimeEventRepository = options.runtimeEventRepository;
    this.runtimeEventLog = new RuntimeEventLog(options.runtimeEventRepository);
    this.postRunHooks = options.postRunHooks;
    this.runtimeEventPublisher = new RuntimeEventPublisher<ChatStreamEventAdapter>({
      eventLog: this.runtimeEventLog,
      terminalHooks: this.postRunHooks,
    });
    this.runTerminalCoordinator = options.runTerminalCoordinator;
    this.runRetryCoordinator = options.runRetryCoordinator;
    this.activePathRepository = options.activePathRepository;
    this.contextService = options.contextService;
    this.permissionSnapshotService = options.permissionSnapshotService;
    this.planArtifactService = options.planArtifactService;
    this.modelCallProvider = options.modelCallProvider;
    this.toolRuntimeFactory = options.toolRuntimeFactory;
    this.toolDefinitionProvider = options.toolDefinitionProvider;
    this.toolRegistrySnapshotService = options.toolRegistrySnapshotService;
    this.providerCapabilitySummaryProvider = options.providerCapabilitySummaryProvider;
    this.toolRepository = options.toolRepository;
    this.memoryRecallService = options.memoryRecallService;
    this.memorySettingsProvider = options.memorySettingsProvider;
    this.memoryMarkdownSyncService = options.memoryMarkdownSyncService;
    this.megumiHomePath = options.megumiHomePath;
    this.modelInputSourceOverrideProvider = options.modelInputSourceOverrideProvider ?? new ModelInputSourceOverrideService();
    this.clock = options.clock ?? defaultClock;
    this.ids = createDefaultAgentRunServiceIds(options.ids);
    this.sessionContextInputService = options.sessionContextInputService
      ?? new SessionContextInputService({
        sessionRepository: this.sessionRepository,
        messageRepository: this.messageRepository,
        runRepository: this.runRecordRepository,
        runExecutionFactRepository: this.runExecutionFactRepository,
        runtimeEventRepository: this.runtimeEventRepository,
        sessionCompactionRepository: this.sessionContextRepository,
        activePathRepository: this.activePathRepository ?? new EmptySessionActivePathRepository(),
      });
    this.sessionMessageService = new SessionMessageService({
      sessionRepository: this.sessionRepository,
      messageRepository: this.messageRepository,
      ids: this.ids,
      ...(this.activePathRepository ? { activePathRepository: this.activePathRepository } : {}),
    });
    this.submitInputOperation = new SubmitInputOperation({
      clock: this.clock,
      ids: this.ids,
      sessionMessages: this.sessionMessageService,
      activeRuns: this.activeSessionMessageRuns,
      runRepository: this.runRecordRepository,
      stepRepository: this.runExecutionFactRepository,
      permissionSnapshotService: this.permissionSnapshotService,
      sessionBranchService: options.sessionBranchService,
      runRetryCoordinator: this.runRetryCoordinator,
      chatStreamEventSink: options.chatStreamEventSink,
      appendEvent: (event, projection) => this.appendRuntimeEvent(event, projection),
      runAgentLoop: (operationInput) => this.runSessionMessageAgentLoop(operationInput),
    });
    this.modelCallInputBuildService = options.modelCallInputBuildService
      ?? new ModelCallInputBuildService({
        instructionSourceService: options.agentInstructionSourceService,
        defaultBudgetPolicy: DEFAULT_CONTEXT_BUDGET_POLICY,
      });
    this.sessionCompactionOrchestrator = options.sessionCompactionOrchestrator
      ?? (options.modelCallProvider && options.sessionCompactionRepository
        ? new SessionCompactionOrchestrator({
            repository: options.sessionCompactionRepository,
            modelStepProvider: options.modelCallProvider,
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

  private createAgentLoopOptions(
    chatStreamAdapter?: ChatStreamEventAdapter,
  ): AgentLoopOptions {
    const svc = this;
    const toolSetService = new ToolSetService({
      ...(this.toolRegistrySnapshotService ? {
        snapshotProvider: createToolSetSnapshotProvider({
          snapshotService: this.toolRegistrySnapshotService,
          eventId: this.ids.eventId,
        }),
      } : {}),
      ...(this.toolDefinitionProvider ? { registryProvider: this.toolDefinitionProvider } : {}),
      ...(this.providerCapabilitySummaryProvider ? { capabilityProvider: this.providerCapabilitySummaryProvider } : {}),
    });
    const memoryRecallService = createAgentLoopInitialModelInputMemoryRecallService({
      memoryRecallService: this.memoryRecallService,
      megumiHomePath: this.megumiHomePath,
    });

    return {
      clock: this.clock,
      ids: { eventId: this.ids.eventId },
      // === Required ports ===
      eventPort: {
        append(event, requestId, runtimeContext) {
          return svc.runtimeEventPublisher.appendWithRuntimeRequest(event, {
            requestId,
            ...(runtimeContext ? { runtimeContext } : {}),
          }, chatStreamAdapter ? { chatStreamAdapter } : {});
        },
      },
      statePort: {
        getRunStatus: (runId: string) => svc.runRecordRepository.getRun(runId)?.status,
      },
      failurePort: {
        async *failBeforeModelCall(failureInput) {
          const seq = Math.max(
            0,
            svc.runtimeEventLog.lastSequenceForRun(String(failureInput.run.runId)),
          );
          const failed = failAgentLoopBeforeModelCall({
            requestId: failureInput.requestId,
            runtimeContext: failureInput.runtimeContext,
            sessionId: failureInput.sessionId,
            run: failureInput.run,
            step: failureInput.step,
            error: failureInput.error,
            startSequence: seq,
            failedAt: svc.clock.now(),
            ids: svc.ids,
            lifecycle: {
              saveRun: (run) => {
                svc.runRecordRepository.saveRun(run);
              },
              saveStep: (step) => {
                svc.runExecutionFactRepository.saveStep(step);
              },
            },
          });
          for (const event of failed.events) {
            svc.appendRuntimeEvent(event, chatStreamAdapter);
            yield event;
          }
        },
      },
      // === Optional / passthrough ports ===
      ...(this.contextService ? { contextService: this.contextService } : {}),
      toolSetService,
      sessionContextInputService: this.sessionContextInputService,
      sourceOverrideProvider: this.modelInputSourceOverrideProvider,
      ...(memoryRecallService ? { memoryRecallService } : {}),
      modelCallPort: {
        streamModelCall: ({ request }) => this.requireModelCallProvider().streamModelCall(request),
      },
      ...(this.toolRuntimeFactory ? {
        toolCallRunnerFactory: {
          create: async (factoryInput) => ensureToolCallRunnerService(
            await this.toolRuntimeFactory!.create(factoryInput),
            {
              modelInputEmissionRepository: this.toolRepository
                ? { markToolResultsSubmittedToModelInput: (request) => this.toolRepository?.markToolResultsSubmittedToModelInput(request) }
                : undefined,
              ids: this.ids,
            },
          ),
        },
      } : {}),
      modelCallInputBuildService: this.modelCallInputBuildService,
      ...(this.sessionCompactionOrchestrator ? { compactionOrchestrator: this.sessionCompactionOrchestrator } : {}),
      eventRecorder: this.createModelCallEventRecorder(chatStreamAdapter),
    };
  }

  async startRun(payload: RunStartPayload): Promise<{ run: Run; events: RuntimeEvent[] }> {
    const session = this.sessionRepository.getSession(payload.sessionId);
    const runId = this.ids.runId();
    const permissionSnapshot = createRunPermissionSnapshot({
      service: this.permissionSnapshotService,
      runId,
      permissionMode: payload.mode,
      ...(payload.permissionModeState ? { permissionModeState: payload.permissionModeState } : {}),
      ...(payload.sourcePlanId ? { sourcePlanId: payload.sourcePlanId } : {}),
      createdAt: payload.createdAt,
    });

    const initialContext = createBaselineContextForSession({
      contextService: this.contextService,
      runId,
      goal: payload.goal,
      session,
    });

    const result = await runTurn({
      sessionId: payload.sessionId,
      ...(payload.triggerMessageId ? { triggerMessageId: payload.triggerMessageId } : {}),
      permissionMode: payload.mode,
      ...(permissionSnapshot ? {
        permissionModeState: permissionSnapshot.permissionModeState,
        permissionSnapshotRef: permissionSnapshot.permissionSnapshotRef,
      } : payload.permissionModeState ? { permissionModeState: payload.permissionModeState } : {}),
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
          this.runRecordRepository.saveRun(run);
        },
        saveStep: (step) => {
          this.runExecutionFactRepository.saveStep(step);
        },
        saveAction: (action) => {
          this.runExecutionFactRepository.saveAction(action);
        },
        saveObservation: (observation) => {
          this.runExecutionFactRepository.saveObservation(observation);
        },
        appendEvent: (event) => {
          this.runtimeEventPublisher.append(event);
        },
      },
      hostBoundary: this.hostBoundary,
    });

    if (permissionSnapshot && this.planArtifactService && result.run.status === 'completed') {
      this.planArtifactService.createPlanRecordForRun({
        runId,
        goal: payload.goal,
        permissionModeState: permissionSnapshot.permissionModeState,
        createdAt: result.run.completedAt ?? payload.createdAt,
      });
    }

    return { run: result.run, events: result.events };
  }

  async sendSessionMessage(input: {
    requestId: string;
    payload: SessionMessageSendPayload;
    runtimeContext?: RuntimeContext;
  }): Promise<{ data: SessionMessageSendData; events: AsyncIterable<RuntimeEvent> }> {
    return this.submitInputOperation.send(input);
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
    return this.runRetryCoordinator.createManualRetryFromRun(input);
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
    return this.runRetryCoordinator.createManualRerunFromUserMessage(input);
  }

  cancelSessionMessage(payload: SessionMessageCancelPayload): boolean {
    const providerCancelled = this.modelCallProvider?.cancelModelCall(payload.targetRequestId) ?? false;
    const activeRun = this.activeSessionMessageRuns.get(payload.targetRequestId);

    if (!activeRun) {
      return providerCancelled;
    }

    const result = this.runTerminalCoordinator.cancelActiveSessionMessageRun({
      activeRun,
      targetRequestId: payload.targetRequestId,
      cancelRequestId: this.ids.cancelRequestId(),
      cancelledAt: this.clock.now(),
      providerCancelled,
      cancelPendingApprovalGroupsByRun: (runId) => this.cancelPendingApprovalGroupsByRun(runId),
      appendEvent: (event) => this.appendRuntimeEvent(event, activeRun.projection),
    });

    if (result.shouldForgetActiveRun) {
      this.activeSessionMessageRuns.forget(payload.targetRequestId);
    }
    return result.handled ? true : providerCancelled;
  }

  resumeApproval(input: ResumeToolApprovalInput): AsyncIterable<RuntimeEvent> | undefined {
    const approvalResume = this.pendingApprovalRegistry.getByApprovalId(input.approvalRequestId);
    if (!approvalResume) {
      return undefined;
    }
    const persistedRun = this.runRecordRepository.getRun(approvalResume.request.runId) ?? approvalResume.run;
    if (!canResumeApprovalFromRunStatus(persistedRun.status)) {
      this.cancelPendingApprovalGroupsByRun(approvalResume.request.runId);
      return undefined;
    }

    return this.resumeToolApprovalRun(approvalResume, input);
  }

  cleanupInterruptedRunsOnStartup(): { cleanedRunIds: string[] } {
    return this.runTerminalCoordinator.cleanupInterruptedRunsOnStartup({
      cleanupAt: this.clock.now(),
    });
  }

  listRuntimeEventsByRun(runId: string): RuntimeEvent[] {
    return this.runtimeEventRepository.listRuntimeEventsByRun(runId);
  }

  private createModelCallEventRecorder(chatStreamAdapter?: ChatStreamEventAdapter) {
    return createAgentLoopEventRecorder<ChatStreamEventAdapter>({
      clock: this.clock,
      ids: {
        eventId: this.ids.eventId,
        stepId: this.ids.stepId,
      },
      events: {
        lastSequenceForRun: (runId) => this.runtimeEventLog.lastSequenceForRun(runId),
        normalizeWithModelRequest: (event, request, input) => this.runtimeEventLog.normalizeWithModelRequest(
          event,
          request,
          input,
        ),
        withModelRequestMetadata: (event, request) => this.runtimeEventLog.withModelRequestMetadata(event, request),
        append: (event, projection) => {
          this.appendRuntimeEvent(event, projection);
          return event;
        },
      },
      runRepository: this.runRecordRepository,
      stepRepository: this.runExecutionFactRepository,
      legacyModelSteps: {
        persistFromEvent: (input) => {
          persistLegacyModelStepRecordFromEvent({
            repository: this.modelStepRepository,
            ...input,
          });
        },
      },
      assistantReplies: {
        commit: (input) => {
          this.sessionMessageService.commitAssistantReply(input);
        },
      },
      postRunHooks: this.postRunHooks,
      memory: {
        isEnabled: () => resolveMemoryEnabled(this.memorySettingsProvider),
      },
      approvals: {
        registry: this.pendingApprovalRegistry,
      },
      ...(chatStreamAdapter ? { projection: chatStreamAdapter } : {}),
    });
  }

  private async *runSessionMessageAgentLoop(input: {
    requestId: string;
    payload: SessionMessageSendPayload;
    runtimeContext?: RuntimeContext;
    session: Session;
    run: Run;
    step: RunStep;
    userMessage: SessionMessage;
    currentUserMessage: SessionMessageInputMessage;
    permissionMode: PermissionMode;
    inputPreprocessing: InputPreprocessingResult;
    permissionSnapshot?: PermissionSnapshotRecord;
    chatStreamAdapter?: ChatStreamEventAdapter;
    parsedInput?: ParsedInput;
  }): AsyncIterable<RuntimeEvent> {
    const loop = new AgentLoop(
      this.createAgentLoopOptions(input.chatStreamAdapter),
    );
    yield* loop.run({
      requestId: input.requestId,
      session: input.session,
      run: input.run,
      step: input.step,
      userMessage: input.userMessage,
      providerId: input.payload.providerId,
      modelId: input.payload.modelId,
      permissionMode: input.permissionMode,
      inputPreprocessing: input.inputPreprocessing,
      ...(input.parsedInput ? { parsedInput: input.parsedInput } : {}),
      ...(input.permissionSnapshot ? {
        permissionSnapshot: toModelPermissionSnapshot(input.permissionSnapshot, input.payload.createdAt),
        permissionSnapshotRef: input.permissionSnapshot.permissionSnapshotId,
      } : {}),
      ...(input.runtimeContext ? { runtimeContext: input.runtimeContext } : {}),
      createdAt: input.payload.createdAt,
      memoryEnabled: resolveMemoryEnabled(this.memorySettingsProvider),
    });
  }

  private appendRuntimeEvent(event: RuntimeEvent, chatStreamAdapter?: ChatStreamEventAdapter): void {
    this.runtimeEventPublisher.append(event, chatStreamAdapter ? { chatStreamAdapter } : {});
  }

  private cancelPendingApprovalGroupsByRun(runId: string): void {
    this.pendingApprovalRegistry.cancelByRun(runId);
  }

  private requireModelCallProvider(): ModelCallProvider {
    if (!this.modelCallProvider) {
      throw new Error('Model call provider service is not configured.');
    }

    return this.modelCallProvider;
  }

  private async *resumeToolApprovalRun(
    approvalResume: AgentRunApprovalResumeGroup,
    input: ResumeToolApprovalInput,
  ): AsyncIterable<RuntimeEvent> {
    yield* resumeToolApprovalAgentLoop({
      approvalResume,
      resumeInput: input,
      registry: this.pendingApprovalRegistry,
      lastSequenceForRun: (runId) => this.runtimeEventLog.lastSequenceForRun(runId),
      appendEvent: (event, projection) => this.appendRuntimeEvent(event, projection),
      runRepository: this.runRecordRepository,
      stepRepository: this.runExecutionFactRepository,
      modelCallPort: {
        streamModelCall: ({ request }) => this.requireModelCallProvider().streamModelCall(request),
      },
      modelCallInputBuildService: this.modelCallInputBuildService,
      sourceOverrideProvider: this.modelInputSourceOverrideProvider,
      ids: {
        nextEventId: this.ids.eventId,
        eventId: this.ids.eventId,
        stepId: this.ids.stepId,
        nextStepId: ({ runId }) => {
          const step = this.runExecutionFactRepository.saveStep({
            stepId: this.ids.stepId(),
            runId,
            kind: 'model',
            status: 'running',
            title: 'Model response',
            startedAt: this.clock.now(),
          });
          return step.stepId;
        },
        nextModelStepId: () => `model-step:${crypto.randomUUID()}`,
      },
      clock: this.clock,
      recordModelCallEvents: this.createModelCallEventRecorder(approvalResume.projection).recordModelCallEvents,
    });
  }

}

function defaultHostBoundary(
  clock: AgentRunServiceClock,
  ids: AgentRunServiceIds,
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
