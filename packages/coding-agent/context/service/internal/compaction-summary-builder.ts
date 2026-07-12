/*
 * Builds the immutable model request for replacing the active rolling Summary.
 */
import type { ConversationTurn } from '../../domain/model/conversation-turn';

export const COMPACTION_SUMMARY_SYSTEM_PROMPT = `You are updating the rolling context summary for an ongoing coding-agent session.

Your input contains:
1. The previous compaction summary, if one exists.
2. A continuous prefix of completed conversation turns being compacted now.

Produce one replacement summary that preserves the information required to continue the task correctly.

Requirements:
- Merge the previous summary with newly compacted turns.
- Preserve confirmed requirements, constraints, decisions, and their necessary reasons.
- Preserve completed work, current state, exact paths, symbols, commands, identifiers, numbers, and errors.
- Preserve failed approaches and explicitly rejected decisions when they affect future work.
- Update facts whose state has changed.
- Remove duplicated information and obsolete pending items.
- Do not write a generic conversation recap.
- Do not mention that compaction occurred.
- Do not invent facts.
- Write the narrative in the primary language of the conversation.
- Preserve exact paths, symbols, commands, identifiers, numbers, and errors in their original form.
- Output only the replacement summary.

Use the following sections only when they contain useful information:

Goal
Confirmed Requirements and Constraints
Key Facts and Design Decisions
Completed Work
Current State
Exact References
Failures and Rejected Approaches
Open Questions
Next Steps`;

export type BuildCompactionSummaryRequest = {
  previousSummary?: string;
  turns: ConversationTurn[];
};

export type CompactionSummaryModelRequest = {
  systemPrompt: typeof COMPACTION_SUMMARY_SYSTEM_PROMPT;
  input: string;
};

export function buildCompactionSummaryRequest(
  request: BuildCompactionSummaryRequest,
): CompactionSummaryModelRequest {
  const previousSummary = request.previousSummary ?? '';
  const conversationTurns = request.turns.map(renderTurn).join('\n\n');

  return {
    systemPrompt: COMPACTION_SUMMARY_SYSTEM_PROMPT,
    input: `<previous_summary>\n${previousSummary}\n</previous_summary>\n\n<conversation_turns>\n${conversationTurns}\n</conversation_turns>`,
  };
}

function renderTurn(turn: ConversationTurn): string {
  return JSON.stringify({
    conversation: [turn.userMessage, ...turn.responseItems],
  });
}
