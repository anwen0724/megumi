/* Builds and executes the provider-neutral request that replaces a rolling Context Summary. */
import type { Api, Context as AiContext, Model, Models } from '@megumi/ai';
import { conversationItemsFromRun, type ConversationRun } from '../conversation-run';

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

export interface CompactionSummaryModelRequest {
  readonly systemPrompt: typeof COMPACTION_SUMMARY_SYSTEM_PROMPT;
  readonly input: string;
}

export function buildCompactionSummaryRequest(input: {
  readonly previousSummary?: string;
  readonly runs: ConversationRun[];
}): CompactionSummaryModelRequest {
  return {
    systemPrompt: COMPACTION_SUMMARY_SYSTEM_PROMPT,
    input: `<previous_summary>\n${input.previousSummary ?? ''}\n</previous_summary>\n\n<conversation_runs>\n${input.runs.map(renderRun).join('\n\n')}\n</conversation_runs>`,
  };
}

export async function generateCompactionSummary(input: {
  readonly models: Pick<Models, 'completeSimple'>;
  readonly model: Model<Api>;
  readonly sessionId: string;
  readonly previousSummary?: string;
  readonly runs: ConversationRun[];
  readonly timestamp: number;
  readonly signal?: AbortSignal;
}): Promise<
  | { readonly status: 'generated'; readonly content: string }
  | { readonly status: 'cancelled' }
  | { readonly status: 'failed'; readonly failure: unknown }
> {
  const request = buildCompactionSummaryRequest(input);
  const context: AiContext = {
    systemPrompt: request.systemPrompt,
    messages: [{ role: 'user', content: request.input, timestamp: input.timestamp }],
  };
  try {
    const generated = await input.models.completeSimple(input.model, context, {
      sessionId: input.sessionId,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    if (input.signal?.aborted || generated.stopReason === 'aborted') return { status: 'cancelled' };
    if (generated.stopReason === 'error') {
      return { status: 'failed', failure: generated.failure ?? generated.errorMessage };
    }
    const content = generated.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');
    return content.trim().length > 0
      ? { status: 'generated', content }
      : { status: 'failed', failure: new Error('Compaction summary model returned empty content.') };
  } catch (error) {
    return input.signal?.aborted ? { status: 'cancelled' } : { status: 'failed', failure: error };
  }
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
            return {
              type: 'text' as const,
              text: `[File attachment: ${block.name ?? block.path} at ${block.path}]`,
            };
          }
          return block;
        }),
      };
    }),
  });
}
