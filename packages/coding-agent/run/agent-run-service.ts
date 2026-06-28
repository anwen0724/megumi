// Orchestrates Coding Agent product session runs by coordinating input facts,
// product persistence, permissions, context construction, tools, and model execution.
import {
  assertRunStatusTransition,
  canResumeApprovalFromRunStatus,
  resumeRunAfterApproval,
  type RunRetryCoordinatorPort,
  type RunTerminalCoordinatorPort,
} from '../state';
import { runTurn, type RunHostBoundaryPort } from '../state/lifecycle';
import { createDefaultAgentRunServiceIds } from './agent-run-service-ids';
import {
  ensureToolCallRunnerService,
  PendingApprovalRegistry,
  type PendingToolApprovalResume,
  type ResumeToolApprovalInput,
  type ToolCallRunnerService,
} from '../agent-loop/tool-call';
import {
  DEFAULT_CONTEXT_BUDGET_POLICY,
  ModelCallInputBuildService,
  SessionCompactionOrchestrator,
  type BuildModelCallInputInput,
  type CompactIfNeededInput,
  type ModelCallInputBuildPort,
  type ModelInputMemoryRecallSource,
  type RunBaselineContextPort,
  type SessionCompactionOrchestrationResult,
} from '../context';
import {
  assertActiveBranchDraftMarker as assertSessionActiveBranchDraftMarker,
  SessionContextInputService,
  SessionTurnPreparationService,
  type SessionBranchServicePort,
  type SessionContextInputBuildPort,
} from '@megumi/coding-agent/session';
import {
  AgentLoop,
  type AgentLoopOptions,
  streamApprovalResumeModelLoop,
  ToolSetService,
  type ToolSetCapabilityProvider,
  type ToolSetRegistryProvider,
} from '../agent-loop';
import type { ModelCallProvider } from '../agent-loop/model-call';
import type { ToolRuntimeFactory } from '../agent-loop/tool-call';
import {
  BUILT_IN_INPUT_COMMAND_REGISTRY,
} from '@megumi/coding-agent/input/command';
import type { AgentRunPort } from '../product-runtime';
import {
  parseRawInput,
  normalizeSessionMessageInputPreprocessing,
  type ParsedInput,
  type NormalizedSessionMessageInputPreprocessing,
} from '@megumi/coding-agent/input';
import {
  createRunCompletedEvent,
  createRunFailedEvent,
  createRunStartedEvent,
  createRunStatusChangedEvent,
  createStepCompletedEvent,
  createStepFailedEvent,
  createStepStatusChangedEvent,
  createRuntimeErrorFromUnknown,
  modelCallInputBuildFailureToRuntimeError,
  RuntimeEventLog,
} from '../events';
import type { SessionActivePathRepository } from '../persistence/repos/session-active-path.repo';
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
import type {
  RunContext,
  ModelCapabilitySummary,
} from '@megumi/shared/run';
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
  SessionMessageCancelPayload,
  SessionMessageSendData,
  SessionMessageSendPayload,
} from '@megumi/shared/ipc';
import {
  createChatStreamEventAdapter,
  type ChatStreamEventAdapter,
  type ChatStreamEventSink,
} from '../projections/chat-stream';
import type { ModelStepRuntimeRequest } from '@megumi/shared/model';
import type {
  ImplementationPlanArtifactRecord,
  PermissionModeState,
  PermissionSnapshotRecord,
} from '@megumi/shared/permission';
import type { PlanArtifactServicePort } from '../artifacts';
import type { RuntimeContext } from '@megumi/shared/runtime';
import type { RuntimeError } from '@megumi/shared/runtime';
import type { RuntimeEvent } from '@megumi/shared/runtime';
import {
  createToolRegistryEntryResolvedEvent,
  createToolRegistryModelVisibleToolsDerivedEvent,
  createToolRegistrySnapshotCreatedEvent,
  createToolRegistrySourcesEnsuredEvent,
} from '@megumi/shared/runtime';
import type { ToolDefinition, ToolResult } from '@megumi/shared/tool';
import type { PermissionSnapshotService } from '../permissions';
import type { PostRunHooksPort } from '../hooks';
import type {
  RunToolRegistrySnapshotBuildInput,
  RunToolRegistrySnapshotBuildResult,
  ToolRegistrySnapshotServicePort,
} from '@megumi/coding-agent/tools/tool-registry-snapshot';
import type {
  AgentRunServiceClock,
  AgentRunServiceIds,
  AgentRunServiceOptions,
  SessionRunEffectiveCwdProvider,
  SessionRunGlobalInstructionDirectoryProvider,
  SessionRunMemoryMarkdownSyncService,
  SessionRunMemoryRecallService,
  SessionRunMemorySettingsProvider,
  SessionRunSessionInstructionSourceProvider,
} from './run-contract';

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

