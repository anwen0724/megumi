// Orchestrates Coding Agent product session runs by coordinating input facts,
// product persistence, permissions, context construction, tools, and model execution.
import path from 'node:path';
import {
  assertRunStatusTransition,
  canResumeApprovalFromRunStatus,
} from './lifecycle/run-state-policy';
import { runTurn } from './lifecycle/run-lifecycle';
import { resumeRunAfterApproval, type RunHostBoundaryPort } from './lifecycle';
import { createDefaultAgentRunServiceIds } from './agent-run-service-ids';
import {
  PendingApprovalRegistry,
  createApprovalResolvedRuntimeEvent,
  createToolResultRuntimeEvent,
  persistResumeRuntimeEvents,
  type PendingToolApprovalContinuation,
  type ResumeToolApprovalInput,
  type ToolApprovalResumePort,
  type ToolCallRunner,
} from './tool-calls';
import {
  ModelCallInputBuildService,
  SessionCompactionOrchestrator,
  type BuildModelCallInputFailure,
  type BuildModelCallInputInput,
  type CompactIfNeededInput,
  type ModelInputMemoryRecallSource,
  type SessionCompactionOrchestrationResult,
} from './context';
import {
  SessionContextInputService,
  type SessionBranchServicePort,
} from '@megumi/coding-agent/session';
import {
  RunTurn,
  type RunTurnOptions,
} from './turn';
import { streamCodingAgentModelToolLoop } from './loop';
import {
  BUILT_IN_INPUT_COMMAND_REGISTRY,
} from '@megumi/coding-agent/input/command';
import {
  parseRawInput,
  type ParsedInput,
} from '@megumi/coding-agent/input';
import {
  createRunCompletedEvent,
  createRunFailedEvent,
  createRunStartedEvent,
  createRunStatusChangedEvent,
  createStepCompletedEvent,
  createStepFailedEvent,
  createStepStatusChangedEvent,
} from './events/runtime-event-factory';
import type { SessionActivePathRepository } from '../persistence/repos/session-active-path.repo';
import type { ToolRepository } from '../persistence/repos/tool.repo';
import type { ContextBudgetPolicy } from '@megumi/shared/context';
import type {
  RunContext,
  ModelCapabilitySummary,
} from '@megumi/shared/run';
import { isProviderId, type ProviderId } from '@megumi/shared/provider';
import type {
  ModelInputContextBuildRequest,
  ModelInputContextSourceRef,
} from '@megumi/shared/model';
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
  createToolContinuationEmittedEvent,
} from '@megumi/shared/runtime';
import type { ToolDefinition, ToolResult } from '@megumi/shared/tool';
import {
  normalizeSessionMessageInputPreprocessing,
  type NormalizedSessionMessageInputPreprocessing,
} from './runtime-input';
import type { PermissionSnapshotService } from '../permissions';
import type {
  RunToolRegistrySnapshotBuildInput,
  RunToolRegistrySnapshotBuildResult,
} from '@megumi/coding-agent/tools/tool-registry-snapshot';
import {
  withRequestMetadata,
  withSequenceAfter,
  withSessionMessageRequestMetadata,
} from './events/runtime-event-metadata';
import type {
  AgentRunCompletionHooksPort,
  AgentRunExecutionFactRepositoryPort,
  AgentRunMessageRepositoryPort,
  AgentRunModelStepProvider,
  AgentRunModelStepRepositoryPort,
  AgentRunPort,
  AgentRunRunRecordRepositoryPort,
  AgentRunRetryCoordinatorPort,
  AgentRunServiceClock,
  AgentRunServiceIds,
  AgentRunServiceOptions,
  AgentRunRuntimeEventRepositoryPort,
  AgentRunSessionContextRepositoryPort,
  AgentRunSessionRepositoryPort,
  AgentRunTerminalCoordinatorPort,
  AgentRunToolRuntimeFactory,
  SessionRunContextService,
  SessionRunEffectiveCwdProvider,
  SessionRunGlobalInstructionDirectoryProvider,
  SessionRunMemoryMarkdownSyncService,
  SessionRunMemoryRecallService,
  SessionRunMemorySettingsProvider,
  SessionRunModelCallInputBuildService,
  SessionRunProviderCapabilitySummaryProvider,
  SessionRunSessionContextInputService,
  SessionRunSessionInstructionSourceProvider,
  SessionRunToolDefinitionProvider,
  SessionRunToolRegistrySnapshotService,
  SessionRunWorkspaceChangeReadPort,
} from './run-contract';

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
  toolRuntime: ToolCallRunner & ToolApprovalResumePort;
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

