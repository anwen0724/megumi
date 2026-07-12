/*
 * Defines complete historical turns and the unfinished current turn used by Context.
 */
import type { ConversationItem } from '@megumi/ai';

type UserMessage = Extract<ConversationItem, { type: 'user_message' }>;
type ResponseItem = Exclude<ConversationItem, UserMessage>;

export type ConversationTurn = {
  source: {
    runId: string;
    userEntryId: string;
    userMessageId: string;
    assistantEntryId: string;
    assistantMessageId: string;
  };
  userMessage: UserMessage;
  responseItems: ResponseItem[];
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
