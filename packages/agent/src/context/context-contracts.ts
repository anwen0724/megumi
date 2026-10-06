/*
 * Defines product-owned context preparation and compaction for one Agent run.
 */
import type { Message } from '@megumi/ai';
import type { ToolDefinition } from '../tools/tool-contracts';

export interface ContextBudget {
  readonly contextWindowTokens: number;
  readonly reservedOutputTokens: number;
  readonly inputTokens: number;
}

export interface ExecutionEnvironment {
  readonly workingDirectory: string;
  readonly operatingSystem: string;
  readonly shell: string;
}

export interface PreparedContext {
  readonly systemPrompt: string;
  readonly messages: readonly Message[];
  readonly tools: readonly ToolDefinition[];
}

export interface PrepareContextRequest {
  readonly runMessages: readonly Message[];
  readonly tools: readonly ToolDefinition[];
  readonly budget: ContextBudget;
  readonly signal: AbortSignal;
}

export interface CompactContextRequest {
  readonly context: PreparedContext;
  readonly budget: ContextBudget;
  readonly reason: 'threshold' | 'overflow';
  readonly signal: AbortSignal;
}

export type CompactResult =
  | { readonly status: 'compacted' }
  | { readonly status: 'nothing_to_compact' }
  | { readonly status: 'failed'; readonly error: { readonly code: string; readonly message: string } };

export interface AgentContext {
  /** Returns the complete model input; saving new messages belongs to saveMessage. */
  prepare(request: PrepareContextRequest): Promise<PreparedContext>;
  /** Resolves after updating the context source and completing required persistence. */
  compact?(request: CompactContextRequest): Promise<CompactResult>;
}
