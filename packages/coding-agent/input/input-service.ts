// Handles user input entering a Coding Agent session, including message persistence and agent-loop invocation.
import type { InputPreprocessingResult } from '@megumi/coding-agent/input';
import type {
  SessionMessageSendData,
  SessionMessageSendPayload,
} from '@megumi/shared/ipc';
import type { PermissionMode, PermissionModeState, PermissionSnapshotRecord } from '@megumi/shared/permission';
import type { ProviderId } from '@megumi/shared/provider';
import type { RuntimeContext, RuntimeError, RuntimeEvent } from '@megumi/shared/runtime';
import type {
  Run,
  RunAction,
  RunObservation,
  RunStep,
  Session,
  SessionCompactionEntry,
  SessionMessage,
} from '@megumi/shared/session';
import type { ModelStepRuntimeRequest } from '@megumi/shared/model';
import type { ParsedInput } from './parsed-input';
import {
  parseSessionMessageRawInput,
  prepareSessionMessageInput,
  type SessionMessageInputMessage,
} from './session-message';
import {
  createRunPermissionSnapshot,
  type RunPermissionSnapshotServicePort,
} from '../permissions';
import {
  canResumeApprovalFromRunStatus,
  failAgentLoopBeforeModelCall,
  type RunTerminalCoordinatorPort,
  attachRunPermissionSnapshot,
  startAgentLoopRun,
  ActiveSessionMessageRunTracker,
  type RunRetryActivePathRepositoryPort,
  type RunRetryCoordinatorPort,
} from '../state';
import { runTurn, type RunHostBoundaryPort, type RunIdFactory } from '../state/lifecycle';
import {
  SessionContextInputService,
  SessionMessageService,
  type SessionBranchActivePathRepository,
  type SessionBranchServicePort,
  type SessionContextInputActivePathRepository,
  type SessionContextInputBuildPort,
  type SessionServiceActivePathRepository,
  type SessionServicePort,
} from '../session';
import {
  createSessionMessageChatStreamAdapter,
  type ChatStreamEventAdapter,
  type ChatStreamEventSink,
} from '../projections/chat-stream';
import {
  type ApprovalResumeGroup,
  ensureToolCallRunnerService,
  PendingApprovalRegistry,
  type ResumeToolApprovalInput,
} from '../agent-loop/tool-call';
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
  type SessionCompactionActivePathRepository,
  type SessionCompactionOrchestratorRepository,
  type SessionCompactionOrchestrationResult,
} from '../context';
import {
  RuntimeEventLog,
  RuntimeEventPublisher,
} from '../events';
import type { ModelCallRecord } from '../persistence/repos/agent-loop.repo';
import type {
  SessionActivePath,
  SessionBranchMarker,
  SessionRetryAttempt,
  SessionSourceEntry,
} from '@megumi/shared/session';
import type {
  RunStartPayload,
  SessionTimelineListData,
} from '@megumi/shared/ipc';
import type { PlanArtifactServicePort } from '../artifacts';
import type { PostRunHooksPort } from '../hooks';
import type {
  MemoryProjectMirrorSyncPort,
  MemoryRecallPort,
} from '../memory';
import { resolveMemoryEnabled, type MemorySettingsPort } from '../settings';
import type { WorkspaceChangeReadPort } from '../workspace';
import type { ToolRegistrySnapshotServicePort } from '../tools/tool-registry-snapshot';
import { SessionRunControlService } from '../state/session-run-control-service';
import { toModelPermissionSnapshot } from '../permissions';
import type {
  CommandAgentRunInput,
  CommandExecutionResult,
  CommandService,
  HostInteractionRequest,
} from '../commands';

export interface InputSendRequest {
  requestId?: string;
  sessionId?: string;
  sessionTitle?: string;
  workspaceId?: string;
  workspaceLabel?: string;
  workspacePath?: string;
  providerId: ProviderId;
  modelId: string;
  text: string;
  clientMessageId?: string;
  createdAt?: string;
  permissionMode?: PermissionMode;
  permissionSource?: PermissionModeState['source'];
  preprocessing?: InputPreprocessingResult;
  branchDraft?: SessionMessageSendPayload['branchDraft'];
  runtimeContext?: RuntimeContext;
}

