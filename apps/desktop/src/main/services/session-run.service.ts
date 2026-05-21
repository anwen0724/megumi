import path from 'node:path';
import { runTurn } from '@megumi/core/run-runtime/run-turn';
import type { RunHostBoundaryPort, RunIdFactory } from '@megumi/core/run-runtime/types';
import {
  runModelToolLoop,
  type PendingToolApprovalContinuation,
  type ToolApprovalResumeInput,
  type ToolApprovalResumePort,
  type ToolUseHandlerPort,
} from '@megumi/core/run-runtime/tool-loop';
import {
  createRunCompletedEvent,
  createRunStartedEvent,
  createRunStatusChangedEvent,
  createStepCompletedEvent,
  createStepFailedEvent,
  createStepStatusChangedEvent,
} from '@megumi/core/run-runtime/events';
import { createDatabase } from '@megumi/db/connection';
import { SessionRunRepository } from '@megumi/db/repos/session-run.repo';
import { RunModeRepository } from '@megumi/db/repos/run-mode.repo';
import { migrateDatabase } from '@megumi/db/schema/migrations';
import type {
  RunContext,
  ModelCapabilitySummary,
} from '@megumi/shared/run-context-contracts';
import type { Run, RunStep, Session, SessionMessage } from '@megumi/shared/session-run-contracts';
import {
  isPermissionMode,
  type PermissionMode,
  type PermissionModeSnapshot,
} from '@megumi/shared/permission-mode-contracts';
import type {
  RunStartPayload,
  PlanStatusUpdatePayload,
  SessionCreatePayload,
  SessionMessageCancelPayload,
  SessionMessageSendData,
  SessionMessageSendPayload,
} from '@megumi/shared/ipc-schemas';
import type { ModelStepRuntimeRequest } from '@megumi/shared/model-step-contracts';
import type { ImplementationPlanArtifactRecord, RunMode, RunModeSnapshot } from '@megumi/shared/run-mode-contracts';
import type { RuntimeContext } from '@megumi/shared/runtime-context';
import type { RuntimeError } from '@megumi/shared/runtime-errors';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';
import { createRuntimeEvent, createToolResultCreatedEvent } from '@megumi/shared/runtime-event-factory';
import type { ToolResult } from '@megumi/shared/tool-contracts';
import { RunModeService } from './run-mode.service';
import type { MegumiHomePaths } from './megumi-home.service';

export interface SessionRunServiceClock {
  now(): string;
}

export interface SessionRunServiceIds extends RunIdFactory {
  sessionId(): string;
}

export interface SessionRunContextService {
  createBaselineContext(input: {
    runId: string;
    goal: string;
    workspaceId: string;
    workspacePath: string;
    modelCapabilitySummary: ModelCapabilitySummary;
  }): RunContext;
}

export interface SessionRunModelStepProvider {
  streamModelStep(request: ModelStepRuntimeRequest): AsyncIterable<RuntimeEvent>;
  cancelModelStep(requestId: string): boolean;
}

export interface SessionRunToolRuntimeFactory {
  create(input: {
    projectRoot: string;
    permissionMode: PermissionMode;
  }): Promise<ToolUseHandlerPort & ToolApprovalResumePort>;
}

interface ApprovalContinuationGroup {
  groupId: string;
  request: ModelStepRuntimeRequest;
  run: Run;
  step: RunStep;
  userMessageId: string;
  pendingByApprovalId: Map<string, PendingToolApprovalContinuation>;
  resolvedResults: ToolResult[];
  toolRuntime: ToolUseHandlerPort & ToolApprovalResumePort;
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
  hostBoundary?: RunHostBoundaryPort;
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
  reservedOutputTokens: 1024,
  availableInputTokens: 7168,
};

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
    eventId: () => `event:${crypto.randomUUID()}`,
    messageId: () => `message:${crypto.randomUUID()}`,
    debugId: () => `debug:${crypto.randomUUID()}`,
  };
}

export class SessionRunService {
  private readonly repository: SessionRunRepository;
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
  private readonly hostBoundary: RunHostBoundaryPort;
  private readonly clock: SessionRunServiceClock;
  private readonly ids: SessionRunServiceIds;
  private readonly pendingApprovals = new Map<string, ApprovalContinuationGroup>();
  private readonly pendingApprovalGroups = new Map<string, ApprovalContinuationGroup>();

