// Stateful projection from Agent runtime events to the renderer chat stream protocol.
import type { AgentRuntimeEvent } from '../../app';
import type { ChatStreamEvent, AssistantTextPhase } from '../../shared/renderer-contracts/chat-stream';

export interface AgentRuntimeChatStreamSink {
  publish(event: ChatStreamEvent): void;
}

export interface AgentRuntimeChatStreamAdapter {
  handle(event: AgentRuntimeEvent): void;
  dispose(): void;
}

interface TextState {
  textId: string;
  phase: AssistantTextPhase;
  terminal: boolean;
}

interface ModelStepState {
  modelStepId: string;
  phase?: AssistantTextPhase;
  text?: TextState;
}

interface ThinkingState {
  thinkingId: string;
  started: boolean;
  completed: boolean;
}

interface ToolState {
  toolCallId: string;
  toolExecutionId?: string;
  toolName: string;
  inputSummary?: string;
}

interface PendingToolTerminal {
  tool: ToolState;
  kind: 'completed' | 'failed' | 'denied';
  errorMessage?: string;
}

interface StreamState {
  seq: number;
  terminal: boolean;
  stepText: Map<string, ModelStepState>;
  thinkingByStep: Map<string, ThinkingState>;
  toolsByCallId: Map<string, ToolState>;
  toolsByExecutionId: Map<string, ToolState>;
  terminalToolCallIds: Set<string>;
  pendingToolTerminalsByCallId: Map<string, PendingToolTerminal>;
}

export function createAgentRuntimeChatStreamAdapter(sink: AgentRuntimeChatStreamSink): AgentRuntimeChatStreamAdapter {
  const streams = new Map<string, StreamState>();

  return {
    handle(event) {
      const state = streamState(streamKey(event));
      if (state.terminal) return;

      flushPendingToolTerminalsBefore(state, event, sink);

      switch (event.type) {
        case 'turn.started':
          publish(state, sink, event, { eventType: 'turn.started', ...userMessageFields(event) });
          return;
        case 'context.ready':
          return;
        case 'ai.message.event':
          handleAssistantStreamEvent(state, sink, event);
          return;
        case 'ai.message.completed':
          completeOpenTextByPhase(state, sink, event, 'prelude');
          completeOpenTextByPhase(state, sink, event, 'answer');
          return;
        case 'tool.call.created':
          handleToolCallCreated(state, sink, event);
          return;
        case 'tool.execution.started':
          handleToolExecutionStarted(state, event);
          return;
        case 'tool.execution.completed':
          handleToolExecutionCompleted(state, event);
          return;
        case 'tool.result.created':
          handleToolResultCreated(state, sink, event);
          return;
        case 'run.status.changed':
        case 'run.completed':
        case 'run.failed':
        case 'run.cancelled':
        case 'run.canceled':
          handleRunTerminal(state, sink, event);
          return;
        default:
          return;
      }
    },
    dispose() {
      for (const [key, state] of streams) {
        if (state.terminal) continue;
        const event = syntheticTerminalEvent(key);
        flushAllPendingToolTerminals(state, sink, event);
        completeOpenTextByPhase(state, sink, event, 'answer');
      }
    },
  };

  function streamState(key: string): StreamState {
    const existing = streams.get(key);
    if (existing) return existing;
    const next: StreamState = {
      seq: 0,
      terminal: false,
      stepText: new Map(),
      thinkingByStep: new Map(),
      toolsByCallId: new Map(),
      toolsByExecutionId: new Map(),
      terminalToolCallIds: new Set(),
      pendingToolTerminalsByCallId: new Map(),
    };
    streams.set(key, next);
    return next;
  }
}

