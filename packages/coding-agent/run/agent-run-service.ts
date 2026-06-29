// Orchestrates Coding Agent product session runs by coordinating input facts,
// product persistence, permissions, context construction, tools, and model execution.
import {
  ActiveSessionMessageRunTracker,
  attachRunPermissionSnapshot,
  canResumeApprovalFromRunStatus,
  cancelAgentLoopModelCall,
  completeAgentLoopModelCall,
  failAgentLoopBeforeModelCall,
  failAgentLoopModelCall,
  resumeRunAfterApproval,
  startAgentLoopRun,
  succeedAgentLoopModelCall,
  waitForAgentLoopApproval,
  type RunRetryCoordinatorPort,
  type RunTerminalCoordinatorPort,
} from '../state';
import { runTurn, type RunHostBoundaryPort, type RunIdFactory } from '../state/lifecycle';
import {
  ensureToolCallRunnerService,
  PendingApprovalRegistry,
  type PendingToolApprovalResume,
  type ResumeToolApprovalInput,
  type ToolCallRunnerService,
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
  assertActiveBranchDraftMarker as assertSessionActiveBranchDraftMarker,
  SessionContextInputService,
  SessionMessageService,
  type SessionBranchServicePort,
  type SessionContextInputBuildPort,
} from '@megumi/coding-agent/session';
import {
  AgentLoop,
  createToolSetSnapshotProvider,
  type AgentLoopOptions,
  streamApprovalResumeModelLoop,
  ToolSetService,
  type ToolSetCapabilityProvider,
  type ToolSetRegistryProvider,
} from '../agent-loop';
import type { ModelCallProvider } from '../agent-loop/model-call';
import type { ToolRuntimeFactory } from '../agent-loop/tool-call';
import type { AgentRunPort } from '../product-runtime';
import {
  type ParsedInput,
  parseSessionMessageRawInput,
  prepareSessionMessageInput,
  type SessionMessageInputMessage,
} from '@megumi/coding-agent/input';
import {
  createRunFailedEvent,
  createRunStatusChangedEvent,
  createRuntimeErrorFromUnknown,
  modelCallInputBuildFailureToRuntimeError,
  RuntimeEventLog,
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
import { isProviderId, type ProviderId } from '@megumi/shared/provider';
import type { ModelInputContextBuildRequest } from '@megumi/shared/model';
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
  createSessionMessageChatStreamAdapter,
  type ChatStreamEventAdapter,
  type ChatStreamEventSink,
} from '../projections/chat-stream';
import type { ModelStepRuntimeRequest } from '@megumi/shared/model';
import type {
  PermissionModeState,
  PermissionSnapshotRecord,
} from '@megumi/shared/permission';
import type { PlanArtifactServicePort } from '../artifacts';
import type { RuntimeContext } from '@megumi/shared/runtime';
import type { RuntimeError } from '@megumi/shared/runtime';
import type { RuntimeEvent } from '@megumi/shared/runtime';
import type { ToolResult } from '@megumi/shared/tool';
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

