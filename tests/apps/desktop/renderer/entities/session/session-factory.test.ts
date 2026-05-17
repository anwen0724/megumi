// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createLocalSession } from '@megumi/desktop/renderer/entities/session/session-factory';

describe('createLocalSession', () => {
  it('creates a local free-agent session with a stable title and timestamps', () => {
    const session = createLocalSession({
      id: 'session-1',
      projectId: 'local-workspace',
      now: '2026-05-09T12:00:00.000Z',
    });

    expect(session).toEqual({
      id: 'session-1',
      projectId: 'local-workspace',
      agentType: 'free',
      title: 'New session',
      createdAt: '2026-05-09T12:00:00.000Z',
      updatedAt: '2026-05-09T12:00:00.000Z',
    });
  });

  it('uses explicit title and agent type when provided', () => {
    const session = createLocalSession({
      id: 'session-2',
      projectId: 'project-1',
      title: 'Planning the UI',
      agentType: 'architect',
      now: '2026-05-09T12:30:00.000Z',
    });

    expect(session.title).toBe('Planning the UI');
    expect(session.agentType).toBe('architect');
    expect(session.projectId).toBe('project-1');
  });

  it('trims empty titles back to the default title', () => {
    const session = createLocalSession({
      id: 'session-3',
      projectId: 'local-workspace',
      title: '   ',
      now: '2026-05-09T12:45:00.000Z',
    });

    expect(session.title).toBe('New session');
  });
});
