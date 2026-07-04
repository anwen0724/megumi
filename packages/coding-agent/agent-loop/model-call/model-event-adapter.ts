// Converts pure assistant stream events into the current runtime model-step event protocol.
import { JsonObjectSchema, type JsonObject, type JsonValue } from '@megumi/shared/primitives/json';
import type { ChatTokenUsagePayload, RuntimeErrorCode, RuntimeEvent } from '@megumi/shared/runtime';
import {
  createModelStepProviderStateRecordedEvent,
  createModelStepStartedEvent,
  createModelThinkingCompletedEvent,
  createModelThinkingDeltaEvent,
  createModelThinkingStartedEvent,
  createModelToolCallDetectedEvent,
  createRuntimeEvent,
  createRunCancelledEvent,
  createRunFailedEvent,
  createToolCallCreatedEvent,
} from '@megumi/shared/runtime';
import type { AssistantContentBlock, AssistantEventStream, AssistantStreamEvent } from '@megumi/ai';
import type { Clock, ModelCallAdapterRequest } from './model-call-contract';

export async function* adaptAssistantStreamToRuntimeEvents(input: {
  request: ModelCallAdapterRequest;
  stream: AssistantEventStream;
  clock: Clock;
}): AsyncIterable<RuntimeEvent> {
  const state: StreamState = {
    text: '',
    thinking: '',
    thinkingStarted: false,
    thinkingCompleted: false,
  };

  yield createModelStepStarted(input.request, input.clock.now());

  for await (const event of input.stream) {
    if (event.type === 'content_block_delta') {
      yield* adaptContentBlockDelta(input.request, event, state, input.clock);
      continue;
    }

    if (event.type === 'content_block_end') {
      yield* adaptContentBlockEnd(input.request, event.block, state, input.clock);
      continue;
    }

    if (event.type === 'message_end') {
      if (state.thinkingStarted && !state.thinkingCompleted) {
        yield createModelThinkingCompleted(input.request, input.clock.now());
      }
      yield createModelStepCompleted(input.request, event.message.stopReason, input.clock.now());
      continue;
    }

    if (event.type === 'error') {
      yield createTerminalFailureEvent(input.request, event, input.clock.now());
    }
  }
}

interface StreamState {
  text: string;
  thinking: string;
  thinkingStarted: boolean;
  thinkingCompleted: boolean;
}

async function* adaptContentBlockDelta(
  request: ModelCallAdapterRequest,
  event: Extract<AssistantStreamEvent, { type: 'content_block_delta' }>,
  state: StreamState,
  clock: Clock,
): AsyncIterable<RuntimeEvent> {
  if (event.delta.type === 'text_delta') {
    state.text += event.delta.text;
    yield createModelOutputDelta(request, event.delta.text, clock.now());
    return;
  }

  if (event.delta.type === 'thinking_delta') {
    state.thinking += event.delta.thinking;
    if (!state.thinkingStarted) {
      state.thinkingStarted = true;
      yield createModelThinkingStarted(request, clock.now());
    }
    yield createModelThinkingDelta(request, event.delta.thinking, clock.now());
  }
}

async function* adaptContentBlockEnd(
  request: ModelCallAdapterRequest,
  block: AssistantContentBlock,
  state: StreamState,
  clock: Clock,
): AsyncIterable<RuntimeEvent> {
  if (block.type === 'thinking' && state.thinkingStarted && !state.thinkingCompleted) {
    state.thinkingCompleted = true;
    yield createModelThinkingCompleted(request, clock.now());
    if (block.thinking.length > 0) {
      yield createModelStepProviderStateRecorded(request, block.thinking, clock.now());
    }
    return;
  }

  if (block.type === 'toolCall') {
    yield createModelToolCallDetected(request, block, clock.now());
    yield createModelStepToolCallCreated(request, block, clock.now());
  }
}

function createModelStepStarted(
  input: ModelCallAdapterRequest,
  createdAt: string,
): RuntimeEvent {
  return createModelStepStartedEvent({
    eventId: input.eventIdFactory(),
    eventType: 'model.step.started',
    runId: input.runId,
    sessionId: input.request.sessionId,
    stepId: input.stepId,
    requestId: input.request.requestId,
    runtimeContext: input.request.runtimeContext,
    sequence: input.nextSequence(),
    createdAt,
    source: 'provider',
    visibility: 'system',
    persist: 'required',
    payload: {
      modelStepId: modelStepIdFor(input),
      providerId: input.config.providerId,
      modelId: String(input.request.modelId || input.config.modelId),
    },
  });
}

