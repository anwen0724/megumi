/*
 * Executes one resolved model call through the new AI Provider stream and projects its events.
 */
import type {
  Api,
  AssistantMessageEvent,
  Model,
  Provider,
} from '@megumi/ai';
import type {
  CancelModelCallRequest,
  CancelModelCallResult,
  ModelCallConfig,
  ModelCallEvent,
  ModelCallFailure,
  ModelCallRequest,
  ModelCallResult,
  ModelCallService,
} from '../contracts/model-call-contracts';

export type ResolvedModelRuntime = {
  provider: Provider;
  model: Model<Api>;
};

export type CreateModelCallServiceOptions = {
  resolve_model_runtime?(config: ModelCallConfig): ResolvedModelRuntime;
  ids?: { model_call_id(): string };
  clock?: { now(): string };
  retry?: { max_retries?: number; max_retry_delay_ms?: number };
};

export function createModelCallService(options: CreateModelCallServiceOptions = {}): ModelCallService {
  return new DefaultModelCallService(options);
}

class DefaultModelCallService implements ModelCallService {
  private readonly activeCalls = new Map<string, AbortController>();
  private readonly ids: Required<NonNullable<CreateModelCallServiceOptions['ids']>>;
  private readonly clock: Required<NonNullable<CreateModelCallServiceOptions['clock']>>;

  constructor(private readonly options: CreateModelCallServiceOptions) {
    this.ids = { model_call_id: options.ids?.model_call_id ?? (() => `model-call:${crypto.randomUUID()}`) };
    this.clock = { now: options.clock?.now ?? (() => new Date().toISOString()) };
  }

  modelCall(request: ModelCallRequest): ModelCallResult {
    if (!this.options.resolve_model_runtime) {
      return { status: 'failed', failure: configurationFailure('Model Call Service requires a model runtime resolver.') };
    }

    let runtime: ResolvedModelRuntime;
    try {
      runtime = this.options.resolve_model_runtime(request.model_config);
    } catch (error) {
      return { status: 'failed', failure: configurationFailure(messageOf(error)) };
    }

    const modelCallId = this.ids.model_call_id();
    const controller = new AbortController();
    const signal = request.signal ? AbortSignal.any([controller.signal, request.signal]) : controller.signal;
    this.activeCalls.set(modelCallId, controller);
    return {
      status: 'started',
      model_call_id: modelCallId,
      events: this.streamModelCallEvents(modelCallId, request, runtime, signal),
    };
  }

  cancelModelCall(request: CancelModelCallRequest): CancelModelCallResult {
    const controller = this.activeCalls.get(request.model_call_id);
    if (!controller) return { status: 'not_cancellable', model_call_id: request.model_call_id };
    controller.abort();
    this.activeCalls.delete(request.model_call_id);
    return { status: 'cancelled', model_call_id: request.model_call_id };
  }

  private async *streamModelCallEvents(
    modelCallId: string,
    request: ModelCallRequest,
    runtime: ResolvedModelRuntime,
    signal: AbortSignal,
  ): AsyncIterable<ModelCallEvent> {
    const maxRetries = this.options.retry?.max_retries ?? 0;
    const maxAttempts = maxRetries + 1;
    yield { type: 'started', model_call_id: modelCallId, created_at: this.clock.now() };

    try {
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        let failure: ModelCallFailure | undefined;
        const stream = runtime.provider.streamSimple(runtime.model, request.context, {
          ...(request.model_config.api_key ? { apiKey: request.model_config.api_key } : {}),
          ...(request.owner.type === 'agent_run' ? { sessionId: request.owner.run_id } : { sessionId: request.owner.session_id }),
          signal,
        });
        try {
          for await (const event of stream) {
            const projected = projectEvent(event, modelCallId, this.clock.now());
            if (!projected) continue;
            if (projected.type === 'failed') {
              failure = projected.failure;
              break;
            }
            yield projected;
          }
        } catch (error) {
          failure = {
            code: 'model_call_failed',
            message: messageOf(error),
            retryable: !signal.aborted,
          };
        }

        if (!failure) return;
        if (!failure.retryable || attempt >= maxAttempts || signal.aborted) {
          yield { type: 'failed', model_call_id: modelCallId, failure, created_at: this.clock.now() };
          return;
        }
        const retryAfterMs = retryDelayMs(attempt, this.options.retry?.max_retry_delay_ms);
        yield {
          type: 'retrying',
          model_call_id: modelCallId,
          attempt,
          max_attempts: maxAttempts,
          failure,
          retry_after_ms: retryAfterMs,
          created_at: this.clock.now(),
        };
        await sleep(retryAfterMs, signal);
      }
    } finally {
      this.activeCalls.delete(modelCallId);
    }
  }
}

function projectEvent(
  event: AssistantMessageEvent,
  modelCallId: string,
  createdAt: string,
): ModelCallEvent | undefined {
  if (event.type === 'text_delta') {
    return { type: 'text_delta', model_call_id: modelCallId, delta: event.delta, created_at: createdAt };
  }
  if (event.type === 'thinking_start') {
    return { type: 'thinking_started', model_call_id: modelCallId, created_at: createdAt };
  }
  if (event.type === 'thinking_delta') {
    return { type: 'thinking_delta', model_call_id: modelCallId, delta: event.delta, created_at: createdAt };
  }
  if (event.type === 'thinking_end') {
    return { type: 'thinking_completed', model_call_id: modelCallId, created_at: createdAt };
  }
  if (event.type === 'toolcall_end') {
    const argumentsText = JSON.stringify(event.toolCall.arguments);
    return {
      type: 'tool_call',
      model_call_id: modelCallId,
      tool_call_id: event.toolCall.id,
      tool_name: event.toolCall.name,
      input: event.toolCall.arguments,
      arguments_text: argumentsText,
      created_at: createdAt,
    };
  }
  if (event.type === 'done') {
    return {
      type: 'completed',
      model_call_id: modelCallId,
      content: event.message.content.filter((block) => block.type === 'text').map((block) => block.text).join(''),
      finish_reason: event.message.stopReason,
      usage: {
        input_tokens: event.message.usage.input,
        output_tokens: event.message.usage.output,
        total_tokens: event.message.usage.totalTokens,
      },
      assistant_message: event.message,
      created_at: createdAt,
    };
  }
  if (event.type === 'error') {
    return {
      type: 'failed',
      model_call_id: modelCallId,
      failure: {
        code: 'model_call_failed',
        message: event.error.errorMessage ?? (event.reason === 'aborted' ? 'Model call was cancelled.' : 'Model call failed.'),
        retryable: event.reason !== 'aborted',
      },
      created_at: createdAt,
    };
  }
  return undefined;
}

function configurationFailure(message: string): ModelCallFailure {
  return { code: 'model_call_failed', message, retryable: false };
}

function retryDelayMs(attempt: number, maxRetryDelayMs: number | undefined): number {
  return Math.min(100 * (2 ** Math.max(0, attempt - 1)), maxRetryDelayMs ?? 1_000);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0 || signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(timeout); resolve(); }, { once: true });
  });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Model call failed.';
}
