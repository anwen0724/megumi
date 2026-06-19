import { describe, expect, it } from 'vitest';
import { isSessionMessageSendRequestDto } from '../../../src/shared/renderer-contracts/session-message';

describe('session message renderer contract', () => {
  it('accepts the new renderer DTO shape', () => {
    expect(isSessionMessageSendRequestDto({
      requestId: 'request-1',
      traceId: 'trace-1',
      source: 'renderer',
      sessionId: 'session-1',
      providerId: 'deepseek',
      modelId: 'deepseek-chat',
      message: {
        id: 'message-user-1',
        text: 'hello',
        createdAt: '2026-06-19T10:00:00.000Z',
      },
      workspace: {
        id: 'workspace-1',
        label: 'Megumi',
        path: 'C:/all/work/study/megumi',
      },
      permissionMode: 'auto',
      createdAt: '2026-06-19T10:00:00.000Z',
    })).toBe(true);
  });

  it('rejects the old renderer runtime envelope shape', () => {
    expect(isSessionMessageSendRequestDto({
      requestId: 'request-1',
      payload: {
        message: {
          id: 'message-user-1',
          content: 'hello',
          createdAt: '2026-06-19T10:00:00.000Z',
        },
      },
      meta: { source: 'renderer' },
      context: { operationName: 'session.message.send' },
    })).toBe(false);
  });
});
