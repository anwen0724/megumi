/*
 * Defines the complete runtime Context input from which a model prompt is assembled.
 */
import type { ToolSetEntry } from '@megumi/ai';
import type { ConversationTurn, CurrentConversationTurn } from './conversation-turn';
import type { PromptInstructions, PromptReferenceContext, PromptRunContext } from './prompt';

export type ActiveContext = {
  sessionId: string;
  instructions: PromptInstructions;
  referenceContext: PromptReferenceContext;
  runContext: PromptRunContext;
  historicalTurns: ConversationTurn[];
  currentTurn: CurrentConversationTurn;
  tools: ToolSetEntry[];
};
