/*
 * Verifies the immutable Summary prompt and deterministic full-Turn input wrapper.
 */
import { describe, expect, it } from 'vitest';
import type { ConversationTurn } from '@megumi/coding-agent/context';
import {
  COMPACTION_SUMMARY_SYSTEM_PROMPT,
  buildCompactionSummaryRequest,
} from '@megumi/coding-agent/context/service/internal/compaction-summary-builder';

const EXPECTED_PROMPT = `You are updating the rolling context summary for an ongoing coding-agent session.

Your input contains:
1. The previous compaction summary, if one exists.
2. A continuous prefix of historical conversation turns being compacted now.

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

describe('buildCompactionSummaryRequest', () => {
  it('uses the fixed English generation prompt verbatim', () => {
    expect(COMPACTION_SUMMARY_SYSTEM_PROMPT).toBe(EXPECTED_PROMPT);
    expect(buildCompactionSummaryRequest({
      previousSummary: 'Earlier state.',
      turns: [turn('1')],
    }).systemPrompt).toBe(EXPECTED_PROMPT);
  });

  it('renders an absent previous Summary as an empty wrapper body', () => {
    const request = buildCompactionSummaryRequest({ turns: [turn('1')] });

    expect(request.input.startsWith(
      '<previous_summary>\n\n</previous_summary>\n\n<conversation_turns>\n',
    )).toBe(true);
    expect(request.input).not.toContain('No previous summary');
    expect(request.input.endsWith('\n</conversation_turns>')).toBe(true);
  });

  it('wraps the prior Summary and preserves a complete Turn including its tool pair', () => {
    const request = buildCompactionSummaryRequest({
      previousSummary: 'Earlier state.',
      turns: [turn('1')],
    });

    expect(request.input.startsWith(
      '<previous_summary>\nEarlier state.\n</previous_summary>\n\n<conversation_turns>\n',
    )).toBe(true);
    expect(request.input).toContain('"type":"user_message"');
    expect(request.input).toContain('"type":"tool_call","toolCallId":"call-1"');
    expect(request.input).toContain('"type":"tool_result","toolCallId":"call-1"');
    expect(request.input.indexOf('"type":"tool_call"')).toBeLessThan(
      request.input.indexOf('"type":"tool_result"'),
    );
    expect(request.input.endsWith('\n</conversation_turns>')).toBe(true);
  });

  it('omits Context-owned turn source identifiers from the model input', () => {
    const request = buildCompactionSummaryRequest({ turns: [turn('private')] });

    expect(request.input).not.toContain('"source"');
    expect(request.input).not.toContain('run-private');
    expect(request.input).not.toContain('entry-user-private');
    expect(request.input).not.toContain('message-assistant-private');
    expect(request.input).toContain('User private');
    expect(request.input).toContain('Assistant private');
  });
});

function turn(id: string): ConversationTurn {
  return {
    source: {
      runId: `run-${id}`,
      userEntryId: `entry-user-${id}`,
      userMessageId: `message-user-${id}`,
      assistantEntryId: `entry-assistant-${id}`,
      assistantMessageId: `message-assistant-${id}`,
    },
    userMessage: {
      type: 'user_message',
      content: [{ type: 'text', text: `User ${id}` }],
    },
    runStatus: 'completed',
    modelSteps: [{ modelCallId: `model-${id}`, assistantContent: [], toolCalls: [{
      toolCallId: `call-${id}`, toolName: 'lookup', arguments: { id },
      result: { status: 'success', content: [{ type: 'text', text: `Result ${id}` }] },
    }] }],
    finalAssistantMessage: { type: 'assistant_message', content: [{ type: 'text', text: `Assistant ${id}` }] },
    diagnostics: [],
  };
}
