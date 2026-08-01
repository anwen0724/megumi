/*
 * Tool-call, registry, execution, result, and continuation event contracts.
 */
import { z } from 'zod';
import {
  ContentBlockListSchema,
  JsonObjectSchema,
  JsonValueSchema,
  type ContentBlock,
  type JsonValue,
} from '@megumi/ai';
import {
  ApprovalRequestSchema,
  PermissionDecisionSchema,
  ToolExecutionSchema,
  ToolNameSchema,
  ToolPolicyDecisionSchema,
  type ApprovalRequest,
  type PermissionDecision,
  type ToolExecution,
  type ToolName,
  type ToolPolicyDecision,
} from './internal/runtime-event-dependencies';
import { eventSchema, RuntimeEventIsoDateTimeSchema } from './internal/event-schema-helpers';
import { RuntimeErrorSchema, type RuntimeError } from './runtime-error';
import { createRuntimeEvent, type RunRuntimeEventFactoryInput } from './runtime-event-factory';
import type { TypedRuntimeEvent } from './runtime-event';

export type RuntimeToolSourceKind = 'built_in' | 'mcp' | 'plugin' | 'project_local' | 'skill';
export type RuntimeToolRegistryEntryStatus = 'available' | 'disabled' | 'unavailable' | 'conflicted';
export interface RuntimeToolSourceIdentity {
  registrySnapshotId: string;
  snapshotEntryId: string;
  modelVisibleName: ToolName;
  canonicalToolId: string;
  sourceId: string;
  namespace: string;
  sourceToolName: ToolName;
}
export interface ToolCallCreatedPayload {
  toolCallId: string;
  modelCallId: string;
  providerToolCallId: string;
  toolName: string;
  input: JsonValue;
}
export interface ToolCallResolvedPayload extends RuntimeToolSourceIdentity {
  toolCallId: string;
  providerToolCallId: string;
  requestedToolName: string;
}
export interface ToolCallResolutionFailedPayload {
  toolCallId: string;
  providerToolCallId: string;
  requestedToolName: string;
  reason: 'unknown_tool' | 'tool_disabled' | 'tool_unavailable' | 'tool_conflicted' | 'tool_not_exposed';
  message: string;
  sourceIdentity?: RuntimeToolSourceIdentity;
}
export interface ToolInputValidationFailedPayload {
  toolCallId: string;
  modelVisibleName: ToolName;
  registrySnapshotId: string;
  snapshotEntryId: string;
  reason: 'invalid_tool_input';
  message: string;
  sourceIdentity: RuntimeToolSourceIdentity;
}
export interface ToolCallRequestedPayload {
  modelCallId?: string;
  toolCallId: string;
  toolName: string;
  input: JsonValue;
}
export interface ToolCallStartedPayload {
  toolCallId: string;
  toolExecutionId?: string;
  toolName: string;
  input: JsonValue;
}
export interface ToolCallCompletedPayload { toolCallId: string; toolExecutionId?: string; toolName: string }
export interface ToolCallFailedPayload {
  toolCallId: string;
  toolExecutionId?: string;
  toolName: string;
  error: RuntimeError;
}
export interface ToolResultCreatedPayload {
  toolCallId: string;
  toolExecutionId?: string;
  toolName: string;
  kind: 'success' | 'failure' | 'permission_denied' | 'user_rejected' | 'cancelled';
  content: ContentBlock[];
  summary?: string;
  error?: { code: string; message: string; details?: Record<string, JsonValue> };
}
export type AgentRunToolResultCreatedPayload = ToolResultCreatedPayload;
export interface CanonicalToolResultCreatedPayload {
  toolCallId: string;
  toolExecutionId?: string;
  toolName?: string;
  kind: 'success' | 'failed' | 'tool_error' | 'policy_denied' | 'user_rejected' | 'redacted' | 'invalid_tool_call' | 'invalid_tool_input';
  summary: string;
  sourceIdentity?: RuntimeToolSourceIdentity;
}
export interface ToolRegistrySourcesEnsuredPayload { sourceIds: string[]; createdSourceIds: string[] }
export interface ToolRegistrySnapshotCreatedPayload {
  snapshotId: string;
  projectId: string;
  permissionMode: string;
  modelId: string;
  registryVersion: number;
  sourceVersionHash: string;
  sourceCount: number;
  entryCount: number;
  exposedCount: number;
}
export interface ToolRegistryEntryResolvedPayload {
  snapshotId: string;
  snapshotEntryId: string;
  registrationId: string;
  canonicalToolId: string;
  modelVisibleName: ToolName;
  sourceId: string;
  namespace: string;
  sourceToolName: ToolName;
  effectiveStatus: RuntimeToolRegistryEntryStatus;
  exposedToModel: boolean;
  disabledReason?: string;
  unavailableReason?: string;
  conflictReason?: string;
}
export interface ToolRegistryModelVisibleToolsDerivedPayload {
  snapshotId: string;
  modelId: string;
  modelSupportsToolCall: boolean;
  toolNames: ToolName[];
  hiddenCount: number;
}
export interface ToolExecutionRequestedPayload { toolExecution: ToolExecution }
export interface ToolExecutionValidatedPayload { toolExecutionId: string; toolName: string }
export interface ToolExecutionPolicyDecidedPayload {
  toolExecutionId: string;
  toolName: string;
  policyDecision: ToolPolicyDecision;
}
export interface PermissionDecisionCreatedPayload { permissionDecision: PermissionDecision }
export interface ToolExecutionApprovalRequestedPayload {
  toolExecutionId: string;
  toolName: string;
  approvalRequest: ApprovalRequest;
}
export interface ToolExecutionStartedPayload { toolExecutionId: string; startedAt?: string }
export interface ToolExecutionOutputPayload { toolExecutionId: string; stream: 'stdout' | 'stderr'; delta: string; truncated: boolean }
export interface ToolExecutionRoutedPayload extends RuntimeToolSourceIdentity {
  toolExecutionId: string;
  toolName: ToolName;
  executorKind: RuntimeToolSourceKind;
}
export interface ToolExecutionCompletedPayload { toolExecutionId: string; completedAt?: string }
export interface ToolExecutionFailedPayload { toolExecutionId: string; error: RuntimeError; completedAt?: string }
export interface ToolExecutionDeniedPayload { toolExecutionId: string; reason: string }
export interface ToolExecutionRuntimeRecordPayload {
  assistantMessageId: string;
  toolExecutionId: string;
  toolCallId: string;
  toolName: string;
  callOrder: number;
  status: string;
}
export interface ToolExecutionDecisionRuntimePayload extends ToolExecutionRuntimeRecordPayload {
  decision: {
    outcome: 'allow' | 'requireApproval' | 'reject';
    reasonCode: string;
    executionClass: 'readOnly' | 'workspaceMutation' | 'processExecution' | 'unknown';
    executionMode: 'parallel' | 'serial';
  };
}
export interface ToolObservationReadyPayload extends ToolExecutionRuntimeRecordPayload {
  observationId: string;
  isError: boolean;
  truncated: boolean;
}
export interface ToolContinuationReadyPayload { assistantMessageId: string; toolExecutionIds: string[] }
export interface ToolContinuationEmittedPayload extends ToolContinuationReadyPayload { emittedAt: string }

