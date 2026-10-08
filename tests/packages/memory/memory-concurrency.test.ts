// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { fauxAssistantMessage } from '@megumi/ai';
import { EMPTY_MEMORY, EMPTY_SUMMARY } from '@megumi/application/memory/consolidation-documents';
import { productionFixture } from './production-fixture';

it('processes a newer extraction after the active fixed selection becomes superseded', async () => {
  const f = productionFixture();
  let resume!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>(resolve => {
    resume = resolve;
  });
  const paused = new Promise<void>(resolve => {
    entered = resolve;
  });
  try {
    await f.user('u1');
    f.provider.setResponses([
      async () => {
        entered();
        await gate;
        return f.tool('memory_file', {
          action: 'write',
          path: 'MEMORY.md',
          expectedVersion: 'absent',
          content: EMPTY_MEMORY,
        });
      },
      f.tool('memory_file', {
        action: 'write',
        path: 'memory_summary.md',
        expectedVersion: 'absent',
        content: EMPTY_SUMMARY,
      }),
      f.tool('memory_finish', {}),
      () => {
        f.responses();
        return f.tool('memory_file', { action: 'list' });
      },
    ]);
    const accepted = f.memory.startGeneration({
      requestId: 'first',
      reason: 'manual',
    });
    if (accepted.status !== 'started') throw new Error('Not started');
    await paused;
    expect(
      f.memory.updateDocument({
        requestId: 'busy',
        path: 'MEMORY.md',
        expectedVersion: 'absent',
        content: EMPTY_MEMORY,
      }),
    ).toMatchObject({ error: { code: 'BUSY' } });
    await f.user('u2', 'Continue using TypeScript.');
    await f.options.extraction.extract();
    resume();
    const finished = await f.memory.waitRun({
      runId: accepted.runId,
      timeoutMs: 5000,
    });
    expect(finished).toMatchObject({
      run: {
        jobs: expect.arrayContaining([
          expect.objectContaining({
            stage: 'consolidate',
            status: 'superseded',
          }),
        ]),
      },
    });
    await vi.waitFor(
      () =>
        expect(f.memory.getStatus()).toMatchObject({
          memory: {
            artifactState: 'ready',
            dirty: false,
            processedRevision: 2,
          },
        }),
      { timeout: 3000 },
    );
    expect(f.files.read('MEMORY.md')?.content).toContain('TypeScript');
  } finally {
    resume();
    await f.dispose();
  }
});

it('cancels the active Agent without allowing its delayed response to publish files', async () => {
  const f = productionFixture();
  let entered!: () => void;
  const paused = new Promise<void>(resolve => {
    entered = resolve;
  });
  try {
    await f.user('u1');
    f.provider.setResponses([
      async (_context, options) => {
        entered();
        await new Promise(resolve =>
          options?.signal?.addEventListener('abort', resolve, { once: true }),
        );
        return fauxAssistantMessage('Late response');
      },
    ]);
    const accepted = f.memory.startGeneration({
      requestId: 'first',
      reason: 'manual',
    });
    if (accepted.status !== 'started') throw new Error();
    await paused;
    expect(
      f.memory.startGeneration({
        requestId: 'duplicate-trigger',
        reason: 'manual',
      }),
    ).toEqual({
      status: 'reused',
      runId: accepted.runId,
    });
    expect(
      f.memory.cancelRun({
        requestId: 'cancel',
        runId: accepted.runId,
      }),
    ).toEqual({ status: 'cancelling' });
    expect(
      await f.memory.waitRun({
        runId: accepted.runId,
        timeoutMs: 5000,
      }),
    ).toMatchObject({ run: { status: 'cancelled' } });
    expect(f.files.read('MEMORY.md')).toBeUndefined();
  } finally {
    await f.dispose();
  }
});