interface SessionRunMemoryRecallSnapshot {
  memoryRecallSources?: ModelInputMemoryRecallSource[];
  memoryRecallSeed?: ModelInputContextBuildRequest['memoryRecallSeed'];
}

const defaultClock: AgentRunServiceClock = {
  now: () => new Date().toISOString(),
};

const DEFAULT_MODEL_CAPABILITY_SUMMARY: ModelCapabilitySummary = {
  providerId: 'unknown',
  modelId: 'unknown',
  modelContextWindow: 8192,
};

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
  private readonly permissionSnapshotService?: Pick<
    PermissionSnapshotService,
    | 'createPermissionSnapshot'
    | 'linkAcceptedSourcePlan'
  >;
  private readonly planArtifactService?: PlanArtifactServicePort;
  private readonly modelStepProvider?: ModelCallProvider;
  private readonly toolRuntimeFactory?: ToolRuntimeFactory;
  private readonly toolDefinitionProvider?: ToolSetRegistryProvider;
  private readonly toolRegistrySnapshotService?: ToolRegistrySnapshotServicePort;
  private readonly providerCapabilitySummaryProvider?: ToolSetCapabilityProvider;
  private readonly toolRepository?: AgentRunToolRepositoryPort;
  private readonly modelCallInputBuildService: ModelCallInputBuildPort;
  private readonly memoryRecallService?: SessionRunMemoryRecallService;
  private readonly memorySettingsProvider?: SessionRunMemorySettingsProvider;
  private readonly memoryMarkdownSyncService?: SessionRunMemoryMarkdownSyncService;
  private readonly megumiHomePath?: string;
  private readonly globalInstructionDirectoryProvider?: SessionRunGlobalInstructionDirectoryProvider;
  private readonly sessionInstructionSourceProvider?: SessionRunSessionInstructionSourceProvider;
  private readonly runEffectiveCwdProvider?: SessionRunEffectiveCwdProvider;
  private readonly sessionContextInputService: SessionContextInputBuildPort;
  private readonly sessionTurnPreparationService: SessionTurnPreparationService;
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
  private readonly activeSessionMessageRuns = new Map<string, {
    runId: string;
    sessionId: string;
    stepId: string;
    chatStreamAdapter?: ChatStreamEventAdapter;
  }>();

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
    this.modelStepProvider = options.modelStepProvider;
    this.toolRuntimeFactory = options.toolRuntimeFactory;
    this.toolDefinitionProvider = options.toolDefinitionProvider;
    this.toolRegistrySnapshotService = options.toolRegistrySnapshotService;
    this.providerCapabilitySummaryProvider = options.providerCapabilitySummaryProvider;
    this.toolRepository = options.toolRepository;
    this.memoryRecallService = options.memoryRecallService;
    this.memorySettingsProvider = options.memorySettingsProvider;
    this.memoryMarkdownSyncService = options.memoryMarkdownSyncService;
    this.megumiHomePath = options.megumiHomePath;
    this.globalInstructionDirectoryProvider = options.globalInstructionDirectoryProvider;
    this.sessionInstructionSourceProvider = options.sessionInstructionSourceProvider;
    this.runEffectiveCwdProvider = options.runEffectiveCwdProvider;
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
    this.sessionTurnPreparationService = new SessionTurnPreparationService({
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
      ?? (options.modelStepProvider && options.sessionCompactionRepository
        ? new SessionCompactionOrchestrator({
            repository: options.sessionCompactionRepository,
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
    BuildModelCallInputInput,
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


  private createToolRegistrySnapshotForCodingAgentRun(input: RunToolRegistrySnapshotBuildInput & {
    sessionId: string;
    providerCapabilitySummary?: { supportsToolCall?: boolean };
  }): {
    modelVisibleToolDefinitions: ToolDefinition[];
    events: RuntimeEvent[];
  } {
    if (!this.toolRegistrySnapshotService) {
      return { modelVisibleToolDefinitions: [], events: [] };
    }

    const registrySnapshotResult = this.toolRegistrySnapshotService.createRunSnapshot(input);
    const events = [
      createToolRegistrySourcesEnsuredEvent({
        eventId: this.ids.eventId(),
        runId: input.runId,
        sessionId: input.sessionId,
        sequence: 1,
        createdAt: input.createdAt,
        payload: {
          sourceIds: registrySnapshotResult.diagnostics.sourceIds,
          createdSourceIds: registrySnapshotResult.diagnostics.createdSourceIds,
        },
      }),
      createToolRegistrySnapshotCreatedEvent({
        eventId: this.ids.eventId(),
        runId: input.runId,
        sessionId: input.sessionId,
        sequence: 2,
        createdAt: input.createdAt,
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
      ...registrySnapshotResult.snapshot.entries.map((entry, index) => createToolRegistryEntryResolvedEvent({
        eventId: this.ids.eventId(),
        runId: input.runId,
        sessionId: input.sessionId,
        sequence: index + 3,
        createdAt: input.createdAt,
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
        runId: input.runId,
        sessionId: input.sessionId,
        sequence: registrySnapshotResult.snapshot.entries.length + 3,
        createdAt: input.createdAt,
        payload: {
          snapshotId: registrySnapshotResult.snapshot.snapshotId,
          modelId: registrySnapshotResult.snapshot.modelId,
          modelSupportsToolCall: registrySnapshotResult.diagnostics.modelSupportsToolCall,
          toolNames: registrySnapshotResult.diagnostics.modelVisibleToolNames,
          hiddenCount: registrySnapshotResult.diagnostics.hiddenCount,
        },
      }),
    ];

    return { modelVisibleToolDefinitions: registrySnapshotResult.modelVisibleToolDefinitions, events };
  }

  private createAgentLoopOptions(
    chatStreamAdapter?: ChatStreamEventAdapter,
  ): AgentLoopOptions {
    const svc = this;
    const toolSetService = new ToolSetService({
      ...(this.toolRegistrySnapshotService ? {
        snapshotProvider: {
          createRunSnapshot: (snapshotInput) => this.createToolRegistrySnapshotForCodingAgentRun({ ...snapshotInput }),
        },
      } : {}),
      ...(this.toolDefinitionProvider ? { registryProvider: this.toolDefinitionProvider } : {}),
      ...(this.providerCapabilitySummaryProvider ? { capabilityProvider: this.providerCapabilitySummaryProvider } : {}),
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
        async *failBeforeModelStep(failureInput) {
          const seq = Math.max(
            0,
            svc.runtimeEventLog.lastSequenceForRun(String(failureInput.run.runId)),
          );
          yield* svc.failRunBeforeModelStep({
            requestId: failureInput.requestId,
            runtimeContext: failureInput.runtimeContext,
            sessionId: failureInput.sessionId,
            run: failureInput.run,
            step: failureInput.step,
            error: failureInput.error,
            startSequence: seq,
            createdAt: svc.clock.now(),
            chatStreamAdapter,
          });
        },
      },
      // === Optional / passthrough ports ===
      ...(this.contextService ? { contextService: this.contextService } : {}),
      toolSetService,
      sessionContextInputService: this.sessionContextInputService,
      sourceOverrideProvider: {
        resolveModelInputSourceOverrides: (sourceInput) => this.modelInputRuntimeSourceOverrides(sourceInput),
      },
      ...(this.memoryRecallService ? {
        memoryRecallService: {
          recallForNewUserInput: (recallInput) => this.recallMemoryForNewUserInput({ ...recallInput }),
        },
      } : {}),
      modelCallPort: {
        streamModelCall: ({ request }) => this.requireModelStepProvider().streamModelCall(request),
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

  getPlanByRun(runId: string): ImplementationPlanArtifactRecord | undefined {
    return this.requirePlanArtifactService().getPlanByRun(runId);
  }

  updatePlanStatus(input: PlanStatusUpdatePayload): ImplementationPlanArtifactRecord {
    return this.requirePlanArtifactService().updatePlanStatus(input);
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
    const currentUserMessage = currentUserChatMessage(input.payload);
    if (!currentUserMessage) {
      throw new Error('Session message send requires a user message.');
    }
    // Renderer preprocessing is treated as transport metadata here; this
    // runtime normalization is the trust boundary before persistence and model input.
    const normalizedInput: NormalizedSessionMessageInputPreprocessing = normalizeSessionMessageInputPreprocessing({
      rawText: currentUserMessage.content,
      requestedPermissionMode: input.payload.context?.permissionMode,
      requestedPermissionSource: input.payload.context?.permissionSource,
      preprocessing: input.payload.context?.preprocessing,
      createdAt,
    });
    const permissionMode = normalizedInput.permissionMode;
    const permissionSource = normalizedInput.permissionSource;
    const mode = permissionMode;
    const inputMetadata = normalizedInput.metadata;
    const preparedTurn = this.sessionTurnPreparationService.prepareUserInputTurn({
      ...(input.payload.sessionId ? { sessionId: input.payload.sessionId } : {}),
      ...(input.payload.context?.sessionTitle ? { sessionTitle: input.payload.context.sessionTitle } : {}),
      ...(input.payload.context?.workspaceId ? { workspaceId: input.payload.context.workspaceId } : {}),
      ...(input.payload.context?.workspacePath ? { workspacePath: input.payload.context.workspacePath } : {}),
      runId,
      content: currentUserMessage.content,
      messageCreatedAt: currentUserMessage.createdAt,
      createdAt,
    });
    const { session, userMessage } = preparedTurn;
    const rawInputId = `raw-input:${runId}:${userMessage.messageId}`;
    const parsedInput = parseRawInput({
      id: rawInputId,
      source: {
        kind: 'desktop',
        surface: 'session-message',
      },
      text: currentUserMessage.content,
      target: {
        kind: 'session',
        sessionId: String(session.sessionId),
      },
      metadata: {
        requestId: input.requestId,
      },
      createdAt,
    }, {
      commandRegistry: BUILT_IN_INPUT_COMMAND_REGISTRY,
    });
    const initialRun = this.runRecordRepository.saveRun({
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
      ? this.runRecordRepository.saveRun({
          ...initialRun,
          permissionSnapshotRef: permissionSnapshot.permissionSnapshotId,
        })
      : initialRun;
    this.sessionTurnPreparationService.recordSessionRunSource({
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
    const step = this.runExecutionFactRepository.saveStep({
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
    chatStreamAdapter?.startTurn?.();
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
        parsedInput,
      })),
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
    const providerCancelled = this.modelStepProvider?.cancelModelCall(payload.targetRequestId) ?? false;
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
      appendEvent: (event) => this.appendRuntimeEvent(event, activeRun.chatStreamAdapter),
    });

    if (result.shouldForgetActiveRun) {
      this.activeSessionMessageRuns.delete(payload.targetRequestId);
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
    return this.runtimeEventRepository.listRuntimeEventsByRun(runId);
  }

  private async *trackActiveSessionMessageRun(
    requestId: string,
    events: AsyncIterable<RuntimeEvent>,
  ): AsyncIterable<RuntimeEvent> {
    try {
      yield* events;
    } finally {
      const activeRun = this.activeSessionMessageRuns.get(requestId);
      const persistedRun = activeRun ? this.runRecordRepository.getRun(activeRun.runId) : undefined;
      if (persistedRun?.status !== 'waiting_for_approval') {
        this.activeSessionMessageRuns.delete(requestId);
      }
    }
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
        permissionSnapshot: toModelVisiblePermissionSnapshot(input.permissionSnapshot, input.payload.createdAt),
        permissionSnapshotRef: input.permissionSnapshot.permissionSnapshotId,
      } : {}),
      ...(input.runtimeContext ? { runtimeContext: input.runtimeContext } : {}),
      createdAt: input.payload.createdAt,
      memoryEnabled: this.resolveMemoryEnabled(),
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
    const failedRun = this.runRecordRepository.saveRun({
      ...input.run,
      status: 'failed',
      completedAt: input.createdAt,
      error: input.error,
    });
    const failedStep = this.runExecutionFactRepository.saveStep({
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
      const eventWithRequest = this.runtimeEventLog.withRuntimeRequestMetadata(event, {
        requestId: input.requestId,
        ...(input.runtimeContext ? { runtimeContext: input.runtimeContext } : {}),
      });
      this.appendRuntimeEvent(eventWithRequest, input.chatStreamAdapter);
      yield eventWithRequest;
    }
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

      const currentRun = this.runRecordRepository.getRun(input.request.runId) ?? input.run;
      assertRunStatusTransition(currentRun.status, 'waiting_for_approval');
      const waitingRun = this.runRecordRepository.saveRun({
        ...currentRun,
        status: 'waiting_for_approval',
      });
      const waitingStep = this.runExecutionFactRepository.saveStep({
        ...currentModelStep,
        status: 'waiting_for_approval',
      });
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
      const failedStep = this.runExecutionFactRepository.saveStep({
        ...currentModelStep,
        status: 'failed',
        completedAt,
        error,
      });
      this.runRecordRepository.saveRun({
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
        const eventWithRequest = this.runtimeEventLog.withModelRequestMetadata(event, input.request);
        this.appendRuntimeEvent(eventWithRequest, input.chatStreamAdapter);
        yield eventWithRequest;
      }
      return;
    }

    if (terminalEvent?.eventType === 'run.cancelled') {
      const cancelledStep = this.runExecutionFactRepository.saveStep({
        ...currentModelStep,
        status: 'cancelled',
        completedAt,
      });
      this.runRecordRepository.saveRun({
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
        const eventWithRequest = this.runtimeEventLog.withModelRequestMetadata(event, input.request);
        this.appendRuntimeEvent(eventWithRequest, input.chatStreamAdapter);
        yield eventWithRequest;
      }
      return;
    }

    if (!(sawAssistantOutputCompleted || sawFinalModelStepCompleted) || assistantContent.length === 0) {
      return;
    }

    this.sessionTurnPreparationService.commitAssistantReply({
      sessionId: input.request.sessionId,
      runId: input.request.runId,
      content: assistantContent,
      completedAt,
    });

    const completedStep = this.runExecutionFactRepository.saveStep({
      ...currentModelStep,
      status: 'succeeded',
      completedAt,
    });
    this.runRecordRepository.saveRun({
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
      const eventWithRequest = this.runtimeEventLog.withModelRequestMetadata(event, input.request);
      this.appendRuntimeEvent(eventWithRequest, input.chatStreamAdapter);
      if (eventWithRequest.eventType === 'run.completed') {
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
          memoryEnabled: this.resolveMemoryEnabled(),
        });
      }
      yield eventWithRequest;
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

  private requireModelStepProvider(): ModelCallProvider {
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

  private requirePermissionSnapshotService(): NonNullable<AgentRunServiceOptions['permissionSnapshotService']> {
    if (!this.permissionSnapshotService) {
      throw new Error('Permission snapshot service is not configured.');
    }

    return this.permissionSnapshotService;
  }

  private requirePlanArtifactService(): PlanArtifactServicePort {
    if (!this.planArtifactService) {
      throw new Error('Plan artifact service is not configured.');
    }

    return this.planArtifactService;
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
      sourceOverrideProvider: {
        resolveModelInputSourceOverrides: (sourceInput) => this.modelInputRuntimeSourceOverrides(sourceInput),
      },
      ids: this.ids,
    });
    const resumedStep = resumed.step;
    const resumedToolResults = resumed.toolResults;
    const resumedModelInput = resumed.modelInput;
    if (resumedModelInput.failure) {
      yield* this.failRunBeforeModelStep({
        requestId: pending.request.requestId,
        sessionId: pending.request.sessionId,
        run: runningRun,
        step: resumedStep,
        error: modelCallInputBuildFailureToRuntimeError(resumedModelInput.failure),
        startSequence: lastSequence,
        createdAt: input.decidedAt,
        chatStreamAdapter,
      });
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
        streamModelCall: ({ request }) => this.requireModelStepProvider().streamModelCall(request),
      },
      modelCallInputBuildService: this.modelCallInputBuildService,
      sourceOverrideProvider: {
        resolveModelInputSourceOverrides: (sourceInput) => this.modelInputRuntimeSourceOverrides(sourceInput),
      },
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

    const existing = this.modelStepRepository.getModelStep(modelStepId);
    this.modelStepRepository.saveModelStep({
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

    const completedStep = this.runExecutionFactRepository.saveStep({
      ...step,
      status: 'succeeded',
      completedAt,
    });
    modelStepsById.set(stepId, completedStep);
    return completedStep;
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
