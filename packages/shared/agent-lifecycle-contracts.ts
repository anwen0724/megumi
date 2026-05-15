import { z } from 'zod';
import type {
  AgentActionId,
  AgentConfigSnapshotRef,
  AgentDefinitionId,
  AgentObservationId,
  AgentStepId,
  IsoDateTime,
  MessageId,
  PolicySnapshotRef,
  RunId,
  SessionId,
  WorkspaceId,
} from './ids';
import { JsonObjectSchema, type JsonObject } from './json';
import { RuntimeErrorSchema, type RuntimeError } from './runtime-errors';
import { IsoDateTimeSchema } from './runtime-validation';

export type {
  AgentActionId,
  AgentConfigSnapshotRef,
  AgentDefinitionId,
  AgentObservationId,
  AgentStepId,
  PolicySnapshotRef,
} from './ids';

export const AGENT_SESSION_STATUSES = ['active', 'archived', 'deleted'] as const;
export type AgentSessionStatus = (typeof AGENT_SESSION_STATUSES)[number];

export const MESSAGE_ROLES = ['user', 'assistant', 'system', 'host'] as const;
export type MessageRole = (typeof MESSAGE_ROLES)[number];

export const MESSAGE_STATUSES = ['created', 'streaming', 'completed', 'failed', 'cancelled'] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const AGENT_RUN_STATUSES = [
  'queued',
  'running',
  'waiting_for_approval',
  'paused',
  'cancelling',
  'cancelled',
  'failed',
  'completed',
] as const;
export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];

export const AGENT_STEP_STATUSES = [
  'pending',
  'running',
  'waiting_for_approval',
  'succeeded',
  'failed',
  'cancelled',
  'skipped',
] as const;
export type AgentStepStatus = (typeof AGENT_STEP_STATUSES)[number];