export interface ToolEventPayloads {
  'tool_call.requested': ToolCallRequestedPayload;
  'tool_call.started': ToolCallStartedPayload;
  'tool_call.completed': ToolCallCompletedPayload;
  'tool_call.failed': ToolCallFailedPayload;
  'tool.call.created': ToolCallCreatedPayload;
  'tool.call.resolved': ToolCallResolvedPayload;
  'tool.call.resolution_failed': ToolCallResolutionFailedPayload;
  'tool.input.validation_failed': ToolInputValidationFailedPayload;
  'tool_result.created': ToolResultCreatedPayload;
  'tool.result.created': CanonicalToolResultCreatedPayload;
  'tool.registry.sources.ensured': ToolRegistrySourcesEnsuredPayload;
  'tool.registry.snapshot.created': ToolRegistrySnapshotCreatedPayload;
  'tool.registry.entry.resolved': ToolRegistryEntryResolvedPayload;
  'tool.registry.model_visible_tools.derived': ToolRegistryModelVisibleToolsDerivedPayload;
  'tool.execution.requested': ToolExecutionRequestedPayload;
  'tool.execution.validated': ToolExecutionValidatedPayload;
  'tool.execution.decided': ToolExecutionDecisionRuntimePayload;
  'tool.execution.queued': ToolExecutionRuntimeRecordPayload;
  'tool.execution.rejected': ToolExecutionDecisionRuntimePayload;
  'tool.execution.cancelled': ToolExecutionRuntimeRecordPayload;
  'tool.execution.policy_decided': ToolExecutionPolicyDecidedPayload;
  'permission.decision.created': PermissionDecisionCreatedPayload;
  'tool.execution.approval_requested': ToolExecutionApprovalRequestedPayload;
  'tool.execution.started': ToolExecutionStartedPayload;
  'tool.execution.output': ToolExecutionOutputPayload;
  'tool.execution.routed': ToolExecutionRoutedPayload;
  'tool.execution.completed': ToolExecutionCompletedPayload;
  'tool.execution.failed': ToolExecutionFailedPayload;
  'tool.execution.denied': ToolExecutionDeniedPayload;
  'tool.observation.ready': ToolObservationReadyPayload;
  'tool.continuation.ready': ToolContinuationReadyPayload;
  'tool.continuation.emitted': ToolContinuationEmittedPayload;
}
export type ToolEventType = keyof ToolEventPayloads;