export type InputSendResult =
  | {
      type: 'agent_run';
      session: Session;
      requestId: string;
      userMessageId: string;
      runId: string;
      events: AsyncIterable<RuntimeEvent>;
    }
  | {
      type: 'host_interaction_request';
      session?: Session;
      requestId: string;
      request: HostInteractionRequest;
    }
  | {
      type: 'completed';
      session?: Session;
      requestId: string;
      message?: string;
    }
  | {
      type: 'error';
      session?: Session;
      requestId: string;
      message: string;
    };

export interface InputCancelRequest {
  targetRequestId: string;
}

export interface InputService {
  send(input: InputSendRequest): Promise<InputSendResult>;
  cancel(input: InputCancelRequest): boolean;
}

export interface InputServiceIds {
  requestId(): string;
  clientMessageId(): string;
}

export interface UserInputHandlerPort {
  handle(input: {
    requestId: string;
    payload: SessionMessageSendPayload;
    runtimeContext?: RuntimeContext;
    command?: CommandAgentRunInput['command'];
  }): Promise<{ data: SessionMessageSendData; events: AsyncIterable<RuntimeEvent> }>;
  cancel(input: InputCancelRequest): boolean;
}

export interface CreateInputServiceOptions {
  session: Pick<SessionServicePort, 'createSession' | 'listMessagesBySession' | 'listSessions'>;
  userInput: UserInputHandlerPort;
  commandService?: Pick<CommandService, 'handleCommandInput'>;
  ids?: Partial<InputServiceIds>;
}

export interface UserInputHandlerClock {
  now(): string;
}

export interface UserInputHandlerIds {
  runId(): string;
  stepId(): string;
  chatStreamEventId(): string;
  chatStreamId(input: { runId: string }): string;
  chatTextId(): string;
  chatThinkingId(): string;
}

export interface UserInputRunRepository {
  getRun(runId: string): Run | undefined;
  saveRun(run: Run): Run;
}

export interface UserInputStepRepository {
  saveStep(step: RunStep): RunStep;
}

export interface RunUserInputAgentLoopInput {
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
}

export interface CreateUserInputHandlerOptions {
  clock: UserInputHandlerClock;
  ids: UserInputHandlerIds;
  sessionMessages: SessionMessageService;
  activeRuns: ActiveSessionMessageRunTracker<ChatStreamEventAdapter>;
  runRepository: UserInputRunRepository;
  stepRepository: UserInputStepRepository;
  permissionSnapshotService?: RunPermissionSnapshotServicePort;
  sessionBranchService?: SessionBranchServicePort;
  runRetryCoordinator: Pick<RunRetryCoordinatorPort, 'recordManualRerunAttemptForBranchDraft'>;
  chatStreamEventSink?: ChatStreamEventSink;
  appendEvent(event: RuntimeEvent, projection?: ChatStreamEventAdapter): void;
  runAgentLoop(input: RunUserInputAgentLoopInput): AsyncIterable<RuntimeEvent>;
  cancelActiveInput(input: InputCancelRequest): boolean;
}

const defaultIds: InputServiceIds = {
  requestId: () => `input:${crypto.randomUUID()}`,
  clientMessageId: () => `message-local:${crypto.randomUUID()}`,
};

export function createInputService(options: CreateInputServiceOptions): InputService {
  const ids = { ...defaultIds, ...options.ids };

  return {
    send: (input) => handleUserInput(input, options, ids),
    cancel: (input) => cancelUserInput(input, options),
  };
}

export function createUserInputHandler(options: CreateUserInputHandlerOptions): UserInputHandlerPort {
  return {
    handle: (input) => submitUserInputToAgentLoop(input, options),
    cancel: (input) => options.cancelActiveInput(input),
  };
}

async function handleUserInput(
  input: InputSendRequest,
  options: CreateInputServiceOptions,
  ids: InputServiceIds,
): Promise<InputSendResult> {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const requestId = input.requestId ?? ids.requestId();

  const commandResult = await options.commandService?.handleCommandInput({
    raw_input: input.text,
  });

  if (commandResult && commandResult.type !== 'not_command') {
    return handleCommandExecutionResult({
      commandResult,
      input,
      options,
      ids,
      requestId,
      createdAt,
    });
  }

  return submitInputAsAgentRun({
    input,
    options,
    ids,
    requestId,
    createdAt,
  });
}

