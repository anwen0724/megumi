// Coordinates the product-level submit input operation before agent-loop execution.
import type { ParsedInput, SessionMessageInputMessage } from '../input';
import {
  parseSessionMessageRawInput,
  prepareSessionMessageInput,
} from '../input';
import {
  createRunPermissionSnapshot,
  type RunPermissionSnapshotServicePort,
} from '../permissions';
import {
  attachRunPermissionSnapshot,
  startAgentLoopRun,
  ActiveSessionMessageRunTracker,
  type RunRetryCoordinatorPort,
} from '../state';
import { SessionMessageService, type SessionBranchServicePort } from '../session';
import {
  createSessionMessageChatStreamAdapter,
  type ChatStreamEventAdapter,
  type ChatStreamEventSink,
} from '../projections/chat-stream';
import type {
  SessionMessageSendData,
  SessionMessageSendPayload,
} from '@megumi/shared/ipc';
import type { InputPreprocessingResult } from '@megumi/shared/input';
import type { PermissionMode, PermissionSnapshotRecord } from '@megumi/shared/permission';
import type { RuntimeContext, RuntimeEvent } from '@megumi/shared/runtime';
import type { Run, RunStep, Session, SessionMessage } from '@megumi/shared/session';

export interface SubmitInputOperationClock {
  now(): string;
}

export interface SubmitInputOperationIds {
  runId(): string;
  stepId(): string;
  chatStreamEventId(): string;
  chatStreamId(input: { runId: string }): string;
  chatTextId(): string;
  chatThinkingId(): string;
}

export interface SubmitInputOperationRunRepository {
  getRun(runId: string): Run | undefined;
  saveRun(run: Run): Run;
}

export interface SubmitInputOperationStepRepository {
  saveStep(step: RunStep): RunStep;
}

export interface RunSessionMessageAgentLoopInput {
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

export interface SubmitInputOperationOptions {
  clock: SubmitInputOperationClock;
  ids: SubmitInputOperationIds;
  sessionMessages: SessionMessageService;
  activeRuns: ActiveSessionMessageRunTracker<ChatStreamEventAdapter>;
  runRepository: SubmitInputOperationRunRepository;
  stepRepository: SubmitInputOperationStepRepository;
  permissionSnapshotService?: RunPermissionSnapshotServicePort;
  sessionBranchService?: SessionBranchServicePort;
  runRetryCoordinator: Pick<RunRetryCoordinatorPort, 'recordManualRerunAttemptForBranchDraft'>;
  chatStreamEventSink?: ChatStreamEventSink;
  appendEvent(event: RuntimeEvent, projection?: ChatStreamEventAdapter): void;
  runAgentLoop(input: RunSessionMessageAgentLoopInput): AsyncIterable<RuntimeEvent>;
}

export class SubmitInputOperation {
  private readonly clock: SubmitInputOperationClock;
  private readonly ids: SubmitInputOperationIds;
  private readonly sessionMessages: SessionMessageService;
  private readonly activeRuns: ActiveSessionMessageRunTracker<ChatStreamEventAdapter>;
  private readonly runRepository: SubmitInputOperationRunRepository;
  private readonly stepRepository: SubmitInputOperationStepRepository;
  private readonly permissionSnapshotService?: RunPermissionSnapshotServicePort;
  private readonly sessionBranchService?: SessionBranchServicePort;
  private readonly runRetryCoordinator: Pick<RunRetryCoordinatorPort, 'recordManualRerunAttemptForBranchDraft'>;
  private readonly chatStreamEventSink?: ChatStreamEventSink;
  private readonly appendEvent: (event: RuntimeEvent, projection?: ChatStreamEventAdapter) => void;
  private readonly runAgentLoop: (input: RunSessionMessageAgentLoopInput) => AsyncIterable<RuntimeEvent>;

  constructor(options: SubmitInputOperationOptions) {
    this.clock = options.clock;
    this.ids = options.ids;
    this.sessionMessages = options.sessionMessages;
    this.activeRuns = options.activeRuns;
    this.runRepository = options.runRepository;
    this.stepRepository = options.stepRepository;
    this.permissionSnapshotService = options.permissionSnapshotService;
    this.sessionBranchService = options.sessionBranchService;
    this.runRetryCoordinator = options.runRetryCoordinator;
    this.chatStreamEventSink = options.chatStreamEventSink;
    this.appendEvent = options.appendEvent;
    this.runAgentLoop = options.runAgentLoop;
  }

  async send(input: {
    requestId: string;
    payload: SessionMessageSendPayload;
    runtimeContext?: RuntimeContext;
  }): Promise<{ data: SessionMessageSendData; events: AsyncIterable<RuntimeEvent> }> {
    let branchDraftMarker: ReturnType<SessionBranchServicePort['assertActiveBranchDraftMarker']> | undefined;
    if (input.payload.branchDraft) {
      if (!input.payload.sessionId) {
        throw new Error('Branch draft requires an existing session.');
      }
      if (!this.sessionBranchService) {
        throw new Error('Session branch service is not configured.');
      }
      branchDraftMarker = this.sessionBranchService.assertActiveBranchDraftMarker({
        sessionId: input.payload.sessionId,
        branchMarkerId: input.payload.branchDraft.branchMarkerId,
      });
    }

    const runId = this.ids.runId();
    const stepId = this.ids.stepId();
    const createdAt = input.payload.createdAt;
    // Input runtime normalization is the trust boundary before persistence and agent-loop execution.
    const sessionMessageInput = prepareSessionMessageInput({
      payload: input.payload,
    });
    const currentUserMessage = sessionMessageInput.currentUserMessage;
    const permissionMode = sessionMessageInput.permissionMode;
    const permissionSource = sessionMessageInput.permissionSource;
    const inputMetadata = sessionMessageInput.metadata;
    const preparedMessage = this.sessionMessages.prepareUserMessage({
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
      mode: permissionMode,
      goal: userMessage.content,
      createdAt,
      lifecycle: {
        saveRun: (runRecord) => {
          this.runRepository.saveRun(runRecord);
        },
        saveStep: (stepRecord) => {
          this.stepRepository.saveStep(stepRecord);
        },
      },
    });
    const permissionSnapshot = createRunPermissionSnapshot({
      service: this.permissionSnapshotService,
      runId,
      permissionMode,
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
              this.runRepository.saveRun(runRecord);
            },
          },
        })
      : started.run;
    const step = started.step;
    this.sessionMessages.recordSessionRunSource({
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
      this.appendEvent(manualRerunAuditEvent, chatStreamAdapter);
    }
    this.activeRuns.register(input.requestId, {
      runId,
      sessionId: session.sessionId,
      stepId,
      ...(chatStreamAdapter ? { projection: chatStreamAdapter } : {}),
    });

    return {
      data: { requestId: input.requestId },
      events: this.activeRuns.track({
        requestId: input.requestId,
        events: this.runAgentLoop({
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
        getRunStatus: (runIdToCheck) => this.runRepository.getRun(runIdToCheck)?.status,
      }),
    };
  }
}
