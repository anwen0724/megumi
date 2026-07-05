/*
 * Model Call Service public factory.
 * It executes one provider-neutral model call through the packages/ai client.
 */
import type { AiClient, AssistantStreamEvent } from '@megumi/ai';
import type {
  CancelModelCallRequest,
  CancelModelCallResult,
  ModelCallEvent,
  ModelCallFailure,
  ModelCallRequest,
  ModelCallResult,
  ModelCallService,
} from '../contracts/model-call-contracts';
import { mapModelCallToAiRequest } from '../adapters/ai-client-adapter';

export type CreateModelCallServiceOptions = {
  ai_client?: AiClient;
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
    this.activeCalls.set(modelCallId, controller);
    const aiRequest = mapModelCallToAiRequest({
      ...request,
      signal: request.signal ?? controller.signal,
    }, this.options.retry);

    return {
      status: 'started',
      model_call_id: modelCallId,
      events: this.streamModelCallEvents(modelCallId, this.options.ai_client.stream(aiRequest)),
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
    events: AsyncIterable<AssistantStreamEvent>,
  ): AsyncIterable<ModelCallEvent> {
    yield {
      type: 'started',
      model_call_id: modelCallId,
      created_at: this.clock.now(),
    };

    try {
      for await (const event of events) {
        const mapped = mapAssistantStreamEvent(event, modelCallId, this.clock.now());
        if (mapped) {
          yield mapped;
        }
      }
    } finally {
      this.activeCalls.delete(modelCallId);
    }
  }
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

  if (event.type === 'content_block_start' && event.block.type === 'toolCall' && event.block.name) {
    return {
      type: 'tool_call',
      model_call_id: modelCallId,
      tool_call_id: event.block.id ?? `tool-call:${crypto.randomUUID()}`,
      tool_name: event.block.name,
      input: parseToolInput(event.block.argumentsText),
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

function modelCallFailureFromAssistantError(event: Extract<AssistantStreamEvent, { type: 'error' }>): ModelCallFailure {
  return {
    code: 'model_call_failed',
    message: event.message.error?.message ?? 'Model call failed.',
    retryable: event.message.error?.retryable ?? false,
    ...(event.message.error?.details ? { details: event.message.error.details } : {}),
  };
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
