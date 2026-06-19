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
  | 'workspace.change.footer.updated'
  | 'assistant.delta'
  | 'assistant.completed';

export interface ChatStreamEvent {
  eventId: string;
  eventType: ChatStreamEventType;
  projectId: string;
  sessionId: string;
  runId: string;
  streamId: string;
  streamKind: string;
  seq: number;
  createdAt: string;
  [key: string]: unknown;
}

export interface RendererChatStreamEventDto {
  type: string;
  occurredAt: string;
  sessionId?: string;
  runId?: string;
  payload: Record<string, unknown>;
}

export interface WorkspaceChangeFooterUpdatedEvent extends ChatStreamEvent {
  eventType: 'workspace.change.footer.updated';
  footer: WorkspaceChangeFooterFact;
}

export const ChatStreamEventSchema = z.union([
  z.object({
    id: z.string(),
    type: z.string(),
    sessionId: z.string(),
    runId: z.string().optional(),
    messageId: z.string().optional(),
    createdAt: z.string(),
    payload: z.record(z.unknown()).default({}),
  }),
  z.object({
    eventId: z.string(),
    eventType: z.string(),
    projectId: z.string(),
    sessionId: z.string(),
    runId: z.string(),
    streamId: z.string(),
    streamKind: z.string(),
    seq: z.number().int(),
    createdAt: z.string(),
  }).passthrough(),
]) satisfies z.ZodType<unknown>;
