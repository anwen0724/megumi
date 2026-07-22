/*
 * Defines the complete runtime inputs from which the model-facing Context is assembled.
 */
import type { Tool } from '@megumi/ai';
import type { ConversationRun, CurrentConversationRun } from './conversation-run';
import type { ContextInstructions, ReferenceContext, RunContext } from './model-context';

export type ActiveContext = {
  sessionId: string;
  instructions: ContextInstructions;
  referenceContext: ReferenceContext;
  runContext: RunContext;
  historicalRuns: ConversationRun[];
  currentRun?: CurrentConversationRun;
  tools: Tool[];
};
