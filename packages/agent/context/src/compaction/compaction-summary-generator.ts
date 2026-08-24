/* Builds and executes the provider-neutral request that replaces a rolling Context Summary. */
import type { Api, Context as AiContext, Message, Model, Models } from '@megumi/ai';

export const COMPACTION_SUMMARY_SYSTEM_PROMPT = `You are updating the rolling context summary for an ongoing agent session.

Your input contains:
1. The previous compaction summary, if one exists.
2. A continuous prefix of historical conversation being compacted now.
3. The current turn prefix: the beginning of the turn that stays in the conversation after compaction.

Produce one replacement summary that preserves the information required to continue the task correctly.

Requirements:
- Merge the previous summary with newly compacted history.
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
Constraints and Preferences
Progress
Key Decisions
Important Context
Next Steps`;

export interface CompactionSummaryModelRequest {
  readonly systemPrompt: typeof COMPACTION_SUMMARY_SYSTEM_PROMPT;
  readonly input: string;
}

export function buildCompactionSummaryRequest(input: {
  readonly previousSummary?: string;
  readonly messages: readonly Message[];
  readonly turnPrefixMessages?: readonly Message[];
}): CompactionSummaryModelRequest {
  const sections = [
    `<previous_summary>\n${input.previousSummary ?? ''}\n</previous_summary>`,
    `<conversation>\n${input.messages.map(renderMessage).join('\n\n')}\n</conversation>`,
  ];
  if (input.turnPrefixMessages && input.turnPrefixMessages.length > 0) {
    sections.push(
      `<current_turn_prefix>\n${input.turnPrefixMessages.map(renderMessage).join('\n\n')}\n</current_turn_prefix>`,
    );
  }
  return {
    systemPrompt: COMPACTION_SUMMARY_SYSTEM_PROMPT,
    input: sections.join('\n\n'),
  };
}

export async function generateCompactionSummary(input: {
  readonly models: Pick<Models, 'completeSimple'>;
  readonly model: Model<Api>;
  readonly sessionId: string;
  readonly previousSummary?: string;
  readonly messages: readonly Message[];
  readonly turnPrefixMessages?: readonly Message[];
  readonly timestamp: number;
  readonly signal?: AbortSignal;
}): Promise<
  | { readonly status: 'generated'; readonly content: string; readonly usage?: import('@megumi/ai').Usage }
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
    if (generated.stopReason === 'error' || generated.stopReason === 'length') {
      return { status: 'failed', failure: generated.errorMessage ?? 'Summary generation failed.' };
    }
    const content = generated.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');
    return content.trim().length > 0
      ? { status: 'generated', content, usage: generated.usage }
      : { status: 'failed', failure: new Error('Compaction summary model returned empty content.') };
  } catch (error) {
    return input.signal?.aborted ? { status: 'cancelled' } : { status: 'failed', failure: error };
  }
}

function renderMessage(message: Message): string {
  const renderContent = (content: Message['content']): unknown => {
    if (typeof content === 'string') return content;
    return content.map((block) => {
      if (block.type === 'text') return { type: 'text', text: block.text };
      if (block.type === 'image') return { type: 'text', text: '[Image attachment included as structured content below]' };
      if (block.type === 'thinking') return { type: 'thinking', thinking: block.thinking };
      return { type: 'toolCall', id: block.id, name: block.name, arguments: block.arguments };
    });
  };
  return JSON.stringify({
    role: message.role,
    ...(message.role === 'toolResult'
      ? { toolCallId: message.toolCallId, toolName: message.toolName, isError: message.isError }
      : {}),
    content: renderContent(message.content),
  });
}
