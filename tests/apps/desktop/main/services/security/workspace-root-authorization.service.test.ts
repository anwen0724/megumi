// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createWorkspaceRootAuthorizer } from '@megumi/desktop/main/services/security/workspace-root-authorization.service';
type Session = {
  sessionId: string;
  title: string;
  workspaceId: string;
  workspacePath: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

function createSession(workspacePath: string): Session {
  return {
    sessionId: 'session:1',
    title: 'Workspace session',
    workspaceId: 'workspace:1',
    workspacePath,
    status: 'active',
    createdAt: '2026-05-18T00:00:00.000Z',
    updatedAt: '2026-05-18T00:00:00.000Z',
  };
}

describe('workspace root authorization', () => {
  it('allows roots that Megumi has already recorded on sessions', () => {
    const listSessions = vi.fn(() => [
      createSession('C:/work/selected-workspace'),
    ]);
    const isWorkspaceRootAllowed = createWorkspaceRootAuthorizer({
      sessionSource: { listSessions },
    });

    expect(isWorkspaceRootAllowed('C:/work/selected-workspace')).toBe(true);
    expect(listSessions).toHaveBeenCalledTimes(1);
  });

  it('allows explicitly configured host roots and rejects unknown roots', () => {
    const isWorkspaceRootAllowed = createWorkspaceRootAuthorizer({
      staticRoots: ['C:/all/work/study/megumi'],
      sessionSource: { listSessions: () => [] },
    });

    expect(isWorkspaceRootAllowed('C:/all/work/study/megumi')).toBe(true);
    expect(isWorkspaceRootAllowed('C:/Users/anwen')).toBe(false);
  });

  it('allows roots that Megumi has recorded as available projects', () => {
    const listAuthorizedWorkspaceRoots = vi.fn(() => ['C:/work/project-a']);
    const isWorkspaceRootAllowed = createWorkspaceRootAuthorizer({
      projectSource: { listAuthorizedWorkspaceRoots },
      sessionSource: { listSessions: () => [] },
    });

    expect(isWorkspaceRootAllowed('C:/work/project-a')).toBe(true);
    expect(isWorkspaceRootAllowed('C:/work/project-b')).toBe(false);
    expect(listAuthorizedWorkspaceRoots).toHaveBeenCalled();
  });
});


