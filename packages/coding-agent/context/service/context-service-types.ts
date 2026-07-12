/*
 * Defines request and result types for the four ContextService business operations.
 */
import type { ToolSetEntry } from '@megumi/ai';
import type { CurrentConversationTurn } from '../domain/model/conversation-turn';
import type {
  ContextCapacity,
  ContextUsage,
  SessionUsageSnapshot,
} from '../domain/model/context-usage';
import type {
  ActivatedSkillInstruction,
  MemoryContextInput,
  PreparedModelCall,
} from '../domain/model/prompt';

export type ContextFailure = {
  code:
    | 'session_history_failed'
    | 'run_transcript_failed'
    | 'instruction_load_failed'
    | 'skill_catalog_failed'
    | 'active_context_failed'
    | 'token_count_failed'
    | 'usage_snapshot_invalid'
    | 'compaction_failed'
    | 'compaction_persist_failed'
    | 'context_window_exceeded'
    | 'prompt_build_failed'
    | 'cancelled';
  message: string;
  retryable: boolean;
  cause?: {
    owner: 'session' | 'agent_run' | 'instructions' | 'skills' | 'tools' | 'ai';
    code?: string;
  };
};

export type PrepareModelCallRequest = {
  sessionId: string;
  workspaceId: string;
  currentTurn: CurrentConversationTurn;
  activatedSkills: ActivatedSkillInstruction[];
  memoryRecall?: MemoryContextInput;
  tools: ToolSetEntry[];
  modelContext: ContextCapacity;
  signal?: AbortSignal;
};

export type PrepareModelCallResult =
  | { status: 'ready'; prepared: PreparedModelCall }
  | { status: 'failed'; failure: ContextFailure };

export type CompactSessionRequest = {
  sessionId: string;
  workspaceId: string;
  modelContext: ContextCapacity;
  signal?: AbortSignal;
};

export type CompactSessionResult =
  | {
      status: 'compacted';
      compactionId: string;
      usageBefore: ContextUsage;
      usageAfter: ContextUsage;
    }
  | {
      status: 'nothing_to_compact';
      reason: 'no_complete_turns' | 'no_older_turns' | 'summary_not_reducing';
    }
  | { status: 'failed'; failure: ContextFailure };

export type RecordCompletedRunUsageRequest = {
  sessionId: string;
  runId: string;
  modelContext: ContextCapacity;
  preCallUsage: ContextUsage;
  providerInputTokens?: number;
};

export type RecordCompletedRunUsageResult =
  | { status: 'recorded'; snapshot: SessionUsageSnapshot }
  | { status: 'failed'; failure: ContextFailure };

export type GetSessionUsageSnapshotRequest = {
  sessionId: string;
};

export type GetSessionUsageSnapshotResult =
  | { status: 'available'; snapshot: SessionUsageSnapshot }
  | { status: 'not_available' }
  | { status: 'failed'; failure: ContextFailure };