function handleAssistantStreamEvent(
  state: StreamState,
  sink: AgentRuntimeChatStreamSink,
  event: AgentRuntimeEvent,
): void {
  const streamEvent = readRecord(payloadOf(event).event);
  if (!streamEvent) return;
  const modelStepId = modelStepIdFor(event, streamEvent);

  if (streamEvent.type === 'content_block_start') {
    const block = readRecord(streamEvent.block);
    if (block?.type === 'thinking') {
      ensureThinkingStarted(state, sink, event, modelStepId);
      return;
    }
    if (block?.type === 'toolCall') {
      markStepPrelude(state, sink, event, modelStepId);
    }
    return;
  }

  if (streamEvent.type === 'content_block_delta') {
    const delta = readRecord(streamEvent.delta);
    if (delta?.type === 'thinking_delta' && typeof delta.thinking === 'string') {
      ensureThinkingStarted(state, sink, event, modelStepId);
      publish(state, sink, event, {
        eventType: 'assistant.thinking.delta',
        thinkingId: thinkingState(state, modelStepId).thinkingId,
        delta: delta.thinking,
      });
      return;
    }
    if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
      const text = ensureTextStarted(state, sink, event, modelStepId, textState(state, modelStepId).phase ?? 'answer');
      publish(state, sink, event, {
        eventType: 'assistant.text.delta',
        textId: text.textId,
        phase: text.phase,
        delta: delta.text,
      });
      return;
    }
    if (delta?.type === 'tool_call_delta') {
      markStepPrelude(state, sink, event, modelStepId);
    }
    return;
  }

  if (streamEvent.type === 'content_block_end') {
    const block = readRecord(streamEvent.block);
    if (block?.type === 'thinking') {
      completeThinking(state, sink, event, modelStepId);
      return;
    }
    if (block?.type === 'text') {
      completeOpenTextForStep(state, sink, event, modelStepId);
      return;
    }
    if (block?.type === 'toolCall') {
      markStepPrelude(state, sink, event, modelStepId);
    }
    return;
  }

  if (streamEvent.type === 'message_end') {
    completeOpenTextByPhase(state, sink, event, 'answer');
  }
}

function handleToolCallCreated(
  state: StreamState,
  sink: AgentRuntimeChatStreamSink,
  event: AgentRuntimeEvent,
): void {
  markStepPrelude(state, sink, event, modelStepIdFor(event));
  const payload = payloadOf(event);
  const toolCallId = readString(payload.toolCallId) ?? readString(payload.id);
  const toolName = readString(payload.toolName) ?? readString(payload.name);
  if (!toolCallId || !toolName) return;

  const tool: ToolState = {
    toolCallId,
    toolName,
    inputSummary: inputSummary(payload.input, toolName),
  };
  state.toolsByCallId.set(toolCallId, tool);
  publish(state, sink, event, {
    eventType: 'tool.started',
    toolCallId,
    toolName,
    ...(tool.inputSummary ? { inputSummary: tool.inputSummary } : {}),
  });
}

function handleToolExecutionStarted(state: StreamState, event: AgentRuntimeEvent): void {
  const payload = payloadOf(event);
  const toolCallId = readString(payload.toolCallId);
  const toolExecutionId = readString(payload.toolExecutionId);
  const toolName = readString(payload.toolName);
  if (!toolCallId || !toolName) return;

  const existing = state.toolsByCallId.get(toolCallId);
  const tool: ToolState = {
    toolCallId,
    ...(toolExecutionId ? { toolExecutionId } : {}),
    toolName,
    inputSummary: existing?.inputSummary ?? inputSummary(payload.input, toolName),
  };
  state.toolsByCallId.set(toolCallId, tool);
  if (toolExecutionId) state.toolsByExecutionId.set(toolExecutionId, tool);
}

function handleToolExecutionCompleted(state: StreamState, event: AgentRuntimeEvent): void {
  const payload = payloadOf(event);
  const tool = toolFromPayload(state, payload);
  if (!tool || state.terminalToolCallIds.has(tool.toolCallId)) return;
  const status = readString(payload.status);
  state.pendingToolTerminalsByCallId.set(tool.toolCallId, {
    tool,
    kind: status === 'rejected' ? 'denied' : status === 'failed' || status === 'error' ? 'failed' : 'completed',
    errorMessage: readErrorMessage(payload),
  });
}

