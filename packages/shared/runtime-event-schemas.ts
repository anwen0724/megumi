import { z } from 'zod';
import { JsonObjectSchema } from './json';
import { RuntimeContextSchema } from './runtime-context';
import { RuntimeErrorSchema } from './runtime-errors';
import {
  AgentActionKindSchema,
  AgentActionStatusSchema,
  AgentObservationSourceSchema,
  AgentRunStatusSchema,
  AgentSessionStatusSchema,
  AgentStepKindSchema,
  AgentStepStatusSchema,
  MessageStatusSchema,
} from './agent-lifecycle-contracts';
import {
  RUNTIME_EVENT_PERSIST_MODES,
  RUNTIME_EVENT_SCHEMA_VERSION,
  RUNTIME_EVENT_SOURCES,
  RUNTIME_EVENT_TYPES,
  RUNTIME_EVENT_VISIBILITIES,
  type RuntimeEvent,
  type RuntimeEventPersistMode,
  type RuntimeEventSource,
  type RuntimeEventType,
  type RuntimeEventVisibility,
} from './runtime-events';

const RUNTIME_EVENT_TYPE_VALUES = [...RUNTIME_EVENT_TYPES] as [
  RuntimeEventType,
  ...RuntimeEventType[],
];
const RUNTIME_EVENT_SOURCE_VALUES = [...RUNTIME_EVENT_SOURCES] as [
  RuntimeEventSource,
  ...RuntimeEventSource[],
];
const RUNTIME_EVENT_VISIBILITY_VALUES = [...RUNTIME_EVENT_VISIBILITIES] as [
  RuntimeEventVisibility,
  ...RuntimeEventVisibility[],
];
const RUNTIME_EVENT_PERSIST_MODE_VALUES = [...RUNTIME_EVENT_PERSIST_MODES] as [
  RuntimeEventPersistMode,
  ...RuntimeEventPersistMode[],
];

export const RuntimeEventTypeSchema = z.enum(RUNTIME_EVENT_TYPE_VALUES);
export const RuntimeEventSourceSchema = z.enum(RUNTIME_EVENT_SOURCE_VALUES);
export const RuntimeEventVisibilitySchema = z.enum(RUNTIME_EVENT_VISIBILITY_VALUES);
export const RuntimeEventPersistModeSchema = z.enum(RUNTIME_EVENT_PERSIST_MODE_VALUES);

export const RuntimeEventIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9:_-]+$/, 'Event id must contain only letters, numbers, colon, underscore, or hyphen.');

export const RuntimeEventSequenceSchema = z.number().int().positive();
export const RuntimeEventIsoDateTimeSchema = z.string().datetime({ offset: true });

const RuntimeEventBaseSchema = z
  .object({
    eventId: RuntimeEventIdSchema,
    schemaVersion: z.literal(RUNTIME_EVENT_SCHEMA_VERSION),
    runId: z.string().min(1),
    sessionId: z.string().min(1).optional(),
    stepId: z.string().min(1).optional(),
    actionId: z.string().min(1).optional(),
    observationId: z.string().min(1).optional(),
    messageId: z.string().min(1).optional(),
    requestId: z.string().min(1).optional(),
    context: RuntimeContextSchema.optional(),
    sequence: RuntimeEventSequenceSchema,
    createdAt: RuntimeEventIsoDateTimeSchema,
    source: RuntimeEventSourceSchema,
    visibility: RuntimeEventVisibilitySchema,
    persist: RuntimeEventPersistModeSchema,
  })
  .strict();

const ChatUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    totalTokens: z.number().int().nonnegative().optional(),
  })
  .strict();

const SessionCreatedPayloadSchema = z
  .object({
    title: z.string().min(1),
    status: AgentSessionStatusSchema,
  })
  .strict();

const SessionUpdatedPayloadSchema = z
  .object({
    changedFields: z.array(z.string().min(1)).min(1),
  })
  .strict();

const RunCreatedPayloadSchema = z
  .object({
    status: AgentRunStatusSchema,
    mode: z.string().min(1),
    goal: z.string().min(1),
    triggerMessageId: z.string().min(1).optional(),
  })
  .strict();

const RunStartedPayloadSchema = z
  .object({
    providerId: z.string().min(1).optional(),
    modelId: z.string().min(1).optional(),
    runKind: z.enum(['chat', 'agent']),
  })
  .strict();

const RunStatusChangedPayloadSchema = z
  .object({
    from: AgentRunStatusSchema,
    to: AgentRunStatusSchema,
  })
  .strict();

