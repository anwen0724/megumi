/* Defines Coding observation events and their desktop protocol. */
import type { AgentEvent } from '@megumi/agent';
import type { Message } from '@megumi/ai';
import { z } from 'zod';
import type { EventBus } from '../application';
import type { ApprovalEventPayloadByType } from '../approval-contracts';
import { ApprovalEventSchemas } from '../approval-contracts';

/** Projects Agent observations into the existing UI event protocol without saving messages. */
export function createSessionEventObserver(options: {
  readonly sessionId: string;
  readonly events: Pick<EventBus, 'publish'>;
  readonly userText: string;
}): (event: AgentEvent) => void {
  const startedMessages = new Set<string>();
  const unsavedMessages = new Map<string, Message>();
  const executingTools = new Set<string>();
  const outputs = new Map<string, string>();
  let toolTurn: { messageId: string; toolCallIds: string[]; pending: Set<string> } | undefined;
  return (event) => {
    const publish = <T extends EventType>(type: T, payload: EventPayloadByType[T]) =>
      options.events.publish({
        type,
        payload,
        sessionId: options.sessionId,
        executionId: event.runId,
      });
    const startMessage = (messageId: string, role: MessageRole) => {
      if (startedMessages.has(messageId)) return;
      startedMessages.add(messageId);
      if (role === 'assistant') publish('turn.started', { messageId });
      publish('message.started', { messageId, role });
    };
    if (event.type === 'model_update') {
      startMessage(event.messageId, 'assistant');
      publish('message.update', {
        messageId: event.messageId,
        role: 'assistant',
        content: messageText(event.message),
      });
      publish('message.thinking.update', {
        messageId: event.messageId,
        thinking: event.message.content
          .filter((block) => block.type === 'thinking')
          .map((block) => block.thinking)
          .join(''),
      });
    } else if (event.type === 'message' && event.message.role !== 'system') {
      startMessage(
        event.messageId,
        event.message.role === 'toolResult' ? 'tool_result' : event.message.role,
      );
      unsavedMessages.set(event.messageId, event.message);
    } else if (event.type === 'message_saved') {
      const message = unsavedMessages.get(event.messageId);
      if (!message || message.role === 'system') return;
      unsavedMessages.delete(event.messageId);
      publish('message.ended', {
        messageId: event.messageId,
        role: message.role === 'toolResult' ? 'tool_result' : message.role,
        content: message.role === 'user' ? options.userText : messageText(message),
      });
      if (message.role === 'assistant') {
        const calls = message.content.filter((block) => block.type === 'toolCall');
        for (const call of calls)
          publish('tool_execution.requested', {
            toolCallId: call.id,
            toolName: call.name,
            args: call.arguments,
            modelCallId: event.messageId,
          });
        if (calls.length) {
          const toolCallIds = calls.map((call) => call.id);
          toolTurn = { messageId: event.messageId, toolCallIds, pending: new Set(toolCallIds) };
        } else {
          publish('turn.ended', {
            messageId: event.messageId,
            stopReason:
              message.stopReason === 'aborted'
                ? 'cancelled'
                : message.stopReason === 'error'
                  ? 'error'
                  : 'completed',
            toolCallIds: [],
          });
        }
      } else if (message.role === 'toolResult' && toolTurn) {
        toolTurn.pending.delete(message.toolCallId);
        if (!toolTurn.pending.size) {
          publish('turn.ended', {
            messageId: toolTurn.messageId,
            stopReason: 'tool_calls',
            toolCallIds: toolTurn.toolCallIds,
          });
          toolTurn = undefined;
        }
      }
    } else if (event.type === 'tool_started') {
      executingTools.add(event.toolCallId);
      publish('tool_execution.started', {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        toolExecutionId: event.toolCallId,
        args:
          event.arguments && typeof event.arguments === 'object'
            ? Object.fromEntries(Object.entries(event.arguments))
            : {},
      });
    } else if (event.type === 'tool_output') {
      const output = (outputs.get(event.toolCallId) ?? '') + event.output.chunk;
      outputs.set(event.toolCallId, output);
      publish('tool_execution.update', { toolCallId: event.toolCallId, output });
    } else if (event.type === 'tool_notification') {
      publish('tool_execution.plan_updated', {
        toolCallId: event.toolCallId,
        explanation: event.notification.explanation,
        plan: event.notification.plan.map((step) => ({ ...step })),
      });
    } else if (event.type === 'tool_finished') {
      const result = event.result;
      const error = result.type === 'failed' ? result.error : undefined;
      publish('tool_execution.ended', {
        toolCallId: event.toolCallId,
        toolExecutionId: executingTools.has(event.toolCallId) ? event.toolCallId : undefined,
        status:
          error?.code === 'permission_denied'
            ? 'denied'
            : error?.code === 'tool_cancelled'
              ? 'cancelled'
              : error
                ? 'failed'
                : 'completed',
        result: result.normalizedResult,
        error,
        summary: result.observation?.summary,
      });
      executingTools.delete(event.toolCallId);
      outputs.delete(event.toolCallId);
    } else if (event.type === 'model_attempt' && event.attempt > 1) {
      if (event.outcome === 'started')
        publish('turn.retry.started', { attemptNumber: event.attempt, retryKind: 'model_call' });
      if (event.outcome === 'completed')
        publish('turn.retry.completed', { attemptNumber: event.attempt });
      if (event.outcome === 'failed')
        publish('turn.retry.failed', { attemptNumber: event.attempt });
    }
  };
}

