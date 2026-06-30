// Verifies agent loop aggregate persistence on the redesigned run/call/event tables.
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createDatabase } from '@megumi/coding-agent/persistence/connection';
import { applyCodingAgentDatabaseMigrations } from '@megumi/coding-agent/persistence/schema/migrate';
import { AgentLoopRepository } from '@megumi/coding-agent/persistence/repos/agent-loop.repo';
import { SessionRepository } from '@megumi/coding-agent/persistence/repos/session.repo';
import { WorkspaceRepository } from '@megumi/coding-agent/persistence/repos/workspace.repo';

function createSeededDatabase() {
  const database = createDatabase(':memory:');
  applyCodingAgentDatabaseMigrations(database);
  const workspace = new WorkspaceRepository(database).upsertFromRepoPath({
    repoPath: 'C:/workspaces/project',
    now: '2026-06-30T00:00:00.000Z',
  });
  const sessionRepo = new SessionRepository(database);
  sessionRepo.createSession({
    sessionId: 'session-1',
    workspaceId: workspace.projectId,
    title: 'Session',
    now: '2026-06-30T00:00:00.000Z',
  });
  const userMessage = sessionRepo.appendUserMessage({
    messageId: 'message-user-1',
    sessionId: 'session-1',
    contentText: 'hello',
    createdAt: '2026-06-30T00:00:01.000Z',
  });

  return {
    database,
    workspaceId: workspace.projectId,
    userEntryId: userMessage.entryId,
    sessionRepo,
  };
}

describe('AgentLoopRepository', () => {
  it('creates a run for a user message and records model calls/events', () => {
    const { database, workspaceId, sessionRepo } = createSeededDatabase();
    const repo = new AgentLoopRepository(database);

    const run = repo.createRun({
      runId: 'run-1',
      workspaceId,
      sessionId: 'session-1',
      userMessageId: 'message-user-1',
      createdAt: '2026-06-30T00:00:02.000Z',
    });
    sessionRepo.linkUserMessageToRun({
      messageId: 'message-user-1',
      runId: 'run-1',
    });
    const firstCall = repo.recordModelCall({
      modelCallId: 'model-call-1',
      runId: 'run-1',
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      status: 'completed',
      startedAt: '2026-06-30T00:00:03.000Z',
      completedAt: '2026-06-30T00:00:04.000Z',
    });
    const firstEvent = repo.recordEvent({
      eventId: 'event-1',
      runId: 'run-1',
      sessionId: 'session-1',
      eventType: 'model_call.completed',
      createdAt: '2026-06-30T00:00:04.000Z',
    });

    expect(run.runId).toBe('run-1');
    expect(firstCall.callOrder).toBe(1);
    expect(firstEvent.sequence).toBe(1);
    expect(database.prepare('SELECT run_id FROM session_messages WHERE message_id = ?').get('message-user-1')).toEqual({
      run_id: 'run-1',
    });
  });

  it('completes a run with the assistant message as the branch head', () => {
    const { database, workspaceId, sessionRepo } = createSeededDatabase();
    const repo = new AgentLoopRepository(database);
    repo.createRun({
      runId: 'run-1',
      workspaceId,
      sessionId: 'session-1',
      userMessageId: 'message-user-1',
      createdAt: '2026-06-30T00:00:02.000Z',
    });

    const completed = sessionRepo.appendAssistantMessage({
      runId: 'run-1',
      messageId: 'message-assistant-1',
      sessionId: 'session-1',
      contentText: 'hi',
      completedAt: '2026-06-30T00:00:05.000Z',
    });
    repo.markRunCompleted({
      runId: 'run-1',
      assistantMessageId: 'message-assistant-1',
      completedAt: '2026-06-30T00:00:05.000Z',
    });

    expect(completed.entryId).toBe('message:message-assistant-1');
    expect(database.prepare('SELECT assistant_message_id, status FROM agent_loop_runs WHERE run_id = ?').get('run-1')).toEqual({
      assistant_message_id: 'message-assistant-1',
      status: 'completed',
    });
    expect(database.prepare('SELECT active_entry_id FROM sessions WHERE session_id = ?').get('session-1')).toEqual({
      active_entry_id: 'message:message-assistant-1',
    });
  });
});
