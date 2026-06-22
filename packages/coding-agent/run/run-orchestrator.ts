// Owns Coding Agent product-level run orchestration while callers own persistence and UI projection.
import type { ContextBudgetPolicy } from '@megumi/shared/context';
import type { InputPreprocessingResult } from '@megumi/shared/input';
import type { ModelCapabilitySummary } from '@megumi/shared/run';
import type { ModelInputContextBuildRequest, ModelStepRuntimeRequest } from '@megumi/shared/model';
import type { PermissionMode, PermissionModeSnapshot } from '@megumi/shared/permission';
import type { ProviderId } from '@megumi/shared/provider';
import type { RuntimeContext, RuntimeEvent } from '@megumi/shared/runtime';
import { createRunFailedEvent, createRunStartedEvent } from '@megumi/agent';
import type { Run, RunStep, Session, SessionContextInput, SessionMessage } from '@megumi/shared/session';
import type { ToolDefinition } from '@megumi/shared/tool';
import type { ParsedInput } from '@megumi/input';
import type {
  BuildModelStepInputFailure,
  BuildModelStepInputInput,
  BuildModelStepInputResult,
  CompactIfNeededInput,
  ModelInputMemoryRecallSource,
  SessionCompactionOrchestrationResult,
} from '../context';
import type { BuildSessionContextInputFromRepositoryInput } from '../session';
import { createCodingAgentRunInputFacts } from './input-facts';
import {
  createRuntimeErrorFromUnknown,
  modelStepInputBuildFailureToRuntimeError,
} from './event-utils';
import type { CodingAgentRunSourceOverrideProvider } from './model-step-stream';

export interface CodingAgentRunClock {
  now(): string;
}

export interface CodingAgentRunIds {
  eventId(): string;
}

export interface CodingAgentRunContextService {
  createBaselineContext(input: {
    runId: string;
    goal: string;
    workspaceId: string;
    workspacePath: string;
    modelCapabilitySummary: ModelCapabilitySummary;
    contextBudgetPolicy: ContextBudgetPolicy;
  }): { contextBudgetPolicy?: ContextBudgetPolicy } | undefined;
}

export interface CodingAgentRunSessionContextInputService {
  buildSessionContextInput(input: BuildSessionContextInputFromRepositoryInput): SessionContextInput;
}

export interface CodingAgentRunMemoryRecallService {
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

export interface CodingAgentRunProviderCapabilitySummaryProvider {
  getProviderCapabilitySummary(input: {
    providerId: string;
    modelId: string;
  }): { supportsToolCall?: boolean };
}

export interface CodingAgentRunToolRegistrySnapshotProvider {
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

export interface CodingAgentRunModelStepExecutor {
  streamModelStep(input: {
    request: ModelStepRuntimeRequest;
    run: Run;
    step: RunStep;
    userMessageId: string;
    projectId?: string;
    projectRoot?: string;
    permissionMode?: PermissionMode;
    memoryRecall?: {
      memoryRecallSources?: ModelInputMemoryRecallSource[];
      memoryRecallSeed?: ModelInputContextBuildRequest['memoryRecallSeed'];
    };
    startSequence?: number;
  }): AsyncIterable<RuntimeEvent>;
}

export interface CodingAgentRunOrchestratorOptions {
  clock: CodingAgentRunClock;
  ids: CodingAgentRunIds;
  contextService?: CodingAgentRunContextService;
  providerCapabilitySummaryProvider?: CodingAgentRunProviderCapabilitySummaryProvider;
  toolRegistrySnapshotProvider?: CodingAgentRunToolRegistrySnapshotProvider;
  toolDefinitionProvider?: {
    listDefinitions(input: {
      runId: string;
      permissionMode: PermissionMode;
      providerCapabilitySummary?: { supportsToolCall?: boolean };
    }): ToolDefinition[];
  };
  sessionContextInputService: CodingAgentRunSessionContextInputService;
  sourceOverrideProvider: CodingAgentRunSourceOverrideProvider;
  memoryRecallService?: CodingAgentRunMemoryRecallService;
  modelStepInputBuildService: {
    buildModelStepInput(input: BuildModelStepInputInput): Promise<BuildModelStepInputResult>;
  };
  compactionOrchestrator?: {
    compactIfNeeded(input: CompactIfNeededInput): Promise<SessionCompactionOrchestrationResult>;
  };
  runStatusProvider?: {
    getRunStatus(runId: string): string | undefined;
  };
  modelStepExecutor: CodingAgentRunModelStepExecutor;
}

export interface CodingAgentRunSessionMessageInput {
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

export class CodingAgentRunOrchestrator {
  constructor(private readonly options: CodingAgentRunOrchestratorOptions) {}