const RuntimeToolSourceIdentitySchema = z.object({
  registrySnapshotId: z.string().min(1),
  snapshotEntryId: z.string().min(1),
  modelVisibleName: ToolNameSchema,
  canonicalToolId: z.string().min(1),
  sourceId: z.string().min(1),
  namespace: z.string().min(1),
  sourceToolName: ToolNameSchema,
}).strict();
const distinctExecutionIdentity = <TSchema extends z.ZodRawShape>(schema: z.ZodObject<TSchema>) => schema.refine(
  (payload) => payload.toolExecutionId === undefined || payload.toolExecutionId !== payload.toolCallId,
  { message: 'Tool execution identity must be distinct from the tool call identity.', path: ['toolExecutionId'] },
);
const ToolCallRequestedPayloadSchema = z.object({
  modelCallId: z.string().min(1).optional(), toolCallId: z.string().min(1), toolName: z.string().min(1), input: JsonValueSchema,
}).strict();
const ToolCallStartedPayloadSchema = distinctExecutionIdentity(z.object({
  toolCallId: z.string().min(1), toolExecutionId: z.string().min(1).optional(), toolName: z.string().min(1), input: JsonValueSchema,
}).strict());
const ToolCallCompletedPayloadSchema = distinctExecutionIdentity(z.object({
  toolCallId: z.string().min(1), toolExecutionId: z.string().min(1).optional(), toolName: z.string().min(1),
}).strict());
const ToolCallFailedPayloadSchema = distinctExecutionIdentity(z.object({
  toolCallId: z.string().min(1), toolExecutionId: z.string().min(1).optional(), toolName: z.string().min(1), error: RuntimeErrorSchema,
}).strict());
const ToolCallCreatedPayloadSchema = z.object({
  toolCallId: z.string().min(1), modelCallId: z.string().min(1), providerToolCallId: z.string().min(1), toolName: z.string().min(1), input: JsonValueSchema,
}).strict();
const ToolCallResolvedPayloadSchema = RuntimeToolSourceIdentitySchema.extend({
  toolCallId: z.string().min(1), providerToolCallId: z.string().min(1), requestedToolName: z.string().min(1),
}).strict();
const ToolCallResolutionFailedPayloadSchema = z.object({
  toolCallId: z.string().min(1),
  providerToolCallId: z.string().min(1),
  requestedToolName: z.string().min(1),
  reason: z.enum(['unknown_tool', 'tool_disabled', 'tool_unavailable', 'tool_conflicted', 'tool_not_exposed']),
  message: z.string().min(1),
  sourceIdentity: RuntimeToolSourceIdentitySchema.optional(),
}).strict();
const ToolInputValidationFailedPayloadSchema = z.object({
  toolCallId: z.string().min(1), modelVisibleName: ToolNameSchema, registrySnapshotId: z.string().min(1), snapshotEntryId: z.string().min(1),
  reason: z.literal('invalid_tool_input'), message: z.string().min(1), sourceIdentity: RuntimeToolSourceIdentitySchema,
}).strict();
const AgentRunToolResultCreatedPayloadSchema = distinctExecutionIdentity(z.object({
  toolCallId: z.string().min(1),
  toolExecutionId: z.string().min(1).optional(),
  toolName: z.string().min(1),
  kind: z.enum(['success', 'failure', 'permission_denied', 'user_rejected', 'cancelled']),
  content: ContentBlockListSchema,
  summary: z.string().min(1).optional(),
  error: z.object({ code: z.string().min(1), message: z.string().min(1), details: JsonObjectSchema.optional() }).strict().optional(),
}).strict());
const CanonicalToolResultCreatedPayloadSchema = distinctExecutionIdentity(z.object({
  toolCallId: z.string().min(1),
  toolExecutionId: z.string().min(1).optional(),
  toolName: z.string().min(1).optional(),
  kind: z.enum(['success', 'failed', 'tool_error', 'policy_denied', 'user_rejected', 'redacted', 'invalid_tool_call', 'invalid_tool_input']),
  summary: z.string().min(1),
  sourceIdentity: RuntimeToolSourceIdentitySchema.optional(),
}).strict());
const ToolRegistrySourcesEnsuredPayloadSchema = z.object({ sourceIds: z.array(z.string().min(1)), createdSourceIds: z.array(z.string().min(1)) }).strict();
const ToolRegistrySnapshotCreatedPayloadSchema = z.object({
  snapshotId: z.string().min(1), projectId: z.string().min(1), permissionMode: z.string().min(1), modelId: z.string().min(1),
  registryVersion: z.number().int().positive(), sourceVersionHash: z.string().min(1), sourceCount: z.number().int().nonnegative(),
  entryCount: z.number().int().nonnegative(), exposedCount: z.number().int().nonnegative(),
}).strict();
const ToolRegistryEntryResolvedPayloadSchema = z.object({
  snapshotId: z.string().min(1), snapshotEntryId: z.string().min(1), registrationId: z.string().min(1), canonicalToolId: z.string().min(1),
  modelVisibleName: ToolNameSchema, sourceId: z.string().min(1), namespace: z.string().min(1), sourceToolName: ToolNameSchema,
  effectiveStatus: z.enum(['available', 'disabled', 'unavailable', 'conflicted']), exposedToModel: z.boolean(),
  disabledReason: z.string().min(1).optional(), unavailableReason: z.string().min(1).optional(), conflictReason: z.string().min(1).optional(),
}).strict();
const ToolRegistryModelVisibleToolsDerivedPayloadSchema = z.object({
  snapshotId: z.string().min(1), modelId: z.string().min(1), modelSupportsToolCall: z.boolean(), toolNames: z.array(ToolNameSchema), hiddenCount: z.number().int().nonnegative(),
}).strict();
const ToolExecutionRequestedPayloadSchema = z.object({ toolExecution: ToolExecutionSchema }).strict();
const ToolExecutionValidatedPayloadSchema = z.object({ toolExecutionId: z.string().min(1), toolName: z.string().min(1) }).strict();
const ToolExecutionRuntimeRecordPayloadSchema = z.object({
  assistantMessageId: z.string().min(1), toolExecutionId: z.string().min(1), toolCallId: z.string().min(1), toolName: z.string().min(1),
  callOrder: z.number().int().nonnegative(), status: z.string().min(1),
}).strict();
const ToolExecutionDecisionRuntimePayloadSchema = ToolExecutionRuntimeRecordPayloadSchema.extend({
  decision: z.object({
    outcome: z.enum(['allow', 'requireApproval', 'reject']), reasonCode: z.string().min(1),
    executionClass: z.enum(['readOnly', 'workspaceMutation', 'processExecution', 'unknown']), executionMode: z.enum(['parallel', 'serial']),
  }).strict(),
}).strict();
const ToolExecutionPolicyDecidedPayloadSchema = z.object({
  toolExecutionId: z.string().min(1), toolName: z.string().min(1), policyDecision: ToolPolicyDecisionSchema,
}).strict();
const PermissionDecisionCreatedPayloadSchema = z.object({ permissionDecision: PermissionDecisionSchema }).strict();
const ToolExecutionApprovalRequestedPayloadSchema = z.object({
  toolExecutionId: z.string().min(1), toolName: z.string().min(1), approvalRequest: ApprovalRequestSchema,
}).strict();
const ToolExecutionStartedPayloadSchema = z.object({ toolExecutionId: z.string().min(1), startedAt: RuntimeEventIsoDateTimeSchema.optional() }).strict();
const ToolExecutionOutputPayloadSchema = z.object({ toolExecutionId: z.string().min(1), stream: z.enum(['stdout', 'stderr']), delta: z.string(), truncated: z.boolean() }).strict();
const ToolExecutionRoutedPayloadSchema = RuntimeToolSourceIdentitySchema.extend({
  toolExecutionId: z.string().min(1), toolName: ToolNameSchema, executorKind: z.enum(['built_in', 'mcp', 'plugin', 'project_local', 'skill']),
}).strict();
const ToolExecutionCompletedPayloadSchema = z.object({ toolExecutionId: z.string().min(1), completedAt: RuntimeEventIsoDateTimeSchema.optional() }).strict();
const ToolExecutionFailedPayloadSchema = z.object({ toolExecutionId: z.string().min(1), error: RuntimeErrorSchema, completedAt: RuntimeEventIsoDateTimeSchema.optional() }).strict();
const ToolExecutionDeniedPayloadSchema = z.object({ toolExecutionId: z.string().min(1), reason: z.string().min(1) }).strict();
const ToolObservationReadyPayloadSchema = ToolExecutionRuntimeRecordPayloadSchema.extend({ observationId: z.string().min(1), isError: z.boolean(), truncated: z.boolean() }).strict();
const ToolContinuationReadyPayloadSchema = z.object({ assistantMessageId: z.string().min(1), toolExecutionIds: z.array(z.string().min(1)) }).strict();
const ToolContinuationEmittedPayloadSchema = ToolContinuationReadyPayloadSchema.extend({ emittedAt: RuntimeEventIsoDateTimeSchema }).strict();

