// Handles user input entering a Coding Agent session, including message persistence and agent-loop invocation.
import type { InputPreprocessingResult } from '../contracts/run-input-preprocessing-contracts';
import type {
  SessionMessageSendData,
  SessionMessageSendPayload,
} from '@megumi/shared/ipc';
import type { PermissionMode, PermissionModeState } from '@megumi/shared/permission';
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
import type { ParsedInput } from '../contracts/run-input-contracts';
import {
  parseSessionMessageRawInput,
  prepareSessionMessageInput,
  type SessionMessageInputMessage,
} from './agent-run-session-message';
import {
  canResumeApprovalFromRunStatus,
  failAgentLoopBeforeModelCall,
  type RunTerminalCoordinatorPort,
  startAgentLoopRun,
  ActiveSessionMessageRunTracker,
  type RunRetryActivePathRepositoryPort,
  type RunRetryCoordinatorPort,
} from '../../state';
import { runTurn, type RunHostBoundaryPort, type RunIdFactory } from '../../state/lifecycle';
import type {
  Session as SessionModuleRecord,
  SessionMessage as SessionModuleMessage,
  SessionMessageWithAttachments,
  SessionService as SessionModuleService,
} from '../../session';
import {
  createSessionMessageChatStreamAdapter,
  type ChatStreamEventAdapter,
  type ChatStreamEventSink,
} from '../../projections/chat-stream';
import {
  type ApprovalResumeGroup,
  ensureToolCallRunnerService,
  PendingApprovalRegistry,
  type ResumeToolApprovalInput,
} from '../tool-call';
import {
  AgentLoop,
  createAgentLoopEventRecorder,
  resumeToolApprovalAgentLoop,
  type AgentLoopOptions,
  ToolSetService,
  type ToolSetCapabilityProvider,
  type ToolSetRegistryProvider,
} from '../agent-loop';
import type { ModelCallProvider } from '../model-call';
import type { ToolRuntimeFactory } from '../tool-call';
import {
  DEFAULT_CONTEXT_BUDGET_POLICY,
} from '../model-input/model-input-context-builder';
import { createBaselineContextForSession, type RunBaselineContextPort } from '../run-context/run-context-service';
import {
  createAgentLoopInitialModelInputMemoryRecallService,
  type AgentLoopInitialModelInputSourceOverrideProvider,
} from '../initial-input/initial-model-input-preparation';
import {
  ModelCallInputBuildService,
  type ModelCallInputBuildPort,
} from '../model-input/model-call-input-builder';
import { ModelInputSourceOverrideService } from '../model-input/model-input-source-overrides';
import type { AgentInstructionSourcePort } from '../../adapters/local/context/agent-instruction-source';
import type { ModelInputMemoryRecallSource } from '../model-input/model-call-context';
import {
  RuntimeEventLog,
  RuntimeEventPublisher,
} from '../../events';
import type { ModelCallRecord } from '../../persistence/repos/agent-loop.repo';
import type {
  SessionBranchMarker,
  SessionContextInput,
  SessionRetryAttempt,
  SessionSourceEntry,
} from '@megumi/shared/session';
import type {
  RunStartPayload,
  SessionTimelineListData,
} from '@megumi/shared/ipc';
import type { PlanArtifactServicePort } from '../../artifacts';
import type { PostRunHooksPort } from '../../hooks';
import type {
  MemoryProjectMirrorSyncPort,
  MemoryRecallPort,
} from '../../memory';
import { resolveMemoryEnabled, type MemorySettingsPort } from '../../settings';
import type { WorkspaceChangeService } from '../../workspace';
import { SessionRunControlService } from '../../state/session-run-control-service';
import type {
  CommandAgentRunInput,
  CommandExecutionContext,
  CommandExecutionResult,
  CommandService,
  HostInteractionRequest,
} from '../../commands';
import type { ContextService, ContextUsageMonitor } from '../../context';
import type { InputService as UserInputService, RawUserInputAttachment } from '../../input';

export interface AgentRunSendRequest {
  requestId?: string;
  sessionId?: string;
  sessionTitle?: string;
  workspaceId?: string;
  workspaceLabel?: string;
  workspacePath?: string;
  providerId: ProviderId;
  modelId: string;
  text: string;
  attachments?: RawUserInputAttachment[];
  clientMessageId?: string;
  createdAt?: string;
  permissionMode?: PermissionMode;
  permissionSource?: PermissionModeState['source'];
  preprocessing?: InputPreprocessingResult;
  branchDraft?: SessionMessageSendPayload['branchDraft'];
  runtimeContext?: RuntimeContext;
}

