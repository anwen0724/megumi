import type { JsonObject, JsonValue } from '@megumi/shared/primitives';
import type { ModelStepRuntimeRequest } from '@megumi/shared/model';
import type { RuntimeErrorCode } from '@megumi/shared/runtime';
import type { ChatTokenUsagePayload, RuntimeEvent } from '@megumi/shared/runtime';
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
import {
  materializeModelStepOpenAICompatibleRequest,
  OpenAICompatibleRequestMaterializationError,
  type OpenAICompatibleProviderRequestTrace,
} from '../prompt/message-mapper';
import { parseOpenAICompatibleSseStream } from '../stream';
import {
  type AiModelStepCompletionResult,
  type AiModelStepCompletionToolCall,
  type AiModelStepAdapterRequest,
  type AiProviderAdapter,
  type OpenAICompatibleToolCall,
  type OpenAICompatibleAdapterOptions,
  systemClock,
} from '../types';

export function createOpenAICompatibleAdapter(options: OpenAICompatibleAdapterOptions): AiProviderAdapter {
  const clock = options.clock ?? systemClock;

  return {
    providerId: options.providerId,
    async completeModelStep(input: AiModelStepAdapterRequest): Promise<AiModelStepCompletionResult> {
      const requestShape = hasToolResultContinuation(input.request) ? 'tool_continuation' : 'initial';
      let diagnostics: JsonObject = createProviderRequestDiagnosticsBase(requestShape, 'chat_completions_complete');
      let failureStage: ProviderFailureStage = 'materialization';

      try {
        const materializedRequest = materializeModelStepOpenAICompatibleRequest(input.request);
        const { stream: _stream, stream_options: _streamOptions, ...streamingBody } = materializedRequest.body;
        const requestBody = {
          ...streamingBody,
          stream: false,
        };
        diagnostics = createProviderRequestDiagnostics(requestBody, requestShape, materializedRequest.trace, 'chat_completions_complete');
        failureStage = 'fetch_throw';

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
          return {
            ok: false,
            error: providerRuntimeError(input, mapHttpStatus(response.status), {
              ...diagnostics,
              failureStage: 'http_error',
              httpStatus: response.status,
              httpStatusText: response.statusText,
              ...(await providerErrorBodyPreview(response)),
            }),
          };
        }

        failureStage = 'response_parse_error';
        const completion = await parseOpenAICompatibleCompletionResponse(response);
        const providerStates = completion.reasoningContent
          ? [{
              modelStepId: modelStepIdFor(input),
              providerId: input.config.providerId,
              modelId: String(input.request.modelId || input.config.defaultModelId),
              blocks: [{
                type: 'reasoning_content' as const,
                text: completion.reasoningContent,
              }],
            }]
          : undefined;

        return {
          ok: true,
          text: completion.content,
          ...(completion.toolCalls.length > 0 ? { toolCalls: completion.toolCalls.map(mapCompletionToolCall) } : {}),
          ...(providerStates ? { providerStates } : {}),
          ...(completion.finishReason ? { finishReason: completion.finishReason } : {}),
          ...(completion.usage ? { usage: completion.usage } : {}),
        };
      } catch (error) {
        if (error instanceof OpenAICompatibleRequestMaterializationError) {
          return {
            ok: false,
            error: providerRuntimeError(input, 'runtime_protocol_violation', {
              ...diagnostics,
              failureStage: 'materialization',
              materializationCode: error.code,
              ...error.details,
            }, {
              message: 'Provider request materialization failed.',
              retryable: false,
            }),
          };
        }

        if (isAbortError(error) || input.signal?.aborted) {
          return {
            ok: false,
            error: providerRuntimeError(input, 'runtime_cancelled', {
              ...diagnostics,
              failureStage,
            }, {
              message: 'Provider request was cancelled.',
              retryable: false,
            }),
          };
        }

        return {
          ok: false,
          error: providerRuntimeError(input, 'provider_network_error', {
            ...diagnostics,
            failureStage,
            ...errorDiagnostics(error),
          }),
        };
      }
    },
    async *streamModelStep(input: AiModelStepAdapterRequest): AsyncIterable<RuntimeEvent> {
      const requestShape = hasToolResultContinuation(input.request) ? 'tool_continuation' : 'initial';
      let diagnostics: JsonObject = createProviderRequestDiagnosticsBase(requestShape, 'chat_completions_stream');
      let failureStage: ProviderFailureStage = 'materialization';

      try {
        const materializedRequest = materializeModelStepOpenAICompatibleRequest(input.request);
        const requestBody = materializedRequest.body;
        diagnostics = createProviderRequestDiagnostics(requestBody, requestShape, materializedRequest.trace, 'chat_completions_stream');
        failureStage = 'fetch_throw';

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

        let usage: ChatTokenUsagePayload | undefined;
        let content = '';
        let reasoningContent = '';
        let reasoningStarted = false;
        let finishReason: string | undefined;
        const toolCalls = new Map<number, OpenAICompatibleToolCallAccumulator>();
        const detectedToolCallIds = new Set<string>();

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
            if (isDetectableToolCall(toolCall) && !detectedToolCallIds.has(toolCall.id)) {
              detectedToolCallIds.add(toolCall.id);
              yield createModelToolCallDetected(input, toolCall, clock.now());
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
            yield createModelStepToolCallCreated(input, toolCall, clock.now());
          }
        }

        yield createModelStepCompleted(input, {
          content,
          finishReason,
          usage,
        }, clock.now());
      } catch (error) {
        if (error instanceof OpenAICompatibleRequestMaterializationError) {
          yield failedModelStepEvent(input, 'runtime_protocol_violation', clock.now(), {
            ...diagnostics,
            failureStage: 'materialization',
            materializationCode: error.code,
            ...error.details,
          }, {
            message: 'Provider request materialization failed.',
            retryable: false,
          });
          return;
        }

        if (isAbortError(error) || input.signal?.aborted) {
          yield createRunCancelledEvent({
            eventId: input.eventIdFactory(),
            request: requestRef(input),
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

type ProviderFailureStage = 'materialization' | 'http_error' | 'fetch_throw' | 'stream_parse_error' | 'response_parse_error';
type ProviderRequestShape = 'initial' | 'tool_continuation';

interface OpenAICompatibleRequestDiagnosticsBody {
  messages: Array<{ role: string; tool_calls?: unknown[] }>;
  tools?: unknown[];
}

function createProviderRequestDiagnosticsBase(requestShape: ProviderRequestShape, operation: string): JsonObject {
  return {
    boundary: 'provider',
    operation,
    requestShape,
  };
}

function createProviderRequestDiagnostics(
  body: OpenAICompatibleRequestDiagnosticsBody,
  requestShape: ProviderRequestShape,
  trace: OpenAICompatibleProviderRequestTrace,
  operation: string,
): JsonObject {
  return {
    ...createProviderRequestDiagnosticsBase(requestShape, operation),
    contextId: trace.contextId,
    buildReason: trace.buildReason,
    selectedSourceCount: trace.selectedSourceIds.length,
    excludedSourceCount: trace.excludedSourceIds.length,
    truncatedPartCount: trace.truncatedPartIds.length,
    budgetWarningCount: trace.budgetWarningReasons.length,
    messageRoles: body.messages.map((message) => message.role),
    toolDefinitionCount: body.tools?.length ?? 0,
    toolCallCount: body.messages.reduce((count, message) => count + (message.tool_calls?.length ?? 0), 0),
    toolResultCount: body.messages.filter((message) => message.role === 'tool').length,
  };
}

interface OpenAICompatibleCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      reasoning_content?: string | null;
      tool_calls?: OpenAICompatibleToolCall[];
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

async function parseOpenAICompatibleCompletionResponse(response: Response): Promise<{
  content: string;
  reasoningContent?: string;
  toolCalls: OpenAICompatibleToolCall[];
  finishReason?: string;
  usage?: ChatTokenUsagePayload;
}> {
  const body = await response.json() as OpenAICompatibleCompletionResponse;
  const choice = body.choices?.[0];
  const message = choice?.message;
  return {
    content: typeof message?.content === 'string' ? message.content : '',
    ...(typeof message?.reasoning_content === 'string' && message.reasoning_content.length > 0
      ? { reasoningContent: message.reasoning_content }
      : {}),
    toolCalls: message?.tool_calls ?? [],
    ...(choice?.finish_reason ? { finishReason: choice.finish_reason } : {}),
    ...(body.usage ? {
      usage: {
        inputTokens: body.usage.prompt_tokens,
        outputTokens: body.usage.completion_tokens,
        totalTokens: body.usage.total_tokens,
      },
    } : {}),
  };
}

function mapCompletionToolCall(toolCall: OpenAICompatibleToolCall): AiModelStepCompletionToolCall {
  return {
    providerToolCallId: toolCall.id,
    toolName: toolCall.function.name,
    argumentsText: toolCall.function.arguments,
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

function createModelStepToolCallCreated(
  input: AiModelStepAdapterRequest,
  toolCall: OpenAICompatibleToolCallAccumulator & { id: string; name: string },
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

function createModelToolCallDetected(
  input: AiModelStepAdapterRequest,
  toolCall: OpenAICompatibleToolCallAccumulator & { id: string; name: string },
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
  payload: { content: string; finishReason?: string; usage?: ChatTokenUsagePayload },
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

function requestRef(input: AiModelStepAdapterRequest) {
  return {
    requestId: input.request.requestId,
    sessionId: input.request.sessionId,
    providerId: input.request.providerId,
    modelId: input.request.modelId,
    runtimeContext: input.request.runtimeContext,
  };
}

function hasToolResultContinuation(request: ModelStepRuntimeRequest): boolean {
  return request.inputContext.parts.some((part) => part.kind === 'tool_continuation' && part.toolResultId);
}

function failedModelStepEvent(
  input: AiModelStepAdapterRequest,
  code: RuntimeErrorCode,
  createdAt: string,
  diagnostics: JsonObject = {},
  options: { message?: string; retryable?: boolean } = {},
): RuntimeEvent {
  return createRunFailedEvent({
    eventId: input.eventIdFactory(),
    request: requestRef(input),
    runId: input.runId,
    sequence: input.nextSequence(),
    createdAt,
    error: providerRuntimeError(input, code, diagnostics, options),
  });
}

function providerRuntimeError(
  input: AiModelStepAdapterRequest,
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
      modelId: String(input.request.modelId || input.config.defaultModelId),
      ...diagnostics,
    },
  };
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

