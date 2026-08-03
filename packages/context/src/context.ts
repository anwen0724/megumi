/*
 * Defines the fixed Context main chain: RunContext facts that stay constant
 * inside one Run, ModelCallContext facts fixed before one model call, and the
 * provider-neutral Prompt result of Context.build.
 */

import type { Api, Context as AiContext, Model } from '@megumi/ai';
import type { EffectiveInstructions } from '@megumi/instructions';
import type { UserInput } from '@megumi/input';
import type { SkillView } from '@megumi/skills';
import type { ToolDefinition } from '@megumi/tools';

export interface ExecutionEnvironment {
  readonly workingDirectory: string;
  readonly operatingSystem: string;
  readonly shell: string;
}

export interface ToolView {
  /** Model-visible Tool Definitions; the Tool Router stays with Tools. */
  readonly definitions: readonly ToolDefinition[];
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
  readonly executionEnvironment: ExecutionEnvironment;
  readonly effectiveInstructions: EffectiveInstructions;
  readonly skills: SkillView;
  readonly tools: ToolView;
}

/** The final provider-neutral Prompt; Context directly reuses @megumi/ai Context. */
export type Prompt = AiContext;

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
    readonly owner: 'session' | 'instructions' | 'skills' | 'tools' | 'ai';
    readonly code?: string;
  };
}

export interface ContextBuilder {
  build(request: BuildContextRequest): Promise<BuildContextResult>;
}
