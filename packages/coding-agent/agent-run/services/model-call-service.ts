/*
 * Model Call Service public factory.
 * It executes one provider-neutral model call through the packages/ai client.
 */
import type {
  AiCallRequest,
  AiClient,
  AssistantStreamEvent,
  RequestTokenCounter,
} from '@megumi/ai';
import type {
  CancelModelCallRequest,
  CancelModelCallResult,
  CountPromptRequest,
  CountPromptResult,
  ModelCallEvent,
  ModelCallFailure,
  ModelCallRequest,
  ModelCallResult,
  ModelCallService,
} from '../contracts/model-call-contracts';
import {
  mapModelCallToAiRequest,
  mapPromptToAiRequest,
  PromptMaterializationError,
  UnsupportedModelContentError,
} from '../adapters/ai-client-adapter';

export type CreateModelCallServiceOptions = {
  ai_client?: AiClient;
  request_token_counter?: RequestTokenCounter;
  ids?: {
    model_call_id(): string;
  };
  clock?: {
    now(): string;
  };
  retry?: {
    max_retries?: number;
    max_retry_delay_ms?: number;
  };
};

export function createModelCallService(options: CreateModelCallServiceOptions = {}): ModelCallService {
  return new DefaultModelCallService(options);
}

class DefaultModelCallService implements ModelCallService {
  private readonly activeCalls = new Map<string, AbortController>();
  private readonly ids: Required<NonNullable<CreateModelCallServiceOptions['ids']>>;
  private readonly clock: Required<NonNullable<CreateModelCallServiceOptions['clock']>>;

  constructor(private readonly options: CreateModelCallServiceOptions) {
    this.ids = {
      model_call_id: options.ids?.model_call_id ?? (() => `model-call:${crypto.randomUUID()}`),
    };
    this.clock = {
      now: options.clock?.now ?? (() => new Date().toISOString()),
    };
  }

  async countPrompt(request: CountPromptRequest): Promise<CountPromptResult> {
    let aiRequest: AiCallRequest;
    try {
      aiRequest = mapPromptToAiRequest(request);
    } catch (error) {
      return { status: 'failed', failure: modelCallMappingFailure(error) };
    }

    if (!this.options.request_token_counter) {
      return {
        status: 'failed',
        failure: {
          code: 'model_call_failed',
          message: 'Model Call Service requires a request token counter.',
          retryable: false,
        },
      };
    }

    try {
      const count = await this.options.request_token_counter.count(aiRequest);
      return {
        status: 'counted',
        input_tokens: count.inputTokens,
        accuracy: count.accuracy,
      };
    } catch (error) {
      return {
        status: 'failed',
        failure: {
          code: 'model_call_failed',
          message: error instanceof Error ? error.message : 'Request token counting failed.',
          retryable: false,
        },
      };
    }
  }

  modelCall(request: ModelCallRequest): ModelCallResult {
    if (!this.options.ai_client) {
      return {
        status: 'failed',
        failure: {
          code: 'model_call_failed',
          message: 'Model Call Service requires an AI client.',
          retryable: false,
        },
      };
    }

    const modelCallId = this.ids.model_call_id();
    const controller = new AbortController();
    let aiRequest: AiCallRequest;
    try {
      aiRequest = mapModelCallToAiRequest({
        ...request,
        signal: request.signal ?? controller.signal,
      });
    } catch (error) {
      return { status: 'failed', failure: modelCallMappingFailure(error) };
    }
    this.activeCalls.set(modelCallId, controller);

    return {
      status: 'started',
      model_call_id: modelCallId,
      events: this.streamModelCallEvents(modelCallId, aiRequest),
    };
  }

  cancelModelCall(request: CancelModelCallRequest): CancelModelCallResult {
    const controller = this.activeCalls.get(request.model_call_id);
    if (!controller) {
      return { status: 'not_cancellable', model_call_id: request.model_call_id };
    }

    controller.abort();
    this.activeCalls.delete(request.model_call_id);
    return { status: 'cancelled', model_call_id: request.model_call_id };
  }

