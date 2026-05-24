// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase, type MegumiDatabase } from '@megumi/db/connection';
import { migrateDatabase } from '@megumi/db/schema/migrations';
import {
  TimelineMessageRepository,
  type TimelineCommitDiagnostic,
} from '@megumi/db/repos/timeline-message.repo';
import type {
  TimelineAssistantMessage,
  TimelineUserMessage,
} from '@megumi/shared/timeline-message-blocks';

let db: MegumiDatabase | null = null;

function createRepo(): TimelineMessageRepository {
  db = createDatabase(':memory:');
  migrateDatabase(db);
  return new TimelineMessageRepository(db);
}

function seedSessionAndRun(runId = 'run-1'): void {
  db!.prepare(`
    INSERT INTO sessions (
      session_id, title, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(session_id) DO NOTHING
  `).run(
    'session-1',
    'Session 1',
    'active',
    '2026-05-24T00:00:00.000Z',
    '2026-05-24T00:00:00.000Z',
  );
  db!.prepare(`
    INSERT INTO runs (
      run_id, session_id, mode, goal, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(run_id) DO NOTHING
  `).run(
    runId,
    'session-1',
    'chat',
    'Answer',
    'completed',
    '2026-05-24T00:00:01.000Z',
  );
}

function countRows(tableName: string): number {
  const row = db!.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as { count: number };
  return row.count;
}

afterEach(() => {
  db?.close();
  db = null;
});

const userMessage: TimelineUserMessage = {
  messageId: 'message-user-1',
  role: 'user',
  projectId: 'project-1',
  sessionId: 'session-1',
  createdAt: '2026-05-24T00:00:00.000Z',
  updatedAt: '2026-05-24T00:00:00.000Z',
  blocks: [
    {
      blockId: 'user-text:message-user-1',
      kind: 'user_text',
      text: 'Hello',
      format: 'plain',
    },
  ],
};

const assistantMessage: TimelineAssistantMessage = {
  messageId: 'assistant:run-1',
  role: 'assistant',
  projectId: 'project-1',
  sessionId: 'session-1',
  runId: 'run-1',
  createdAt: '2026-05-24T00:00:01.000Z',
  updatedAt: '2026-05-24T00:00:03.000Z',
  blocks: [
    {
      blockId: 'process:run-1',
      kind: 'process_disclosure',
      runId: 'run-1',
      status: 'completed',
      startedAt: '2026-05-24T00:00:01.000Z',
      endedAt: '2026-05-24T00:00:03.000Z',
      items: [],
    },
    {
      blockId: 'answer:run-1',
      kind: 'answer_text',
      runId: 'run-1',
      textId: 'text-answer-1',
      status: 'completed',
      text: 'Hello back.',
      format: 'markdown',
    },
  ],
};