const StepCreatedPayloadSchema = z
  .object({
    kind: AgentStepKindSchema,
    status: AgentStepStatusSchema,
    title: z.string().min(1).optional(),
  })
  .strict();

const StepStartedPayloadSchema = z.object({ kind: AgentStepKindSchema }).strict();

const StepStatusChangedPayloadSchema = z
  .object({
    from: AgentStepStatusSchema,
    to: AgentStepStatusSchema,
  })
  .strict();

const StepCompletedPayloadSchema = z.object({ kind: AgentStepKindSchema }).strict();

const StepFailedPayloadSchema = z
  .object({
    kind: AgentStepKindSchema,
    error: RuntimeErrorSchema,
  })
  .strict();

const ActionRequestedPayloadSchema = z
  .object({
    kind: AgentActionKindSchema,
    status: AgentActionStatusSchema,
    inputPreview: JsonObjectSchema.optional(),
  })
  .strict();

const ObservationReceivedPayloadSchema = z
  .object({
    source: AgentObservationSourceSchema,
    kind: z.string().min(1),
    summary: z.string().optional(),
  })
  .strict();

const MessageDeltaPayloadSchema = z
  .object({
    messageId: z.string().min(1),
    delta: z.string(),
  })
  .strict();

const MessageCompletedPayloadSchema = z
  .object({
    messageId: z.string().min(1),
    status: MessageStatusSchema,
  })
  .strict();

const ErrorRaisedPayloadSchema = z.object({ error: RuntimeErrorSchema }).strict();

const AssistantOutputDeltaPayloadSchema = z.object({ delta: z.string() }).strict();

const AssistantOutputCompletedPayloadSchema = z
  .object({
    content: z.string(),
    messageId: z.string().min(1).optional(),
    usage: ChatUsageSchema.optional(),
  })
  .strict();

const RunCompletedPayloadSchema = z.object({ usage: ChatUsageSchema.optional() }).strict();
const RunFailedPayloadSchema = z.object({ error: RuntimeErrorSchema }).strict();
const RunCancelledPayloadSchema = z
  .object({
    reason: z.string().min(1).optional(),
    error: RuntimeErrorSchema.optional(),
  })
  .strict();

const ToolCallRequestedPayloadSchema = z
  .object({
    toolCallId: z.string().min(1),
    toolName: z.string().min(1),
    inputPreview: JsonObjectSchema.optional(),
    approvalRequired: z.boolean(),
  })
  .strict();

const ToolCallStartedPayloadSchema = z
  .object({
    toolCallId: z.string().min(1),
    toolName: z.string().min(1),
  })
  .strict();

const ToolCallCompletedPayloadSchema = z
  .object({
    toolCallId: z.string().min(1),
    toolName: z.string().min(1),
    resultPreview: JsonObjectSchema.optional(),
    durationMs: z.number().nonnegative().optional(),
  })
  .strict();

const ToolCallFailedPayloadSchema = z
  .object({
    toolCallId: z.string().min(1),
    toolName: z.string().min(1),
    error: RuntimeErrorSchema,
    durationMs: z.number().nonnegative().optional(),
  })
  .strict();

const ApprovalRequestedPayloadSchema = z
  .object({
    approvalId: z.string().min(1),
    toolCallId: z.string().min(1).optional(),
    title: z.string().min(1),
    description: z.string().min(1),
    riskLevel: z.enum(['low', 'medium', 'high']),
  })
  .strict();

const ApprovalResolvedPayloadSchema = z
  .object({
    approvalId: z.string().min(1),
    decision: z.enum(['approved', 'denied']),
    decidedAt: RuntimeEventIsoDateTimeSchema,
  })
  .strict();

const ArtifactCreatedPayloadSchema = z
  .object({
    artifactId: z.string().min(1),
    title: z.string().min(1),
    kind: z.enum(['file', 'document', 'code', 'image', 'other']),
    path: z.string().min(1).optional(),
  })
  .strict();

const MemoryCreatedPayloadSchema = z
  .object({
    memoryId: z.string().min(1),
    title: z.string().min(1),
    summary: z.string().min(1),
  })
  .strict();

function eventSchema<TType extends RuntimeEventType, TPayloadSchema extends z.ZodTypeAny>(
  eventType: TType,
  payload: TPayloadSchema,
) {
  return RuntimeEventBaseSchema.extend({
    eventType: z.literal(eventType),
    payload,
  }).strict();
}

