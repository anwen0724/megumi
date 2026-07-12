/*
 * Verifies complete provider-neutral Prompt projection and conversation ordering.
 */
import { describe, expect, it } from 'vitest';
import type { ActiveContext } from '@megumi/coding-agent/context';
import { buildPrompt } from '@megumi/coding-agent/context/service/internal/prompt-builder';

describe('buildPrompt', () => {
  it('renders a historical Tool Call without Result as ordinary ordered Context', () => {
    const activeContext = {
      sessionId: 'session-1',
      instructions: { system: [], agentInstructions: { sources: [] }, activatedSkills: [] },
      referenceContext: { skillCatalog: [] },
      historicalTurns: [{
        source: { runId: 'run-old', userEntryId: 'EU', userMessageId: 'MU' },
        runStatus: 'cancelled' as const,
        userMessage: { type: 'user_message' as const, content: [{ type: 'text' as const, text: 'Create a file' }] },
        modelSteps: [{ modelCallId: 'model-1', assistantContent: [{ type: 'text' as const, text: 'I will create it.' }], toolCalls: [{ toolCallId: 'call-1', toolName: 'write_file', arguments: { path: 'a.ts' } }] }],
        finalOutcome: { reason: 'cancelled' },
        diagnostics: [],
      }],
      currentTurn: { runId: 'run-now', userEntry: { entryId: 'EN' }, userMessage: { type: 'user_message' as const, content: [{ type: 'text' as const, text: 'Continue' }] }, runItems: [] },
      tools: [],
    };

    expect(buildPrompt(activeContext).conversation).toEqual([
      activeContext.historicalTurns[0].userMessage,
      {
        type: 'context',
        kind: 'historical_run_state',
        content: expect.objectContaining({
          runId: 'run-old',
          runStatus: 'cancelled',
          modelStep: expect.objectContaining({
            assistantContent: [{ type: 'text', text: 'I will create it.' }],
            toolCalls: [expect.objectContaining({ toolCallId: 'call-1' })],
          }),
        }),
      },
      activeContext.currentTurn.userMessage,
    ]);
  });

  it('projects logical regions and preserves historical and current protocol order', () => {
    const activeContext: ActiveContext = {
      sessionId: 'session-1',
      instructions: {
        system: [{ instructionId: 'system-1', content: 'System rule' }],
        agentInstructions: { sources: [] },
        activatedSkills: [],
      },
      referenceContext: { skillCatalog: [] },
      historicalTurns: [{
        source: {
          runId: 'run-history',
          userEntryId: 'entry-user-history',
          userMessageId: 'message-user-history',
          assistantEntryId: 'entry-assistant-history',
          assistantMessageId: 'message-assistant-history',
        },
        userMessage: { type: 'user_message', content: [{ type: 'text', text: 'Historical user' }] },
        runStatus: 'completed',
        modelSteps: [
          { modelCallId: 'model-1', assistantContent: [], toolCalls: [{
          toolCallId: 'call-1', toolName: 'lookup', arguments: { id: 1 },
          result: { status: 'success', content: [{ type: 'json', value: { answer: 42 } }] },
          }] },
          { modelCallId: 'model-2', assistantContent: [{ type: 'text', text: 'Historical assistant' }], toolCalls: [] },
        ],
        finalAssistantMessage: { type: 'assistant_message', content: [{ type: 'text', text: 'Historical assistant' }] },
        diagnostics: [],
      }],
      currentTurn: {
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

    expect(Object.keys(prompt)).toEqual(['instructions', 'referenceContext', 'conversation', 'tools']);
    expect(prompt.conversation).toEqual([
      activeContext.historicalTurns[0].userMessage,
      { type: 'tool_call', toolCallId: 'call-1', toolName: 'lookup', arguments: { id: 1 } },
      { type: 'tool_result', toolCallId: 'call-1', toolName: 'lookup', status: 'success', content: [{ type: 'json', value: { answer: 42 } }] },
      activeContext.historicalTurns[0].finalAssistantMessage,
      activeContext.currentTurn.userMessage,
      ...activeContext.currentTurn.runItems,
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