async function handleCommandExecutionResult(input: {
  commandResult: Exclude<CommandExecutionResult, { type: 'not_command' }>;
  input: InputSendRequest;
  options: CreateInputServiceOptions;
  ids: InputServiceIds;
  requestId: string;
  createdAt: string;
}): Promise<InputSendResult> {
  switch (input.commandResult.type) {
    case 'agent_run':
      return submitInputAsAgentRun({
        input: {
          ...input.input,
          text: input.commandResult.input.raw_input,
        },
        options: input.options,
        ids: input.ids,
        requestId: input.requestId,
        createdAt: input.createdAt,
        command: input.commandResult.input.command,
      });
    case 'host_interaction_request':
      return {
        type: 'host_interaction_request',
        requestId: input.requestId,
        request: input.commandResult.request,
      };
    case 'completed':
      return {
        type: 'completed',
        requestId: input.requestId,
        ...(input.commandResult.message ? { message: input.commandResult.message } : {}),
      };
    case 'error':
      return {
        type: 'error',
        requestId: input.requestId,
        message: input.commandResult.message,
      };
  }
}

async function submitInputAsAgentRun(input: {
  input: InputSendRequest;
  options: CreateInputServiceOptions;
  ids: InputServiceIds;
  requestId: string;
  createdAt: string;
  command?: CommandAgentRunInput['command'];
}): Promise<InputSendResult> {
  const session = resolveOrCreateInputSession(input.options.session, input.input, input.createdAt);
  const payload = createSessionMessageSendPayload(input.input, {
    sessionId: String(session.sessionId),
    clientMessageId: input.input.clientMessageId ?? input.ids.clientMessageId(),
    createdAt: input.createdAt,
  });
  const result = await input.options.userInput.handle({
    requestId: input.requestId,
    payload,
    ...(input.input.runtimeContext ? { runtimeContext: input.input.runtimeContext } : {}),
    ...(input.command ? { command: input.command } : {}),
  });
  const persistedUserMessage = findPersistedUserMessage(
    input.options.session.listMessagesBySession(String(session.sessionId)),
    input.input.text,
    input.createdAt,
  );

  if (!persistedUserMessage?.runId) {
    throw new Error('Input service did not persist a user message run.');
  }

  return {
    type: 'agent_run',
    session,
    requestId: result.data.requestId,
    userMessageId: String(persistedUserMessage.messageId),
    runId: String(persistedUserMessage.runId),
    events: result.events,
  };
}

function cancelUserInput(
  input: InputCancelRequest,
  options: CreateInputServiceOptions,
): boolean {
  return options.userInput.cancel(input);
}

// Converts host-facing input parameters into the session message payload consumed by the internal input handler.
function createSessionMessageSendPayload(
  input: InputSendRequest,
  payloadInput: {
    sessionId: string;
    clientMessageId: string;
    createdAt: string;
  },
): SessionMessageSendPayload {
  const context = createSessionMessageContext(input);
  return {
    sessionId: payloadInput.sessionId,
    providerId: input.providerId,
    modelId: input.modelId,
    message: {
      id: payloadInput.clientMessageId,
      content: input.text,
      createdAt: payloadInput.createdAt,
    },
    ...(Object.keys(context).length > 0 ? { context } : {}),
    ...(input.branchDraft ? { branchDraft: input.branchDraft } : {}),
    createdAt: payloadInput.createdAt,
  };
}

function createSessionMessageContext(input: InputSendRequest): NonNullable<SessionMessageSendPayload['context']> {
  return {
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    ...(input.workspaceLabel ? { workspaceLabel: input.workspaceLabel } : {}),
    ...(input.workspacePath ? { workspacePath: input.workspacePath } : {}),
    ...(input.sessionTitle ? { sessionTitle: input.sessionTitle } : {}),
    ...(input.permissionMode ? { permissionMode: input.permissionMode } : {}),
    ...(input.permissionSource ? { permissionSource: input.permissionSource } : {}),
    ...(input.preprocessing ? { preprocessing: input.preprocessing } : {}),
  };
}

function findPersistedUserMessage(
  messages: SessionMessage[],
  content: string,
  createdAt: string,
): SessionMessage | undefined {
  return messages
    .filter((message) => message.role === 'user' && message.content === content && message.createdAt === createdAt)
    .at(-1);
}

