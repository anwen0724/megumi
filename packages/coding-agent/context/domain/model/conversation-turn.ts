/*
 * Defines factual historical Turns and the unfinished current Turn used by Context.
 */
import type { ContentBlock, ConversationItem, JsonValue } from '@megumi/ai';

type UserMessage = Extract<ConversationItem, { type: 'user_message' }>;
type AssistantMessage = Extract<ConversationItem, { type: 'assistant_message' }>;
type ResponseItem = Exclude<ConversationItem, UserMessage | Extract<ConversationItem, { type: 'context' }>>;

export type ConversationTurn = {
  source: {
    runId: string;
    userEntryId: string;
    userMessageId: string;
    assistantEntryId?: string;
    assistantMessageId?: string;
  };
  runStatus?: 'queued' | 'running' | 'waiting_for_approval' | 'cancelling' | 'cancelled' | 'completed' | 'failed';
  userMessage: UserMessage;
  modelSteps: Array<{
    modelCallId: string;
    assistantContent: ContentBlock[];
    toolCalls: Array<{
      toolCallId: string;
      toolName: string;
      arguments: JsonValue;
      result?: {
        status: 'success' | 'failure';
        content: ContentBlock[];
      };
    }>;
  }>;
  finalAssistantMessage?: AssistantMessage;
  finalOutcome?: { reason?: string; code?: string; message?: string };
  diagnostics: Array<{ code: string; message: string; eventId?: string; toolCallId?: string }>;
};

export type CurrentConversationTurn = {
  runId: string;
  userEntry: {
    entryId: string;
    parentEntryId?: string;
  };
  userMessage: UserMessage;
  runItems: ResponseItem[];
};
