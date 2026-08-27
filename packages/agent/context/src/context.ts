/*
 * Defines the fixed Context main chain: RunContext facts that stay constant
 * inside one Run, ModelCallContext facts fixed before one model call, the
 * assembly seams Context uses to resolve its own prompt sources, the
 * provider-neutral Prompt result of Context.build and the public build and
 * compaction Contracts. No source reads, Prompt assembly or compaction
 * algorithms live here.
 */

import type { Api, Message, Model } from '@megumi/ai';
import type { UserInput } from '@megumi/input';
import type { ToolDefinition } from '@megumi/tools';
import type { ContextUsageEstimate } from './context-usage-calculator';

export interface ExecutionEnvironment {
  readonly workingDirectory: string;
  readonly operatingSystem: string;
  readonly shell: string;
}

/** Assembly-time Workspace seam: Context resolves Workspace facts itself. */
export interface ContextWorkspaceSource {
  readWorkspace(request: {
    readonly workspaceId: string;
    readonly signal?: AbortSignal;
  }): Promise<
    | { readonly status: 'ok'; readonly workspaceRoot: string; readonly environment: ExecutionEnvironment }
    | { readonly status: 'failed'; readonly failure: { readonly code: string; readonly message: string } }
    | { readonly status: 'cancelled' }
  >;
}

export interface BaseRunContext {
  readonly executionId: string;
  readonly model: Model<Api>;
}

/** Session-backed facts that stay constant for one conversation execution. */
export interface ConversationRunContext extends BaseRunContext {
  readonly kind: 'conversation';
  readonly sessionId: string;
  readonly workspaceId: string;
  readonly userInput: UserInput;
}

/** Bounded Pool facts exposed to one Daily Recommendation execution. */
export interface DailyRecommendationContextMaterial {
  readonly requestedCount: number;
  readonly actualTarget: number;
  readonly availableCount: number;
  readonly readBudget: number;
  readonly interests: readonly {
    readonly interestId: string;
    readonly description: string;
  }[];
  readonly candidates: readonly {
    readonly candidateId: string;
    readonly contentIdentity: string;
    readonly sourceName: string;
    readonly canonicalUrl: string;
    readonly contentType: string;
    readonly title: string;
    readonly author?: string;
    readonly contentPublishedAt?: string;
    readonly description?: string;
    readonly relevance: 'direct' | 'adjacent' | 'exploration';
    readonly matchedInterestIds: readonly string[];
    readonly admissionReason: string;
  }[];
  readonly recentRecommendations: readonly DailyRecommendationHistoryItem[];
  readonly recentFeedback: readonly DailyRecommendationHistoryItem[];
}

export interface DailyRecommendationHistoryItem {
  readonly contentIdentity: string;
  readonly sourceName: string;
  readonly title: string;
  readonly recommendationReason: string;
  readonly publishedAt: string;
  readonly reaction?: 'liked' | 'disliked';
  readonly hiddenAt?: string;
  readonly favoriteAt?: string;
  readonly watchLaterAt?: string;
  readonly firstOpenedAt?: string;
}

export interface CandidateSupplyContextMaterial {
  readonly pool: {
    readonly counts: Readonly<Record<string, number>>;
    readonly lowWatermark: number;
    readonly target: number;
    readonly hardLimit: number;
    readonly totalShortfall: number;
    readonly uncoveredInterestIds: readonly string[];
    readonly consumerShortfalls: readonly {
      readonly consumer: 'daily' | 'proactive';
      readonly count: number;
    }[];
  };
  readonly interests: readonly {
    readonly interestId: string;
    readonly description: string;
  }[];
  readonly negativeConstraints: readonly string[];
  readonly sources: readonly {
    readonly id: string;
    readonly name: string;
    readonly access: string;
    readonly supportedModes: readonly string[];
    readonly supportsRead: boolean;
    readonly availability: string;
    readonly retryAt?: string;
  }[];
  readonly recentQueryOutcomes: readonly unknown[];
  readonly pendingCandidates: readonly unknown[];
  readonly budget: {
    readonly searchesRemaining: number;
    readonly readsRemaining: number;
    readonly rawResultsRemaining: number;
  };
}

/** Candidate Pool facts fixed before one Daily Recommendation execution starts. */
export interface DailyRecommendationRunContext extends BaseRunContext {
  readonly kind: 'daily_recommendation';
  readonly batchId: string;
  readonly localDate: string;
  readonly material: DailyRecommendationContextMaterial;
}

