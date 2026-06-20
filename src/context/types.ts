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
    | 'current_turn'
    | 'parsed_input'
    | 'instruction'
    | 'runtime_constraint'
    | 'command_guidance'
    | 'skill_guidance'
    | 'prompt_template_guidance'
    | 'session_history'
    | 'session_runtime_fact'
    | 'current_run_message'
    | 'tool_result'
    | 'tool_continuation'
    | 'memory'
    | 'workspace_change';
  source: 'input' | 'command' | 'session' | 'agent' | 'memory' | 'workspace' | 'runtime' | 'permission' | 'tools';
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
  parts: ContextPart[];
  modelContextInput: ModelContextInput;
  toolSet: ToolSet;
  trace: ContextTrace;
}

export function toAiToolResultMessage(fact: ContextToolResultMessageFact): ToolResultMessage {
  return { role: 'toolResult', toolCallId: fact.toolCallId, content: fact.content };
}

export type ContextPartKind =
  | 'instruction'
  | 'runtime_constraint'
  | 'session'
  | 'memory'
  | 'workspace_change'
  | 'tool_continuation'
  | 'current_turn';

export interface ContextPart {
  id: string;
  kind: ContextPartKind;
  text?: string;
  message?: Message;
  toolResult?: ContextToolResultMessageFact;
  source: ContextTraceEntry['source'];
  traceKind: ContextTraceEntry['kind'];
  required?: boolean;
  priority?: number;
  metadata?: JsonObject;
}