function messageText(message: Message): string {
  return typeof message.content === 'string'
    ? message.content
    : message.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('');
}

/** Every event type, assembled from the lifecycle layers. */
export type EventPayloadByType = RunEventPayloadByType &
  TurnEventPayloadByType &
  MessageEventPayloadByType &
  ToolEventPayloadByType &
  ApprovalEventPayloadByType &
  SessionEventPayloadByType;

export type EventType = keyof EventPayloadByType;

/**
 * A broadcast event. `id`/`sequence`/`createdAt` are protocol fields supplied
 * by the bus; producers only provide type, payload, and ownership.
 */
export interface Event<TType extends EventType = EventType> {
  /** Globally unique, assigned by the bus (deduplication key). */
  readonly id: string;
  readonly type: TType;
  readonly payload: EventPayloadByType[TType];
  /** Required ownership root: every event belongs to exactly one session. */
  readonly sessionId: string;
  /** Optional: which run the event happened in (session-scoped events omit it). */
  readonly executionId?: string;
  /** Session-monotonic order assigned by the bus — the authority for sorting. */
  readonly sequence: number;
  /** Display time; never used for ordering (clocks may drift). */
  readonly createdAt: string;
}

/**
 * The discriminated union of every event kind: narrowing on `type` narrows
 * `payload` too. Consumers that dispatch on event type use this instead of the
 * generic `Event`.
 */
export type AnyEvent = { [TType in EventType]: Event<TType> }[EventType];

export const MessageRoleSchema = z.enum(['user', 'assistant', 'tool_result']);

export type MessageRole = z.infer<typeof MessageRoleSchema>;

export const MessageStartedPayloadSchema = z
  .object({
    role: MessageRoleSchema,
    /** Reference to the stored session message. */
    messageId: z.string().min(1),
  })
  .strict();

/** Full latest snapshot of an assistant message while it streams. */
export const MessageUpdatePayloadSchema = z
  .object({
    role: z.literal('assistant'),
    messageId: z.string().min(1),
    /** Complete content as of now — replace the previous snapshot. */
    content: z.string(),
  })
  .strict();

/** Full latest snapshot of the assistant's thinking while it streams. */
export const MessageThinkingUpdatePayloadSchema = z
  .object({
    messageId: z.string().min(1),
    /** Complete thinking as of now — replace the previous snapshot. */
    thinking: z.string(),
  })
  .strict();

export const MessageEndedPayloadSchema = z
  .object({
    role: MessageRoleSchema,
    messageId: z.string().min(1),
    /** Settled content; for assistant messages this supersedes every update. */
    content: z.string(),
  })
  .strict();

export type MessageStartedPayload = z.infer<typeof MessageStartedPayloadSchema>;

export type MessageUpdatePayload = z.infer<typeof MessageUpdatePayloadSchema>;

export type MessageEndedPayload = z.infer<typeof MessageEndedPayloadSchema>;

export const MessageEventSchemas = {
  'message.started': MessageStartedPayloadSchema,
  'message.update': MessageUpdatePayloadSchema,
  'message.thinking.update': MessageThinkingUpdatePayloadSchema,
  'message.ended': MessageEndedPayloadSchema,
} as const;

export type MessageEventPayloadByType = {
  [TType in keyof typeof MessageEventSchemas]: z.infer<(typeof MessageEventSchemas)[TType]>;
};

export type MessageEventType = keyof MessageEventPayloadByType;

