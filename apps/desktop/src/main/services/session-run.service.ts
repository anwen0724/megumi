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
  type ToolUseHandlerPort,
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
import { RunModeRepository } from '@megumi/db/repos/run-mode.repo';
import { migrateDatabase } from '@megumi/db/schema/migrations';
import type {
  RunContext,
  ModelCapabilitySummary,
} from '@megumi/shared/run-context-contracts';
import type {
  AgentInstructionSourceSnapshot,
} from '@megumi/shared/model-input-context-contracts';
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
  SessionTimelineListData,
  SessionTimelineListPayload,
} from '@megumi/shared/ipc-schemas';
import type { ModelStepRuntimeRequest } from '@megumi/shared/model-step-contracts';
import type { ImplementationPlanArtifactRecord, RunMode, RunModeSnapshot } from '@megumi/shared/run-mode-contracts';
import type { RuntimeContext } from '@megumi/shared/runtime-context';
import type { RuntimeError } from '@megumi/shared/runtime-errors';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';
import { createRuntimeEvent, createToolResultCreatedEvent } from '@megumi/shared/runtime-event-factory';
import type {
  AnswerTextBlock,
  ProcessDisclosureBlock,
  ProcessDisclosureItem,
  TimelineMessage,
} from '@megumi/shared/timeline-message-blocks';
import type { ToolDefinition, ToolResult } from '@megumi/shared/tool-contracts';
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

export interface SessionRunServiceClock {
  now(): string;
}

export interface SessionRunServiceIds extends RunIdFactory {
  sessionId(): string;
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

export interface SessionRunToolDefinitionProvider {
  listDefinitions(input: {
    runId: string;
    permissionMode: PermissionMode;
    providerCapabilitySummary?: {
      supportsToolUse?: boolean;
    };
  }): ToolDefinition[];
}

export interface SessionRunAgentInstructionSourceService {
  loadInstructionSources(input: LoadInstructionSourcesInput): Promise<AgentInstructionSourceSnapshot[]>;
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
  toolRuntime: ToolUseHandlerPort & ToolApprovalResumePort;
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
    chatStreamEventId: () => `chat-stream-event:${crypto.randomUUID()}`,
    chatStreamId: ({ runId }) => `chat-stream:${runId}:${crypto.randomUUID()}`,
    chatTextId: () => `text:${crypto.randomUUID()}`,
    chatThinkingId: () => `thinking:${crypto.randomUUID()}`,
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
  private readonly toolDefinitionProvider?: SessionRunToolDefinitionProvider;
  private readonly agentInstructionSourceService?: SessionRunAgentInstructionSourceService;
  private readonly hostBoundary: RunHostBoundaryPort;
  private readonly chatStreamEventSink?: ChatStreamEventSink;
  private readonly timelineMessageRepository?: SessionRunServiceOptions['timelineMessageRepository'];
  private readonly clock: SessionRunServiceClock;
  private readonly ids: SessionRunServiceIds;
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
    this.contextService = options.contextService;
    this.runModeService = options.runModeService;
    this.modelStepProvider = options.modelStepProvider;
    this.toolRuntimeFactory = options.toolRuntimeFactory;
    this.toolDefinitionProvider = options.toolDefinitionProvider;
    this.agentInstructionSourceService = options.agentInstructionSourceService;
    this.chatStreamEventSink = options.chatStreamEventSink;
    this.timelineMessageRepository = options.timelineMessageRepository;
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

