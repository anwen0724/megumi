import type { ChatRuntimeRequest } from '@megumi/shared/chat-contracts';
import type { ModelStepRuntimeRequest } from '@megumi/shared/model-step-contracts';
import type { ProviderId } from '@megumi/shared/provider-contracts';
import type { RuntimeContext } from '@megumi/shared/runtime-context';
import type { RuntimeError, RuntimeErrorCode } from '@megumi/shared/runtime-errors';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';
import { createRunFailedEvent } from '@megumi/shared/runtime-event-factory';
import { normalizeRuntimeError } from '@megumi/core/runtime-exception';
import type {
  AiProviderAdapter,
  ProviderRuntimeConfig,
} from '@megumi/ai/types';
import { createAiProviderRegistry } from '@megumi/ai/registry';
import { ProviderRuntimeResolutionError } from './provider-runtime.service';

export interface ModelStepRuntimeResolverPort {
  resolveProviderRuntimeConfig(input: {
    providerId: ProviderId;
    modelId?: string;
    runtimeContext?: RuntimeContext;
  }): Promise<ProviderRuntimeConfig>;
}

export interface ModelStepProviderRegistryPort {
  getAdapter(providerId: ProviderId): AiProviderAdapter;
}

export interface ModelStepProviderServiceOptions {
  resolver: ModelStepRuntimeResolverPort;
  registry: ModelStepProviderRegistryPort;
}

export class ModelStepProviderService {
  private readonly activeRequests = new Map<string, AbortController>();

  constructor(private readonly options: ModelStepProviderServiceOptions) {}

  async *streamModelStep(request: ModelStepRuntimeRequest): AsyncIterable<RuntimeEvent> {
    const controller = new AbortController();
    let sequence = 0;
    const nextSequence = () => {
      sequence += 1;
      return sequence;
    };
    this.activeRequests.set(request.requestId, controller);

    try {
      const config = await this.options.resolver.resolveProviderRuntimeConfig({
        providerId: request.providerId,
        modelId: String(request.modelId),
        runtimeContext: request.runtimeContext,
      });
      const adapter = this.options.registry.getAdapter(config.providerId);

      for await (const event of adapter.streamModelStep({
        request,
        runId: request.runId,
        stepId: request.stepId,
        config,
        signal: controller.signal,
        nextSequence,
        eventIdFactory: () => `event:${crypto.randomUUID()}`,
      })) {
        yield event;
      }
    } catch (error) {
      yield createRunFailedEvent({
        eventId: `event:${crypto.randomUUID()}`,
        request: toChatRuntimeRequest(request),
        runId: request.runId,
        sequence: nextSequence(),
        createdAt: new Date().toISOString(),
        error: toRuntimeError(error, request),
      });
    } finally {
      this.activeRequests.delete(request.requestId);
    }
  }

  cancelModelStep(requestId: string): boolean {
    const controller = this.activeRequests.get(requestId);

    if (!controller) {
      return false;
    }

    controller.abort();
    return true;
  }

  cancelChat(requestId: string): boolean {
    return this.cancelModelStep(requestId);
  }

  streamChat(request: ChatRuntimeRequest): AsyncIterable<RuntimeEvent> {
    return this.streamModelStep({
      requestId: request.requestId,
      sessionId: request.sessionId ?? `session:${request.requestId}`,
      runId: `run:${request.requestId}`,
      stepId: `step:${request.requestId}`,
      providerId: request.providerId,
      modelId: request.modelId,
      messages: request.messages.map((message) => ({
        messageId: message.id,
        sessionId: request.sessionId ?? `session:${request.requestId}`,
        runId: `run:${request.requestId}`,
        role: toSessionMessageRole(message.role),
        content: message.content,
        status: 'completed',
        createdAt: message.createdAt,
        completedAt: message.createdAt,
      })),
      runtimeContext: request.runtimeContext,
      createdAt: request.createdAt,
    });
  }
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

function toSessionMessageRole(role: ChatRuntimeRequest['messages'][number]['role']): ModelStepRuntimeRequest['messages'][number]['role'] {
  return role === 'tool' ? 'host' : role;
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
      fallbackMessage: 'Model step provider service failed.',
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
    case 'missing_provider_settings':
      return 'provider_disabled';
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

export function createModelStepProviderService(
  resolver: ModelStepRuntimeResolverPort,
): ModelStepProviderService {
  return new ModelStepProviderService({
    resolver,
    registry: createAiProviderRegistry(),
  });
}
