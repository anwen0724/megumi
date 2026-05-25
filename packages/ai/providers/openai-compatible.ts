import type { ChatRuntimeRequest, ChatTokenUsage } from '@megumi/shared/chat-contracts';
import type { JsonObject, JsonValue } from '@megumi/shared/json';
import type { ModelStepRuntimeRequest } from '@megumi/shared/model-step-contracts';
import type { RuntimeErrorCode } from '@megumi/shared/runtime-errors';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';
import {
  createAssistantCompletedEvent,
  createAssistantDeltaEvent,
  createModelStepProviderStateRecordedEvent,
  createModelStepStartedEvent,
  createModelThinkingCompletedEvent,
  createModelThinkingDeltaEvent,
  createModelThinkingStartedEvent,
  createModelToolUseDetectedEvent,
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
      const requestBody = mapModelStepToOpenAICompatibleRequest(input.request);
      const diagnostics = createProviderRequestDiagnostics(requestBody, input.request.toolResults?.length ? 'tool_continuation' : 'initial');
      let failureStage: ProviderFailureStage = 'fetch_throw';

      try {
        const response = await options.fetch(buildChatCompletionsUrl(input.config.baseUrl ?? options.defaultBaseUrl), {
          method: 'POST',
          headers: {
            authorization: `Bearer ${input.config.apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(requestBody),
          signal: input.signal,
        });

        if (!response.ok) {
          yield failedModelStepEvent(input, mapHttpStatus(response.status), clock.now(), {
            ...diagnostics,
            failureStage: 'http_error',
            httpStatus: response.status,
            httpStatusText: response.statusText,
            ...(await providerErrorBodyPreview(response)),
          });
          return;
        }

        let usage: ChatTokenUsage | undefined;
        let content = '';
        let reasoningContent = '';
        let reasoningStarted = false;
        let finishReason: string | undefined;
        const toolCalls = new Map<number, OpenAICompatibleToolCallAccumulator>();
        const detectedToolUseIds = new Set<string>();

        yield createModelStepStarted(input, clock.now());
        failureStage = 'stream_parse_error';

        for await (const item of parseOpenAICompatibleSseStream(response.body)) {
          if (item.type === 'delta') {
            content += item.delta;
            yield createModelOutputDelta(input, item.delta, clock.now());
          } else if (item.type === 'reasoning_delta') {
            reasoningContent += item.delta;
            if (!reasoningStarted) {
              reasoningStarted = true;
              yield createModelThinkingStarted(input, clock.now());
            }
            yield createModelThinkingDelta(input, item.delta, clock.now());
          } else if (item.type === 'tool_call_delta') {
            const toolCall = appendToolCallDelta(toolCalls, item);
            if (isDetectableToolCall(toolCall) && !detectedToolUseIds.has(toolCall.id)) {
              detectedToolUseIds.add(toolCall.id);
              yield createModelToolUseDetected(input, toolCall, clock.now());
            }
          } else if (item.type === 'finish') {
            finishReason = item.finishReason;
          } else if (item.type === 'usage') {
            usage = item.usage;
          }
        }

        if (reasoningStarted) {
          yield createModelThinkingCompleted(input, clock.now());
        }

        if (reasoningContent.length > 0) {
          yield createModelStepProviderStateRecorded(input, reasoningContent, clock.now());
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

        yield failedModelStepEvent(input, 'provider_network_error', clock.now(), {
          ...diagnostics,
          failureStage,
          ...errorDiagnostics(error),
        });
      }
    },
    async *streamChat(input: AiChatAdapterRequest): AsyncIterable<RuntimeEvent> {
      const requestBody = {
        model: input.request.modelId || input.config.defaultModelId,
        messages: mapToOpenAICompatibleMessages(input.request),
        stream: true,
        stream_options: {
          include_usage: true,
        },
      };
      const diagnostics = createProviderRequestDiagnostics(requestBody, 'chat');
      let failureStage: ProviderFailureStage = 'fetch_throw';

      try {
        const response = await options.fetch(buildChatCompletionsUrl(input.config.baseUrl ?? options.defaultBaseUrl), {
          method: 'POST',
          headers: {
            authorization: `Bearer ${input.config.apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(requestBody),
          signal: input.signal,
        });

        if (!response.ok) {
          yield failedEvent(input, mapHttpStatus(response.status), clock.now(), {
            ...diagnostics,
            failureStage: 'http_error',
            httpStatus: response.status,
            httpStatusText: response.statusText,
            ...(await providerErrorBodyPreview(response)),
          });
          return;
        }

        let usage: ChatTokenUsage | undefined;
        let content = '';
        failureStage = 'stream_parse_error';

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

        yield failedEvent(input, 'provider_network_error', clock.now(), {
          ...diagnostics,
          failureStage,
          ...errorDiagnostics(error),
        });
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

  if (status >= 400 && status < 500) {
    return 'provider_invalid_request';
  }

  return 'provider_network_error';
}

function failedEvent(
  input: AiChatAdapterRequest,
  code: RuntimeErrorCode,
  createdAt: string,
  diagnostics: JsonObject = {},
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
        ...diagnostics,
      },
    },
  });
}

