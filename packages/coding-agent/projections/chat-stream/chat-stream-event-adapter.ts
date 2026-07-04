import {
  createChatStreamEvent,
  type AssistantTextPhase,
  type ChatStreamApprovalScope,
  type ChatStreamEvent,
  type ChatStreamKind,
} from '@megumi/shared';
import type { RuntimeError } from '@megumi/shared/runtime';
import type { RuntimeEvent } from '@megumi/shared/runtime';
import type { WorkspaceChangeFooterFact } from '../workspace/workspace-change-footer-projector';

export interface ChatStreamEventSink {
  publish(event: ChatStreamEvent): void;
}

export interface ChatStreamEventAdapterIds {
  eventId(): string;
  textId(): string;
  thinkingId(): string;
}

export interface ChatStreamEventAdapterOptions {
  sink: ChatStreamEventSink;
  projectId: string;
  sessionId: string;
  runId: string;
  streamId: string;
  streamKind?: ChatStreamKind;
  userMessageId: string;
  clientMessageId?: string;
  userMessageText: string;
  createdAt: string;
  now?: () => string;
  ids: ChatStreamEventAdapterIds;
}

export interface SessionMessageChatStreamAdapterIds extends ChatStreamEventAdapterIds {
  streamId(input: { runId: string }): string;
}

export interface SessionMessageChatStreamAdapterInput {
  sink?: ChatStreamEventSink;
  projectId: string;
  sessionId: string;
  runId: string;
  userMessageId: string;
  clientMessageId?: string;
  userMessageText: string;
  createdAt: string;
  now?: () => string;
  ids: SessionMessageChatStreamAdapterIds;
}

export interface ChatStreamEventAdapter {
  startTurn(): void;
  publishWorkspaceChangeFooter(footer: WorkspaceChangeFooterFact, createdAt: string): void;
  handleRuntimeEvent(event: RuntimeEvent): void;
  flushPhaseGate(): void;
  dispose(): void;
}

interface TextState {
  textId: string;
  phase: AssistantTextPhase;
  hasDelta: boolean;
  terminal: boolean;
}

interface ModelStepTextState {
  modelStepId: string;
  bufferedDeltas: string[];
  phase?: AssistantTextPhase;
  text?: TextState;
}

interface ThinkingState {
  thinkingId: string;
  started: boolean;
  completed: boolean;
}

interface ToolActivityState {
  toolCallId: string;
  toolExecutionId?: string;
  toolName: string;
  inputSummary?: string;
}

interface ApprovalLinkState {
  toolCallId?: string;
  toolExecutionId?: string;
  scope: ChatStreamApprovalScope;
}

type ToolTerminalKind = 'completed' | 'failed' | 'denied';

interface PendingToolTerminalState {
  tool: ToolActivityState;
  kind: ToolTerminalKind;
  error?: RuntimeError;
  reason?: string;
}

export function createChatStreamEventAdapter(options: ChatStreamEventAdapterOptions): ChatStreamEventAdapter {
  return new ChatStreamEventAdapterImpl(options);
}

export function createSessionMessageChatStreamAdapter(
  input: SessionMessageChatStreamAdapterInput,
): ChatStreamEventAdapter | undefined {
  if (!input.sink) {
    return undefined;
  }

  return createChatStreamEventAdapter({
    sink: input.sink,
    projectId: input.projectId,
    sessionId: input.sessionId,
    runId: input.runId,
    streamId: input.ids.streamId({ runId: input.runId }),
    streamKind: 'main',
    userMessageId: input.userMessageId,
    ...(input.clientMessageId ? { clientMessageId: input.clientMessageId } : {}),
    userMessageText: input.userMessageText,
    createdAt: input.createdAt,
    ...(input.now ? { now: input.now } : {}),
    ids: {
      eventId: input.ids.eventId,
      textId: input.ids.textId,
      thinkingId: input.ids.thinkingId,
    },
  });
}

class ChatStreamEventAdapterImpl implements ChatStreamEventAdapter {
  private readonly options: ChatStreamEventAdapterOptions;
  private readonly now: () => string;
  private readonly streamKind: ChatStreamKind;
  private readonly stepText = new Map<string, ModelStepTextState>();
  private readonly thinkingByStep = new Map<string, ThinkingState>();
  private readonly toolsByCallId = new Map<string, ToolActivityState>();
  private readonly toolsByExecutionId = new Map<string, ToolActivityState>();
  private readonly terminalToolCallIds = new Set<string>();
  private readonly pendingToolTerminalsByCallId = new Map<string, PendingToolTerminalState>();
  private readonly approvalLinksById = new Map<string, ApprovalLinkState>();
  private readonly retryAttemptNumbersById = new Map<string, number>();
  private seq = 0;
  private started = false;
  private terminal = false;

