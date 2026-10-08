/* Verifies task snapshots and read boundaries against generated memory files. */
// @vitest-environment node
import { expect, it } from 'vitest';
import { productionFixture } from './production-fixture';
import { createContextFixture } from '../context/context-behavior-fixture';
import { createCodingContext } from '@megumi/application/coding/prepare-context';
import { validateMemoryCitations } from '@megumi/application/memory/memory-citations';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { estimateExtractionTokens } from '@megumi/application/memory/extraction-input';

it('budgets the delivered summary together with its citation metadata and retains tool guidance', async () => {
  const f = productionFixture();

  try {
    await f.user('u1');
    f.responses();
    await f.generate();

    const task = f.memory.createTaskMemory({
      workspaceId: 'w1',
      workspaceDirectory: f.root,
      inputBudgetTokens: 12000,
    });
    const prompt = task.getPromptMemory('execution');
    const summary = prompt.prompt.slice(prompt.prompt.indexOf('Summary version:'));

    expect(estimateExtractionTokens(summary)).toBeLessThanOrEqual(1200);
    expect(prompt.prompt).toContain('memory_read');
    expect(prompt.truncated).toBe(true);
  } finally {
    await f.dispose();
  }
});

it('keeps a Task source attached when its learnings are read on a separate page', async () => {
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
    const read = task.read({
      path: 'MEMORY.md',
      startLine: 10,
      lineCount: 1,
    });

    expect(read).toMatchObject({
      status: 'found',
      references: [
        {
          startLine: 10,
          endLine: 10,
          sourceIds: ['s1'],
        },
      ],
    });
  } finally {
    await f.dispose();
  }
});

it('searches beyond a returned excerpt cap and keeps source pages bounded without replacing old branches', async () => {
  const f = productionFixture();

  try {
    await f.user('u1', 'x'.repeat(18000) + 'ORIGINAL_END');
    f.responses();
    await f.generate();

    const reference = f.sources.readSnapshot('s1');
    if (reference.status !== 'found') throw new Error();

    const page = f.memory.readSource({
      sourceRef: reference.snapshot.sourceRef,
      limit: 1,
    });

    expect(page).toMatchObject({
      status: 'found',
      nextCursor: expect.any(String),
    });

    if (page.status !== 'found' || !('messages' in page)) throw new Error();

    expect(page.messages.map(message => message.text).join('').length).toBeLessThanOrEqual(16000);

    await f.user('changed', 'New source branch');

    const next = f.memory.readSource({
      sourceRef: reference.snapshot.sourceRef,
      cursor: page.nextCursor,
    });

    expect(next).toMatchObject({
      status: 'found',
      sourceChanged: true,
    });

    if (next.status !== 'found' || !('messages' in next)) throw new Error();

    expect(next.messages.map(message => message.text).join('')).toContain('ORIGINAL_END');
    expect(next.messages.map(message => message.text).join('')).not.toContain('New source branch');

    // Management reads can inspect invalid files; this does not make them usable by a task.
    writeFileSync(path.join(f.root, 'memories', 'MEMORY.md'), 'x'.repeat(17000) + 'needle\n');

    expect(f.memory.searchDocuments({ terms: ['needle'] })).toMatchObject({
      status: 'ok',
      hits: [{ line: 1 }],
    });
  } finally {
    await f.dispose();
  }
});