type ProviderFailureStage = 'http_error' | 'fetch_throw' | 'stream_parse_error';
type ProviderRequestShape = 'chat' | 'initial' | 'tool_continuation';

interface OpenAICompatibleRequestDiagnosticsBody {
  messages: Array<{ role: string; tool_calls?: unknown[] }>;
  tools?: unknown[];
}

function createProviderRequestDiagnostics(
  body: OpenAICompatibleRequestDiagnosticsBody,
  requestShape: ProviderRequestShape,
): JsonObject {
  return {
    boundary: 'provider',
    operation: 'chat_completions_stream',
    requestShape,
    messageRoles: body.messages.map((message) => message.role),
    toolDefinitionCount: body.tools?.length ?? 0,
    toolUseCount: body.messages.reduce((count, message) => count + (message.tool_calls?.length ?? 0), 0),
    toolResultCount: body.messages.filter((message) => message.role === 'tool').length,
  };
}

async function providerErrorBodyPreview(response: Response): Promise<JsonObject> {
  try {
    const body = await response.text();
    const preview = safeDiagnosticTextPreview(body);
    return preview ? { providerErrorBodyPreview: preview } : {};
  } catch (error) {
    return {
      providerErrorBodyReadError: safeDiagnosticTextPreview(errorMessageForDiagnostic(error)),
    };
  }
}

function errorDiagnostics(error: unknown): JsonObject {
  return {
    errorName: errorNameForDiagnostic(error),
    errorMessage: safeDiagnosticTextPreview(errorMessageForDiagnostic(error)),
  };
}

function errorNameForDiagnostic(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

function errorMessageForDiagnostic(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function safeDiagnosticTextPreview(value: string): string {
  const maxLength = 2000;
  return redactDiagnosticText(value).slice(0, maxLength);
}

function redactDiagnosticText(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/g, 'Bearer [redacted]')
    .replace(/\bsk-[A-Za-z0-9._-]{8,}\b/g, '[redacted]')
    .replace(/\b(apiKey|api_key|token|secret|password)=([^&\s]+)/gi, '$1=[redacted]')
    .replace(/\b(token|secret|password):\s*([^,\s]+)/gi, '$1: [redacted]')
    .replace(/("(?:apiKey|api_key|token|secret|password|authorization|cookie)"\s*:\s*")([^"]*)(")/gi, '$1[redacted]$3');
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
): OpenAICompatibleToolCallAccumulator {
  const current = toolCalls.get(delta.index) ?? { argumentsText: '' };
  const next = {
    id: delta.id ?? current.id,
    toolType: delta.toolType ?? current.toolType,
    name: delta.name ?? current.name,
    argumentsText: current.argumentsText + (delta.argumentsDelta ?? ''),
  };

  toolCalls.set(delta.index, next);
  return next;
}

function isDetectableToolCall(
  toolCall: OpenAICompatibleToolCallAccumulator,
): toolCall is OpenAICompatibleToolCallAccumulator & { id: string; name: string } {
  return Boolean(toolCall.id && toolCall.name);
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

function createModelThinkingStarted(
  input: AiModelStepAdapterRequest,
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
  input: AiModelStepAdapterRequest,
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
  input: AiModelStepAdapterRequest,
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

function createModelToolUseDetected(
  input: AiModelStepAdapterRequest,
  toolCall: OpenAICompatibleToolCallAccumulator & { id: string; name: string },
  createdAt: string,
): RuntimeEvent {
  return createModelToolUseDetectedEvent({
    eventId: input.eventIdFactory(),
    eventType: 'model.tool_use.detected',
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
      toolUseId: toolCall.id,
      providerToolUseId: toolCall.id,
      toolName: toolCall.name,
    },
  });
}

function createModelStepProviderStateRecorded(
  input: AiModelStepAdapterRequest,
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
      modelId: String(input.request.modelId || input.config.defaultModelId),
      blocks: [
        {
          type: 'reasoning_content',
          text: reasoningContent,
        },
      ],
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
  diagnostics: JsonObject = {},
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
        ...diagnostics,
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
    case 'provider_invalid_request':
      return 'Provider rejected the request.';
    case 'provider_network_error':
      return 'Provider network request failed.';
    default:
      return 'Provider request failed.';
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
