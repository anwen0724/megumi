/*
 * Defines factual historical Turns and the unfinished current Turn used by Context.
 */
import type { ConversationItem } from '@megumi/ai';

type UserMessage = Extract<ConversationItem, { type: 'user_message' }>;
type ResponseItem = Exclude<ConversationItem, UserMessage | Extract<ConversationItem, { type: 'context' }>>;

export type ConversationTurn = {
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

export type CurrentConversationTurn = {
  runId: string;
  userEntry: {
    entryId: string;
    parentEntryId?: string;
  };
  userMessage: UserMessage;
  runItems: ResponseItem[];
};
