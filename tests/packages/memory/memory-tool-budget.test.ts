/* Checks the model-visible Memory protocol after the real Agent safety normalization. */
// @vitest-environment node
import { expect, it } from 'vitest';
import { normalizeRawToolContent } from '@megumi/agent/tools/tool-result';
import type { TaskMemory } from '@megumi/application/memory/memory-consumption';
import { EMPTY_SUMMARY } from '@megumi/application/memory/consolidation-documents';
import { validateMemoryCitations } from '@megumi/application/memory/memory-citations';
import { productionFixture } from './production-fixture';

async function invoke(task: TaskMemory, name: string, arguments_: Record<string, unknown>) {
  const raw = await task.tools
    .find(tool => tool.name === name)!
    .execute(arguments_, {
      runId: 'run',
      toolCallId: 'call',
      signal: new AbortController().signal,
      onOutput: () => {},
    });
  const normalized = normalizeRawToolContent(raw);
  expect(normalized.truncated).toBe(false);
  return JSON.parse(normalized.content);
}

it('pages long Unicode reads before delivery and records only delivered complete lines', async () => {
  const f = productionFixture();
  try {
    await f.user('u1');
    f.responses();
    await f.generate();
    const old = f.files.read('MEMORY.md')!;
    const content = old.content + '中文知识😀'.repeat(2200) + '\nLATE_FACT\n';
    expect(
      f.memory.updateDocument({
        requestId: 'long',
        path: old.path,
        expectedVersion: old.version,
        content,
      }).status,
    ).toBe('saved');
    const summary = f.files.read('memory_summary.md')!;
    expect(
      f.memory.updateDocument({
        requestId: 'empty-summary',
        path: summary.path,
        expectedVersion: summary.version,
        content: EMPTY_SUMMARY,
      }).status,
    ).toBe('saved');
    const task = f.memory.createTaskMemory({
      workspaceId: 'w1',
      workspaceDirectory: f.root,
      inputBudgetTokens: 30000,
    });
    task.getPromptMemory('execution');
    const first = await invoke(task, 'memory_read', { path: 'MEMORY.md' });
    expect(first.document.truncated).toBe(true);
    expect(task.evidence().reads.some(read => read.endLine >= first.document.nextLine)).toBe(false);
    const lateLine = content.split('\n').indexOf('LATE_FACT') + 1;
    expect(task.evidence().reads.some(read => read.endLine >= lateLine)).toBe(false);
    let restored = first.document.content;
    let page = first;
    for (let count = 0; page.document.truncated && count < 20; count++) {
      page = await invoke(task, 'memory_read', {
        path: 'MEMORY.md',
        startLine: page.document.nextLine,
        startCharacter: page.document.nextCharacter ?? 0,
        expectedVersion: page.document.version,
      });
      restored += page.document.content;
    }
    expect(page.document.truncated).toBe(false);
    expect(restored).toBe(content);
    expect(task.evidence().reads.some(read => read.endLine >= lateLine)).toBe(true);
  } finally {
    await f.dispose();
  }
});

it('pages search metadata without authorizing excluded hits and returns each match once', async () => {
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
    const source1 = f.sources.readSnapshot('s1');
    const source2 = f.sources.readSnapshot('s2');
    if (source1.status !== 'found' || source2.status !== 'found')
      throw new Error('Missing fixture source');
    const rollout = f.files
      .paths()
      .find(
        file =>
          file.startsWith('rollout_summaries/') &&
          f.files.read(file)!.content.includes('"sessionId":"s1"'),
      )!;
    const rollout2 = f.files
      .paths()
      .find(
        file =>
          file.startsWith('rollout_summaries/') &&
          f.files.read(file)!.content.includes('"sessionId":"s2"'),
      )!;
    const content =
      '# Task Group: Search\nscope: general\napplies_to: general\n' +
      Array.from({ length: 12 }, (_, index) => {
        const source = index < 6 ? source1.snapshot : source2.snapshot;
        const marker = `[sourceId=${source.sessionId}; sourceVersion=${source.sourceVersion}; sourceRef=${source.sourceRef}]`;
        return `\n## Task: Example ${index}\n### rollout_summary_files\n${`- ${index < 6 ? rollout : rollout2} ${marker}\n`.repeat(3)}### keywords\n- example\n### learnings\nneedle-${index} ${'中文事实'.repeat(180)}\n`;
      }).join('');
    const old = f.files.read('MEMORY.md')!;
    expect(
      f.memory.updateDocument({
        requestId: 'search-data',
        path: old.path,
        expectedVersion: old.version,
        content,
      }).status,
    ).toBe('saved');
    const summary = f.files.read('memory_summary.md')!;
    expect(
      f.memory.updateDocument({
        requestId: 'empty-summary',
        path: summary.path,
        expectedVersion: summary.version,
        content: EMPTY_SUMMARY,
      }).status,
    ).toBe('saved');
    const task = f.memory.createTaskMemory({
      workspaceId: 'w1',
      workspaceDirectory: f.root,
      inputBudgetTokens: 30000,
    });
    task.getPromptMemory('execution');
    let page = await invoke(task, 'memory_search', {
      terms: ['needle'],
      limit: 50,
    });
    expect(page.status).toBe('ok');
    expect(page.nextCursor).toBeTypeOf('string');
    expect(task.evidence().reads.some(read => read.sourceIds.includes('s2'))).toBe(false);
    expect(
      await invoke(task, 'memory_source', { sourceRef: source2.snapshot.sourceRef }),
    ).toMatchObject({
      status: 'failed',
      error: { code: 'SOURCE_UNAVAILABLE' },
    });
    const lines: number[] = [];
    for (let count = 0; count < 20; count++) {
      for (const hit of page.hits) {
        expect(hit.sourceRefs).toHaveLength(1);
        lines.push(hit.line);
      }
      if (!page.nextCursor) break;
      page = await invoke(task, 'memory_search', {
        terms: ['needle'],
        limit: 50,
        cursor: page.nextCursor,
      });
    }
    expect(lines).toEqual(
      content.split('\n').flatMap((line, index) => (line.startsWith('needle-') ? [index + 1] : [])),
    );
    expect(task.evidence().reads.some(read => read.sourceIds.includes('s2'))).toBe(true);
  } finally {
    await f.dispose();
  }
});

