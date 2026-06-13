import type { RuntimeEvent } from '@megumi/shared/runtime';
import { createRunFailedEvent } from '@megumi/shared/runtime';
import type {
  AiModelStepAdapterRequest,
  AiProviderAdapter,
  Clock,
} from '../types';
import { systemClock } from '../types';

export interface AnthropicAdapterOptions {
  clock?: Clock;
}

export function createAnthropicAdapter(options: AnthropicAdapterOptions = {}): AiProviderAdapter {
  const clock = options.clock ?? systemClock;

  return {
    providerId: 'anthropic',
    async *streamModelStep(input: AiModelStepAdapterRequest): AsyncIterable<RuntimeEvent> {
      yield createRunFailedEvent({
        eventId: input.eventIdFactory(),
        request: {
          requestId: input.request.requestId,
          sessionId: input.request.sessionId,
          providerId: input.request.providerId,
          modelId: input.request.modelId,
          runtimeContext: input.request.runtimeContext,
        },
        runId: input.runId,
        sequence: input.nextSequence(),
        createdAt: clock.now(),
        error: {
          code: 'provider_unsupported',
          message: 'Anthropic provider is not implemented yet.',
          severity: 'warning',
          retryable: false,
          source: 'provider',
          details: {
            providerId: 'anthropic',
          },
        },
      });
    },
    async completeModelStep(input: AiModelStepAdapterRequest) {
      return {
        ok: false,
        error: {
          code: 'provider_unsupported',
          message: 'Anthropic provider is not implemented yet.',
          severity: 'warning',
          retryable: false,
          source: 'provider',
          details: {
            providerId: input.config.providerId,
          },
        },
      };
    },
  };
}

