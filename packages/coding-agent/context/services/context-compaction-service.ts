/*
 * Provides the public Context Compaction Service entrypoint for manual and automatic compaction.
 */
import { buildContextCompactionPrompt } from '../core/prompt-builder';
import {
  extractContextCompactionMetadata,
  planContextCompaction,
} from '../core/context-compaction';
import { evaluateSessionContextUsage } from '../core/session-context-usage';
import type { Prompt, RuntimeError } from '../contracts/context-contracts';
import type {
  CompactContextRequest,
  CompactContextResult,
  ContextCompaction,
  RuntimeEvent,
} from '../contracts/context-compaction-contracts';
import type { ModelConfig } from '../contracts/context-usage-contracts';
import type { ContextService, PromptLogPort } from './context-service';

export interface ContextCompactionRepository {
  saveContextCompaction(compaction: ContextCompaction): void;
  updateSessionActivePathAfterCompaction?(input: {
    session_id: string;
    workspace_id?: string;
    compaction: ContextCompaction;
  }): void;
}

export interface ContextSummaryModelCallPort {
  completePrompt(input: { prompt: Prompt }): Promise<
    | { status: 'ok'; text: string; metadata?: Record<string, unknown> }
    | { status: 'failed'; failure: RuntimeError }
  >;
}

export class ContextCompactionService {
  private readonly running = new Set<string>();

  constructor(private readonly options: {
    contextService: Pick<ContextService, 'getSessionContext'>;
    repository: ContextCompactionRepository;
    modelCall: ContextSummaryModelCallPort;
    clock?: { now(): string };
    ids?: { compactionId(): string; eventId(): string; promptId(): string };
    modelConfigProvider: (input: { session_id: string; workspace_id?: string }) => ModelConfig;
    thresholdRatio?: number;
    promptResources: {
      context_compaction_prompt: string;
    };
    promptLog?: PromptLogPort;
  }) {}

  async compact(request: CompactContextRequest): Promise<CompactContextResult> {
    const key = sessionKey(request);
    if (this.running.has(key)) {
      return {
        status: 'skipped',
        reason: 'already_running',
        usage: emptyUsage(this.options.modelConfigProvider(request), this.options.thresholdRatio ?? 0.8),
      };
    }

    this.running.add(key);
    const started = this.event('context.compaction.started', request);

    try {
      const contextResult = await this.options.contextService.getSessionContext({
        session_id: request.session_id,
        workspace_id: request.workspace_id,
        purpose: 'context_compaction',
      });
      if (contextResult.status !== 'ok') {
        return {
          status: 'failed',
          failure: contextResult.failure,
          events: [started, this.event('context.compaction.failed', request, { failure: contextResult.failure })],
        };
      }

      const modelConfig = this.options.modelConfigProvider(request);
      const usageBefore = evaluateSessionContextUsage({
        session_context: contextResult.session_context,
        model_config: modelConfig,
        threshold_ratio: this.options.thresholdRatio ?? 0.8,
      });

      if (request.trigger.kind === 'auto' && !usageBefore.should_auto_compact) {
        return { status: 'skipped', reason: 'stale_signal', usage: usageBefore };
      }

      const plan = planContextCompaction({
        session_context: contextResult.session_context,
        usage: usageBefore,
        trigger: request.trigger,
      });
      if (plan.status === 'skipped') {
        return {
          status: 'skipped',
          reason: plan.reason,
          usage: usageBefore,
        };
      }

      const prompt = buildContextCompactionPrompt({
        prompt_id: this.options.ids?.promptId() ?? `prompt:context-compaction:${Date.now()}`,
        parts: plan.candidate_parts,
        prompt_resources: {
          context_compaction_prompt: this.options.promptResources.context_compaction_prompt,
        },
      });
      this.writePromptLog({
        prompt_id: prompt.prompt_id,
        purpose: prompt.purpose,
        session_id: request.session_id,
        messages: prompt.messages,
      });

      const modelResult = await this.options.modelCall.completePrompt({ prompt });
      if (modelResult.status === 'failed') {
        return {
          status: 'failed',
          failure: modelResult.failure,
          events: [started, this.event('context.compaction.failed', request, { failure: modelResult.failure })],
        };
      }

      const compaction: ContextCompaction = {
        compaction_id: this.options.ids?.compactionId() ?? `context-compaction:${Date.now()}`,
        session_id: request.session_id,
        ...(request.workspace_id ? { workspace_id: request.workspace_id } : {}),
        trigger: request.trigger,
        summary: modelResult.text,
        compacted_source_refs: plan.compacted_source_refs,
        preserved_source_refs: plan.preserved_source_refs,
        usage_before: usageBefore,
        status: 'completed',
        created_at: this.now(),
        metadata: {
          ...extractContextCompactionMetadata(modelResult.text),
          ...(modelResult.metadata ?? {}),
        },
      };

      this.options.repository.saveContextCompaction(compaction);
      this.options.repository.updateSessionActivePathAfterCompaction?.({
        session_id: request.session_id,
        ...(request.workspace_id ? { workspace_id: request.workspace_id } : {}),
        compaction,
      });

      return {
        status: 'completed',
        compaction,
        events: [started, this.event('context.compaction.completed', request, { compaction_id: compaction.compaction_id })],
      };
    } catch (error) {
      const failure = {
        code: 'context_compaction_failed',
        message: error instanceof Error ? error.message : 'Context compaction failed.',
      };
      return {
        status: 'failed',
        failure,
        events: [started, this.event('context.compaction.failed', request, { failure })],
      };
    } finally {
      this.running.delete(key);
    }
  }

  private writePromptLog(input: Parameters<PromptLogPort['writePrompt']>[0]): void {
    try {
      this.options.promptLog?.writePrompt({
        ...input,
        created_at: input.created_at ?? this.now(),
      });
    } catch {
      // Prompt logging is developer-only observability and must not affect compaction.
    }
  }

  private event(eventType: string, request: CompactContextRequest, payload?: Record<string, unknown>): RuntimeEvent {
    return {
      event_id: this.options.ids?.eventId() ?? `context-compaction-event:${Date.now()}`,
      event_type: eventType,
      session_id: request.session_id,
      ...(request.workspace_id ? { workspace_id: request.workspace_id } : {}),
      created_at: this.now(),
      ...(payload ? { payload } : {}),
    };
  }

  private now(): string {
    return this.options.clock?.now() ?? new Date().toISOString();
  }
}

function sessionKey(input: { session_id: string; workspace_id?: string }): string {
  return `${input.workspace_id ?? ''}::${input.session_id}`;
}

function emptyUsage(modelConfig: ModelConfig, thresholdRatio: number) {
  return {
    used_tokens: 0,
    context_window_tokens: modelConfig.context_window_tokens,
    remaining_tokens: modelConfig.context_window_tokens,
    used_ratio: 0,
    auto_compaction_threshold_ratio: thresholdRatio,
    should_auto_compact: false,
  };
}
