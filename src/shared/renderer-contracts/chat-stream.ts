// Renderer-facing assistant stream event contracts and schema.
import { z } from 'zod';
import type { WorkspaceChangeFooterFact } from './workspace';

export type ChatStreamEventType =
  | 'turn.started'
  | 'turn.completed'
  | 'turn.failed'
  | 'turn.cancelled'
  | 'user.message.committed'
  | 'assistant.text.started'
  | 'assistant.text.delta'
  | 'assistant.text.reclassified'
  | 'assistant.text.completed'
  | 'assistant.text.failed'
  | 'assistant.text.cancelled_partial'
  | 'assistant.thinking.started'
  | 'assistant.thinking.delta'
  | 'assistant.thinking.completed'
  | 'tool.started'
  | 'tool.completed'
  | 'tool.failed'
  | 'tool.denied'
  | 'approval.requested'
  | 'approval.resolved'
  | 'branch.separator.created'
  | 'branch.separator.removed'
  | 'process.compaction.recorded'
  | 'process.retry.recorded'
  | 'process.recovery.recorded'
  | 'workspace.change.footer.updated';

export type AssistantTextPhase = 'prelude' | 'answer';
export type ChatStreamKind = 'main' | (string & {});
export type ChatStreamApprovalScope = 'user' | 'project' | 'local' | (string & {});

export interface ChatStreamEventBase {
  eventId: string;
  eventType: ChatStreamEventType;
  projectId: string;
  sessionId: string;
  runId: string;
  streamId: string;
  streamKind: string;
  seq: number;
  createdAt: string;
}

export interface AssistantTextDeltaEvent extends ChatStreamEventBase {
  eventType: 'assistant.text.delta';
  textId: string;
  phase: AssistantTextPhase;
  delta: string;
}

export interface AssistantThinkingDeltaEvent extends ChatStreamEventBase {
  eventType: 'assistant.thinking.delta';
  thinkingId: string;
  delta: string;
}

export interface WorkspaceChangeFooterUpdatedEvent extends ChatStreamEventBase {
  eventType: 'workspace.change.footer.updated';
  footer: WorkspaceChangeFooterFact;
}

export type ChatStreamEvent =
  | AssistantTextDeltaEvent
  | AssistantThinkingDeltaEvent
  | WorkspaceChangeFooterUpdatedEvent
  | (ChatStreamEventBase & {
      eventType: Exclude<
        ChatStreamEventType,
        'assistant.text.delta' | 'assistant.thinking.delta' | 'workspace.change.footer.updated'
      >;
      [key: string]: unknown;
    });

export type RendererChatStreamEventDto = ChatStreamEvent;

const ChatStreamEventBaseSchema = z.object({
  eventId: z.string(),
  projectId: z.string(),
  sessionId: z.string(),
  runId: z.string(),
  streamId: z.string(),
  streamKind: z.string(),
  seq: z.number().int(),
  createdAt: z.string(),
});

const AssistantTextPhaseSchema = z.enum(['prelude', 'answer']);
const ApprovalStatusSchema = z.enum(['pending', 'approved', 'denied', 'expired', 'cancelled']);
const ApprovalActivityStatusSchema = z.enum(['pending', 'approved', 'rejected', 'expired', 'cancelled']);
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

function eventSchema<TEventType extends ChatStreamEventType>(
  eventType: TEventType,
  shape: z.ZodRawShape = {},
) {
  return ChatStreamEventBaseSchema.extend({
    eventType: z.literal(eventType),
    ...shape,
  });
}

const AssistantTextFields = {
  textId: z.string(),
  phase: AssistantTextPhaseSchema,
};

const ToolDisclosureFields = {
  toolCallId: z.string(),
  toolExecutionId: z.string().optional(),
  toolResultId: z.string().optional(),
  toolName: z.string(),
  displayName: z.string().optional(),
  inputSummary: z.string().optional(),
  resultSummary: z.string().optional(),
  errorCode: z.string().optional(),
  errorMessage: z.string().optional(),
};

export const ChatStreamEventSchema = z.discriminatedUnion('eventType', [
  eventSchema('turn.started', {
    userMessageId: z.string().optional(),
    clientMessageId: z.string().optional(),
  }),
  eventSchema('turn.completed'),
  eventSchema('turn.failed', {
    errorCode: z.string().optional(),
    errorMessage: z.string().optional(),
    recoverable: z.boolean().optional(),
  }),
  eventSchema('turn.cancelled', {
    reason: z.string().optional(),
  }),
  eventSchema('user.message.committed', {
    messageId: z.string(),
    clientMessageId: z.string().optional(),
    text: z.string(),
  }),
  eventSchema('assistant.text.started', AssistantTextFields),
  eventSchema('assistant.text.delta', {
    ...AssistantTextFields,
    delta: z.string(),
  }),
  eventSchema('assistant.text.reclassified', {
    textId: z.string(),
    fromPhase: AssistantTextPhaseSchema,
    toPhase: AssistantTextPhaseSchema,
  }),
  eventSchema('assistant.text.completed', AssistantTextFields),
  eventSchema('assistant.text.failed', {
    ...AssistantTextFields,
    errorMessage: z.string().optional(),
  }),
  eventSchema('assistant.text.cancelled_partial', {
    ...AssistantTextFields,
    reason: z.string().optional(),
  }),
  eventSchema('assistant.thinking.started', {
    thinkingId: z.string(),
  }),
  eventSchema('assistant.thinking.delta', {
    thinkingId: z.string(),
    delta: z.string(),
  }),
  eventSchema('assistant.thinking.completed', {
    thinkingId: z.string(),
  }),
  eventSchema('tool.started', ToolDisclosureFields),
  eventSchema('tool.completed', ToolDisclosureFields),
  eventSchema('tool.failed', ToolDisclosureFields),
  eventSchema('tool.denied', ToolDisclosureFields),
  eventSchema('approval.requested', {
    approvalId: z.string(),
    approvalRequest: ApprovalRequestSchema,
    toolCallId: z.string().optional(),
    toolExecutionId: z.string().optional(),
    scope: z.string().optional(),
    status: ApprovalActivityStatusSchema.optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    subjectSummary: z.string().optional(),
  }),
  eventSchema('approval.resolved', {
    approvalId: z.string(),
    toolCallId: z.string().optional(),
    toolExecutionId: z.string().optional(),
    scope: z.string().optional(),
    status: ApprovalActivityStatusSchema.optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    subjectSummary: z.string().optional(),
  }),
  eventSchema('branch.separator.created', {
    branchMarkerId: z.string(),
    sourceMessageId: z.string(),
    label: z.string().optional(),
  }),
  eventSchema('branch.separator.removed', {
    branchMarkerId: z.string(),
  }),
  eventSchema('process.compaction.recorded', {
    compactionId: z.string().optional(),
    status: z.enum(['completed', 'skipped', 'boundary_unresolved']).optional(),
    label: z.string().optional(),
  }),
  eventSchema('process.retry.recorded', {
    retryAttemptId: z.string().optional(),
    attemptNumber: z.number().optional(),
    status: z.enum(['started', 'failed', 'completed', 'exhausted', 'cancelled']).optional(),
    label: z.string().optional(),
    reason: z.string().optional(),
  }),
  eventSchema('process.recovery.recorded', {
    status: z.enum(['interrupted', 'manual_retry_requested', 'manual_rerun_requested', 'marked_cancelled']).optional(),
    label: z.string().optional(),
  }),
  eventSchema('workspace.change.footer.updated', {
    footer: z.unknown(),
  }),
]) satisfies z.ZodType<unknown>;
