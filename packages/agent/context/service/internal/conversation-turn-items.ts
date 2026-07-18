/* Converts one Session-backed historical Turn into ordered Prompt items. */
import type { ConversationItem } from '@megumi/ai';
import type { ConversationTurn } from '../../domain/model/conversation-turn';

export function conversationItemsFromTurn(turn: ConversationTurn): ConversationItem[] {
  return [turn.userMessage, ...turn.items];
}
