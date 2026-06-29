// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { RuntimeEvent } from '@megumi/shared/runtime';
import type {
  Run,
  RunStep,
  Session,
  SessionActiveLeaf,
  SessionMessage,
  SessionSourceEntry,
} from '@megumi/shared/session';
import { SessionMessageService } from '@megumi/coding-agent/session';
import { ActiveSessionMessageRunTracker } from '@megumi/coding-agent/state';
import type { ChatStreamEventAdapter } from '@megumi/coding-agent/projections/chat-stream';
import {
  SubmitInputOperation,
} from '@megumi/coding-agent/product-runtime';

describe('SubmitInputOperation', () => {
  it('coordinates submit input product operation and delegates execution to agent-loop', async () => {
    const repository = new InMemorySubmitInputOperationRepository();
    const runs = new Map<string, Run>();
    const steps = new Map<string, RunStep>();
    const chatEvents: unknown[] = [];
    const activeRuns = new ActiveSessionMessageRunTracker<ChatStreamEventAdapter>();
    const sessionMessages = new SessionMessageService({
      sessionRepository: repository,
      messageRepository: repository,
      activePathRepository: repository,
      ids: sequenceIds(),
    });
    const operation = new SubmitInputOperation({
      clock: { now: () => '2026-06-29T11:00:00.000Z' },
      ids: {
        runId: () => 'run-1',
        stepId: () => 'step-1',
        chatStreamEventId: nextId('chat-event'),
        chatStreamId: () => 'chat-stream-1',
        chatTextId: nextId('chat-text'),
        chatThinkingId: nextId('chat-thinking'),
      },
      sessionMessages,
      activeRuns,
      runRepository: {
        getRun: (runId) => runs.get(runId),
        saveRun(run) {
          runs.set(run.runId, run);
          return run;
        },
      },
      stepRepository: {
        saveStep(step) {
          steps.set(step.stepId, step);
          return step;
        },
      },
      permissionSnapshotService: {
        createPermissionSnapshot(input) {
          expect(input.permissionMode).toBe('default');
          return {
            permissionSnapshotId: 'permission-snapshot-1',
            runId: input.runId,
            permissionModeState: {
              permissionMode: 'default',
              source: 'system',
            },
            permissionLabel: 'Default',
            createdAt: input.createdAt,
          };
        },
        linkAcceptedSourcePlan(input) {
          return input;
        },
      },
      runRetryCoordinator: {
        recordManualRerunAttemptForBranchDraft: () => runtimeEvent('run.retry.requested'),
      },
      chatStreamEventSink: {
        publish(event) {
          chatEvents.push(event);
        },
      },
      appendEvent: () => undefined,
      runAgentLoop(input) {
        expect(input.session.sessionId).toBe('session-1');
        expect(input.run.permissionSnapshotRef).toBe('permission-snapshot-1');
        expect(input.step.stepId).toBe('step-1');
        expect(input.userMessage.content).toBe('Explain G2');
        expect(input.permissionMode).toBe('default');
        return collectable([runtimeEvent('run.started')]);
      },
    });

    const result = await operation.send({
      requestId: 'request-1',
      payload: {
        providerId: 'openai',
        modelId: 'gpt-test',
        context: {
          workspaceId: 'workspace-1',
          workspacePath: 'C:/workspace/project',
        },
        messages: [{
          id: 'client-message-1',
          role: 'user',
          content: 'Explain G2',
          createdAt: '2026-06-29T11:00:00.000Z',
        }],
        createdAt: '2026-06-29T11:00:00.000Z',
      },
    });
    const events = await collect(result.events);

    expect(result.data).toEqual({ requestId: 'request-1' });
    expect(events.map((event) => event.eventType)).toEqual(['run.started']);
    expect(repository.messages.get('message-1')).toMatchObject({
      role: 'user',
      runId: 'run-1',
      content: 'Explain G2',
    });
    expect(runs.get('run-1')).toMatchObject({
      sessionId: 'session-1',
      permissionSnapshotRef: 'permission-snapshot-1',
    });
    expect(chatEvents).toEqual([
      expect.objectContaining({
        eventType: 'turn.started',
      }),
      expect.objectContaining({
        eventType: 'user.message.committed',
        text: 'Explain G2',
      }),
    ]);
    expect(activeRuns.get('request-1')).toBeUndefined();
  });
});

class InMemorySubmitInputOperationRepository {
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

function nextId(prefix: string): () => string {
  let index = 0;
  return () => `${prefix}-${++index}`;
}

async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  const collected: T[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}

async function* collectable<T>(items: readonly T[]): AsyncIterable<T> {
  for (const item of items) {
    yield item;
  }
}

function runtimeEvent(eventType: RuntimeEvent['eventType']): RuntimeEvent {
  return {
    eventId: 'event-1',
    eventType,
    runId: 'run-1',
    sessionId: 'session-1',
    sequence: 1,
    createdAt: '2026-06-29T11:00:00.000Z',
    schemaVersion: 1,
    source: 'core',
    visibility: 'user',
    persist: 'required',
    payload: {},
  };
}
