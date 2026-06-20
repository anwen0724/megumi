// Defines context adapter facts while preserving old context-management ModelInputContext output.
import type { ModelInputContext, ModelInputContextPart } from '@megumi/shared/model';
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
  kind: string;
  source: string;
  action: 'included' | 'dropped' | 'truncated' | 'deduplicated';
  reason: string;
}

export interface ContextTrace {
  runId: string;
  turnIndex: number;
  included: ContextTraceEntry[];
  dropped: ContextTraceEntry[];
}

export interface BuildModelContextInputInput {
  base: RunContextBase;
  delta: TurnContextDelta;
  budget?: ContextBudgetOptions;
}

export interface TurnSnapshot {
  runId: string;
  turnIndex: number;
  parts: ModelInputContextPart[];
  modelInputContext: ModelInputContext;
  modelContextInput: ModelContextInput;
  toolSet: ToolSet;
  trace: ContextTrace;
}

export type ContextPart = ModelInputContextPart;
export type ContextPartKind = ModelInputContextPart['kind'];

export function toAiToolResultMessage(fact: ContextToolResultMessageFact): ToolResultMessage {
  return { role: 'toolResult', toolCallId: fact.toolCallId, content: fact.content };
}