  private async *streamModelCallEvents(
    modelCallId: string,
    aiRequest: AiCallRequest,
  ): AsyncIterable<ModelCallEvent> {
    const maxRetries = this.options.retry?.max_retries ?? 0;
    const maxAttempts = maxRetries + 1;
    yield {
      type: 'started',
      model_call_id: modelCallId,
      created_at: this.clock.now(),
    };

    try {
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        let attemptFailure: ModelCallFailure | undefined;

        for await (const event of this.streamSingleAttempt(modelCallId, aiRequest)) {
          if (event.type === 'attempt_failed') {
            attemptFailure = event.failure;
            break;
          }
          yield event;
        }

        if (!attemptFailure) {
          return;
        }

        if (!attemptFailure.retryable || attempt >= maxAttempts || aiRequest.signal?.aborted) {
          yield failedModelCallEvent(modelCallId, attemptFailure, this.clock.now());
          return;
        }

        const retryAfterMs = retryDelayMs(attempt, this.options.retry?.max_retry_delay_ms);
        yield {
          type: 'retrying',
          model_call_id: modelCallId,
          attempt,
          max_attempts: maxAttempts,
          failure: attemptFailure,
          retry_after_ms: retryAfterMs,
          created_at: this.clock.now(),
        };
        await sleep(retryAfterMs, aiRequest.signal);
      }
    } finally {
      this.activeCalls.delete(modelCallId);
    }
  }

  private async *streamSingleAttempt(
    modelCallId: string,
    aiRequest: AiCallRequest,
  ): AsyncIterable<ModelCallAttemptEvent> {
    const toolCalls = new Map<number, ToolCallAccumulator>();
    const emittedToolCallIds = new Set<string>();

    try {
      for await (const event of this.options.ai_client!.stream(aiRequest)) {
        if (event.type === 'content_block_start' && event.block.type === 'thinking') {
          yield {
            type: 'thinking_started',
            model_call_id: modelCallId,
            created_at: this.clock.now(),
          };
          continue;
        }

        if (event.type === 'content_block_delta' && event.delta.type === 'thinking_delta') {
          yield {
            type: 'thinking_delta',
            model_call_id: modelCallId,
            delta: event.delta.thinking,
            created_at: this.clock.now(),
          };
          continue;
        }

        if (event.type === 'content_block_end' && event.block.type === 'thinking') {
          yield {
            type: 'thinking_completed',
            model_call_id: modelCallId,
            created_at: this.clock.now(),
          };
          continue;
        }

        if (event.type === 'content_block_start' && event.block.type === 'toolCall') {
          toolCalls.set(event.index, {
            id: event.block.id,
            name: event.block.name,
            argumentsText: event.block.argumentsText ?? '',
          });
          continue;
        }

        if (event.type === 'content_block_delta' && event.delta.type === 'tool_call_delta') {
          const current = toolCalls.get(event.index) ?? { argumentsText: '' };
          toolCalls.set(event.index, {
            id: event.delta.id ?? current.id,
            name: event.delta.name ?? current.name,
            argumentsText: `${current.argumentsText}${event.delta.argumentsTextDelta ?? ''}`,
          });
          continue;
        }

        if (event.type === 'content_block_end' && event.block.type === 'toolCall') {
          const current = toolCalls.get(event.index);
          const mapped = toolCallEventFromContentBlock({
            id: event.block.id ?? current?.id,
            name: event.block.name ?? current?.name,
            argumentsText: event.block.argumentsText ?? current?.argumentsText ?? '',
          }, modelCallId, this.clock.now());
          if (mapped) {
            yield mapped;
            emittedToolCallIds.add(mapped.tool_call_id);
          }
          toolCalls.delete(event.index);
          continue;
        }

        if (event.type === 'message_end') {
          for (const block of event.message.content) {
            if (block.type !== 'toolCall' || emittedToolCallIds.has(block.id)) {
              continue;
            }
            const mapped = toolCallEventFromContentBlock(block, modelCallId, this.clock.now());
            if (mapped) {
              yield mapped;
              emittedToolCallIds.add(mapped.tool_call_id);
            }
          }
        }

        const mapped = mapAssistantStreamEvent(event, modelCallId, this.clock.now());
        if (!mapped) {
          continue;
        }
        if (mapped.type === 'failed') {
          yield { type: 'attempt_failed', failure: mapped.failure };
          return;
        }
        yield mapped;
      }
    } catch (error) {
      yield {
        type: 'attempt_failed',
        failure: {
          code: 'model_call_failed',
          message: error instanceof Error ? error.message : 'Model call stream failed.',
          retryable: !aiRequest.signal?.aborted,
        },
      };
    }
  }
}