function handleToolResultCreated(
  state: StreamState,
  sink: AgentRuntimeChatStreamSink,
  event: AgentRuntimeEvent,
): void {
  const payload = payloadOf(event);
  const toolCallId = readString(payload.toolCallId);
  if (!toolCallId || state.terminalToolCallIds.has(toolCallId)) return;
  const tool = state.toolsByCallId.get(toolCallId) ?? {
    toolCallId,
    toolExecutionId: readString(payload.toolExecutionId),
    toolName: readString(payload.toolName) ?? 'unknown_tool',
    inputSummary: inputSummary(payload.input, readString(payload.toolName) ?? 'unknown_tool'),
  };
  state.pendingToolTerminalsByCallId.delete(toolCallId);
  state.terminalToolCallIds.add(toolCallId);
  const status = readString(payload.status);
  publish(state, sink, event, {
    ...toolEventBase(tool),
    eventType: status === 'rejected' ? 'tool.denied' : status === 'failed' || status === 'error' ? 'tool.failed' : 'tool.completed',
    toolResultId: readString(payload.toolResultId),
    resultSummary: readString(payload.summary) ?? readString(payload.resultSummary),
    errorMessage: readErrorMessage(payload),
  });
}

function handleRunTerminal(
  state: StreamState,
  sink: AgentRuntimeChatStreamSink,
  event: AgentRuntimeEvent,
): void {
  flushAllPendingToolTerminals(state, sink, event);
  completeOpenTextByPhase(state, sink, event, 'answer');
  const payload = payloadOf(event);
  const status = readString(payload.status) ?? event.type.replace(/^run\./, '');
  if (status === 'completed') {
    publish(state, sink, event, { eventType: 'turn.completed' });
  } else if (status === 'cancelled' || status === 'canceled') {
    publish(state, sink, event, { eventType: 'turn.cancelled', reason: readString(payload.reason) });
  } else if (status === 'failed') {
    publish(state, sink, event, { eventType: 'turn.failed', errorMessage: readErrorMessage(payload) });
  }
  state.terminal = true;
}

function markStepPrelude(
  state: StreamState,
  sink: AgentRuntimeChatStreamSink,
  event: AgentRuntimeEvent,
  modelStepId: string,
): void {
  const step = textState(state, modelStepId);
  if (step.text && !step.text.terminal && step.text.phase !== 'prelude') {
    const fromPhase = step.text.phase;
    step.phase = 'prelude';
    step.text.phase = 'prelude';
    publish(state, sink, event, {
      eventType: 'assistant.text.reclassified',
      textId: step.text.textId,
      fromPhase,
      toPhase: 'prelude',
    });
    return;
  }
  step.phase = 'prelude';
}

function ensureTextStarted(
  state: StreamState,
  sink: AgentRuntimeChatStreamSink,
  event: AgentRuntimeEvent,
  modelStepId: string,
  phase: AssistantTextPhase,
): TextState {
  const step = textState(state, modelStepId);
  step.phase = phase;
  if (step.text) return step.text;
  const text: TextState = {
    textId: `assistant-text:${event.runId ?? 'run'}:${phase}:${modelStepId}`,
    phase,
    terminal: false,
  };
  step.text = text;
  publish(state, sink, event, {
    eventType: 'assistant.text.started',
    textId: text.textId,
    phase,
  });
  return text;
}

function completeOpenTextForStep(
  state: StreamState,
  sink: AgentRuntimeChatStreamSink,
  event: AgentRuntimeEvent,
  modelStepId: string,
): void {
  const step = state.stepText.get(modelStepId);
  if (!step?.text || step.text.terminal) return;
  step.text.terminal = true;
  publish(state, sink, event, {
    eventType: 'assistant.text.completed',
    textId: step.text.textId,
    phase: step.text.phase,
  });
}

function completeOpenTextByPhase(
  state: StreamState,
  sink: AgentRuntimeChatStreamSink,
  event: AgentRuntimeEvent,
  phase: AssistantTextPhase,
): void {
  for (const step of state.stepText.values()) {
    if (!step.text || step.text.terminal || step.text.phase !== phase) continue;
    step.text.terminal = true;
    publish(state, sink, event, {
      eventType: 'assistant.text.completed',
      textId: step.text.textId,
      phase,
    });
  }
}

