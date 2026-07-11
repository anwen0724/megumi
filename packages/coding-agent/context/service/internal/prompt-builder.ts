/*
 * Projects ActiveContext into the single provider-neutral Prompt consumed by Model Call.
 */
import type { ActiveContext } from '../../domain/model/active-context';
import type { Prompt } from '../../domain/model/prompt';

export function buildPrompt(activeContext: ActiveContext): Prompt {
  return {
    instructions: activeContext.instructions,
    referenceContext: activeContext.referenceContext,
    conversation: [
      ...activeContext.historicalTurns.flatMap((turn) => [
        turn.userMessage,
        ...turn.responseItems,
      ]),
      activeContext.currentTurn.userMessage,
      ...activeContext.currentTurn.runItems,
    ],
    tools: activeContext.tools,
  };
}
