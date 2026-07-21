/*
 * Defines factual historical Runs and the unfinished current Run used by Context.
 */
import type { ConversationItem } from '@megumi/ai';

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