function resolveOrCreateInputSession(
  sessionService: Pick<SessionServicePort, 'createSession' | 'listSessions'>,
  input: InputSendRequest,
  createdAt: string,
): Session {
  if (input.sessionId) {
    const session = sessionService.listSessions()
      .find((candidate) => String(candidate.sessionId) === input.sessionId);
    if (!session) {
      throw new Error(`Cannot send input to missing session: ${input.sessionId}`);
    }
    return session;
  }

  return sessionService.createSession({
    title: input.sessionTitle ?? titleFromInput(input.text),
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    ...(input.workspacePath ? { workspacePath: input.workspacePath } : {}),
    createdAt,
  });
}

function titleFromInput(text: string): string {
  const title = text.trim().replace(/\s+/g, ' ').slice(0, 80);
  return title.length > 0 ? title : 'New session';
}

async function submitUserInputToAgentLoop(
  input: {
    requestId: string;
    payload: SessionMessageSendPayload;
    runtimeContext?: RuntimeContext;
    command?: CommandAgentRunInput['command'];
  },
  options: CreateUserInputHandlerOptions,
): Promise<{ data: SessionMessageSendData; events: AsyncIterable<RuntimeEvent> }> {
  const branchDraftMarker = resolveBranchDraftMarker(input.payload, options);
  const runId = options.ids.runId();
  const stepId = options.ids.stepId();
  const createdAt = input.payload.createdAt;

  // runtime normalization is the trust boundary before persistence and model-visible context building.
  const sessionMessageInput = prepareSessionMessageInput({ payload: input.payload });
  const currentUserMessage = sessionMessageInput.currentUserMessage;
  const preparedMessage = options.sessionMessages.prepareUserMessage({
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
    ...(input.command ? { command: input.command } : {}),
  });

  // The input handler starts the run record, while state owns the legal lifecycle transition details.
  const started = startAgentLoopRun({
    runId,
    stepId,
    sessionId: session.sessionId,
    triggerMessageId: userMessage.messageId,
    mode: sessionMessageInput.permissionMode,
    goal: userMessage.content,
    createdAt,
    lifecycle: {
      saveRun: (runRecord) => {
        options.runRepository.saveRun(runRecord);
      },
      saveStep: (stepRecord) => {
        options.stepRepository.saveStep(stepRecord);
      },
    },
  });
  const permissionSnapshot = createRunPermissionSnapshot({
    service: options.permissionSnapshotService,
    runId,
    permissionMode: sessionMessageInput.permissionMode,
    permissionSource: sessionMessageInput.permissionSource,
    ...(sessionMessageInput.metadata ? { metadata: sessionMessageInput.metadata } : {}),
    createdAt,
  });
  const run = permissionSnapshot
    ? attachRunPermissionSnapshot({
        run: started.run,
        permissionSnapshotRef: permissionSnapshot.permissionSnapshotRef,
        lifecycle: {
          saveRun: (runRecord) => {
            options.runRepository.saveRun(runRecord);
          },
        },
      })
    : started.run;
  const step = started.step;
  options.sessionMessages.recordSessionRunSource({
    sessionId: String(session.sessionId),
    runId: String(run.runId),
    createdAt,
  });

  const chatStreamAdapter = createChatStreamAdapterForUserInput({
    input,
    options,
    session,
    userMessage,
    currentUserMessage,
    runId,
    createdAt,
  });
  chatStreamAdapter?.startTurn?.();
  appendManualRerunAuditEvent({
    input,
    options,
    branchDraftMarker,
    session,
    run,
    createdAt,
    chatStreamAdapter,
  });

  // Active input tracking is registered around the async agent-loop stream so cancellation can target this request.
  options.activeRuns.register(input.requestId, {
    runId,
    sessionId: session.sessionId,
    stepId,
    ...(chatStreamAdapter ? { projection: chatStreamAdapter } : {}),
  });

  return {
    data: {
      requestId: input.requestId,
      session,
      userMessageId: String(userMessage.messageId),
      runId: String(run.runId),
    },
    events: options.activeRuns.track({
      requestId: input.requestId,
      events: options.runAgentLoop({
        requestId: input.requestId,
        payload: input.payload,
        ...(input.runtimeContext ? { runtimeContext: input.runtimeContext } : {}),
        session,
        run,
        step,
        userMessage,
        currentUserMessage,
        permissionMode: sessionMessageInput.permissionMode,
        inputPreprocessing: sessionMessageInput.inputPreprocessing,
        ...(permissionSnapshot ? { permissionSnapshot: permissionSnapshot.record } : {}),
        ...(chatStreamAdapter ? { chatStreamAdapter } : {}),
        parsedInput,
      }),
      getRunStatus: (runIdToCheck) => options.runRepository.getRun(runIdToCheck)?.status,
    }),
  };
}

