/*
 * Verifies complete provider-neutral Prompt projection and conversation ordering.
 */
import { describe, expect, it } from 'vitest';
import type { ActiveContext } from '@megumi/agent/context';
import { buildPrompt } from '@megumi/agent/context/service/internal/prompt-builder';

describe('buildPrompt', () => {
  it('renders a historical Tool Call without Result as ordinary ordered Context', () => {
    const activeContext = {
      sessionId: 'session-1',
      instructions: { system: [], agentInstructions: { sources: [] } },
      referenceContext: { skillCatalog: [] },
      runContext: { skills: [] },
      historicalRuns: [{
        source: { runId: 'run-old', userEntryId: 'EU', userMessageId: 'MU', lastEntryId: 'EA', responseMessageRefs: [] },
        userMessage: { type: 'user_message' as const, content: [{ type: 'text' as const, text: 'Create a file' }] },
        items: [{
          type: 'assistant_message' as const,
          content: [
            { type: 'text' as const, text: 'I will create it.' },
            { type: 'json' as const, value: { incompleteToolCalls: [{ id: 'call-1', name: 'write_file' }] } },
          ],
        }],
      }],
      currentRun: { runId: 'run-now', userEntry: { entryId: 'EN' }, userMessage: { type: 'user_message' as const, content: [{ type: 'text' as const, text: 'Continue' }] }, runItems: [] },
      tools: [],
    };

    expect(buildPrompt(activeContext).conversation).toEqual([
      activeContext.historicalRuns[0].userMessage,
      activeContext.historicalRuns[0].items[0],
      activeContext.currentRun.userMessage,
    ]);
  });

  it('projects logical regions and preserves historical and current protocol order', () => {
    const activeContext: ActiveContext = {
      sessionId: 'session-1',
      instructions: {
        system: [{ instructionId: 'system-1', content: 'System rule' }],
        agentInstructions: { sources: [] },
      },
      referenceContext: { skillCatalog: [] },
      runContext: {
        skills: [{ name: 'Review', skillPath: 'C:/review/SKILL.md', content: 'Review carefully.' }],
      },
      historicalRuns: [{
        source: {
          runId: 'run-history',
          userEntryId: 'entry-user-history',
          userMessageId: 'message-user-history',
          lastEntryId: 'entry-assistant-history',
          responseMessageRefs: [{ entryId: 'entry-assistant-history', messageId: 'message-assistant-history' }],
        },
        userMessage: { type: 'user_message', content: [{ type: 'text', text: 'Historical user' }] },
        items: [
          { type: 'tool_call', toolCallId: 'call-1', toolName: 'lookup', arguments: { id: 1 } },
          { type: 'tool_result', toolCallId: 'call-1', toolName: 'lookup', status: 'success', content: [{ type: 'json', value: { answer: 42 } }] },
          { type: 'assistant_message', content: [{ type: 'text', text: 'Historical assistant' }] },
        ],
      }],
      currentRun: {
        runId: 'run-current',
        userEntry: { entryId: 'entry-user-current', parentEntryId: 'entry-assistant-history' },
        userMessage: { type: 'user_message', content: [{ type: 'text', text: 'Current user' }] },
        runItems: [
          { type: 'tool_call', toolCallId: 'call-2', toolName: 'lookup', arguments: { id: 2 } },
          {
            type: 'tool_result',
            toolCallId: 'call-2',
            toolName: 'lookup',
            status: 'failure',
            content: [{ type: 'text', text: 'not found' }],
          },
        ],
      },
      tools: [{ name: 'lookup', description: 'Lookup an item', inputSchema: { type: 'object' } }],
    };

    const prompt = buildPrompt(activeContext);

    expect(Object.keys(prompt)).toEqual(['instructions', 'referenceContext', 'runContext', 'conversation', 'tools']);
    expect(prompt.runContext.skills).toEqual(activeContext.runContext.skills);
    expect(prompt.conversation).toEqual([
      activeContext.historicalRuns[0].userMessage,
      { type: 'tool_call', toolCallId: 'call-1', toolName: 'lookup', arguments: { id: 1 } },
      { type: 'tool_result', toolCallId: 'call-1', toolName: 'lookup', status: 'success', content: [{ type: 'json', value: { answer: 42 } }] },
      activeContext.historicalRuns[0].items[2],
      activeContext.currentRun.userMessage,
      ...activeContext.currentRun.runItems,
    ]);
    expect(prompt.conversation.filter((item) => item.type === 'user_message')).toHaveLength(2);
    expect(prompt.conversation.filter((item) => (
      item.type === 'user_message'
      && item.content.some((block) => block.type === 'text' && block.text === 'Current user')
    ))).toHaveLength(1);
    expect(prompt.conversation[1]).toMatchObject({ type: 'tool_call', toolCallId: 'call-1' });
    expect(prompt.conversation[2]).toMatchObject({ type: 'tool_result', toolCallId: 'call-1' });
    expect(prompt.conversation[5]).toMatchObject({ type: 'tool_call', toolCallId: 'call-2' });
    expect(prompt.conversation[6]).toMatchObject({ type: 'tool_result', toolCallId: 'call-2' });
    expect(JSON.stringify(prompt)).not.toContain('run-history');
    expect(JSON.stringify(prompt)).not.toContain('entry-user-current');
  });
});
