import {
  createChatStreamEvent,
  type AssistantTextPhase,
  type ChatStreamEvent,
  type ChatStreamKind,
} from '@megumi/shared';
import type { RuntimeError } from '@megumi/shared/runtime-errors';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';

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
  phaseDecisionDelayMs?: number;
  schedulePhaseFlush?: (callback: () => void, delayMs: number) => { cancel(): void };
  ids: ChatStreamEventAdapterIds;
}

export interface ChatStreamEventAdapter {
  startTurn(): void;
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
  toolUseId: string;
  toolCallId?: string;
  toolName: string;
  inputSummary?: string;
}

interface ApprovalLinkState {
  toolUseId?: string;
  toolCallId?: string;
}

interface PhaseFlushHandle {
  cancel(): void;
}

export function createChatStreamEventAdapter(options: ChatStreamEventAdapterOptions): ChatStreamEventAdapter {
  return new ChatStreamEventAdapterImpl(options);
}

class ChatStreamEventAdapterImpl implements ChatStreamEventAdapter {
  private readonly options: ChatStreamEventAdapterOptions;
  private readonly now: () => string;
  private readonly schedulePhaseFlush: (callback: () => void, delayMs: number) => PhaseFlushHandle;
  private readonly phaseDecisionDelayMs: number;
  private readonly streamKind: ChatStreamKind;
  private readonly stepText = new Map<string, ModelStepTextState>();
  private readonly thinkingByStep = new Map<string, ThinkingState>();
  private readonly toolsByUseId = new Map<string, ToolActivityState>();
  private readonly toolsByCallId = new Map<string, ToolActivityState>();
  private readonly approvalLinksById = new Map<string, ApprovalLinkState>();
  private seq = 0;
  private started = false;
  private terminal = false;
  private readonly phaseFlushHandlesByStep = new Map<string, PhaseFlushHandle>();