function resolveBranchDraftMarker(
  payload: SessionMessageSendPayload,
  options: CreateUserInputHandlerOptions,
): ReturnType<SessionBranchServicePort['assertActiveBranchDraftMarker']> | undefined {
  if (!payload.branchDraft) {
    return undefined;
  }
  if (!payload.sessionId) {
    throw new Error('Branch draft requires an existing session.');
  }
  if (!options.sessionBranchService) {
    throw new Error('Session branch service is not configured.');
  }
  return options.sessionBranchService.assertActiveBranchDraftMarker({
    sessionId: payload.sessionId,
    branchMarkerId: payload.branchDraft.branchMarkerId,
  });
}

function createChatStreamAdapterForUserInput(input: {
  input: {
    requestId: string;
    payload: SessionMessageSendPayload;
  };
  options: CreateUserInputHandlerOptions;
  session: Session;
  userMessage: SessionMessage;
  currentUserMessage: SessionMessageInputMessage;
  runId: string;
  createdAt: string;
}): ChatStreamEventAdapter | undefined {
  return createSessionMessageChatStreamAdapter({
    ...(input.options.chatStreamEventSink ? { sink: input.options.chatStreamEventSink } : {}),
    projectId: String(input.session.workspaceId ?? input.session.sessionId),
    sessionId: String(input.session.sessionId),
    runId: String(input.runId),
    userMessageId: String(input.userMessage.messageId),
    clientMessageId: String(input.currentUserMessage.id),
    userMessageText: input.userMessage.content,
    createdAt: input.createdAt,
    now: () => input.options.clock.now(),
    ids: {
      eventId: input.options.ids.chatStreamEventId,
      textId: input.options.ids.chatTextId,
      thinkingId: input.options.ids.chatThinkingId,
      streamId: input.options.ids.chatStreamId,
    },
  });
}

function appendManualRerunAuditEvent(input: {
  input: {
    requestId: string;
    payload: SessionMessageSendPayload;
    runtimeContext?: RuntimeContext;
  };
  options: CreateUserInputHandlerOptions;
  branchDraftMarker: ReturnType<SessionBranchServicePort['assertActiveBranchDraftMarker']> | undefined;
  session: Session;
  run: Run;
  createdAt: string;
  chatStreamAdapter?: ChatStreamEventAdapter;
}): void {
  if (input.input.payload.branchDraft?.intent !== 'rerun') {
    return;
  }
  if (!input.branchDraftMarker) {
    throw new Error('Branch draft marker was not found.');
  }
  const manualRerunAuditEvent = input.options.runRetryCoordinator.recordManualRerunAttemptForBranchDraft({
    requestId: input.input.requestId,
    sessionId: String(input.session.sessionId),
    runId: String(input.run.runId),
    branchMarkerId: input.input.payload.branchDraft.branchMarkerId,
    marker: input.branchDraftMarker,
    createdAt: input.createdAt,
    ...(input.input.runtimeContext ? { runtimeContext: input.input.runtimeContext } : {}),
  });
  input.options.appendEvent(manualRerunAuditEvent, input.chatStreamAdapter);
}