it('refuses a stale file version and blocks task reads during maintenance and after source exclusion', async () => {
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
    const before = f.files.read('MEMORY.md')!;
    f.memory.updateDocument({
      requestId: 'edit',
      path: before.path,
      expectedVersion: before.version,
      content: before.content.replace('Use TypeScript', 'Use simple TypeScript'),
    });

    expect(
      task.read({
        path: before.path,
        expectedVersion: before.version,
      }),
    ).toMatchObject({ error: { code: 'VERSION_CONFLICT' } });

    const original = f.sources.readSnapshot('s1');
    if (original.status !== 'found') throw new Error();

    const settings = f.settings.readSettings();
    if (settings.status !== 'ok') throw new Error();

    f.settings.updateSettings({
      expectedRevision: settings.settings.revision,
      patch: { memory: { consolidationModel: undefined } },
    });
    f.responses();
    f.memory.setSourceEligibility({
      requestId: 'exclude',
      sessionId: 's1',
      eligibility: 'excluded',
      expectedVersion: 0,
    });

    expect(task.read({ path: 'MEMORY.md' })).toMatchObject({ status: 'failed' });
    expect(f.memory.readSource({ sourceRef: original.snapshot.sourceRef })).toMatchObject({
      error: { code: 'SOURCE_UNAVAILABLE' },
    });
  } finally {
    await f.dispose();
  }
});

it('does not attach a source from one summary paragraph to an unrelated paragraph', async () => {
  const f = productionFixture();

  try {
    await f.user('u1');
    f.store.insertSession({
      session_id: 's2',
      workspace_id: 'w1',
      title: 'Other',
      status: 'active',
      created_at: '2026-10-01',
      updated_at: '2026-10-01',
    });
    await f.history.saveUserMessage({
      session_id: 's2',
      message_id: 'u2',
      display_content: [
        {
          type: 'text',
          text: 'Other preference',
        },
      ],
      model_content: [
        {
          type: 'text',
          text: 'Other preference',
        },
      ],
      created_at: '2026-10-02T00:00:00Z',
    });
    f.responses();
    await f.generate();

    const other = f.sources.readSnapshot('s1');
    if (other.status !== 'found') throw new Error();

    const before = f.files.read('memory_summary.md')!;
    const paragraph = `Different preference. [sourceId=s1; sourceVersion=${other.snapshot.sourceVersion}; sourceRef=${other.snapshot.sourceRef}]`;
    const content = before.content.replace(
      '# General Tips\n',
      '# General Tips\n' + paragraph + '\n\n',
    );

    expect(
      f.memory.updateDocument({
        requestId: 'edit',
        path: before.path,
        content,
        expectedVersion: before.version,
      }).status,
    ).toBe('saved');

    const task = f.memory.createTaskMemory({
      workspaceId: 'w1',
      workspaceDirectory: f.root,
      inputBudgetTokens: 100000,
    });
    task.getPromptMemory('execution');
    const evidence = task.evidence();
    const line = content.split('\n').findIndex(text => text === paragraph) + 1;
    const unrelated = evidence.reads.find(read => read.sourceIds.includes('s2'))!;
    const forged = {
      ...unrelated,
      startLine: line,
      endLine: line,
    };

    expect(
      validateMemoryCitations(
        `<memory_citations>${JSON.stringify([forged])}</memory_citations>`,
        evidence,
      ).status,
    ).toBe('invalid');
  } finally {
    await f.dispose();
  }
});

it('freezes one budgeted summary per task, consumes with generation off, and removes it when usage is disabled', async () => {
  const f = productionFixture();

  try {
    await f.user('u1');
    f.responses();
    await f.generate();

    const read = f.settings.readSettings();
    if (read.status !== 'ok') throw new Error();

    f.settings.updateSettings({
      expectedRevision: read.settings.revision,
      patch: { memory: { generateMemories: false } },
    });

    const task = f.memory.createTaskMemory({
      workspaceId: 'w1',
      workspaceDirectory: f.root,
      inputBudgetTokens: 30000,
    });
    const first = task.getPromptMemory('execution');

    expect(first.status).toBe('ready');
    expect(first.prompt).toContain('TypeScript');
    expect(task.getPromptMemory('execution')).toEqual(first);
    expect(task.evidence().reads.length).toBeGreaterThan(0);

    const current = f.settings.readSettings();
    if (current.status !== 'ok') throw new Error();

    f.settings.updateSettings({
      expectedRevision: current.settings.revision,
      patch: { memory: { useMemories: false } },
    });

    expect(task.getPromptMemory('execution')).toMatchObject({
      status: 'disabled',
      tools: [],
    });
  } finally {
    await f.dispose();
  }
});

