/*
 * Defines the Context Service contracts for session context facts and prompts.
 */

export type RuntimeError = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

export type MemoryRecallResult = {
  memory_id: string;
  text: string;
  score?: number;
  metadata?: Record<string, unknown>;
};

export type SessionContextSourceKind =
  | 'agent_instruction'
  | 'session_message'
  | 'context_compaction_summary'
  | 'runtime_fact'
  | 'tool_result'
  | 'memory_recall_result';

export type SessionContextSource = {
  source_id: string;
  source_kind: SessionContextSourceKind;
  text: string;
  persisted: boolean;
  created_at?: string;
  metadata?: Record<string, unknown>;
};

export type SessionContext = {
  session_id: string;
  workspace_id?: string;
  sources: SessionContextSource[];
  metadata?: Record<string, unknown>;
};

export type PromptPurpose = 'agent_response' | 'context_compaction';

export type PromptSourceRef = {
  source_id: string;
  source_kind: SessionContextSourceKind;
  origin_module?: 'session' | 'context' | 'agent-loop' | 'tools' | 'memory';
};

export type PromptMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
  source_refs?: PromptSourceRef[];
  metadata?: Record<string, unknown>;
};

export type Prompt = {
  prompt_id: string;
  purpose: PromptPurpose;
  messages: PromptMessage[];
  source_refs: PromptSourceRef[];
  metadata?: Record<string, unknown>;
};

export type GetSessionContextRequest = {
  session_id: string;
  workspace_id?: string;
  purpose?: 'agent_response' | 'context_compaction';
  memory_recall?: MemoryRecallResult;
};

export type GetSessionContextResult =
  | { status: 'ok'; session_context: SessionContext }
  | { status: 'failed'; failure: RuntimeError };

export type BuildPromptRequest = {
  session_context: SessionContext;
  purpose: 'agent_response';
  current_user_message_id?: string;
};

export type BuildPromptFailureReason =
  | 'invalid_session_context'
  | 'missing_required_prompt_part'
  | 'prompt_build_failed';

export type BuildPromptResult =
  | { status: 'ok'; prompt: Prompt }
  | { status: 'failed'; reason: BuildPromptFailureReason; failure: RuntimeError };