  constructor(options: SessionRunServiceOptions) {
    this.repository = options.repository;
    this.contextService = options.contextService;
    this.runModeService = options.runModeService;
    this.modelStepProvider = options.modelStepProvider;
    this.toolRuntimeFactory = options.toolRuntimeFactory;
    this.clock = options.clock ?? defaultClock;
    this.ids = { ...createDefaultIds(), ...options.ids };
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
    const session = this.resolveSessionForMessage(input.payload);
    const runId = this.ids.runId();
    const stepId = this.ids.stepId();
    const createdAt = input.payload.createdAt;
    const lastUserMessage = findLastUserChatMessage(input.payload.messages);
    const permissionMode = input.payload.context?.permissionMode ?? 'default';
    const mode = permissionMode;

    if (!lastUserMessage) {
      throw new Error('Session message send requires a user message.');
    }

    const userMessage = this.repository.saveMessage({
      messageId: this.ids.messageId(),
      sessionId: session.sessionId,
      runId,
      role: 'user',
      content: lastUserMessage.content,
      status: 'completed',
      createdAt: lastUserMessage.createdAt,
      completedAt: lastUserMessage.createdAt,
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
    const step = this.repository.saveStep({
      stepId,
      runId,
      kind: 'model',
      status: 'running',
      title: 'Model response',
      startedAt: createdAt,
    });
    const context = this.createInitialContextForSessionMessage({
      runId,
      goal: userMessage.content,
      session,
    });
    const request: ModelStepRuntimeRequest = {
      requestId: input.requestId,
      sessionId: session.sessionId,
      runId,
      stepId,
      providerId: input.payload.providerId,
      modelId: input.payload.modelId,
      messages: toSessionMessagesForModelStep(input.payload, session.sessionId, runId, userMessage),
      ...(context ? { context } : {}),
      ...(modeSnapshot ? {
        modeSnapshot: toPermissionModeSnapshot(modeSnapshot, createdAt),
        modeSnapshotRef: modeSnapshot.modeSnapshotId,
      } : {}),
      runtimeContext: input.runtimeContext,
      createdAt,
    };
    const toolRuntime = session.workspacePath
      ? await this.toolRuntimeFactory?.create({
          projectRoot: session.workspacePath,
          permissionMode,
        })
      : undefined;

    return {
      data: { requestId: input.requestId },
      events: this.streamAndPersistModelStep({
        request,
        run,
        step,
        userMessageId: userMessage.messageId,
        ...(toolRuntime ? { toolRuntime } : {}),
      }),
    };
  }

  cancelSessionMessage(payload: SessionMessageCancelPayload): boolean {
    return this.modelStepProvider?.cancelModelStep(payload.targetRequestId) ?? false;
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
    });
  }

