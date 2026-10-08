// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { fauxAssistantMessage } from '@megumi/ai';
import { createMemory } from '@megumi/application/memory/memory';
import { productionFixture } from './production-fixture';

it('retains removed source material until a successful cleanup releases its reference', async () => {
  const f = productionFixture();
  try {
    await f.user('u1'); f.responses(); await f.generate();
    const oldPath = f.files.paths().find(path => path.startsWith('rollout_summaries/'))!;
    await f.user('u2', 'Use TypeScript, including interfaces.');
    f.provider.setResponses([fauxAssistantMessage('Consolidation failed.')]);
    const failed = await f.generate('changed');
    expect(failed.result).toMatchObject({ result: 'partial' });
    expect(f.memory.readDocument({ path: oldPath }).status).toBe('found');
    f.advance(3600001); f.responses();
    expect(await f.generate('cleanup')).toMatchObject({ result: { result: 'generated' } });
    expect(f.memory.readDocument({ path: oldPath }).status).toBe('notFound');
    expect(f.sources.readSnapshot('s1').status).toBe('found');
  } finally { await f.dispose(); }
});

it('stops at the model request budget when a model repeatedly calls unavailable capabilities', async () => {
  const f = productionFixture();
  try {
    await f.user('u1');
    f.provider.setResponses(Array.from({ length: 49 }, () => f.tool('shell', { command: 'unavailable' })));
    const run = await f.generate();
    expect(run.jobs.find(job => job.stage === 'consolidate')).toMatchObject({ status: 'failed', error: { code: 'EXECUTION_LIMIT_REACHED' } });
    expect(f.provider.state.callCount).toBe(48);
    expect(f.files.list()).toEqual([]);
  } finally { await f.dispose(); }
});

it('reports an input budget error without sending an oversized fixed prompt', async () => {
  const f = productionFixture();
  try {
    await f.user('u1');
    const resolve = f.options.resolveModel;
    vi.spyOn(f.options, 'resolveModel').mockImplementation(async () => {
      const resolved = await resolve();
      return { ...resolved, model: { ...resolved.model, contextWindow: 512, maxTokens: 128 } };
    });
    const run = await f.generate();
    expect(run.jobs.find(job => job.stage === 'consolidate')).toMatchObject({ status: 'failed', error: { code: 'BUDGET_EXCEEDED' } });
    expect(f.provider.state.callCount).toBe(0);
  } finally { vi.restoreAllMocks(); await f.dispose(); }
});

it('keeps intact files ready after a model failure and bounds automatic and manual retries', async () => {
  const f = productionFixture();
  try {
    await f.user('u1'); f.responses(); await f.generate();
    const before = f.files.read('MEMORY.md')!;
    f.memory.updateDocument({ requestId: 'edit', path: before.path, expectedVersion: before.version, content: before.content });
    f.provider.setResponses([fauxAssistantMessage('Cannot perform consolidation.')]);
    const first = await f.generate('failure');
    expect(first.status).toBe('failed');
    expect(f.memory.getStatus()).toMatchObject({ memory: { artifactState: 'ready', dirty: true } });
    const calls = f.provider.state.callCount;
    await f.generate('too-soon');
    expect(f.provider.state.callCount).toBe(calls);
    for (let attempt = 2; attempt <= 3; attempt++) {
      f.advance(3600001); f.provider.setResponses([fauxAssistantMessage('Cannot finish.')]);
      expect((await f.generate(`failure-${attempt}`)).jobs.find(job => job.stage === 'consolidate')).toMatchObject({ attempt, status: 'failed' });
    }
    f.advance(3600001);
    const exhausted = await f.generate('exhausted');
    expect(exhausted.jobs.filter(job => job.stage === 'consolidate')).toHaveLength(0);
    const failedJob = first.jobs.find(job => job.stage === 'consolidate')!;
    const replay = f.memory.startGeneration({ requestId: 'stale-retry', reason: 'retry', failedJobId: failedJob.jobId });
    if (replay.status === 'started') {
      const result = await f.memory.waitRun({ runId: replay.runId, timeoutMs: 5000 });
      expect(result).toMatchObject({ run: { status: 'failed', result: { error: { code: 'INVALID_ARGUMENT' } } } });
    } else expect(replay).toMatchObject({ error: { code: 'INVALID_ARGUMENT' } });
  } finally { await f.dispose(); }
});

it('does not certify final files when the successful snapshot transaction fails', async () => {
  const f = productionFixture();
  try {
    await f.user('u1'); f.responses();
    const original = f.database.prepare.bind(f.database);
    const fault = vi.spyOn(f.database, 'prepare').mockImplementation(request => {
      if (request.sql.includes("SET artifact_state = 'ready', processed_revision")) throw new Error('Injected state commit failure');
      return original(request);
    });
    const run = await f.generate();
    expect(run.result).toMatchObject({ result: 'partial', error: { code: 'STORAGE_FAILED' } });
    fault.mockRestore();
    expect(f.files.read('MEMORY.md')?.content).toContain('TypeScript');
    expect(f.memory.getStatus()).toMatchObject({ memory: { artifactState: 'needsRepair', processedRevision: 0 } });
    const reopened = createMemory(f.options);
    expect(reopened.getStatus()).toMatchObject({ memory: { artifactState: 'needsRepair' } });
    await reopened.shutdown();
  } finally { vi.restoreAllMocks(); await f.dispose(); }
});

it.each(['configuration', 'deletion'])('resumes a durable clear after %s fails without relearning original history', async point => {
  const f = productionFixture();
  try {
    await f.user('u1'); f.responses(); await f.generate();
    const calls = f.provider.state.callCount;
    const fault = point === 'configuration' ? vi.spyOn(f.settings, 'updateSettings').mockImplementationOnce(() => { throw new Error('Cannot save settings'); })
      : vi.spyOn(f.files, 'clear').mockImplementationOnce(() => { f.files.deleteFinal('MEMORY.md', () => {}); throw new Error('Cannot remove remaining files'); });
    const accepted = f.memory.clearMemory({ requestId: 'clear', confirmed: true });
    if (accepted.status !== 'started') throw new Error('Not accepted');
    expect(await f.memory.waitRun({ runId: accepted.runId, timeoutMs: 5000 })).toMatchObject({ run: { status: 'failed' } });
    expect(f.memory.getStatus()).toMatchObject({ memory: { artifactState: 'clearing' } });
    expect(f.memory.startGeneration({ requestId: 'blocked', reason: 'manual' })).toMatchObject({ error: { code: 'BUSY' } });
    if (point === 'configuration') expect(f.files.read('MEMORY.md')).toBeDefined();
    fault.mockRestore();
    const reopened = createMemory(f.options);
    await vi.waitFor(() => expect(reopened.getStatus()).toMatchObject({ memory: { artifactState: 'empty', generateMemories: false, useMemories: false } }));
    expect(f.provider.state.callCount).toBe(calls);
    expect(f.sources.readSnapshot('s1').status).toBe('found');
    await reopened.shutdown();
  } finally { vi.restoreAllMocks(); await f.dispose(); }
});
