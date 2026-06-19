// Defines model-context construction facts without owning Agent Run, provider access, or persistence.
import type { Message, ModelContextInput, ToolResultMessage, ToolSet } from '../ai';
import type { ParsedInput } from '../input';
import type { JsonObject } from '../shared';

export type ContextFactSource = 'session' | 'current_run';

export interface ContextMessageFact {
  id: string;
  message: Message;
  source: ContextFactSource;
  metadata?: JsonObject;
}

export interface ContextToolResultMessageFact {
  id: string;
  toolCallId: string;
  toolName: string;
  status: 'success' | 'error' | 'rejected' | 'awaiting_approval';
  content: string;
  error?: JsonObject;
  metadata?: JsonObject;
  redaction?: JsonObject;
  truncation?: JsonObject;
  createdAt: string;
}

export interface RunContextBase {
  runId: string;
  sessionId: string;
  workspaceId?: string;
  parsedInput: ParsedInput;
  systemInstruction: string;
  toolSet: ToolSet;
  metadata?: JsonObject;
}

export interface TurnContextDelta {
  turnIndex: number;
  sessionHistory: ContextMessageFact[];
  currentRunMessages: ContextMessageFact[];
  toolResultMessages: ContextToolResultMessageFact[];
  memoryContext?: string[];
  workspaceChangeSummary?: string;
}

export interface ContextBudgetOptions {
  maxHistoryMessages?: number;
  maxMessageCharacters?: number;
}

export interface ContextTraceEntry {
  id: string;
  kind:
    | 'parsed_input'
    | 'command_guidance'
    | 'skill_guidance'
    | 'session_history'
    | 'current_run_message'
    | 'tool_result'
    | 'memory'
    | 'workspace_change';
  source: 'input' | 'command' | 'session' | 'agent' | 'memory' | 'workspace';
  action: 'included' | 'dropped' | 'truncated' | 'deduplicated';
  reason: string;
}

export interface ContextTrace {
  runId: string;
  turnIndex: number;
  included: ContextTraceEntry[];
  dropped: ContextTraceEntry[];
}

export interface TurnSnapshot {
  runId: string;
  turnIndex: number;
  modelContextInput: ModelContextInput;
  toolSet: ToolSet;
  trace: ContextTrace;
}

export function toAiToolResultMessage(fact: ContextToolResultMessageFact): ToolResultMessage {
  return { role: 'toolResult', toolCallId: fact.toolCallId, content: fact.content };
}
