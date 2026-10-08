/* Verifies durable reply receipts, citation checks, and replay after accounting failures. */
// @vitest-environment node
import { expect, it } from 'vitest';
import { fauxAssistantMessage } from '@megumi/ai';
import { createSessionMessageSaver } from '@megumi/application/coding/sessions/session-history';
import { productionFixture } from './production-fixture';
import { createMemory } from '@megumi/application/memory/memory';
import { buildExtractionInput } from '@megumi/application/memory/extraction-input';
import { createDatabase } from '@megumi/application/storage/index';
import { createSessionStore } from '@megumi/application/coding/sessions/session-storage';
import { createMemorySources } from '@megumi/application/coding/sessions/memory-sources';
import path from 'node:path';

async function savedUsage(
  f: ReturnType<typeof productionFixture>,
  replyId: string,
  evidence: ReturnType<ReturnType<typeof f.memory.createTaskMemory>['evidence']>,
  change?: (text: string) => string,
) {
  if (!f.store.findSessionById('task'))
    f.store.insertSession({
      session_id: 'task',
      workspace_id: 'w1',
      title: 'Task',
      status: 'active',
      created_at: '2026-10-08',
      updated_at: '2026-10-08',
    });

  const text = `Use TS.\n<memory_citations>${JSON.stringify(evidence.reads)}</memory_citations>`;
  const result = f.history.saveAssistantReply({
    message_id: replyId,
    session_id: 'task',
    execution_id: evidence.executionId,
    status: 'completed',
    content: [
      {
        type: 'text',
        text: change ? change(text) : text,
      },
    ],
    memory_evidence: evidence,
    completed_at: '2026-10-08T13:00:00Z',
  });

  expect(result.status).toBe('saved');
}

it('rejects unread versions, forged ranges and source identities without losing the reply', async () => {
  const f = productionFixture();

  try {
    await f.user('u1');
    f.responses();
    await f.generate();
    for (const [index, field] of ['fileVersion', 'startLine', 'sourceIds'].entries()) {
      const task = f.memory.createTaskMemory({
        workspaceId: 'w1',
        workspaceDirectory: f.root,
        inputBudgetTokens: 30000,
      });
      task.getPromptMemory(`e${index}`);
      const evidence = task.evidence();
      await savedUsage(f, `r${index}`, evidence, text => {
        const citation = {
          ...evidence.reads[0],
          [field]:
            field === 'startLine' ? 10000 : field === 'sourceIds' ? ['invented'] : 'invented',
        };
        return `Answer preserved.\n<memory_citations>${JSON.stringify([citation])}</memory_citations>`;
      });
    }

    expect(f.memory.recordUsage().status).toBe('recorded');
    expect(
      f.sources.listReplies({
        afterCursor: 0,
        limit: 20,
      }),
    ).toHaveLength(3);
    expect(f.memory.listSources()).toMatchObject({
      sources: expect.arrayContaining([
        expect.objectContaining({
          sessionId: 's1',
          usageCount: 0,
        }),
      ]),
    });
  } finally {
    await f.dispose();
  }
});

it('recovers saved replies when both accounting and pending-event writes fail, without recounting after restart', async () => {
  const f = productionFixture();

  try {
    await f.user('u1');
    f.responses();
    await f.generate();

    const task = f.memory.createTaskMemory({
      workspaceId: 'w1',
      workspaceDirectory: f.root,
      inputBudgetTokens: 30000,
    });
    task.getPromptMemory('execution');
    await savedUsage(f, 'reply', task.evidence());
    f.database
      .prepare({
        sql: "CREATE TRIGGER fail_receipt BEFORE INSERT ON memory_usage_receipts BEGIN SELECT RAISE(ABORT, 'injected'); END",
      })
      .run();

    expect(f.memory.recordUsage().status).toBe('pendingRetry');
    expect(
      f.sources.listReplies({
        afterCursor: 0,
        limit: 20,
      }),
    ).toHaveLength(1);

    f.database.prepare({ sql: 'DROP TRIGGER fail_receipt' }).run();
    f.database
      .prepare({
        sql: "CREATE TRIGGER fail_count BEFORE UPDATE OF usage_count ON memory_sources BEGIN SELECT RAISE(ABORT, 'injected'); END",
      })
      .run();

    expect(f.memory.recordUsage().status).toBe('pendingRetry');

    f.database.prepare({ sql: 'DROP TRIGGER fail_count' }).run();
    await f.memory.shutdown();
    f.database.close();
    const database = createDatabase({ filename: path.join(f.root, 'memory.db') });
    const sources = createMemorySources({
      store: createSessionStore({ database }),
      isSessionRunning: () => false,
    });
    const reopened = createMemory({
      ...f.options,
      database,
      sources,
    });

    try {
      expect(reopened.listSources()).toMatchObject({
        sources: expect.arrayContaining([
          expect.objectContaining({
            sessionId: 's1',
            usageCount: 1,
          }),
        ]),
      });
      expect(reopened.recordUsage().status).toBe('alreadyProcessed');
    } finally {
      await reopened.shutdown();
      database.close();
    }
  } finally {
    await f.dispose();
  }
});

