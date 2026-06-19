// Renderer-facing runtime event contracts and schema.
import { z } from 'zod';
import type { JsonObject, JsonValue } from '../json';

export type RuntimeSource =
  | 'renderer'
  | 'preload'
  | 'main'
  | 'core'
  | 'provider'
  | 'config'
  | 'database'
  | 'filesystem'
  | 'security'
  | 'tool'
  | 'approval'
  | 'workspace'
  | 'memory'
  | 'artifact'
  | 'unknown';

export interface RuntimeContext {
  requestId: string;
  traceId: string;
  debugId?: string;
  operationName: string;
  source: RuntimeSource;
  createdAt: string;
}

export interface RuntimeError {
  code: string;
  message: string;
  severity?: 'info' | 'warning' | 'error' | string;
  retryable?: boolean;
  source?: string;
  details?: JsonObject;
  debugId?: string;
}

export interface RuntimeEvent<TPayload = unknown> {
  eventId: string;
  schemaVersion?: number;
  eventType: string;
  runId?: string;
  sessionId?: string;
  stepId?: string;
  actionId?: string;
  observationId?: string;
  messageId?: string;
  requestId?: string;
  sequence: number;
  createdAt: string;
  source?: string;
  visibility?: string;
  persist?: string;
  payload: TPayload;
}

export interface RendererRuntimeEventDto extends RuntimeEvent<Record<string, unknown>> {}

export interface RunFailedPayload {
  error: RuntimeError;
}

export interface RunCancelledPayload {
  reason?: string;
  error?: RuntimeError;
}

export interface ToolExecutionApprovalRequestedPayload {
  toolExecutionId: string;
  toolName: string;
  approvalRequest: import('./tool').ApprovalRequest;
}

export interface ToolResultCreatedPayload {
  toolResultId?: string;
  toolCallId: string;
  toolExecutionId?: string;
  kind: string;
  summary: string;
  sourceIdentity?: JsonObject;
}

export const RuntimeEventSchema = z.union([
  z.object({
    id: z.string(),
    type: z.string(),
    createdAt: z.string(),
    sessionId: z.string().optional(),
    runId: z.string().optional(),
    workspaceId: z.string().optional(),
    payload: z.record(z.unknown()).default({}),
  }),
  z.object({
    eventId: z.string(),
    eventType: z.string(),
    runId: z.string().optional(),
    sessionId: z.string().optional(),
    stepId: z.string().optional(),
    sequence: z.number().int(),
    createdAt: z.string(),
    payload: z.record(z.unknown()).default({}),
  }).passthrough(),
]);

export const RUNTIME_EVENT_TYPES = {
  runStarted: 'run.started',
  runCompleted: 'run.completed',
  runFailed: 'run.failed',
  runCancelled: 'run.cancelled',
  approvalRequested: 'approval.requested',
  toolCallCreated: 'tool.call.created',
  toolExecutionStarted: 'tool.execution.started',
  toolExecutionCompleted: 'tool.execution.completed',
} as const;

export function createRuntimeEvent<TPayload extends JsonObject>(input: Omit<RuntimeEvent<TPayload>, 'eventId' | 'createdAt' | 'sequence'> & {
  eventId?: string;
  createdAt?: string;
  sequence?: number;
}): RuntimeEvent<TPayload> {
  return {
    eventId: input.eventId ?? `runtime-event-${Date.now()}`,
    createdAt: input.createdAt ?? new Date().toISOString(),
    sequence: input.sequence ?? 1,
    eventType: input.eventType,
    runId: input.runId,
    sessionId: input.sessionId,
    stepId: input.stepId,
    payload: input.payload,
  };
}

export type RuntimePayload = JsonValue;

function createRuntimeId(prefix: 'trace' | 'debug'): string {
  const random =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

  return `${prefix}-${random}`;
}

export function createRuntimeTraceId(): string {
  return createRuntimeId('trace');
}

export function createRuntimeDebugId(): string {
  return createRuntimeId('debug');
}

export function createRuntimeContext(input: {
  requestId: string;
  traceId?: string;
  debugId?: string;
  operationName: string;
  source: RuntimeSource;
  createdAt?: string;
}): RuntimeContext {
  return {
    requestId: input.requestId,
    traceId: input.traceId ?? createRuntimeTraceId(),
    debugId: input.debugId,
    operationName: input.operationName,
    source: input.source,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}
