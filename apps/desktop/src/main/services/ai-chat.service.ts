import type { ChatRuntimeRequest } from '@megumi/shared/chat-contracts';
import type { ProviderId } from '@megumi/shared/provider-contracts';
import type { RuntimeError, RuntimeErrorCode } from '@megumi/shared/runtime-errors';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';
import { createRunFailedEvent } from '@megumi/core/chat/events';
import { runChatTurn } from '@megumi/core/chat/run-chat-turn';
import type { AiPort } from '@megumi/core/ports/ai-port';
import type { ChatRuntimeClock } from '@megumi/core/chat/types';
import type {
  AiProviderAdapter,
  ProviderRuntimeConfig,
} from '@megumi/ai/types';
import { createAiProviderRegistry } from '@megumi/ai/registry';
import { ProviderRuntimeResolutionError } from './provider-runtime.service';

export interface AiChatRuntimeResolverPort {
  resolveProviderRuntimeConfig(input: {
    providerId: ProviderId;
    modelId?: string;
  }): Promise<ProviderRuntimeConfig>;
}

export interface AiChatProviderRegistryPort {
  getAdapter(providerId: ProviderId): AiProviderAdapter;
}

export interface AiChatServiceOptions {
  resolver: AiChatRuntimeResolverPort;
  registry: AiChatProviderRegistryPort;
  runIdFactory?: () => string;
  clock?: ChatRuntimeClock;
}

export class AiChatService {
  private readonly activeRequests = new Map<string, AbortController>();

  constructor(private readonly options: AiChatServiceOptions) {}

  async *streamChat(request: ChatRuntimeRequest): AsyncIterable<RuntimeEvent> {
    const controller = new AbortController();
    const runId = this.options.runIdFactory?.() ?? `run:${request.requestId}`;
    const clock = this.options.clock ?? { now: () => new Date().toISOString() };
    const eventIdFactory = () => {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `event:${crypto.randomUUID()}`;
      }

      return `event:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    };

    this.activeRequests.set(request.requestId, controller);

    try {
      const config = await this.options.resolver.resolveProviderRuntimeConfig({
        providerId: request.providerId,
        modelId: String(request.modelId),
      });
      const adapter = this.options.registry.getAdapter(config.providerId);
      const aiPort: AiPort = {
        streamChat: (input) => adapter.streamChat({
          request: input.request,
          runId: input.runId,
          config,
          signal: input.signal,
          nextSequence: input.nextSequence,
          eventIdFactory: input.eventIdFactory,
        }),
      };

      for await (const event of runChatTurn({
        request,
        aiPort,
        signal: controller.signal,
        runIdFactory: () => runId,
        eventIdFactory,
        clock,
      })) {
        yield event;
      }
    } catch (error) {
      yield createRunFailedEvent({
        eventId: eventIdFactory(),
        request,
        runId,
        sequence: 1,
        createdAt: clock.now(),
        error: toRuntimeError(error, request),
      });
    } finally {
      this.activeRequests.delete(request.requestId);
    }
  }

  cancelChat(requestId: string): boolean {
    const controller = this.activeRequests.get(requestId);

    if (!controller) {
      return false;
    }

    controller.abort();
    return true;
  }
}

function toRuntimeError(error: unknown, request: ChatRuntimeRequest): RuntimeError {
  if (error instanceof ProviderRuntimeResolutionError) {
    return {
      code: mapProviderResolutionErrorCode(error.payload.code),
      message: error.payload.message,
      severity: 'error',
      retryable: error.payload.retryable,
      source: 'provider',
      details: {
        providerId: request.providerId,
        modelId: String(request.modelId),
      },
    };
  }

  return {
    code: 'runtime_unknown',
    message: 'Chat service failed.',
    severity: 'error',
    retryable: false,
    source: 'main',
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
    case 'missing_provider_settings':
      return 'provider_disabled';
    case 'request_cancelled':
      return 'runtime_cancelled';
    case 'provider_disabled':
    case 'provider_missing_api_key':
    case 'provider_auth_failed':
    case 'provider_rate_limited':
    case 'provider_network_error':
      return code;
    default:
      return 'runtime_unknown';
  }
}

export function createAiChatService(resolver: AiChatRuntimeResolverPort): AiChatService {
  return new AiChatService({
    resolver,
    registry: createAiProviderRegistry(),
  });
}