  constructor(options: ChatStreamEventAdapterOptions) {
    this.options = options;
    this.now = options.now ?? (() => new Date().toISOString());
    this.streamKind = options.streamKind ?? 'main';
  }

  startTurn(): void {
    if (this.started) {
      return;
    }

    this.started = true;
    this.publish(createChatStreamEvent({
      ...this.base(this.options.createdAt),
      eventType: 'turn.started',
      userMessageId: this.options.userMessageId,
      ...(this.options.clientMessageId ? { clientMessageId: this.options.clientMessageId } : {}),
    }));
    this.publish(createChatStreamEvent({
      ...this.base(this.options.createdAt),
      eventType: 'user.message.committed',
      clientMessageId: this.options.clientMessageId ?? this.options.userMessageId,
      messageId: this.options.userMessageId,
      text: this.options.userMessageText,
    }));
  }

  publishWorkspaceChangeFooter(footer: WorkspaceChangeFooterFact, createdAt: string): void {
    if (this.terminal) {
      return;
    }

    this.publish(createChatStreamEvent({
      ...this.base(createdAt),
      eventType: 'workspace.change.footer.updated',
      footer,
    } as never));
  }

  handleRuntimeEvent(event: RuntimeEvent): void {
    if (this.terminal) {
      return;
    }

    this.flushPendingToolTerminalsBefore(event);

    switch (event.eventType) {
      case 'model.output.delta':
        this.handleModelOutputDelta(event);
        return;
      case 'model.tool_call.detected':
        this.handleToolCallSignal(event);
        return;
      case 'tool.call.created':
        this.handleToolCallCreated(event);
        return;
      case 'model.step.completed':
        this.handleModelStepCompleted(event);
        return;
      case 'model.thinking.started':
        this.handleThinkingStarted(event);
        return;
      case 'model.thinking.delta':
        this.handleThinkingDelta(event);
        return;
      case 'model.thinking.completed':
        this.handleThinkingCompleted(event);
        return;
      case 'model.step.provider_state.recorded':
        this.handleProviderStateRecorded(event);
        return;
      case 'tool.result.created':
        this.handleToolResultCreated(event);
        return;
      case 'tool.execution.requested':
        this.handleToolExecutionRequested(event);
        return;
      case 'tool.execution.started':
        this.handleToolExecutionStarted(event);
        return;
      case 'tool.execution.completed':
        this.handleToolExecutionCompleted(event);
        return;
      case 'tool.execution.failed':
        this.handleToolExecutionFailed(event);
        return;
      case 'tool.execution.denied':
        this.handleToolExecutionDenied(event);
        return;
      case 'approval.requested':
        this.handleApprovalRequested(event);
        return;
      case 'approval.resolved':
        this.handleApprovalResolved(event);
        return;
      case 'approval.expired':
        this.handleApprovalExpired(event);
        return;
      case 'session.branch_marker.created':
        this.handleBranchMarkerCreated(event);
        return;
      case 'context.compaction.completed':
        this.handleCompactionCompleted(event);
        return;
      case 'run.retry.requested':
      case 'retry.started':
      case 'retry.completed':
      case 'retry.failed':
        this.handleRetryRecorded(event);
        return;
      case 'run.interrupted':
        this.handleRunInterrupted(event);
        return;
      case 'run.completed':
        this.handleRunCompleted(event);
        return;
      case 'run.failed':
        this.handleRunFailed(event);
        return;
      case 'run.cancelled':
        this.handleRunCancelled(event);
        return;
      default:
        return;
    }
  }

  private handleBranchMarkerCreated(event: RuntimeEvent): void {
    const payload = event.payload as {
      branchMarkerId?: unknown;
      seedSourceRef?: unknown;
    };
    const branchMarkerId = stringValue(payload.branchMarkerId);
    const seedSourceRef = isRecord(payload.seedSourceRef) ? payload.seedSourceRef : undefined;
    const sourceMessageId = seedSourceRef?.sourceKind === 'session_message'
      ? stringValue(seedSourceRef.sourceId)
      : undefined;
    if (!branchMarkerId || !sourceMessageId) {
      return;
    }

    this.publish(createChatStreamEvent({
      ...this.base(event.createdAt),
      eventType: 'branch.separator.created',
      branchMarkerId,
      sourceMessageId,
      label: `Branch from ${formatProcessFactTime(event.createdAt)}`,
    }));
  }

  private handleCompactionCompleted(event: RuntimeEvent): void {
    const payload = event.payload as { compactionId?: unknown };
    this.publish(createChatStreamEvent({
      ...this.base(event.createdAt),
      eventType: 'process.compaction.recorded',
      ...(typeof payload.compactionId === 'string' ? { compactionId: payload.compactionId } : {}),
      status: 'completed',
      label: 'Compacted context',
    }));
  }

