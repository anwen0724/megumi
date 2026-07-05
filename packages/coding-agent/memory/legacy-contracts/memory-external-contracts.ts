/*
 * Legacy external contracts kept inside the memory module until memory is refactored.
 * No other module may import this file.
 */
import type { RuntimeContext } from '../../events';
import type { JsonObject, JsonValue } from './memory-json';

export type ProviderId = string;
export type ModelId = string;
export type RunId = string;
export type RunStepId = string;
export type RunActionId = string;
export type ContextSourceId = string;
export type WorkspaceId = string;

export interface RuntimeError {
  code: string;
  message: string;
  severity?: 'info' | 'warning' | 'error';
  source?: string;
  retryable?: boolean;
  details?: JsonObject;
}

export interface ChatTokenUsagePayload {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export type RunActionKind = string;
export type RunActionStatus = string;

export interface RunAction {
  actionId: RunActionId | string;
  runId: RunId | string;
  stepId: RunStepId | string;
  kind: RunActionKind;
  status: RunActionStatus;
  requestedAt: string;
  completedAt?: string;
  inputPreview?: JsonObject;
  error?: RuntimeError;
  metadata?: JsonObject;
}

export interface RunContextSource {
  sourceId: ContextSourceId | string;
  sourceKind: string;
  sourceUri: string;
  workspaceId?: WorkspaceId | string;
  workspacePath?: string;
  relativePath?: string;
  contentHash?: string;
  mtime?: string;
  range?: unknown;
  loadedAt: string;
  freshness: string;
  redactionState: string;
  selectionReason: string;
  metadata?: JsonObject;
}

export interface ModelInputContextSourceRef {
  sourceRefId?: string;
  sourceId?: string;
  sourceKind: string;
  label?: string;
  loadedAt?: string;
  metadata?: JsonObject;
}

export interface ModelInputContextPart {
  partId: string;
  kind: string;
  sourceRefs: ModelInputContextSourceRef[];
  priority: number;
  tokenEstimate?: number;
  budgetStatus: string;
  budgetClass?: string;
  required?: boolean;
  metadata?: JsonObject;
  text?: string;
  memoryKind?: string;
  memoryIds?: string[];
  [key: string]: unknown;
}

export interface ModelInputContext {
  contextId: string;
  sessionId: string;
  runId: string;
  stepId: string;
  parts: ModelInputContextPart[];
  budget: Record<string, unknown>;
  trace: Record<string, unknown>;
  builtAt: string;
}

export interface ModelInputContextBuildRequest {
  requestId: string;
  contextId: string;
  sessionId: string;
  runId: string;
  modelStepId: string;
  projectId?: string;
  modelTarget: {
    providerId: string;
    modelId: string;
    contextWindow?: number;
    metadata?: JsonObject;
  };
  runtimeFacts?: Array<{
    factId: string;
    factKind: string;
    text: string;
    required?: boolean;
    metadata?: JsonObject;
  }>;
  memoryRecallSeed?: {
    queryText?: string;
    metadata?: JsonObject;
  };
  traceId: string;
  builtAt: string;
  metadata?: JsonObject;
  [key: string]: unknown;
}

export interface ModelStructuredOutputTarget {
  name: string;
  schema: JsonObject;
  strict?: boolean;
}

export interface ModelToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonObject;
  [key: string]: unknown;
}

export interface ModelStepRuntimeRequest {
  requestId: string;
  sessionId: string;
  runId: RunId | string;
  stepId: string;
  modelStepId?: string;
  providerId: ProviderId;
  modelId: ModelId | string;
  inputContext: ModelInputContext;
  toolDefinitions?: ModelToolDefinition[];
  structuredOutput?: ModelStructuredOutputTarget;
  runtimeContext?: RuntimeContext;
  createdAt: string;
}

export type StructuredOutputValue = JsonValue;
