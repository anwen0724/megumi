/*
 * Defines the complete runtime Context input from which a model prompt is assembled.
 */
import type { ToolSetEntry } from '@megumi/ai';
import type { ConversationRun, CurrentConversationRun } from './conversation-run';
import type { PromptInstructions, PromptReferenceContext, PromptRunContext } from './prompt';

export type ActiveContext = {
  sessionId: string;
  instructions: PromptInstructions;
  referenceContext: PromptReferenceContext;
  runContext: PromptRunContext;
  historicalRuns: ConversationRun[];
  currentRun: CurrentConversationRun;
  tools: ToolSetEntry[];
};
