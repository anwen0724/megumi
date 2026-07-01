// Owns the Coding Agent model/tool execution loop for one user input.
import type { ContextBudgetPolicy } from '@megumi/shared/context';
import type { InputPreprocessingResult } from '@megumi/coding-agent/input';
import type {
  ModelInputContext,
  ModelInputContextBuildRequest,
  ModelStepProviderState,
  ModelStepRuntimeRequest,
} from '@megumi/shared/model';
import type { ModelCapabilitySummary } from '@megumi/shared/run';
import type { PermissionMode, PermissionModeSnapshot } from '@megumi/shared/permission';
import { isProviderId, type ProviderId } from '@megumi/shared/provider';
import type { RuntimeContext, RuntimeError, RuntimeEvent, TypedRuntimeEvent } from '@megumi/shared/runtime';
import { RuntimeEventSchema } from '@megumi/shared/runtime';
import {
  createRunFailedEvent as createModelLoopRunFailedEvent,
  createToolRegistryEntryResolvedEvent,
  createToolRegistryModelVisibleToolsDerivedEvent,
  createToolRegistrySnapshotCreatedEvent,
  createToolRegistrySourcesEnsuredEvent,
  createToolResultCreatedEvent,
} from '@megumi/shared/runtime';
import type { Run, RunStep, Session, SessionContextInput, SessionMessage } from '@megumi/shared/session';
import type { ToolCall, ToolDefinition, ToolResult } from '@megumi/shared/tool';
import type { ParsedInput } from '../input';
import {
  AgentLoopInitialModelInputPreparationService,
  type AgentLoopInitialModelInputPreparation,
  type BuildModelCallInputInput,
  type BuildModelCallInputResult,
  type CompactIfNeededInput,
  createModelCallInputContextId,
  type ModelInputMemoryRecallSource,
  type PrepareAgentLoopInitialModelInputInput,
  type SessionCompactionOrchestrationResult,
} from '../context';
import {
  coalesceTextDeltaRuntimeEvents,
  createRunFailedEvent as createRuntimeRunFailedEvent,
  createRunStartedEvent,
  createRunStatusChangedEvent,
  createRuntimeErrorFromUnknown,
  modelCallInputBuildFailureToRuntimeError,
} from '../events';
import type { BuildSessionContextInputFromRepositoryInput } from '../session';
import type {
  RunToolRegistrySnapshotBuildInput,
  ToolRegistrySnapshotServicePort,
} from '../tools/tool-registry-snapshot';
import { runModelCall, type ModelCallPort } from './model-call';
import {
  cancelAgentLoopModelCall,
  completeAgentLoopModelCall,
  createTerminalRuntimeError,
  failAgentLoopModelCall,
  failAgentLoopBeforeModelCall,
  resumeRunAfterApproval,
  succeedAgentLoopModelCall,
} from '../state';
import type {
  ApprovalResumeGroup,
  PendingToolApprovalResume,
  PendingApprovalRegistry,
  ResumeToolApprovalInput,
  ToolApprovalResumePort,
  ToolCallRunnerService,
  ToolResultModelInputBuildInput,
  ToolCallRunner,
} from './tool-call';
import { registerApprovalResumeGroup } from './tool-call';
import {
  DEFAULT_MAX_MODEL_STEPS,
  DEFAULT_MAX_TOOL_ROUNDS,
} from './loop-limits';

export interface ModelToolLoopIds {
  nextEventId: () => string;
  nextStepId: () => string;
  nextModelStepId: () => string;
}

export interface RunModelToolLoopInput {
  request: ModelStepRuntimeRequest;
  modelCallPort: ModelCallPort;
  toolCallHandler: ToolCallRunner;
  ids: ModelToolLoopIds;
  signal?: AbortSignal;
  maxModelSteps?: number;
  maxToolRounds?: number;
  onPendingApproval?: (approvalResume: PendingToolApprovalResume) => void;
  onToolResultsSubmittedToModelInput?: (input: {
    request: ModelStepRuntimeRequest;
    toolResults: readonly ToolResult[];
    emittedAt: string;
  }) => readonly RuntimeEvent[] | void | Promise<readonly RuntimeEvent[] | void>;
  buildNextModelInputContext: (
    input: ToolResultModelInputBuildInput
  ) => ModelInputContext | Promise<ModelInputContext>;
}

export interface ToolSetSnapshotProvider {
  createRunSnapshot(input: {
    runId: string;
    sessionId: string;
    projectId: string;
    permissionMode: PermissionMode;
    modelId: string;
    createdAt: string;
    providerCapabilitySummary?: { supportsToolCall?: boolean };
  }): {
    modelVisibleToolDefinitions: ToolDefinition[];
    events: RuntimeEvent[];
  };
}

export function createToolSetSnapshotProvider(input: {
  snapshotService: ToolRegistrySnapshotServicePort;
  eventId: () => string;
}): ToolSetSnapshotProvider {
  return {
    createRunSnapshot: (snapshotInput) => createToolSetSnapshot({
      ...snapshotInput,
      snapshotService: input.snapshotService,
      eventId: input.eventId,
    }),
  };
}