interface ApprovalResumeGroup {
  groupId: string;
  request: ModelStepRuntimeRequest;
  run: Run;
  step: RunStep;
  projectId?: string;
  projectRoot?: string;
  permissionMode?: PermissionMode;
  userMessageId: string;
  pendingByApprovalId: Map<string, PendingToolApprovalResume>;
  resolvedResults: ToolResult[];
  toolRuntime: ToolCallRunnerService;
  memoryRecallSources?: ModelInputMemoryRecallSource[];
  memoryRecallSeed?: ModelInputContextBuildRequest['memoryRecallSeed'];
  chatStreamAdapter?: ChatStreamEventAdapter;
}

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
  private readonly sessionCompactionOrchestrator?: {
    compactIfNeeded(input: CompactIfNeededInput): Promise<SessionCompactionOrchestrationResult>;
  };
  private readonly sessionBranchService?: SessionBranchServicePort;
  private readonly hostBoundary: RunHostBoundaryPort;
  private readonly chatStreamEventSink?: ChatStreamEventSink;
  private readonly clock: AgentRunServiceClock;
  private readonly ids: AgentRunServiceIds;
  private readonly runTerminalCoordinator: RunTerminalCoordinatorPort;
  private readonly runRetryCoordinator: RunRetryCoordinatorPort;
  private readonly postRunHooks: PostRunHooksPort;
  private readonly pendingApprovalRegistry = new PendingApprovalRegistry<ApprovalResumeGroup>({
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
    this.modelCallInputBuildService = options.modelCallInputBuildService
      ?? new ModelCallInputBuildService({
        instructionSourceService: options.agentInstructionSourceService,
        defaultBudgetPolicy: DEFAULT_CONTEXT_BUDGET_POLICY,
      });
    this.chatStreamEventSink = options.chatStreamEventSink;
    this.sessionBranchService = options.sessionBranchService;
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
          return svc.runtimeEventLog.appendWithRuntimeRequest(event, {
            requestId,
            ...(runtimeContext ? { runtimeContext } : {}),
          }, {
            ...(chatStreamAdapter ? { streamSink: chatStreamAdapter } : {}),
            onTerminalEvent: (terminalEvent) => svc.publishRunTerminalEventHooks(terminalEvent, chatStreamAdapter),
          });
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
      eventRecorder: {
        createModelStep: ({ runId }) => {
          const step = svc.runExecutionFactRepository.saveStep({
            stepId: svc.ids.stepId(),
            runId,
            kind: 'model',
            status: 'running',
            title: 'Model response',
            startedAt: svc.clock.now(),
          });
          return step.stepId;
        },
        recordModelCallEvents: (recordInput) => svc.persistModelCallEvents({
          ...recordInput,
          ...(chatStreamAdapter ? { chatStreamAdapter } : {}),
        }),
      },
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
          this.runtimeEventLog.append(event);
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
    let branchDraftMarker: SessionBranchMarker | undefined;
    if (input.payload.branchDraft) {
      if (!input.payload.sessionId) {
        throw new Error('Branch draft requires an existing session.');
      }
      branchDraftMarker = assertSessionActiveBranchDraftMarker({
        activePathRepository: this.requireActivePathRepository(),
        sessionId: input.payload.sessionId,
        branchMarkerId: input.payload.branchDraft.branchMarkerId,
      });
    }

    const runId = this.ids.runId();
    const stepId = this.ids.stepId();
    const createdAt = input.payload.createdAt;
    const sessionMessageInput = prepareSessionMessageInput({
      payload: input.payload,
    });
    const currentUserMessage = sessionMessageInput.currentUserMessage;
    const permissionMode = sessionMessageInput.permissionMode;
    const permissionSource = sessionMessageInput.permissionSource;
    const mode = permissionMode;
    const inputMetadata = sessionMessageInput.metadata;
    const preparedMessage = this.sessionMessageService.prepareUserMessage({
      ...(input.payload.sessionId ? { sessionId: input.payload.sessionId } : {}),
      ...(input.payload.context?.sessionTitle ? { sessionTitle: input.payload.context.sessionTitle } : {}),
      ...(input.payload.context?.workspaceId ? { workspaceId: input.payload.context.workspaceId } : {}),
      ...(input.payload.context?.workspacePath ? { workspacePath: input.payload.context.workspacePath } : {}),
      runId,
      content: currentUserMessage.content,
      messageCreatedAt: currentUserMessage.createdAt,
      createdAt,
    });
    const { session, userMessage } = preparedMessage;
    const parsedInput = parseSessionMessageRawInput({
      requestId: input.requestId,
      runId,
      sessionId: String(session.sessionId),
      message: {
        ...currentUserMessage,
        id: String(userMessage.messageId),
      },
      createdAt,
    });
    const started = startAgentLoopRun({
      runId,
      stepId,
      sessionId: session.sessionId,
      triggerMessageId: userMessage.messageId,
      mode,
      goal: userMessage.content,
      createdAt,
      lifecycle: {
        saveRun: (runRecord) => {
          this.runRecordRepository.saveRun(runRecord);
        },
        saveStep: (stepRecord) => {
          this.runExecutionFactRepository.saveStep(stepRecord);
        },
      },
    });
    const permissionSnapshot = createRunPermissionSnapshot({
      service: this.permissionSnapshotService,
      runId,
      permissionMode: mode,
      permissionSource,
      ...(inputMetadata ? { metadata: inputMetadata } : {}),
      createdAt,
    });
    const run = permissionSnapshot
      ? attachRunPermissionSnapshot({
          run: started.run,
          permissionSnapshotRef: permissionSnapshot.permissionSnapshotRef,
          lifecycle: {
            saveRun: (runRecord) => {
              this.runRecordRepository.saveRun(runRecord);
            },
          },
        })
      : started.run;
    const step = started.step;
    this.sessionMessageService.recordSessionRunSource({
      sessionId: String(session.sessionId),
      runId: String(run.runId),
      createdAt,
    });
    let manualRerunAuditEvent: RuntimeEvent | undefined;
    if (input.payload.branchDraft?.intent === 'rerun') {
      if (!branchDraftMarker) {
        throw new Error('Branch draft marker was not found.');
      }
      manualRerunAuditEvent = this.runRetryCoordinator.recordManualRerunAttemptForBranchDraft({
        requestId: input.requestId,
        sessionId: String(session.sessionId),
        runId: String(run.runId),
        branchMarkerId: input.payload.branchDraft.branchMarkerId,
        marker: branchDraftMarker,
        createdAt,
        runtimeContext: input.runtimeContext,
      });
    }
    const chatStreamAdapter = createSessionMessageChatStreamAdapter({
      ...(this.chatStreamEventSink ? { sink: this.chatStreamEventSink } : {}),
      projectId: String(session.workspaceId ?? session.sessionId),
      sessionId: String(session.sessionId),
      runId: String(runId),
      userMessageId: String(userMessage.messageId),
      clientMessageId: String(currentUserMessage.id),
      userMessageText: userMessage.content,
      createdAt,
      now: () => this.clock.now(),
      ids: {
        eventId: this.ids.chatStreamEventId,
        textId: this.ids.chatTextId,
        thinkingId: this.ids.chatThinkingId,
        streamId: this.ids.chatStreamId,
      },
    });
    chatStreamAdapter?.startTurn?.();
    if (manualRerunAuditEvent) {
      this.appendRuntimeEvent(manualRerunAuditEvent, chatStreamAdapter);
    }
    this.activeSessionMessageRuns.register(input.requestId, {
      runId,
      sessionId: session.sessionId,
      stepId,
      ...(chatStreamAdapter ? { projection: chatStreamAdapter } : {}),
    });

    return {
      data: { requestId: input.requestId },
      events: this.activeSessionMessageRuns.track({
        requestId: input.requestId,
        events: this.runSessionMessageAgentLoop({
          requestId: input.requestId,
          payload: input.payload,
          runtimeContext: input.runtimeContext,
          session,
          run,
          step,
          userMessage,
          currentUserMessage,
          permissionMode,
          inputPreprocessing: sessionMessageInput.inputPreprocessing,
          ...(permissionSnapshot ? { permissionSnapshot: permissionSnapshot.record } : {}),
          ...(chatStreamAdapter ? { chatStreamAdapter } : {}),
          parsedInput,
        }),
        getRunStatus: (runIdToCheck) => this.runRecordRepository.getRun(runIdToCheck)?.status,
      }),
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

  private async *persistModelCallEvents(input: {
    request: ModelStepRuntimeRequest;
    modelEvents: AsyncIterable<RuntimeEvent>;
    pendingApprovalResumes: PendingToolApprovalResume[];
    run: Run;
    step: RunStep;
    userMessageId: string;
    toolRuntime?: ToolCallRunnerService;
    chatStreamAdapter?: ChatStreamEventAdapter;
    projectId?: string;
    projectRoot?: string;
    permissionMode?: PermissionMode;
    memoryRecallSources?: ModelInputMemoryRecallSource[];
    memoryRecallSeed?: ModelInputContextBuildRequest['memoryRecallSeed'];
    startSequence?: number;
  }): AsyncIterable<RuntimeEvent> {
    let assistantContent = '';
    let sawAssistantOutputCompleted = false;
    let sawFinalModelStepCompleted = false;
    let lastSequence = input.startSequence ?? 0;
    let terminalEvent: RuntimeEvent | undefined;
    let currentModelStep = input.step;
    let registeredPendingGroup: ApprovalResumeGroup | undefined;
    const modelStepsById = new Map<string, RunStep>([[input.step.stepId, input.step]]);

    const registerPendingApprovalGroup = (): ApprovalResumeGroup | undefined => {
      if (registeredPendingGroup || input.pendingApprovalResumes.length === 0 || !toolRuntime) {
        return registeredPendingGroup;
      }

      const waiting = waitForAgentLoopApproval({
        run: this.runRecordRepository.getRun(input.request.runId) ?? input.run,
        step: currentModelStep,
        lifecycle: {
          saveRun: (run) => {
            this.runRecordRepository.saveRun(run);
          },
          saveStep: (step) => {
            this.runExecutionFactRepository.saveStep(step);
          },
        },
      });
      const waitingRun = waiting.run;
      const waitingStep = waiting.step;
      currentModelStep = waitingStep;
      const groupId = `${input.request.runId}:${input.request.stepId}:${this.ids.eventId()}`;
      const group: ApprovalResumeGroup = {
        groupId,
        request: input.request,
        run: waitingRun,
        step: waitingStep,
        ...(input.projectId ? { projectId: input.projectId } : {}),
        ...(input.projectRoot ? { projectRoot: input.projectRoot } : {}),
        ...(input.permissionMode ? { permissionMode: input.permissionMode } : {}),
        userMessageId: input.userMessageId,
        pendingByApprovalId: new Map(input.pendingApprovalResumes.map((pending) => [
          pending.pendingApproval.approvalRequest.approvalRequestId,
          pending,
        ])),
        resolvedResults: [],
        toolRuntime,
        ...(input.memoryRecallSources ? { memoryRecallSources: input.memoryRecallSources } : {}),
        ...(input.memoryRecallSeed ? { memoryRecallSeed: input.memoryRecallSeed } : {}),
        ...(input.chatStreamAdapter ? { chatStreamAdapter: input.chatStreamAdapter } : {}),
      };
      this.pendingApprovalRegistry.register(group);
      registeredPendingGroup = group;
      return group;
    };

    const toolRuntime = input.toolRuntime;

    try {
      for await (const event of input.modelEvents) {
        registerPendingApprovalGroup();
        lastSequence = Math.max(lastSequence, this.runtimeEventLog.lastSequenceForRun(input.request.runId));
        const eventWithRequest = this.runtimeEventLog.normalizeWithModelRequest(event, input.request, {
          afterSequence: lastSequence,
        });
        lastSequence = eventWithRequest.sequence;
        const eventStepId = eventWithRequest.stepId ?? currentModelStep.stepId;
        if (!modelStepsById.has(eventStepId)) {
          const persistedStep = this.runExecutionFactRepository.listStepsByRun(input.request.runId)
            .find((step) => step.stepId === eventStepId);
          if (persistedStep) {
            modelStepsById.set(persistedStep.stepId, persistedStep);
            currentModelStep = persistedStep;
          }
        }
        persistLegacyModelStepRecordFromEvent({
          repository: this.modelStepRepository,
          request: input.request,
          event: eventWithRequest,
          fallbackStepId: currentModelStep.stepId,
        });
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
          persistLegacyModelStepRecordFromEvent({
            repository: this.modelStepRepository,
            request: input.request,
            event: eventWithRequest,
            fallbackStepId: currentModelStep.stepId,
            overrides: {
              status: 'succeeded',
              completedAt: eventWithRequest.createdAt,
            },
          });
          const completedStepId = eventWithRequest.stepId ?? currentModelStep.stepId;
          const completedStep = succeedAgentLoopModelCall({
            step: modelStepsById.get(completedStepId),
            completedAt: eventWithRequest.createdAt,
            lifecycle: {
              saveStep: (step) => {
                this.runExecutionFactRepository.saveStep(step);
              },
            },
          });
          if (completedStep) {
            modelStepsById.set(completedStepId, completedStep);
          }
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
      if (this.runRecordRepository.getRun(input.request.runId)?.status === 'cancelled') {
        return;
      }
      lastSequence = Math.max(lastSequence, this.runtimeEventLog.lastSequenceForRun(input.request.runId));
      const failedEvent = this.runtimeEventLog.withModelRequestMetadata({
        ...createRunFailedEvent({
          eventId: this.ids.eventId(),
          sessionId: input.request.sessionId,
          runId: input.request.runId,
          sequence: lastSequence += 1,
          createdAt: this.clock.now(),
          error: createRuntimeErrorFromUnknown(error, 'Session message run failed.'),
        }),
        stepId: currentModelStep.stepId,
      }, input.request);
      this.appendRuntimeEvent(failedEvent, input.chatStreamAdapter);
      terminalEvent = failedEvent;
      yield failedEvent;
    }

    if (input.pendingApprovalResumes.length > 0 && toolRuntime) {
      const waitingAt = this.clock.now();
      registerPendingApprovalGroup();
      const waitingEvent = this.runtimeEventLog.withModelRequestMetadata(createRunStatusChangedEvent({
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
      const failed = failAgentLoopModelCall({
        requestId: input.request.requestId,
        ...(input.request.runtimeContext ? { runtimeContext: input.request.runtimeContext } : {}),
        sessionId: input.request.sessionId,
        run: input.run,
        step: currentModelStep,
        error,
        startSequence: lastSequence,
        finishedAt: completedAt,
        ids: this.ids,
        lifecycle: {
          saveRun: (run) => {
            this.runRecordRepository.saveRun(run);
          },
          saveStep: (step) => {
            this.runExecutionFactRepository.saveStep(step);
          },
        },
      });
      for (const event of failed.events) {
        this.appendRuntimeEvent(event, input.chatStreamAdapter);
        yield event;
      }
      return;
    }

    if (terminalEvent?.eventType === 'run.cancelled') {
      const cancelled = cancelAgentLoopModelCall({
        requestId: input.request.requestId,
        ...(input.request.runtimeContext ? { runtimeContext: input.request.runtimeContext } : {}),
        sessionId: input.request.sessionId,
        run: input.run,
        step: currentModelStep,
        startSequence: lastSequence,
        finishedAt: completedAt,
        ids: this.ids,
        lifecycle: {
          saveRun: (run) => {
            this.runRecordRepository.saveRun(run);
          },
          saveStep: (step) => {
            this.runExecutionFactRepository.saveStep(step);
          },
        },
      });
      for (const event of cancelled.events) {
        this.appendRuntimeEvent(event, input.chatStreamAdapter);
        yield event;
      }
      return;
    }

    if (!(sawAssistantOutputCompleted || sawFinalModelStepCompleted) || assistantContent.length === 0) {
      return;
    }

    this.sessionMessageService.commitAssistantReply({
      sessionId: input.request.sessionId,
      runId: input.request.runId,
      content: assistantContent,
      completedAt,
    });

    const completed = completeAgentLoopModelCall({
      requestId: input.request.requestId,
      ...(input.request.runtimeContext ? { runtimeContext: input.request.runtimeContext } : {}),
      sessionId: input.request.sessionId,
      run: input.run,
      step: currentModelStep,
      startSequence: lastSequence,
      finishedAt: completedAt,
      ids: this.ids,
      lifecycle: {
        saveRun: (run) => {
          this.runRecordRepository.saveRun(run);
        },
        saveStep: (step) => {
          this.runExecutionFactRepository.saveStep(step);
        },
      },
    });

    for (const event of completed.events) {
      this.appendRuntimeEvent(event, input.chatStreamAdapter);
      if (event.eventType === 'run.completed') {
        this.postRunHooks.scheduleRunCompletedMemoryCapture({
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
          memoryEnabled: resolveMemoryEnabled(this.memorySettingsProvider),
        });
      }
      yield event;
    }
  }

  private appendRuntimeEvent(event: RuntimeEvent, chatStreamAdapter?: ChatStreamEventAdapter): void {
    this.runtimeEventLog.append(event, {
      ...(chatStreamAdapter ? { streamSink: chatStreamAdapter } : {}),
      onTerminalEvent: (terminalEvent) => this.publishRunTerminalEventHooks(terminalEvent, chatStreamAdapter),
    });
  }

  private publishRunTerminalEventHooks(event: RuntimeEvent, chatStreamAdapter?: ChatStreamEventAdapter): void {
    this.postRunHooks.publishWorkspaceChangeFooter({
      runId: String(event.runId),
      createdAt: event.createdAt,
      chatStreamAdapter,
    });
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

  private requireActivePathRepository(): SessionActivePathRepository {
    if (!this.activePathRepository) {
      throw new Error('Active path repository is not configured.');
    }

    return this.activePathRepository;
  }

  private async *resumeToolApprovalRun(
    approvalResume: ApprovalResumeGroup,
    input: ResumeToolApprovalInput,
  ): AsyncIterable<RuntimeEvent> {
    const pending = approvalResume.pendingByApprovalId.get(input.approvalRequestId);
    if (!pending) {
      return;
    }

    const resumeOutcome = await approvalResume.toolRuntime.resumeToolApproval(input);
    if (!resumeOutcome) {
      return;
    }
    const toolResults = [...(resumeOutcome.toolResults ?? (resumeOutcome.toolResult ? [resumeOutcome.toolResult] : []))];
    const chatStreamAdapter = approvalResume.chatStreamAdapter;

    let lastSequence = this.runtimeEventLog.lastSequenceForRun(approvalResume.request.runId);
    const resolvedPending = approvalResume.toolRuntime.resolvePendingApproval({
      registry: this.pendingApprovalRegistry,
      group: approvalResume,
      approvalRequestId: input.approvalRequestId,
      resolvedResults: toolResults,
    });
    if (!resolvedPending) {
      return;
    }

    const approvalResolvedEvent = approvalResume.toolRuntime.createApprovalResolvedRuntimeEvent({
      request: approvalResume.request,
      stepId: approvalResume.step.stepId,
      sequence: lastSequence += 1,
      approvalRequestId: input.approvalRequestId,
      decision: input.decision,
      scope: pending.pendingApproval.approvalRequest.requestedScope,
      decidedAt: input.decidedAt,
      ids: this.ids,
    });
    this.appendRuntimeEvent(approvalResolvedEvent, chatStreamAdapter);
    yield approvalResolvedEvent;

    if (
      approvalResume.pendingByApprovalId.size > 0
      || (resumeOutcome.pendingApprovals?.length ?? 0) > 0
      || resumeOutcome.nextModelInputReady === false
    ) {
      const resumeEvents = approvalResume.toolRuntime.collectApprovalResumeRuntimeEvents({
        request: approvalResume.request,
        stepId: approvalResume.step.stepId,
        lastSequence,
        outcome: resumeOutcome,
        toolResults,
        ids: this.ids,
      });
      lastSequence = resumeEvents.lastSequence;
      for (const event of resumeEvents.events) {
        this.appendRuntimeEvent(event, chatStreamAdapter);
        yield event;
      }
      return;
    }

    approvalResume.toolRuntime.closePendingApprovalGroup({
      registry: this.pendingApprovalRegistry,
      group: approvalResume,
    });
    const resumedRun = resumeRunAfterApproval({
      request: approvalResume.request,
      fallbackRun: approvalResume.run,
      repository: this.runRecordRepository,
      ids: this.ids,
      decidedAt: input.decidedAt,
      lastSequence,
    });
    const runningRun = resumedRun.run;
    lastSequence = resumedRun.lastSequence;
    this.appendRuntimeEvent(resumedRun.event, chatStreamAdapter);
    yield resumedRun.event;

    const resumeEvents = approvalResume.toolRuntime.collectApprovalResumeRuntimeEvents({
      request: approvalResume.request,
      stepId: approvalResume.step.stepId,
      lastSequence,
      outcome: resumeOutcome,
      toolResults,
      ids: this.ids,
    });
    lastSequence = resumeEvents.lastSequence;
    for (const event of resumeEvents.events) {
      this.appendRuntimeEvent(event, chatStreamAdapter);
      yield event;
    }

    const resumed = await approvalResume.toolRuntime.prepareApprovalResumeModelInput({
      pending,
      resolvedResults: approvalResume.resolvedResults,
      decidedAt: input.decidedAt,
      ...(approvalResume.projectRoot ? { projectRoot: approvalResume.projectRoot } : {}),
      ...(approvalResume.permissionMode ? { permissionMode: approvalResume.permissionMode } : {}),
      ...(approvalResume.memoryRecallSources ? { memoryRecallSources: approvalResume.memoryRecallSources } : {}),
      ...(approvalResume.memoryRecallSeed ? { memoryRecallSeed: approvalResume.memoryRecallSeed } : {}),
      repository: this.runExecutionFactRepository,
      modelCallInputBuildService: this.modelCallInputBuildService,
      sourceOverrideProvider: this.modelInputSourceOverrideProvider,
      ids: this.ids,
    });
    const resumedStep = resumed.step;
    const resumedToolResults = resumed.toolResults;
    const resumedModelInput = resumed.modelInput;
    if (resumedModelInput.failure) {
      const failed = failAgentLoopBeforeModelCall({
        requestId: pending.request.requestId,
        sessionId: pending.request.sessionId,
        run: runningRun,
        step: resumedStep,
        error: modelCallInputBuildFailureToRuntimeError(resumedModelInput.failure),
        startSequence: lastSequence,
        failedAt: input.decidedAt,
        ids: this.ids,
        lifecycle: {
          saveRun: (run) => {
            this.runRecordRepository.saveRun(run);
          },
          saveStep: (step) => {
            this.runExecutionFactRepository.saveStep(step);
          },
        },
      });
      for (const event of failed.events) {
        this.appendRuntimeEvent(event, chatStreamAdapter);
        yield event;
      }
      return;
    }
    const toolResultsSubmittedEvent = approvalResume.toolRuntime.markToolResultsSubmittedToModelInput({
      request: pending.request,
      stepId: resumedStep.stepId,
      toolResults: resumedToolResults,
      emittedAt: input.decidedAt,
      sequence: lastSequence += 1,
    });
    if (toolResultsSubmittedEvent) {
      this.appendRuntimeEvent(toolResultsSubmittedEvent, chatStreamAdapter);
      yield toolResultsSubmittedEvent;
    }
    const resumedLoop = streamApprovalResumeModelLoop({
      pendingRequest: pending.request,
      resumedStep,
      resumedInputContext: resumedModelInput.inputContext,
      decidedAt: input.decidedAt,
      toolRuntime: approvalResume.toolRuntime,
      modelCallPort: {
        streamModelCall: ({ request }) => this.requireModelCallProvider().streamModelCall(request),
      },
      modelCallInputBuildService: this.modelCallInputBuildService,
      sourceOverrideProvider: this.modelInputSourceOverrideProvider,
      ids: {
        nextEventId: this.ids.eventId,
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
      ...(approvalResume.projectRoot ? { projectRoot: approvalResume.projectRoot } : {}),
      permissionMode: approvalResume.permissionMode ?? 'default',
      memoryRecall: {
        ...(approvalResume.memoryRecallSources ? { memoryRecallSources: approvalResume.memoryRecallSources } : {}),
        ...(approvalResume.memoryRecallSeed ? { memoryRecallSeed: approvalResume.memoryRecallSeed } : {}),
      },
    });

    yield* this.persistModelCallEvents({
      request: resumedLoop.request,
      modelEvents: resumedLoop.modelEvents,
      pendingApprovalResumes: resumedLoop.pendingApprovalResumes,
      run: runningRun,
      step: resumedStep,
      userMessageId: approvalResume.userMessageId,
      startSequence: lastSequence,
      toolRuntime: approvalResume.toolRuntime,
      ...(approvalResume.projectId ? { projectId: approvalResume.projectId } : {}),
      ...(approvalResume.projectRoot ? { projectRoot: approvalResume.projectRoot } : {}),
      ...(chatStreamAdapter ? { chatStreamAdapter } : {}),
      ...(approvalResume.permissionMode ? { permissionMode: approvalResume.permissionMode } : {}),
      ...(approvalResume.memoryRecallSources ? { memoryRecallSources: approvalResume.memoryRecallSources } : {}),
      ...(approvalResume.memoryRecallSeed ? { memoryRecallSeed: approvalResume.memoryRecallSeed } : {}),
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

function getRunFailedError(payload: RuntimeEvent['payload']): RuntimeError | undefined {
  if (!isObjectRecord(payload)) {
    return undefined;
  }

  return isRuntimeError(payload.error) ? payload.error : undefined;
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

function isRuntimeError(value: unknown): value is RuntimeError {
  return isObjectRecord(value)
    && typeof value.code === 'string'
    && typeof value.message === 'string'
    && typeof value.severity === 'string'
    && typeof value.retryable === 'boolean'
    && typeof value.source === 'string';
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