export type AgentRunSendResult =
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

export interface AgentRunCancelRequest {
  targetRequestId: string;
}

export interface AgentRunService {
  send(input: AgentRunSendRequest): Promise<AgentRunSendResult>;
  cancel(input: AgentRunCancelRequest): boolean;
}

export interface AgentRunServiceIds {
  requestId(): string;
  clientMessageId(): string;
}

export interface WorkspaceChangeReadPort {
  listChangedFiles: Pick<WorkspaceChangeService, 'listChangedFiles'>['listChangedFiles'];
}

export interface UserInputHandlerPort {
  handle(input: {
    requestId: string;
    payload: SessionMessageSendPayload;
    runtimeContext?: RuntimeContext;
    command?: CommandAgentRunInput['command'];
  }): Promise<{ data: SessionMessageSendData; events: AsyncIterable<RuntimeEvent> }>;
  cancel(input: AgentRunCancelRequest): boolean;
}

export interface CreateAgentRunServiceOptions {
  inputService: Pick<UserInputService, 'processUserInput'>;
  session: Pick<SessionModuleService, 'createSession' | 'getSession' | 'listMessages'>;
  userInput: UserInputHandlerPort;
  commandService: Pick<CommandService, 'handleCommandInput'>;
  commandExecutionContextProvider?: (input: {
    request: AgentRunSendRequest;
    requestId: string;
    createdAt: string;
  }) => CommandExecutionContext | undefined;
  ids?: Partial<AgentRunServiceIds>;
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

export interface SessionContextInputBuildPort {
  buildSessionContextInput(input: {
    sessionId: string;
    currentRunId?: string;
    currentMessageId?: string;
    builtAt: string;
  }): SessionContextInput;
}

export interface AgentRunSessionBranchServicePort {
  assertActiveBranchDraftMarker(input: {
    sessionId: string;
    branchMarkerId: string;
  }): SessionBranchMarker;
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
  chatStreamAdapter?: ChatStreamEventAdapter;
  parsedInput?: ParsedInput;
}

export interface CreateUserInputHandlerOptions {
  clock: UserInputHandlerClock;
  ids: UserInputHandlerIds;
  sessionService: Pick<SessionModuleService, 'getSession' | 'saveUserMessage' | 'saveAssistantMessage'>;
  activeRuns: ActiveSessionMessageRunTracker<ChatStreamEventAdapter>;
  runRepository: UserInputRunRepository;
  stepRepository: UserInputStepRepository;
  sessionBranchService?: AgentRunSessionBranchServicePort;
  runRetryCoordinator: Pick<RunRetryCoordinatorPort, 'recordManualRerunAttemptForBranchDraft'>;
  chatStreamEventSink?: ChatStreamEventSink;
  appendEvent(event: RuntimeEvent, projection?: ChatStreamEventAdapter): void;
  runAgentLoop(input: RunUserInputAgentLoopInput): AsyncIterable<RuntimeEvent>;
  cancelActiveInput(input: AgentRunCancelRequest): boolean;
}

const defaultIds: AgentRunServiceIds = {
  requestId: () => `input:${crypto.randomUUID()}`,
  clientMessageId: () => `message-local:${crypto.randomUUID()}`,
};

export function createAgentRunService(options: CreateAgentRunServiceOptions): AgentRunService {
  const ids = { ...defaultIds, ...options.ids };

  return {
    send: (input) => handleAgentRunInput(input, options, ids),
    cancel: (input) => cancelAgentRunInput(input, options),
  };
}

export function createUserInputHandler(options: CreateUserInputHandlerOptions): UserInputHandlerPort {
  return {
    handle: (input) => submitUserInputToAgentLoop(input, options),
    cancel: (input) => options.cancelActiveInput(input),
  };
}

async function handleAgentRunInput(
  input: AgentRunSendRequest,
  options: CreateAgentRunServiceOptions,
  ids: AgentRunServiceIds,
): Promise<AgentRunSendResult> {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const requestId = input.requestId ?? ids.requestId();

  const processed = await options.inputService.processUserInput({
    user_input: {
      text: input.text,
      attachments: input.attachments ?? [],
    },
  });

  if (processed.status === 'failed') {
    return {
      type: 'error',
      requestId,
      message: processed.failure.message,
    };
  }

  const normalizedInput: AgentRunSendRequest = {
    ...input,
    text: processed.parsed_user_input.text,
  };

  if (processed.parsed_user_input.type === 'command') {
    const commandResult = await options.commandService.handleCommandInput({
      raw_input: processed.parsed_user_input.text,
      ...(options.commandExecutionContextProvider ? {
        execution_context: options.commandExecutionContextProvider({ request: normalizedInput, requestId, createdAt }),
      } : {}),
    });

    if (commandResult.type !== 'not_command') {
      return handleCommandExecutionResult({
        commandResult,
        input: normalizedInput,
        options,
        ids,
        requestId,
        createdAt,
      });
    }
  }

  return submitAgentRunInput({
    input: normalizedInput,
    options,
    ids,
    requestId,
    createdAt,
  });
}

async function handleCommandExecutionResult(input: {
  commandResult: Exclude<CommandExecutionResult, { type: 'not_command' }>;
  input: AgentRunSendRequest;
  options: CreateAgentRunServiceOptions;
  ids: AgentRunServiceIds;
  requestId: string;
  createdAt: string;
}): Promise<AgentRunSendResult> {
  switch (input.commandResult.type) {
    case 'agent_run':
      return submitAgentRunInput({
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

async function submitAgentRunInput(input: {
  input: AgentRunSendRequest;
  options: CreateAgentRunServiceOptions;
  ids: AgentRunServiceIds;
  requestId: string;
  createdAt: string;
  command?: CommandAgentRunInput['command'];
}): Promise<AgentRunSendResult> {
  const session = await resolveOrCreateAgentRunSession(input.options.session, input.input, input.createdAt);
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
  const messagesResult = await input.options.session.listMessages({
    session_id: String(session.sessionId),
    active_path_only: false,
  });
  if (messagesResult.status !== 'ok') {
    throw new Error(messagesResult.failure.message);
  }
  const persistedUserMessage = findPersistedUserMessage(
    messagesResult.messages,
    input.input.text,
    input.createdAt,
  );

  if (!persistedUserMessage?.run_id) {
    throw new Error('Input service did not persist a user message run.');
  }

  return {
    type: 'agent_run',
    session,
    requestId: result.data.requestId,
    userMessageId: String(persistedUserMessage.message_id),
    runId: String(persistedUserMessage.run_id),
    events: result.events,
  };
}

function cancelAgentRunInput(
  input: AgentRunCancelRequest,
  options: CreateAgentRunServiceOptions,
): boolean {
  return options.userInput.cancel(input);
}

// Converts host-facing input parameters into the session message payload consumed by the internal input handler.
function createSessionMessageSendPayload(
  input: AgentRunSendRequest,
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

function createSessionMessageContext(input: AgentRunSendRequest): NonNullable<SessionMessageSendPayload['context']> {
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
  messages: SessionMessageWithAttachments[],
  content: string,
  createdAt: string,
): SessionMessageWithAttachments['message'] | undefined {
  return messages
    .map((item) => item.message)
    .filter((message) => message.role === 'user' && message.content_text === content && message.created_at === createdAt)
    .at(-1);
}

async function resolveOrCreateAgentRunSession(
  sessionService: Pick<SessionModuleService, 'createSession' | 'getSession'>,
  input: AgentRunSendRequest,
  createdAt: string,
): Promise<Session> {
  if (input.sessionId) {
    const result = await sessionService.getSession({ session_id: input.sessionId });
    if (result.status === 'not_found') {
      throw new Error(`Cannot send input to missing session: ${input.sessionId}`);
    }
    if (result.status === 'failed') {
      throw new Error(result.failure.message);
    }
    return toHostSession(result.session, input);
  }

  if (!input.workspaceId) {
    throw new Error('Creating a session requires workspaceId.');
  }
  const result = await sessionService.createSession({
    session_id: `session:${crypto.randomUUID()}`,
    workspace_id: input.workspaceId,
    title: input.sessionTitle ?? titleFromInput(input.text),
    created_at: createdAt,
  });
  if (result.status === 'failed') {
    throw new Error(result.failure.message);
  }
  return toHostSession(result.session, input);
}

function toHostSession(
  session: SessionModuleRecord,
  input: Pick<AgentRunSendRequest, 'workspacePath'> = {},
): Session {
  return {
    sessionId: session.session_id,
    title: session.title,
    workspaceId: session.workspace_id,
    ...(input.workspacePath ? { workspacePath: input.workspacePath } : {}),
    status: session.status,
    createdAt: session.created_at,
    updatedAt: session.updated_at,
    ...(session.archived_at ? { archivedAt: session.archived_at } : {}),
  };
}

async function requireHostSession(input: {
  sessionService: Pick<SessionModuleService, 'getSession'>;
  sessionId?: string;
  workspacePath?: string;
}): Promise<Session> {
  if (!input.sessionId) {
    throw new Error('Session message send requires a sessionId.');
  }
  const result = await input.sessionService.getSession({ session_id: input.sessionId });
  if (result.status === 'not_found') {
    throw new Error(`Cannot send input to missing session: ${input.sessionId}`);
  }
  if (result.status === 'failed') {
    throw new Error(result.failure.message);
  }
  return toHostSession(result.session, { workspacePath: input.workspacePath });
}

function toHostMessage(message: SessionModuleMessage): SessionMessage {
  return {
    messageId: message.message_id,
    sessionId: message.session_id,
    ...(message.run_id ? { runId: message.run_id } : {}),
    role: message.role,
    content: message.content_text,
    status: 'completed',
    createdAt: message.created_at,
    ...(message.completed_at ? { completedAt: message.completed_at } : {}),
  };
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
  const session = await requireHostSession({
    sessionService: options.sessionService,
    sessionId: input.payload.sessionId,
    workspacePath: input.payload.context?.workspacePath,
  });
  const savedUserMessage = await options.sessionService.saveUserMessage({
    message_id: currentUserMessage.id,
    session_id: String(session.sessionId),
    run_id: runId,
    content_text: currentUserMessage.content,
    created_at: currentUserMessage.createdAt,
  });
  if (savedUserMessage.status !== 'saved') {
    throw new Error(savedUserMessage.failure.message);
  }
  const userMessage = toHostMessage(savedUserMessage.message);
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
  const run = started.run;
  const step = started.step;
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
): ReturnType<AgentRunSessionBranchServicePort['assertActiveBranchDraftMarker']> | undefined {
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
  branchDraftMarker: ReturnType<AgentRunSessionBranchServicePort['assertActiveBranchDraftMarker']> | undefined;
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


export interface AgentRunProcessingClock {
  now(): string;
}
export interface AgentRunProcessingIds extends RunIdFactory {
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

export interface AgentRunSessionRepositoryPort {
  saveSession(session: Session): Session;
  getSession(sessionId: string): Session | undefined;
  saveMessage(message: SessionMessage): SessionMessage;
  getMessage(messageId: string): SessionMessage | undefined;
  getSessionCompaction(compactionId: string): SessionCompactionEntry | null;
}

export interface AgentRunRepositoryPort {
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

export interface AgentRunToolCallRepositoryPort {
  markToolResultsSubmittedToModelInput(input: {
    toolExecutionIds: string[];
    emittedAt: string;
  }): void;
}

export type AgentRunActivePathRepositoryPort =
  RunRetryActivePathRepositoryPort;

export interface AgentRunProcessingServiceOptions {
  sessionRepository: AgentRunSessionRepositoryPort;
  sessionService?: Pick<SessionModuleService, 'getSession' | 'saveUserMessage' | 'saveAssistantMessage'>;
  agentLoopRepository: AgentRunRepositoryPort;
  postRunHooks: PostRunHooksPort;
  runTerminalCoordinator: RunTerminalCoordinatorPort;
  runRetryCoordinator: RunRetryCoordinatorPort;
  contextService?: RunBaselineContextPort;
  promptContextService?: Pick<ContextService, 'getSessionContext' | 'buildPrompt'>;
  contextUsageMonitor?: Pick<ContextUsageMonitor, 'start' | 'refreshSession'>;
  planArtifactService?: PlanArtifactServicePort;
  modelCallProvider?: ModelCallProvider;
  toolRuntimeFactory?: ToolRuntimeFactory;
  toolDefinitionProvider?: ToolSetRegistryProvider;
  providerCapabilitySummaryProvider?: ToolSetCapabilityProvider;
  toolCallRepository?: AgentRunToolCallRepositoryPort;
  agentInstructionSourceService?: AgentInstructionSourcePort;
  modelCallInputBuildService?: ModelCallInputBuildPort;
  memoryRecallService?: MemoryRecallPort;
  memorySettingsProvider?: MemorySettingsPort;
  memoryMarkdownSyncService?: MemoryProjectMirrorSyncPort;
  megumiHomePath?: string;
  modelInputSourceOverrideProvider?: AgentLoopInitialModelInputSourceOverrideProvider;
  sessionContextInputService?: SessionContextInputBuildPort;
  activePathRepository?: AgentRunActivePathRepositoryPort;
  sessionBranchService?: AgentRunSessionBranchServicePort;
  workspaceChanges?: WorkspaceChangeReadPort;
  hostBoundary?: RunHostBoundaryPort;
  chatStreamEventSink?: ChatStreamEventSink;
  timelineMessageRepository?: {
    listCommittedMessagesBySession(input: {
      projectId: string;
      sessionId: string;
    }): SessionTimelineListData;
  };
  clock?: AgentRunProcessingClock;
  ids?: Partial<AgentRunProcessingIds>;
}

type AgentRunApprovalResumeGroup = ApprovalResumeGroup<ChatStreamEventAdapter>;

const defaultClock: AgentRunProcessingClock = {
  now: () => new Date().toISOString(),
};

const emptySessionContextInputService: SessionContextInputBuildPort = {
  buildSessionContextInput: () => ({
    historyEntries: [],
    runtimeFacts: [],
    maxHistoryEntries: 24,
  }),
};

interface PersistModelCallRecordFromEventInput {
  repository: AgentRunRepositoryPort;
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

function createDefaultAgentRunProcessingIds(
  overrides: Partial<AgentRunProcessingIds> = {},
): AgentRunProcessingIds {
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
export class AgentRunProcessingService {
  private readonly sessionRepository: AgentRunSessionRepositoryPort;
  private readonly agentLoopRepository: AgentRunRepositoryPort;
  private readonly runtimeEventLog: RuntimeEventLog;
  private readonly runtimeEventPublisher: RuntimeEventPublisher<ChatStreamEventAdapter>;
  private readonly activePathRepository?: AgentRunActivePathRepositoryPort;
  private readonly contextService?: RunBaselineContextPort;
  private readonly promptContextService?: Pick<ContextService, 'getSessionContext' | 'buildPrompt'>;
  private readonly contextUsageMonitor?: Pick<ContextUsageMonitor, 'start' | 'refreshSession'>;
  private readonly planArtifactService?: PlanArtifactServicePort;
  private readonly modelCallProvider?: ModelCallProvider;
  private readonly toolRuntimeFactory?: ToolRuntimeFactory;
  private readonly toolDefinitionProvider?: ToolSetRegistryProvider;
  private readonly providerCapabilitySummaryProvider?: ToolSetCapabilityProvider;
  private readonly toolCallRepository?: AgentRunToolCallRepositoryPort;
  private readonly modelCallInputBuildService: ModelCallInputBuildPort;
  private readonly memoryRecallService?: MemoryRecallPort;
  private readonly memorySettingsProvider?: MemorySettingsPort;
  private readonly memoryMarkdownSyncService?: MemoryProjectMirrorSyncPort;
  private readonly megumiHomePath?: string;
  private readonly modelInputSourceOverrideProvider: AgentLoopInitialModelInputSourceOverrideProvider;
  private readonly sessionContextInputService: SessionContextInputBuildPort;
  private readonly sessionService?: Pick<SessionModuleService, 'getSession' | 'saveUserMessage' | 'saveAssistantMessage'>;
  private readonly userInputHandler: UserInputHandlerPort;
  private readonly hostBoundary: RunHostBoundaryPort;
  private readonly clock: AgentRunProcessingClock;
  private readonly ids: AgentRunProcessingIds;
  private readonly sessionRunControlService: SessionRunControlService;
  private readonly postRunHooks: PostRunHooksPort;
  private readonly pendingApprovalRegistry = new PendingApprovalRegistry<AgentRunApprovalResumeGroup>({
    getRunId: (group) => group.request.runId,
  });
  private readonly activeSessionMessageRuns = new ActiveSessionMessageRunTracker<ChatStreamEventAdapter>();

  constructor(options: AgentRunProcessingServiceOptions) {
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
    this.promptContextService = options.promptContextService;
    this.contextUsageMonitor = options.contextUsageMonitor;
    this.planArtifactService = options.planArtifactService;
    this.modelCallProvider = options.modelCallProvider;
    this.toolRuntimeFactory = options.toolRuntimeFactory;
    this.toolDefinitionProvider = options.toolDefinitionProvider;
    this.providerCapabilitySummaryProvider = options.providerCapabilitySummaryProvider;
    this.toolCallRepository = options.toolCallRepository;
    this.memoryRecallService = options.memoryRecallService;
    this.memorySettingsProvider = options.memorySettingsProvider;
    this.memoryMarkdownSyncService = options.memoryMarkdownSyncService;
    this.megumiHomePath = options.megumiHomePath;
    this.modelInputSourceOverrideProvider = options.modelInputSourceOverrideProvider ?? new ModelInputSourceOverrideService();
    this.sessionService = options.sessionService;
    this.clock = options.clock ?? defaultClock;
    this.ids = createDefaultAgentRunProcessingIds(options.ids);
    this.sessionContextInputService = options.sessionContextInputService ?? emptySessionContextInputService;
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
      sessionService: this.requireSessionService(),
      activeRuns: this.activeSessionMessageRuns,
      runRepository: this.agentLoopRepository,
      stepRepository: this.agentLoopRepository,
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
    this.hostBoundary = options.hostBoundary ?? defaultHostBoundary(this.clock, this.ids);
  }

  private createAgentLoopOptions(
    chatStreamAdapter?: ChatStreamEventAdapter,
  ): AgentLoopOptions {
    const svc = this;
    const toolSetService = new ToolSetService({
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
      ...(this.promptContextService ? { promptContextService: this.promptContextService } : {}),
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
      eventRecorder: this.createModelCallEventRecorder(chatStreamAdapter),
    };
  }

  async startRun(payload: RunStartPayload): Promise<{ run: Run; events: RuntimeEvent[] }> {
    const session = this.sessionRepository.getSession(payload.sessionId);
    const runId = this.ids.runId();

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
      ...(payload.permissionModeState ? { permissionModeState: payload.permissionModeState } : {}),
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

    if (payload.permissionModeState && this.planArtifactService && result.run.status === 'completed') {
      this.planArtifactService.createPlanRecordForRun({
        runId,
        goal: payload.goal,
        permissionModeState: payload.permissionModeState,
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

  cancel(input: AgentRunCancelRequest): boolean {
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

  private requireSessionService(): Pick<SessionModuleService, 'getSession' | 'saveUserMessage' | 'saveAssistantMessage'> {
    if (!this.sessionService) {
      throw new Error('AgentRunProcessingService requires SessionService.');
    }
    return this.sessionService;
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
        commit: async (input) => {
          const result = await this.requireSessionService().saveAssistantMessage({
            message_id: this.ids.messageId(),
            session_id: input.sessionId,
            run_id: input.runId,
            content_text: input.content,
            completed_at: input.completedAt,
          });
          if (result.status !== 'saved') {
            throw new Error(result.failure.message);
          }
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
    await this.startAndRefreshContextUsageForRun(input);
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
      ...(input.runtimeContext ? { runtimeContext: input.runtimeContext } : {}),
      createdAt: input.payload.createdAt,
      memoryEnabled: resolveMemoryEnabled(this.memorySettingsProvider),
    });
  }

  private appendRuntimeEvent(event: RuntimeEvent, chatStreamAdapter?: ChatStreamEventAdapter): void {
    this.runtimeEventPublisher.append(event, chatStreamAdapter ? { chatStreamAdapter } : {});
    this.refreshContextUsageFromRuntimeEvent(event);
  }

  private async startAndRefreshContextUsageForRun(input: RunUserInputAgentLoopInput): Promise<void> {
    if (!this.contextUsageMonitor) {
      return;
    }

    const workspaceId = input.payload.context?.workspaceId;
    const request = {
      session_id: input.session.sessionId,
      ...(workspaceId ? { workspace_id: workspaceId } : {}),
    };
    const started = await this.contextUsageMonitor.start({
      ...request,
      model_config: {
        model_id: input.payload.modelId,
        context_window_tokens: DEFAULT_CONTEXT_BUDGET_POLICY.modelContextWindow,
      },
    });
    if (started.status !== 'ok') {
      return;
    }
    await this.contextUsageMonitor.refreshSession({
      ...request,
      reason: 'run_started',
    });
  }

  private refreshContextUsageFromRuntimeEvent(event: RuntimeEvent): void {
    if (!this.contextUsageMonitor || !event.sessionId) {
      return;
    }
    void this.contextUsageMonitor.refreshSession({
      session_id: event.sessionId,
      reason: event.eventType,
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
  clock: AgentRunProcessingClock,
  ids: AgentRunProcessingIds,
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