function createToolSetSnapshot(input: RunToolRegistrySnapshotBuildInput & {
  sessionId: string;
  snapshotService: ToolRegistrySnapshotServicePort;
  eventId: () => string;
}): ReturnType<ToolSetSnapshotProvider['createRunSnapshot']> {
  const registrySnapshotResult = input.snapshotService.createRunSnapshot({
    runId: input.runId,
    projectId: input.projectId,
    permissionMode: input.permissionMode,
    modelId: input.modelId,
    createdAt: input.createdAt,
    ...(input.providerCapabilitySummary ? { providerCapabilitySummary: input.providerCapabilitySummary } : {}),
  });
  const events = [
    createToolRegistrySourcesEnsuredEvent({
      eventId: input.eventId(),
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
      eventId: input.eventId(),
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
      eventId: input.eventId(),
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
      eventId: input.eventId(),
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

  return {
    modelVisibleToolDefinitions: registrySnapshotResult.modelVisibleToolDefinitions,
    events,
  };
}

export interface ToolSetRegistryProvider {
  listDefinitions(input: {
    runId: string;
    permissionMode: PermissionMode;
    providerCapabilitySummary?: { supportsToolCall?: boolean };
  }): ToolDefinition[];
}

export interface ToolSetCapabilityProvider {
  getProviderCapabilitySummary(input: {
    providerId: string;
    modelId: string;
  }): { supportsToolCall?: boolean };
}

export interface PrepareToolSetInput {
  runId: string;
  sessionId: string;
  projectId?: string;
  projectRoot?: string;
  permissionMode: PermissionMode;
  providerId: string;
  modelId: string;
  createdAt: string;
  providerCapabilitySummary?: { supportsToolCall?: boolean };
  startSequence: number;
}

export interface PrepareToolSetResult {
  toolDefinitions?: ToolDefinition[];
  events: RuntimeEvent[];
}

export interface ToolSetServiceOptions {
  snapshotProvider?: ToolSetSnapshotProvider;
  registryProvider?: ToolSetRegistryProvider;
  capabilityProvider?: ToolSetCapabilityProvider;
}

export class ToolSetService {
  constructor(private readonly options: ToolSetServiceOptions = {}) {}

  prepareToolSet(
    input: PrepareToolSetInput,
  ): PrepareToolSetResult {
    const providerCapabilitySummary = input.providerCapabilitySummary
      ?? this.options.capabilityProvider?.getProviderCapabilitySummary({
        providerId: input.providerId,
        modelId: input.modelId,
      })
      ?? { supportsToolCall: true };

    if (input.projectRoot && input.projectId && this.options.snapshotProvider) {
      const snapshot = this.options.snapshotProvider.createRunSnapshot({
        runId: input.runId,
        sessionId: input.sessionId,
        projectId: input.projectId,
        permissionMode: input.permissionMode,
        modelId: input.modelId,
        createdAt: input.createdAt,
        providerCapabilitySummary,
      });
      return {
        toolDefinitions: snapshot.modelVisibleToolDefinitions,
        events: normalizeToolSetEventSequence(snapshot.events, input.startSequence),
      };
    }

    if (input.projectRoot && this.options.registryProvider) {
      return {
        toolDefinitions: this.options.registryProvider.listDefinitions({
          runId: input.runId,
          permissionMode: input.permissionMode,
          providerCapabilitySummary,
        }),
        events: [],
      };
    }

    return { events: [] };
  }
}

export interface ToolRunnerFactory {
  create(input: {
    projectRoot: string;
    permissionMode: PermissionMode;
  }): Promise<ToolCallRunnerService>;
}

export interface PrepareToolRunnerInput {
  projectRoot?: string;
  permissionMode: PermissionMode;
  factory?: ToolRunnerFactory;
}

export async function prepareToolRunner(
  input: PrepareToolRunnerInput,
): Promise<ToolCallRunnerService | undefined> {
  if (!input.projectRoot || !input.factory) {
    return undefined;
  }

  return input.factory.create({
    projectRoot: input.projectRoot,
    permissionMode: input.permissionMode,
  });
}

export interface CodingAgentRunSourceOverrideProvider {
  resolveModelInputSourceOverrides(input: {
    sessionId: string;
    runId: string;
    stepId: string;
    builtAt: string;
  }): Partial<Pick<
    BuildModelCallInputInput,
    'globalInstructionDirs' | 'sessionInstructionSources' | 'requestedCwd'
  >>;
}

export interface CodingAgentRunToolResultModelInputRecorder {
  markToolResultsSubmittedToModelInput(input: {
    request: ModelStepRuntimeRequest;
    stepId: string;
    toolResults: readonly ToolResult[];
    emittedAt: string;
    sequence: number;
  }): readonly RuntimeEvent[] | undefined;
}

export interface AgentLoopClock {
  now(): string;
}

export interface AgentLoopIds {
  eventId(): string;
}

export interface AgentLoopEventPort {
  append(
    event: RuntimeEvent,
    requestId: string,
    runtimeContext?: RuntimeContext,
  ): RuntimeEvent;
}

export interface AgentLoopStatePort {
  getRunStatus(runId: string): string | undefined;
}

export interface AgentLoopFailurePort {
  failBeforeModelCall(input: {
    requestId: string;
    runtimeContext?: RuntimeContext;
    sessionId: string;
    run: Run;
    step: RunStep;
    error: RuntimeError;
  }): AsyncIterable<RuntimeEvent>;
}

export interface AgentLoopContextService {
  createBaselineContext(input: {
    runId: string;
    goal: string;
    workspaceId: string;
    workspacePath: string;
    modelCapabilitySummary: ModelCapabilitySummary;
    contextBudgetPolicy: ContextBudgetPolicy;
  }): { contextBudgetPolicy?: ContextBudgetPolicy } | undefined;
}

export interface AgentLoopSessionContextInputService {
  buildSessionContextInput(input: BuildSessionContextInputFromRepositoryInput): SessionContextInput;
}

export interface AgentLoopMemoryRecallService {
  recallForNewUserInput(input: {
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
  }): Promise<{
    memoryRecallSources?: ModelInputMemoryRecallSource[];
    memoryRecallSeed?: ModelInputContextBuildRequest['memoryRecallSeed'];
  }>;
}

export interface AgentLoopEventRecorder {
  createModelStep?(input: { runId: string }): string;

  recordModelCallEvents(input: {
    request: ModelStepRuntimeRequest;
    modelEvents: AsyncIterable<RuntimeEvent>;
    pendingApprovalResumes: PendingToolApprovalResume[];
    run: Run;
    step: RunStep;
    userMessageId: string;
    toolRuntime?: ToolCallRunnerService;
    projectId?: string;
    projectRoot?: string;
    permissionMode?: PermissionMode;
    memoryRecallSources?: ModelInputMemoryRecallSource[];
    memoryRecallSeed?: ModelInputContextBuildRequest['memoryRecallSeed'];
    startSequence?: number;
  }): AsyncIterable<RuntimeEvent>;
}

export interface AgentLoopOptions {
  clock: AgentLoopClock;
  ids: AgentLoopIds;
  eventPort: AgentLoopEventPort;
  statePort: AgentLoopStatePort;
  failurePort: AgentLoopFailurePort;
  contextService?: AgentLoopContextService;
  sessionContextInputService: AgentLoopSessionContextInputService;
  sourceOverrideProvider: CodingAgentRunSourceOverrideProvider;
  memoryRecallService?: AgentLoopMemoryRecallService;
  modelCallPort: ModelCallPort;
  toolCallRunnerFactory?: ToolRunnerFactory;
  modelCallInputBuildService: {
    buildModelCallInput(input: BuildModelCallInputInput): Promise<BuildModelCallInputResult>;
  };
  compactionOrchestrator?: {
    compactIfNeeded(input: CompactIfNeededInput): Promise<SessionCompactionOrchestrationResult>;
  };
  initialModelInputPreparationService?: {
    prepare(input: PrepareAgentLoopInitialModelInputInput): Promise<AgentLoopInitialModelInputPreparation>;
  };
  toolSetService: {
    prepareToolSet(input: PrepareToolSetInput): PrepareToolSetResult;
  };
  eventRecorder: AgentLoopEventRecorder;
}

export interface AgentLoopInput {
  requestId: string;
  session: Session;
  run: Run;
  step: RunStep;
  userMessage: SessionMessage;
  providerId: ProviderId | string;
  modelId: string;
  permissionMode: PermissionMode;
  inputPreprocessing: InputPreprocessingResult;
  parsedInput?: ParsedInput;
  permissionSnapshot?: PermissionModeSnapshot;
  permissionSnapshotRef?: string;
  runtimeContext?: RuntimeContext;
  createdAt: string;
  memoryEnabled?: boolean;
}

export class AgentLoop {
  private readonly initialModelInputPreparationService: {
    prepare(input: PrepareAgentLoopInitialModelInputInput): Promise<AgentLoopInitialModelInputPreparation>;
  };
  private readonly toolSetService: {
    prepareToolSet(input: PrepareToolSetInput): PrepareToolSetResult;
  };

  constructor(private readonly options: AgentLoopOptions) {
    this.initialModelInputPreparationService = options.initialModelInputPreparationService
      ?? new AgentLoopInitialModelInputPreparationService({
        contextService: options.contextService,
        sessionContextInputService: options.sessionContextInputService,
        sourceOverrideProvider: options.sourceOverrideProvider,
        memoryRecallService: options.memoryRecallService,
        modelCallInputBuildService: options.modelCallInputBuildService,
        compactionOrchestrator: options.compactionOrchestrator,
      });
    this.toolSetService = options.toolSetService;
  }

  async *run(input: AgentLoopInput): AsyncIterable<RuntimeEvent> {
    const requestMeta = { requestId: input.requestId, runtimeContext: input.runtimeContext };
    let runStartedAppended = false;

    try {
      const toolSet = this.toolSetService.prepareToolSet({
        runId: String(input.run.runId),
        sessionId: String(input.session.sessionId),
        ...(input.session.workspaceId ? { projectId: String(input.session.workspaceId) } : {}),
        ...(input.session.workspacePath ? { projectRoot: input.session.workspacePath } : {}),
        permissionMode: input.permissionMode,
        providerId: String(input.providerId),
        modelId: input.modelId,
        createdAt: input.createdAt,
        startSequence: 0,
      });
      const initialModelInputPreparation = await this.initialModelInputPreparationService.prepare({
        requestId: input.requestId,
        session: input.session,
        run: input.run,
        step: input.step,
        userMessage: input.userMessage,
        providerId: input.providerId,
        modelId: input.modelId,
        permissionMode: input.permissionMode,
        inputPreprocessing: input.inputPreprocessing,
        ...(input.parsedInput ? { parsedInput: input.parsedInput } : {}),
        ...(input.permissionSnapshot ? {
          permissionSnapshot: input.permissionSnapshot,
          ...(input.permissionSnapshotRef ? { permissionSnapshotRef: input.permissionSnapshotRef } : {}),
        } : {}),
        ...(input.runtimeContext ? { runtimeContext: input.runtimeContext } : {}),
        createdAt: input.createdAt,
        ...(input.memoryEnabled !== undefined ? { memoryEnabled: input.memoryEnabled } : {}),
        ...(toolSet.toolDefinitions ? { toolDefinitions: toolSet.toolDefinitions } : {}),
      });
      const memoryRecall = initialModelInputPreparation.memoryRecall;

      if (initialModelInputPreparation.compactionProbeModelInput.failure) {
        const runStarted = this.options.eventPort.append(
          createRunStartedEvent({
            eventId: this.options.ids.eventId(),
            sessionId: String(input.session.sessionId),
            runId: String(input.run.runId),
            sequence: 1,
            createdAt: input.createdAt,
          }),
          requestMeta.requestId,
          requestMeta.runtimeContext,
        );
        runStartedAppended = true;
        yield runStarted;
        yield* this.options.failurePort.failBeforeModelCall({
          requestId: input.requestId,
          runtimeContext: input.runtimeContext,
          sessionId: String(input.session.sessionId),
          run: input.run,
          step: input.step,
          error: modelCallInputBuildFailureToRuntimeError(
            initialModelInputPreparation.compactionProbeModelInput.failure,
          ),
        });
        return;
      }

      const compactionPromise = initialModelInputPreparation.startCompaction();

      {
        const event = this.options.eventPort.append(
          createRunStartedEvent({
            eventId: this.options.ids.eventId(),
            sessionId: String(input.session.sessionId),
            runId: String(input.run.runId),
            sequence: 1,
            createdAt: input.createdAt,
          }),
          requestMeta.requestId,
          requestMeta.runtimeContext,
        );
        runStartedAppended = true;
        yield event;
      }
      for (const event of toolSet.events) {
        yield this.options.eventPort.append(event, requestMeta.requestId, requestMeta.runtimeContext);
      }

      const compaction = await compactionPromise;
      for (const event of compaction.events) {
        yield this.options.eventPort.append(event, requestMeta.requestId, requestMeta.runtimeContext);
      }

      const currentRunStatus = this.options.statePort.getRunStatus(String(input.run.runId));
      if (currentRunStatus === 'cancelling' || currentRunStatus === 'cancelled') {
        return;
      }

      if (compaction.status === 'failed') {
        yield* this.options.failurePort.failBeforeModelCall({
          requestId: input.requestId,
          runtimeContext: input.runtimeContext,
          sessionId: String(input.session.sessionId),
          run: input.run,
          step: input.step,
          error: compaction.failure,
        });
        return;
      }

      const initialModelInput = await initialModelInputPreparation.buildInitialModelInput();
      if (initialModelInput.failure) {
        yield* this.options.failurePort.failBeforeModelCall({
          requestId: input.requestId,
          runtimeContext: input.runtimeContext,
          sessionId: String(input.session.sessionId),
          run: input.run,
          step: input.step,
          error: modelCallInputBuildFailureToRuntimeError(initialModelInput.failure),
        });
        return;
      }

      const modelCallRequest: ModelStepRuntimeRequest = {
        requestId: input.requestId,
        sessionId: input.session.sessionId,
        runId: input.run.runId,
        stepId: input.step.stepId,
        providerId: input.providerId as ProviderId,
        modelId: input.modelId,
        inputContext: initialModelInput.inputContext,
        ...(initialModelInput.toolDefinitions.length > 0 ? { toolDefinitions: initialModelInput.toolDefinitions } : {}),
        runtimeContext: input.runtimeContext,
        createdAt: input.createdAt,
      };

      let toolRuntime: ToolCallRunnerService | undefined;
      try {
        toolRuntime = await prepareToolRunner({
          ...(input.session.workspacePath ? { projectRoot: input.session.workspacePath } : {}),
          permissionMode: input.permissionMode,
          ...(this.options.toolCallRunnerFactory ? { factory: this.options.toolCallRunnerFactory } : {}),
        });
      } catch (error) {
        yield* this.options.failurePort.failBeforeModelCall({
          requestId: input.requestId,
          runtimeContext: input.runtimeContext,
          sessionId: String(input.session.sessionId),
          run: input.run,
          step: input.step,
          error: createRuntimeErrorFromUnknown(error),
        });
        return;
      }

      const pendingApprovalResumes: PendingToolApprovalResume[] = [];
      const modelEvents = streamCodingAgentModelToolLoop({
        request: modelCallRequest,
        ports: {
          modelCallPort: this.options.modelCallPort,
          ...(toolRuntime ? { toolCallHandler: toolRuntime } : {}),
          modelCallInputBuildService: this.options.modelCallInputBuildService,
          sourceOverrideProvider: this.options.sourceOverrideProvider,
          ...(toolRuntime ? {
            toolResultModelInputRecorder: {
              markToolResultsSubmittedToModelInput: (recorderInput) => {
                const event = toolRuntime.markToolResultsSubmittedToModelInput(recorderInput);
                return event ? [event] : [];
              },
            },
          } : {}),
          ids: {
            nextEventId: this.options.ids.eventId,
            nextStepId: ({ runId }) => this.options.eventRecorder.createModelStep?.({ runId })
              ?? `${runId}:step:${crypto.randomUUID()}`,
            nextModelStepId: () => `model-step:${crypto.randomUUID()}`,
          },
        },
        ...(input.session.workspacePath ? { projectRoot: input.session.workspacePath } : {}),
        permissionMode: input.permissionMode,
        memoryRecall,
        onPendingApproval: (pending) => {
          pendingApprovalResumes.push(pending);
        },
      });

      yield* this.options.eventRecorder.recordModelCallEvents({
        request: modelCallRequest,
        modelEvents,
        pendingApprovalResumes,
        run: input.run,
        step: input.step,
        userMessageId: String(input.userMessage.messageId),
        ...(input.session.workspaceId ? { projectId: String(input.session.workspaceId) } : {}),
        ...(input.session.workspacePath ? { projectRoot: input.session.workspacePath } : {}),
        permissionMode: input.permissionMode,
        ...(memoryRecall.memoryRecallSources ? { memoryRecallSources: memoryRecall.memoryRecallSources } : {}),
        ...(memoryRecall.memoryRecallSeed ? { memoryRecallSeed: memoryRecall.memoryRecallSeed } : {}),
        startSequence: 1,
        ...(toolRuntime ? { toolRuntime } : {}),
      });
    } catch (error) {
      if (!runStartedAppended) {
        const runStarted = this.options.eventPort.append(
          createRunStartedEvent({
            eventId: this.options.ids.eventId(),
            sessionId: String(input.session.sessionId),
            runId: String(input.run.runId),
            sequence: 1,
            createdAt: input.createdAt,
          }),
          requestMeta.requestId,
          requestMeta.runtimeContext,
        );
        runStartedAppended = true;
        yield runStarted;
      }
      yield* this.options.failurePort.failBeforeModelCall({
        requestId: input.requestId,
        runtimeContext: input.runtimeContext,
        sessionId: String(input.session.sessionId),
        run: input.run,
        step: input.step,
        error: createRuntimeErrorFromUnknown(error),
      });
    }
  }
}

export interface AgentLoopEventRecorderOptions<TProjection = unknown> {
  clock: AgentLoopClock;
  ids: AgentLoopIds & {
    stepId(): string;
  };
  events: {
    lastSequenceForRun(runId: string): number;
    normalizeWithModelRequest(
      event: RuntimeEvent,
      request: ModelStepRuntimeRequest,
      input: { afterSequence: number },
    ): RuntimeEvent;
    withModelRequestMetadata(event: RuntimeEvent, request: ModelStepRuntimeRequest): RuntimeEvent;
    append(event: RuntimeEvent, projection?: TProjection): RuntimeEvent;
  };
  runRepository: {
    getRun(runId: string): Run | undefined;
    saveRun(run: Run): Run;
  };
  stepRepository: {
    listStepsByRun(runId: string): RunStep[];
    saveStep(step: RunStep): RunStep;
  };
  modelCalls: {
    persistFromEvent(input: {
      request: ModelStepRuntimeRequest;
      event: RuntimeEvent;
      fallbackStepId: string;
      overrides?: {
        status?: RunStep['status'];
        completedAt?: string;
        error?: RuntimeError;
      };
    }): void;
  };
  assistantReplies: {
    commit(input: {
      sessionId: string;
      runId: string;
      content: string;
      completedAt: string;
    }): void;
  };
  postRunHooks: {
    scheduleRunCompletedMemoryCapture(input: {
      runId: string;
      sessionId: string;
      projectId?: string;
      providerId: ProviderId | null;
      modelId: string;
      userText: string;
      assistantText: string;
      hasProject: boolean;
      memoryEnabled: boolean;
    }): void;
  };
  memory: {
    isEnabled(): boolean;
  };
  approvals: {
    registry: PendingApprovalRegistry<ApprovalResumeGroup<TProjection>>;
  };
  projection?: TProjection;
}

export function createAgentLoopEventRecorder<TProjection>(
  options: AgentLoopEventRecorderOptions<TProjection>,
): AgentLoopEventRecorder {
  return {
    createModelStep: ({ runId }) => {
      const step = options.stepRepository.saveStep({
        stepId: options.ids.stepId(),
        runId,
        kind: 'model',
        status: 'running',
        title: 'Model response',
        startedAt: options.clock.now(),
      });
      return step.stepId;
    },
    recordModelCallEvents: (input) => recordAgentLoopModelCallEvents({
      ...input,
      options,
    }),
  };
}

async function* recordAgentLoopModelCallEvents<TProjection>(
  input: Parameters<AgentLoopEventRecorder['recordModelCallEvents']>[0] & {
    options: AgentLoopEventRecorderOptions<TProjection>;
  },
): AsyncIterable<RuntimeEvent> {
  const options = input.options;
  const projection = options.projection;
  const toolRuntime = input.toolRuntime;
  let assistantContent = '';
  let sawAssistantOutputCompleted = false;
  let sawFinalModelStepCompleted = false;
  let lastSequence = input.startSequence ?? 0;
  let terminalEvent: RuntimeEvent | undefined;
  let currentModelStep = input.step;
  let registeredPendingGroup: ApprovalResumeGroup<TProjection> | undefined;
  const modelStepsById = new Map<string, RunStep>([[input.step.stepId, input.step]]);

  const registerPendingGroup = (): ApprovalResumeGroup<TProjection> | undefined => {
    const registered = registerApprovalResumeGroup({
      registry: options.approvals.registry,
      ...(registeredPendingGroup ? { registeredGroup: registeredPendingGroup } : {}),
      request: input.request,
      run: input.run,
      step: currentModelStep,
      pendingApprovalResumes: input.pendingApprovalResumes,
      ...(toolRuntime ? { toolRuntime } : {}),
      ...(input.projectId ? { projectId: input.projectId } : {}),
      ...(input.projectRoot ? { projectRoot: input.projectRoot } : {}),
      ...(input.permissionMode ? { permissionMode: input.permissionMode } : {}),
      userMessageId: input.userMessageId,
      ...(input.memoryRecallSources ? { memoryRecallSources: input.memoryRecallSources } : {}),
      ...(input.memoryRecallSeed ? { memoryRecallSeed: input.memoryRecallSeed } : {}),
      ...(projection ? { projection } : {}),
      ids: {
        groupId: ({ request }) => `${request.runId}:${request.stepId}:${options.ids.eventId()}`,
      },
      lifecycle: {
        getRun: (runId) => options.runRepository.getRun(runId),
        saveRun: (run) => options.runRepository.saveRun(run),
        saveStep: (step) => options.stepRepository.saveStep(step),
      },
    });
    currentModelStep = registered.step;
    registeredPendingGroup = registered.group;
    return registeredPendingGroup;
  };

  try {
    for await (const event of input.modelEvents) {
      registerPendingGroup();
      lastSequence = Math.max(lastSequence, options.events.lastSequenceForRun(input.request.runId));
      const eventWithRequest = options.events.normalizeWithModelRequest(event, input.request, {
        afterSequence: lastSequence,
      });
      lastSequence = eventWithRequest.sequence;
      const eventStepId = eventWithRequest.stepId ?? currentModelStep.stepId;
      if (!modelStepsById.has(eventStepId)) {
        const persistedStep = options.stepRepository.listStepsByRun(input.request.runId)
          .find((step) => step.stepId === eventStepId);
        if (persistedStep) {
          modelStepsById.set(persistedStep.stepId, persistedStep);
          currentModelStep = persistedStep;
        }
      }
      options.modelCalls.persistFromEvent({
        request: input.request,
        event: eventWithRequest,
        fallbackStepId: currentModelStep.stepId,
      });
      const appended = options.events.append(eventWithRequest, projection);
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
        options.modelCalls.persistFromEvent({
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
              options.stepRepository.saveStep(step);
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
      yield appended;
    }
  } catch (error) {
    if (options.runRepository.getRun(input.request.runId)?.status === 'cancelled') {
      return;
    }
    lastSequence = Math.max(lastSequence, options.events.lastSequenceForRun(input.request.runId));
    const failedEvent = options.events.withModelRequestMetadata({
      ...createRuntimeRunFailedEvent({
        eventId: options.ids.eventId(),
        sessionId: input.request.sessionId,
        runId: input.request.runId,
        sequence: lastSequence += 1,
        createdAt: options.clock.now(),
        error: createRuntimeErrorFromUnknown(error, 'Session message run failed.'),
      }),
      stepId: currentModelStep.stepId,
    }, input.request);
    const appended = options.events.append(failedEvent, projection);
    terminalEvent = failedEvent;
    yield appended;
  }

  if (input.pendingApprovalResumes.length > 0 && toolRuntime) {
    const waitingAt = options.clock.now();
    registerPendingGroup();
    const waitingEvent = options.events.withModelRequestMetadata(createRunStatusChangedEvent({
      eventId: options.ids.eventId(),
      sessionId: input.request.sessionId,
      runId: input.request.runId,
      sequence: lastSequence += 1,
      createdAt: waitingAt,
      from: 'running',
      to: 'waiting_for_approval',
    }), input.request);
    yield options.events.append(waitingEvent, projection);
    return;
  }

  const completedAt = options.clock.now();
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
      ids: options.ids,
      lifecycle: {
        saveRun: (run) => {
          options.runRepository.saveRun(run);
        },
        saveStep: (step) => {
          options.stepRepository.saveStep(step);
        },
      },
    });
    for (const event of failed.events) {
      yield options.events.append(event, projection);
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
      ids: options.ids,
      lifecycle: {
        saveRun: (run) => {
          options.runRepository.saveRun(run);
        },
        saveStep: (step) => {
          options.stepRepository.saveStep(step);
        },
      },
    });
    for (const event of cancelled.events) {
      yield options.events.append(event, projection);
    }
    return;
  }

  if (!(sawAssistantOutputCompleted || sawFinalModelStepCompleted) || assistantContent.length === 0) {
    return;
  }

  options.assistantReplies.commit({
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
    ids: options.ids,
    lifecycle: {
      saveRun: (run) => {
        options.runRepository.saveRun(run);
      },
      saveStep: (step) => {
        options.stepRepository.saveStep(step);
      },
    },
  });

  for (const event of completed.events) {
    const appended = options.events.append(event, projection);
    if (event.eventType === 'run.completed') {
      options.postRunHooks.scheduleRunCompletedMemoryCapture({
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
        memoryEnabled: options.memory.isEnabled(),
      });
    }
    yield appended;
  }
}

export interface CodingAgentModelToolLoopStreamIds {
  nextEventId(): string;
  nextStepId(input: { runId: string }): string;
  nextModelStepId(): string;
}

export interface CodingAgentModelToolLoopStreamPorts {
  modelCallPort: ModelCallPort;
  toolCallHandler?: ToolCallRunner & ToolApprovalResumePort;
  modelCallInputBuildService: {
    buildModelCallInput(input: BuildModelCallInputInput): Promise<BuildModelCallInputResult>;
  };
  sourceOverrideProvider: CodingAgentRunSourceOverrideProvider;
  toolResultModelInputRecorder?: CodingAgentRunToolResultModelInputRecorder;
  ids: CodingAgentModelToolLoopStreamIds;
}

export interface CodingAgentModelToolLoopStreamInput {
  request: ModelStepRuntimeRequest;
  ports: CodingAgentModelToolLoopStreamPorts;
  projectRoot?: string;
  permissionMode?: PermissionMode;
  memoryRecall?: {
    memoryRecallSources?: ModelInputMemoryRecallSource[];
    memoryRecallSeed?: ModelInputContextBuildRequest['memoryRecallSeed'];
  };
  signal?: AbortSignal;
  onPendingApproval?: (approvalResume: PendingToolApprovalResume) => void;
}

export async function* streamCodingAgentModelToolLoop(
  input: CodingAgentModelToolLoopStreamInput,
): AsyncIterable<RuntimeEvent> {
  const modelEvents = input.ports.toolCallHandler
    ? runModelToolLoop({
        request: input.request,
        modelCallPort: input.ports.modelCallPort,
        toolCallHandler: input.ports.toolCallHandler,
        ids: {
          nextEventId: input.ports.ids.nextEventId,
          nextStepId: () => input.ports.ids.nextStepId({ runId: input.request.runId }),
          nextModelStepId: input.ports.ids.nextModelStepId,
        },
        signal: input.signal,
        onPendingApproval: input.onPendingApproval,
        onToolResultsSubmittedToModelInput: ({ request, toolResults, emittedAt }) => (
          input.ports.toolResultModelInputRecorder?.markToolResultsSubmittedToModelInput({
            request,
            stepId: request.stepId,
            toolResults,
            emittedAt,
            sequence: 0,
          }) ?? []
        ),
        buildNextModelInputContext: (contextInput) => buildNextModelInputContext({
          contextInput,
          request: input.request,
          projectRoot: input.projectRoot,
          permissionMode: input.permissionMode ?? 'default',
          memoryRecall: input.memoryRecall,
          ports: input.ports,
        }),
      })
    : input.ports.modelCallPort.streamModelCall({
        request: input.request,
        runId: input.request.runId,
        stepId: input.request.stepId,
        nextSequence: () => 1,
        eventIdFactory: input.ports.ids.nextEventId,
        signal: input.signal,
      });

  yield* coalesceTextDeltaRuntimeEvents(modelEvents);
}

export interface ApprovalResumeModelLoopInput {
  pendingRequest: ModelStepRuntimeRequest;
  resumedStep: RunStep;
  resumedInputContext: ModelInputContext;
  decidedAt: string;
  toolRuntime: ToolCallRunnerService;
  modelCallPort: ModelCallPort;
  modelCallInputBuildService: {
    buildModelCallInput(input: BuildModelCallInputInput): Promise<BuildModelCallInputResult>;
  };
  sourceOverrideProvider: CodingAgentRunSourceOverrideProvider;
  ids: CodingAgentModelToolLoopStreamIds;
  projectRoot?: string;
  permissionMode?: PermissionMode;
  memoryRecall?: {
    memoryRecallSources?: ModelInputMemoryRecallSource[];
    memoryRecallSeed?: ModelInputContextBuildRequest['memoryRecallSeed'];
  };
}

export interface ApprovalResumeModelLoop {
  request: ModelStepRuntimeRequest;
  modelEvents: AsyncIterable<RuntimeEvent>;
  pendingApprovalResumes: PendingToolApprovalResume[];
}

export function streamApprovalResumeModelLoop(input: ApprovalResumeModelLoopInput): ApprovalResumeModelLoop {
  const request: ModelStepRuntimeRequest = {
    ...input.pendingRequest,
    stepId: input.resumedStep.stepId,
    modelStepId: input.ids.nextModelStepId(),
    inputContext: input.resumedInputContext,
    createdAt: input.decidedAt,
  };
  const pendingApprovalResumes: PendingToolApprovalResume[] = [];
  const modelEvents = streamCodingAgentModelToolLoop({
    request,
    ports: {
      modelCallPort: input.modelCallPort,
      toolCallHandler: input.toolRuntime,
      modelCallInputBuildService: input.modelCallInputBuildService,
      sourceOverrideProvider: input.sourceOverrideProvider,
      toolResultModelInputRecorder: {
        markToolResultsSubmittedToModelInput: ({ request, stepId, toolResults, emittedAt, sequence }) => {
          const event = input.toolRuntime.markToolResultsSubmittedToModelInput({
            request,
            stepId,
            toolResults,
            emittedAt,
            sequence,
          });
          return event ? [event] : [];
        },
      },
      ids: input.ids,
    },
    ...(input.projectRoot ? { projectRoot: input.projectRoot } : {}),
    permissionMode: input.permissionMode ?? 'default',
    memoryRecall: {
      ...(input.memoryRecall?.memoryRecallSources ? { memoryRecallSources: input.memoryRecall.memoryRecallSources } : {}),
      ...(input.memoryRecall?.memoryRecallSeed ? { memoryRecallSeed: input.memoryRecall.memoryRecallSeed } : {}),
    },
    onPendingApproval: (pendingApprovalResume) => {
      pendingApprovalResumes.push(pendingApprovalResume);
    },
  });

  return { request, modelEvents, pendingApprovalResumes };
}

export interface ToolApprovalResumeAgentLoopInput<TProjection = unknown> {
  approvalResume: ApprovalResumeGroup<TProjection>;
  resumeInput: ResumeToolApprovalInput;
  registry: PendingApprovalRegistry<ApprovalResumeGroup<TProjection>>;
  lastSequenceForRun(runId: string): number;
  appendEvent(event: RuntimeEvent, projection?: TProjection): void;
  runRepository: {
    getRun(runId: string): Run | undefined;
    saveRun(run: Run): Run;
  };
  stepRepository: {
    saveStep(step: RunStep): RunStep;
  };
  modelCallPort: ModelCallPort;
  modelCallInputBuildService: {
    buildModelCallInput(input: BuildModelCallInputInput): Promise<BuildModelCallInputResult>;
  };
  sourceOverrideProvider: CodingAgentRunSourceOverrideProvider;
  ids: CodingAgentModelToolLoopStreamIds & {
    eventId(): string;
    stepId(): string;
  };
  clock: AgentLoopClock;
  recordModelCallEvents: NonNullable<AgentLoopEventRecorder['recordModelCallEvents']>;
}

export async function* resumeToolApprovalAgentLoop<TProjection>(
  input: ToolApprovalResumeAgentLoopInput<TProjection>,
): AsyncIterable<RuntimeEvent> {
  // Approval resume continues the same agent loop after a tool decision.
  // The tool-call owner resumes execution, while state/context/events owner ports
  // keep lifecycle, model input construction, and event persistence out of this algorithm.
  const approvalResume = input.approvalResume;
  const pending = approvalResume.pendingByApprovalId.get(input.resumeInput.approvalRequestId);
  if (!pending) {
    return;
  }

  const resumeOutcome = await approvalResume.toolRuntime.resumeToolApproval(input.resumeInput);
  if (!resumeOutcome) {
    return;
  }
  const toolResults = [...(resumeOutcome.toolResults ?? (resumeOutcome.toolResult ? [resumeOutcome.toolResult] : []))];
  const projection = approvalResume.projection;

  let lastSequence = input.lastSequenceForRun(approvalResume.request.runId);
  const resolvedPending = approvalResume.toolRuntime.resolvePendingApproval({
    registry: input.registry,
    group: approvalResume,
    approvalRequestId: input.resumeInput.approvalRequestId,
    resolvedResults: toolResults,
  });
  if (!resolvedPending) {
    return;
  }

  const approvalResolvedEvent = approvalResume.toolRuntime.createApprovalResolvedRuntimeEvent({
    request: approvalResume.request,
    stepId: approvalResume.step.stepId,
    sequence: lastSequence += 1,
    approvalRequestId: input.resumeInput.approvalRequestId,
    decision: input.resumeInput.decision,
    scope: pending.pendingApproval.approvalRequest.requestedScope,
    decidedAt: input.resumeInput.decidedAt,
    ids: input.ids,
  });
  input.appendEvent(approvalResolvedEvent, projection);
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
      ids: input.ids,
    });
    for (const event of resumeEvents.events) {
      input.appendEvent(event, projection);
      yield event;
    }
    return;
  }

  approvalResume.toolRuntime.closePendingApprovalGroup({
    registry: input.registry,
    group: approvalResume,
  });
  const resumedRun = resumeRunAfterApproval({
    request: approvalResume.request,
    fallbackRun: approvalResume.run,
    repository: input.runRepository,
    ids: input.ids,
    decidedAt: input.resumeInput.decidedAt,
    lastSequence,
  });
  const runningRun = resumedRun.run;
  lastSequence = resumedRun.lastSequence;
  input.appendEvent(resumedRun.event, projection);
  yield resumedRun.event;

  const resumeEvents = approvalResume.toolRuntime.collectApprovalResumeRuntimeEvents({
    request: approvalResume.request,
    stepId: approvalResume.step.stepId,
    lastSequence,
    outcome: resumeOutcome,
    toolResults,
    ids: input.ids,
  });
  lastSequence = resumeEvents.lastSequence;
  for (const event of resumeEvents.events) {
    input.appendEvent(event, projection);
    yield event;
  }

  const resumed = await approvalResume.toolRuntime.prepareApprovalResumeModelInput({
    pending,
    resolvedResults: approvalResume.resolvedResults,
    decidedAt: input.resumeInput.decidedAt,
    ...(approvalResume.projectRoot ? { projectRoot: approvalResume.projectRoot } : {}),
    ...(approvalResume.permissionMode ? { permissionMode: approvalResume.permissionMode } : {}),
    ...(approvalResume.memoryRecallSources ? { memoryRecallSources: approvalResume.memoryRecallSources } : {}),
    ...(approvalResume.memoryRecallSeed ? { memoryRecallSeed: approvalResume.memoryRecallSeed } : {}),
    repository: input.stepRepository,
    modelCallInputBuildService: input.modelCallInputBuildService,
    sourceOverrideProvider: input.sourceOverrideProvider,
    ids: input.ids,
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
      failedAt: input.resumeInput.decidedAt,
      ids: input.ids,
      lifecycle: {
        saveRun: (run) => {
          input.runRepository.saveRun(run);
        },
        saveStep: (step) => {
          input.stepRepository.saveStep(step);
        },
      },
    });
    for (const event of failed.events) {
      input.appendEvent(event, projection);
      yield event;
    }
    return;
  }

  const toolResultsSubmittedEvent = approvalResume.toolRuntime.markToolResultsSubmittedToModelInput({
    request: pending.request,
    stepId: resumedStep.stepId,
    toolResults: resumedToolResults,
    emittedAt: input.resumeInput.decidedAt,
    sequence: lastSequence += 1,
  });
  if (toolResultsSubmittedEvent) {
    input.appendEvent(toolResultsSubmittedEvent, projection);
    yield toolResultsSubmittedEvent;
  }

  const resumedLoop = streamApprovalResumeModelLoop({
    pendingRequest: pending.request,
    resumedStep,
    resumedInputContext: resumedModelInput.inputContext,
    decidedAt: input.resumeInput.decidedAt,
    toolRuntime: approvalResume.toolRuntime,
    modelCallPort: input.modelCallPort,
    modelCallInputBuildService: input.modelCallInputBuildService,
    sourceOverrideProvider: input.sourceOverrideProvider,
    ids: {
      nextEventId: input.ids.nextEventId,
      nextStepId: ({ runId }) => {
        const step = input.stepRepository.saveStep({
          stepId: input.ids.stepId(),
          runId,
          kind: 'model',
          status: 'running',
          title: 'Model response',
          startedAt: input.clock.now(),
        });
        return step.stepId;
      },
      nextModelStepId: input.ids.nextModelStepId,
    },
    ...(approvalResume.projectRoot ? { projectRoot: approvalResume.projectRoot } : {}),
    permissionMode: approvalResume.permissionMode ?? 'default',
    memoryRecall: {
      ...(approvalResume.memoryRecallSources ? { memoryRecallSources: approvalResume.memoryRecallSources } : {}),
      ...(approvalResume.memoryRecallSeed ? { memoryRecallSeed: approvalResume.memoryRecallSeed } : {}),
    },
  });

  yield* input.recordModelCallEvents({
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
    ...(approvalResume.permissionMode ? { permissionMode: approvalResume.permissionMode } : {}),
    ...(approvalResume.memoryRecallSources ? { memoryRecallSources: approvalResume.memoryRecallSources } : {}),
    ...(approvalResume.memoryRecallSeed ? { memoryRecallSeed: approvalResume.memoryRecallSeed } : {}),
  });
}

