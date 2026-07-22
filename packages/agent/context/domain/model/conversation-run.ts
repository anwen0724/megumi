/*
 * Defines factual historical Runs and the unfinished current Run used by Context.
 * These product facts remain richer than the final packages/ai message format.
 */
import type { AssistantContentBlock, ContentBlock } from '../../../model-content';
import type { AssistantMessage } from '@megumi/ai';
import type { JsonValue } from '../../../shared-json';

export type ConversationItem =
  | { type: 'user_message'; content: ContentBlock[] }
  | { type: 'assistant_message'; content: AssistantContentBlock[]; modelMessage?: AssistantMessage }
  | {
      type: 'tool_call';
      toolCallId: string;
      toolName: string;
      arguments: JsonValue;
      thoughtSignature?: string;
    }
  | {
      type: 'tool_result';
      toolCallId: string;
      toolName: string;
      status: 'success' | 'failure';
      content: ContentBlock[];
    }
  | { type: 'context'; kind: 'model_retry_instruction'; content: JsonValue };

type UserMessage = Extract<ConversationItem, { type: 'user_message' }>;
type ResponseItem = Exclude<ConversationItem, UserMessage>;

export type ConversationRun = {
  source: {
    runId: string;
    userEntryId: string;
    userMessageId: string;
    lastEntryId: string;
    responseMessageRefs: Array<{ entryId: string; messageId: string }>;
  };
  userMessage: UserMessage;
  items: ResponseItem[];
};

export type CurrentConversationRun = {
  runId: string;
  lastEntryId?: string;
  userEntry: {
    entryId: string;
    parentEntryId?: string;
  };
  userMessage: UserMessage;
  runItems: ResponseItem[];
};