  constructor(options: ChatStreamEventAdapterOptions) {
    this.options = options;
    this.now = options.now ?? (() => new Date().toISOString());
    this.phaseDecisionDelayMs = options.phaseDecisionDelayMs ?? 50;
    this.streamKind = options.streamKind ?? 'main';
    this.schedulePhaseFlush = options.schedulePhaseFlush ?? ((callback, delayMs) => {
      const timeout = setTimeout(callback, delayMs);
      return { cancel: () => clearTimeout(timeout) };
    });
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

  handleRuntimeEvent(event: RuntimeEvent): void {
    if (this.terminal) {
      return;
    }

    switch (event.eventType) {
      case 'model.output.delta':
        this.handleModelOutputDelta(event);
        return;
      case 'model.tool_use.detected':
        this.handleToolUseSignal(event);
        return;
      case 'tool.use.created':
        this.handleToolUseCreated(event);
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
      case 'tool.call.requested':
        this.handleToolCallRequested(event);
        return;
      case 'tool.call.completed':
        this.handleToolCallCompleted(event);
        return;
      case 'tool.call.failed':
        this.handleToolCallFailed(event);
        return;
      case 'tool.call.denied':
        this.handleToolCallDenied(event);
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

  flushPhaseGate(): void {
    this.cancelAllPhaseFlushes();
    for (const state of this.stepText.values()) {
      if (!state.phase && state.bufferedDeltas.length > 0) {
        this.releaseText(state, 'answer');
      }
    }
  }

  dispose(): void {
    this.cancelAllPhaseFlushes();
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
      state.bufferedDeltas.push(payload.delta);
      this.ensurePhaseFlushScheduled(payload.modelStepId);
      return;
    }

    this.ensureTextStarted(state, state.phase);
    this.publishTextDelta(state.text, payload.delta);
  }

  private handleToolUseSignal(event: RuntimeEvent): void {
    const payload = event.payload as { modelStepId?: unknown };
    if (typeof payload.modelStepId !== 'string') {
      return;
    }

    this.markStepPrelude(payload.modelStepId);
  }

  private handleToolUseCreated(event: RuntimeEvent): void {
    const payload = event.payload as {
      modelStepId?: unknown;
      toolUseId?: unknown;
      providerToolUseId?: unknown;
      toolName?: unknown;
      input?: unknown;
    };
    if (typeof payload.modelStepId === 'string') {
      this.markStepPrelude(payload.modelStepId);
    }
    if (typeof payload.toolUseId !== 'string' || typeof payload.toolName !== 'string') {
      return;
    }

    const tool = this.toolStateFromPayload(payload);
    this.toolsByUseId.set(tool.toolUseId, tool);
    if (tool.toolCallId) {
      this.toolsByCallId.set(tool.toolCallId, tool);
    }
    this.publish(createChatStreamEvent({
      ...this.base(),
      eventType: 'tool.started',
      toolUseId: tool.toolUseId,
      ...(tool.toolCallId ? { toolCallId: tool.toolCallId } : {}),
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
      toolUseId?: unknown;
      toolCallId?: unknown;
      kind?: unknown;
      summary?: unknown;
    };
    if (typeof payload.toolUseId !== 'string') {
      return;
    }

    const tool = this.toolsByUseId.get(payload.toolUseId) ?? {
      toolUseId: payload.toolUseId,
      ...(typeof payload.toolCallId === 'string' ? { toolCallId: payload.toolCallId } : {}),
      toolName: 'unknown_tool',
    };
    const common = {
      ...this.base(),
      toolUseId: tool.toolUseId,
      ...(typeof payload.toolCallId === 'string' ? { toolCallId: payload.toolCallId } : tool.toolCallId ? { toolCallId: tool.toolCallId } : {}),
      ...(typeof payload.toolResultId === 'string' ? { toolResultId: payload.toolResultId } : {}),
      toolName: tool.toolName,
      ...(tool.inputSummary ? { inputSummary: tool.inputSummary } : {}),
    };
    const summary = typeof payload.summary === 'string' ? payload.summary : undefined;

    if (payload.kind === 'success') {
      this.publish(createChatStreamEvent({
        ...common,
        eventType: 'tool.completed',
        ...(summary ? { resultSummary: summary } : {}),
      }));
      return;
    }

    if (payload.kind === 'policy_denied' || payload.kind === 'user_rejected') {
      this.publish(createChatStreamEvent({
        ...common,
        eventType: 'tool.denied',
        ...(summary ? { reason: summary } : {}),
      }));
      return;
    }

    this.publish(createChatStreamEvent({
      ...common,
      eventType: 'tool.failed',
      ...(summary ? { resultSummary: summary, errorMessage: summary } : {}),
    }));
  }

  private handleToolCallRequested(event: RuntimeEvent): void {
    const toolCall = (event.payload as { toolCall?: unknown }).toolCall;
    if (!isRecord(toolCall)) {
      return;
    }

    const toolCallId = stringValue(toolCall.toolCallId);
    const toolUseId = stringValue(toolCall.toolUseId);
    const toolName = stringValue(toolCall.toolName);
    if (!toolCallId || !toolUseId || !toolName) {
      return;
    }

    const existing = this.toolsByUseId.get(toolUseId);
    const tool: ToolActivityState = {
      toolUseId,
      toolCallId,
      toolName,
      inputSummary: existing?.inputSummary ?? inputSummary(toolCall.input, toolName),
    };
    this.toolsByUseId.set(toolUseId, tool);
    this.toolsByCallId.set(toolCallId, tool);
  }

  private handleToolCallCompleted(event: RuntimeEvent): void {
    const payload = event.payload as { toolCallId?: unknown };
    const tool = this.toolFromCallPayload(payload);
    if (!tool) {
      return;
    }

    this.publish(createChatStreamEvent({
      ...this.toolEventBase(tool),
      eventType: 'tool.completed',
    }));
  }

  private handleToolCallFailed(event: RuntimeEvent): void {
    const payload = event.payload as { toolCallId?: unknown; error?: unknown };
    const tool = this.toolFromCallPayload(payload);
    if (!tool) {
      return;
    }

    const error = isRuntimeError(payload.error) ? payload.error : undefined;
    this.publish(createChatStreamEvent({
      ...this.toolEventBase(tool),
      eventType: 'tool.failed',
      ...(error?.code ? { errorCode: error.code } : {}),
      ...(error?.message ? { errorMessage: error.message, resultSummary: error.message } : {}),
    }));
  }

  private handleToolCallDenied(event: RuntimeEvent): void {
    const payload = event.payload as { toolCallId?: unknown; reason?: unknown };
    const tool = this.toolFromCallPayload(payload);
    if (!tool) {
      return;
    }

    this.publish(createChatStreamEvent({
      ...this.toolEventBase(tool),
      eventType: 'tool.denied',
      ...(typeof payload.reason === 'string' ? { reason: payload.reason } : {}),
    }));
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
    const link = {
      ...(stringValue(approvalRequest.toolUseId) ? { toolUseId: stringValue(approvalRequest.toolUseId) } : {}),
      ...(stringValue(approvalRequest.toolCallId) ? { toolCallId: stringValue(approvalRequest.toolCallId) } : {}),
    };
    this.approvalLinksById.set(approvalId, link);

    this.publish(createChatStreamEvent({
      ...this.base(),
      eventType: 'approval.requested',
      approvalId,
      ...link,
      scope: stringValue(approvalRequest.requestedScope) ?? 'project',
      status: 'pending',
      title,
      ...(stringValue(approvalRequest.summary) ? { description: stringValue(approvalRequest.summary) } : {}),
      ...(subjectSummaryFromApproval(approvalRequest) ? { subjectSummary: subjectSummaryFromApproval(approvalRequest) } : {}),
    }));
  }

  private handleApprovalResolved(event: RuntimeEvent): void {
    const payload = event.payload as {
      approvalRequestId?: unknown;
      toolUseId?: unknown;
      toolCallId?: unknown;
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
      ...(typeof payload.toolUseId === 'string' ? { toolUseId: payload.toolUseId } : link?.toolUseId ? { toolUseId: link.toolUseId } : {}),
      ...(typeof payload.toolCallId === 'string' ? { toolCallId: payload.toolCallId } : link?.toolCallId ? { toolCallId: link.toolCallId } : {}),
      scope: typeof payload.scope === 'string' ? payload.scope : 'project',
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
      ...(link?.toolUseId ? { toolUseId: link.toolUseId } : {}),
      ...(typeof payload.toolCallId === 'string' ? { toolCallId: payload.toolCallId } : link?.toolCallId ? { toolCallId: link.toolCallId } : {}),
      scope: 'project',
      status: 'expired',
      decision: 'expired',
    }));
  }

  private handleRunCompleted(_event: RuntimeEvent): void {
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
    this.cancelPhaseFlush(modelStepId);
    if (state.phase === 'answer' && state.text && !state.text.terminal) {
      this.failProviderSequenceConflict(state.text);
      return;
    }

    if (!state.phase && state.bufferedDeltas.length > 0) {
      this.releaseText(state, 'prelude');
      if (state.text && !state.text.terminal) {
        this.completeText(state.text);
      }
      return;
    }

    state.phase = 'prelude';
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

  private failProviderSequenceConflict(text: TextState): void {
    text.terminal = true;
    this.publish(createChatStreamEvent({
      ...this.base(),
      eventType: 'assistant.text.failed',
      textId: text.textId,
      phase: text.phase,
      errorCode: 'provider_sequence_conflict',
      errorMessage: 'Provider emitted a tool-use signal after answer text started.',
    }));
    this.publish(createChatStreamEvent({
      ...this.base(),
      eventType: 'turn.failed',
      errorCode: 'provider_sequence_conflict',
      errorMessage: 'Provider emitted a tool-use signal after answer text started.',
      recoverable: false,
    }));
    this.finishTurn();
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
    toolUseId?: unknown;
    toolCallId?: unknown;
    toolName?: unknown;
    input?: unknown;
  }): ToolActivityState {
    const toolName = typeof payload.toolName === 'string' ? payload.toolName : 'unknown_tool';
    return {
      toolUseId: String(payload.toolUseId),
      ...(typeof payload.toolCallId === 'string' ? { toolCallId: payload.toolCallId } : {}),
      toolName,
      inputSummary: inputSummary(payload.input, toolName),
    };
  }

  private toolFromCallPayload(payload: { toolCallId?: unknown }): ToolActivityState | undefined {
    if (typeof payload.toolCallId !== 'string') {
      return undefined;
    }

    return this.toolsByCallId.get(payload.toolCallId);
  }

  private toolEventBase(tool: ToolActivityState) {
    return {
      ...this.base(),
      toolUseId: tool.toolUseId,
      ...(tool.toolCallId ? { toolCallId: tool.toolCallId } : {}),
      toolName: tool.toolName,
      ...(tool.inputSummary ? { inputSummary: tool.inputSummary } : {}),
    };
  }

  private modelStepIdFrom(event: RuntimeEvent): string | undefined {
    const payload = event.payload as { modelStepId?: unknown };
    return typeof payload.modelStepId === 'string' ? payload.modelStepId : undefined;
  }

  private ensurePhaseFlushScheduled(modelStepId: string): void {
    if (this.phaseFlushHandlesByStep.has(modelStepId)) {
      return;
    }

    const handle = this.schedulePhaseFlush(() => {
      if (this.phaseFlushHandlesByStep.get(modelStepId) !== handle) {
        return;
      }
      this.phaseFlushHandlesByStep.delete(modelStepId);
      this.flushPhaseGateForStep(modelStepId);
    }, this.phaseDecisionDelayMs);
    this.phaseFlushHandlesByStep.set(modelStepId, handle);
  }

  private flushPhaseGateForStep(modelStepId: string): void {
    const state = this.stepText.get(modelStepId);
    if (!state?.phase && state?.bufferedDeltas.length) {
      this.releaseText(state, 'answer');
    }
  }

  private cancelPhaseFlush(modelStepId: string): void {
    this.phaseFlushHandlesByStep.get(modelStepId)?.cancel();
    this.phaseFlushHandlesByStep.delete(modelStepId);
  }

  private cancelAllPhaseFlushes(): void {
    for (const handle of this.phaseFlushHandlesByStep.values()) {
      handle.cancel();
    }
    this.phaseFlushHandlesByStep.clear();
  }

  private finishTurn(): void {
    this.cancelAllPhaseFlushes();
    this.terminal = true;
  }

  private publish(event: ChatStreamEvent): void {
    this.options.sink.publish(event);
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