  listRuntimeEventsByRun(runId: string): RuntimeEvent[] {
    return this.repository.listRuntimeEventsByRun(runId);
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

  private async *streamAndPersistModelStep(input: {
    request: ModelStepRuntimeRequest;
    run: Run;
    step: RunStep;
    userMessageId: string;
    toolRuntime?: ToolUseHandlerPort & ToolApprovalResumePort;
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
    const modelStepsById = new Map<string, RunStep>([[input.step.stepId, input.step]]);

    if (input.emitRunStarted !== false) {
      const startedEvent = withRequestMetadata(createRunStartedEvent({
        eventId: this.ids.eventId(),
        sessionId: input.request.sessionId,
        runId: input.request.runId,
        sequence: lastSequence += 1,
        createdAt: input.request.createdAt,
      }), input.request);
      this.repository.appendRuntimeEvent(startedEvent);
      yield startedEvent;
    }

    const modelStepProvider = this.requireModelStepProvider();
    const toolRuntime = input.toolRuntime;
    const modelEvents = toolRuntime
      ? runModelToolLoop({
          request: input.request,
          aiPort: {
            streamModelStep: ({ request }) => modelStepProvider.streamModelStep(request),
          },
          toolUseHandler: toolRuntime,
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
        })
      : modelStepProvider.streamModelStep(input.request);

    for await (const event of modelEvents) {
      const eventWithRequest = withSequenceAfter(withRequestMetadata(event, input.request), lastSequence);
      lastSequence = eventWithRequest.sequence;
      this.repository.appendRuntimeEvent(eventWithRequest);
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

    if (pendingContinuations.length > 0 && toolRuntime) {
      const waitingAt = this.clock.now();
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
        userMessageId: input.userMessageId,
        pendingByApprovalId: new Map(pendingContinuations.map((pending) => [
          pending.pendingApproval.approvalRequest.approvalRequestId,
          pending,
        ])),
        resolvedResults: [],
        toolRuntime,
      };
      this.pendingApprovalGroups.set(groupId, group);
      for (const approvalRequestId of group.pendingByApprovalId.keys()) {
        this.pendingApprovals.set(approvalRequestId, group);
      }
      const waitingEvent = withRequestMetadata(createRunStatusChangedEvent({
        eventId: this.ids.eventId(),
        sessionId: input.request.sessionId,
        runId: input.request.runId,
        sequence: lastSequence += 1,
        createdAt: waitingAt,
        from: 'running',
        to: 'waiting_for_approval',
      }), input.request);
      this.repository.appendRuntimeEvent(waitingEvent);
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
        this.repository.appendRuntimeEvent(eventWithRequest);
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
        this.repository.appendRuntimeEvent(eventWithRequest);
        yield eventWithRequest;
      }
      return;
    }

    if (!(sawAssistantOutputCompleted || sawFinalModelStepCompleted) || assistantContent.length === 0) {
      return;
    }

    this.repository.saveMessage({
      messageId: this.ids.messageId(),
      sessionId: input.request.sessionId,
      runId: input.request.runId,
      role: 'assistant',
      content: assistantContent,
      status: 'completed',
      createdAt: completedAt,
      completedAt,
      metadata: {
        triggerMessageId: input.userMessageId,
      },
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
      this.repository.appendRuntimeEvent(eventWithRequest);
      yield eventWithRequest;
    }
  }

  private requireModelStepProvider(): SessionRunModelStepProvider {
    if (!this.modelStepProvider) {
      throw new Error('Model step provider service is not configured.');
    }

    return this.modelStepProvider;
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

    const toolResult = await continuation.toolRuntime.resumeToolApproval(input);
    if (!toolResult) {
      return;
    }

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
    this.repository.appendRuntimeEvent(approvalResolvedEvent);
    yield approvalResolvedEvent;

    if (continuation.pendingByApprovalId.size > 0) {
      const toolResultEvent = this.createToolResultRuntimeEvent({
        request: continuation.request,
        stepId: continuation.step.stepId,
        sequence: lastSequence += 1,
        toolResult,
      });
      this.repository.appendRuntimeEvent(toolResultEvent);
      yield toolResultEvent;
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
    this.repository.appendRuntimeEvent(runningEvent);
    yield runningEvent;

    const toolResultEvent = this.createToolResultRuntimeEvent({
      request: continuation.request,
      stepId: continuation.step.stepId,
      sequence: lastSequence += 1,
      toolResult,
    });
    this.repository.appendRuntimeEvent(toolResultEvent);
    yield toolResultEvent;

    const resumedStep = this.repository.saveStep({
      stepId: this.ids.stepId(),
      runId: continuation.request.runId,
      kind: 'model',
      status: 'running',
      title: 'Model response',
      startedAt: input.decidedAt,
    });
    const resumedRequest: ModelStepRuntimeRequest = {
      ...continuation.request,
      stepId: resumedStep.stepId,
      modelStepId: `model-step:${crypto.randomUUID()}`,
      toolResults: [
        ...(pending.request.toolResults ?? []),
        ...continuation.resolvedResults,
      ],
      createdAt: input.decidedAt,
    };

    yield* this.streamAndPersistModelStep({
      request: resumedRequest,
      run: runningRun,
      step: resumedStep,
      userMessageId: continuation.userMessageId,
      startSequence: lastSequence,
      toolRuntime: continuation.toolRuntime,
      emitRunStarted: false,
    });
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
        toolUseId: String(input.toolResult.toolUseId),
        ...(input.toolResult.toolCallId ? { toolCallId: String(input.toolResult.toolCallId) } : {}),
        kind: input.toolResult.kind,
        summary: createToolResultSummary(input.toolResult),
      },
    }), input.request);
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

function findLastUserChatMessage(
  messages: SessionMessageSendPayload['messages'],
): SessionMessageSendPayload['messages'][number] | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'user') {
      return message;
    }
  }
  return undefined;
}

function toSessionMessagesForModelStep(
  payload: SessionMessageSendPayload,
  sessionId: string,
  runId: string,
  persistedUserMessage: SessionMessage,
): SessionMessage[] {
  const lastUserMessage = findLastUserChatMessage(payload.messages);

  return payload.messages.map((message) => {
    if (message === lastUserMessage) {
      return persistedUserMessage;
    }

    return {
      messageId: message.id,
      sessionId,
      runId,
      role: toSessionMessageRole(message.role),
      content: message.content,
      status: 'completed',
      createdAt: message.createdAt,
      completedAt: message.createdAt,
    };
  });
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

function withRequestMetadata(event: RuntimeEvent, request: ModelStepRuntimeRequest): RuntimeEvent {
  return {
    ...event,
    requestId: event.requestId ?? request.requestId,
    ...(event.context ? { context: event.context } : request.runtimeContext ? { context: request.runtimeContext } : {}),
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

function toSessionMessageRole(
  role: SessionMessageSendPayload['messages'][number]['role'],
): ModelStepRuntimeRequest['messages'][number]['role'] {
  return role === 'tool' ? 'host' : role;
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
}

export function createDefaultSessionRunService(
  homePaths: MegumiHomePaths,
  options: CreateDefaultSessionRunServiceOptions = {},
): SessionRunService {
  const database = createDatabase(path.join(homePaths.sqlitePath, 'megumi.sqlite3'));
  migrateDatabase(database);
  const runModeRepository = new RunModeRepository(database);

  return new SessionRunService({
    repository: new SessionRunRepository(database),
    runModeService: new RunModeService({ repository: runModeRepository }),
    ...(options.contextService ? { contextService: options.contextService } : {}),
    ...(options.toolRuntimeFactory ? { toolRuntimeFactory: options.toolRuntimeFactory } : {}),
  });
}
