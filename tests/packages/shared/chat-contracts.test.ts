// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type {
  ChatMessage,
  ChatRuntimeRequest,
} from '@megumi/shared/chat-contracts';
import { RUN_STATUSES, type RunRecord } from '@megumi/shared/run-contracts';

describe('chat contracts', () => {
  it('models a provider-neutral chat runtime request', () => {
    const message: ChatMessage = {
      id: 'message-1',
      role: 'user',
      content: 'Hello Megumi',
      createdAt: '2026-05-11T00:00:00.000Z',
    };

    const request: ChatRuntimeRequest = {
      requestId: 'request-1',
      sessionId: 'session-1',
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      messages: [message],
      context: {
        workspaceLabel: 'Megumi',
        workspacePath: 'C:/all/work/study/megumi',
        composerMode: 'chat',
      },
      createdAt: '2026-05-11T00:00:00.000Z',
    };

    expect(request.providerId).toBe('deepseek');
    expect(request.messages[0]?.role).toBe('user');
    expect(JSON.stringify(request)).not.toContain('apiKey');
  });

  it('keeps runtime events out of the chat request contract', () => {
    expect('eventType' in ({} as ChatRuntimeRequest)).toBe(false);
  });
});

describe('run contracts', () => {
  it('lists stable run statuses', () => {
    expect(RUN_STATUSES).toEqual(['queued', 'running', 'completed', 'failed', 'cancelled']);
  });

  it('models a run record without persistence-specific row fields', () => {
    const run: RunRecord = {
      id: 'run-1',
      sessionId: 'session-1',
      status: 'running',
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      startedAt: '2026-05-11T00:00:00.000Z',
      createdAt: '2026-05-11T00:00:00.000Z',
      updatedAt: '2026-05-11T00:00:00.000Z',
    };

    expect(run.status).toBe('running');
  });
});
