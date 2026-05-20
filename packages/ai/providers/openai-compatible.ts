import type { ChatRuntimeRequest, ChatTokenUsage } from '@megumi/shared/chat-contracts';
import type { JsonValue } from '@megumi/shared/json';
import type { ModelStepRuntimeRequest } from '@megumi/shared/model-step-contracts';
import type { RuntimeErrorCode } from '@megumi/shared/runtime-errors';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';
import {
  createAssistantCompletedEvent,
  createAssistantDeltaEvent,
  createModelStepStartedEvent,
  createRuntimeEvent,
  createRunCancelledEvent,
  createRunFailedEvent,
  createToolUseCreatedEvent,
} from '@megumi/shared/runtime-event-factory';
import {
  mapModelStepToOpenAICompatibleRequest,
  mapToOpenAICompatibleMessages,
} from '../prompt/message-mapper';
import { parseOpenAICompatibleSseStream } from '../stream';
import {
  type AiChatAdapterRequest,
  type AiModelStepAdapterRequest,
  type AiProviderAdapter,
  type OpenAICompatibleAdapterOptions,
  systemClock,
} from '../types';

export function createOpenAICompatibleAdapter(options: OpenAICompatibleAdapterOptions): AiProviderAdapter {
  const clock = options.clock ?? systemClock;

  return {
    providerId: options.providerId,
    async *streamModelStep(input: AiModelStepAdapterRequest): AsyncIterable<RuntimeEvent> {
      try {
        const response = await options.fetch(buildChatCompletionsUrl(input.config.baseUrl ?? options.defaultBaseUrl), {
          method: 'POST',
          headers: {
            authorization: `Bearer ${input.config.apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(mapModelStepToOpenAICompatibleRequest(input.request)),
          signal: input.signal,
        });

        if (!response.ok) {
          yield failedModelStepEvent(input, mapHttpStatus(response.status), clock.now());
          return;
        }

        let usage: ChatTokenUsage | undefined;
        let content = '';
        let finishReason: string | undefined;
        const toolCalls = new Map<number, OpenAICompatibleToolCallAccumulator>();

        yield createModelStepStarted(input, clock.now());

        for await (const item of parseOpenAICompatibleSseStream(response.body)) {
          if (item.type === 'delta') {
            content += item.delta;
            yield createModelOutputDelta(input, item.delta, clock.now());
          } else if (item.type === 'tool_call_delta') {
            appendToolCallDelta(toolCalls, item);
          } else if (item.type === 'finish') {
            finishReason = item.finishReason;
          } else if (item.type === 'usage') {
            usage = item.usage;
          }
        }

        for (const toolCall of [...toolCalls.entries()].sort(([left], [right]) => left - right).map(([, value]) => value)) {
          if (isCompleteToolCall(toolCall)) {
            yield createModelStepToolUseCreated(input, toolCall, clock.now());
          }
        }

        yield createModelStepCompleted(input, {
          content,
          finishReason,
          usage,
        }, clock.now());
      } catch (error) {
        if (isAbortError(error) || input.signal?.aborted) {
          yield createRunCancelledEvent({
            eventId: input.eventIdFactory(),
            request: toChatRuntimeRequest(input.request),
            runId: input.runId,
            sequence: input.nextSequence(),
            reason: 'Provider request was cancelled.',
            createdAt: clock.now(),
          });
          return;
        }

        yield failedModelStepEvent(input, 'provider_network_error', clock.now());
      }
    },
    async *streamChat(input: AiChatAdapterRequest): AsyncIterable<RuntimeEvent> {
      try {
        const response = await options.fetch(buildChatCompletionsUrl(input.config.baseUrl ?? options.defaultBaseUrl), {
          method: 'POST',
          headers: {
            authorization: `Bearer ${input.config.apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: input.request.modelId || input.config.defaultModelId,
            messages: mapToOpenAICompatibleMessages(input.request),
            stream: true,
            stream_options: {
              include_usage: true,
            },
          }),
          signal: input.signal,
        });

        if (!response.ok) {
          yield failedEvent(input, mapHttpStatus(response.status), clock.now());
          return;
        }

        let usage: ChatTokenUsage | undefined;
        let content = '';

        for await (const item of parseOpenAICompatibleSseStream(response.body)) {
          if (item.type === 'delta') {
            content += item.delta;
            yield createAssistantDeltaEvent({
              eventId: input.eventIdFactory(),
              request: input.request,
              runId: input.runId,
              sequence: input.nextSequence(),
              delta: item.delta,
              createdAt: clock.now(),
            });
          } else if (item.type === 'usage') {
            usage = item.usage;
          }
        }

        yield createAssistantCompletedEvent({
          eventId: input.eventIdFactory(),
          request: input.request,
          runId: input.runId,
          sequence: input.nextSequence(),
          createdAt: clock.now(),
          payload: {
            content,
            ...(usage ? { usage } : {}),
          },
        });
      } catch (error) {
        if (isAbortError(error) || input.signal?.aborted) {
          yield createRunCancelledEvent({
            eventId: input.eventIdFactory(),
            request: input.request,
            runId: input.runId,
            sequence: input.nextSequence(),
            reason: 'Provider request was cancelled.',
            createdAt: clock.now(),
          });
          return;
        }

        yield failedEvent(input, 'provider_network_error', clock.now());
      }
    },
  };
}

function buildChatCompletionsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
}

function mapHttpStatus(status: number): RuntimeErrorCode {
  if (status === 401 || status === 403) {
    return 'provider_auth_failed';
  }

  if (status === 429) {
    return 'provider_rate_limited';
  }

  return 'provider_network_error';
}

function failedEvent(
  input: AiChatAdapterRequest,
  code: RuntimeErrorCode,
  createdAt: string,
): RuntimeEvent {
  return createRunFailedEvent({
    eventId: input.eventIdFactory(),
    request: input.request,
    runId: input.runId,
    sequence: input.nextSequence(),
    createdAt,
    error: {
      code,
      message: errorMessageForCode(code),
      severity: 'error',
      retryable: code === 'provider_rate_limited' || code === 'provider_network_error',
      source: 'provider',
      details: {
        providerId: input.config.providerId,
        modelId: String(input.request.modelId || input.config.defaultModelId),
      },
    },
  });
}

interface OpenAICompatibleToolCallDelta {
  index: number;
  id?: string;
  toolType?: string;
  name?: string;
  argumentsDelta?: string;
}

interface OpenAICompatibleToolCallAccumulator {
  id?: string;
  toolType?: string;
  name?: string;
  argumentsText: string;
}

function appendToolCallDelta(
  toolCalls: Map<number, OpenAICompatibleToolCallAccumulator>,
  delta: OpenAICompatibleToolCallDelta,
): void {
  const current = toolCalls.get(delta.index) ?? { argumentsText: '' };

  toolCalls.set(delta.index, {
    id: delta.id ?? current.id,
    toolType: delta.toolType ?? current.toolType,
    name: delta.name ?? current.name,
    argumentsText: current.argumentsText + (delta.argumentsDelta ?? ''),
  });
}

function isCompleteToolCall(
  toolCall: OpenAICompatibleToolCallAccumulator,
): toolCall is OpenAICompatibleToolCallAccumulator & { id: string; name: string } {
  return Boolean(toolCall.id && toolCall.name);
}

function createModelStepStarted(
  input: AiModelStepAdapterRequest,
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
      modelId: String(input.request.modelId || input.config.defaultModelId),
    },
  });
}

function createModelOutputDelta(
  input: AiModelStepAdapterRequest,
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

function createModelStepToolUseCreated(
  input: AiModelStepAdapterRequest,
  toolCall: OpenAICompatibleToolCallAccumulator & { id: string; name: string },
  createdAt: string,
): RuntimeEvent {
  return createToolUseCreatedEvent({
    eventId: input.eventIdFactory(),
    eventType: 'tool.use.created',
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
      toolUseId: toolCall.id,
      modelStepId: modelStepIdFor(input),
      providerToolUseId: toolCall.id,
      toolName: toolCall.name,
      input: parseToolArguments(toolCall.argumentsText),
    },
  });
}

function createModelStepCompleted(
  input: AiModelStepAdapterRequest,
  payload: { content: string; finishReason?: string; usage?: ChatTokenUsage },
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
      ...(payload.finishReason ? { finishReason: payload.finishReason } : {}),
    },
  });
}

function modelStepIdFor(input: AiModelStepAdapterRequest): string {
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

function toChatRuntimeRequest(request: ModelStepRuntimeRequest): ChatRuntimeRequest {
  return {
    requestId: request.requestId,
    sessionId: request.sessionId,
    providerId: request.providerId,
    modelId: request.modelId,
    messages: request.messages.map((message) => ({
      id: message.messageId,
      role: toChatRuntimeRole(message.role),
      content: message.content,
      createdAt: message.createdAt,
    })),
    runtimeContext: request.runtimeContext,
    createdAt: request.createdAt,
  };
}

function toChatRuntimeRole(role: ModelStepRuntimeRequest['messages'][number]['role']): ChatRuntimeRequest['messages'][number]['role'] {
  return role === 'host' ? 'system' : role;
}

function failedModelStepEvent(
  input: AiModelStepAdapterRequest,
  code: RuntimeErrorCode,
  createdAt: string,
): RuntimeEvent {
  return createRunFailedEvent({
    eventId: input.eventIdFactory(),
    request: toChatRuntimeRequest(input.request),
    runId: input.runId,
    sequence: input.nextSequence(),
    createdAt,
    error: {
      code,
      message: errorMessageForCode(code),
      severity: 'error',
      retryable: code === 'provider_rate_limited' || code === 'provider_network_error',
      source: 'provider',
      details: {
        providerId: input.config.providerId,
        modelId: String(input.request.modelId || input.config.defaultModelId),
      },
    },
  });
}

function errorMessageForCode(code: RuntimeErrorCode): string {
  switch (code) {
    case 'provider_auth_failed':
      return 'Provider rejected the API key.';
    case 'provider_rate_limited':
      return 'Provider rate limit was reached.';
    case 'provider_network_error':
      return 'Provider network request failed.';
    default:
      return 'Provider request failed.';
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