function ensureThinkingStarted(
  state: StreamState,
  sink: AgentRuntimeChatStreamSink,
  event: AgentRuntimeEvent,
  modelStepId: string,
): void {
  const thinking = thinkingState(state, modelStepId);
  if (thinking.started) return;
  thinking.started = true;
  publish(state, sink, event, {
    eventType: 'assistant.thinking.started',
    thinkingId: thinking.thinkingId,
  });
}

function completeThinking(
  state: StreamState,
  sink: AgentRuntimeChatStreamSink,
  event: AgentRuntimeEvent,
  modelStepId: string,
): void {
  const thinking = thinkingState(state, modelStepId);
  if (!thinking.started) {
    ensureThinkingStarted(state, sink, event, modelStepId);
  }
  if (thinking.completed) return;
  thinking.completed = true;
  publish(state, sink, event, {
    eventType: 'assistant.thinking.completed',
    thinkingId: thinking.thinkingId,
  });
}

function flushPendingToolTerminalsBefore(
  state: StreamState,
  event: AgentRuntimeEvent,
  sink: AgentRuntimeChatStreamSink,
): void {
  const relatedToolCallId = relatedToolCallIdForEvent(state, event);
  for (const [toolCallId, pending] of [...state.pendingToolTerminalsByCallId]) {
    if (toolCallId === relatedToolCallId) continue;
    emitPendingToolTerminal(state, sink, event, pending);
  }
}

function flushAllPendingToolTerminals(
  state: StreamState,
  sink: AgentRuntimeChatStreamSink,
  event: AgentRuntimeEvent,
): void {
  for (const pending of [...state.pendingToolTerminalsByCallId.values()]) {
    emitPendingToolTerminal(state, sink, event, pending);
  }
}

function emitPendingToolTerminal(
  state: StreamState,
  sink: AgentRuntimeChatStreamSink,
  event: AgentRuntimeEvent,
  pending: PendingToolTerminal,
): void {
  if (state.terminalToolCallIds.has(pending.tool.toolCallId)) {
    state.pendingToolTerminalsByCallId.delete(pending.tool.toolCallId);
    return;
  }
  state.terminalToolCallIds.add(pending.tool.toolCallId);
  state.pendingToolTerminalsByCallId.delete(pending.tool.toolCallId);
  publish(state, sink, event, {
    ...toolEventBase(pending.tool),
    eventType: pending.kind === 'completed' ? 'tool.completed' : pending.kind === 'denied' ? 'tool.denied' : 'tool.failed',
    errorMessage: pending.errorMessage,
    resultSummary: pending.errorMessage,
  });
}

function textState(state: StreamState, modelStepId: string): ModelStepState {
  const existing = state.stepText.get(modelStepId);
  if (existing) return existing;
  const next: ModelStepState = { modelStepId };
  state.stepText.set(modelStepId, next);
  return next;
}

function thinkingState(state: StreamState, modelStepId: string): ThinkingState {
  const existing = state.thinkingByStep.get(modelStepId);
  if (existing) return existing;
  const next: ThinkingState = {
    thinkingId: `assistant-thinking:${modelStepId}`,
    started: false,
    completed: false,
  };
  state.thinkingByStep.set(modelStepId, next);
  return next;
}

function publish(
  state: StreamState,
  sink: AgentRuntimeChatStreamSink,
  event: AgentRuntimeEvent,
  fields: Record<string, unknown> & { eventType: ChatStreamEvent['eventType'] },
): void {
  state.seq += 1;
  const payload = payloadOf(event);
  const runId = event.runId ?? readString(payload.runId) ?? 'default-run';
  const sessionId = event.sessionId ?? readString(payload.sessionId) ?? 'default-session';
  const projectId = readString(payload.projectId) ?? event.workspaceId ?? readString(payload.workspaceId) ?? 'default-project';
  const streamId = readString(payload.streamId) ?? `chat-stream:${runId}`;
  sink.publish({
    eventId: `chat-stream-event:${streamId}:${state.seq}`,
    projectId,
    sessionId,
    runId,
    streamId,
    streamKind: readString(payload.streamKind) ?? 'main',
    seq: state.seq,
    createdAt: event.occurredAt,
    ...fields,
  } as ChatStreamEvent);
}