export const AgentRunToolCallRequestedEventSchema = eventSchema('tool_call.requested', ToolCallRequestedPayloadSchema);
export const AgentRunToolCallStartedEventSchema = eventSchema('tool_call.started', ToolCallStartedPayloadSchema);
export const AgentRunToolCallCompletedEventSchema = eventSchema('tool_call.completed', ToolCallCompletedPayloadSchema);
export const AgentRunToolCallFailedEventSchema = eventSchema('tool_call.failed', ToolCallFailedPayloadSchema);
export const ToolCallCreatedEventSchema = eventSchema('tool.call.created', ToolCallCreatedPayloadSchema);
export const ToolCallResolvedEventSchema = eventSchema('tool.call.resolved', ToolCallResolvedPayloadSchema);
export const ToolCallResolutionFailedEventSchema = eventSchema('tool.call.resolution_failed', ToolCallResolutionFailedPayloadSchema);
export const ToolInputValidationFailedEventSchema = eventSchema('tool.input.validation_failed', ToolInputValidationFailedPayloadSchema);
export const AgentRunToolResultCreatedEventSchema = eventSchema('tool_result.created', AgentRunToolResultCreatedPayloadSchema);
export const ToolResultCreatedEventSchema = eventSchema('tool.result.created', CanonicalToolResultCreatedPayloadSchema);
export const ToolRegistrySourcesEnsuredEventSchema = eventSchema('tool.registry.sources.ensured', ToolRegistrySourcesEnsuredPayloadSchema);
export const ToolRegistrySnapshotCreatedEventSchema = eventSchema('tool.registry.snapshot.created', ToolRegistrySnapshotCreatedPayloadSchema);
export const ToolRegistryEntryResolvedEventSchema = eventSchema('tool.registry.entry.resolved', ToolRegistryEntryResolvedPayloadSchema);
export const ToolRegistryModelVisibleToolsDerivedEventSchema = eventSchema('tool.registry.model_visible_tools.derived', ToolRegistryModelVisibleToolsDerivedPayloadSchema);
export const ToolExecutionRequestedEventSchema = eventSchema('tool.execution.requested', ToolExecutionRequestedPayloadSchema);
export const ToolExecutionValidatedEventSchema = eventSchema('tool.execution.validated', ToolExecutionValidatedPayloadSchema);
export const ToolExecutionDecidedEventSchema = eventSchema('tool.execution.decided', ToolExecutionDecisionRuntimePayloadSchema);
export const ToolExecutionQueuedEventSchema = eventSchema('tool.execution.queued', ToolExecutionRuntimeRecordPayloadSchema);
export const ToolExecutionRejectedEventSchema = eventSchema('tool.execution.rejected', ToolExecutionDecisionRuntimePayloadSchema);
export const ToolExecutionCancelledEventSchema = eventSchema('tool.execution.cancelled', ToolExecutionRuntimeRecordPayloadSchema);
export const ToolExecutionPolicyDecidedEventSchema = eventSchema('tool.execution.policy_decided', ToolExecutionPolicyDecidedPayloadSchema);
export const PermissionDecisionCreatedEventSchema = eventSchema('permission.decision.created', PermissionDecisionCreatedPayloadSchema);
export const ToolExecutionApprovalRequestedEventSchema = eventSchema('tool.execution.approval_requested', ToolExecutionApprovalRequestedPayloadSchema);
export const ToolExecutionStartedEventSchema = eventSchema('tool.execution.started', ToolExecutionStartedPayloadSchema);
export const ToolExecutionOutputEventSchema = eventSchema('tool.execution.output', ToolExecutionOutputPayloadSchema);
export const ToolExecutionRoutedEventSchema = eventSchema('tool.execution.routed', ToolExecutionRoutedPayloadSchema);
export const ToolExecutionCompletedEventSchema = eventSchema('tool.execution.completed', ToolExecutionCompletedPayloadSchema);
export const ToolExecutionFailedEventSchema = eventSchema('tool.execution.failed', ToolExecutionFailedPayloadSchema);
export const ToolExecutionDeniedEventSchema = eventSchema('tool.execution.denied', ToolExecutionDeniedPayloadSchema);
export const ToolObservationReadyEventSchema = eventSchema('tool.observation.ready', ToolObservationReadyPayloadSchema);
export const ToolContinuationReadyEventSchema = eventSchema('tool.continuation.ready', ToolContinuationReadyPayloadSchema);
export const ToolContinuationEmittedEventSchema = eventSchema('tool.continuation.emitted', ToolContinuationEmittedPayloadSchema);

