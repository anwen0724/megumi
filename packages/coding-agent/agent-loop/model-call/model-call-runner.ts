// Runs Coding Agent model calls through an injected provider-neutral AI client.
import type { AssistantContentBlock } from '@megumi/ai';
import type { ModelStepRuntimeRequest } from '@megumi/shared/model';
import type { JsonObject } from '@megumi/shared/primitives';
import { JsonObjectSchema, JsonValueSchema } from '@megumi/shared/primitives/json';
import type { RunAction, RunObservation, RunStep } from '@megumi/shared/session';
import {
  createRunCancelledEvent,
  createRunFailedEvent,
  type RuntimeError,
  type RuntimeErrorCode,
  type RuntimeEvent,
} from '@megumi/shared/runtime';
import { ProviderRuntimeResolutionError } from '../../settings';
import { normalizeRuntimeError } from '../../state';
import { mapModelCallToAiInput } from './model-call-request-mapper';
import { streamModelCall } from './model-call-stream';
import type {
  ModelCallAiClientFactory,
  ModelCallCompletionResult,
  ModelCallPort,
  ProviderRuntimeConfig,
  ModelCallRuntimeResolverPort,
} from './model-call-contract';

export interface CreateModelCallInputPreviewInput {
  providerId?: string;
  modelId?: string;
  goal: string;
}

export function createModelCallInputPreview(input: CreateModelCallInputPreviewInput): JsonObject {
  return {
    stepKind: 'model',
    goal: input.goal,
    ...(input.providerId ? { providerId: input.providerId } : {}),
    ...(input.modelId ? { modelId: input.modelId } : {}),
  };
}

export function isModelStep(step: Pick<RunStep, 'kind'>): boolean {
  return step.kind === 'model';
}

export function isModelMessageAction(action: Pick<RunAction, 'kind'>): boolean {
  return action.kind === 'emit_message';
}