describe('TimelineMessageRepository', () => {
  it('saves and reads committed timeline messages in stable session order', () => {
    const repo = createRepo();
    seedSessionAndRun();

    repo.commitRunTimeline({
      projectId: 'project-1',
      sessionId: 'session-1',
      runId: 'run-1',
      committedAt: '2026-05-24T00:00:04.000Z',
      messages: [assistantMessage, userMessage],
    });

    const result = repo.listCommittedMessagesBySession({
      projectId: 'project-1',
      sessionId: 'session-1',
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.messages.map((message) => message.messageId)).toEqual([
      'message-user-1',
      'assistant:run-1',
    ]);
    expect(result.messages[1]).toMatchObject({
      role: 'assistant',
      runId: 'run-1',
      blocks: [
        { kind: 'process_disclosure', status: 'completed' },
        { kind: 'answer_text', status: 'completed', text: 'Hello back.' },
      ],
    });
    expect(repo.getRunCommit('run-1')).toMatchObject({
      runId: 'run-1',
      status: 'committed',
      committedAt: '2026-05-24T00:00:04.000Z',
    });
  });

  it('skips malformed persisted message blocks during hydrate and returns a diagnostic', () => {
    const repo = createRepo();
    seedSessionAndRun('run-bad');
    db!.prepare(`
      INSERT INTO timeline_messages (
        message_id, project_id, session_id, run_id, role, status,
        created_at, updated_at, sort_time, blocks_json, message_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'assistant:bad',
      'project-1',
      'session-1',
      'run-bad',
      'assistant',
      'completed',
      '2026-05-24T00:00:01.000Z',
      '2026-05-24T00:00:01.000Z',
      '2026-05-24T00:00:01.000Z',
      '[{"kind":"answer_text","rawProviderBody":{"secret":"sk-test"}}]',
      JSON.stringify({
        ...assistantMessage,
        messageId: 'assistant:bad',
        runId: 'run-bad',
        blocks: [],
      }),
    );

    const result = repo.listCommittedMessagesBySession({
      projectId: 'project-1',
      sessionId: 'session-1',
    });

    expect(result.messages).toEqual([]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        messageId: 'assistant:bad',
        code: 'timeline_message_parse_failed',
      }),
    ]);
  });

  it('rolls back timeline messages when commit unit fails and records a diagnostic separately', () => {
    const repo = createRepo();
    seedSessionAndRun();
    const invalidAssistant = {
      ...assistantMessage,
      blocks: [
        {
          blockId: 'answer:run-1',
          kind: 'answer_text',
          runId: 'run-1',
          textId: 'text-answer-1',
          status: 'completed',
          text: 'This raw field must fail strict schema validation.',
          format: 'markdown',
          rawProviderBody: { secret: 'sk-test' },
        },
      ],
    } as unknown as TimelineAssistantMessage;

    expect(() =>
      repo.commitRunTimeline({
        projectId: 'project-1',
        sessionId: 'session-1',
        runId: 'run-1',
        committedAt: '2026-05-24T00:00:04.000Z',
        messages: [userMessage, invalidAssistant],
      }),
    ).toThrow();

    repo.recordCommitDiagnostic({
      diagnosticId: 'diagnostic-1',
      projectId: 'project-1',
      sessionId: 'session-1',
      runId: 'run-1',
      code: 'timeline_commit_failed',
      message: 'Timeline commit failed.',
      createdAt: '2026-05-24T00:00:04.000Z',
    });

    expect(repo.listCommittedMessagesBySession({ projectId: 'project-1', sessionId: 'session-1' }).messages).toEqual([]);
    expect(repo.getRunCommit('run-1')).toMatchObject({
      runId: 'run-1',
      status: 'failed',
    });
    expect(repo.listCommitDiagnostics('run-1')).toEqual([
      expect.objectContaining({ diagnosticId: 'diagnostic-1', code: 'timeline_commit_failed' }),
    ] satisfies Partial<TimelineCommitDiagnostic>[]);
  });

  it('rejects messages outside the run commit ownership before persisting rows', () => {
    const repo = createRepo();
    seedSessionAndRun();

    for (const messages of [
      [{ ...userMessage, projectId: 'project-other' }, assistantMessage],
      [{ ...userMessage, sessionId: 'session-other' }, assistantMessage],
      [userMessage, { ...assistantMessage, runId: 'run-other' }],
    ] as Array<[TimelineUserMessage, TimelineAssistantMessage]>) {
      expect(() =>
        repo.commitRunTimeline({
          projectId: 'project-1',
          sessionId: 'session-1',
          runId: 'run-1',
          committedAt: '2026-05-24T00:00:04.000Z',
          messages,
        }),
      ).toThrow(/Timeline commit message ownership mismatch/);

      expect(countRows('timeline_messages')).toBe(0);
      expect(countRows('timeline_run_commits')).toBe(0);
    }
  });

  it('uses production database foreign key behavior in repository tests', () => {
    createRepo();

    expect(() =>
      db!.prepare(`
        INSERT INTO timeline_messages (
          message_id, project_id, session_id, run_id, role, status,
          created_at, updated_at, sort_time, blocks_json, message_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'assistant:orphan',
        'project-1',
        'missing-session',
        null,
        'assistant',
        'completed',
        '2026-05-24T00:00:01.000Z',
        '2026-05-24T00:00:01.000Z',
        '2026-05-24T00:00:01.000Z',
        JSON.stringify(assistantMessage.blocks),
        JSON.stringify(assistantMessage),
      ),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });
});