function createModelOutputDelta(
  input: ModelCallAdapterRequest,
  delta: string,
  createdAt: string,
): RuntimeEvent {
  return createRuntimeEvent({
    eventId: input.eventIdFactory(),
    eventType: 'model.output.delta',
    runId: input.runId,
    sessionId: input.request.sessionId,
    stepId: input.stepId,
    requestId: input.request.requestId,
    runtimeContext: input.request.runtimeContext,
    sequence: input.nextSequence(),
    createdAt,
    source: 'provider',
    visibility: 'user',
    persist: 'transient',
    payload: {
      modelStepId: modelStepIdFor(input),
      delta,
    },
  });
}

function createModelThinkingStarted(
  input: ModelCallAdapterRequest,
  createdAt: string,
): RuntimeEvent {
  return createModelThinkingStartedEvent({
    eventId: input.eventIdFactory(),
    eventType: 'model.thinking.started',
    runId: input.runId,
    sessionId: input.request.sessionId,
    stepId: input.stepId,
    requestId: input.request.requestId,
    runtimeContext: input.request.runtimeContext,
    sequence: input.nextSequence(),
    createdAt,
    source: 'provider',
    visibility: 'system',
    persist: 'transient',
    payload: {
      modelStepId: modelStepIdFor(input),
    },
  });
}

function createModelThinkingDelta(
  input: ModelCallAdapterRequest,
  delta: string,
  createdAt: string,
): RuntimeEvent {
  return createModelThinkingDeltaEvent({
    eventId: input.eventIdFactory(),
    eventType: 'model.thinking.delta',
    runId: input.runId,
    sessionId: input.request.sessionId,
    stepId: input.stepId,
    requestId: input.request.requestId,
    runtimeContext: input.request.runtimeContext,
    sequence: input.nextSequence(),
    createdAt,
    source: 'provider',
    visibility: 'system',
    persist: 'transient',
    payload: {
      modelStepId: modelStepIdFor(input),
      delta,
    },
  });
}

function createModelThinkingCompleted(
  input: ModelCallAdapterRequest,
  createdAt: string,
): RuntimeEvent {
  return createModelThinkingCompletedEvent({
    eventId: input.eventIdFactory(),
    eventType: 'model.thinking.completed',
    runId: input.runId,
    sessionId: input.request.sessionId,
    stepId: input.stepId,
    requestId: input.request.requestId,
    runtimeContext: input.request.runtimeContext,
    sequence: input.nextSequence(),
    createdAt,
    source: 'provider',
    visibility: 'system',
    persist: 'transient',
    payload: {
      modelStepId: modelStepIdFor(input),
    },
  });
}

function createModelToolCallDetected(
  input: ModelCallAdapterRequest,
  toolCall: AssistantContentBlock & { type: 'toolCall' },
  createdAt: string,
): RuntimeEvent {
  return createModelToolCallDetectedEvent({
    eventId: input.eventIdFactory(),
    eventType: 'model.tool_call.detected',
    runId: input.runId,
    sessionId: input.request.sessionId,
    stepId: input.stepId,
    requestId: input.request.requestId,
    runtimeContext: input.request.runtimeContext,
    sequence: input.nextSequence(),
    createdAt,
    source: 'provider',
    visibility: 'system',
    persist: 'required',
    payload: {
      modelStepId: modelStepIdFor(input),
      toolCallId: toolCall.id,
      providerToolCallId: toolCall.id,
      toolName: toolCall.name,
    },
  });
}

function createModelStepToolCallCreated(
  input: ModelCallAdapterRequest,
  toolCall: AssistantContentBlock & { type: 'toolCall' },
  createdAt: string,
): RuntimeEvent {
  return createToolCallCreatedEvent({
    eventId: input.eventIdFactory(),
    eventType: 'tool.call.created',
    runId: input.runId,
    sessionId: input.request.sessionId,
    stepId: input.stepId,
    requestId: input.request.requestId,
    runtimeContext: input.request.runtimeContext,
    sequence: input.nextSequence(),
    createdAt,
    source: 'provider',
    visibility: 'system',
    persist: 'required',
    payload: {
      toolCallId: toolCall.id,
      modelStepId: modelStepIdFor(input),
      providerToolCallId: toolCall.id,
      toolName: toolCall.name,
      input: parseToolArguments(toolCall.argumentsText),
    },
  });
}

