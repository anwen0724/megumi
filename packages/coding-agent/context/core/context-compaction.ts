/*
 * Implements the internal context compaction planning rules.
 */
import type { PromptSourceRef, SessionContext, SessionContextSource } from '../contracts/context-contracts';
import type { ContextCompactionTrigger } from '../contracts/context-compaction-contracts';
import type { SessionContextUsage } from '../contracts/context-usage-contracts';

export type PlanContextCompactionInput = {
  session_context: SessionContext;
  usage: SessionContextUsage;
  trigger: ContextCompactionTrigger;
};

export type PlannedContextCompaction =
  | { status: 'skipped'; reason: 'not_needed' | 'nothing_to_compact' }
  | {
      status: 'ready';
      candidate_sources: SessionContextSource[];
      compacted_source_refs: PromptSourceRef[];
      preserved_source_refs: PromptSourceRef[];
    };

const RECENT_SESSION_MESSAGES_TO_KEEP = 2;

export function planContextCompaction(input: PlanContextCompactionInput): PlannedContextCompaction {
  if (input.trigger.kind === 'auto' && !input.usage.should_auto_compact) {
    return { status: 'skipped', reason: 'not_needed' };
  }

  const persistedSources = input.session_context.sources
    .filter((source) => source.persisted)
    .filter((source) => source.text.trim().length > 0)
    .filter((source) => source.source_kind !== 'memory_recall_result')
    .filter((source) => source.source_kind !== 'agent_instruction');
  const sessionMessages = persistedSources
    .filter((source) => source.source_kind === 'session_message')
    .sort(compareByCreatedAt);
  const recentMessageIds = new Set(sessionMessages
    .slice(-RECENT_SESSION_MESSAGES_TO_KEEP)
    .map((source) => source.source_id));
  const candidates = persistedSources
    .filter((source) => {
      if (source.source_kind === 'context_compaction_summary') {
        return false;
      }
      if (source.source_kind === 'session_message') {
        return !recentMessageIds.has(source.source_id);
      }
      return source.source_kind === 'runtime_fact' || source.source_kind === 'tool_result';
    });
  const preserved = input.session_context.sources
    .filter((source) => source.text.trim().length > 0)
    .filter((source) => source.source_kind === 'context_compaction_summary'
      || source.source_kind === 'agent_instruction'
      || (source.source_kind === 'session_message' && recentMessageIds.has(source.source_id)));

  if (candidates.length === 0) {
    return { status: 'skipped', reason: 'nothing_to_compact' };
  }

  return {
    status: 'ready',
    candidate_sources: candidates,
    compacted_source_refs: candidates.map(sourceRef),
    preserved_source_refs: preserved.map(sourceRef),
  };
}

export function extractContextCompactionMetadata(summary: string): Record<string, unknown> {
  return {
    summary_length: summary.length,
  };
}

function sourceRef(source: SessionContextSource): PromptSourceRef {
  return {
    source_id: source.source_id,
    source_kind: source.source_kind,
    ...(source.metadata?.origin_module ? { origin_module: source.metadata.origin_module as PromptSourceRef['origin_module'] } : {}),
  };
}

function compareByCreatedAt(left: SessionContextSource, right: SessionContextSource): number {
  return (left.created_at ?? '').localeCompare(right.created_at ?? '');
}