export const SessionCreatedEventSchema = eventSchema('session.created', SessionCreatedPayloadSchema);
export const SessionUpdatedEventSchema = eventSchema('session.updated', SessionUpdatedPayloadSchema);
export const RunCreatedEventSchema = eventSchema('run.created', RunCreatedPayloadSchema);
export const RunStartedEventSchema = eventSchema('run.started', RunStartedPayloadSchema);
export const RunStatusChangedEventSchema = eventSchema('run.status.changed', RunStatusChangedPayloadSchema);
export const RunCompletedEventSchema = eventSchema('run.completed', RunCompletedPayloadSchema);
export const RunFailedEventSchema = eventSchema('run.failed', RunFailedPayloadSchema);
export const RunCancelledEventSchema = eventSchema('run.cancelled', RunCancelledPayloadSchema);
export const StepCreatedEventSchema = eventSchema('step.created', StepCreatedPayloadSchema);
export const StepStartedEventSchema = eventSchema('step.started', StepStartedPayloadSchema);
export const StepStatusChangedEventSchema = eventSchema('step.status.changed', StepStatusChangedPayloadSchema);
export const StepCompletedEventSchema = eventSchema('step.completed', StepCompletedPayloadSchema);
export const StepFailedEventSchema = eventSchema('step.failed', StepFailedPayloadSchema);
export const ActionRequestedEventSchema = eventSchema('action.requested', ActionRequestedPayloadSchema);
export const ObservationReceivedEventSchema = eventSchema('observation.received', ObservationReceivedPayloadSchema);
export const MessageDeltaEventSchema = eventSchema('message.delta', MessageDeltaPayloadSchema);
export const MessageCompletedEventSchema = eventSchema('message.completed', MessageCompletedPayloadSchema);
export const ErrorRaisedEventSchema = eventSchema('error.raised', ErrorRaisedPayloadSchema);
export const AssistantOutputDeltaEventSchema = eventSchema('assistant.output.delta', AssistantOutputDeltaPayloadSchema);
export const AssistantOutputCompletedEventSchema = eventSchema(
  'assistant.output.completed',
  AssistantOutputCompletedPayloadSchema,
);
export const ToolCallRequestedEventSchema = eventSchema('tool.call.requested', ToolCallRequestedPayloadSchema);
export const ToolCallStartedEventSchema = eventSchema('tool.call.started', ToolCallStartedPayloadSchema);
export const ToolCallCompletedEventSchema = eventSchema('tool.call.completed', ToolCallCompletedPayloadSchema);
export const ToolCallFailedEventSchema = eventSchema('tool.call.failed', ToolCallFailedPayloadSchema);
export const ApprovalRequestedEventSchema = eventSchema('approval.requested', ApprovalRequestedPayloadSchema);
export const ApprovalResolvedEventSchema = eventSchema('approval.resolved', ApprovalResolvedPayloadSchema);
export const ArtifactCreatedEventSchema = eventSchema('artifact.created', ArtifactCreatedPayloadSchema);
export const MemoryCreatedEventSchema = eventSchema('memory.created', MemoryCreatedPayloadSchema);

export const RuntimeEventSchema = z.discriminatedUnion('eventType', [
  SessionCreatedEventSchema,
  SessionUpdatedEventSchema,
  RunCreatedEventSchema,
  RunStartedEventSchema,
  RunStatusChangedEventSchema,
  RunCompletedEventSchema,
  RunFailedEventSchema,
  RunCancelledEventSchema,
  StepCreatedEventSchema,
  StepStartedEventSchema,
  StepStatusChangedEventSchema,
  StepCompletedEventSchema,
  StepFailedEventSchema,
  ActionRequestedEventSchema,
  ObservationReceivedEventSchema,
  MessageDeltaEventSchema,
  MessageCompletedEventSchema,
  ErrorRaisedEventSchema,
  AssistantOutputDeltaEventSchema,
  AssistantOutputCompletedEventSchema,
  ToolCallRequestedEventSchema,
  ToolCallStartedEventSchema,
  ToolCallCompletedEventSchema,
  ToolCallFailedEventSchema,
  ApprovalRequestedEventSchema,
  ApprovalResolvedEventSchema,
  ArtifactCreatedEventSchema,
  MemoryCreatedEventSchema,
]);

export { isTerminalRuntimeEvent } from './runtime-events';

export function createRuntimeEventSchema<TType extends RuntimeEventType, TPayload extends object>(
  eventType: TType,
  payload: TPayload,
): Pick<RuntimeEvent<TPayload>, 'eventType' | 'payload'> {
  return { eventType, payload };
}

export type RuntimeEventFromSchema = z.infer<typeof RuntimeEventSchema>;