export interface InputProcessingClock {
  now(): string;
}
export interface InputProcessingIds extends RunIdFactory {
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

export interface InputSessionRepositoryPort {
  saveSession(session: Session): Session;
  getSession(sessionId: string): Session | undefined;
  saveMessage(message: SessionMessage): SessionMessage;
  getMessage(messageId: string): SessionMessage | undefined;
  getSessionCompaction(compactionId: string): SessionCompactionEntry | null;
}

export interface InputAgentLoopRepositoryPort {
  saveRun(run: Run): Run;
  getRun(runId: string): Run | undefined;
  listRunsByStatuses(statuses: Run['status'][]): Run[];
  saveStep(step: RunStep): RunStep;
  listStepsByRun(runId: string): RunStep[];
  saveAction(action: RunAction): RunAction;
  saveObservation(observation: RunObservation): RunObservation;
  saveModelCall(modelCall: ModelCallRecord): ModelCallRecord;
  getModelCall(modelCallId: string): ModelCallRecord | undefined;
  appendRuntimeEvent(event: RuntimeEvent): RuntimeEvent;
  listRuntimeEventsByRun(runId: string): RuntimeEvent[];
}

export interface InputToolCallRepositoryPort {
  markToolResultsSubmittedToModelInput(input: {
    toolExecutionIds: string[];
    emittedAt: string;
  }): void;
}

export type InputActivePathRepositoryPort =
  & SessionContextInputActivePathRepository
  & SessionBranchActivePathRepository
  & SessionServiceActivePathRepository
  & SessionCompactionActivePathRepository
  & RunRetryActivePathRepositoryPort;

export interface InputProcessingServiceOptions {
  sessionRepository: InputSessionRepositoryPort;
  agentLoopRepository: InputAgentLoopRepositoryPort;
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
  toolCallRepository?: InputToolCallRepositoryPort;
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
  activePathRepository?: InputActivePathRepositoryPort;
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
  clock?: InputProcessingClock;
  ids?: Partial<InputProcessingIds>;
}

type InputApprovalResumeGroup = ApprovalResumeGroup<ChatStreamEventAdapter>;

const defaultClock: InputProcessingClock = {
  now: () => new Date().toISOString(),
};

interface PersistModelCallRecordFromEventInput {
  repository: InputAgentLoopRepositoryPort;
  request: ModelStepRuntimeRequest;
  event: RuntimeEvent;
  fallbackStepId: string;
  overrides?: {
    status?: RunStep['status'];
    completedAt?: string;
    error?: RuntimeError;
  };
}

function persistModelCallRecordFromEvent(
  input: PersistModelCallRecordFromEventInput,
): ModelCallRecord | undefined {
  if (!isModelCallPersistenceEvent(input.event)) {
    return undefined;
  }

  const modelCallId = getModelCallId(input.event.payload) ?? input.request.modelStepId;
  if (!modelCallId) {
    return undefined;
  }

  const existing = input.repository.getModelCall(modelCallId);
  return input.repository.saveModelCall({
    modelCallId,
    runId: input.request.runId,
    stepId: input.event.stepId ?? input.request.stepId ?? existing?.stepId ?? input.fallbackStepId,
    providerId: input.request.providerId,
    modelId: input.request.modelId,
    status: input.overrides?.status ?? existing?.status ?? 'running',
    startedAt: existing?.startedAt ?? input.event.createdAt,
    ...(input.overrides?.completedAt ?? existing?.completedAt ? {
      completedAt: input.overrides?.completedAt ?? existing?.completedAt,
    } : {}),
    ...(input.overrides?.error ?? existing?.error ? { error: input.overrides?.error ?? existing?.error } : {}),
    metadata: {
      ...(existing?.metadata ?? {}),
      sourceEventType: input.event.eventType,
    },
  });
}

function isModelCallPersistenceEvent(event: RuntimeEvent): boolean {
  return event.eventType === 'model.step.started'
    || event.eventType === 'model.step.completed'
    || event.eventType === 'tool.call.created';
}

function getModelCallId(payload: RuntimeEvent['payload']): string | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return undefined;
  }
  const record = payload as Record<string, unknown>;
  return typeof record.modelStepId === 'string' ? record.modelStepId : undefined;
}