export const TOOL_EVENT_SCHEMAS = {
  'tool_call.requested': AgentRunToolCallRequestedEventSchema,
  'tool_call.started': AgentRunToolCallStartedEventSchema,
  'tool_call.completed': AgentRunToolCallCompletedEventSchema,
  'tool_call.failed': AgentRunToolCallFailedEventSchema,
  'tool.call.created': ToolCallCreatedEventSchema,
  'tool.call.resolved': ToolCallResolvedEventSchema,
  'tool.call.resolution_failed': ToolCallResolutionFailedEventSchema,
  'tool.input.validation_failed': ToolInputValidationFailedEventSchema,
  'tool_result.created': AgentRunToolResultCreatedEventSchema,
  'tool.result.created': ToolResultCreatedEventSchema,
  'tool.registry.sources.ensured': ToolRegistrySourcesEnsuredEventSchema,
  'tool.registry.snapshot.created': ToolRegistrySnapshotCreatedEventSchema,
  'tool.registry.entry.resolved': ToolRegistryEntryResolvedEventSchema,
  'tool.registry.model_visible_tools.derived': ToolRegistryModelVisibleToolsDerivedEventSchema,
  'tool.execution.requested': ToolExecutionRequestedEventSchema,
  'tool.execution.validated': ToolExecutionValidatedEventSchema,
  'tool.execution.decided': ToolExecutionDecidedEventSchema,
  'tool.execution.queued': ToolExecutionQueuedEventSchema,
  'tool.execution.rejected': ToolExecutionRejectedEventSchema,
  'tool.execution.cancelled': ToolExecutionCancelledEventSchema,
  'tool.execution.policy_decided': ToolExecutionPolicyDecidedEventSchema,
  'permission.decision.created': PermissionDecisionCreatedEventSchema,
  'tool.execution.approval_requested': ToolExecutionApprovalRequestedEventSchema,
  'tool.execution.started': ToolExecutionStartedEventSchema,
  'tool.execution.output': ToolExecutionOutputEventSchema,
  'tool.execution.routed': ToolExecutionRoutedEventSchema,
  'tool.execution.completed': ToolExecutionCompletedEventSchema,
  'tool.execution.failed': ToolExecutionFailedEventSchema,
  'tool.execution.denied': ToolExecutionDeniedEventSchema,
  'tool.observation.ready': ToolObservationReadyEventSchema,
  'tool.continuation.ready': ToolContinuationReadyEventSchema,
  'tool.continuation.emitted': ToolContinuationEmittedEventSchema,
} as const;

