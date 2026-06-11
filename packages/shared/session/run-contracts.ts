import { z } from 'zod';
import type {
  AgentConfigSnapshotRef,
  AgentDefinitionId,
  IsoDateTime,
  MessageId,
  PolicySnapshotRef,
  RunActionId,
  RunId,
  RunObservationId,
  RunStepId,
  SessionId,
  WorkspaceId,
} from '../primitives/ids';
import { JsonObjectSchema, type JsonObject } from '../primitives/json';
import { RuntimeErrorSchema, type RuntimeError } from '../runtime/errors';
import { IsoDateTimeSchema } from '../runtime/validation';

export type {
  AgentConfigSnapshotRef,
  AgentDefinitionId,
  PolicySnapshotRef,
  RunActionId,
  RunObservationId,
  RunStepId,
} from '../primitives/ids';

export const SESSION_STATUSES = ['active', 'archived', 'deleted'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const SESSION_MESSAGE_ROLES = ['user', 'assistant', 'system', 'host'] as const;
export type SessionMessageRole = (typeof SESSION_MESSAGE_ROLES)[number];

export const SESSION_MESSAGE_STATUSES = ['created', 'streaming', 'completed', 'failed', 'cancelled'] as const;
export type SessionMessageStatus = (typeof SESSION_MESSAGE_STATUSES)[number];

export const RUN_STATUSES = [
  'queued',
  'running',
  'waiting_for_approval',
  'paused',
  'cancelling',
  'cancelled',
  'failed',
  'completed',
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const RUN_STEP_STATUSES = [
  'pending',
  'running',
  'waiting_for_approval',
  'succeeded',
  'failed',
  'cancelled',
  'skipped',
] as const;
export type RunStepStatus = (typeof RUN_STEP_STATUSES)[number];

export const RUN_STEP_KINDS = [
  'model',
  'tool',
  'approval',
  'context',
  'artifact',
  'memory',
  'checkpoint',
  'final',
  'error',
  'observation',
] as const;
export type RunStepKind = (typeof RUN_STEP_KINDS)[number];

export const RUN_ACTION_STATUSES = [
  'requested',
  'waiting_for_host',
  'waiting_for_approval',
  'completed',
  'failed',
  'cancelled',
] as const;
export type RunActionStatus = (typeof RUN_ACTION_STATUSES)[number];

export const RUN_ACTION_KINDS = [
  'emit_message',
  'create_artifact',
  'update_context',
  'update_memory',
  'save_checkpoint',
  'recover',
  'cancel',
] as const;
export type RunActionKind = (typeof RUN_ACTION_KINDS)[number];

export const RUN_OBSERVATION_SOURCES = [
  'runtime',
  'host',
  'model',
  'tool',
  'approval',
  'workspace',
  'checkpoint',
  'user',
  'external',
] as const;
export type RunObservationSource = (typeof RUN_OBSERVATION_SOURCES)[number];

const IdSchema = z.string().min(1).max(128);
const OptionalJsonObjectSchema = JsonObjectSchema.optional();

export const SessionStatusSchema = z.enum(SESSION_STATUSES);
export const SessionMessageRoleSchema = z.enum(SESSION_MESSAGE_ROLES);
export const SessionMessageStatusSchema = z.enum(SESSION_MESSAGE_STATUSES);
export const RunStatusSchema = z.enum(RUN_STATUSES);
export const RunStepStatusSchema = z.enum(RUN_STEP_STATUSES);
export const RunStepKindSchema = z.enum(RUN_STEP_KINDS);
export const RunActionStatusSchema = z.enum(RUN_ACTION_STATUSES);
export const RunActionKindSchema = z.enum(RUN_ACTION_KINDS);
export const RunObservationSourceSchema = z.enum(RUN_OBSERVATION_SOURCES);

export interface Session {
  sessionId: SessionId | string;
  title: string;
  workspaceId?: WorkspaceId | string;
  workspacePath?: string;
  status: SessionStatus;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  archivedAt?: IsoDateTime;
  summary?: string;
  metadata?: JsonObject;
}

export interface SessionMessage {
  messageId: MessageId | string;
  sessionId: SessionId | string;
  runId?: RunId | string;
  role: SessionMessageRole;
  content: string;
  status: SessionMessageStatus;
  createdAt: IsoDateTime;
  completedAt?: IsoDateTime;
  metadata?: JsonObject;
}

export interface Run {
  runId: RunId | string;
  sessionId: SessionId | string;
  triggerMessageId?: MessageId | string;
  agentDefinitionId?: AgentDefinitionId | string;
  agentConfigSnapshotRef?: AgentConfigSnapshotRef | string;
  mode: string;
  permissionSnapshotRef?: string;
  goal: string;
  status: RunStatus;
  createdAt: IsoDateTime;
  startedAt?: IsoDateTime;
  completedAt?: IsoDateTime;
  cancelledAt?: IsoDateTime;
  error?: RuntimeError;
  sourcePlanId?: string;
  policySnapshotRef?: PolicySnapshotRef | string;
  metadata?: JsonObject;
}

export interface RunStep {
  stepId: RunStepId | string;
  runId: RunId | string;
  parentStepId?: RunStepId | string;
  kind: RunStepKind;
  status: RunStepStatus;
  title?: string;
  startedAt?: IsoDateTime;
  completedAt?: IsoDateTime;
  error?: RuntimeError;
  metadata?: JsonObject;
}

export interface RunAction {
  actionId: RunActionId | string;
  runId: RunId | string;
  stepId: RunStepId | string;
  kind: RunActionKind;
  status: RunActionStatus;
  requestedAt: IsoDateTime;
  completedAt?: IsoDateTime;
  inputPreview?: JsonObject;
  error?: RuntimeError;
  metadata?: JsonObject;
}

export interface RunObservation {
  observationId: RunObservationId | string;
  runId: RunId | string;
  stepId?: RunStepId | string;
  actionId?: RunActionId | string;
  source: RunObservationSource;
  kind: string;
  receivedAt: IsoDateTime;
  summary?: string;
  dataRef?: string;
  error?: RuntimeError;
  metadata?: JsonObject;
}

export const SessionSchema = z
  .object({
    sessionId: IdSchema,
    title: z.string().min(1),
    workspaceId: IdSchema.optional(),
    workspacePath: z.string().min(1).optional(),
    status: SessionStatusSchema,
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
    archivedAt: IsoDateTimeSchema.optional(),
    summary: z.string().optional(),
    metadata: OptionalJsonObjectSchema,
  })
  .strict() satisfies z.ZodType<Session>;

export const SessionMessageSchema = z
  .object({
    messageId: IdSchema,
    sessionId: IdSchema,
    runId: IdSchema.optional(),
    role: SessionMessageRoleSchema,
    content: z.string(),
    status: SessionMessageStatusSchema,
    createdAt: IsoDateTimeSchema,
    completedAt: IsoDateTimeSchema.optional(),
    metadata: OptionalJsonObjectSchema,
  })
  .strict()
  .transform((message) => ({
    runId: undefined,
    ...message,
  })) satisfies z.ZodType<SessionMessage>;

export const RunSchema = z
  .object({
    runId: IdSchema,
    sessionId: IdSchema,
    triggerMessageId: IdSchema.optional(),
    agentDefinitionId: IdSchema.optional(),
    agentConfigSnapshotRef: IdSchema.optional(),
    mode: z.string().min(1),
    permissionSnapshotRef: z.string().min(1).optional(),
    goal: z.string().min(1),
    status: RunStatusSchema,
    createdAt: IsoDateTimeSchema,
    startedAt: IsoDateTimeSchema.optional(),
    completedAt: IsoDateTimeSchema.optional(),
    cancelledAt: IsoDateTimeSchema.optional(),
    error: RuntimeErrorSchema.optional(),
    sourcePlanId: z.string().min(1).optional(),
    policySnapshotRef: IdSchema.optional(),
    metadata: OptionalJsonObjectSchema,
  })
  .strict() satisfies z.ZodType<Run>;

export const RunStepSchema = z
  .object({
    stepId: IdSchema,
    runId: IdSchema,
    parentStepId: IdSchema.optional(),
    kind: RunStepKindSchema,
    status: RunStepStatusSchema,
    title: z.string().min(1).optional(),
    startedAt: IsoDateTimeSchema.optional(),
    completedAt: IsoDateTimeSchema.optional(),
    error: RuntimeErrorSchema.optional(),
    metadata: OptionalJsonObjectSchema,
  })
  .strict() satisfies z.ZodType<RunStep>;

export const RunActionSchema = z
  .object({
    actionId: IdSchema,
    runId: IdSchema,
    stepId: IdSchema,
    kind: RunActionKindSchema,
    status: RunActionStatusSchema,
    requestedAt: IsoDateTimeSchema,
    completedAt: IsoDateTimeSchema.optional(),
    inputPreview: OptionalJsonObjectSchema,
    error: RuntimeErrorSchema.optional(),
    metadata: OptionalJsonObjectSchema,
  })
  .strict() satisfies z.ZodType<RunAction>;

export const RunObservationSchema = z
  .object({
    observationId: IdSchema,
    runId: IdSchema,
    stepId: IdSchema.optional(),
    actionId: IdSchema.optional(),
    source: RunObservationSourceSchema,
    kind: z.string().min(1),
    receivedAt: IsoDateTimeSchema,
    summary: z.string().optional(),
    dataRef: z.string().min(1).optional(),
    error: RuntimeErrorSchema.optional(),
    metadata: OptionalJsonObjectSchema,
  })
  .strict() satisfies z.ZodType<RunObservation>;