it('delivers original Unicode evidence as complete JSON pages without losing message text', async () => {
  const f = productionFixture();
  try {
    const original = '原始消息😀'.repeat(2300) + 'SOURCE_END';
    await f.user('u1', original);
    f.responses();
    await f.generate();
    const source = f.sources.readSnapshot('s1');
    if (source.status !== 'found') throw new Error('Missing fixture source');
    const task = f.memory.createTaskMemory({
      workspaceId: 'w1',
      workspaceDirectory: f.root,
      inputBudgetTokens: 30000,
    });
    task.getPromptMemory('execution');
    await invoke(task, 'memory_read', { path: 'MEMORY.md' });
    let page = await invoke(task, 'memory_source', {
      sourceRef: source.snapshot.sourceRef,
      limit: 1,
    });
    expect(page.status).toBe('found');
    expect(page.nextCursor).toBeTypeOf('string');
    let restored = '';
    for (let count = 0; count < 20; count++) {
      expect(page.messages).toHaveLength(1);
      expect(page.messages[0].characterOffset).toBe(restored.length);
      restored += page.messages[0].text;
      if (!page.nextCursor) break;
      page = await invoke(task, 'memory_source', {
        sourceRef: source.snapshot.sourceRef,
        limit: 1,
        cursor: page.nextCursor,
      });
    }
    expect(restored).toBe(
      JSON.stringify([
        {
          type: 'text',
          text: original,
        },
      ]),
    );
  } finally {
    await f.dispose();
  }
});

it('associates a received rollout body page with its host source identity without authorizing unread lines', async () => {
  const f = productionFixture();
  try {
    await f.user('u1', 'Original rollout evidence');
    f.responses();
    await f.generate();
    const summary = f.files.read('memory_summary.md')!;
    expect(
      f.memory.updateDocument({
        requestId: 'empty-summary',
        path: summary.path,
        expectedVersion: summary.version,
        content: EMPTY_SUMMARY,
      }).status,
    ).toBe('saved');
    const rollout = f.files.paths().find(file => file.startsWith('rollout_summaries/'))!;
    const task = f.memory.createTaskMemory({
      workspaceId: 'w1',
      workspaceDirectory: f.root,
      inputBudgetTokens: 30000,
    });
    task.getPromptMemory('execution');
    const page = await invoke(task, 'memory_read', {
      path: rollout,
      startLine: 3,
      lineCount: 1,
    });
    expect(page.document.content).toBe('User prefers TypeScript.');
    expect(page.references).toEqual([
      {
        path: rollout,
        fileVersion: page.document.version,
        startLine: 3,
        endLine: 3,
        sourceIds: ['s1'],
        sourceVersions: [expect.any(String)],
      },
    ]);
    expect(page.sourceRefs).toHaveLength(1);
    expect(
      validateMemoryCitations(
        `<memory_citations>${JSON.stringify(page.references)}</memory_citations>`,
        task.evidence(),
      ).status,
    ).toBe('valid');
    expect(
      validateMemoryCitations(
        `<memory_citations>${JSON.stringify([
          {
            ...page.references[0],
            startLine: 1,
          },
        ])}</memory_citations>`,
        task.evidence(),
      ).status,
    ).toBe('invalid');
    const source = await invoke(task, 'memory_source', { sourceRef: page.sourceRefs[0] });
    expect(source.status).toBe('found');
    expect(source.messages[0].text).toContain('Original rollout evidence');
  } finally {
    await f.dispose();
  }
});