export function createToolEvent<TType extends ToolEventType>(input: RunRuntimeEventFactoryInput<TType>): TypedRuntimeEvent<TType> {
  return createRuntimeEvent(input);
}
export function createToolCallCreatedEvent(input: RunRuntimeEventFactoryInput<'tool.call.created'>): TypedRuntimeEvent<'tool.call.created'> { return createRuntimeEvent(input); }
export function createToolResultCreatedEvent(input: RunRuntimeEventFactoryInput<'tool.result.created'>): TypedRuntimeEvent<'tool.result.created'> { return createRuntimeEvent(input); }

type ToolDefaultInput<TType extends ToolEventType> = Omit<RunRuntimeEventFactoryInput<TType>, 'eventType' | 'source' | 'visibility' | 'persist'>;
function createDebugToolEvent<TType extends ToolEventType>(eventType: TType, input: ToolDefaultInput<TType>): TypedRuntimeEvent<TType> {
  return createRuntimeEvent({ ...input, eventType, source: 'tool', visibility: 'debug', persist: 'required' } as RunRuntimeEventFactoryInput<TType>);
}
export function createToolCallResolvedEvent(input: ToolDefaultInput<'tool.call.resolved'>) { return createDebugToolEvent('tool.call.resolved', input); }
export function createToolCallResolutionFailedEvent(input: ToolDefaultInput<'tool.call.resolution_failed'>) { return createDebugToolEvent('tool.call.resolution_failed', input); }
export function createToolInputValidationFailedEvent(input: ToolDefaultInput<'tool.input.validation_failed'>) { return createDebugToolEvent('tool.input.validation_failed', input); }
export function createToolRegistrySourcesEnsuredEvent(input: ToolDefaultInput<'tool.registry.sources.ensured'>) { return createDebugToolEvent('tool.registry.sources.ensured', input); }
export function createToolRegistrySnapshotCreatedEvent(input: ToolDefaultInput<'tool.registry.snapshot.created'>) { return createDebugToolEvent('tool.registry.snapshot.created', input); }
export function createToolRegistryEntryResolvedEvent(input: ToolDefaultInput<'tool.registry.entry.resolved'>) { return createDebugToolEvent('tool.registry.entry.resolved', input); }
export function createToolRegistryModelVisibleToolsDerivedEvent(input: ToolDefaultInput<'tool.registry.model_visible_tools.derived'>) { return createDebugToolEvent('tool.registry.model_visible_tools.derived', input); }
export function createToolExecutionRoutedEvent(input: ToolDefaultInput<'tool.execution.routed'>) { return createDebugToolEvent('tool.execution.routed', input); }

