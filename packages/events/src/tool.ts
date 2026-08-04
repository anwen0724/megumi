/*
 * Tool execution lifecycle layer: one tool run, from request to result.
 * tool_execution.requested is emitted as soon as the model asks for the tool
 * (the turn's stopReason is tool_calls); started means it is actually being
 * executed, which approval may sit between. Long-running tools may emit
 * tool_execution.update with streaming output; instant tools go straight
 * requested → started → ended.
 *
 * The zod schemas are the single source of truth; the payload types are
 * derived from them so they can never drift apart.
 */

import { z } from 'zod';

export const ToolExecutionRequestedPayloadSchema = z.object({
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
  args: z.record(z.string(), z.unknown()),
}).strict();

export const ToolExecutionStartedPayloadSchema = z.object({
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
  args: z.record(z.string(), z.unknown()),
}).strict();

export const ToolExecutionUpdatePayloadSchema = z.object({
  toolCallId: z.string().min(1),
  /** Streaming output produced so far (full snapshot, like message.update). */
  output: z.string(),
}).strict();

export const ToolExecutionEndedPayloadSchema = z.object({
  toolCallId: z.string().min(1),
  status: z.enum(['completed', 'failed', 'cancelled', 'denied']),
  /** Present when status is 'completed'. */
  result: z.unknown().optional(),
  error: z.object({
    message: z.string().min(1),
    code: z.string().optional(),
  }).optional(),
}).strict();

export type ToolExecutionRequestedPayload = z.infer<typeof ToolExecutionRequestedPayloadSchema>;
export type ToolExecutionStartedPayload = z.infer<typeof ToolExecutionStartedPayloadSchema>;
export type ToolExecutionUpdatePayload = z.infer<typeof ToolExecutionUpdatePayloadSchema>;
export type ToolExecutionEndedPayload = z.infer<typeof ToolExecutionEndedPayloadSchema>;

export const ToolEventSchemas = {
  'tool_execution.requested': ToolExecutionRequestedPayloadSchema,
  'tool_execution.started': ToolExecutionStartedPayloadSchema,
  'tool_execution.update': ToolExecutionUpdatePayloadSchema,
  'tool_execution.ended': ToolExecutionEndedPayloadSchema,
} as const;

export type ToolEventPayloadByType = {
  [TType in keyof typeof ToolEventSchemas]: z.infer<(typeof ToolEventSchemas)[TType]>;
};

export type ToolEventType = keyof ToolEventPayloadByType;
