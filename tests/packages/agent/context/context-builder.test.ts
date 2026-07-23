/* Verifies the Context contract and Tool Call / Tool Result ordering. */
import { Type } from '@megumi/ai';
import type { ActiveContext } from '@megumi/agent/context';
import { buildContext } from '@megumi/agent/context/service/internal/context-builder';
import { describe, expect, it } from 'vitest';

describe('buildContext', () => {
  it('keeps reference data outside systemPrompt and preserves tool protocol order', () => {
    const activeContext: ActiveContext = {
      sessionId: 'session-1',
      instructions: {
        system: [{ instructionId: 'system-1', content: 'System rule' }],
        agentInstructions: { sources: [] },
      },
      referenceContext: {
        skillCatalog: [{ name: 'Review', description: 'Review carefully', skillPath: 'C:/review/SKILL.md' }],
      },
      runContext: { skills: [] },
      historicalRuns: [{
        source: { runId: 'old', userEntryId: 'EU', userMessageId: 'MU', lastEntryId: 'ER', responseMessageRefs: [] },
        userMessage: { type: 'user_message', content: [{ type: 'text', text: 'Look it up' }] },
        items: [
          { type: 'tool_call', toolCallId: 'call-1', toolName: 'lookup', arguments: { id: 1 } },
          { type: 'tool_result', toolCallId: 'call-1', toolName: 'lookup', status: 'success', content: [{ type: 'text', text: '42' }] },
        ],
      }],
      currentRun: {
        runId: 'current',
        userEntry: { entryId: 'EN' },
        userMessage: { type: 'user_message', content: [{ type: 'text', text: 'Continue' }] },
        runItems: [],
      },
      tools: [{ name: 'lookup', description: 'Lookup', parameters: Type.Object({ id: Type.Number() }) }],
    };

    const context = buildContext(activeContext);

    expect(context.systemPrompt).toBe('System rule');
    expect(context.systemPrompt).not.toContain('Review carefully');
    expect(context.messages[0]).toMatchObject({ role: 'user' });
    const assistantIndex = context.messages.findIndex((message) => message.role === 'assistant');
    expect(context.messages[assistantIndex]).toMatchObject({
      role: 'assistant',
      content: [{ type: 'toolCall', id: 'call-1', name: 'lookup', arguments: { id: 1 } }],
    });
    expect(context.messages[assistantIndex + 1]).toMatchObject({ role: 'toolResult', toolCallId: 'call-1' });
    expect(JSON.stringify(context)).not.toContain('historical_run_state');
  });

  it('keeps an orphan Tool Call for the AI protocol transform to repair', () => {
    const context = buildContext({
      sessionId: 'session-1',
      instructions: { system: [], agentInstructions: { sources: [] } },
      referenceContext: { skillCatalog: [] },
      runContext: { skills: [] },
      historicalRuns: [],
      currentRun: {
        runId: 'run-1',
        userEntry: { entryId: 'entry-1' },
        userMessage: { type: 'user_message', content: [{ type: 'text', text: 'Write it' }] },
        runItems: [{ type: 'tool_call', toolCallId: 'call-orphan', toolName: 'write_file', arguments: { path: 'a.txt' } }],
      },
      tools: [],
    });

    expect(context.messages.at(-1)).toMatchObject({
      role: 'assistant',
      content: [{ type: 'toolCall', id: 'call-orphan' }],
    });
    expect(context.messages.some((message) => message.role === 'toolResult')).toBe(false);
  });

  it('keeps a document reference in the same user message without inlining document content', () => {
    const context = buildContext({
      sessionId: 'session-1',
      instructions: { system: [], agentInstructions: { sources: [] } },
      referenceContext: { skillCatalog: [] },
      runContext: { skills: [] },
      historicalRuns: [],
      currentRun: {
        runId: 'run-1',
        userEntry: { entryId: 'entry-1' },
        userMessage: {
          type: 'user_message',
          content: [
            { type: 'text', text: '总结这个文件' },
            {
              type: 'file',
              path: 'C:/materials/notes.docx',
              name: 'notes.docx',
              mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            },
          ],
        },
        runItems: [],
      },
      tools: [],
    });

    expect(context.messages).toHaveLength(1);
    expect(context.messages[0]).toMatchObject({
      role: 'user',
      content: [
        { type: 'text', text: '总结这个文件' },
        {
          type: 'text',
          text: JSON.stringify({
            type: 'attached_file',
            path: 'C:/materials/notes.docx',
            name: 'notes.docx',
            mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          }),
        },
      ],
    });
    expect(JSON.stringify(context)).not.toContain('attachmentId');
  });
});
