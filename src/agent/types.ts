// Defines Agent Run and turn contracts without owning provider, tool implementation, or SQLite internals.
import type { AssistantMessage, Model } from '../ai';
import type { ContextMessageFact, ContextToolResultMessageFact } from '../context';
import type { ParsedInput } from '../input';
import type { UserDecision } from '../permission';
import type { JsonObject, MegumiError } from '../shared';
import type { ToolCall } from '../tools';

export type AgentRunStatus = 'queued' | 'running' | 'waiting_for_approval' | 'completed' | 'failed' | 'cancelled';

export interface AgentRun {
  id: string;
  sessionId: string;
  workspaceId?: string;
  parsedInputId: string;
  status: AgentRunStatus;
  startedAt: string;
  endedAt?: string;
  metadata?: JsonObject;
}

export interface AgentRunOptions {
  maxTurns: number;
  maxToolCalls: number;
  permissionMode: 'default' | 'plan' | 'accept_edits' | 'auto';
}

export interface AgentApprovalWaitState {
  approvalRequestId: string;
  runId: string;
  turnIndex: number;
  processedToolCallCount: number;
  toolCall: ToolCall;
  currentRunMessages: ContextMessageFact[];
  toolResultMessages: ContextToolResultMessageFact[];
}

export type AgentRunStartResult =
  | { kind: 'not_agent_run'; reason: 'app_operation'; parsedInputId: string }
  | { kind: 'agent_run'; result: AgentRunResult };

export interface AgentRunResult {
  run: AgentRun;
  status: AgentRunStatus;
  finalAssistantMessage?: AssistantMessage;
  waiting?: AgentApprovalWaitState;
  error?: MegumiError;
}

export interface ResumeAgentRunInput {
  runId: string;
  sessionId: string;
  workspaceId?: string;
  parsedInput: ParsedInput;
  approvalRequestId: string;
  userDecision: UserDecision;
  options: AgentRunOptions;
}

export interface StartAgentRunInput {
  parsedInput: ParsedInput;
  sessionId: string;
  workspaceId?: string;
  model?: Model;
  options: AgentRunOptions;
}