it('does not restore an execution snapshot after clearing and re-enabling memory', async () => {
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

    expect(task.getPromptMemory('execution').prompt).toContain('TypeScript');

    const clear = f.memory.clearMemory({
      requestId: 'clear',
      confirmed: true,
    });
    if (clear.status !== 'started') throw new Error();

    await f.memory.waitRun({
      runId: clear.runId,
      timeoutMs: 5000,
    });

    const settings = f.settings.readSettings();
    if (settings.status !== 'ok') throw new Error();

    f.settings.updateSettings({
      expectedRevision: settings.settings.revision,
      patch: { memory: { useMemories: true } },
    });

    expect(task.getPromptMemory('execution').prompt).toBe('');
    expect(task.read({ path: 'MEMORY.md' })).toMatchObject({ status: 'failed' });
  } finally {
    await f.dispose();
  }
});

it('injects a single snapshot through real Coding context and removes dedicated context and tools on the next request', async () => {
  const f = productionFixture();
  const context = await createContextFixture();

  try {
    await f.user('u1');
    f.responses();
    await f.generate();

    const task = f.memory.createTaskMemory({
      workspaceId: context.workspaceId,
      workspaceDirectory: context.workspaceRoot,
      inputBudgetTokens: 30000,
    });
    const coding = createCodingContext({
      ...context.options,
      memory: {
        task,
        executionId: () => 'execution',
      },
    });
    const request = {
      ...context.prepareRequest,
      tools: task.tools,
    };
    const first = await coding.prepare(request);

    expect(first.systemPrompt).toContain('Historical memory');
    expect(first.systemPrompt.match(/Summary version:/g)).toHaveLength(1);
    expect((await coding.prepare(request)).systemPrompt).toBe(first.systemPrompt);

    const read = f.settings.readSettings();
    if (read.status !== 'ok') throw new Error();

    f.settings.updateSettings({
      expectedRevision: read.settings.revision,
      patch: { memory: { useMemories: false } },
    });

    const disabled = await coding.prepare(request);

    expect(disabled.systemPrompt).not.toContain('Historical memory');
    expect(disabled.tools).toEqual([]);
  } finally {
    context.cleanup();
    await f.dispose();
  }
});

it('binds text search cursors to file versions and refuses raw inputs and traversal', async () => {
  const f = productionFixture();

  try {
    await f.user('u1');
    f.responses();
    await f.generate();

    const result = f.memory.searchDocuments({
      terms: ['TypeScript'],
      limit: 1,
    });

    expect(result).toMatchObject({
      status: 'ok',
      hits: [{ path: 'MEMORY.md' }],
      nextCursor: expect.any(String),
    });

    if (result.status !== 'ok') throw new Error();

    const doc = f.files.read('MEMORY.md')!;
    f.memory.updateDocument({
      requestId: 'edit',
      path: doc.path,
      expectedVersion: doc.version,
      content: doc.content.replace('Use TypeScript', 'Use minimal TypeScript'),
    });

    expect(
      f.memory.searchDocuments({
        terms: ['TypeScript'],
        limit: 1,
        cursor: result.nextCursor,
      }),
    ).toMatchObject({ error: { code: 'VERSION_CONFLICT' } });

    const task = f.memory.createTaskMemory({
      workspaceId: 'w1',
      workspaceDirectory: f.root,
      inputBudgetTokens: 30000,
    });
    task.getPromptMemory('execution');

    expect(task.read({ path: 'raw_memories.md' })).toMatchObject({
      error: { code: 'PATH_DENIED' },
    });
    expect(task.read({ path: '../settings.json' })).toMatchObject({
      error: { code: 'PATH_DENIED' },
    });
  } finally {
    await f.dispose();
  }
});
