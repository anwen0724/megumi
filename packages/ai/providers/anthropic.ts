import type { ChatRuntimeRequest } from '@megumi/shared/chat-contracts';
import type { ModelStepRuntimeRequest } from '@megumi/shared/model-step-contracts';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';
import { createRunFailedEvent } from '@megumi/shared/runtime-event-factory';
import type {
  AiChatAdapterRequest,
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
        request: toChatRuntimeRequest(input.request),
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
    async *streamChat(input: AiChatAdapterRequest): AsyncIterable<RuntimeEvent> {
      yield createRunFailedEvent({
        eventId: input.eventIdFactory(),
        request: input.request,
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
  };
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