export const RunStartedPayloadSchema = z
  .object({
    /** Opaque user request identity as accepted by the run. */
    requestId: z.string().min(1),
    /** The model executing this run. */
    providerId: z.string().min(1),
    modelId: z.string().min(1),
  })
  .strict();

export const RunEndedPayloadSchema = z
  .object({
    status: z.enum(['completed', 'failed', 'cancelled']),
    error: z
      .object({
        message: z.string().min(1),
        code: z.string().optional(),
        /** Whether the failure can be retried; a consumer may offer a retry. */
        retryable: z.boolean().optional(),
        cause: z
          .object({
            owner: z.string().min(1),
            code: z.string().min(1),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    /** Reference to the settled assistant reply, when the run completed. */
    assistantMessageId: z.string().min(1).optional(),
  })
  .strict();

/** A cancellation was requested for the run; the outcome is told by run.ended.
 *  The mechanism is the AbortSignal; the event records who asked, why, and
 *  what scope (the whole run). */
export const RunCancelRequestedPayloadSchema = z
  .object({
    requestedBy: z.enum(['user']),
    reason: z.enum(['user_cancelled']),
    scope: z.enum(['run']),
  })
  .strict();

export type RunStartedPayload = z.infer<typeof RunStartedPayloadSchema>;

export type RunEndedPayload = z.infer<typeof RunEndedPayloadSchema>;

export type RunCancelRequestedPayload = z.infer<typeof RunCancelRequestedPayloadSchema>;

export const RunEventSchemas = {
  'run.started': RunStartedPayloadSchema,
  'run.cancel.requested': RunCancelRequestedPayloadSchema,
  'run.ended': RunEndedPayloadSchema,
} as const;

export type RunEventPayloadByType = {
  [TType in keyof typeof RunEventSchemas]: z.infer<(typeof RunEventSchemas)[TType]>;
};

export type RunEventType = keyof RunEventPayloadByType;

export const CompactionStartedPayloadSchema = z
  .object({
    /** Trigger of the compaction, matching the context package's CompactionTrigger. */
    trigger: z.enum(['threshold', 'overflow', 'manual']),
    /** Identity shared with compaction.ended/.failed; the UI keys on it. */
    compactionId: z.string().min(1),
  })
  .strict();

const CompactionErrorSchema = z
  .object({
    message: z.string().min(1),
    code: z.string().optional(),
  })
  .strict();

export const CompactionEndedPayloadSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('completed'), compactionId: z.string().min(1) }).strict(),
  z
    .object({
      status: z.literal('failed'),
      compactionId: z.string().min(1),
      error: CompactionErrorSchema,
    })
    .strict(),
  z.object({ status: z.literal('cancelled'), compactionId: z.string().min(1) }).strict(),
  z
    .object({
      status: z.literal('interrupted'),
      compactionId: z.string().min(1),
      error: CompactionErrorSchema,
    })
    .strict(),
]);

export const BranchMarkerCreatedPayloadSchema = z
  .object({
    /** Reference to the stored branch marker. */
    markerId: z.string().min(1),
  })
  .strict();

export const BranchDraftCancelledPayloadSchema = z
  .object({
    /** Reference to the draft session that was cancelled. */
    draftId: z.string().min(1),
  })
  .strict();

export type CompactionStartedPayload = z.infer<typeof CompactionStartedPayloadSchema>;

export type CompactionEndedPayload = z.infer<typeof CompactionEndedPayloadSchema>;

export type BranchMarkerCreatedPayload = z.infer<typeof BranchMarkerCreatedPayloadSchema>;

export type BranchDraftCancelledPayload = z.infer<typeof BranchDraftCancelledPayloadSchema>;

export const SessionEventSchemas = {
  'session.compaction.started': CompactionStartedPayloadSchema,
  'session.compaction.ended': CompactionEndedPayloadSchema,
  'session.branch_marker.created': BranchMarkerCreatedPayloadSchema,
  'session.branch_draft.cancelled': BranchDraftCancelledPayloadSchema,
} as const;

export type SessionEventPayloadByType = {
  [TType in keyof typeof SessionEventSchemas]: z.infer<(typeof SessionEventSchemas)[TType]>;
};

export type SessionEventType = keyof SessionEventPayloadByType;

export const ToolExecutionRequestedPayloadSchema = z
  .object({
    toolCallId: z.string().min(1),
    toolName: z.string().min(1),
    args: z.record(z.string(), z.unknown()),
    /** The model call that asked for this tool. */
    modelCallId: z.string().min(1),
  })
  .strict();

