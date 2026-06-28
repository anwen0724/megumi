// Owns Coding Agent product-level run orchestration while callers own persistence and UI projection.
import type { ContextBudgetPolicy } from '@megumi/shared/context';
import type { InputPreprocessingResult } from '@megumi/shared/input';
import type { ModelCapabilitySummary } from '@megumi/shared/run';
import type { ModelInputContextBuildRequest, ModelStepRuntimeRequest } from '@megumi/shared/model';
import type { PermissionMode, PermissionModeSnapshot } from '@megumi/shared/permission';
import type { ProviderId } from '@megumi/shared/provider';
import type { RuntimeContext, RuntimeError, RuntimeEvent } from '@megumi/shared/runtime';
import type { Run, RunStep, Session, SessionContextInput, SessionMessage } from '@megumi/shared/session';
import type { ParsedInput } from '@megumi/coding-agent/input';
import {
  AgentLoopInitialModelInputPreparationService,
} from '../../context';
import type {
  AgentLoopInitialModelInputPreparation,
  BuildModelCallInputInput,
  BuildModelCallInputResult,
  CompactIfNeededInput,
  ModelInputMemoryRecallSource,
  PrepareAgentLoopInitialModelInputInput,
  SessionCompactionOrchestrationResult,
} from '../../context';
import type { BuildSessionContextInputFromRepositoryInput } from '../../session';
import { createRunFailedEvent, createRunStartedEvent } from '../../events';
import {
  createRuntimeErrorFromUnknown,
  modelCallInputBuildFailureToRuntimeError,
} from '../../events';
import type { ModelCallPort } from '../../agent-loop/model-call';
import {
  streamCodingAgentModelToolLoop,
  type CodingAgentRunSourceOverrideProvider,
  type PrepareToolSetInput,
  type PrepareToolSetResult,
} from '../../agent-loop';
import type {
  PendingToolApprovalResume,
} from '../../agent-loop/tool-call';
import type { ToolCallRunnerService } from '../../agent-loop/tool-call';

export interface CodingAgentRunClock {
  now(): string;
}

export interface CodingAgentRunIds {
  eventId(): string;
}

export interface CodingAgentRunEventPort {
  /** Persist a runtime event and return it with caller metadata attached. */
  append(
    event: RuntimeEvent,
    requestId: string,
    runtimeContext?: RuntimeContext,
  ): RuntimeEvent;
}

export interface CodingAgentRunStatePort {
  getRunStatus(runId: string): string | undefined;
}

export interface CodingAgentRunFailurePort {
  /** Produce the desktop-side terminal events for a pre-model-step failure. */
  failBeforeModelStep(input: {
    requestId: string;
    runtimeContext?: RuntimeContext;
    sessionId: string;
    run: Run;
    step: RunStep;
    error: RuntimeError;
  }): AsyncIterable<RuntimeEvent>;
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

export interface CodingAgentRunToolCallRunnerFactory {
  create(input: {
    projectRoot: string;
    permissionMode: PermissionMode;
  }): Promise<ToolCallRunnerService>;
}

export interface CodingAgentRunEventRecorder {
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

export interface RunTurnOptions {
  clock: CodingAgentRunClock;
  ids: CodingAgentRunIds;
  eventPort: CodingAgentRunEventPort;
  runStatePort: CodingAgentRunStatePort;
  failurePort: CodingAgentRunFailurePort;
  contextService?: CodingAgentRunContextService;
  sessionContextInputService: CodingAgentRunSessionContextInputService;
  sourceOverrideProvider: CodingAgentRunSourceOverrideProvider;
  memoryRecallService?: CodingAgentRunMemoryRecallService;
  modelCallPort: ModelCallPort;
  toolCallRunnerFactory?: CodingAgentRunToolCallRunnerFactory;
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
    prepareToolSet(
      input: PrepareToolSetInput,
    ): PrepareToolSetResult;
  };
  runEventRecorder: CodingAgentRunEventRecorder;
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

export class RunTurn {
  private readonly initialModelInputPreparationService: {
    prepare(input: PrepareAgentLoopInitialModelInputInput): Promise<AgentLoopInitialModelInputPreparation>;
  };
  private readonly toolSetService: {
    prepareToolSet(
      input: PrepareToolSetInput,
    ): PrepareToolSetResult;
  };

  constructor(private readonly options: RunTurnOptions) {
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

  async *runSessionMessage(input: CodingAgentRunSessionMessageInput): AsyncIterable<RuntimeEvent> {
    const requestMeta = { requestId: input.requestId, runtimeContext: input.runtimeContext };
    let runStartedAppended = false;

    try {
      // Agent-loop owns ToolSet selection; context owns model input preparation.
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

      // If the probe already failed, yield run.started + the failure and return.
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
        yield* this.options.failurePort.failBeforeModelStep({
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

      // Context has already built the compaction probe; start compaction
      // before run.started so cancellation can happen while it is in-flight.
      const compactionPromise: Promise<SessionCompactionOrchestrationResult> =
        initialModelInputPreparation.startCompaction();

      // Yield run.started and tool-registry events.  The caller can now
      // cancel the run while compaction is still in progress.
      {
        const ev = this.options.eventPort.append(
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
        yield ev;
      }
      for (const event of toolSet.events) {
        const ev = this.options.eventPort.append(event, requestMeta.requestId, requestMeta.runtimeContext);
        yield ev;
      }

      // Await the already-started compaction.
      const compaction = await compactionPromise;

      for (const event of compaction.events) {
        const ev = this.options.eventPort.append(event, requestMeta.requestId, requestMeta.runtimeContext);
        yield ev;
      }

      // After compaction, check whether the run was cancelled.  This must
      // happen before the failure check so that a cancelled run does not
      // receive extra terminal events.
      const currentRunStatus = this.options.runStatePort.getRunStatus(
        String(input.run.runId),
      );
      if (currentRunStatus === 'cancelling' || currentRunStatus === 'cancelled') {
        return;
      }

      if (compaction.status === 'failed') {
        yield* this.options.failurePort.failBeforeModelStep({
          requestId: input.requestId,
          runtimeContext: input.runtimeContext,
          sessionId: String(input.session.sessionId),
          run: input.run,
          step: input.step,
          error: compaction.failure,
        });
        return;
      }

      // Build the initial model input and stream through the model executor.
      const initialModelInput = await initialModelInputPreparation.buildInitialModelInput();
      if (initialModelInput.failure) {
        yield* this.options.failurePort.failBeforeModelStep({
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
        toolRuntime = input.session.workspacePath && this.options.toolCallRunnerFactory
          ? await this.options.toolCallRunnerFactory.create({
              projectRoot: input.session.workspacePath,
              permissionMode: input.permissionMode,
            })
          : undefined;
      } catch (error) {
        yield* this.options.failurePort.failBeforeModelStep({
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
            nextStepId: ({ runId }) => this.options.runEventRecorder.createModelStep?.({ runId })
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

      yield* this.options.runEventRecorder.recordModelCallEvents({
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
      // Yield run.started first so the caller always sees it, then
      // delegate to the failure port for terminal events.
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
      yield* this.options.failurePort.failBeforeModelStep({
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