  private handleRetryRecorded(event: RuntimeEvent): void {
    const payload = event.payload as {
      retryRequestId?: unknown;
      reason?: unknown;
      attemptNumber?: unknown;
    };
    const retryAttemptId = stringValue(payload.retryRequestId);
    if (!retryAttemptId) {
      return;
    }

    const attemptNumber = this.retryAttemptNumber(retryAttemptId, payload.attemptNumber);
    const status = retryStatusForRuntimeEvent(event.eventType);
    this.publish(createChatStreamEvent({
      ...this.base(event.createdAt),
      eventType: 'process.retry.recorded',
      retryAttemptId,
      attemptNumber,
      status,
      label: retryProcessLabel(status, attemptNumber),
      ...(typeof payload.reason === 'string' ? { reason: payload.reason } : {}),
    }));
  }

  private handleRunInterrupted(event: RuntimeEvent): void {
    this.publish(createChatStreamEvent({
      ...this.base(event.createdAt),
      eventType: 'process.recovery.recorded',
      status: 'interrupted',
      label: 'Previous run was interrupted',
    }));
  }

  flushPhaseGate(): void {
    for (const state of this.stepText.values()) {
      if (!state.phase && state.bufferedDeltas.length > 0) {
        this.releaseText(state, 'answer');
      }
    }
  }

  dispose(): void {
    this.flushAllPendingToolTerminals();
    for (const state of this.stepText.values()) {
      if (!state.phase && state.bufferedDeltas.length > 0) {
        this.releaseText(state, 'answer');
      }
      if (state.text && !state.text.terminal) {
        this.completeText(state.text);
      }
    }
  }

  private handleModelOutputDelta(event: RuntimeEvent): void {
    const payload = event.payload as { modelStepId?: unknown; delta?: unknown };
    if (typeof payload.modelStepId !== 'string' || typeof payload.delta !== 'string') {
      return;
    }

    const state = this.textState(payload.modelStepId);
    if (!state.phase) {
      state.phase = 'answer';
      this.ensureTextStarted(state, 'answer');
      this.publishTextDelta(state.text, payload.delta);
      return;
    }

    this.ensureTextStarted(state, state.phase);
    this.publishTextDelta(state.text, payload.delta);
  }

  private handleToolCallSignal(event: RuntimeEvent): void {
    const payload = event.payload as { modelStepId?: unknown };
    if (typeof payload.modelStepId !== 'string') {
      return;
    }

    this.markStepPrelude(payload.modelStepId);
  }

  private handleToolCallCreated(event: RuntimeEvent): void {
    const payload = event.payload as {
      modelStepId?: unknown;
      toolCallId?: unknown;
      providerToolCallId?: unknown;
      toolName?: unknown;
      input?: unknown;
    };
    if (typeof payload.modelStepId === 'string') {
      this.markStepPrelude(payload.modelStepId);
    }
    if (typeof payload.toolCallId !== 'string' || typeof payload.toolName !== 'string') {
      return;
    }

    const tool = this.toolStateFromPayload(payload);
    this.toolsByCallId.set(tool.toolCallId, tool);
    this.publish(createChatStreamEvent({
      ...this.base(),
      eventType: 'tool.started',
      toolCallId: tool.toolCallId,
      toolName: tool.toolName,
      ...(tool.inputSummary ? { inputSummary: tool.inputSummary } : {}),
    }));
  }

  private handleModelStepCompleted(event: RuntimeEvent): void {
    const payload = event.payload as { modelStepId?: unknown; finishReason?: unknown };
    if (typeof payload.modelStepId !== 'string') {
      return;
    }

    if (payload.finishReason === 'tool_calls') {
      this.markStepPrelude(payload.modelStepId);
      this.completeOpenTextForStep(payload.modelStepId, 'prelude');
    }
  }

  private handleThinkingStarted(event: RuntimeEvent): void {
    const modelStepId = this.modelStepIdFrom(event);
    if (!modelStepId) {
      return;
    }

    const thinking = this.thinkingState(modelStepId);
    if (thinking.started) {
      return;
    }

    thinking.started = true;
    this.publish(createChatStreamEvent({
      ...this.base(),
      eventType: 'assistant.thinking.started',
      thinkingId: thinking.thinkingId,
    }));
  }

  private handleThinkingDelta(event: RuntimeEvent): void {
    const payload = event.payload as { modelStepId?: unknown; delta?: unknown };
    if (typeof payload.modelStepId !== 'string' || typeof payload.delta !== 'string') {
      return;
    }

    const thinking = this.thinkingState(payload.modelStepId);
    if (!thinking.started) {
      thinking.started = true;
      this.publish(createChatStreamEvent({
        ...this.base(),
        eventType: 'assistant.thinking.started',
        thinkingId: thinking.thinkingId,
      }));
    }
    this.publish(createChatStreamEvent({
      ...this.base(),
      eventType: 'assistant.thinking.delta',
      thinkingId: thinking.thinkingId,
      delta: payload.delta,
    }));
  }