function normalizeToolSetEventSequence(events: RuntimeEvent[], startSequence: number): RuntimeEvent[] {
  return events.map((event, index) => ({
    ...event,
    sequence: event.sequence > startSequence ? event.sequence : startSequence + index + 1,
  }));
}

export async function* runModelToolLoop(input: RunModelToolLoopInput): AsyncIterable<RuntimeEvent> {
  const maxModelSteps = input.maxModelSteps ?? DEFAULT_MAX_MODEL_STEPS;
  const maxToolRounds = input.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;
  let request = input.request;
  let sequenceOffset = 0;
  let toolRoundCount = 0;
  let accumulatedToolCalls: ToolCall[] = [];
  let accumulatedToolResults: ToolResult[] = [];
  let accumulatedProviderStates: ModelStepProviderState[] = [];

  for (let modelStepCount = 0; modelStepCount < maxModelSteps; modelStepCount += 1) {
    const toolCalls: ToolCall[] = [];
    const providerStates: ModelStepProviderState[] = [];
    let stepMaxSequence = sequenceOffset;

    for await (const event of runModelCall({
      request,
      modelCallPort: input.modelCallPort,
      signal: input.signal,
      eventIdFactory: input.ids.nextEventId,
    })) {
      const eventWithLoopSequence = {
        ...event,
        sequence: sequenceOffset + event.sequence,
      };
      stepMaxSequence = Math.max(stepMaxSequence, eventWithLoopSequence.sequence);

      if (isToolCallCreatedEvent(eventWithLoopSequence)) {
        toolCalls.push(createToolCallFromEvent(eventWithLoopSequence));
      }

      if (isModelStepProviderStateRecordedEvent(eventWithLoopSequence)) {
        providerStates.push(eventWithLoopSequence.payload);
      }

      yield eventWithLoopSequence;
    }

    sequenceOffset = stepMaxSequence;

    if (toolCalls.length === 0) {
      return;
    }

    toolRoundCount += 1;
    if (toolRoundCount > maxToolRounds) {
      yield createModelLoopRunFailedEvent({
        eventId: input.ids.nextEventId(),
        request: {
          requestId: request.requestId,
          sessionId: request.sessionId,
          providerId: request.providerId,
          modelId: request.modelId,
          runtimeContext: request.runtimeContext,
        },
        runId: request.runId,
        sequence: sequenceOffset + 1,
        createdAt: new Date().toISOString(),
        error: createTerminalRuntimeError({
          reason: 'loop_limit_exceeded',
          code: 'runtime_protocol_violation',
          message: `Model tool loop exceeded maxToolRounds (${maxToolRounds}).`,
          source: 'core',
          retryable: false,
          debugId: request.runtimeContext?.debugId ?? `debug:${request.requestId}`,
          details: { maxToolRounds },
        }),
      });
      return;
    }

    accumulatedToolCalls = [...accumulatedToolCalls, ...toolCalls];
    accumulatedProviderStates = [...accumulatedProviderStates, ...providerStates];

    const outcome = await input.toolCallHandler.handleToolCalls({
      request,
      toolCalls,
      signal: input.signal,
    });

    const toolResults = outcome.toolResults ?? [];
    const runtimeEvents = outcome.runtimeEvents ?? [];
    const hasPendingApprovals = Boolean(outcome.pendingApprovals && outcome.pendingApprovals.length > 0);
    const nextModelInputReady = outcome.nextModelInputReady ?? true;
    const normalizedRuntimeEvents: RuntimeEvent[] = [];

    for (const event of runtimeEvents) {
      sequenceOffset += 1;
      normalizedRuntimeEvents.push({
        ...event,
        runId: event.runId ?? request.runId,
        sessionId: event.sessionId ?? request.sessionId,
        stepId: event.stepId ?? request.stepId,
        requestId: event.requestId ?? request.requestId,
        ...(event.context ? { context: event.context } : request.runtimeContext ? { context: request.runtimeContext } : {}),
        sequence: sequenceOffset,
      });
    }

    const emittedToolResultIds = new Set(
      normalizedRuntimeEvents
        .filter((event) => event.eventType === 'tool.result.created')
        .map((event) => {
          const payload = event.payload as { toolResultId?: unknown };
          return typeof payload.toolResultId === 'string' ? payload.toolResultId : undefined;
        })
        .filter((toolResultId): toolResultId is string => Boolean(toolResultId)),
    );

    const toolResultEvents: RuntimeEvent[] = [];
    for (const toolResult of toolResults) {
      if (emittedToolResultIds.has(String(toolResult.toolResultId))) {
        continue;
      }
      sequenceOffset += 1;
      toolResultEvents.push(createToolResultCreatedEvent({
        eventId: input.ids.nextEventId(),
        eventType: 'tool.result.created',
        runId: request.runId,
        sessionId: request.sessionId,
        stepId: request.stepId,
        requestId: request.requestId,
        runtimeContext: request.runtimeContext,
        sequence: sequenceOffset,
        createdAt: toolResult.createdAt,
        source: 'tool',
        visibility: 'system',
        persist: 'required',
        payload: {
          toolResultId: String(toolResult.toolResultId),
          toolCallId: String(toolResult.toolCallId),
          ...(toolResult.toolExecutionId ? { toolExecutionId: String(toolResult.toolExecutionId) } : {}),
          kind: toolResult.kind,
          summary: toolResultEventSummary(toolResult),
        },
      }));
    }

    accumulatedToolResults = [...accumulatedToolResults, ...toolResults];

    if (hasPendingApprovals || !nextModelInputReady) {
      const nextModelRequest = await createNextModelCallRequest({
        request,
        stepId: request.stepId,
        ...(request.modelStepId ? { modelStepId: String(request.modelStepId) } : {}),
        createdAt: request.createdAt,
        contextKind: 'approval',
        accumulatedToolCalls,
        accumulatedToolResults,
        accumulatedProviderStates,
        buildNextModelInputContext: input.buildNextModelInputContext,
      });

      for (const pendingApproval of outcome.pendingApprovals ?? []) {
        input.onPendingApproval?.({
          pendingApproval,
          request: nextModelRequest,
          accumulatedToolCalls,
          accumulatedToolResults,
          accumulatedProviderStates,
        });
      }
      for (const event of normalizedRuntimeEvents) {
        yield event;
      }
      for (const event of toolResultEvents) {
        yield event;
      }
      return;
    }

    for (const event of normalizedRuntimeEvents) {
      yield event;
    }
    for (const event of toolResultEvents) {
      yield event;
    }

    if (toolResults.length === 0) {
      yield createModelLoopRunFailedEvent({
        eventId: input.ids.nextEventId(),
        request: {
          requestId: request.requestId,
          sessionId: request.sessionId,
          providerId: request.providerId,
          modelId: request.modelId,
          runtimeContext: request.runtimeContext,
        },
        runId: request.runId,
        sequence: sequenceOffset + 1,
        createdAt: new Date().toISOString(),
        error: createTerminalRuntimeError({
          reason: 'runtime_invariant_violation',
          code: 'runtime_protocol_violation',
          message: 'Tool calls were produced but no tool results or pending approvals were returned.',
          source: 'core',
          retryable: false,
          debugId: request.runtimeContext?.debugId ?? `debug:${request.requestId}`,
        }),
      });
      return;
    }

    const nextStepId = input.ids.nextStepId();
    const nextModelStepId = input.ids.nextModelStepId();
    const nextCreatedAt = new Date().toISOString();

    request = await createNextModelCallRequest({
      request,
      stepId: nextStepId,
      modelStepId: nextModelStepId,
      createdAt: nextCreatedAt,
      contextKind: 'tool-results',
      accumulatedToolCalls,
      accumulatedToolResults,
      accumulatedProviderStates,
      buildNextModelInputContext: input.buildNextModelInputContext,
    });
    const emittedEvents = await input.onToolResultsSubmittedToModelInput?.({
      request,
      toolResults,
      emittedAt: nextCreatedAt,
    }) ?? [];
    for (const event of emittedEvents) {
      sequenceOffset += 1;
      yield {
        ...event,
        runId: event.runId ?? request.runId,
        sessionId: event.sessionId ?? request.sessionId,
        stepId: event.stepId ?? request.stepId,
        requestId: event.requestId ?? request.requestId,
        ...(event.context ? { context: event.context } : request.runtimeContext ? { context: request.runtimeContext } : {}),
        sequence: sequenceOffset,
      };
    }
  }

  yield createModelLoopRunFailedEvent({
    eventId: input.ids.nextEventId(),
    request: {
      requestId: request.requestId,
      sessionId: request.sessionId,
      providerId: request.providerId,
      modelId: request.modelId,
      runtimeContext: request.runtimeContext,
    },
    runId: request.runId,
    sequence: sequenceOffset + 1,
    createdAt: new Date().toISOString(),
    error: createTerminalRuntimeError({
      reason: 'loop_limit_exceeded',
      code: 'runtime_protocol_violation',
      message: `Model tool loop exceeded maxModelSteps (${maxModelSteps}).`,
      source: 'core',
      retryable: false,
      debugId: request.runtimeContext?.debugId ?? `debug:${request.requestId}`,
      details: { maxModelSteps },
    }),
  });
}

