/* Converts one Session-backed historical Run into ordered Prompt items. */
import type { ConversationItem } from '@megumi/ai';
import type { ConversationRun } from '../../domain/model/conversation-run';

export function conversationItemsFromRun(run: ConversationRun): ConversationItem[] {
  return [run.userMessage, ...run.items];
}
