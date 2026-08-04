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
  'run.ended': eventSchema('run.ended', RunEventSchemas['run.ended']),
  'turn.started': eventSchema('turn.started', TurnEventSchemas['turn.started']),
  'turn.ended': eventSchema('turn.ended', TurnEventSchemas['turn.ended']),
  'message.started': eventSchema('message.started', MessageEventSchemas['message.started']),
  'message.update': eventSchema('message.update', MessageEventSchemas['message.update']),
  'message.ended': eventSchema('message.ended', MessageEventSchemas['message.ended']),
  'tool_execution.started': eventSchema('tool_execution.started', ToolEventSchemas['tool_execution.started']),
  'tool_execution.update': eventSchema('tool_execution.update', ToolEventSchemas['tool_execution.update']),
  'tool_execution.ended': eventSchema('tool_execution.ended', ToolEventSchemas['tool_execution.ended']),
  'approval.requested': eventSchema('approval.requested', ApprovalEventSchemas['approval.requested']),
  'approval.resolved': eventSchema('approval.resolved', ApprovalEventSchemas['approval.resolved']),
  'compaction.started': eventSchema('compaction.started', SessionEventSchemas['compaction.started']),
  'compaction.ended': eventSchema('compaction.ended', SessionEventSchemas['compaction.ended']),
  'branch_marker.created': eventSchema('branch_marker.created', SessionEventSchemas['branch_marker.created']),
  'branch_draft.cancelled': eventSchema('branch_draft.cancelled', SessionEventSchemas['branch_draft.cancelled']),
} as const;

export type EventSchemaByType = typeof EventSchemas;
export type ParsedEvent = z.infer<(typeof EventSchemas)[keyof typeof EventSchemas]>;

/** Discriminated-union validator for any complete event crossing a boundary. */
export const EventSchema = z.discriminatedUnion('type', [
  EventSchemas['run.started'],
  EventSchemas['run.ended'],
  EventSchemas['turn.started'],
  EventSchemas['turn.ended'],
  EventSchemas['message.started'],
  EventSchemas['message.update'],
  EventSchemas['message.ended'],
  EventSchemas['tool_execution.started'],
  EventSchemas['tool_execution.update'],
  EventSchemas['tool_execution.ended'],
  EventSchemas['approval.requested'],
  EventSchemas['approval.resolved'],
  EventSchemas['compaction.started'],
  EventSchemas['compaction.ended'],
  EventSchemas['branch_marker.created'],
  EventSchemas['branch_draft.cancelled'],
]);