  private handleThinkingCompleted(event: RuntimeEvent): void {
    const modelStepId = this.modelStepIdFrom(event);
    if (!modelStepId) {
      return;
    }

    const thinking = this.thinkingState(modelStepId);
    if (!thinking.started) {
      thinking.started = true;
      this.publish(createChatStreamEvent({
        ...this.base(),
        eventType: 'assistant.thinking.started',
        thinkingId: thinking.thinkingId,
      }));
    }
    if (thinking.completed) {
      return;
    }

    thinking.completed = true;
    this.publish(createChatStreamEvent({
      ...this.base(),
      eventType: 'assistant.thinking.completed',
      thinkingId: thinking.thinkingId,
    }));
  }

  private handleProviderStateRecorded(event: RuntimeEvent): void {
    const payload = event.payload as {
      modelStepId?: unknown;
      blocks?: Array<{ type?: unknown; text?: unknown }>;
    };
    if (typeof payload.modelStepId !== 'string' || this.thinkingByStep.has(payload.modelStepId)) {
      return;
    }

    const text = (payload.blocks ?? [])
      .map((block) => block.type === 'reasoning_content' || block.type === 'thinking' ? block.text : undefined)
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .join('');
    if (!text) {
      return;
    }

    const thinking = this.thinkingState(payload.modelStepId);
    thinking.started = true;
    thinking.completed = true;
    this.publish(createChatStreamEvent({
      ...this.base(),
      eventType: 'assistant.thinking.started',
      thinkingId: thinking.thinkingId,
    }));
    this.publish(createChatStreamEvent({
      ...this.base(),
      eventType: 'assistant.thinking.delta',
      thinkingId: thinking.thinkingId,
      delta: text,
    }));
    this.publish(createChatStreamEvent({
      ...this.base(),
      eventType: 'assistant.thinking.completed',
      thinkingId: thinking.thinkingId,
    }));
  }

  private handleToolResultCreated(event: RuntimeEvent): void {
    const payload = event.payload as {
      toolResultId?: unknown;
      toolCallId?: unknown;
      toolExecutionId?: unknown;
      kind?: unknown;
      summary?: unknown;
    };
    if (typeof payload.toolCallId !== 'string') {
      return;
    }
    if (this.hasToolTerminal(payload.toolCallId)) {
      return;
    }

    const tool = this.toolsByCallId.get(payload.toolCallId) ?? {
      toolCallId: payload.toolCallId,
      ...(typeof payload.toolExecutionId === 'string' ? { toolExecutionId: payload.toolExecutionId } : {}),
      toolName: 'unknown_tool',
    };
    this.clearPendingToolTerminal(tool.toolCallId);
    const common = {
      ...this.base(),
      toolCallId: tool.toolCallId,
      ...(typeof payload.toolExecutionId === 'string' ? { toolExecutionId: payload.toolExecutionId } : tool.toolExecutionId ? { toolExecutionId: tool.toolExecutionId } : {}),
      ...(typeof payload.toolResultId === 'string' ? { toolResultId: payload.toolResultId } : {}),
      toolName: tool.toolName,
      ...(tool.inputSummary ? { inputSummary: tool.inputSummary } : {}),
    };
    const summary = typeof payload.summary === 'string' ? payload.summary : undefined;

    if (payload.kind === 'success') {
      this.markToolTerminal(tool);
      this.publish(createChatStreamEvent({
        ...common,
        eventType: 'tool.completed',
        ...(summary ? { resultSummary: summary } : {}),
      }));
      return;
    }

    if (payload.kind === 'policy_denied' || payload.kind === 'user_rejected') {
      this.markToolTerminal(tool);
      this.publish(createChatStreamEvent({
        ...common,
        eventType: 'tool.denied',
        ...(summary ? { reason: summary } : {}),
      }));
      return;
    }

    this.markToolTerminal(tool);
    this.publish(createChatStreamEvent({
      ...common,
      eventType: 'tool.failed',
      ...(summary ? { resultSummary: summary, errorMessage: summary } : {}),
    }));
  }

  private handleToolExecutionRequested(event: RuntimeEvent): void {
    const toolExecution = (event.payload as { toolExecution?: unknown }).toolExecution;
    if (!isRecord(toolExecution)) {
      return;
    }

    const toolCallId = stringValue(toolExecution.toolCallId);
    const toolExecutionId = stringValue(toolExecution.toolExecutionId);
    const toolName = stringValue(toolExecution.toolName);
    if (!toolCallId || !toolExecutionId || !toolName) {
      return;
    }

    const existing = this.toolsByCallId.get(toolCallId);
    const tool: ToolActivityState = {
      toolCallId,
      toolExecutionId,
      toolName,
      inputSummary: existing?.inputSummary ?? inputSummary(toolExecution.input, toolName),
    };
    this.toolsByCallId.set(toolCallId, tool);
    this.toolsByExecutionId.set(toolExecutionId, tool);
  }

