/*
 * Complete event validation, assembled from the lifecycle layers' payload
 * schemas and the shared envelope schema. Used at the IPC boundary to decide
 * whether an event may cross processes; a strict schema rejects anything the
 * domain did not define.
 */

import { z } from 'zod';
import { ApprovalEventSchemas } from './approval';
import { MessageEventSchemas } from './message';
import { RunEventSchemas } from './run';
import { SessionEventSchemas } from './session';
import { ToolEventSchemas } from './tool';
import { TurnEventSchemas } from './turn';

export const EventIdSchema = z.string().min(1).max(128).regex(
  /^[A-Za-z0-9:_-]+$/,
  'Event id must contain only letters, numbers, colon, underscore, or hyphen.',
);
export const EventSequenceSchema = z.number().int().positive();
export const EventIsoDateTimeSchema = z.string().datetime({ offset: true });

const EventBaseSchema = z.object({
  id: EventIdSchema,
  sessionId: z.string().min(1),
  runId: z.string().min(1).optional(),
  sequence: EventSequenceSchema,
  createdAt: EventIsoDateTimeSchema,
}).strict();

function eventSchema<TType extends string, TPayloadSchema extends z.ZodTypeAny>(
  eventType: TType,
  payload: TPayloadSchema,
) {
  return EventBaseSchema.extend({ type: z.literal(eventType), payload }).strict();
}

/** Full per-type event schemas: envelope plus the layer's payload. */
export const EventSchemas = {
  'run.started': eventSchema('run.started', RunEventSchemas['run.started']),
  'run.cancel.requested': eventSchema('run.cancel.requested', RunEventSchemas['run.cancel.requested']),
  'run.ended': eventSchema('run.ended', RunEventSchemas['run.ended']),
  'turn.started': eventSchema('turn.started', TurnEventSchemas['turn.started']),
  'turn.ended': eventSchema('turn.ended', TurnEventSchemas['turn.ended']),
  'turn.retry.started': eventSchema('turn.retry.started', TurnEventSchemas['turn.retry.started']),
  'turn.retry.completed': eventSchema('turn.retry.completed', TurnEventSchemas['turn.retry.completed']),
  'turn.retry.failed': eventSchema('turn.retry.failed', TurnEventSchemas['turn.retry.failed']),
  'message.started': eventSchema('message.started', MessageEventSchemas['message.started']),
  'message.update': eventSchema('message.update', MessageEventSchemas['message.update']),
  'message.thinking.update': eventSchema('message.thinking.update', MessageEventSchemas['message.thinking.update']),
  'message.ended': eventSchema('message.ended', MessageEventSchemas['message.ended']),
  'tool_execution.requested': eventSchema('tool_execution.requested', ToolEventSchemas['tool_execution.requested']),
  'tool_execution.started': eventSchema('tool_execution.started', ToolEventSchemas['tool_execution.started']),
  'tool_execution.update': eventSchema('tool_execution.update', ToolEventSchemas['tool_execution.update']),
  'tool_execution.plan_updated': eventSchema('tool_execution.plan_updated', ToolEventSchemas['tool_execution.plan_updated']),
  'tool_execution.ended': eventSchema('tool_execution.ended', ToolEventSchemas['tool_execution.ended']),
  'approval.requested': eventSchema('approval.requested', ApprovalEventSchemas['approval.requested']),
  'approval.resolved': eventSchema('approval.resolved', ApprovalEventSchemas['approval.resolved']),
  'session.compaction.started': eventSchema('session.compaction.started', SessionEventSchemas['session.compaction.started']),
  'session.compaction.ended': eventSchema('session.compaction.ended', SessionEventSchemas['session.compaction.ended']),
  'session.branch_marker.created': eventSchema('session.branch_marker.created', SessionEventSchemas['session.branch_marker.created']),
  'session.branch_draft.cancelled': eventSchema('session.branch_draft.cancelled', SessionEventSchemas['session.branch_draft.cancelled']),
} as const;

export type EventSchemaByType = typeof EventSchemas;
export type ParsedEvent = z.infer<(typeof EventSchemas)[keyof typeof EventSchemas]>;

/** Discriminated-union validator for any complete event crossing a boundary. */
export const EventSchema = z.discriminatedUnion('type', [
  EventSchemas['run.started'],
  EventSchemas['run.cancel.requested'],
  EventSchemas['run.ended'],
  EventSchemas['turn.started'],
  EventSchemas['turn.ended'],
  EventSchemas['turn.retry.started'],
  EventSchemas['turn.retry.completed'],
  EventSchemas['turn.retry.failed'],
  EventSchemas['message.started'],
  EventSchemas['message.update'],
  EventSchemas['message.thinking.update'],
  EventSchemas['message.ended'],
  EventSchemas['tool_execution.requested'],
  EventSchemas['tool_execution.started'],
  EventSchemas['tool_execution.update'],
  EventSchemas['tool_execution.plan_updated'],
  EventSchemas['tool_execution.ended'],
  EventSchemas['approval.requested'],
  EventSchemas['approval.resolved'],
  EventSchemas['session.compaction.started'],
  EventSchemas['session.compaction.ended'],
  EventSchemas['session.branch_marker.created'],
  EventSchemas['session.branch_draft.cancelled'],
]);
