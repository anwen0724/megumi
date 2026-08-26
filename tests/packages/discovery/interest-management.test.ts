/* Verifies manual Interest management and the non-blocking FIFO extraction runtime. */
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Model, Api } from '@megumi/ai';
import { createDatabase, migrateDatabase, type DatabaseConnection } from '@megumi/database';
import {
  createDiscovery,
  createDiscoveryRepository,
} from '@megumi/discovery';

const now = '2026-08-22T10:00:00.000Z';
const model = {
  id: 'test-model',
  name: 'Test',
  api: 'test-api',
  provider: 'test-provider',
  baseUrl: 'https://example.invalid',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 8_192,
  maxTokens: 1_024,
} as Model<Api>;

describe('Discovery Agent Interest runtime', () => {
  let database: DatabaseConnection;

  beforeEach(() => {
    database = createDatabase({ filename: ':memory:' });
    migrateDatabase({ database });
    insertConversation(database, 'session:1', [
      ['execution:1', 'user:1', 'assistant:1', '我想持续关注 Agent 工程化'],
      ['execution:2', 'user:2', 'assistant:2', '也想多看真实项目复盘'],
    ]);
  });
  afterEach(() => database.close());

  it('manages one durable Interest state machine and never revives a deleted row', async () => {
    const { agent } = fixture(database);

    const created = await agent.changeInterest({ action: 'create', description: '  Agent 工程化  ' });
    expect(created).toMatchObject({
      description: 'Agent 工程化',
      status: 'active',
      createdFrom: 'manual',
      userManagedAt: now,
    });
    expect(await agent.changeInterest({ action: 'pause', interestId: created.interestId }))
      .toMatchObject({ status: 'paused', pausedAt: now });
    expect(await agent.changeInterest({ action: 'pause', interestId: created.interestId }))
      .toMatchObject({ status: 'paused' });
    expect(await agent.changeInterest({ action: 'resume', interestId: created.interestId }))
      .toMatchObject({ status: 'active' });
    expect(await agent.changeInterest({
      action: 'update',
      interestId: created.interestId,
      description: 'Agent Harness 实践',
    })).toMatchObject({ description: 'Agent Harness 实践' });
    expect(await agent.changeInterest({ action: 'delete', interestId: created.interestId }))
      .toMatchObject({ status: 'deleted', deletedAt: now });

    const recreated = await agent.changeInterest({ action: 'create', description: 'Agent Harness 实践' });
    expect(recreated.interestId).not.toBe(created.interestId);
    expect(recreated.status).toBe('active');
  });

  it('processes completed turns globally in FIFO order and lets the next job read committed results', async () => {
    const first = deferred<{ evidence: Array<{ description: string; effect: 'support'; confidence: 'high' }> }>();
    const extractor = vi.fn(async (input: any) => {
      if (input.job.executionId === 'execution:1') return first.promise;
      expect(input.interests).toEqual(expect.arrayContaining([
        expect.objectContaining({ description: 'Agent 工程化', status: 'active' }),
      ]));
      return { evidence: [] };
    });
    const { agent } = fixture(database, { extractor });

    expect(agent.observeConversationTurn(turn('execution:1', 'user:1', 'assistant:1')))
      .toEqual({ status: 'accepted' });
    expect(agent.observeConversationTurn(turn('execution:2', 'user:2', 'assistant:2')))
      .toEqual({ status: 'accepted' });
    await vi.waitFor(() => expect(extractor).toHaveBeenCalledTimes(1));

    first.resolve({
      evidence: [{ description: 'Agent 工程化', effect: 'support', confidence: 'high' }],
    });
    await vi.waitFor(() => expect(extractor).toHaveBeenCalledTimes(2));
    expect(activeInterestDescriptions(database)).toEqual(['Agent 工程化']);
    expect(database.prepare<{ count: number }>({
      sql: "SELECT COUNT(*) AS count FROM discovery_interest_evidence WHERE message_id = 'user:1'",
    }).get()?.count).toBe(1);
    expect(database.prepare<{ count: number }>({
      sql: "SELECT COUNT(*) AS count FROM discovery_interest_evidence WHERE message_id = 'assistant:1'",
    }).get()?.count).toBe(0);
  });

  it('announces durable inferred Interest changes after their transaction commits', async () => {
    const onInterestsChanged = vi.fn();
    const { agent } = fixture(database, {
      onInterestsChanged,
      extractor: async () => ({
        evidence: [{ description: 'Agent runtime', effect: 'support', confidence: 'high' }],
      }),
    });

    agent.observeConversationTurn(turn('execution:1', 'user:1', 'assistant:1'));

    await vi.waitFor(() => expect(onInterestsChanged).toHaveBeenCalledOnce());
    expect(activeInterestDescriptions(database)).toEqual(['Agent runtime']);
  });

  it('requires two independent medium signals, then retracts Session evidence on exclusion', async () => {
    const extractor = vi.fn(async (input: any) => {
      if (input.job.executionId === 'execution:1') {
        return {
          evidence: [{ description: '真实 Agent 项目复盘', effect: 'support', confidence: 'medium' }],
        };
      }
      const pending = input.pendingEvidence[0];
      expect(pending).toMatchObject({ description: '真实 Agent 项目复盘', status: 'pending' });
      return {
        evidence: [{
          description: '真实 Agent 项目复盘',
          effect: 'support',
          confidence: 'medium',
          supportingEvidenceIds: [pending.evidenceId],
        }],
      };
    });
    const { agent } = fixture(database, { extractor });

    agent.observeConversationTurn(turn('execution:1', 'user:1', 'assistant:1'));
    agent.observeConversationTurn(turn('execution:2', 'user:2', 'assistant:2'));
    await vi.waitFor(() => expect(extractor).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(activeInterestDescriptions(database)).toEqual(['真实 Agent 项目复盘']));

    expect(await agent.setSessionParticipation({
      sessionId: 'session:1',
      participation: 'excluded',
    })).toMatchObject({ participation: 'excluded' });
    expect(activeInterestDescriptions(database)).toEqual([]);
    expect(agent.observeConversationTurn({
      ...turn('execution:2', 'user:2', 'assistant:2'),
      completedAt: '2026-08-22T10:01:00.000Z',
    })).toEqual({ status: 'skipped', reason: 'session_excluded' });
    expect(database.prepare<{ count: number }>({
      sql: "SELECT COUNT(*) AS count FROM discovery_interest_evidence WHERE status = 'retracted'",
    }).get()?.count).toBe(2);
  });

  it('skips disabled or pre-effective turns and continues FIFO work after an extraction failure', async () => {
    const disabled = fixture(database, { recognitionEnabled: false }).agent;
    expect(disabled.observeConversationTurn(turn('execution:1', 'user:1', 'assistant:1')))
      .toEqual({ status: 'skipped', reason: 'recognition_disabled' });

    const extractor = vi.fn(async (input: any) => {
      if (input.job.executionId === 'execution:1') throw new Error('temporary failure');
      return {
        evidence: [{ description: 'Agent 源码分析', effect: 'support', confidence: 'high' }],
      };
    });
    const active = fixture(database, { extractor }).agent;
    expect(await active.setSessionParticipation({
      sessionId: 'session:1',
      participation: 'included',
    })).toMatchObject({ participation: 'included', effectiveFrom: now });
    expect(active.observeConversationTurn({
      ...turn('execution:1', 'user:1', 'assistant:1'),
      completedAt: '2026-08-22T09:59:59.000Z',
    })).toEqual({ status: 'skipped', reason: 'before_effective_from' });

    active.observeConversationTurn(turn('execution:1', 'user:1', 'assistant:1'));
    active.observeConversationTurn(turn('execution:2', 'user:2', 'assistant:2'));
    await vi.waitFor(() => expect(extractor).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(activeInterestDescriptions(database)).toEqual(['Agent 源码分析']));
  });

  it('aborts the active extraction and drops queued work during shutdown', async () => {
    let activeSignal: AbortSignal | undefined;
    const extractor = vi.fn((input: any) => new Promise<{ evidence: [] }>((resolve) => {
      activeSignal = input.signal;
      input.signal.addEventListener('abort', () => resolve({ evidence: [] }), { once: true });
    }));
    const { agent } = fixture(database, { extractor });
    agent.observeConversationTurn(turn('execution:1', 'user:1', 'assistant:1'));
    agent.observeConversationTurn(turn('execution:2', 'user:2', 'assistant:2'));
    await vi.waitFor(() => expect(extractor).toHaveBeenCalledTimes(1));

    await agent.shutdown();
    expect(activeSignal?.aborted).toBe(true);
    await Promise.resolve();
    expect(extractor).toHaveBeenCalledTimes(1);
    expect(agent.observeConversationTurn(turn('execution:2', 'user:2', 'assistant:2')))
      .toEqual({ status: 'skipped', reason: 'shutting_down' });
  });

  it('does not persist low-confidence ordinary mentions', async () => {
    const extractor = vi.fn(async () => ({
      evidence: [{ description: '随口提到的美食', effect: 'support', confidence: 'low' }],
    }));
    const { agent } = fixture(database, { extractor });
    agent.observeConversationTurn(turn('execution:1', 'user:1', 'assistant:1'));
    await vi.waitFor(() => expect(extractor).toHaveBeenCalledOnce());
    await Promise.resolve();
    expect(database.prepare<{ count: number }>({
      sql: 'SELECT COUNT(*) AS count FROM discovery_interest_evidence',
    }).get()?.count).toBe(0);
    expect(activeInterestDescriptions(database)).toEqual([]);
  });
});

