/*
 * Defines request and result types for the four ContextService business operations.
 */
import type { AiModelSupportLevel, ToolSetEntry } from '@megumi/ai';
import type { CurrentConversationRun } from '../domain/model/conversation-run';
import type { SkillCatalogItem, UsedSkillContent } from '@megumi/skills';
import type {
  ContextCapacity,
  ContextUsage,
  SessionUsageSnapshot,
} from '../domain/model/context-usage';
import type {
  MemoryContextInput,
  PreparedModelCall,
} from '../domain/model/prompt';

export type ContextFailure = {
  code:
    | 'session_history_failed'
    | 'instruction_load_failed'
    | 'skill_catalog_failed'
    | 'active_context_failed'
    | 'token_count_failed'
    | 'usage_snapshot_invalid'
    | 'compaction_failed'
    | 'compaction_persist_failed'
    | 'context_window_exceeded'
    | 'prompt_build_failed'
    | 'image_materialization_failed'
    | 'cancelled';
  message: string;
  retryable: boolean;
  cause?: {
    owner: 'session' | 'instructions' | 'skills' | 'tools' | 'ai';
    code?: string;
  };
};

export type ContextCompactionProgress =
  | {
      status: 'started' | 'completed';
      compactionId: string;
      tokensBefore: number;
      summarizedSourceCount: number;
      firstKeptSourceId?: string;
      previousCompactionId?: string;
    }
  | {
      status: 'failed';
      compactionId: string;
      tokensBefore: number;
      code: string;
      message: string;
      previousCompactionId?: string;
    };

export type PrepareModelCallRequest = {
  sessionId: string;
  workspaceId: string;
  currentRun: CurrentConversationRun;
  skillCatalog: SkillCatalogItem[];
  usedSkills: UsedSkillContent[];
  memoryRecall?: MemoryContextInput;
  tools: ToolSetEntry[];
  modelContext: ContextCapacity;
  imageInputSupport: AiModelSupportLevel;
  onCompactionProgress?: (progress: ContextCompactionProgress) => void;
  signal?: AbortSignal;
};

export type PrepareModelCallResult =
  | { status: 'ready'; prepared: PreparedModelCall }
  | { status: 'failed'; failure: ContextFailure };

export type CompactSessionRequest = {
  sessionId: string;
  workspaceId: string;
  modelContext: ContextCapacity;
  imageInputSupport: AiModelSupportLevel;
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
      reason: 'no_historical_runs' | 'no_older_runs' | 'summary_not_reducing';
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
