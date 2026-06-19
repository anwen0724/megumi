import { describe, expect, it } from 'vitest';
import { createSessionMessageSendRequestDto } from '../../../src/ui/features/chat/hooks/session-message-send-request';

describe('createSessionMessageSendRequestDto', () => {
  it('builds the new renderer DTO without the old runtime envelope', () => {
    const request = createSessionMessageSendRequestDto({
      payload: {
        message: 'hello from ui',
        model: 'deepseek-chat',
        permissionMode: 'auto',
        permissionSource: 'composer',
        preprocessing: { mentions: ['file-a'] },
      },
      clientMessageId: 'message-user-1',
      requestId: 'ipc-session-message-request-1',
      traceId: 'trace-1',
      createdAt: '2026-06-19T10:00:00.000Z',
      sessionId: 'session-1',
      workspaceId: 'workspace-1',
      workspaceLabel: 'Megumi',
      workspacePath: 'C:/all/work/study/megumi',
      sessionTitle: 'New session',
      branchDraft: {
        branchMarkerId: 'branch-marker-1',
        projectId: 'workspace-1',
        sessionId: 'session-1',
        sourceMessageId: 'message-a',
        seedText: 'seed',
        label: 'Rerun',
        intent: 'rerun',
        createdAt: '2026-06-19T09:59:00.000Z',
      },
    });

    expect(request).toEqual({
      requestId: 'ipc-session-message-request-1',
      traceId: 'trace-1',
      source: 'renderer',
      sessionId: 'session-1',
      providerId: 'deepseek',
      modelId: 'deepseek-chat',
      message: {
        id: 'message-user-1',
        text: 'hello from ui',
        createdAt: '2026-06-19T10:00:00.000Z',
      },
      workspace: {
        id: 'workspace-1',
        label: 'Megumi',
        path: 'C:/all/work/study/megumi',
      },
      sessionTitle: 'New session',
      permissionMode: 'auto',
      permissionSource: 'composer',
      preprocessing: { mentions: ['file-a'] },
      branchDraft: {
        branchMarkerId: 'branch-marker-1',
        intent: 'rerun',
      },
      createdAt: '2026-06-19T10:00:00.000Z',
      metadata: {
        clientMessageId: 'message-user-1',
      },
    });
    expect(request).not.toHaveProperty('payload');
    expect(request).not.toHaveProperty('meta');
    expect(request).not.toHaveProperty('context');
  });
});