export const ToolExecutionStartedPayloadSchema = z
  .object({
    toolCallId: z.string().min(1),
    toolName: z.string().min(1),
    args: z.record(z.string(), z.unknown()),
    /** The execution instance; one call may be executed more than once. */
    toolExecutionId: z.string().min(1),
  })
  .strict();

export const ToolExecutionUpdatePayloadSchema = z
  .object({
    toolCallId: z.string().min(1),
    /** Streaming output produced so far (full snapshot, like message.update). */
    output: z.string(),
  })
  .strict();

export const ToolExecutionEndedPayloadSchema = z
  .object({
    toolCallId: z.string().min(1),
    /** Present except for denied outcomes: a denied call never created an execution. */
    toolExecutionId: z.string().min(1).optional(),
    status: z.enum(['completed', 'failed', 'cancelled', 'denied']),
    /** Present when status is 'completed'. */
    result: z.unknown().optional(),
    /** Human-readable result summary (observation.summary); the UI shows this,
     *  never the raw result payload. */
    summary: z.string().optional(),
    error: z
      .object({
        message: z.string().min(1),
        code: z.string().optional(),
      })
      .optional(),
  })
  .strict();

/** A planning tool (update_plan) published a plan snapshot during its execution. */
export const ToolExecutionPlanUpdatedPayloadSchema = z
  .object({
    toolCallId: z.string().min(1),
    explanation: z.string().optional(),
    plan: z
      .array(
        z
          .object({
            step: z.string(),
            status: z.enum(['pending', 'in_progress', 'completed']),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export type ToolExecutionRequestedPayload = z.infer<typeof ToolExecutionRequestedPayloadSchema>;

export type ToolExecutionStartedPayload = z.infer<typeof ToolExecutionStartedPayloadSchema>;

export type ToolExecutionUpdatePayload = z.infer<typeof ToolExecutionUpdatePayloadSchema>;

export type ToolExecutionEndedPayload = z.infer<typeof ToolExecutionEndedPayloadSchema>;

export type ToolExecutionPlanUpdatedPayload = z.infer<typeof ToolExecutionPlanUpdatedPayloadSchema>;

export const ToolEventSchemas = {
  'tool_execution.requested': ToolExecutionRequestedPayloadSchema,
  'tool_execution.started': ToolExecutionStartedPayloadSchema,
  'tool_execution.update': ToolExecutionUpdatePayloadSchema,
  'tool_execution.plan_updated': ToolExecutionPlanUpdatedPayloadSchema,
  'tool_execution.ended': ToolExecutionEndedPayloadSchema,
} as const;

export type ToolEventPayloadByType = {
  [TType in keyof typeof ToolEventSchemas]: z.infer<(typeof ToolEventSchemas)[TType]>;
};

export type ToolEventType = keyof ToolEventPayloadByType;

export const TurnStartedPayloadSchema = z
  .object({
    /** The message being generated (settled later by message.ended). */
    messageId: z.string().min(1),
  })
  .strict();

export const TurnEndedPayloadSchema = z
  .object({
    stopReason: z.enum(['completed', 'tool_calls', 'error', 'cancelled']),
    /** Reference to the assistant message this turn produced. */
    messageId: z.string().min(1),
    /** References to the tool executions triggered by this turn. */
    toolCallIds: z.array(z.string().min(1)),
  })
  .strict();

/** A failed model call attempt is being retried (attemptNumber is 1-based). */
export const TurnRetryStartedPayloadSchema = z
  .object({
    attemptNumber: z.number().int().positive(),
    retryKind: z.enum(['model_call']),
  })
  .strict();

export const TurnRetryCompletedPayloadSchema = z
  .object({
    attemptNumber: z.number().int().positive(),
  })
  .strict();

export const TurnRetryFailedPayloadSchema = z
  .object({
    attemptNumber: z.number().int().positive(),
    error: z
      .object({
        message: z.string().min(1),
        code: z.string().optional(),
      })
      .optional(),
  })
  .strict();

export type TurnStartedPayload = z.infer<typeof TurnStartedPayloadSchema>;

export type TurnEndedPayload = z.infer<typeof TurnEndedPayloadSchema>;

export type TurnRetryStartedPayload = z.infer<typeof TurnRetryStartedPayloadSchema>;

export type TurnRetryCompletedPayload = z.infer<typeof TurnRetryCompletedPayloadSchema>;

export type TurnRetryFailedPayload = z.infer<typeof TurnRetryFailedPayloadSchema>;

export const TurnEventSchemas = {
  'turn.started': TurnStartedPayloadSchema,
  'turn.ended': TurnEndedPayloadSchema,
  'turn.retry.started': TurnRetryStartedPayloadSchema,
  'turn.retry.completed': TurnRetryCompletedPayloadSchema,
  'turn.retry.failed': TurnRetryFailedPayloadSchema,
} as const;

export type TurnEventPayloadByType = {
  [TType in keyof typeof TurnEventSchemas]: z.infer<(typeof TurnEventSchemas)[TType]>;
};

export type TurnEventType = keyof TurnEventPayloadByType;

export const EventIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(
    /^[A-Za-z0-9:_-]+$/,
    'Event id must contain only letters, numbers, colon, underscore, or hyphen.',
  );

export const EventSequenceSchema = z.number().int().positive();

export const EventIsoDateTimeSchema = z.string().datetime({ offset: true });

const EventBaseSchema = z
  .object({
    id: EventIdSchema,
    sessionId: z.string().min(1),
    executionId: z.string().min(1).optional(),
    sequence: EventSequenceSchema,
    createdAt: EventIsoDateTimeSchema,
  })
  .strict();

function eventSchema<TType extends string, TPayloadSchema extends z.ZodTypeAny>(
  eventType: TType,
  payload: TPayloadSchema,
) {
  return EventBaseSchema.extend({ type: z.literal(eventType), payload }).strict();
}

/** Full per-type event schemas: envelope plus the layer's payload. */
export const EventSchemas = {
  'run.started': eventSchema('run.started', RunEventSchemas['run.started']),
  'run.cancel.requested': eventSchema(
    'run.cancel.requested',
    RunEventSchemas['run.cancel.requested'],
  ),
  'run.ended': eventSchema('run.ended', RunEventSchemas['run.ended']),
  'turn.started': eventSchema('turn.started', TurnEventSchemas['turn.started']),
  'turn.ended': eventSchema('turn.ended', TurnEventSchemas['turn.ended']),
  'turn.retry.started': eventSchema('turn.retry.started', TurnEventSchemas['turn.retry.started']),
  'turn.retry.completed': eventSchema(
    'turn.retry.completed',
    TurnEventSchemas['turn.retry.completed'],
  ),
  'turn.retry.failed': eventSchema('turn.retry.failed', TurnEventSchemas['turn.retry.failed']),
  'message.started': eventSchema('message.started', MessageEventSchemas['message.started']),
  'message.update': eventSchema('message.update', MessageEventSchemas['message.update']),
  'message.thinking.update': eventSchema(
    'message.thinking.update',
    MessageEventSchemas['message.thinking.update'],
  ),
  'message.ended': eventSchema('message.ended', MessageEventSchemas['message.ended']),
  'tool_execution.requested': eventSchema(
    'tool_execution.requested',
    ToolEventSchemas['tool_execution.requested'],
  ),
  'tool_execution.started': eventSchema(
    'tool_execution.started',
    ToolEventSchemas['tool_execution.started'],
  ),
  'tool_execution.update': eventSchema(
    'tool_execution.update',
    ToolEventSchemas['tool_execution.update'],
  ),
  'tool_execution.plan_updated': eventSchema(
    'tool_execution.plan_updated',
    ToolEventSchemas['tool_execution.plan_updated'],
  ),
  'tool_execution.ended': eventSchema(
    'tool_execution.ended',
    ToolEventSchemas['tool_execution.ended'],
  ),
  'approval.requested': eventSchema(
    'approval.requested',
    ApprovalEventSchemas['approval.requested'],
  ),
  'approval.resolved': eventSchema('approval.resolved', ApprovalEventSchemas['approval.resolved']),
  'session.compaction.started': eventSchema(
    'session.compaction.started',
    SessionEventSchemas['session.compaction.started'],
  ),
  'session.compaction.ended': eventSchema(
    'session.compaction.ended',
    SessionEventSchemas['session.compaction.ended'],
  ),
  'session.branch_marker.created': eventSchema(
    'session.branch_marker.created',
    SessionEventSchemas['session.branch_marker.created'],
  ),
  'session.branch_draft.cancelled': eventSchema(
    'session.branch_draft.cancelled',
    SessionEventSchemas['session.branch_draft.cancelled'],
  ),
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
