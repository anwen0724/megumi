/* Verifies Preference Learning uses one Context-built ordinary Completion and atomic commit. */
import { describe, expect, it, vi } from 'vitest';
import { completedMessage, model } from '../context/context-test-fixtures';
import { createPreferenceLearningRuntime } from '../../../packages/agent/discovery/src';
import type { PreferenceLearningRepository } from '../../../packages/agent/discovery/src';
import type { Observability } from '../../../packages/agent/observability/src';

describe('Preference Learning Runtime', () => {
  it('claims a ready batch, builds Context, completes once, and commits generated Direction IDs', async () => {
    let triggerRead = 0;
    const repository: PreferenceLearningRepository = {
      readPreferenceLearningTrigger: vi.fn(() => (++triggerRead === 1
        ? { status: 'ready', reason: 'threshold', pendingFeedbackCount: 3 }
        : { status: 'idle' })),
      claimPreferenceLearningBatch: vi.fn(() => ({
        batchId: 'batch:1', status: 'running', triggerReason: 'threshold', changeCount: 3,
        retryCount: 0, createdAt: '2026-08-27T08:00:00.000Z',
        startedAt: '2026-08-27T08:00:00.000Z',
      })),
      readPreferenceLearningFacts: vi.fn(),
      commitPreferenceLearningBatch: vi.fn(() => ({
        status: 'committed', revisions: [{ scopeKey: 'interest:interest:1', revision: 1 }],
        affectedInterestIds: ['interest:1'],
      })),
      listPreferenceSnapshots: vi.fn(() => []),
      interruptPreferenceLearningBatches: vi.fn(() => 0),
      failPreferenceLearningBatch: vi.fn(),
    };
    const context = { build: vi.fn(async () => ({
      status: 'ready' as const,
      prompt: { systemPrompt: 'learn', messages: [], tools: [] },
    })) };
    const models = { completeSimple: vi.fn(async () => completedMessage(JSON.stringify({
      scopes: [{
        scopeKey: 'interest:interest:1', baseRevision: 0,
        directions: [{
          directionId: '', polarity: 'positive', dimension: 'topic',
          statement: 'More runtime internals', supportingFeedbackIds: ['feedback:1'],
        }],
      }],
    }))) };
    const observability: Observability = {
      withTrace: vi.fn(async (_options, operation) => operation()),
      withSpan: vi.fn(async (_options, operation) => operation()),
      recordContent: vi.fn(),
      recordEvent: vi.fn(),
      linkTrace: vi.fn(),
    };
    const runtime = createPreferenceLearningRuntime({
      repository,
      context,
      models,
      resolveModel: async () => model,
      ids: {
        createBatchId: () => 'batch:1',
        createModelCallId: () => 'model-call:1',
        createDirectionId: () => 'direction:1',
      },
      now: () => '2026-08-27T08:00:00.000Z',
      observability,
    });

    await runtime.start();
    await vi.waitFor(() => {
      expect(repository.commitPreferenceLearningBatch).toHaveBeenCalledTimes(1);
    });
    await runtime.shutdown();

    expect(context.build).toHaveBeenCalledWith(expect.objectContaining({
      modelCallContext: expect.objectContaining({
        run: expect.objectContaining({ kind: 'preference_learning', batchId: 'batch:1' }),
        tools: [],
      }),
    }));
    expect(models.completeSimple).toHaveBeenCalledTimes(1);
    expect(observability.withTrace).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'preference_learning', correlation: { batchId: 'batch:1' },
    }), expect.any(Function));
    expect(observability.recordContent).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'preference.learning.result', correlation: { batchId: 'batch:1', modelCallId: 'model-call:1' },
    }));
    expect(observability.recordContent).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'preference.committed', correlation: { batchId: 'batch:1' },
    }));
    expect(repository.commitPreferenceLearningBatch).toHaveBeenCalledWith({
      batchId: 'batch:1',
      committedAt: '2026-08-27T08:00:00.000Z',
      scopes: [{
        scopeKey: 'interest:interest:1', baseRevision: 0,
        directions: [{
          directionId: 'direction:1', polarity: 'positive', dimension: 'topic',
          statement: 'More runtime internals', supportingFeedbackIds: ['feedback:1'],
        }],
      }],
    });
  });
});
