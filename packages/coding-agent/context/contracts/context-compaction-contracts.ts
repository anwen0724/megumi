/*
 * Defines Context Compaction Service contracts for manual and automatic compaction.
 */
import type { PromptSourceRef, RuntimeError } from './context-contracts';
import type { SessionContextUsage } from './context-usage-contracts';

export type RuntimeEvent = {
  event_id: string;
  event_type: string;
  session_id?: string;
  workspace_id?: string;
  created_at: string;
  payload?: Record<string, unknown>;
};

export type ContextCompactionTrigger =
  | { kind: 'auto'; reason: 'context_window_threshold'; signal_id: string }
  | { kind: 'manual'; requested_by: 'command' };

export type ContextCompaction = {
  compaction_id: string;
  session_id: string;
  workspace_id?: string;
  trigger: ContextCompactionTrigger;
  summary: string;
  compacted_source_refs: PromptSourceRef[];
  preserved_source_refs: PromptSourceRef[];
  usage_before: SessionContextUsage;
  usage_after?: SessionContextUsage;
  status: 'completed';
  created_at: string;
  metadata?: Record<string, unknown>;
};

export type CompactContextRequest = {
  session_id: string;
  workspace_id?: string;
  trigger: ContextCompactionTrigger;
};

export type CompactContextResult =
  | {
      status: 'skipped';
      reason: 'not_needed' | 'nothing_to_compact' | 'already_running' | 'stale_signal';
      usage: SessionContextUsage;
    }
  | { status: 'completed'; compaction: ContextCompaction; events: RuntimeEvent[] }
  | { status: 'failed'; failure: RuntimeError; events: RuntimeEvent[] };