async function buildNextModelInputContext(input: {
  contextInput: ToolResultModelInputBuildInput;
  request: ModelStepRuntimeRequest;
  projectRoot?: string;
  permissionMode: PermissionMode;
  memoryRecall?: {
    memoryRecallSources?: ModelInputMemoryRecallSource[];
    memoryRecallSeed?: ModelInputContextBuildRequest['memoryRecallSeed'];
  };
  ports: CodingAgentModelToolLoopStreamPorts;
}): Promise<ModelInputContext> {
  const nextModelInput = await input.ports.modelCallInputBuildService.buildModelCallInput({
    baseInputContext: input.contextInput.baseInputContext,
    requestId: input.request.requestId,
    sessionId: input.contextInput.sessionId,
    runId: input.contextInput.runId,
    stepId: input.contextInput.stepId,
    contextKind: 'tool-results',
    providerId: input.request.providerId,
    modelId: String(input.request.modelId),
    ...(input.projectRoot ? { projectRoot: input.projectRoot } : {}),
    ...input.ports.sourceOverrideProvider.resolveModelInputSourceOverrides({
      sessionId: input.contextInput.sessionId,
      runId: input.contextInput.runId,
      stepId: input.contextInput.stepId,
      builtAt: input.contextInput.builtAt,
    }),
    permissionMode: input.permissionMode,
    toolDefinitions: input.request.toolDefinitions ?? [],
    toolCalls: input.contextInput.toolCalls,
    toolResults: input.contextInput.toolResults,
    providerStates: input.contextInput.providerStates,
    ...(input.memoryRecall?.memoryRecallSources ? { memoryRecallSources: input.memoryRecall.memoryRecallSources } : {}),
    ...(input.memoryRecall?.memoryRecallSeed ? { memoryRecallSeed: input.memoryRecall.memoryRecallSeed } : {}),
    builtAt: input.contextInput.builtAt,
  });

  if (nextModelInput.failure) {
    throw modelCallInputBuildFailureToRuntimeError(nextModelInput.failure);
  }

  return nextModelInput.inputContext;
}

