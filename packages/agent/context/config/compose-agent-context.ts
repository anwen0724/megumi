/*
 * Composes ContextService with model-facing adapters while keeping provider
 * runtime configuration outside Context business orchestration.
 */
import type { ModelCallConfig, ModelCallFailure, ModelCallService } from '../../agent-run';
import type { ContextCapacity, SessionUsageSnapshot } from '../domain/model/context-usage';
import type { ContextFailure } from '../service/context-service-types';
import type { ContextService } from '../service/context-service';
import {
  ContextServiceImpl,
  type ContextServiceDependencies,
} from '../service/context-service-impl';

export type ContextModelRuntimeConfigResolver = {
  resolve(request: { providerId: string; modelId: string }):
    | { status: 'resolved'; modelConfig: ModelCallConfig }
    | { status: 'failed'; failure: { code: string; message: string; retryable?: boolean } };
};

export type ComposeAgentContextInput = Omit<
  ContextServiceDependencies,
  'promptTokenCounter' | 'summaryModelCall' | 'usageSnapshotCache'
> & {
  modelRuntimeConfigResolver: ContextModelRuntimeConfigResolver;
  modelCallService: Pick<ModelCallService, 'countPrompt' | 'modelCall'>;
  usageSnapshotCache?: ContextServiceDependencies['usageSnapshotCache'];
};

export function composeAgentContext(input: ComposeAgentContextInput): {
  contextService: ContextService;
} {
  const cache = input.usageSnapshotCache ?? new Map<string, SessionUsageSnapshot>();
  const resolveModelConfig = (capacity: ContextCapacity) => input.modelRuntimeConfigResolver.resolve({
    providerId: capacity.providerId,
    modelId: capacity.modelId,
  });

  const contextService = new ContextServiceImpl({
    sessionService: input.sessionService,
    instructionScopeResolver: input.instructionScopeResolver,
    instructionService: input.instructionService,
    usageSnapshotCache: cache,
    ...(input.isRunLive ? { isRunLive: input.isRunLive } : {}),
    ...(input.observability ? { observability: input.observability } : {}),
    ...(input.policy ? { policy: input.policy } : {}),
    ...(input.clock ? { clock: input.clock } : {}),
    ...(input.ids ? { ids: input.ids } : {}),
    promptTokenCounter: {
      async count(request) {
        const resolved = resolveModelConfig(request.modelContext);
        if (resolved.status === 'failed') return { status: 'failed', failure: modelFailure('token_count_failed', resolved.failure) };
        const counted = await input.modelCallService.countPrompt({ prompt: request.prompt, model_config: resolved.modelConfig });
        return counted.status === 'counted'
          ? { status: 'counted', inputTokens: counted.input_tokens, accuracy: counted.accuracy }
          : { status: 'failed', failure: modelFailure('token_count_failed', counted.failure) };
      },
    },
    summaryModelCall: {
      async complete(request) {
        if (!request.sessionId || !request.compactionId) {
          return { status: 'failed', failure: { code: 'compaction_failed', message: 'Summary model call requires Context compaction ownership.', retryable: false, cause: { owner: 'ai' } } };
        }
        const resolved = resolveModelConfig(request.modelContext);
        if (resolved.status === 'failed') return { status: 'failed', failure: modelFailure('compaction_failed', resolved.failure) };
        const call = await input.modelCallService.modelCall({
          owner: { type: 'context_compaction', session_id: request.sessionId, compaction_id: request.compactionId },
          prompt: request.prompt,
          model_config: resolved.modelConfig,
          ...(request.signal ? { signal: request.signal } : {}),
        });
        if (call.status === 'failed') return { status: 'failed', failure: modelFailure('compaction_failed', call.failure) };
        let content: string | undefined;
        for await (const event of call.events) {
          if (event.type === 'failed') return { status: 'failed', failure: modelFailure('compaction_failed', event.failure) };
          if (event.type === 'completed') content = event.content;
        }
        return content === undefined
          ? { status: 'failed', failure: { code: 'compaction_failed', message: 'Summary model call completed without content.', retryable: true, cause: { owner: 'ai' } } }
          : { status: 'completed', content };
      },
    },
  });
  return { contextService };
}

function modelFailure(
  code: 'token_count_failed' | 'compaction_failed',
  failure: Pick<ModelCallFailure, 'code' | 'message' | 'retryable'> | { code: string; message: string; retryable?: boolean },
): ContextFailure {
  return {
    code,
    message: failure.message,
    retryable: failure.retryable ?? true,
    cause: { owner: 'ai', code: failure.code },
  };
}
