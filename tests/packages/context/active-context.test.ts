/* Verifies references stay outside system instructions and model protocol ordering remains intact. */
import { Type } from '@megumi/ai';
import { describe, expect, it } from 'vitest';
import {
  assembleActiveContext,
  buildAiContext,
  type ActiveContext,
} from '../../../packages/context/src/active-context';

function baseContext(): ActiveContext {
  return {
    sessionId: 'session:1',
    systemInstructions: [{ instructionId: 'system:1', content: 'System rule' }],
    effectiveInstructions: { sources: [] },
    skillCatalog: [{
      name: 'Review',
      description: 'Review carefully',
      skillPath: 'C:/review/SKILL.md',
    }],
    usedSkills: [],
    historicalRuns: [],
    tools: [],
  };
}

describe('active Context materialization', () => {
  it('keeps reference data outside systemPrompt and preserves Tool Call / Tool Result order', () => {
    const active: ActiveContext = {
      ...baseContext(),
      historicalRuns: [{
        source: {
          runId: 'run:old',
          userEntryId: 'entry:user',
          userMessageId: 'message:user',
          lastEntryId: 'entry:result',
          responseMessageRefs: [],
        },
        userMessage: { type: 'user_message', content: [{ type: 'text', text: 'Look it up' }] },
        items: [
          { type: 'tool_call', toolCallId: 'call:1', toolName: 'lookup', arguments: { id: 1 } },
          {
            type: 'tool_result',
            toolCallId: 'call:1',
            toolName: 'lookup',
            status: 'success',
            content: [{ type: 'text', text: '42' }],
          },
        ],
      }],
      currentRun: {
        runId: 'run:current',
        userEntry: { entryId: 'entry:current' },
        userMessage: { type: 'user_message', content: [{ type: 'text', text: 'Continue' }] },
        runItems: [],
      },
      tools: [{ name: 'lookup', description: 'Lookup', parameters: Type.Object({ id: Type.Number() }) }],
    };

    const context = buildAiContext(active);
    expect(context.systemPrompt).toBe('System rule');
    expect(context.systemPrompt).not.toContain('Review carefully');
    const assistantIndex = context.messages.findIndex((message) => message.role === 'assistant');
    expect(context.messages[assistantIndex]).toMatchObject({
      role: 'assistant',
      content: [{ type: 'toolCall', id: 'call:1', name: 'lookup', arguments: { id: 1 } }],
    });
    expect(context.messages[assistantIndex + 1]).toMatchObject({
      role: 'toolResult',
      toolCallId: 'call:1',
    });
    expect(JSON.stringify(context)).not.toContain('historical_run_state');
  });

  it('keeps an orphan Tool Call for the provider protocol adapter to repair', () => {
    const context = buildAiContext({
      ...baseContext(),
      skillCatalog: [],
      currentRun: {
        runId: 'run:1',
        userEntry: { entryId: 'entry:1' },
        userMessage: { type: 'user_message', content: [{ type: 'text', text: 'Write it' }] },
        runItems: [{
          type: 'tool_call',
          toolCallId: 'call:orphan',
          toolName: 'write_file',
          arguments: { path: 'a.txt' },
        }],
      },
    });
    expect(context.messages.at(-1)).toMatchObject({
      role: 'assistant',
      content: [{ type: 'toolCall', id: 'call:orphan' }],
    });
    expect(context.messages.some((message) => message.role === 'toolResult')).toBe(false);
  });

  it('keeps document references in the user message without injecting document contents', () => {
    const context = buildAiContext({
      ...baseContext(),
      skillCatalog: [],
      systemInstructions: [],
      currentRun: {
        runId: 'run:1',
        userEntry: { entryId: 'entry:1' },
        userMessage: {
          type: 'user_message',
          content: [
            { type: 'text', text: 'summarize this file' },
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
    });
    expect(context.messages).toHaveLength(1);
    expect(context.messages[0]).toMatchObject({
      role: 'user',
      content: [
        { type: 'text', text: 'summarize this file' },
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
  });

  it('returns source references separately from the AI-visible Context', () => {
    const result = assembleActiveContext(baseContext());
    expect(result.sourceRefs).toEqual([
      { sourceType: 'system_instruction', sourceId: 'system:1' },
      { sourceType: 'skill_catalog', sourceId: 'C:/review/SKILL.md' },
    ]);
    expect(JSON.stringify(buildAiContext(result.activeContext))).not.toContain('system:1');
  });
});