/** Candidate Supply facts are snapshotted before one Supply execution starts. */
export interface CandidateSupplyRunContext extends BaseRunContext {
  readonly kind: 'candidate_supply';
  readonly startedAt: string;
  readonly material: CandidateSupplyContextMaterial;
}

export type RunContext = ConversationRunContext | DailyRecommendationRunContext
  | CandidateSupplyRunContext;

/** Facts fixed before one model call; never persisted. */
export interface ModelCallContext {
  readonly modelCallId: string;
  readonly run: RunContext;
  readonly tools: readonly ToolDefinition[];
}

/** The final provider-neutral Prompt; Context owns its three required parts. */
export interface Prompt {
  readonly systemPrompt: string;
  readonly messages: readonly Message[];
  readonly tools: readonly ToolDefinition[];
}

export interface BuildContextRequest {
  readonly modelCallContext: ModelCallContext;
  readonly currentMessages: readonly Message[];
  readonly signal?: AbortSignal;
}

export type BuildContextResult =
  | { readonly status: 'ready'; readonly prompt: Prompt }
  | { readonly status: 'failed'; readonly failure: ContextFailure };

export type ContextFailureCode =
  | 'session_history_failed'
  | 'base_instructions_failed'
  | 'effective_instructions_failed'
  | 'skill_view_failed'
  | 'workspace_failed'
  | 'execution_environment_invalid'
  | 'tool_definitions_invalid'
  | 'image_materialization_failed'
  | 'document_attachment_failed'
  | 'policy_invalid'
  | 'context_window_exceeded'
  | 'protocol_closure_failed'
  | 'compaction_failed'
  | 'compaction_persist_failed'
  | 'cancelled'
  | 'context_build_failed';

export interface ContextFailure {
  readonly code: ContextFailureCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly cause?: {
    readonly owner: 'session' | 'workspace' | 'instructions' | 'skills' | 'tools' | 'ai';
    readonly code?: string;
  };
}

export interface ContextBuilder {
  build(request: BuildContextRequest): Promise<BuildContextResult>;
}

// ---------------------------------------------------------------------------
// Compaction public Contract
// ---------------------------------------------------------------------------

export type CompactionTrigger = 'threshold' | 'overflow' | 'manual';

export interface ContextCompactionProgressStarted {
  readonly status: 'started';
  readonly compactionId: string;
  readonly tokensBefore: number;
  readonly summarizedMessageCount: number;
  readonly firstKeptEntryId?: string;
}

export interface ContextCompactionProgressCompleted {
  readonly status: 'completed';
  readonly compactionId: string;
  readonly tokensBefore: number;
  readonly summarizedMessageCount: number;
  readonly firstKeptEntryId?: string;
}

export interface ContextCompactionProgressFailed {
  readonly status: 'failed';
  readonly compactionId: string;
  readonly tokensBefore: number;
  readonly code: string;
  readonly message: string;
}

export interface ContextCompactionProgressCancelled {
  readonly status: 'cancelled';
  readonly compactionId: string;
  readonly tokensBefore: number;
}

export type ContextCompactionProgress =
  | ContextCompactionProgressStarted
  | ContextCompactionProgressCompleted
  | ContextCompactionProgressFailed
  | ContextCompactionProgressCancelled;

export interface CompactContextRequest {
  readonly sessionId: string;
  readonly workspaceId: string;
  readonly model: Model<Api>;
  /** The Tool Definitions of the Prompt being compacted; manual compaction passes an empty list. */
  readonly tools: readonly ToolDefinition[];
  readonly trigger: CompactionTrigger;
  readonly onProgress?: (progress: ContextCompactionProgress) => void;
  readonly signal?: AbortSignal;
}

export type CompactContextResult =
  | {
      readonly status: 'compacted';
      readonly compactionId: string;
      readonly usageBefore: ContextUsageEstimate;
      readonly usageAfter: ContextUsageEstimate;
    }
  | {
      readonly status: 'nothing_to_compact';
      readonly reason: 'no_historical_messages' | 'no_older_messages' | 'summary_not_reducing';
    }
  | { readonly status: 'failed'; readonly failure: ContextFailure };

export interface ContextCompactor {
  compact(request: CompactContextRequest): Promise<CompactContextResult>;
}