  listTimelineMessagesBySession(input: SessionTimelineListPayload): SessionTimelineListData {
    if (!this.timelineMessageRepository) {
      return { messages: [], diagnostics: [] };
    }

    return this.timelineMessageRepository.listCommittedMessagesBySession(input);
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
    const toolDefinitions = session.workspacePath && this.toolDefinitionProvider
      ? this.toolDefinitionProvider.listDefinitions({
          runId,
          permissionMode,
          providerCapabilitySummary: { supportsToolUse: true },
        })
      : undefined;
    const modelContextMessages = this.timelineMessageRepository
      ? [
          ...timelineMessagesToModelContext(
            this.timelineMessageRepository.listCommittedMessagesBySession({
              projectId: timelineProjectIdForSession(session),
              sessionId: String(session.sessionId),
            }).messages,
            String(session.sessionId),
          ),
          userMessage,
        ]
      : toSessionMessagesForModelStep(input.payload, session.sessionId, runId, userMessage);
    const instructionSources = await this.loadInstructionSourcesForModelStep({
      ...(session.workspacePath ? { projectRoot: session.workspacePath } : {}),
      loadedAt: createdAt,
    });
    const inputContext = buildModelStepInputContextFromSources({
      contextId: createModelStepInputContextId({
        stepId: String(stepId),
        contextKind: 'initial',
      }),
      sessionId: String(session.sessionId),
      runId: String(runId),
      stepId: String(stepId),
      buildReason: 'initial_model_step',
      builtAt: createdAt,
      currentMessage: userMessage,
      historyMessages: modelContextMessages.filter((message) => message.messageId !== userMessage.messageId),
      instructionSources,
      ...(context ? { runContext: context } : {}),
      ...(modeSnapshot ? {
        modeSnapshot: toPermissionModeSnapshot(modeSnapshot, createdAt),
        modeSnapshotRef: modeSnapshot.modeSnapshotId,
      } : {}),
    });
    const request: ModelStepRuntimeRequest = {
      requestId: input.requestId,
      sessionId: session.sessionId,
      runId,
      stepId,
      providerId: input.payload.providerId,
      modelId: input.payload.modelId,
      inputContext,
      ...(toolDefinitions && toolDefinitions.length > 0 ? { toolDefinitions } : {}),
      runtimeContext: input.runtimeContext,
      createdAt,
    };
    const toolRuntime = session.workspacePath
      ? await this.toolRuntimeFactory?.create({
          projectRoot: session.workspacePath,
          permissionMode,
        })
      : undefined;
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
    this.activeSessionMessageRuns.set(input.requestId, {
      runId,
      sessionId: session.sessionId,
      stepId,
      ...(chatStreamAdapter ? { chatStreamAdapter } : {}),
    });

    return {
      data: { requestId: input.requestId },
      events: this.trackActiveSessionMessageRun(input.requestId, this.streamAndPersistModelStep({
        request,
        run,
        step,
        userMessageId: userMessage.messageId,
        ...(session.workspacePath ? { projectRoot: session.workspacePath } : {}),
        ...(toolRuntime ? { toolRuntime } : {}),
        ...(chatStreamAdapter ? { chatStreamAdapter } : {}),
      })),
    };
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

  private async *streamAndPersistModelStep(input: {
    request: ModelStepRuntimeRequest;
    run: Run;
    step: RunStep;
    userMessageId: string;
    toolRuntime?: ToolUseHandlerPort & ToolApprovalResumePort;
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
          buildContinuationInputContext: async (contextInput) => buildModelStepInputContextFromSources({
            ...contextInput,
            instructionSources: await this.loadInstructionSourcesForModelStep({
              ...(input.projectRoot ? { projectRoot: input.projectRoot } : {}),
              loadedAt: contextInput.builtAt,
            }),
          }),
        })
      : modelStepProvider.streamModelStep(input.request);

    try {
      for await (const event of coalesceTextDeltaRuntimeEvents(modelEvents)) {
        registerPendingApprovalGroup();
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

  private appendRuntimeEvent(event: RuntimeEvent, chatStreamAdapter?: ChatStreamEventAdapter): void {
    this.repository.appendRuntimeEvent(event);
    chatStreamAdapter?.handleRuntimeEvent(event);
    if (isRunTerminalRuntimeEvent(event)) {
      chatStreamAdapter?.dispose();
    }
  }

  private requireModelStepProvider(): SessionRunModelStepProvider {
    if (!this.modelStepProvider) {
      throw new Error('Model step provider service is not configured.');
    }

    return this.modelStepProvider;
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
        toolUses: pending.accumulatedToolUses,
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
        toolUseId: String(input.toolResult.toolUseId),
        ...(input.toolResult.toolCallId ? { toolCallId: String(input.toolResult.toolCallId) } : {}),
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
      event.eventType !== 'tool.use.created'
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

function timelineProjectIdForSession(session: Session): string {
  return String(session.workspaceId ?? session.sessionId);
}

function timelineMessagesToModelContext(
  messages: TimelineMessage[],
  sessionId: string,
): SessionMessage[] {
  return messages.flatMap((message): SessionMessage[] => {
    if (message.role === 'user') {
      const text = message.blocks
        .filter((block) => block.kind === 'user_text')
        .map((block) => block.text)
        .join('\n')
        .trim();

      return text ? [{
        messageId: String(message.messageId),
        sessionId,
        ...(message.runId ? { runId: String(message.runId) } : {}),
        role: 'user',
        content: text,
        status: 'completed',
        createdAt: message.createdAt,
        completedAt: message.updatedAt ?? message.createdAt,
      }] : [];
    }

    const answerMessages = assistantAnswerContextMessages(message, sessionId);
    const statusNote = assistantStatusNote(message);
    return statusNote ? [
      ...answerMessages,
      {
        messageId: `context-status:${message.messageId}`,
        sessionId,
        runId: String(message.runId),
        role: 'assistant',
        content: statusNote,
        status: 'completed',
        createdAt: message.updatedAt ?? message.createdAt,
        completedAt: message.updatedAt ?? message.createdAt,
      },
    ] : answerMessages;
  });
}

function assistantAnswerContextMessages(
  message: Extract<TimelineMessage, { role: 'assistant' }>,
  sessionId: string,
): SessionMessage[] {
  return message.blocks
    .filter((block): block is AnswerTextBlock => block.kind === 'answer_text' && block.text.trim().length > 0)
    .filter((block) => block.status === 'completed' || block.status === 'failed' || block.status === 'cancelled_partial')
    .map((block) => ({
      messageId: String(block.textId),
      sessionId,
      runId: String(message.runId),
      role: 'assistant' as const,
      content: block.text,
      status: block.status === 'completed' ? 'completed' as const : block.status === 'failed' ? 'failed' as const : 'cancelled' as const,
      createdAt: block.createdAt ?? message.createdAt,
      completedAt: block.updatedAt ?? message.updatedAt ?? message.createdAt,
    }));
}

function assistantStatusNote(message: Extract<TimelineMessage, { role: 'assistant' }>): string | undefined {
  const process = message.blocks
    .filter((block): block is ProcessDisclosureBlock => block.kind === 'process_disclosure')
    .find((block) => block.status === 'failed' || block.status === 'cancelled');
  const partialAnswer = message.blocks
    .filter((block): block is AnswerTextBlock => block.kind === 'answer_text')
    .find((block) => block.status === 'failed' || block.status === 'cancelled_partial');

  if (process?.status === 'failed') {
    return formatFailedTurnStatusNote(process);
  }
  if (process?.status === 'cancelled') {
    return '[Previous turn cancelled by user. Partial work should not be continued unless requested.]';
  }
  if (partialAnswer) {
    return '[Previous turn interrupted. The preceding assistant answer is partial.]';
  }

  return undefined;
}

function formatFailedTurnStatusNote(process: ProcessDisclosureBlock): string {
  const tool = firstSucceededTool(process.items);
  const error = firstError(process.items);
  const afterTool = tool ? ` after tool activity: ${tool}` : '';
  const errorText = error ? ` Error: ${error}` : '';
  return `[Previous turn failed${afterTool}. Final answer unavailable.${errorText}]`;
}

function firstSucceededTool(items: ProcessDisclosureItem[]): string | undefined {
  const tool = items.find((item) => item.kind === 'tool_activity' && item.status === 'succeeded');
  if (!tool || tool.kind !== 'tool_activity') {
    return undefined;
  }

  return [tool.toolName, tool.inputSummary].filter(Boolean).join(' ');
}

function firstError(items: ProcessDisclosureItem[]): string | undefined {
  const error = items.find((item) => item.kind === 'error_activity');
  return error?.kind === 'error_activity' ? error.errorMessage : undefined;
}

function toSessionMessagesForModelStep(
  payload: SessionMessageSendPayload,
  sessionId: string,
  runId: string,
  persistedUserMessage: SessionMessage,
): SessionMessage[] {
  const messages = payload.messages ?? (payload.message
    ? [{ ...payload.message, role: 'user' as const }]
    : []);
  const lastUserMessage = findLastUserChatMessage(messages);

  return messages.map((message) => {
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
  role: SessionMessageSendHistoryMessage['role'],
): SessionMessage['role'] {
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

  return new SessionRunService({
    repository: new SessionRunRepository(database),
    runModeService: new RunModeService({ repository: runModeRepository }),
    ...(options.contextService ? { contextService: options.contextService } : {}),
    ...(options.toolRuntimeFactory ? { toolRuntimeFactory: options.toolRuntimeFactory } : {}),
    agentInstructionSourceService: options.agentInstructionSourceService ?? new AgentInstructionSourceService(),
  });
}
