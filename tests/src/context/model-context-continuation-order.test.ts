import { describe, expect, it } from 'vitest';
import { buildModelContextInput } from '../../../src/context';
import type { ParsedInput } from '../../../src/input';

function parsedInput(): ParsedInput {
  return {
    id: 'parsed-1',
    rawInputId: 'raw-1',
    source: { kind: 'desktop' },
    rawKind: 'text',
    kind: 'user_input',
    text: 'Inspect the project.',
    attachments: [],
    references: [],
    facts: [],
    createdAt: '2026-06-20T00:00:00.000Z',
  };
}

describe('ModelContextInput current-run continuation order', () => {
  it('interleaves assistant tool calls with their tool results before the next assistant turn', () => {
    const snapshot = buildModelContextInput({
      base: {
        runId: 'run-1',
        sessionId: 'session-1',
        parsedInput: parsedInput(),
        systemInstruction: 'You are Megumi.',
        toolSet: [],
      },
      delta: {
        turnIndex: 2,
        sessionHistory: [],
        currentRunMessages: [
          {
            id: 'assistant-turn-0',
            source: 'current_run',
            message: {
              role: 'assistant',
              content: [{ type: 'toolCall', id: 'call-1', name: 'list_directory', argumentsText: '{"path":"."}' }],
              stopReason: 'tool_calls',
            },
            metadata: { turnIndex: 0 },
          },
          {
            id: 'assistant-turn-1',
            source: 'current_run',
            message: {
              role: 'assistant',
              content: [{ type: 'toolCall', id: 'call-2', name: 'read_file', argumentsText: '{"path":"README.md"}' }],
              stopReason: 'tool_calls',
            },
            metadata: { turnIndex: 1 },
          },
        ],
        toolResultMessages: [
          {
            id: 'tool-result-call-1',
            toolCallId: 'call-1',
            toolName: 'list_directory',
            status: 'success',
            content: 'README.md',
            createdAt: '2026-06-20T00:00:01.000Z',
            metadata: { turnIndex: 0 },
          },
          {
            id: 'tool-result-call-2',
            toolCallId: 'call-2',
            toolName: 'read_file',
            status: 'success',
            content: '# Megumi',
            createdAt: '2026-06-20T00:00:02.000Z',
            metadata: { turnIndex: 1 },
          },
        ],
      },
    });

    expect(snapshot.modelContextInput.messages.map((message) => (
      message.role === 'toolResult' ? `tool:${message.toolCallId}` : message.role
    ))).toEqual([
      'user',
      'assistant',
      'tool:call-1',
      'assistant',
      'tool:call-2',
    ]);
  });
});
