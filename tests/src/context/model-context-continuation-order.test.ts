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
  it('builds model input from old context semantics with current turn after history and before tool replay', () => {
    const snapshot = buildModelContextInput({
      base: {
        runId: 'run-2',
        sessionId: 'session-1',
        workspaceId: 'workspace-1',
        parsedInput: {
          ...parsedInput(),
          id: 'parsed-current',
          text: 'Write a self introduction document.',
          facts: [
            {
              kind: 'command',
              commandName: 'write-doc',
              argsText: 'self-introduction',
              rawText: '/write-doc self-introduction',
              target: 'agent_command',
            },
            {
              kind: 'skill',
              skillName: 'document-writer',
              argsText: 'self-introduction',
              source: 'command',
            },
          ],
          metadata: {
            permissionMode: 'plan',
            workspacePath: 'C:/project',
          },
        },
        systemInstruction: 'You are Megumi.',
        toolSet: [
          {
            name: 'read_file',
            description: 'Read a file.',
            inputSchema: { type: 'object' },
          },
        ],
      },
      delta: {
        turnIndex: 1,
        sessionHistory: [
          {
            id: 'history-user-earth',
            source: 'session',
            message: { role: 'user', content: 'Do you know what Earth is?' },
          },
          {
            id: 'history-assistant-earth',
            source: 'session',
            message: {
              role: 'assistant',
              content: [{ type: 'text', text: 'Earth is a planet.' }],
              stopReason: 'stop',
            },
          },
        ],
        currentRunMessages: [
          {
            id: 'assistant-tool-call',
            source: 'current_run',
            message: {
              role: 'assistant',
              content: [{ type: 'toolCall', id: 'call-1', name: 'read_file', argumentsText: '{"path":"README.md"}' }],
              stopReason: 'tool_calls',
            },
            metadata: { turnIndex: 0 },
          },
        ],
        toolResultMessages: [
          {
            id: 'tool-result-call-1',
            toolCallId: 'call-1',
            toolName: 'read_file',
            status: 'success',
            content: '# Project',
            createdAt: '2026-06-20T00:00:01.000Z',
            metadata: { turnIndex: 0 },
          },
        ],
        memoryContext: ['User prefers concise Chinese answers.'],
        workspaceChangeSummary: 'No workspace changes yet.',
      },
    });

    expect((snapshot as unknown as { parts: Array<{ kind: string; text?: string }> }).parts.map((part) => part.kind)).toEqual([
      'instruction',
      'instruction',
      'runtime_constraint',
      'runtime_constraint',
      'runtime_constraint',
      'session',
      'session',
      'memory',
      'workspace_change',
      'tool_continuation',
      'tool_continuation',
      'current_turn',
    ]);
    expect(snapshot.modelContextInput.systemPrompt).toContain('Command guidance: write-doc');
    expect(snapshot.modelContextInput.systemPrompt).toContain('Available tools: read_file.');
    expect(snapshot.modelContextInput.systemPrompt).toContain('Permission mode is plan.');
    expect(snapshot.modelContextInput.systemPrompt).toContain('Memory context: User prefers concise Chinese answers.');
    expect(snapshot.modelContextInput.systemPrompt).toContain('Workspace change summary: No workspace changes yet.');
    expect(snapshot.modelContextInput.messages.map((message) => (
      message.role === 'toolResult' ? `tool:${message.toolCallId}` : `${message.role}:${'content' in message && typeof message.content === 'string' ? message.content : ''}`
    ))).toEqual([
      'user:Do you know what Earth is?',
      'assistant:',
      'user:Write a self introduction document.',
      'assistant:',
      'tool:call-1',
    ]);
  });

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