export const AGENT_STEP_KINDS = [
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
export type AgentStepKind = (typeof AGENT_STEP_KINDS)[number];

export const AGENT_ACTION_STATUSES = [
  'requested',
  'waiting_for_host',
  'waiting_for_approval',
  'completed',
  'failed',
  'cancelled',
] as const;
export type AgentActionStatus = (typeof AGENT_ACTION_STATUSES)[number];

export const AGENT_ACTION_KINDS = [
  'call_model',
  'call_tool',
  'request_approval',
  'emit_message',
  'create_artifact',
  'update_context',
  'update_memory',
  'save_checkpoint',
  'recover',
  'cancel',
] as const;
export type AgentActionKind = (typeof AGENT_ACTION_KINDS)[number];

export const AGENT_OBSERVATION_SOURCES = [
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
export type AgentObservationSource = (typeof AGENT_OBSERVATION_SOURCES)[number];

const IdSchema = z.string().min(1).max(128);
const OptionalJsonObjectSchema = JsonObjectSchema.optional();

export const AgentSessionStatusSchema = z.enum(AGENT_SESSION_STATUSES);
export const MessageRoleSchema = z.enum(MESSAGE_ROLES);
export const MessageStatusSchema = z.enum(MESSAGE_STATUSES);
export const AgentRunStatusSchema = z.enum(AGENT_RUN_STATUSES);
export const AgentStepStatusSchema = z.enum(AGENT_STEP_STATUSES);
export const AgentStepKindSchema = z.enum(AGENT_STEP_KINDS);
export const AgentActionStatusSchema = z.enum(AGENT_ACTION_STATUSES);
export const AgentActionKindSchema = z.enum(AGENT_ACTION_KINDS);
export const AgentObservationSourceSchema = z.enum(AGENT_OBSERVATION_SOURCES);

export interface AgentSession {
  sessionId: SessionId | string;
  title: string;
  workspaceId?: WorkspaceId | string;
  workspacePath?: string;
  status: AgentSessionStatus;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  archivedAt?: IsoDateTime;
  summary?: string;
  metadata?: JsonObject;
}

export interface Message {
  messageId: MessageId | string;
  sessionId: SessionId | string;
  runId?: RunId | string;
  role: MessageRole;
  content: string;
  status: MessageStatus;
  createdAt: IsoDateTime;
  completedAt?: IsoDateTime;
  metadata?: JsonObject;
}

export interface AgentRun {
  runId: RunId | string;
  sessionId: SessionId | string;
  triggerMessageId?: MessageId | string;
  agentDefinitionId?: AgentDefinitionId | string;
  agentConfigSnapshotRef?: AgentConfigSnapshotRef | string;
  mode: string;
  modeSnapshotRef?: string;
  goal: string;
  status: AgentRunStatus;
  createdAt: IsoDateTime;
  startedAt?: IsoDateTime;
  completedAt?: IsoDateTime;
  cancelledAt?: IsoDateTime;
  error?: RuntimeError;
  sourcePlanId?: string;
  policySnapshotRef?: PolicySnapshotRef | string;
  metadata?: JsonObject;
}

export interface AgentStep {
  stepId: AgentStepId | string;
  runId: RunId | string;
  parentStepId?: AgentStepId | string;
  kind: AgentStepKind;
  status: AgentStepStatus;
  title?: string;
  startedAt?: IsoDateTime;
  completedAt?: IsoDateTime;
  error?: RuntimeError;
  metadata?: JsonObject;
}

export interface AgentAction {
  actionId: AgentActionId | string;
  runId: RunId | string;
  stepId: AgentStepId | string;
  kind: AgentActionKind;
  status: AgentActionStatus;
  requestedAt: IsoDateTime;
  completedAt?: IsoDateTime;
  inputPreview?: JsonObject;
  error?: RuntimeError;
  metadata?: JsonObject;
}

export interface AgentObservation {
  observationId: AgentObservationId | string;
  runId: RunId | string;
  stepId?: AgentStepId | string;
  actionId?: AgentActionId | string;
  source: AgentObservationSource;
  kind: string;
  receivedAt: IsoDateTime;
  summary?: string;
  dataRef?: string;
  error?: RuntimeError;
  metadata?: JsonObject;
}

export const AgentSessionSchema = z
  .object({
    sessionId: IdSchema,
    title: z.string().min(1),
    workspaceId: IdSchema.optional(),
    workspacePath: z.string().min(1).optional(),
    status: AgentSessionStatusSchema,
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
    archivedAt: IsoDateTimeSchema.optional(),
    summary: z.string().optional(),
    metadata: OptionalJsonObjectSchema,
  })
  .strict() satisfies z.ZodType<AgentSession>;

export const MessageSchema = z
  .object({
    messageId: IdSchema,
    sessionId: IdSchema,
    runId: IdSchema.optional(),
    role: MessageRoleSchema,
    content: z.string(),
    status: MessageStatusSchema,
    createdAt: IsoDateTimeSchema,
    completedAt: IsoDateTimeSchema.optional(),
    metadata: OptionalJsonObjectSchema,
  })
  .strict()
  .transform((message) => ({
    runId: undefined,
    ...message,
  })) satisfies z.ZodType<Message>;

export const AgentRunSchema = z
  .object({
    runId: IdSchema,
    sessionId: IdSchema,
    triggerMessageId: IdSchema.optional(),
    agentDefinitionId: IdSchema.optional(),
    agentConfigSnapshotRef: IdSchema.optional(),
    mode: z.string().min(1),
    modeSnapshotRef: z.string().min(1).optional(),
    goal: z.string().min(1),
    status: AgentRunStatusSchema,
    createdAt: IsoDateTimeSchema,
    startedAt: IsoDateTimeSchema.optional(),
    completedAt: IsoDateTimeSchema.optional(),
    cancelledAt: IsoDateTimeSchema.optional(),
    error: RuntimeErrorSchema.optional(),
    sourcePlanId: z.string().min(1).optional(),
    policySnapshotRef: IdSchema.optional(),
    metadata: OptionalJsonObjectSchema,
  })
  .strict() satisfies z.ZodType<AgentRun>;

export const AgentStepSchema = z
  .object({
    stepId: IdSchema,
    runId: IdSchema,
    parentStepId: IdSchema.optional(),
    kind: AgentStepKindSchema,
    status: AgentStepStatusSchema,
    title: z.string().min(1).optional(),
    startedAt: IsoDateTimeSchema.optional(),
    completedAt: IsoDateTimeSchema.optional(),
    error: RuntimeErrorSchema.optional(),
    metadata: OptionalJsonObjectSchema,
  })
  .strict() satisfies z.ZodType<AgentStep>;

export const AgentActionSchema = z
  .object({
    actionId: IdSchema,
    runId: IdSchema,
    stepId: IdSchema,
    kind: AgentActionKindSchema,
    status: AgentActionStatusSchema,
    requestedAt: IsoDateTimeSchema,
    completedAt: IsoDateTimeSchema.optional(),
    inputPreview: OptionalJsonObjectSchema,
    error: RuntimeErrorSchema.optional(),
    metadata: OptionalJsonObjectSchema,
  })
  .strict() satisfies z.ZodType<AgentAction>;

export const AgentObservationSchema = z
  .object({
    observationId: IdSchema,
    runId: IdSchema,
    stepId: IdSchema.optional(),
    actionId: IdSchema.optional(),
    source: AgentObservationSourceSchema,
    kind: z.string().min(1),
    receivedAt: IsoDateTimeSchema,
    summary: z.string().optional(),
    dataRef: z.string().min(1).optional(),
    error: RuntimeErrorSchema.optional(),
    metadata: OptionalJsonObjectSchema,
  })
  .strict() satisfies z.ZodType<AgentObservation>;
