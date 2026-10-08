// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { fauxAssistantMessage } from '@megumi/ai';
import { productionFixture } from './production-fixture';

it('keeps an empty memory run successful when there are no eligible sources and the extraction model is unavailable', async () => {
  const f = productionFixture(undefined, async () => {
    throw new Error('MODEL_UNAVAILABLE');
  });
  try {
    f.advance(366 * 86400000);
    expect(await f.generate()).toMatchObject({
      status: 'completed',
      result: { result: 'empty' },
    });
    expect(f.memory.getStatus()).toMatchObject({ memory: { artifactState: 'empty' } });
  } finally {
    await f.dispose();
  }
});

it('retains the model preparation error when eligible sources could not be processed', async () => {
  const f = productionFixture(undefined, async () => {
    throw new Error('MODEL_UNAVAILABLE');
  });
  try {
    await f.user('u1');
    expect(await f.generate()).toMatchObject({
      status: 'failed',
      result: { error: { code: 'MODEL_UNAVAILABLE' } },
    });
  } finally {
    await f.dispose();
  }
});

it('generates through the real Agent without adding a Coding session, then reuses unchanged knowledge', async () => {
  const f = productionFixture();
  try {
    await f.user('u1', 'Use TypeScript for React examples.');
    f.responses();
    const run = await f.generate();
    expect(run).toMatchObject({
      status: 'completed',
      result: { result: 'generated' },
    });
    expect(run.jobs.map(job => job.stage)).toEqual(
      expect.arrayContaining(['extract', 'consolidate']),
    );
    expect(f.files.read('MEMORY.md')?.content).toContain('Use TypeScript');
    expect(f.memory.getStatus()).toMatchObject({
      memory: {
        artifactState: 'ready',
        dirty: false,
      },
    });
    expect(f.sources.listSources()).toHaveLength(1);
    const count = f.provider.state.callCount;
    expect(await f.generate('unchanged')).toMatchObject({ result: { result: 'unchanged' } });
    expect(f.provider.state.callCount).toBe(count);
  } finally {
    await f.dispose();
  }
});

it('evaluates the unused window on a production trigger rather than a status query', async () => {
  const f = productionFixture();
  try {
    await f.user('u1');
    f.responses();
    await f.generate();
    f.advance(31 * 86400000);
    expect(f.memory.getStatus()).toMatchObject({
      memory: {
        artifactState: 'ready',
        dirty: false,
      },
    });
    f.responses();
    expect(await f.generate('expire')).toMatchObject({ result: { result: 'generated' } });
    expect(f.files.read('MEMORY.md')?.content).not.toContain('TypeScript');
  } finally {
    await f.dispose();
  }
});

it('saves versioned edits and maintains excluded sources even with automatic generation disabled', async () => {
  const f = productionFixture();
  try {
    await f.user('u1');
    f.responses();
    await f.generate();
    const before = f.files.read('MEMORY.md')!;
    expect(
      f.memory.updateDocument({
        requestId: 'edit',
        path: before.path,
        expectedVersion: before.version,
        content: before.content.replace('Use TypeScript', 'Use minimal TypeScript'),
      }),
    ).toMatchObject({ status: 'saved' });
    expect(
      f.memory.updateDocument({
        requestId: 'stale',
        path: before.path,
        expectedVersion: before.version,
        content: before.content,
      }),
    ).toMatchObject({ error: { code: 'VERSION_CONFLICT' } });
    const read = f.settings.readSettings();
    if (read.status !== 'ok') throw new Error();
    f.settings.updateSettings({
      expectedRevision: read.settings.revision,
      patch: { memory: { generateMemories: false } },
    });
    f.responses();
    expect(
      f.memory.setSourceEligibility({
        requestId: 'exclude',
        sessionId: 's1',
        eligibility: 'excluded',
        expectedVersion: 0,
      }),
    ).toMatchObject({
      status: 'saved',
      maintenance: 'pending',
    });
    await vi.waitFor(() =>
      expect(f.memory.getStatus()).toMatchObject({
        memory: {
          artifactState: 'ready',
          dirty: false,
        },
      }),
    );
    expect(f.files.read('MEMORY.md')?.content).not.toContain('TypeScript');
    expect(f.memory.listSources()).toMatchObject({
      sources: [
        {
          eligibility: 'excluded',
          selected: false,
        },
      ],
    });
  } finally {
    await f.dispose();
  }
});

it('marks partially written output for repair and preserves original histories when clearing', async () => {
  const f = productionFixture();
  try {
    await f.user('u1');
    f.responses();
    await f.generate();
    const before = f.files.read('MEMORY.md')!;
    f.memory.updateDocument({
      requestId: 'edit',
      path: before.path,
      expectedVersion: before.version,
      content: before.content,
    });
    f.provider.setResponses([
      f.tool('memory_file', {
        action: 'write',
        path: 'MEMORY.md',
        expectedVersion: before.version,
        content: 'incomplete',
      }),
      fauxAssistantMessage('Failed to finish.'),
    ]);
    expect(await f.generate('partial')).toMatchObject({ status: 'failed' });
    expect(f.memory.getStatus()).toMatchObject({ memory: { artifactState: 'needsRepair' } });
    f.reply('reply');
    const clearing = f.memory.clearMemory({
      requestId: 'clear',
      confirmed: true,
    });
    expect(clearing).toMatchObject({
      status: 'started',
      runId: expect.any(String),
    });
    if (clearing.status !== 'started' && clearing.status !== 'reused')
      throw new Error('Clear not accepted');
    expect(
      f.memory.cancelRun({
        requestId: 'cancel-clear',
        runId: clearing.runId,
      }),
    ).toMatchObject({ error: { code: 'INVALID_ARGUMENT' } });
    expect(
      await f.memory.waitRun({
        runId: clearing.runId,
        timeoutMs: 5000,
      }),
    ).toMatchObject({
      status: 'completed',
      run: { status: 'completed' },
    });
    expect(f.memory.getStatus()).toMatchObject({
      memory: {
        artifactState: 'empty',
        generateMemories: false,
        useMemories: false,
      },
    });
    expect(f.files.hasArtifacts()).toBe(false);
    expect(f.sources.readSnapshot('s1').status).toBe('found');
    expect(
      f.database.prepare({ sql: 'SELECT reply_cursor,clear_reply_cursor FROM memory_state' }).get(),
    ).toEqual({
      reply_cursor: 1,
      clear_reply_cursor: 1,
    });
  } finally {
    await f.dispose();
  }
});