it('clearing excludes prior replies and late replies that used a pre-clear snapshot', async () => {
  const f = productionFixture();

  try {
    await f.user('u1');
    f.responses();
    await f.generate();

    const task = f.memory.createTaskMemory({
      workspaceId: 'w1',
      workspaceDirectory: f.root,
      inputBudgetTokens: 30000,
    });
    task.getPromptMemory('before');
    await savedUsage(f, 'before', task.evidence());

    const clear = f.memory.clearMemory({
      requestId: 'clear',
      confirmed: true,
    });
    if (clear.status !== 'started') throw new Error();

    await f.memory.waitRun({
      runId: clear.runId,
      timeoutMs: 5000,
    });
    await savedUsage(f, 'late', {
      ...task.evidence(),
      executionId: 'late',
    });
    f.memory.recordUsage();

    expect(f.memory.listSources()).toMatchObject({
      sources: expect.arrayContaining([
        expect.objectContaining({
          sessionId: 's1',
          usageCount: 0,
        }),
      ]),
    });
    expect(
      f.sources.listReplies({
        afterCursor: 0,
        limit: 20,
      }),
    ).toHaveLength(2);
  } finally {
    await f.dispose();
  }
});

it('does not turn host receipts or injected memory tool bodies into new extraction evidence', async () => {
  const f = productionFixture();

  try {
    await f.user('u1');
    f.responses();
    await f.generate();

    const task = f.memory.createTaskMemory({
      workspaceId: 'w1',
      workspaceDirectory: f.root,
      inputBudgetTokens: 30000,
    });
    task.getPromptMemory('execution');
    await savedUsage(f, 'reply', task.evidence());
    f.history.saveToolResultMessage({
      message_id: 'tool',
      session_id: 'task',
      execution_id: 'execution',
      tool_call_id: 'call',
      tool_name: 'memory_read',
      status: 'success',
      content: [
        {
          type: 'text',
          text: 'INJECTED_MEMORY_ONLY',
        },
      ],
      completed_at: '2026-10-08T13:00:01Z',
    });

    const source = f.sources.readSnapshot('task');
    if (source.status !== 'found') throw new Error();

    const input = buildExtractionInput({
      source: source.snapshot,
      workspaceDirectory: f.root,
      contextWindow: 100000,
      maxOutputTokens: 8192,
      secrets: [],
    });

    expect(input.prompt).not.toContain('memory_evidence');
    expect(input.prompt).not.toContain('INJECTED_MEMORY_ONLY');
    expect(input.prompt).toContain('Use TS.');
  } finally {
    await f.dispose();
  }
});

it('persists host evidence with the reply and counts verified sources once across replay', async () => {
  const f = productionFixture();

  try {
    await f.user('u1');
    f.responses();
    await f.generate();
    f.store.insertSession({
      session_id: 'task',
      workspace_id: 'w1',
      title: 'New task',
      status: 'active',
      created_at: '2026-10-08',
      updated_at: '2026-10-08',
    });

    const task = f.memory.createTaskMemory({
      workspaceId: 'w1',
      workspaceDirectory: f.root,
      inputBudgetTokens: 30000,
    });
    task.getPromptMemory('execution');
    const citation = task.evidence().reads[0];
    const save = createSessionMessageSaver({
      history: f.history,
      user: {
        session_id: 'task',
        display_content: [],
        model_content: [],
      },
      memoryEvidence: () => task.evidence(),
    });
    await save({
      runId: 'execution',
      messageId: 'answer',
      message: fauxAssistantMessage(
        `Use TS.\n<memory_citations>${JSON.stringify([citation])}</memory_citations>`,
      ),
    });

    expect(
      f.sources.listReplies({
        afterCursor: 0,
        limit: 20,
      })[0].message,
    ).toMatchObject({
      memory_evidence: {
        executionId: 'execution',
        reads: expect.arrayContaining([citation]),
      },
    });
    expect(f.memory.recordUsage()).toMatchObject({ status: 'recorded' });
    expect(f.memory.recordUsage()).toMatchObject({ status: 'alreadyProcessed' });
    expect(f.memory.listSources()).toMatchObject({
      sources: expect.arrayContaining([
        expect.objectContaining({
          sessionId: 's1',
          usageCount: 1,
        }),
      ]),
    });
  } finally {
    await f.dispose();
  }
});