export function createToolExecutionRequestedEvent(input: RunRuntimeEventFactoryInput<'tool.execution.requested'>) { return createRuntimeEvent(input); }
export function createToolExecutionValidatedEvent(input: RunRuntimeEventFactoryInput<'tool.execution.validated'>) { return createRuntimeEvent(input); }
export function createToolExecutionDecidedEvent(input: RunRuntimeEventFactoryInput<'tool.execution.decided'>) { return createRuntimeEvent(input); }
export function createToolExecutionQueuedEvent(input: RunRuntimeEventFactoryInput<'tool.execution.queued'>) { return createRuntimeEvent(input); }
export function createToolExecutionRejectedEvent(input: RunRuntimeEventFactoryInput<'tool.execution.rejected'>) { return createRuntimeEvent(input); }
export function createToolExecutionCancelledEvent(input: RunRuntimeEventFactoryInput<'tool.execution.cancelled'>) { return createRuntimeEvent(input); }
export function createToolExecutionPolicyDecidedEvent(input: RunRuntimeEventFactoryInput<'tool.execution.policy_decided'>) { return createRuntimeEvent(input); }
export function createPermissionDecisionCreatedEvent(input: RunRuntimeEventFactoryInput<'permission.decision.created'>) { return createRuntimeEvent(input); }
export function createToolExecutionApprovalRequestedEvent(input: RunRuntimeEventFactoryInput<'tool.execution.approval_requested'>) { return createRuntimeEvent(input); }
export function createToolExecutionStartedEvent(input: RunRuntimeEventFactoryInput<'tool.execution.started'>) { return createRuntimeEvent(input); }
export function createToolExecutionOutputEvent(input: RunRuntimeEventFactoryInput<'tool.execution.output'>) { return createRuntimeEvent(input); }
export function createToolExecutionCompletedEvent(input: RunRuntimeEventFactoryInput<'tool.execution.completed'>) { return createRuntimeEvent(input); }
export function createToolExecutionFailedEvent(input: RunRuntimeEventFactoryInput<'tool.execution.failed'>) { return createRuntimeEvent(input); }
export function createToolExecutionDeniedEvent(input: RunRuntimeEventFactoryInput<'tool.execution.denied'>) { return createRuntimeEvent(input); }
export function createToolObservationReadyEvent(input: RunRuntimeEventFactoryInput<'tool.observation.ready'>) { return createRuntimeEvent(input); }
export function createToolContinuationReadyEvent(input: RunRuntimeEventFactoryInput<'tool.continuation.ready'>) { return createRuntimeEvent(input); }
export function createToolContinuationEmittedEvent(input: RunRuntimeEventFactoryInput<'tool.continuation.emitted'>) { return createRuntimeEvent(input); }
