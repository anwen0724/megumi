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

/** Facts that stay constant for the whole accepted Run. */
export interface RunContext {
  readonly runId: string;
  readonly sessionId: string;
  readonly workspaceId: string;
  readonly userInput: UserInput;
  readonly model: Model<Api>;
}

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

export type ContextCompactionProgress =
  | ContextCompactionProgressStarted
  | ContextCompactionProgressCompleted
  | ContextCompactionProgressFailed;

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