  private handleToolExecutionStarted(event: RuntimeEvent): void {
    const payload = event.payload as { toolExecutionId?: unknown };
    const tool = this.toolFromExecutionPayload(payload);
    if (!tool) {
      return;
    }
    this.toolsByCallId.set(tool.toolCallId, tool);
  }

  private handleToolExecutionCompleted(event: RuntimeEvent): void {
    const payload = event.payload as { toolExecutionId?: unknown };
    const tool = this.toolFromExecutionPayload(payload);
    if (!tool) {
      return;
    }
    if (this.hasToolTerminal(tool.toolCallId)) {
      return;
    }

    this.setPendingToolTerminal({ tool, kind: 'completed' });
  }

  private handleToolExecutionFailed(event: RuntimeEvent): void {
    const payload = event.payload as { toolExecutionId?: unknown; error?: unknown };
    const tool = this.toolFromExecutionPayload(payload);
    if (!tool) {
      return;
    }
    if (this.hasToolTerminal(tool.toolCallId)) {
      return;
    }

    const error = isRuntimeError(payload.error) ? payload.error : undefined;
    this.setPendingToolTerminal({ tool, kind: 'failed', ...(error ? { error } : {}) });
  }

  private handleToolExecutionDenied(event: RuntimeEvent): void {
    const payload = event.payload as { toolExecutionId?: unknown; reason?: unknown };
    const tool = this.toolFromExecutionPayload(payload);
    if (!tool) {
      return;
    }
    if (this.hasToolTerminal(tool.toolCallId)) {
      return;
    }

    this.setPendingToolTerminal({
      tool,
      kind: 'denied',
      ...(typeof payload.reason === 'string' ? { reason: payload.reason } : {}),
    });
  }

  private handleApprovalRequested(event: RuntimeEvent): void {
    const approvalRequest = (event.payload as { approvalRequest?: unknown }).approvalRequest;
    if (!isRecord(approvalRequest)) {
      return;
    }

    const approvalId = stringValue(approvalRequest.approvalRequestId);
    const title = stringValue(approvalRequest.title);
    if (!approvalId || !title) {
      return;
    }
    const requestedScope = stringValue(approvalRequest.requestedScope) ?? 'project';
    const link: ApprovalLinkState = {
      ...(stringValue(approvalRequest.toolCallId) ? { toolCallId: stringValue(approvalRequest.toolCallId) } : {}),
      ...(stringValue(approvalRequest.toolExecutionId) ? { toolExecutionId: stringValue(approvalRequest.toolExecutionId) } : {}),
      scope: requestedScope,
    };
    this.approvalLinksById.set(approvalId, link);

    this.publish(createChatStreamEvent({
      ...this.base(),
      eventType: 'approval.requested',
      approvalId,
      ...link,
      scope: requestedScope,
      status: 'pending',
      title,
      ...(stringValue(approvalRequest.summary) ? { description: stringValue(approvalRequest.summary) } : {}),
      ...(subjectSummaryFromApproval(approvalRequest) ? { subjectSummary: subjectSummaryFromApproval(approvalRequest) } : {}),
    }));
  }

  private handleApprovalResolved(event: RuntimeEvent): void {
    const payload = event.payload as {
      approvalRequestId?: unknown;
      toolCallId?: unknown;
      toolExecutionId?: unknown;
      scope?: unknown;
      decision?: unknown;
    };
    if (typeof payload.approvalRequestId !== 'string') {
      return;
    }

    const decision = approvalResolutionStatus(payload.decision);
    const link = this.approvalLinksById.get(payload.approvalRequestId);
    this.publish(createChatStreamEvent({
      ...this.base(),
      eventType: 'approval.resolved',
      approvalId: payload.approvalRequestId,
      ...(typeof payload.toolCallId === 'string' ? { toolCallId: payload.toolCallId } : link?.toolCallId ? { toolCallId: link.toolCallId } : {}),
      ...(typeof payload.toolExecutionId === 'string' ? { toolExecutionId: payload.toolExecutionId } : link?.toolExecutionId ? { toolExecutionId: link.toolExecutionId } : {}),
      scope: typeof payload.scope === 'string' ? payload.scope : link?.scope ?? 'project',
      status: decision,
      decision,
    }));
  }

  private handleApprovalExpired(event: RuntimeEvent): void {
    const payload = event.payload as {
      approvalRequestId?: unknown;
      toolCallId?: unknown;
    };
    if (typeof payload.approvalRequestId !== 'string') {
      return;
    }

    const link = this.approvalLinksById.get(payload.approvalRequestId);
    this.publish(createChatStreamEvent({
      ...this.base(),
      eventType: 'approval.resolved',
      approvalId: payload.approvalRequestId,
      ...(typeof payload.toolCallId === 'string' ? { toolCallId: payload.toolCallId } : link?.toolCallId ? { toolCallId: link.toolCallId } : {}),
      ...(link?.toolExecutionId ? { toolExecutionId: link.toolExecutionId } : {}),
      scope: link?.scope ?? 'project',
      status: 'expired',
      decision: 'expired',
    }));
  }

