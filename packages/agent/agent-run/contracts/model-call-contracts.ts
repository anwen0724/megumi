/*
 * Stable public contracts for Agent Run model calls.
 * Model Call Service consumes one complete Context Prompt per request.
 */
import type { Prompt } from '../../context';
import type { ProviderRuntimeConfig } from '../../settings';
import type { ToolExecutionObservation } from '../../tools';
import type { AgentRunFailure } from './agent-run-contracts';

export type ModelCallConfig = ProviderRuntimeConfig;

export type ModelCallRequest = {
  owner:
    | { type: 'agent_run'; run_id: string }
    | { type: 'context_compaction'; session_id: string; compaction_id?: string };
  prompt: Prompt;
  model_config: ModelCallConfig;
  signal?: AbortSignal;
};

export type ModelCallEvent =
  | {
      type: 'started';
      model_call_id: string;
      created_at: string;
    }
  | {
      type: 'retrying';
      model_call_id: string;
      attempt: number;
      max_attempts: number;
      failure: ModelCallFailure;
      retry_after_ms: number;
      created_at: string;
    }
  | {
      type: 'text_delta';
      model_call_id: string;
      delta: string;
      created_at: string;
    }
  | {
      type: 'thinking_started';
      model_call_id: string;
      created_at: string;
    }
  | {
      type: 'thinking_delta';
      model_call_id: string;
      delta: string;
      created_at: string;
    }
  | {
      type: 'thinking_completed';
      model_call_id: string;
      created_at: string;
    }
  | {
      type: 'tool_call';
      model_call_id: string;
      tool_call_id: string;
      tool_name: string;
      input: unknown;
      arguments_text: string;
      created_at: string;
    }
  | {
      type: 'completed';
      model_call_id: string;
      content: string;
      finish_reason?: string;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        total_tokens?: number;
      };
      created_at: string;
    }
  | {
      type: 'failed';
      model_call_id: string;
      failure: ModelCallFailure;
      created_at: string;
    };

export type ModelCallFailure = Omit<AgentRunFailure, 'code'> & {
  code: 'model_call_failed' | 'context_failed' | 'internal_error' | 'unsupported_content';
};

export type CountPromptRequest = {
  prompt: Prompt;
  model_config: ModelCallConfig;
};

export type CountPromptResult =
  | { status: 'counted'; input_tokens: number; accuracy: 'exact' | 'estimated' }
  | { status: 'failed'; failure: ModelCallFailure };

export type ModelCallResult =
  | { status: 'started'; model_call_id: string; events: AsyncIterable<ModelCallEvent> }
  | { status: 'failed'; failure: ModelCallFailure };

export type CancelModelCallRequest = {
  model_call_id: string;
};

export type CancelModelCallResult =
  | { status: 'cancelled'; model_call_id: string }
  | { status: 'not_found'; model_call_id: string }
  | { status: 'not_cancellable'; model_call_id: string };

export type ModelCallService = {
  countPrompt(request: CountPromptRequest): Promise<CountPromptResult>;
  modelCall(request: ModelCallRequest): Promise<ModelCallResult> | ModelCallResult;
  cancelModelCall(request: CancelModelCallRequest): Promise<CancelModelCallResult> | CancelModelCallResult;
};

export type ToolResultRuntimeFact = {
  tool_call_id: string;
  tool_name: string;
  status: 'completed' | 'failed' | 'denied' | 'cancelled';
  observation?: ToolExecutionObservation;
  content?: string;
  created_at: string;
};
