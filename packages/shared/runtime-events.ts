import type { JsonValue } from './json';
import type { RuntimeError } from './runtime-errors';
import type { RuntimeContext } from './runtime-context';

export const RUNTIME_EVENT_SCHEMA_VERSION = 1 as const;

export const RUNTIME_EVENT_TYPES = [
  'run.started',
  'run.completed',
  'run.failed',
  'run.cancelled',
  'assistant.output.delta',
  'assistant.output.completed',
  'tool.call.requested',
  'tool.call.started',
  'tool.call.completed',
  'tool.call.failed',
  'approval.requested',
  'approval.resolved',
  'artifact.created',
  'memory.created',
] as const;

export type RuntimeEventType = (typeof RUNTIME_EVENT_TYPES)[number];

export const TERMINAL_RUNTIME_EVENT_TYPES = [
  'run.completed',
  'run.failed',
  'run.cancelled',
] as const;

export type TerminalRuntimeEventType = (typeof TERMINAL_RUNTIME_EVENT_TYPES)[number];

export const RUNTIME_EVENT_SOURCES = [
  'main',
  'core',
  'provider',
  'tool',
  'approval',
  'workspace',
  'memory',
  'artifact',
  'database',
  'security',
  'unknown',
] as const;

export type RuntimeEventSource = (typeof RUNTIME_EVENT_SOURCES)[number];

export const RUNTIME_EVENT_VISIBILITIES = ['user', 'system', 'debug'] as const;

export type RuntimeEventVisibility = (typeof RUNTIME_EVENT_VISIBILITIES)[number];

export const RUNTIME_EVENT_PERSIST_MODES = ['required', 'optional', 'transient'] as const;

export type RuntimeEventPersistMode = (typeof RUNTIME_EVENT_PERSIST_MODES)[number];

export interface RuntimeEvent<TPayload extends object = object> {
  eventId: string;
  schemaVersion: typeof RUNTIME_EVENT_SCHEMA_VERSION;
  eventType: RuntimeEventType;
  runId: string;
  sessionId?: string;
  requestId?: string;
  context?: RuntimeContext;
  sequence: number;
  createdAt: string;
  source: RuntimeEventSource;
  visibility: RuntimeEventVisibility;
  persist: RuntimeEventPersistMode;
  payload: TPayload;
}

export interface RunStartedPayload {
  providerId?: string;
  modelId?: string;
  runKind: 'chat' | 'agent';
}

export interface AssistantOutputDeltaPayload {
  delta: string;
}

export interface ChatTokenUsagePayload {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface AssistantOutputCompletedPayload {
  content: string;
  messageId?: string;
  usage?: ChatTokenUsagePayload;
}

export interface RunCompletedPayload {
  usage?: ChatTokenUsagePayload;
}

export interface RunFailedPayload {
  error: RuntimeError;
}

export interface RunCancelledPayload {
  reason?: string;
  error?: RuntimeError;
}

export interface ToolCallRequestedPayload {
  toolCallId: string;
  toolName: string;
  inputPreview?: Record<string, JsonValue>;
  approvalRequired: boolean;
}

export interface ToolCallStartedPayload {
  toolCallId: string;
  toolName: string;
}

export interface ToolCallCompletedPayload {
  toolCallId: string;
  toolName: string;
  resultPreview?: Record<string, JsonValue>;
  durationMs?: number;
}

export interface ToolCallFailedPayload {
  toolCallId: string;
  toolName: string;
  error: RuntimeError;
  durationMs?: number;
}

export interface ApprovalRequestedPayload {
  approvalId: string;
  toolCallId?: string;
  title: string;
  description: string;
  riskLevel: 'low' | 'medium' | 'high';
}

export interface ApprovalResolvedPayload {
  approvalId: string;
  decision: 'approved' | 'denied';
  decidedAt: string;
}

export interface ArtifactCreatedPayload {
  artifactId: string;
  title: string;
  kind: 'file' | 'document' | 'code' | 'image' | 'other';
  path?: string;
}

export interface MemoryCreatedPayload {
  memoryId: string;
  title: string;
  summary: string;
}

export type RuntimeEventPayloadByType = {
  'run.started': RunStartedPayload;
  'run.completed': RunCompletedPayload;
  'run.failed': RunFailedPayload;
  'run.cancelled': RunCancelledPayload;
  'assistant.output.delta': AssistantOutputDeltaPayload;
  'assistant.output.completed': AssistantOutputCompletedPayload;
  'tool.call.requested': ToolCallRequestedPayload;
  'tool.call.started': ToolCallStartedPayload;
  'tool.call.completed': ToolCallCompletedPayload;
  'tool.call.failed': ToolCallFailedPayload;
  'approval.requested': ApprovalRequestedPayload;
  'approval.resolved': ApprovalResolvedPayload;
  'artifact.created': ArtifactCreatedPayload;
  'memory.created': MemoryCreatedPayload;
};

export type TypedRuntimeEvent<TType extends RuntimeEventType> = RuntimeEvent<
  RuntimeEventPayloadByType[TType]
> & {
  eventType: TType;
};

export function isTerminalRuntimeEvent(value: RuntimeEventType): value is TerminalRuntimeEventType {
  return (TERMINAL_RUNTIME_EVENT_TYPES as readonly string[]).includes(value);
}