  private handleRunCompleted(_event: RuntimeEvent): void {
    this.flushAllPendingToolTerminals();
    this.flushPhaseGate();
    this.completeOpenTextByPhase('answer');
    this.publish(createChatStreamEvent({
      ...this.base(),
      eventType: 'turn.completed',
    }));
    this.finishTurn();
  }

  private handleRunFailed(event: RuntimeEvent): void {
    const error = (event.payload as { error?: unknown }).error;
    const runtimeError = isRuntimeError(error) ? error : undefined;
    this.flushAllPendingToolTerminals();
    this.flushPhaseGate();
    this.failOpenTextByPhase('answer', runtimeError);
    this.publish(createChatStreamEvent({
      ...this.base(),
      eventType: 'turn.failed',
      ...(runtimeError?.code ? { errorCode: runtimeError.code } : {}),
      ...(runtimeError?.message ? { errorMessage: runtimeError.message } : {}),
      ...(typeof runtimeError?.retryable === 'boolean' ? { recoverable: runtimeError.retryable } : {}),
    }));
    this.finishTurn();
  }

  private handleRunCancelled(event: RuntimeEvent): void {
    const payload = event.payload as { reason?: unknown };
    const reason = typeof payload.reason === 'string' ? payload.reason : undefined;
    this.flushAllPendingToolTerminals();
    this.flushPhaseGate();
    this.cancelOpenTextByPhase('answer', reason);
    this.publish(createChatStreamEvent({
      ...this.base(),
      eventType: 'turn.cancelled',
      ...(reason ? { reason } : {}),
    }));
    this.finishTurn();
  }

  private markStepPrelude(modelStepId: string): void {
    const state = this.textState(modelStepId);
    if (state.phase === 'answer' && state.text && !state.text.terminal) {
      this.reclassifyText(state, 'prelude');
      return;
    }

    if (!state.phase && state.bufferedDeltas.length > 0) {
      this.releaseText(state, 'prelude');
      return;
    }

    state.phase = 'prelude';
  }

  private reclassifyText(state: ModelStepTextState, toPhase: AssistantTextPhase): void {
    if (!state.text || state.text.terminal || state.text.phase === toPhase) {
      state.phase = toPhase;
      return;
    }

    const fromPhase = state.text.phase;
    state.phase = toPhase;
    state.text.phase = toPhase;
    this.publish(createChatStreamEvent({
      ...this.base(),
      eventType: 'assistant.text.reclassified',
      textId: state.text.textId,
      fromPhase,
      toPhase,
    }));
  }

  private releaseText(state: ModelStepTextState, phase: AssistantTextPhase): void {
    state.phase = phase;
    this.ensureTextStarted(state, phase);
    for (const delta of state.bufferedDeltas) {
      this.publishTextDelta(state.text, delta);
    }
    state.bufferedDeltas = [];
  }

  private ensureTextStarted(state: ModelStepTextState, phase: AssistantTextPhase): void {
    if (state.text) {
      return;
    }

    state.text = {
      textId: this.options.ids.textId(),
      phase,
      hasDelta: false,
      terminal: false,
    };
    this.publish(createChatStreamEvent({
      ...this.base(),
      eventType: 'assistant.text.started',
      textId: state.text.textId,
      phase,
    }));
  }

  private publishTextDelta(text: TextState | undefined, delta: string): void {
    if (!text || text.terminal) {
      return;
    }

    text.hasDelta = true;
    this.publish(createChatStreamEvent({
      ...this.base(),
      eventType: 'assistant.text.delta',
      textId: text.textId,
      phase: text.phase,
      delta,
    }));
  }

  private completeOpenTextByPhase(phase: AssistantTextPhase): void {
    for (const state of this.stepText.values()) {
      if (state.text?.phase === phase && !state.text.terminal) {
        this.completeText(state.text);
      }
    }
  }

  private completeOpenTextForStep(modelStepId: string, phase: AssistantTextPhase): void {
    const state = this.stepText.get(modelStepId);
    if (state?.text?.phase === phase && !state.text.terminal) {
      this.completeText(state.text);
    }
  }

  private failOpenTextByPhase(phase: AssistantTextPhase, error: RuntimeError | undefined): void {
    for (const state of this.stepText.values()) {
      if (state.text?.phase === phase && !state.text.terminal) {
        this.failText(state.text, error);
      }
    }
  }

