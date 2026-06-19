// Renderer-facing runtime event contracts and schema.
import { z } from 'zod';
import type { JsonObject, JsonValue } from '../json';

export interface RuntimeError {
  code: string;
  message: string;
  severity?: 'info' | 'warning' | 'error' | string;
  retryable?: boolean;
  source?: string;
  details?: JsonObject;
  debugId?: string;
}

export interface RuntimeEvent<TPayload extends object = JsonObject> {
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

export interface RendererRuntimeEventDto {
  type: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}

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