function toolEventBase(tool: ToolState): {
  toolCallId: string;
  toolExecutionId?: string;
  toolName: string;
  inputSummary?: string;
} {
  return {
    toolCallId: tool.toolCallId,
    ...(tool.toolExecutionId ? { toolExecutionId: tool.toolExecutionId } : {}),
    toolName: tool.toolName,
    ...(tool.inputSummary ? { inputSummary: tool.inputSummary } : {}),
  };
}

function relatedToolCallIdForEvent(state: StreamState, event: AgentRuntimeEvent): string | undefined {
  const payload = payloadOf(event);
  if (event.type === 'tool.result.created' || event.type === 'tool.call.created' || event.type === 'tool.execution.started') {
    return readString(payload.toolCallId);
  }
  if (event.type === 'tool.execution.completed') {
    return readString(payload.toolCallId)
      ?? state.toolsByExecutionId.get(readString(payload.toolExecutionId) ?? '')?.toolCallId;
  }
  return undefined;
}

function toolFromPayload(state: StreamState, payload: Record<string, unknown>): ToolState | undefined {
  const toolCallId = readString(payload.toolCallId);
  if (toolCallId && state.toolsByCallId.has(toolCallId)) return state.toolsByCallId.get(toolCallId);
  const toolExecutionId = readString(payload.toolExecutionId);
  if (toolExecutionId && state.toolsByExecutionId.has(toolExecutionId)) return state.toolsByExecutionId.get(toolExecutionId);
  if (toolCallId && readString(payload.toolName)) {
    return {
      toolCallId,
      ...(toolExecutionId ? { toolExecutionId } : {}),
      toolName: readString(payload.toolName) ?? 'unknown_tool',
      inputSummary: inputSummary(payload.input, readString(payload.toolName) ?? 'unknown_tool'),
    };
  }
  return undefined;
}

function inputSummary(input: unknown, fallback: string): string {
  const record = readRecord(input);
  if (!record) return fallback;
  for (const key of ['path', 'command', 'pattern', 'query']) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return fallback;
}

function modelStepIdFor(event: AgentRuntimeEvent, streamEvent?: Record<string, unknown>): string {
  const payload = payloadOf(event);
  return readString(payload.modelStepId)
    ?? `${event.runId ?? 'run'}:${String(payload.turnIndex ?? 0)}`;
}

function streamKey(event: AgentRuntimeEvent): string {
  const payload = payloadOf(event);
  const runId = event.runId ?? readString(payload.runId) ?? 'default-run';
  const sessionId = event.sessionId ?? readString(payload.sessionId) ?? 'default-session';
  const streamId = readString(payload.streamId) ?? `chat-stream:${runId}`;
  return `${sessionId}:${runId}:${streamId}`;
}

function syntheticTerminalEvent(key: string): AgentRuntimeEvent {
  const [, runId] = key.split(':');
  return {
    type: 'run.completed',
    runId: runId || 'default-run',
    occurredAt: new Date(0).toISOString(),
    payload: { status: 'completed' },
  };
}

function userMessageFields(event: AgentRuntimeEvent): Record<string, unknown> {
  const payload = payloadOf(event);
  return {
    userMessageId: readString(payload.userMessageId) ?? readString(payload.messageId) ?? `user-message:${event.runId ?? 'run'}`,
    clientMessageId: readString(payload.clientMessageId),
  };
}

function payloadOf(event: AgentRuntimeEvent): Record<string, unknown> {
  return event.payload ?? {};
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readErrorMessage(payload: Record<string, unknown>): string | undefined {
  const direct = readString(payload.errorMessage) ?? readString(payload.message);
  if (direct) return direct;
  const error = readRecord(payload.error);
  return error ? readString(error.message) : undefined;
}