export class AgentRunService implements AgentRunPort {
  private readonly sessionRepository: AgentRunSessionRepositoryPort;
  private readonly messageRepository: AgentRunMessageRepositoryPort;
  private readonly runRecordRepository: AgentRunRunRecordRepositoryPort;
  private readonly runExecutionFactRepository: AgentRunExecutionFactRepositoryPort;
  private readonly modelStepRepository: AgentRunModelStepRepositoryPort;
  private readonly sessionContextRepository: AgentRunSessionContextRepositoryPort;
  private readonly runtimeEventRepository: AgentRunRuntimeEventRepositoryPort;
  private readonly activePathRepository?: SessionActivePathRepository;
  private readonly contextService?: SessionRunContextService;
  private readonly permissionSnapshotService?: Pick<
    PermissionSnapshotService,
    | 'createPermissionSnapshot'
    | 'linkAcceptedSourcePlan'
  >;
  private readonly planArtifactService?: PlanArtifactServicePort;
  private readonly modelStepProvider?: AgentRunModelStepProvider;
  private readonly toolRuntimeFactory?: AgentRunToolRuntimeFactory;
  private readonly toolDefinitionProvider?: SessionRunToolDefinitionProvider;
  private readonly toolRegistrySnapshotService?: SessionRunToolRegistrySnapshotService;
  private readonly providerCapabilitySummaryProvider?: SessionRunProviderCapabilitySummaryProvider;
  private readonly toolRepository?: Pick<
    ToolRepository,
    'cancelPendingApprovalRequestsByRun' | 'cancelPendingToolExecutionsByRun' | 'failRunningToolExecutionsByRun' | 'markToolContinuationEmitted'
  >;
  private readonly modelCallInputBuildService: SessionRunModelCallInputBuildService;
  private readonly memoryRecallService?: SessionRunMemoryRecallService;
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
  private readonly sessionBranchService?: SessionBranchServicePort;
  private readonly hostBoundary: RunHostBoundaryPort;
  private readonly chatStreamEventSink?: ChatStreamEventSink;
  private readonly clock: AgentRunServiceClock;
  private readonly ids: AgentRunServiceIds;
  private readonly runTerminalCoordinator: AgentRunTerminalCoordinatorPort;
  private readonly runRetryCoordinator: AgentRunRetryCoordinatorPort;
  private readonly runCompletionHooks: AgentRunCompletionHooksPort;
  private readonly pendingApprovalRegistry = new PendingApprovalRegistry<ApprovalContinuationGroup>({
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
    this.runCompletionHooks = options.runCompletionHooks;
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
    this.modelCallInputBuildService = options.modelCallInputBuildService
      ?? new ModelCallInputBuildService({
        instructionSourceService: options.agentInstructionSourceService,
        defaultBudgetPolicy: DEFAULT_CONTEXT_BUDGET_POLICY,
      });
    this.chatStreamEventSink = options.chatStreamEventSink;
    this.sessionBranchService = options.sessionBranchService;
    this.clock = options.clock ?? defaultClock;
    this.ids = createDefaultAgentRunServiceIds(options.ids);
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

  private createRunTurnOptions(
    chatStreamAdapter?: ChatStreamEventAdapter,
  ): RunTurnOptions {
    const svc = this;
    return {
      clock: this.clock,
      ids: { eventId: this.ids.eventId },
      // === Required ports ===
      eventPort: {
        append(event, requestId, runtimeContext) {
          const lastSeq = nextRuntimeSequence(
            svc.runtimeEventRepository.listRuntimeEventsByRun(event.runId ?? ''),
          );
          const ev = withSessionMessageRequestMetadata(
            withSequenceAfter(event, lastSeq),
            { requestId, runtimeContext },
          );
          svc.appendRuntimeEvent(ev, chatStreamAdapter);
          return ev;
        },
      },
      runStatePort: {
        getRunStatus: (runId: string) => svc.runRecordRepository.getRun(runId)?.status,
      },
      failurePort: {
        async *failBeforeModelStep(failureInput) {
          const seq = Math.max(
            0,
            nextRuntimeSequence(svc.runtimeEventRepository.listRuntimeEventsByRun(String(failureInput.run.runId))),
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
      ...(this.providerCapabilitySummaryProvider ? { providerCapabilitySummaryProvider: this.providerCapabilitySummaryProvider } : {}),
      ...(this.toolRegistrySnapshotService ? {
        toolRegistrySnapshotProvider: {
          createRunSnapshot: (snapshotInput) => this.createToolRegistrySnapshotForCodingAgentRun({ ...snapshotInput }),
        },
      } : {}),
      ...(this.toolDefinitionProvider ? { toolDefinitionProvider: this.toolDefinitionProvider } : {}),
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
          create: (factoryInput) => this.toolRuntimeFactory!.create(factoryInput),
        },
      } : {}),
      modelCallInputBuildService: this.modelCallInputBuildService,
      ...(this.sessionCompactionOrchestrator ? { compactionOrchestrator: this.sessionCompactionOrchestrator } : {}),
      runEventRecorder: {
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
        markToolContinuationEmitted: ({ request, stepId, toolResults, emittedAt, sequence }) => {
          const event = svc.markToolContinuationEmitted({
            request,
            stepId,
            toolResults,
            emittedAt,
            sequence,
          });
          return event ? [event] : [];
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
          this.runtimeEventRepository.appendRuntimeEvent(event);
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

    const userMessage = this.messageRepository.saveMessage({
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
    const continuation = this.pendingApprovalRegistry.getByApprovalId(input.approvalRequestId);
    if (!continuation) {
      return undefined;
    }
    const persistedRun = this.runRecordRepository.getRun(continuation.request.runId) ?? continuation.run;
    if (!canResumeApprovalFromRunStatus(persistedRun.status)) {
      this.cancelPendingApprovalGroupsByRun(continuation.request.runId);
      return undefined;
    }

    return this.resumeApprovalContinuation(continuation, input);
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

  private resolveSessionForMessage(payload: SessionMessageSendPayload): Session {
    if (payload.sessionId) {
      const existing = this.sessionRepository.getSession(payload.sessionId);
      if (existing) {
        return existing;
      }
    }

    const createdAt = payload.createdAt;
    return this.sessionRepository.saveSession({
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
    parsedInput?: ParsedInput;
  }): AsyncIterable<RuntimeEvent> {
    const orchestrator = new RunTurn(
      this.createRunTurnOptions(input.chatStreamAdapter),
    );
    yield* orchestrator.runSessionMessage({
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
      const eventWithRequest = withSessionMessageRequestMetadata(event, {
        requestId: input.requestId,
        runtimeContext: input.runtimeContext,
      });
      this.appendRuntimeEvent(eventWithRequest, input.chatStreamAdapter);
      yield eventWithRequest;
    }
  }

  private async *persistModelCallEvents(input: {
    request: ModelStepRuntimeRequest;
    modelEvents: AsyncIterable<RuntimeEvent>;
    pendingContinuations: PendingToolApprovalContinuation[];
    run: Run;
    step: RunStep;
    userMessageId: string;
    toolRuntime?: ToolCallRunner & ToolApprovalResumePort;
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
    let registeredPendingGroup: ApprovalContinuationGroup | undefined;
    const modelStepsById = new Map<string, RunStep>([[input.step.stepId, input.step]]);

    const registerPendingApprovalGroup = (): ApprovalContinuationGroup | undefined => {
      if (registeredPendingGroup || input.pendingContinuations.length === 0 || !toolRuntime) {
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
      const group: ApprovalContinuationGroup = {
        groupId,
        request: input.request,
        run: waitingRun,
        step: waitingStep,
        ...(input.projectId ? { projectId: input.projectId } : {}),
        ...(input.projectRoot ? { projectRoot: input.projectRoot } : {}),
        ...(input.permissionMode ? { permissionMode: input.permissionMode } : {}),
        userMessageId: input.userMessageId,
        pendingByApprovalId: new Map(input.pendingContinuations.map((pending) => [
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
        lastSequence = Math.max(lastSequence, nextRuntimeSequence(this.runtimeEventRepository.listRuntimeEventsByRun(input.request.runId)));
        const eventWithRequest = withSequenceAfter(withRequestMetadata(event, input.request), lastSequence);
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
      lastSequence = Math.max(lastSequence, nextRuntimeSequence(this.runtimeEventRepository.listRuntimeEventsByRun(input.request.runId)));
      const failedEvent = withRequestMetadata({
        ...createRunFailedEvent({
          eventId: this.ids.eventId(),
          sessionId: input.request.sessionId,
          runId: input.request.runId,
          sequence: lastSequence += 1,
          createdAt: this.clock.now(),
          error: createRuntimeErrorFromUnknown(error),
        }),
        stepId: currentModelStep.stepId,
      }, input.request);
      this.appendRuntimeEvent(failedEvent, input.chatStreamAdapter);
      terminalEvent = failedEvent;
      yield failedEvent;
    }

    if (input.pendingContinuations.length > 0 && toolRuntime) {
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
        const eventWithRequest = withRequestMetadata(event, input.request);
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
        const eventWithRequest = withRequestMetadata(event, input.request);
        this.appendRuntimeEvent(eventWithRequest, input.chatStreamAdapter);
        yield eventWithRequest;
      }
      return;
    }

    if (!(sawAssistantOutputCompleted || sawFinalModelStepCompleted) || assistantContent.length === 0) {
      return;
    }

    const assistantMessage = this.messageRepository.saveMessage({
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
      const eventWithRequest = withRequestMetadata(event, input.request);
      this.appendRuntimeEvent(eventWithRequest, input.chatStreamAdapter);
      if (eventWithRequest.eventType === 'run.completed') {
        this.runCompletionHooks.scheduleRunCompletedMemoryCapture({
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
    return this.runRetryCoordinator.recordManualRerunAttemptForBranchDraft(input);
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
      this.runCompletionHooks.publishWorkspaceChangeFooter({
        runId: String(event.runId),
        createdAt: event.createdAt,
        chatStreamAdapter,
      });
    }
    this.runtimeEventRepository.appendRuntimeEvent(event);
    chatStreamAdapter?.handleRuntimeEvent?.(event);
    if (isRunTerminalRuntimeEvent(event)) {
      chatStreamAdapter?.dispose?.();
    }
  }

  private cancelPendingApprovalGroupsByRun(runId: string): void {
    this.pendingApprovalRegistry.cancelByRun(runId);
  }

  private requireModelStepProvider(): AgentRunModelStepProvider {
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

  private async *resumeApprovalContinuation(
    continuation: ApprovalContinuationGroup,
    input: ResumeToolApprovalInput,
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

    let lastSequence = nextRuntimeSequence(this.runtimeEventRepository.listRuntimeEventsByRun(continuation.request.runId));
    continuation.pendingByApprovalId.delete(input.approvalRequestId);
    this.pendingApprovalRegistry.deleteApproval(input.approvalRequestId);
    continuation.resolvedResults.push(...toolResults);

    const approvalResolvedEvent = createApprovalResolvedRuntimeEvent({
      request: continuation.request,
      stepId: continuation.step.stepId,
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
      continuation.pendingByApprovalId.size > 0
      || (resumeOutcome.pendingApprovals?.length ?? 0) > 0
      || resumeOutcome.continuationReady === false
    ) {
      const resumeEvents = persistResumeRuntimeEvents({
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
        const toolResultEvent = createToolResultRuntimeEvent({
          request: continuation.request,
          stepId: continuation.step.stepId,
          sequence: lastSequence += 1,
          toolResult,
          ids: this.ids,
        });
        this.appendRuntimeEvent(toolResultEvent, chatStreamAdapter);
        yield toolResultEvent;
      }
      return;
    }

    this.pendingApprovalRegistry.deleteGroup(continuation.groupId);
    const resumedRun = resumeRunAfterApproval({
      request: continuation.request,
      fallbackRun: continuation.run,
      repository: this.runRecordRepository,
      ids: this.ids,
      decidedAt: input.decidedAt,
      lastSequence,
    });
    const runningRun = resumedRun.run;
    lastSequence = resumedRun.lastSequence;
    this.appendRuntimeEvent(resumedRun.event, chatStreamAdapter);
    yield resumedRun.event;

    const resumeEvents = persistResumeRuntimeEvents({
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
      const toolResultEvent = createToolResultRuntimeEvent({
        request: continuation.request,
        stepId: continuation.step.stepId,
        sequence: lastSequence += 1,
        toolResult,
        ids: this.ids,
      });
      this.appendRuntimeEvent(toolResultEvent, chatStreamAdapter);
      yield toolResultEvent;
    }

    const resumedStep = this.runExecutionFactRepository.saveStep({
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
    const resumedModelInput = await this.modelCallInputBuildService.buildModelCallInput({
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
        error: modelCallInputBuildFailureToRuntimeError(resumedModelInput.failure),
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

    const pendingContinuations: PendingToolApprovalContinuation[] = [];
    const resumedModelEvents = streamCodingAgentModelToolLoop({
      request: resumedRequest,
      ports: {
        modelCallPort: {
          streamModelCall: ({ request }) => this.requireModelStepProvider().streamModelCall(request),
        },
        toolCallHandler: continuation.toolRuntime,
        modelCallInputBuildService: this.modelCallInputBuildService,
        sourceOverrideProvider: {
          resolveModelInputSourceOverrides: (sourceInput) => this.modelInputRuntimeSourceOverrides(sourceInput),
        },
        toolContinuationRecorder: {
          markToolContinuationEmitted: ({ request, stepId, toolResults, emittedAt, sequence }) => {
            const event = this.markToolContinuationEmitted({
              request,
              stepId,
              toolResults,
              emittedAt,
              sequence,
            });
            return event ? [event] : [];
          },
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
      },
      ...(continuation.projectRoot ? { projectRoot: continuation.projectRoot } : {}),
      permissionMode: continuation.permissionMode ?? 'default',
      memoryRecall: {
        ...(continuation.memoryRecallSources ? { memoryRecallSources: continuation.memoryRecallSources } : {}),
        ...(continuation.memoryRecallSeed ? { memoryRecallSeed: continuation.memoryRecallSeed } : {}),
      },
      onPendingApproval: (pendingContinuation) => {
        pendingContinuations.push(pendingContinuation);
      },
    });

    yield* this.persistModelCallEvents({
      request: resumedRequest,
      modelEvents: resumedModelEvents,
      pendingContinuations,
      run: runningRun,
      step: resumedStep,
      userMessageId: continuation.userMessageId,
      startSequence: lastSequence,
      toolRuntime: continuation.toolRuntime,
      ...(continuation.projectId ? { projectId: continuation.projectId } : {}),
      ...(continuation.projectRoot ? { projectRoot: continuation.projectRoot } : {}),
      ...(chatStreamAdapter ? { chatStreamAdapter } : {}),
      ...(continuation.permissionMode ? { permissionMode: continuation.permissionMode } : {}),
      ...(continuation.memoryRecallSources ? { memoryRecallSources: continuation.memoryRecallSources } : {}),
      ...(continuation.memoryRecallSeed ? { memoryRecallSeed: continuation.memoryRecallSeed } : {}),
    });
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

function createFallbackRuntimeError(message: string): RuntimeError {
  return {
    code: 'runtime_unknown',
    message,
    severity: 'error',
    retryable: false,
    source: 'core',
  };
}

function modelCallInputBuildFailureToRuntimeError(failure: BuildModelCallInputFailure): RuntimeError {
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

function nextRuntimeSequence(events: RuntimeEvent[]): number {
  return events.reduce((max, event) => Math.max(max, event.sequence), 0);
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
