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
  projectId?: string;
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

const RuntimePayloadSchema = z.record(z.string(), z.unknown()).default({});

const ApprovalStatusSchema = z.enum(['pending', 'approved', 'denied', 'expired', 'cancelled']);
const ApprovalScopeSchema = z.enum(['once', 'run', 'project', 'local']);
const JsonObjectSchema = z.record(z.string(), z.unknown());

const ApprovalRequestSchema = z.object({
  approvalRequestId: z.string(),
  toolCallId: z.string(),
  toolExecutionId: z.string().optional(),
  permissionDecisionId: z.string().optional(),
  runId: z.string(),
  stepId: z.string().optional(),
  toolName: z.string(),
  modelVisibleName: z.string().optional(),
  title: z.string(),
  summary: z.string(),
  preview: z.object({
    action: z.string(),
    targets: z.array(z.object({
      kind: z.string(),
      label: z.string(),
      sensitivity: z.string().optional(),
    })).optional(),
    warnings: z.array(z.string()).optional(),
  }),
  requestedScope: ApprovalScopeSchema,
  status: ApprovalStatusSchema,
  createdAt: z.string(),
  expiresAt: z.string().optional(),
  resolvedAt: z.string().optional(),
  metadata: JsonObjectSchema.optional(),
});

const RuntimeEventBaseSchema = z.object({
  eventId: z.string(),
  projectId: z.string().optional(),
  sessionId: z.string().optional(),
  runId: z.string().optional(),
  requestId: z.string().optional(),
  stepId: z.string().optional(),
  actionId: z.string().optional(),
  observationId: z.string().optional(),
  messageId: z.string().optional(),
  schemaVersion: z.number().int().optional(),
  sequence: z.number().int(),
  createdAt: z.string(),
  source: z.string().optional(),
  visibility: z.string().optional(),
  persist: z.string().optional(),
  payload: RuntimePayloadSchema,
});

const RuntimeApprovalRequestedEventSchema = RuntimeEventBaseSchema.extend({
  eventType: z.literal('approval.requested'),
  payload: z.object({
    approvalRequest: ApprovalRequestSchema,
  }),
});

function terminalRunEventSchema<TEventType extends 'run.completed' | 'run.failed' | 'run.cancelled'>(
  eventType: TEventType,
) {
  return RuntimeEventBaseSchema.extend({
    eventType: z.literal(eventType),
    projectId: z.string(),
    sessionId: z.string(),
    runId: z.string(),
    requestId: z.string(),
  });
}

const RuntimeSpecialEventSchema = z.discriminatedUnion('eventType', [
  RuntimeApprovalRequestedEventSchema,
  terminalRunEventSchema('run.completed'),
  terminalRunEventSchema('run.failed'),
  terminalRunEventSchema('run.cancelled'),
]);

const RuntimeGenericEventSchema = RuntimeEventBaseSchema.extend({
  eventType: z.string(),
}).superRefine((value, context) => {
  if (
    value.eventType === 'approval.requested'
    || value.eventType === 'run.completed'
    || value.eventType === 'run.failed'
    || value.eventType === 'run.cancelled'
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Runtime event type ${value.eventType} must satisfy its specialized renderer contract`,
      path: ['eventType'],
    });
  }
});

export const RuntimeEventSchema = z.union([
  RuntimeSpecialEventSchema,
  RuntimeGenericEventSchema,
]) satisfies z.ZodType<unknown>;

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
    projectId: input.projectId,
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