function fixture(database: DatabaseConnection, override: {
  extractor?: (input: any) => Promise<any>;
  recognitionEnabled?: boolean;
  onInterestsChanged?: (interestIds: readonly string[]) => void;
} = {}) {
  const repository = createDiscoveryRepository({ database });
  let interestNumber = 0;
  let evidenceNumber = 0;
  const options = {
    interests: {
      repository,
      settings: {
        getDiscoverySettings: () => ({
          conversationRecognitionEnabled: override.recognitionEnabled ?? true,
        }),
      },
      sessions: {
        getSession: ({ session_id }) => session_id === 'session:1'
          ? { status: 'found', session: sessionRecord() }
          : { status: 'not_found' },
      },
      history: {
        getCommittedRunMessages: ({ executionId }) => ({
          status: 'ok',
          messages: committedMessages(executionId),
        }),
      },
      resolveModel: async () => ({ status: 'ok', model }),
      extractor: override.extractor ?? (async () => ({ evidence: [] })),
      ids: {
        createInterestId: () => `interest:${++interestNumber}`,
        createEvidenceId: () => `evidence:${++evidenceNumber}`,
      },
      clock: { now: () => now },
      ...(override.onInterestsChanged ? { onInterestsChanged: override.onInterestsChanged } : {}),
    },
  };
  return { agent: createDiscovery(options), repository };
}

