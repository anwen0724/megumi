import { describe, expect, it } from 'vitest';
import { projectCurrentInteraction } from '@megumi/desktop/renderer/features/character-presence/current-interaction';
import type {
  TimelineAssistantMessage,
  TimelineMessage,
} from '@megumi/desktop/renderer/features/session-timeline';

describe('projectCurrentInteraction', () => {
  it('projects only the current turn, reply, tool, approval and error facts', () => {
    const messages = [
      user('old-user', 'Earlier question', '2026-01-01T00:00:00.000Z'),
      assistant('old-run', 'Earlier answer', 'completed', '2026-01-01T00:00:01.000Z'),
      user('current-user', 'Change the file', '2026-01-01T00:01:00.000Z'),
      {
        ...assistant('current-run', 'I am checking it.', 'streaming', '2026-01-01T00:01:01.000Z'),
        blocks: [
          {
            blockId: 'process-current-run',
            kind: 'process_disclosure' as const,
            executionId: 'current-run',
            status: 'running' as const,
            items: [
              {
                itemId: 'tool-1',
                kind: 'tool_activity' as const,
                toolCallId: 'tool-1',
                toolName: 'write_file',
                inputSummary: 'src/file.ts',
                status: 'awaiting_approval' as const,
                approval: {
                  approvalRequestId: 'approval-1',
                  defaultOptionId: 'once',
                  options: [{ optionId: 'once', scope: 'once' as const, label: 'Once', description: 'Approve once' }],
                },
              },
              { itemId: 'error-1', kind: 'error_activity' as const, errorMessage: 'Previous attempt failed.' },
            ],
          },
          {
            blockId: 'answer-current-run',
            kind: 'answer_text' as const,
            executionId: 'current-run',
            textId: 'answer-current-run',
            status: 'streaming' as const,
            text: 'I am checking it.',
            format: 'markdown' as const,
          },
        ],
      },
    ] satisfies TimelineMessage[];

    const interaction = projectCurrentInteraction(messages);

    expect(interaction?.executionId).toBe('current-run');
    expect(interaction?.userText).toBe('Change the file');
    expect(interaction?.replyText).toBe('I am checking it.');
    expect(interaction?.activeTool?.toolName).toBe('write_file');
    expect(interaction?.approval?.approval?.approvalRequestId).toBe('approval-1');
    expect(interaction?.error).toBe('Previous attempt failed.');
    expect(JSON.stringify(interaction)).not.toContain('Earlier question');
  });
});

function user(messageId: string, text: string, createdAt: string): TimelineMessage {
  return {
    messageId,
    role: 'user',
    projectId: 'project-1',
    sessionId: 'session-1',
    createdAt,
    blocks: [{ blockId: `${messageId}:text`, kind: 'user_text', text, format: 'plain' }],
  };
}

function assistant(
  executionId: string,
  text: string,
  status: 'streaming' | 'completed',
  createdAt: string,
): TimelineAssistantMessage {
  return {
    messageId: `${executionId}:message`,
    role: 'assistant',
    executionId,
    projectId: 'project-1',
    sessionId: 'session-1',
    createdAt,
    blocks: [{
      blockId: `${executionId}:answer`,
      kind: 'answer_text',
      executionId,
      textId: `${executionId}:answer`,
      status,
      text,
      format: 'markdown',
    }],
  };
}