function modelCallMappingFailure(error: unknown): ModelCallFailure {
  if (error instanceof UnsupportedModelContentError) {
    return {
      code: 'unsupported_content',
      message: error.message,
      retryable: false,
      details: { contentType: error.contentType },
    };
  }

  if (error instanceof PromptMaterializationError) {
    return {
      code: 'model_call_failed',
      message: error.message,
      retryable: false,
      details: { reason: error.reason },
    };
  }

  return {
    code: 'internal_error',
    message: error instanceof Error ? error.message : 'Prompt materialization failed.',
    retryable: false,
  };
}

function mapAssistantStreamEvent(
  event: AssistantStreamEvent,
  modelCallId: string,
  createdAt: string,
): ModelCallEvent | undefined {
  if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
    return {
      type: 'text_delta',
      model_call_id: modelCallId,
      delta: event.delta.text,
      created_at: createdAt,
    };
  }

  if (event.type === 'message_end') {
    return {
      type: 'completed',
      model_call_id: modelCallId,
      content: event.message.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join(''),
      ...(event.message.stopReason ? { finish_reason: event.message.stopReason } : {}),
      ...(event.message.usage ? {
        usage: {
          input_tokens: event.message.usage.inputTokens,
          output_tokens: event.message.usage.outputTokens,
          total_tokens: event.message.usage.totalTokens,
        },
      } : {}),
      created_at: createdAt,
    };
  }

  if (event.type === 'error') {
    return {
      type: 'failed',
      model_call_id: modelCallId,
      failure: modelCallFailureFromAssistantError(event),
      created_at: createdAt,
    };
  }

  return undefined;
}

type ToolCallAccumulator = {
  id?: string;
  name?: string;
  argumentsText: string;
};

type ModelCallAttemptEvent =
  | ModelCallEvent
  | {
      type: 'attempt_failed';
      failure: ModelCallFailure;
    };

function toolCallEventFromContentBlock(
  block: { id?: string; name?: string; argumentsText?: string },
  modelCallId: string,
  createdAt: string,
): Extract<ModelCallEvent, { type: 'tool_call' }> | undefined {
  if (!block.name) {
    return undefined;
  }
  const argumentsText = block.argumentsText ?? '';
  return {
    type: 'tool_call',
    model_call_id: modelCallId,
    tool_call_id: block.id ?? `tool-call:${crypto.randomUUID()}`,
    tool_name: block.name,
    input: parseToolInput(argumentsText),
    arguments_text: argumentsText,
    created_at: createdAt,
  };
}

function modelCallFailureFromAssistantError(event: Extract<AssistantStreamEvent, { type: 'error' }>): ModelCallFailure {
  return {
    code: 'model_call_failed',
    message: event.message.error?.message ?? 'Model call failed.',
    retryable: event.message.error?.retryable ?? false,
    ...(event.message.error?.details ? { details: event.message.error.details } : {}),
  };
}

function failedModelCallEvent(
  modelCallId: string,
  failure: ModelCallFailure,
  createdAt: string,
): ModelCallEvent {
  return {
    type: 'failed',
    model_call_id: modelCallId,
    failure,
    created_at: createdAt,
  };
}

function retryDelayMs(attempt: number, maxRetryDelayMs: number | undefined): number {
  const capped = maxRetryDelayMs ?? 1000;
  return Math.min(100 * (2 ** Math.max(0, attempt - 1)), capped);
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (ms <= 0 || signal?.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
  });
}

function parseToolInput(argumentsText: string | undefined): unknown {
  if (!argumentsText) {
    return {};
  }

  try {
    return JSON.parse(argumentsText) as unknown;
  } catch {
    return argumentsText;
  }
}
