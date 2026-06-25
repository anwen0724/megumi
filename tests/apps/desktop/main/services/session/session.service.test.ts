// @vitest-environment node
// Verifies the desktop session facade delegates each session method to the product
// runtime's SessionRunService, so IPC handlers depend on the facade rather than the
// product class directly.
import { describe, expect, it, vi } from 'vitest';
import { createDesktopSessionService } from '@megumi/desktop/main/services/session/session.service';

function stubSessionRunService() {
  return {
    createSession: vi.fn(() => ({ sessionId: 'session-1' })),
    listSessions: vi.fn(() => [{ sessionId: 'session-1' }]),
    listMessagesBySession: vi.fn(() => [{ messageId: 'message-1' }]),
    listTimelineMessagesBySession: vi.fn(() => ({ messages: [], diagnostics: [] })),
    sendSessionMessage: vi.fn(async () => ({ data: { sessionId: 'session-1' }, events: (async function* () {})() })),
    cancelSessionMessage: vi.fn(() => true),
    createBranchDraft: vi.fn(() => ({ branchDraft: { branchMarkerId: 'marker-1' }, events: [] })),
    cancelBranchDraft: vi.fn(() => ({ cancelled: true })),
    // Extra methods the facade must NOT expose are still present on the runtime.
    listRunsBySession: vi.fn(),
    listRuntimeEventsByRun: vi.fn(),
  };
}

describe('desktop session facade', () => {
  it('delegates createSession to the runtime', () => {
    const runtime = stubSessionRunService();
    const service = createDesktopSessionService(runtime as never);
    const payload = { title: 'S', createdAt: '2026-06-24T00:00:00.000Z' };
    expect(service.createSession(payload as never)).toEqual({ sessionId: 'session-1' });
    expect(runtime.createSession).toHaveBeenCalledWith(payload);
  });

  it('delegates listSessions to the runtime', () => {
    const runtime = stubSessionRunService();
    const service = createDesktopSessionService(runtime as never);
    expect(service.listSessions()).toEqual([{ sessionId: 'session-1' }]);
    expect(runtime.listSessions).toHaveBeenCalledOnce();
  });

  it('delegates listMessagesBySession to the runtime', () => {
    const runtime = stubSessionRunService();
    const service = createDesktopSessionService(runtime as never);
    expect(service.listMessagesBySession('session-1')).toEqual([{ messageId: 'message-1' }]);
    expect(runtime.listMessagesBySession).toHaveBeenCalledWith('session-1');
  });

  it('delegates listTimelineMessagesBySession to the runtime', () => {
    const runtime = stubSessionRunService();
    const service = createDesktopSessionService(runtime as never);
    const input = { projectId: 'project-1', sessionId: 'session-1' };
    expect(service.listTimelineMessagesBySession(input)).toEqual({ messages: [], diagnostics: [] });
    expect(runtime.listTimelineMessagesBySession).toHaveBeenCalledWith(input);
  });

  it('delegates sendSessionMessage to the runtime', async () => {
    const runtime = stubSessionRunService();
    const service = createDesktopSessionService(runtime as never);
    const input = { requestId: 'request-1', payload: { sessionId: 'session-1' } };
    const result = await service.sendSessionMessage(input as never);
    expect(result.data).toEqual({ sessionId: 'session-1' });
    expect(runtime.sendSessionMessage).toHaveBeenCalledWith(input);
  });

  it('delegates cancelSessionMessage to the runtime', () => {
    const runtime = stubSessionRunService();
    const service = createDesktopSessionService(runtime as never);
    expect(service.cancelSessionMessage({ sessionId: 'session-1' } as never)).toBe(true);
    expect(runtime.cancelSessionMessage).toHaveBeenCalledWith({ sessionId: 'session-1' });
  });

  it('delegates createBranchDraft to the runtime and mirrors its synchronous Iterable events', () => {
    const runtime = stubSessionRunService();
    const service = createDesktopSessionService(runtime as never);
    const input = { requestId: 'request-1', sessionId: 'session-1', messageId: 'message-1', intent: 'branch', createdAt: '2026-06-24T00:00:00.000Z' };
    const result = service.createBranchDraft(input as never);
    expect(result.branchDraft).toEqual({ branchMarkerId: 'marker-1' });
    expect(Array.isArray(result.events)).toBe(true);
    expect(runtime.createBranchDraft).toHaveBeenCalledWith(input);
  });

  it('delegates cancelBranchDraft to the runtime', () => {
    const runtime = stubSessionRunService();
    const service = createDesktopSessionService(runtime as never);
    const input = { requestId: 'request-1', sessionId: 'session-1', branchMarkerId: 'marker-1', createdAt: '2026-06-24T00:00:00.000Z' };
    expect(service.cancelBranchDraft(input as never)).toEqual({ cancelled: true });
    expect(runtime.cancelBranchDraft).toHaveBeenCalledWith(input);
  });
});
