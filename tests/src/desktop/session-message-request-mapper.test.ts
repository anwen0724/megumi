import { describe, expect, it } from 'vitest';
import type { SessionMessageSendRequestDto } from '../../../src/shared/renderer-contracts/session-message';
import {
  createDesktopClientContext,
  mapRendererMessageSendToAppStartRun,
} from '../../../src/desktop/renderer-protocol/request/app-request';
import { mapAppResponseToRenderer } from '../../../src/desktop/renderer-protocol/response/app-response';

function createRequest(): SessionMessageSendRequestDto {
  return {
    requestId: 'ipc-session-message-request-1',
    traceId: 'trace-1',
    source: 'renderer',
    sessionId: 'session-1',
    providerId: 'deepseek',
    modelId: 'deepseek-chat',
    message: {
      id: 'message-user-1',
      text: 'hello from renderer',
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
      intent: 'branch',
    },
    createdAt: '2026-06-19T10:00:00.000Z',
    metadata: {
      clientMessageId: 'message-user-1',
    },
  };
}

describe('session message desktop mapper', () => {
  it('maps the new renderer DTO into AppStartRunRequest', () => {
    expect(mapRendererMessageSendToAppStartRun(createRequest())).toEqual({
      rawInput: {
        id: 'message-user-1',
        text: 'hello from renderer',
        source: {
          kind: 'composer',
          requestId: 'ipc-session-message-request-1',
          traceId: 'trace-1',
        },
        attachments: [],
        references: [],
        selectedRanges: [],
        createdAt: '2026-06-19T10:00:00.000Z',
        metadata: {
          clientMessageId: 'message-user-1',
          workspaceLabel: 'Megumi',
          workspacePath: 'C:/all/work/study/megumi',
          sessionTitle: 'New session',
          preprocessing: { mentions: ['file-a'] },
          branchDraft: {
            branchMarkerId: 'branch-marker-1',
            intent: 'branch',
          },
        },
      },
      sessionId: 'session-1',
      workspaceId: 'workspace-1',
      modelId: 'deepseek-chat',
      providerId: 'deepseek',
      permissionMode: 'auto',
      metadata: {
        requestId: 'ipc-session-message-request-1',
        traceId: 'trace-1',
        source: 'renderer',
        permissionSource: 'composer',
        workspaceLabel: 'Megumi',
        workspacePath: 'C:/all/work/study/megumi',
        sessionTitle: 'New session',
        branchDraft: {
          branchMarkerId: 'branch-marker-1',
          intent: 'branch',
        },
      },
    });
  });

  it('creates AppEntryContext from the new renderer DTO', () => {
    expect(createDesktopClientContext(createRequest())).toEqual({
      clientKind: 'desktop',
      requestId: 'ipc-session-message-request-1',
      createdAt: '2026-06-19T10:00:00.000Z',
      capabilities: {
        streaming: true,
        approval: true,
        filePicker: true,
        workspacePanel: true,
      },
      workspaceHint: 'C:/all/work/study/megumi',
      metadata: {
        traceId: 'trace-1',
        source: 'renderer',
      },
    });
  });

  it('rejects the old runtime envelope instead of preserving compatibility debt', () => {
    expect(() => mapRendererMessageSendToAppStartRun({
      requestId: 'legacy-request',
      payload: {
        message: {
          id: 'message-user-1',
          content: 'legacy text',
          createdAt: '2026-06-19T10:00:00.000Z',
        },
      },
    })).toThrow('session.message.send expects SessionMessageSendRequestDto');
  });

  it('maps App response to immediate ack without assistant result', () => {
    const ack = mapAppResponseToRenderer({
      runId: 'run-1',
      sessionId: 'session-1',
      workspaceId: 'workspace-1',
      status: 'running',
      result: { assistantText: 'must arrive by stream event' },
    }, createRequest());

    expect(ack).toEqual({
      requestId: 'ipc-session-message-request-1',
      runId: 'run-1',
      sessionId: 'session-1',
      workspaceId: 'workspace-1',
      status: 'running',
      accepted: true,
    });
    expect(ack).not.toHaveProperty('result');
  });
});
