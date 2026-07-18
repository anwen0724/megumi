/* Defines canonical semantic messages persisted by Session. */
import { z } from 'zod';
import {
  AssistantContentBlockSchema,
  ContentBlockListSchema,
  type AssistantContentBlock,
  type ContentBlock,
} from '@megumi/ai';
import type { SessionMessageAttachment } from './session-attachment';

export const SessionUserConversationMessageSchema = z.object({
  role: z.literal('user'),
  content: ContentBlockListSchema,
}).strict();

export const SessionAssistantConversationMessageSchema = z.object({
  role: z.literal('assistant'),
  content: z.array(AssistantContentBlockSchema),
  stopReason: z.string().min(1).optional(),
}).strict();

export const SessionToolResultConversationMessageSchema = z.object({
  role: z.literal('toolResult'),
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
  status: z.enum(['success', 'failure']),
  content: ContentBlockListSchema,
}).strict();

export const SessionConversationMessageSchema = z.discriminatedUnion('role', [
  SessionUserConversationMessageSchema,
  SessionAssistantConversationMessageSchema,
  SessionToolResultConversationMessageSchema,
]);

export type SessionConversationMessage =
  | { role: 'user'; content: ContentBlock[] }
  | { role: 'assistant'; content: AssistantContentBlock[]; stopReason?: string }
  | {
      role: 'toolResult';
      toolCallId: string;
      toolName: string;
      status: 'success' | 'failure';
      content: ContentBlock[];
    };

export function sessionConversationText(message: SessionConversationMessage): string {
  return message.content.flatMap((block) => block.type === 'text' ? [block.text] : []).join('');
}

export type SessionMessage = {
  message_id: string;
  session_id: string;
  run_id?: string;
  conversation: SessionConversationMessage;
  created_at: string;
  completed_at?: string;
};

export type SessionMessageWithAttachments = {
  message: SessionMessage;
  attachments: SessionMessageAttachment[];
  /** Zero-based position of this message Entry on the current active path. */
  active_path_order?: number;
};
