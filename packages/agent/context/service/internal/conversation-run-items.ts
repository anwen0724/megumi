/* Converts one Session-backed historical Run into ordered Context items. */
import type { ConversationItem, ConversationRun } from '../../domain/model/conversation-run';

export function conversationItemsFromRun(run: ConversationRun): ConversationItem[] {
  return [run.userMessage, ...run.items];
}