export function createModelMessageObservation(input: {
  observationId: string;
  runId: string;
  stepId: string;
  actionId: string;
  receivedAt: string;
  summary?: string;
  metadata?: JsonObject;
}): RunObservation {
  return {
    observationId: input.observationId,
    runId: input.runId,
    stepId: input.stepId,
    actionId: input.actionId,
    source: 'runtime',
    kind: 'message_emitted',
    receivedAt: input.receivedAt,
    summary: input.summary ?? 'Model step emitted a message.',
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}

export interface RunModelCallInput {
  request: ModelStepRuntimeRequest;
  modelCallPort: ModelCallPort;
  signal?: AbortSignal;
  eventIdFactory?: () => string;
}

export async function* runModelCall(input: RunModelCallInput): AsyncIterable<RuntimeEvent> {
  let sequence = 0;
  const nextSequence = () => {
    sequence += 1;
    return sequence;
  };
  const eventIdFactory = input.eventIdFactory ?? (() => `event:${crypto.randomUUID()}`);

  if (input.signal?.aborted) {
    yield createRunCancelledEvent({
      eventId: eventIdFactory(),
      request: {
        requestId: input.request.requestId,
        sessionId: input.request.sessionId,
        providerId: input.request.providerId,
        modelId: input.request.modelId,
        runtimeContext: input.request.runtimeContext,
      },
      runId: input.request.runId,
      sequence: nextSequence(),
      reason: 'Model step request was cancelled before it started.',
      createdAt: new Date().toISOString(),
    });
    return;
  }

  try {
    for await (const event of input.modelCallPort.streamModelCall({
      request: input.request,
      runId: input.request.runId,
      stepId: input.request.stepId,
      signal: input.signal,
      nextSequence,
      eventIdFactory,
    })) {
      yield event;
    }
  } catch (error) {
    yield createRunFailedEvent({
      eventId: eventIdFactory(),
      request: {
        requestId: input.request.requestId,
        sessionId: input.request.sessionId,
        providerId: input.request.providerId,
        modelId: input.request.modelId,
        runtimeContext: input.request.runtimeContext,
      },
      runId: input.request.runId,
      sequence: nextSequence(),
      createdAt: new Date().toISOString(),
      error: normalizeRuntimeError(error, {
        source: 'core',
        debugId: input.request.runtimeContext?.debugId ?? `debug:${input.request.requestId}`,
        fallbackMessage: 'Model step streaming failed.',
      }),
    });
  }
}

export interface ModelCallRunnerOptions {
  resolver: ModelCallRuntimeResolverPort;
  aiClientFactory: ModelCallAiClientFactory;
}

export class ModelCallRunner {
  private readonly activeRequests = new Map<string, AbortController>();

  constructor(private readonly options: ModelCallRunnerOptions) {}

  async *streamModelCall(request: ModelStepRuntimeRequest): AsyncIterable<RuntimeEvent> {
    const controller = new AbortController();
    let sequence = 0;
    const nextSequence = () => {
      sequence += 1;
      return sequence;
    };
    this.activeRequests.set(request.requestId, controller);

    try {
      const config = await this.resolveRuntimeConfig(request);
      const aiClient = this.options.aiClientFactory({ config });

      yield* streamModelCall({
        request: {
          request,
          runId: request.runId,
          stepId: request.stepId,
          config,
          aiClient,
          signal: controller.signal,
          nextSequence,
          eventIdFactory: () => `event:${crypto.randomUUID()}`,
        },
      });
    } catch (error) {
      yield createRunFailedEvent({
        eventId: `event:${crypto.randomUUID()}`,
        request: requestRef(request),
        runId: request.runId,
        sequence: nextSequence(),
        createdAt: new Date().toISOString(),
        error: toRuntimeError(error, request),
      });
    } finally {
      this.activeRequests.delete(request.requestId);
    }
  }

  async completeModelCall(request: ModelStepRuntimeRequest): Promise<ModelCallCompletionResult> {
    const controller = new AbortController();
    this.activeRequests.set(request.requestId, controller);

    try {
      const config = await this.resolveRuntimeConfig(request);
      const aiClient = this.options.aiClientFactory({ config });
      const aiInput = mapModelCallToAiInput({ request, config });
      const message = await aiClient.complete({
        model: aiInput.model,
        context: aiInput.context,
        toolSet: aiInput.toolSet,
        structuredOutput: aiInput.structuredOutput,
        signal: controller.signal,
        credential: { type: 'api_key', value: config.apiKey },
      });

      if (message.error) {
        return {
          ok: false,
          error: {
            code: mapProviderErrorCode(message.error.code),
            message: message.error.message,
            severity: 'error',
            retryable: message.error.retryable,
            source: 'provider',
            details: jsonObjectFromUnknown(message.error.details),
          },
        };
      }

      const toolCalls = message.content
        .filter((block) => block.type === 'toolCall')
        .map((block) => ({
          providerToolCallId: block.id,
          toolName: block.name,
          argumentsText: block.argumentsText,
        }));
      const text = message.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('');
      const structuredOutputTarget = request.structuredOutput;
      const structuredOutput = structuredOutputTarget
        ? parseStructuredOutput(text)
        : undefined;
      if (structuredOutput && !structuredOutput.ok) {
        return {
          ok: false,
          error: {
            code: 'runtime_protocol_violation',
            message: structuredOutput.message,
            severity: 'error',
            retryable: false,
            source: 'provider',
            details: {
              providerId: request.providerId,
              modelId: String(request.modelId),
              structuredOutputName: structuredOutputTarget?.name ?? 'structured_output',
            },
          },
        };
      }

      return {
        ok: true,
        text,
        ...(structuredOutput?.ok ? { structuredOutput: structuredOutput.value } : {}),
        ...(message.stopReason ? { finishReason: message.stopReason } : {}),
        ...(message.usage ? {
          usage: {
            inputTokens: message.usage.inputTokens,
            outputTokens: message.usage.outputTokens,
            totalTokens: message.usage.totalTokens,
          },
        } : {}),
        ...(providerStatesFromThinkingBlocks(request, config, message.content).length > 0 ? {
          providerStates: providerStatesFromThinkingBlocks(request, config, message.content),
        } : {}),
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      };
    } catch (error) {
      return {
        ok: false,
        error: toRuntimeError(error, request),
      };
    } finally {
      this.activeRequests.delete(request.requestId);
    }
  }

  cancelModelCall(requestId: string): boolean {
    const controller = this.activeRequests.get(requestId);

    if (!controller) {
      return false;
    }

    controller.abort();
    return true;
  }

  private resolveRuntimeConfig(request: ModelStepRuntimeRequest): Promise<ProviderRuntimeConfig> {
    return this.options.resolver.resolveProviderRuntimeConfig({
      providerId: request.providerId,
      modelId: String(request.modelId),
      runtimeContext: request.runtimeContext,
    });
  }
}

export function createModelCallRunner(input: ModelCallRunnerOptions): ModelCallRunner {
  return new ModelCallRunner(input);
}

function parseStructuredOutput(text: string):
  | { ok: true; value: ReturnType<typeof JsonValueSchema.parse> }
  | { ok: false; message: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, message: 'Structured model output was not valid JSON.' };
  }
  const result = JsonValueSchema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, message: 'Structured model output was not a valid JSON value.' };
  }
  return { ok: true, value: result.data };
}