  async *runSessionMessage(input: CodingAgentRunSessionMessageInput): AsyncIterable<RuntimeEvent> {
    let lastSequence = 0;
    const runStarted = createRunStartedEvent({
      eventId: this.options.ids.eventId(),
      sessionId: String(input.session.sessionId),
      runId: String(input.run.runId),
      sequence: lastSequence += 1,
      createdAt: input.createdAt,
    });
    yield withRequestMetadata(runStarted, input);

    try {
      const context = this.options.contextService?.createBaselineContext({
        runId: String(input.run.runId),
        goal: input.userMessage.content,
        workspaceId: String(input.session.workspaceId ?? `workspace:${input.session.sessionId}`),
        workspacePath: input.session.workspacePath ?? '',
        modelCapabilitySummary: DEFAULT_MODEL_CAPABILITY_SUMMARY,
        contextBudgetPolicy: DEFAULT_CONTEXT_BUDGET_POLICY,
      });
      const budgetPolicy = context?.contextBudgetPolicy ?? DEFAULT_CONTEXT_BUDGET_POLICY;
      const providerCapabilitySummary = this.options.providerCapabilitySummaryProvider?.getProviderCapabilitySummary({
        providerId: String(input.providerId),
        modelId: input.modelId,
      }) ?? { supportsToolCall: true };
      const toolDefinitions = this.resolveToolDefinitions(input, providerCapabilitySummary, lastSequence);
      for (const event of toolDefinitions.events) {
        lastSequence = Math.max(lastSequence, event.sequence);
        yield withRequestMetadata(event, input);
      }

      const sessionContext = this.options.sessionContextInputService.buildSessionContextInput({
        sessionId: String(input.session.sessionId),
        currentRunId: String(input.run.runId),
        currentMessageId: String(input.userMessage.messageId),
        builtAt: input.createdAt,
      });
      const modelInputSourceOverrides = this.options.sourceOverrideProvider.resolveModelInputSourceOverrides({
        sessionId: String(input.session.sessionId),
        runId: String(input.run.runId),
        stepId: String(input.step.stepId),
        builtAt: input.createdAt,
      });
      const memoryRecall = await this.recallMemory(input, modelInputSourceOverrides.requestedCwd);
      const runInputFacts = input.parsedInput ? createCodingAgentRunInputFacts(input.parsedInput) : undefined;
      const compactionProbeModelInput = await this.options.modelStepInputBuildService.buildModelStepInput({
        requestId: input.requestId,
        sessionId: String(input.session.sessionId),
        runId: String(input.run.runId),
        stepId: String(input.step.stepId),
        contextKind: 'compaction-probe',
        providerId: String(input.providerId),
        modelId: input.modelId,
        modelContextWindow: budgetPolicy.modelContextWindow,
        ...(input.session.workspaceId ? { projectId: String(input.session.workspaceId) } : {}),
        ...(input.session.workspacePath ? { projectRoot: input.session.workspacePath } : {}),
        ...modelInputSourceOverrides,
        permissionMode: input.permissionMode,
        ...(input.permissionSnapshot ? {
          permissionSnapshot: input.permissionSnapshot,
          ...(input.permissionSnapshotRef ? { permissionSnapshotRef: input.permissionSnapshotRef } : {}),
        } : {}),
        currentMessage: input.userMessage,
        inputPreprocessing: input.inputPreprocessing,
        sessionContext,
        ...memoryRecall,
        ...(runInputFacts ? { runInputFacts } : {}),
        ...(toolDefinitions.toolDefinitions ? { toolDefinitions: toolDefinitions.toolDefinitions } : {}),
        budgetPolicy: {
          modelContextWindow: Number.MAX_SAFE_INTEGER,
          reservedOutputTokens: 0,
          keepRecentTokens: Number.MAX_SAFE_INTEGER,
        },
        builtAt: input.createdAt,
      });
      const compaction: SessionCompactionOrchestrationResult =
        compactionProbeModelInput.failure
        ? {
            status: 'failed' as const,
            events: [],
            failure: modelStepInputBuildFailureToRuntimeError(compactionProbeModelInput.failure),
          }
        : this.options.compactionOrchestrator
        ? await this.options.compactionOrchestrator.compactIfNeeded({
            requestId: input.requestId,
            sessionId: String(input.session.sessionId),
            runId: String(input.run.runId),
            stepId: String(input.step.stepId),
            providerId: input.providerId as ProviderId,
            modelId: input.modelId,
            runtimeContext: input.runtimeContext,
            createdAt: input.createdAt,
            sessionContext,
            budgetProbeInputContext: compactionProbeModelInput.inputContext,
            budgetPolicy,
            startSequence: lastSequence,
          })
        : { status: 'skipped' as const, events: [] };

      for (const event of compaction.events) {
        lastSequence = Math.max(lastSequence, event.sequence);
        yield withRequestMetadata(event, input);
      }

      if (compaction.status === 'failed') {
        yield createRunFailedEvent({
          eventId: this.options.ids.eventId(),
          sessionId: String(input.session.sessionId),
          runId: String(input.run.runId),
          sequence: lastSequence + 1,
          createdAt: this.options.clock.now(),
          error: compaction.failure,
        });
        return;
      }

      const currentRunStatus = this.options.runStatusProvider?.getRunStatus(
        String(input.run.runId),
      );
      if (currentRunStatus === 'cancelling' || currentRunStatus === 'cancelled') {
        return;
      }

      const finalSessionContext = this.options.sessionContextInputService.buildSessionContextInput({
        sessionId: String(input.session.sessionId),
        currentRunId: String(input.run.runId),
        currentMessageId: String(input.userMessage.messageId),
        builtAt: input.createdAt,
      });
      const initialModelInput = await this.options.modelStepInputBuildService.buildModelStepInput({
        requestId: input.requestId,
        sessionId: String(input.session.sessionId),
        runId: String(input.run.runId),
        stepId: String(input.step.stepId),
        contextKind: 'initial',
        providerId: String(input.providerId),
        modelId: input.modelId,
        modelContextWindow: budgetPolicy.modelContextWindow,
        ...(input.session.workspaceId ? { projectId: String(input.session.workspaceId) } : {}),
        ...(input.session.workspacePath ? { projectRoot: input.session.workspacePath } : {}),
        ...modelInputSourceOverrides,
        permissionMode: input.permissionMode,
        ...(input.permissionSnapshot ? {
          permissionSnapshot: input.permissionSnapshot,
          ...(input.permissionSnapshotRef ? { permissionSnapshotRef: input.permissionSnapshotRef } : {}),
        } : {}),
        currentMessage: input.userMessage,
        inputPreprocessing: input.inputPreprocessing,
        sessionContext: finalSessionContext,
        ...memoryRecall,
        ...(runInputFacts ? { runInputFacts } : {}),
        ...(toolDefinitions.toolDefinitions ? { toolDefinitions: toolDefinitions.toolDefinitions } : {}),
        budgetPolicy,
        builtAt: input.createdAt,
      });
      if (initialModelInput.failure) {
        yield createRunFailedEvent({
          eventId: this.options.ids.eventId(),
          sessionId: String(input.session.sessionId),
          runId: String(input.run.runId),
          sequence: lastSequence + 1,
          createdAt: this.options.clock.now(),
          error: modelStepInputBuildFailureToRuntimeError(initialModelInput.failure),
        });
        return;
      }

      const request: ModelStepRuntimeRequest = {
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
      yield* this.options.modelStepExecutor.streamModelStep({
        request,
        run: input.run,
        step: input.step,
        userMessageId: String(input.userMessage.messageId),
        ...(input.session.workspaceId ? { projectId: String(input.session.workspaceId) } : {}),
        ...(input.session.workspacePath ? { projectRoot: input.session.workspacePath } : {}),
        permissionMode: input.permissionMode,
        memoryRecall,
        startSequence: lastSequence,
      });
    } catch (error) {
      yield createRunFailedEvent({
        eventId: this.options.ids.eventId(),
        sessionId: String(input.session.sessionId),
        runId: String(input.run.runId),
        sequence: lastSequence + 1,
        createdAt: this.options.clock.now(),
        error: createRuntimeErrorFromUnknown(error),
      });
    }
  }

  private resolveToolDefinitions(
    input: CodingAgentRunSessionMessageInput,
    providerCapabilitySummary: { supportsToolCall?: boolean },
    startSequence: number,
  ): {
    toolDefinitions?: ToolDefinition[];
    events: RuntimeEvent[];
  } {
    if (input.session.workspacePath && input.session.workspaceId && this.options.toolRegistrySnapshotProvider) {
      const snapshot = this.options.toolRegistrySnapshotProvider.createRunSnapshot({
        runId: String(input.run.runId),
        sessionId: String(input.session.sessionId),
        projectId: String(input.session.workspaceId),
        permissionMode: input.permissionMode,
        modelId: input.modelId,
        createdAt: input.createdAt,
        providerCapabilitySummary,
      });
      return {
        toolDefinitions: snapshot.modelVisibleToolDefinitions,
        events: snapshot.events.map((event, index) => ({
          ...event,
          sequence: event.sequence > startSequence ? event.sequence : startSequence + index + 1,
        })),
      };
    }

    if (input.session.workspacePath && this.options.toolDefinitionProvider) {
      return {
        toolDefinitions: this.options.toolDefinitionProvider.listDefinitions({
          runId: String(input.run.runId),
          permissionMode: input.permissionMode,
          providerCapabilitySummary,
        }),
        events: [],
      };
    }

    return { events: [] };
  }

  private async recallMemory(
    input: CodingAgentRunSessionMessageInput,
    requestedCwd: string | undefined,
  ): Promise<{
    memoryRecallSources?: ModelInputMemoryRecallSource[];
    memoryRecallSeed?: ModelInputContextBuildRequest['memoryRecallSeed'];
  }> {
    if (!this.options.memoryRecallService) {
      return {};
    }

    const effectiveCwd = resolveRecallEffectiveCwd(input.session.workspacePath, requestedCwd);
    return this.options.memoryRecallService.recallForNewUserInput({
      ...(input.session.workspaceId ? { projectId: String(input.session.workspaceId) } : {}),
      ...(input.session.workspacePath ? { projectRoot: input.session.workspacePath } : {}),
      ...(effectiveCwd ? { effectiveCwd } : {}),
      sessionId: String(input.session.sessionId),
      runId: String(input.run.runId),
      modelStepId: String(input.step.stepId),
      queryText: input.inputPreprocessing.effectiveUserText,
      providerId: String(input.providerId),
      modelId: input.modelId,
      enabled: input.memoryEnabled,
      createdAt: input.createdAt,
    });
  }
}

function resolveRecallEffectiveCwd(projectRoot: string | undefined, requestedCwd: string | undefined): string | undefined {
  if (!requestedCwd) {
    return projectRoot;
  }
  if (/^[A-Za-z]:[\\/]/.test(requestedCwd) || requestedCwd.startsWith('/')) {
    return requestedCwd;
  }
  return projectRoot ? `${projectRoot.replace(/[\\/]+$/, '')}/${requestedCwd.replace(/^[\\/]+/, '')}` : requestedCwd;
}

function withRequestMetadata(
  event: RuntimeEvent,
  input: CodingAgentRunSessionMessageInput,
): RuntimeEvent {
  return {
    ...event,
    requestId: event.requestId ?? input.requestId,
    ...(event.context ? { context: event.context } : input.runtimeContext ? { context: input.runtimeContext } : {}),
  };
}
