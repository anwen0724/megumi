import { describe, expect, it, vi } from 'vitest';
import type { DesktopIpcContext } from '../../../src/desktop/ipc/ipc-context';
import { handleSessionOperation } from '../../../src/desktop/ipc/session.handler';
import { createSessionStateManager } from '../../../src/session';
import { createInMemorySessionRepository } from './support/in-memory-session-repository';

function createId(prefix: string, value: string): string {
  return `${prefix}-${value}`;
}

function createContext(): DesktopIpcContext {
  const sessionRepository = createInMemorySessionRepository();
  const sessionManager = createSessionStateManager({
    repository: sessionRepository,
    now: () => '2026-06-20T00:00:00.000Z',
    createId,
  });
  sessionManager.createSession({ idSeed: '1', title: 'History', workspaceId: 'workspace-1' });
  sessionManager.appendMessage({
    idSeed: 'user-1',
    sourceEntryIdSeed: 'source-user-1',
    sessionId: 'session-1',
    role: 'user',
    content: { text: 'hello' },
  });
  sessionManager.recordRun({
    idSeed: 'run-1',
    sourceEntryIdSeed: 'source-run-1',
    sessionId: 'session-1',
    inputSummary: 'hello',
    status: 'completed',
  });
  return {
    appApi: { startRun: vi.fn(), resumeRun: vi.fn(), cancelRun: vi.fn(), retryRun: vi.fn(), subscribe: vi.fn() } as never,
    hosts: {} as never,
    runtime: { sessionRepository, sessionManager } as never,
    getMainWindow: () => undefined,
  };
}

describe('history and recovery session IPC', () => {
  it('hydrates session list and timeline from session facts', async () => {
    const context = createContext();

    await expect(handleSessionOperation('session.list', {}, context)).resolves.toEqual({
      sessions: [expect.objectContaining({ id: 'session-1', title: 'History', workspaceId: 'workspace-1' })],
    });
    await expect(handleSessionOperation('session.timeline.list', { sessionId: 'session-1' }, context)).resolves.toEqual({
      sessionId: 'session-1',
      messages: [expect.objectContaining({ messageId: 'session-message-user-1', role: 'user' })],
      runs: [expect.objectContaining({ runId: 'session-run-run-1', inputSummary: 'hello', status: 'completed' })],
      activePath: expect.arrayContaining([
        expect.objectContaining({ kind: 'message' }),
        expect.objectContaining({ kind: 'run' }),
      ]),
      diagnostics: [],
    });
  });

  it('creates and cancels branch draft through session owner facts', async () => {
    const context = createContext();

    const created = await handleSessionOperation('session.branchDraft.create', {
      sessionId: 'session-1',
      messageId: 'session-message-user-1',
      intent: 'rerun',
      createdAt: '2026-06-20T00:01:00.000Z',
    }, context) as { branchDraft: { branchMarkerId: string; sourceMessageId: string; seedText: string; intent: string } };

    expect(created.branchDraft).toMatchObject({
      sourceMessageId: 'session-message-user-1',
      seedText: 'hello',
      intent: 'rerun',
    });

    await expect(handleSessionOperation('session.branchDraft.cancel', {
      sessionId: 'session-1',
      branchMarkerId: created.branchDraft.branchMarkerId,
      createdAt: '2026-06-20T00:02:00.000Z',
    }, context)).resolves.toEqual({ cancelled: true });
  });
});
