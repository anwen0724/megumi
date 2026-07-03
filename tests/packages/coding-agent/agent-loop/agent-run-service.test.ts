import { describe, expect, it, vi } from 'vitest';
import { createAgentRunService } from '@megumi/coding-agent/agent-loop';
import type { Session, SessionMessage } from '@megumi/shared/session';

describe('AgentRunService input and command orchestration', () => {
  it('starts ordinary agent run from parsed message input', async () => {
    const harness = createAgentRunHarness();
    const commandService = {
      handleCommandInput: vi.fn(),
    };
    const service = createAgentRunService({
      inputService: {
        processUserInput: vi.fn(async () => ({
          status: 'ok' as const,
          parsed_user_input: {
            type: 'message' as const,
            text: '帮我看下代码',
            attachments: [],
          },
        })),
      },
      session: harness.session,
      userInput: harness.userInput,
      commandService,
    });

    const result = await service.send({
      requestId: 'request-1',
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      text: '帮我看下代码',
      createdAt: '2026-07-03T00:00:00.000Z',
    });

    expect(result.type).toBe('agent_run');
    expect(commandService.handleCommandInput).not.toHaveBeenCalled();
    expect(harness.userInput.handle).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 'request-1',
      payload: expect.objectContaining({
        message: expect.objectContaining({
          content: '帮我看下代码',
        }),
      }),
    }));
  });

  it('calls Command Service when parsed input is command-shaped', async () => {
    const harness = createAgentRunHarness();
    const commandService = {
      handleCommandInput: vi.fn(async () => ({
        type: 'completed' as const,
        message: 'Context compacted.',
      })),
    };
    const service = createAgentRunService({
      inputService: {
        processUserInput: vi.fn(async () => ({
          status: 'ok' as const,
          parsed_user_input: {
            type: 'command' as const,
            text: '/compact',
            attachments: [],
          },
        })),
      },
      session: harness.session,
      userInput: harness.userInput,
      commandService,
    });

    await expect(service.send({
      requestId: 'request-1',
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      text: '/compact',
      createdAt: '2026-07-03T00:00:00.000Z',
    })).resolves.toEqual({
      type: 'completed',
      requestId: 'request-1',
      message: 'Context compacted.',
    });

    expect(commandService.handleCommandInput).toHaveBeenCalledWith(expect.objectContaining({
      raw_input: '/compact',
    }));
    expect(harness.userInput.handle).not.toHaveBeenCalled();
  });
});

function createAgentRunHarness() {
  const sessionRecord: Session = {
    sessionId: 'session-1',
    title: 'Session',
    status: 'active',
    createdAt: '2026-07-03T00:00:00.000Z',
    updatedAt: '2026-07-03T00:00:00.000Z',
  };
  const messages: SessionMessage[] = [];
  const session = {
    createSession: vi.fn(() => sessionRecord),
    listMessagesBySession: vi.fn(() => messages),
    listSessions: vi.fn(() => [sessionRecord]),
  };
  const userInput = {
    handle: vi.fn(async (input: { payload: { message?: { content: string; createdAt: string } } }) => {
      messages.push({
        messageId: 'message-1',
        sessionId: 'session-1',
        runId: 'run-1',
        role: 'user',
        content: input.payload.message?.content ?? '',
        status: 'completed',
        createdAt: input.payload.message?.createdAt ?? '2026-07-03T00:00:00.000Z',
        completedAt: input.payload.message?.createdAt ?? '2026-07-03T00:00:00.000Z',
      });
      return {
        data: {
          requestId: 'request-1',
          session: sessionRecord,
          userMessageId: 'message-1',
          runId: 'run-1',
        },
        events: emptyAsyncIterable(),
      };
    }),
    cancel: vi.fn(() => true),
  };

  return { session, userInput };
}

async function* emptyAsyncIterable<T = never>(): AsyncIterable<T> {}