function createDefaultInputProcessingIds(
  overrides: Partial<InputProcessingIds> = {},
): InputProcessingIds {
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
class EmptySessionEntryPathStore {
  getActivePath(sessionId: string): SessionActivePath {
    return {
      sessionId,
      entries: [],
    };
  }
}

export class InputProcessingService {
  private readonly sessionRepository: InputSessionRepositoryPort;
  private readonly agentLoopRepository: InputAgentLoopRepositoryPort;
  private readonly runtimeEventLog: RuntimeEventLog;
  private readonly runtimeEventPublisher: RuntimeEventPublisher<ChatStreamEventAdapter>;
  private readonly activePathRepository?: InputActivePathRepositoryPort;
  private readonly contextService?: RunBaselineContextPort;
  private readonly permissionSnapshotService?: RunPermissionSnapshotServicePort;
  private readonly planArtifactService?: PlanArtifactServicePort;
  private readonly modelCallProvider?: ModelCallProvider;
  private readonly toolRuntimeFactory?: ToolRuntimeFactory;
  private readonly toolDefinitionProvider?: ToolSetRegistryProvider;
  private readonly toolRegistrySnapshotService?: ToolRegistrySnapshotServicePort;
  private readonly providerCapabilitySummaryProvider?: ToolSetCapabilityProvider;
  private readonly toolCallRepository?: InputToolCallRepositoryPort;
  private readonly modelCallInputBuildService: ModelCallInputBuildPort;
  private readonly memoryRecallService?: MemoryRecallPort;
  private readonly memorySettingsProvider?: MemorySettingsPort;
  private readonly memoryMarkdownSyncService?: MemoryProjectMirrorSyncPort;
  private readonly megumiHomePath?: string;
  private readonly modelInputSourceOverrideProvider: AgentLoopInitialModelInputSourceOverrideProvider;
  private readonly sessionContextInputService: SessionContextInputBuildPort;
  private readonly sessionMessageService: SessionMessageService;
  private readonly userInputHandler: UserInputHandlerPort;
  private readonly sessionCompactionOrchestrator?: {
    compactIfNeeded(input: CompactIfNeededInput): Promise<SessionCompactionOrchestrationResult>;
  };
  private readonly hostBoundary: RunHostBoundaryPort;
  private readonly clock: InputProcessingClock;
  private readonly ids: InputProcessingIds;
  private readonly sessionRunControlService: SessionRunControlService;
  private readonly postRunHooks: PostRunHooksPort;
  private readonly pendingApprovalRegistry = new PendingApprovalRegistry<InputApprovalResumeGroup>({
    getRunId: (group) => group.request.runId,
  });
  private readonly activeSessionMessageRuns = new ActiveSessionMessageRunTracker<ChatStreamEventAdapter>();

  constructor(options: InputProcessingServiceOptions) {
    this.sessionRepository = options.sessionRepository;
    this.agentLoopRepository = options.agentLoopRepository;
    this.runtimeEventLog = new RuntimeEventLog(options.agentLoopRepository);
    this.postRunHooks = options.postRunHooks;
    this.runtimeEventPublisher = new RuntimeEventPublisher<ChatStreamEventAdapter>({
      eventLog: this.runtimeEventLog,
      terminalHooks: this.postRunHooks,
    });
    this.activePathRepository = options.activePathRepository;
    this.contextService = options.contextService;
    this.permissionSnapshotService = options.permissionSnapshotService;
    this.planArtifactService = options.planArtifactService;
    this.modelCallProvider = options.modelCallProvider;
    this.toolRuntimeFactory = options.toolRuntimeFactory;
    this.toolDefinitionProvider = options.toolDefinitionProvider;
    this.toolRegistrySnapshotService = options.toolRegistrySnapshotService;
    this.providerCapabilitySummaryProvider = options.providerCapabilitySummaryProvider;
    this.toolCallRepository = options.toolCallRepository;
    this.memoryRecallService = options.memoryRecallService;
    this.memorySettingsProvider = options.memorySettingsProvider;
    this.memoryMarkdownSyncService = options.memoryMarkdownSyncService;
    this.megumiHomePath = options.megumiHomePath;
    this.modelInputSourceOverrideProvider = options.modelInputSourceOverrideProvider ?? new ModelInputSourceOverrideService();
    this.clock = options.clock ?? defaultClock;
    this.ids = createDefaultInputProcessingIds(options.ids);
    this.sessionContextInputService = options.sessionContextInputService
      ?? new SessionContextInputService({
        sessionRepository: this.sessionRepository,
        messageRepository: this.sessionRepository,
        runRepository: this.agentLoopRepository,
        runExecutionFactRepository: this.agentLoopRepository,
        runtimeEventRepository: this.agentLoopRepository,
        sessionCompactionRepository: this.sessionRepository,
        activePathRepository: this.activePathRepository ?? new EmptySessionEntryPathStore(),
      });
    this.sessionMessageService = new SessionMessageService({
      sessionRepository: this.sessionRepository,
      messageRepository: this.sessionRepository,
      ids: this.ids,
      ...(this.activePathRepository ? { activePathRepository: this.activePathRepository } : {}),
    });
    this.sessionRunControlService = new SessionRunControlService({
      clock: this.clock,
      ids: this.ids,
      activeRuns: this.activeSessionMessageRuns,
      terminalCoordinator: options.runTerminalCoordinator,
      retryCoordinator: options.runRetryCoordinator,
      modelCallProvider: this.modelCallProvider,
      cancelPendingApprovalGroupsByRun: (runId) => this.cancelPendingApprovalGroupsByRun(runId),
      appendEvent: (event, projection) => this.appendRuntimeEvent(event, projection),
    });
    this.userInputHandler = createUserInputHandler({
      clock: this.clock,
      ids: this.ids,
      sessionMessages: this.sessionMessageService,
      activeRuns: this.activeSessionMessageRuns,
      runRepository: this.agentLoopRepository,
      stepRepository: this.agentLoopRepository,
      permissionSnapshotService: this.permissionSnapshotService,
      sessionBranchService: options.sessionBranchService,
      runRetryCoordinator: options.runRetryCoordinator,
      chatStreamEventSink: options.chatStreamEventSink,
      appendEvent: (event, projection) => this.appendRuntimeEvent(event, projection),
      runAgentLoop: (operationInput) => this.runAgentLoopForUserInput(operationInput),
      cancelActiveInput: (input) => this.sessionRunControlService.cancelSessionMessage(input),
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
        getRunStatus: (runId: string) => svc.agentLoopRepository.getRun(runId)?.status,
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
                svc.agentLoopRepository.saveRun(run);
              },
              saveStep: (step) => {
                svc.agentLoopRepository.saveStep(step);
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
              modelInputEmissionRepository: this.toolCallRepository
                ? { markToolResultsSubmittedToModelInput: (request) => this.toolCallRepository?.markToolResultsSubmittedToModelInput(request) }
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
          this.agentLoopRepository.saveRun(run);
        },
        saveStep: (step) => {
          this.agentLoopRepository.saveStep(step);
        },
        saveAction: (action) => {
          this.agentLoopRepository.saveAction(action);
        },
        saveObservation: (observation) => {
          this.agentLoopRepository.saveObservation(observation);
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

  async handle(input: {
    requestId: string;
    payload: SessionMessageSendPayload;
    runtimeContext?: RuntimeContext;
    command?: CommandAgentRunInput['command'];
  }): Promise<{ data: SessionMessageSendData; events: AsyncIterable<RuntimeEvent> }> {
    return this.userInputHandler.handle(input);
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
    return this.sessionRunControlService.createManualRetryFromRun(input);
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
    return this.sessionRunControlService.createManualRerunFromUserMessage(input);
  }

  cancel(input: InputCancelRequest): boolean {
    return this.sessionRunControlService.cancelSessionMessage(input);
  }

  resumeToolApproval(input: ResumeToolApprovalInput): AsyncIterable<RuntimeEvent> | undefined {
    const approvalResume = this.pendingApprovalRegistry.getByApprovalId(input.approvalRequestId);
    if (!approvalResume) {
      return undefined;
    }
    const persistedRun = this.agentLoopRepository.getRun(approvalResume.request.runId) ?? approvalResume.run;
    if (!canResumeApprovalFromRunStatus(persistedRun.status)) {
      this.cancelPendingApprovalGroupsByRun(approvalResume.request.runId);
      return undefined;
    }

    return this.resumeToolApprovalRun(approvalResume, input);
  }

  cleanupInterruptedInputsOnStartup(): { cleanedRunIds: string[] } {
    return this.sessionRunControlService.cleanupInterruptedRunsOnStartup();
  }

  listRuntimeEventsByRun(runId: string): RuntimeEvent[] {
    return this.agentLoopRepository.listRuntimeEventsByRun(runId);
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
      runRepository: this.agentLoopRepository,
      stepRepository: this.agentLoopRepository,
      modelCalls: {
        persistFromEvent: (input) => {
          persistModelCallRecordFromEvent({
            repository: this.agentLoopRepository,
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

  private async *runAgentLoopForUserInput(input: RunUserInputAgentLoopInput): AsyncIterable<RuntimeEvent> {
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
    approvalResume: InputApprovalResumeGroup,
    input: ResumeToolApprovalInput,
  ): AsyncIterable<RuntimeEvent> {
    yield* resumeToolApprovalAgentLoop({
      approvalResume,
      resumeInput: input,
      registry: this.pendingApprovalRegistry,
      lastSequenceForRun: (runId) => this.runtimeEventLog.lastSequenceForRun(runId),
      appendEvent: (event, projection) => this.appendRuntimeEvent(event, projection),
      runRepository: this.agentLoopRepository,
      stepRepository: this.agentLoopRepository,
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
          const step = this.agentLoopRepository.saveStep({
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
  clock: InputProcessingClock,
  ids: InputProcessingIds,
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
      summary: 'User input completed without tool execution.',
    }),
  };
}