function createModelStepProviderStateRecorded(
  input: ModelCallAdapterRequest,
  reasoningContent: string,
  createdAt: string,
): RuntimeEvent {
  return createModelStepProviderStateRecordedEvent({
    eventId: input.eventIdFactory(),
    eventType: 'model.step.provider_state.recorded',
    runId: input.runId,
    sessionId: input.request.sessionId,
    stepId: input.stepId,
    requestId: input.request.requestId,
    runtimeContext: input.request.runtimeContext,
    sequence: input.nextSequence(),
    createdAt,
    source: 'provider',
    visibility: 'system',
    persist: 'required',
    payload: {
      modelStepId: modelStepIdFor(input),
      providerId: input.config.providerId,
      modelId: String(input.request.modelId || input.config.modelId),
      blocks: [
        {
          type: 'thinking',
          text: reasoningContent,
        },
      ],
    },
  });
}

function createModelStepCompleted(
  input: ModelCallAdapterRequest,
  finishReason: string | undefined,
  createdAt: string,
): RuntimeEvent {
  return createRuntimeEvent({
    eventId: input.eventIdFactory(),
    eventType: 'model.step.completed',
    runId: input.runId,
    sessionId: input.request.sessionId,
    stepId: input.stepId,
    requestId: input.request.requestId,
    runtimeContext: input.request.runtimeContext,
    sequence: input.nextSequence(),
    createdAt,
    source: 'provider',
    visibility: 'system',
    persist: 'required',
    payload: {
      modelStepId: modelStepIdFor(input),
      ...(finishReason ? { finishReason } : {}),
    },
  });
}

function createTerminalFailureEvent(
  input: ModelCallAdapterRequest,
  event: Extract<AssistantStreamEvent, { type: 'error' }>,
  createdAt: string,
): RuntimeEvent {
  if (event.reason === 'aborted' || input.signal?.aborted) {
    return createRunCancelledEvent({
      eventId: input.eventIdFactory(),
      request: requestRef(input),
      runId: input.runId,
      sequence: input.nextSequence(),
      reason: event.message.error?.message ?? 'Provider request was cancelled.',
      createdAt,
    });
  }

  return createRunFailedEvent({
    eventId: input.eventIdFactory(),
    request: requestRef(input),
    runId: input.runId,
    sequence: input.nextSequence(),
    createdAt,
    error: providerRuntimeError(input, mapProviderErrorCode(event.message.error?.code), jsonObjectFromUnknown(
      event.message.error?.details,
    ), {
      message: event.message.error?.message,
      retryable: event.message.error?.retryable,
    }),
  });
}

function providerRuntimeError(
  input: ModelCallAdapterRequest,
  code: RuntimeErrorCode,
  diagnostics: JsonObject = {},
  options: { message?: string; retryable?: boolean } = {},
) {
  return {
    code,
    message: options.message ?? errorMessageForCode(code),
    severity: 'error' as const,
    retryable: options.retryable ?? (code === 'provider_rate_limited' || code === 'provider_network_error'),
    source: 'provider' as const,
    details: {
      providerId: input.config.providerId,
      modelId: String(input.request.modelId || input.config.modelId),
      ...diagnostics,
    },
  };
}

function mapProviderErrorCode(code: string | undefined): RuntimeErrorCode {
  switch (code) {
    case 'credential_error':
      return 'provider_missing_api_key';
    case 'provider_http_error':
      return 'provider_invalid_request';
    case 'rate_limited':
      return 'provider_rate_limited';
    case 'token_limited':
      return 'context_budget_exceeded';
    case 'stream_parse_error':
    case 'stream_source_error':
    case 'unknown_provider_error':
      return 'provider_network_error';
    case 'registry_error':
      return 'provider_unsupported';
    default:
      return 'provider_network_error';
  }
}

function errorMessageForCode(code: RuntimeErrorCode): string {
  switch (code) {
    case 'provider_missing_api_key':
    case 'provider_auth_failed':
      return 'Provider rejected the API key.';
    case 'provider_rate_limited':
      return 'Provider rate limit was reached.';
    case 'provider_invalid_request':
      return 'Provider rejected the request.';
    case 'provider_network_error':
      return 'Provider network request failed.';
    default:
      return 'Provider request failed.';
  }
}

function modelStepIdFor(input: ModelCallAdapterRequest): string {
  return String(input.request.modelStepId ?? input.stepId);
}

function parseToolArguments(argumentsText: string): JsonValue {
  if (!argumentsText.trim()) {
    return {};
  }

  try {
    const value = JSON.parse(argumentsText);
    return isRecord(value) ? value as JsonValue : {};
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function jsonObjectFromUnknown(value: unknown): JsonObject {
  const parsed = JsonObjectSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : {};
}

function requestRef(input: ModelCallAdapterRequest) {
  return {
    requestId: input.request.requestId,
    sessionId: input.request.sessionId,
    providerId: input.request.providerId,
    modelId: input.request.modelId,
    runtimeContext: input.request.runtimeContext,
  };
}