function turn(executionId: string, userMessageId: string, assistantMessageId: string) {
  return { sessionId: 'session:1', executionId, userMessageId, assistantMessageId, completedAt: now };
}

function sessionRecord() {
  return {
    session_id: 'session:1',
    workspace_id: 'workspace:1',
    title: 'Session',
    status: 'active' as const,
    created_at: now,
    updated_at: now,
  };
}

function committedMessages(executionId: string): any[] {
  const suffix = executionId.endsWith(':1') ? '1' : '2';
  return [
    {
      type: 'message',
      entryId: `entry:user:${suffix}`,
      message: {
        message_id: `user:${suffix}`,
        session_id: 'session:1',
        execution_id: executionId,
        message_kind: 'user_message',
        display_content: [{ type: 'text', text: suffix === '1' ? '我想持续关注 Agent 工程化' : '也想多看真实项目复盘' }],
        model_content: [],
        created_at: now,
      },
      attachments: [],
    },
    {
      type: 'message',
      entryId: `entry:assistant:${suffix}`,
      message: {
        message_id: `assistant:${suffix}`,
        session_id: 'session:1',
        execution_id: executionId,
        message_kind: 'assistant_reply',
        status: 'completed',
        content: [{ type: 'text', text: '好的' }],
        created_at: now,
      },
      attachments: [],
    },
  ];
}

function insertConversation(
  database: DatabaseConnection,
  sessionId: string,
  turns: Array<[string, string, string, string]>,
): void {
  database.prepare({ sql: `
    INSERT INTO workspaces (
      workspace_id, name, root_path, root_path_key, status,
      created_at, updated_at, last_opened_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ` }).run(['workspace:1', 'Workspace', 'C:/workspace', 'c:/workspace', 'active', now, now, now]);
  database.prepare({ sql: `
    INSERT INTO sessions (session_id, workspace_id, title, status, created_at, updated_at)
    VALUES (?, 'workspace:1', 'Session', 'active', ?, ?)
  ` }).run([sessionId, now, now]);
  for (const [executionId, userId, assistantId, text] of turns) {
    database.prepare({ sql: `
      INSERT INTO session_messages (
        message_id, session_id, execution_id, message_kind, message_json, created_at, completed_at
      ) VALUES (?, ?, ?, 'user_message', ?, ?, ?)
    ` }).run([userId, sessionId, executionId, JSON.stringify({ text }), now, now]);
    database.prepare({ sql: `
      INSERT INTO session_messages (
        message_id, session_id, execution_id, message_kind, message_json, created_at, completed_at
      ) VALUES (?, ?, ?, 'assistant_reply', ?, ?, ?)
    ` }).run([assistantId, sessionId, executionId, JSON.stringify({ text: '好的' }), now, now]);
  }
}

function activeInterestDescriptions(database: DatabaseConnection): string[] {
  return database.prepare<{ description: string }>({
    sql: "SELECT description FROM discovery_interests WHERE status = 'active' ORDER BY created_at, interest_id",
  }).all().map((row) => row.description);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => { resolve = settle; });
  return { promise, resolve };
}
