import { describe, expect, it, vi } from 'vitest';
import { createAgentRunService } from '@megumi/coding-agent/agent-loop';
import type { AgentRunSendRequest } from '@megumi/coding-agent/agent-loop';
import type { RawUserInputAttachment } from '@megumi/coding-agent/input';
import type { Session } from '@megumi/shared/session';
import type { SessionMessageWithAttachments } from '@megumi/coding-agent/session';

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
      workspaceId: 'workspace-1',
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

  it('forwards submitted attachment references to Input Service', async () => {
    const harness = createAgentRunHarness();
    const attachment: RawUserInputAttachment = {
      attachment_id: 'upload:image:1',
      type: 'image',
      mime_type: 'image/png',
      source: { type: 'local_file', path: 'C:/tmp/error.png' },
    };
    const inputService = {
      processUserInput: vi.fn(async () => ({
        status: 'ok' as const,
        parsed_user_input: {
          type: 'message' as const,
          text: '看一下这张图',
          attachments: [attachment],
        },
      })),
    };
    const service = createAgentRunService({
      inputService,
      session: harness.session,
      userInput: harness.userInput,
      commandService: { handleCommandInput: vi.fn() },
    });
    const request: AgentRunSendRequest = {
      requestId: 'request-1',
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      text: '看一下这张图',
      attachments: [attachment],
      workspaceId: 'workspace-1',
      createdAt: '2026-07-03T00:00:00.000Z',
    };

    await service.send(request);

    expect(inputService.processUserInput).toHaveBeenCalledWith({
      user_input: {
        text: '看一下这张图',
        attachments: [attachment],
      },
    });
  });
});

function createAgentRunHarness() {
  const sessionRecord: Session = {
    sessionId: 'session-1',
    title: 'Session',
    workspaceId: 'workspace-1',
    status: 'active',
    createdAt: '2026-07-03T00:00:00.000Z',
    updatedAt: '2026-07-03T00:00:00.000Z',
  };
  const messages: SessionMessageWithAttachments[] = [];
  const session = {
    createSession: vi.fn(() => ({
      status: 'created' as const,
      session: {
        session_id: 'session-1',
        workspace_id: 'workspace-1',
        title: 'Session',
        status: 'active' as const,
        created_at: '2026-07-03T00:00:00.000Z',
        updated_at: '2026-07-03T00:00:00.000Z',
      },
    })),
    getSession: vi.fn(() => ({
      status: 'found' as const,
      session: {
        session_id: 'session-1',
        workspace_id: 'workspace-1',
        title: 'Session',
        status: 'active' as const,
        created_at: '2026-07-03T00:00:00.000Z',
        updated_at: '2026-07-03T00:00:00.000Z',
      },
    })),
    listMessages: vi.fn(() => ({ status: 'ok' as const, messages })),
  };
  const userInput = {
    handle: vi.fn(async (input: { payload: { message?: { content: string; createdAt: string } } }) => {
      messages.push({
        message: {
          message_id: 'message-1',
          session_id: 'session-1',
          run_id: 'run-1',
          role: 'user',
          content_text: input.payload.message?.content ?? '',
          created_at: input.payload.message?.createdAt ?? '2026-07-03T00:00:00.000Z',
          completed_at: input.payload.message?.createdAt ?? '2026-07-03T00:00:00.000Z',
        },
        attachments: [],
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