  private cancelOpenTextByPhase(phase: AssistantTextPhase, reason: string | undefined): void {
    for (const state of this.stepText.values()) {
      if (state.text?.phase === phase && !state.text.terminal) {
        this.cancelText(state.text, reason);
      }
    }
  }

  private completeText(text: TextState): void {
    text.terminal = true;
    this.publish(createChatStreamEvent({
      ...this.base(),
      eventType: 'assistant.text.completed',
      textId: text.textId,
      phase: text.phase,
    }));
  }

  private failText(text: TextState, error: RuntimeError | undefined): void {
    text.terminal = true;
    this.publish(createChatStreamEvent({
      ...this.base(),
      eventType: 'assistant.text.failed',
      textId: text.textId,
      phase: text.phase,
      ...(error?.code ? { errorCode: error.code } : {}),
      ...(error?.message ? { errorMessage: error.message } : {}),
    }));
  }

  private cancelText(text: TextState, reason: string | undefined): void {
    text.terminal = true;
    this.publish(createChatStreamEvent({
      ...this.base(),
      eventType: 'assistant.text.cancelled_partial',
      textId: text.textId,
      phase: text.phase,
      ...(reason ? { reason } : {}),
    }));
  }

  private textState(modelStepId: string): ModelStepTextState {
    const existing = this.stepText.get(modelStepId);
    if (existing) {
      return existing;
    }

    const next: ModelStepTextState = {
      modelStepId,
      bufferedDeltas: [],
    };
    this.stepText.set(modelStepId, next);
    return next;
  }

  private thinkingState(modelStepId: string): ThinkingState {
    const existing = this.thinkingByStep.get(modelStepId);
    if (existing) {
      return existing;
    }

    const next: ThinkingState = {
      thinkingId: this.options.ids.thinkingId(),
      started: false,
      completed: false,
    };
    this.thinkingByStep.set(modelStepId, next);
    return next;
  }

  private toolStateFromPayload(payload: {
    toolCallId?: unknown;
    toolName?: unknown;
    input?: unknown;
  }): ToolActivityState {
    const toolName = typeof payload.toolName === 'string' ? payload.toolName : 'unknown_tool';
    return {
      toolCallId: String(payload.toolCallId),
      toolName,
      inputSummary: inputSummary(payload.input, toolName),
    };
  }

  private toolFromExecutionPayload(payload: { toolExecutionId?: unknown }): ToolActivityState | undefined {
    if (typeof payload.toolExecutionId !== 'string') {
      return undefined;
    }

    return this.toolsByExecutionId.get(payload.toolExecutionId);
  }

  private hasToolTerminal(toolCallId: string): boolean {
    return this.terminalToolCallIds.has(toolCallId);
  }

  private markToolTerminal(tool: ToolActivityState): void {
    this.terminalToolCallIds.add(tool.toolCallId);
    this.clearPendingToolTerminal(tool.toolCallId);
  }

  private setPendingToolTerminal(pending: PendingToolTerminalState): void {
    this.pendingToolTerminalsByCallId.set(pending.tool.toolCallId, pending);
  }

  private clearPendingToolTerminal(toolCallId: string): void {
    this.pendingToolTerminalsByCallId.delete(toolCallId);
  }

  private flushPendingToolTerminalsBefore(event: RuntimeEvent): void {
    const relatedToolCallId = this.relatedToolCallIdForEvent(event);
    for (const [toolCallId, pending] of [...this.pendingToolTerminalsByCallId]) {
      if (toolCallId === relatedToolCallId) {
        continue;
      }

      this.emitPendingToolTerminal(pending);
    }
  }

  private flushAllPendingToolTerminals(): void {
    for (const pending of [...this.pendingToolTerminalsByCallId.values()]) {
      this.emitPendingToolTerminal(pending);
    }
  }

  private emitPendingToolTerminal(pending: PendingToolTerminalState): void {
    if (this.hasToolTerminal(pending.tool.toolCallId)) {
      this.clearPendingToolTerminal(pending.tool.toolCallId);
      return;
    }

    this.markToolTerminal(pending.tool);
    if (pending.kind === 'completed') {
      this.publish(createChatStreamEvent({
        ...this.toolEventBase(pending.tool),
        eventType: 'tool.completed',
      }));
      return;
    }

    if (pending.kind === 'denied') {
      this.publish(createChatStreamEvent({
        ...this.toolEventBase(pending.tool),
        eventType: 'tool.denied',
        ...(pending.reason ? { reason: pending.reason } : {}),
      }));
      return;
    }

    this.publish(createChatStreamEvent({
      ...this.toolEventBase(pending.tool),
      eventType: 'tool.failed',
      ...(pending.error?.code ? { errorCode: pending.error.code } : {}),
      ...(pending.error?.message ? { errorMessage: pending.error.message, resultSummary: pending.error.message } : {}),
    }));
  }

