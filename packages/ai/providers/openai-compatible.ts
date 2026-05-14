import type { ChatTokenUsage } from '@megumi/shared/chat-contracts';
import type { RuntimeErrorCode } from '@megumi/shared/runtime-errors';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';
import {
  createAssistantCompletedEvent,
  createAssistantDeltaEvent,
  createRunCancelledEvent,
  createRunFailedEvent,
} from '@megumi/shared/runtime-event-factory';
import { mapToOpenAICompatibleMessages } from '../prompt/message-mapper';
import { parseOpenAICompatibleSseStream } from '../stream';
import {
  type AiChatAdapterRequest,
  type AiProviderAdapter,
  type OpenAICompatibleAdapterOptions,
  systemClock,
} from '../types';

export function createOpenAICompatibleAdapter(options: OpenAICompatibleAdapterOptions): AiProviderAdapter {
  const clock = options.clock ?? systemClock;

  return {
    providerId: options.providerId,
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
          } else {
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