async function createNextModelCallRequest(input: {
  request: ModelStepRuntimeRequest;
  stepId: string;
  modelStepId?: string;
  createdAt: string;
  contextKind: 'approval' | 'tool-results';
  accumulatedToolCalls: ToolCall[];
  accumulatedToolResults: ToolResult[];
  accumulatedProviderStates: ModelStepProviderState[];
  buildNextModelInputContext: (
    input: ToolResultModelInputBuildInput
  ) => ModelInputContext | Promise<ModelInputContext>;
}): Promise<ModelStepRuntimeRequest> {
  const contextInput = {
    contextId: createModelCallInputContextId({
      stepId: input.stepId,
      contextKind: input.contextKind,
    }),
    sessionId: input.request.sessionId,
    runId: String(input.request.runId),
    stepId: input.stepId,
    buildReason: 'tool_call_outputs_model_input',
    builtAt: input.createdAt,
    baseInputContext: input.request.inputContext,
    toolCalls: input.accumulatedToolCalls,
    toolResults: input.accumulatedToolResults,
    providerStates: input.accumulatedProviderStates,
  };

  return {
    ...input.request,
    stepId: input.stepId,
    ...(input.modelStepId ? { modelStepId: input.modelStepId } : {}),
    inputContext: await input.buildNextModelInputContext(contextInput),
    createdAt: input.createdAt,
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

function createToolCallFromEvent(event: TypedRuntimeEvent<'tool.call.created'>): ToolCall {
  return {
    toolCallId: event.payload.toolCallId,
    runId: String(event.runId),
    modelStepId: event.payload.modelStepId,
    providerToolCallId: event.payload.providerToolCallId,
    toolName: event.payload.toolName,
    input: event.payload.input,
    inputPreview: {
      summary: event.payload.toolName,
      targets: [],
      redactionState: 'none',
    },
    status: 'created',
    createdAt: event.createdAt,
  };
}

function isToolCallCreatedEvent(event: RuntimeEvent): event is TypedRuntimeEvent<'tool.call.created'> {
  if (event.eventType !== 'tool.call.created') {
    return false;
  }

  return RuntimeEventSchema.safeParse(event).success;
}

function isModelStepProviderStateRecordedEvent(
  event: RuntimeEvent,
): event is TypedRuntimeEvent<'model.step.provider_state.recorded'> {
  if (event.eventType !== 'model.step.provider_state.recorded') {
    return false;
  }

  return RuntimeEventSchema.safeParse(event).success;
}

function toolResultEventSummary(toolResult: ToolResult): string {
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
