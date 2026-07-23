/*
 * Builds the immutable model request for replacing the active rolling Summary.
 */
import type { ConversationRun } from '../../domain/model/conversation-run';
import { conversationItemsFromRun } from './conversation-run-items';

export const COMPACTION_SUMMARY_SYSTEM_PROMPT = `You are updating the rolling context summary for an ongoing agent session.

Your input contains:
1. The previous compaction summary, if one exists.
2. A continuous prefix of historical conversation runs being compacted now.

Produce one replacement summary that preserves the information required to continue the task correctly.

Requirements:
- Merge the previous summary with newly compacted runs.
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
  runs: ConversationRun[];
};

export type CompactionSummaryModelRequest = {
  systemPrompt: typeof COMPACTION_SUMMARY_SYSTEM_PROMPT;
  input: string;
};

export function buildCompactionSummaryRequest(
  request: BuildCompactionSummaryRequest,
): CompactionSummaryModelRequest {
  const previousSummary = request.previousSummary ?? '';
  const conversationRuns = request.runs.map(renderRun).join('\n\n');

  return {
    systemPrompt: COMPACTION_SUMMARY_SYSTEM_PROMPT,
    input: `<previous_summary>\n${previousSummary}\n</previous_summary>\n\n<conversation_runs>\n${conversationRuns}\n</conversation_runs>`,
  };
}

function renderRun(run: ConversationRun): string {
  return JSON.stringify({
    conversation: conversationItemsFromRun(run).map((item) => {
      if (item.type !== 'user_message' && item.type !== 'assistant_message' && item.type !== 'tool_result') {
        return item;
      }

      return {
        ...item,
        content: item.content.map((block) => {
          if (block.type === 'image') {
            return { type: 'text' as const, text: '[Image attachment included as structured content below]' };
          }
          if (block.type === 'file') {
            return { type: 'text' as const, text: `[File attachment: ${block.name ?? block.path} at ${block.path}]` };
          }
          return block;
        }),
      };
    }),
  });
}
