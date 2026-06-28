import { describe, expect, it } from 'vitest';

import { SessionTurnPreparationService } from '@megumi/coding-agent/session';
import type {
  Session,
  SessionActiveLeaf,
  SessionMessage,
  SessionSourceEntry,
} from '@megumi/shared/session';

describe('SessionTurnPreparationService', () => {
  it('prepares user input turns and commits assistant replies through session-owned records', () => {
    const repository = new InMemorySessionTurnRepository();
    const service = new SessionTurnPreparationService({
      sessionRepository: repository,
      messageRepository: repository,
      activePathRepository: repository,
      ids: sequenceIds(),
    });

    const prepared = service.prepareUserInputTurn({
      workspaceId: 'workspace-1',
      workspacePath: 'C:/workspace/project',
      sessionTitle: 'Explain tests',
      runId: 'run-1',
      content: 'Explain tests',
      messageCreatedAt: '2026-06-29T00:00:00.000Z',
      createdAt: '2026-06-29T00:00:00.000Z',
    });
    service.recordSessionRunSource({
      sessionId: String(prepared.session.sessionId),
      runId: 'run-1',
      createdAt: '2026-06-29T00:00:01.000Z',
    });
    const assistant = service.commitAssistantReply({
      sessionId: String(prepared.session.sessionId),
      runId: 'run-1',
      content: 'Tests check behavior.',
      completedAt: '2026-06-29T00:00:02.000Z',
    });

    expect(prepared.session).toMatchObject({
      sessionId: 'session-1',
      title: 'Explain tests',
      workspaceId: 'workspace-1',
      workspacePath: 'C:/workspace/project',
    });
    expect(prepared.userMessage).toMatchObject({
      messageId: 'message-1',
      role: 'user',
      runId: 'run-1',
      content: 'Explain tests',
      status: 'completed',
    });
    expect(assistant).toMatchObject({
      messageId: 'message-2',
      role: 'assistant',
      runId: 'run-1',
      content: 'Tests check behavior.',
      status: 'completed',
    });
    expect(repository.sourceEntries.map((entry) => entry.sourceRef.sourceKind)).toEqual([
      'session_message',
      'session_run',
      'session_message',
    ]);
    expect(repository.activeLeaf?.leafSourceEntryId).toBe('source-3');
  });
});

class InMemorySessionTurnRepository {
  readonly sessions = new Map<string, Session>();
  readonly messages = new Map<string, SessionMessage>();
  readonly sourceEntries: SessionSourceEntry[] = [];
  activeLeaf?: SessionActiveLeaf;

  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  saveSession(session: Session): Session {
    this.sessions.set(String(session.sessionId), session);
    return session;
  }

  saveMessage(message: SessionMessage): SessionMessage {
    this.messages.set(String(message.messageId), message);
    return message;
  }

  getActiveLeaf(): SessionActiveLeaf | undefined {
    return this.activeLeaf;
  }

  appendSourceEntryAndSetActiveLeaf(
    entry: SessionSourceEntry,
    activeLeaf: SessionActiveLeaf,
  ): SessionSourceEntry {
    this.sourceEntries.push(entry);
    this.activeLeaf = activeLeaf;
    return entry;
  }
}

function sequenceIds() {
  let session = 0;
  let message = 0;
  let source = 0;
  return {
    sessionId: () => `session-${++session}`,
    messageId: () => `message-${++message}`,
    sourceEntryId: () => `source-${++source}`,
  };
}