  private relatedToolCallIdForEvent(event: RuntimeEvent): string | undefined {
    if (event.eventType === 'tool.result.created') {
      const payload = event.payload as { toolCallId?: unknown };
      return typeof payload.toolCallId === 'string' ? payload.toolCallId : undefined;
    }

    if (event.eventType === 'tool.call.created') {
      const payload = event.payload as { toolCallId?: unknown };
      return typeof payload.toolCallId === 'string' ? payload.toolCallId : undefined;
    }

    if (event.eventType === 'tool.execution.requested') {
      const toolExecution = (event.payload as { toolExecution?: unknown }).toolExecution;
      if (!isRecord(toolExecution)) {
        return undefined;
      }
      return stringValue(toolExecution.toolCallId);
    }

    if (event.eventType === 'tool.execution.completed'
      || event.eventType === 'tool.execution.failed'
      || event.eventType === 'tool.execution.denied') {
      const payload = event.payload as { toolExecutionId?: unknown };
      if (typeof payload.toolExecutionId !== 'string') {
        return undefined;
      }
      return this.toolsByExecutionId.get(payload.toolExecutionId)?.toolCallId;
    }

    return undefined;
  }

  private toolEventBase(tool: ToolActivityState) {
    return {
      ...this.base(),
      toolCallId: tool.toolCallId,
      ...(tool.toolExecutionId ? { toolExecutionId: tool.toolExecutionId } : {}),
      toolName: tool.toolName,
      ...(tool.inputSummary ? { inputSummary: tool.inputSummary } : {}),
    };
  }

  private modelStepIdFrom(event: RuntimeEvent): string | undefined {
    const payload = event.payload as { modelStepId?: unknown };
    return typeof payload.modelStepId === 'string' ? payload.modelStepId : undefined;
  }

  private finishTurn(): void {
    this.terminal = true;
  }

  private publish(event: ChatStreamEvent): void {
    this.options.sink.publish(event);
  }

  private retryAttemptNumber(retryAttemptId: string, persistedAttemptNumber?: unknown): number {
    if (
      typeof persistedAttemptNumber === 'number'
      && Number.isInteger(persistedAttemptNumber)
      && persistedAttemptNumber > 0
    ) {
      this.retryAttemptNumbersById.set(retryAttemptId, persistedAttemptNumber);
      return persistedAttemptNumber;
    }

    const existing = this.retryAttemptNumbersById.get(retryAttemptId);
    if (existing) {
      return existing;
    }

    const next = this.retryAttemptNumbersById.size + 1;
    this.retryAttemptNumbersById.set(retryAttemptId, next);
    return next;
  }

  private base(createdAt = this.now()) {
    this.seq += 1;
    return {
      eventId: this.options.ids.eventId(),
      projectId: this.options.projectId,
      sessionId: this.options.sessionId,
      runId: this.options.runId,
      streamId: this.options.streamId,
      streamKind: this.streamKind,
      seq: this.seq,
      createdAt,
    };
  }
}

function inputSummary(input: unknown, fallback: string): string {
  if (!isRecord(input)) {
    return fallback;
  }

  for (const key of ['path', 'command', 'pattern', 'query']) {
    const value = input[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }

  return fallback;
}

function approvalResolutionStatus(value: unknown): 'approved' | 'rejected' | 'expired' | 'cancelled' {
  if (value === 'denied') {
    return 'rejected';
  }
  if (value === 'approved' || value === 'rejected' || value === 'expired' || value === 'cancelled') {
    return value;
  }

  return 'cancelled';
}

function retryStatusForRuntimeEvent(
  eventType: RuntimeEvent['eventType'],
): 'started' | 'failed' | 'completed' | 'exhausted' | 'cancelled' {
  if (eventType === 'retry.failed') {
    return 'failed';
  }
  if (eventType === 'retry.completed') {
    return 'completed';
  }
  return 'started';
}

function retryProcessLabel(
  status: 'started' | 'failed' | 'completed' | 'exhausted' | 'cancelled',
  attemptNumber: number,
): string {
  if (status === 'started') return `Retry attempt ${attemptNumber} started`;
  if (status === 'failed') return `Retry attempt ${attemptNumber} failed`;
  if (status === 'completed') return `Retry attempt ${attemptNumber} completed`;
  if (status === 'exhausted') return `Retry attempt ${attemptNumber} exhausted`;
  return `Retry attempt ${attemptNumber} cancelled`;
}

function formatProcessFactTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return 'message';
  }
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
}

function subjectSummaryFromApproval(value: Record<string, unknown>): string | undefined {
  const preview = value.preview;
  if (!isRecord(preview)) {
    return undefined;
  }

  return stringValue(preview.action);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isRuntimeError(value: unknown): value is RuntimeError {
  return isRecord(value)
    && typeof value.code === 'string'
    && typeof value.message === 'string'
    && typeof value.severity === 'string'
    && typeof value.source === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