function providerStatesFromThinkingBlocks(
  request: ModelStepRuntimeRequest,
  config: ProviderRuntimeConfig,
  blocks: AssistantContentBlock[],
) {
  const thinking = blocks
    .filter((block) => block.type === 'thinking')
    .map((block) => block.thinking)
    .join('');

  if (thinking.length === 0) {
    return [];
  }

  return [{
    modelStepId: String(request.modelStepId ?? request.stepId),
    providerId: config.providerId,
    modelId: String(request.modelId || config.defaultModelId),
    blocks: [{
      type: 'thinking' as const,
      text: thinking,
    }],
  }];
}

function toRuntimeError(error: unknown, request: ModelStepRuntimeRequest): RuntimeError {
  if (error instanceof ProviderRuntimeResolutionError) {
    return {
      code: mapProviderResolutionErrorCode(error.payload.code),
      message: error.payload.message,
      severity: 'error',
      retryable: error.payload.retryable,
      source: 'provider',
      ...(error.payload.debugId ? { debugId: error.payload.debugId } : {}),
      details: {
        providerId: request.providerId,
        modelId: String(request.modelId),
      },
    };
  }

  return {
    ...normalizeRuntimeError(error, {
      source: 'main',
      debugId: request.runtimeContext?.debugId ?? `debug:${request.requestId}`,
      fallbackMessage: 'Model call runner failed.',
    }),
    details: {
      providerId: request.providerId,
      modelId: String(request.modelId),
    },
  };
}

function mapProviderResolutionErrorCode(code: string): RuntimeErrorCode {
  switch (code) {
    case 'missing_api_key':
      return 'provider_missing_api_key';
    case 'unsupported_provider':
      return 'provider_unsupported';
    case 'invalid_provider_config':
      return 'config_invalid';
    case 'request_cancelled':
      return 'runtime_cancelled';
    case 'provider_disabled':
    case 'provider_missing_api_key':
    case 'provider_auth_failed':
    case 'provider_rate_limited':
    case 'provider_invalid_request':
    case 'provider_network_error':
      return code;
    default:
      return 'runtime_unknown';
  }
}

function mapProviderErrorCode(code: string): RuntimeErrorCode {
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

function jsonObjectFromUnknown(value: unknown) {
  const parsed = JsonObjectSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : {};
}

function requestRef(request: ModelStepRuntimeRequest) {
  return {
    requestId: request.requestId,
    sessionId: request.sessionId,
    providerId: request.providerId,
    modelId: request.modelId,
    runtimeContext: request.runtimeContext,
  };
}
