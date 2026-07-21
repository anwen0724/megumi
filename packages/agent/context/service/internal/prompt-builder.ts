/*
 * Projects ActiveContext into the single provider-neutral Prompt consumed by Model Call.
 */
import type { ActiveContext } from '../../domain/model/active-context';
import type { Prompt } from '../../domain/model/prompt';
import { conversationItemsFromRun } from './conversation-run-items';

export function buildPrompt(activeContext: ActiveContext): Prompt {
  return {
    instructions: activeContext.instructions,
    referenceContext: activeContext.referenceContext,
    runContext: activeContext.runContext,
    conversation: [
      ...activeContext.historicalRuns.flatMap(conversationItemsFromRun),
      activeContext.currentRun.userMessage,
      ...activeContext.currentRun.runItems,
    ],
    tools: activeContext.tools,
  };
}
