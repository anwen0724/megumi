import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
  ChatGetContextUsageUiResultSchema,
  createChatHost,
  type ChatContextUsagePort,
} from '@megumi/product/host-interface/chat-host';
import type { GetSessionUsageSnapshotResult } from '@megumi/agent/context';

function createHost(getSessionUsageSnapshot: (request: { sessionId: string }) => GetSessionUsageSnapshotResult) {
  const contextService = {
    getSessionUsageSnapshot: vi.fn(getSessionUsageSnapshot),
    prepareModelCall: vi.fn(),
    compactSession: vi.fn(),
    recordCompletedRunUsage: vi.fn(),
    refreshAndGetSessionUsage: vi.fn(),
    countPrompt: vi.fn(),
  };

  return {
    host: createChatHost({
      agentRunService: {} as never,
      commandService: { getCommandSuggestions: vi.fn() },
      sessionService: {} as never,
      branchService: {
        createBranchDraft: vi.fn() as never,
        cancelBranchDraft: vi.fn() as never,
      },
      workspaceService: {
        listWorkspaces: async () => ({ workspaces: [] }),
      },
      sessionTimelineQuery: {
        listSessionTimeline: vi.fn() as never,
      },
      contextService,
    }),
    contextService,
  };
}

function available(accuracy: 'provider_reported' | 'estimated'): GetSessionUsageSnapshotResult {
  return {
    status: 'available',
    snapshot: {
      sessionId: 'session:1',
      runId: 'run:1',
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      usage: {
        usedTokens: 222_000,
        contextWindowTokens: 258_000,
        remainingTokens: 36_000,
        usedRatio: 222_000 / 258_000,
        compactionThresholdRatio: 0.8,
      },
      accuracy,
      calculatedAt: '2026-07-12T00:00:00.000Z',
    },
  };
}

describe('ChatHost context usage', () => {
  it('requires the Context owner snapshot port', () => {
    expectTypeOf<Parameters<typeof createChatHost>[0]['contextService']>()
      .toEqualTypeOf<ChatContextUsagePort>();
  });

  it.each(['provider_reported', 'estimated'] as const)(
    'mechanically projects an available %s snapshot',
    async (accuracy) => {
      const { host, contextService } = createHost(() => available(accuracy));

      await expect(host.getContextUsage({ sessionId: 'session:1' })).resolves.toEqual({
        status: 'available',
        usage: {
          usedTokens: 222_000,
          totalTokens: 258_000,
          remainingTokens: 36_000,
          usedPercent: 86,
          autoCompactPercent: 80,
          accuracy,
        },
      });
      expect(contextService.getSessionUsageSnapshot).toHaveBeenCalledWith({ sessionId: 'session:1' });
      expect(contextService.prepareModelCall).not.toHaveBeenCalled();
      expect(contextService.compactSession).not.toHaveBeenCalled();
      expect(contextService.recordCompletedRunUsage).not.toHaveBeenCalled();
      expect(contextService.refreshAndGetSessionUsage).not.toHaveBeenCalled();
      expect(contextService.countPrompt).not.toHaveBeenCalled();
    },
  );

  it('projects a missing snapshot as not available without starting calculation', async () => {
    const { host, contextService } = createHost(() => ({ status: 'not_available' }));

    await expect(host.getContextUsage({ sessionId: 'session:1' })).resolves.toEqual({
      status: 'not_available',
    });
    expect(contextService.getSessionUsageSnapshot).toHaveBeenCalledTimes(1);
    expect(contextService.refreshAndGetSessionUsage).not.toHaveBeenCalled();
  });

  it('keeps an above-window completed snapshot valid across the Host schema', async () => {
    const { host } = createHost(() => ({
      status: 'available',
      snapshot: {
        sessionId: 'session:1',
        runId: 'run:over-window',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        usage: {
          usedTokens: 110,
          contextWindowTokens: 100,
          remainingTokens: -10,
          usedRatio: 1.1,
          compactionThresholdRatio: 0.8,
        },
        accuracy: 'provider_reported',
        calculatedAt: '2026-07-12T00:00:00.000Z',
      },
    }));

    const result = await host.getContextUsage({ sessionId: 'session:1' });

    expect(ChatGetContextUsageUiResultSchema.parse(result)).toEqual({
      status: 'available',
      usage: {
        usedTokens: 110,
        totalTokens: 100,
        remainingTokens: -10,
        usedPercent: 110,
        autoCompactPercent: 80,
        accuracy: 'provider_reported',
      },
    });
  });

  it('preserves Context owner failure details', async () => {
    const { host } = createHost(() => ({
      status: 'failed',
      failure: {
        code: 'usage_snapshot_invalid',
        message: 'Stored usage snapshot is invalid.',
        retryable: false,
      },
    }));

    await expect(host.getContextUsage({ sessionId: 'session:1' })).resolves.toEqual({
      status: 'failed',
      failure: {
        code: 'usage_snapshot_invalid',
        message: 'Stored usage snapshot is invalid.',
        retryable: false,
      },
    });
  });

  it('reads only the target session snapshot when the caller switches sessions', async () => {
    const snapshots = new Map<string, GetSessionUsageSnapshotResult>([
      ['session:1', available('estimated')],
      ['session:2', { status: 'not_available' }],
    ]);
    const { host, contextService } = createHost(({ sessionId }) => snapshots.get(sessionId) ?? { status: 'not_available' });

    await host.getContextUsage({ sessionId: 'session:1' });
    await expect(host.getContextUsage({ sessionId: 'session:2' })).resolves.toEqual({ status: 'not_available' });

    expect(contextService.getSessionUsageSnapshot).toHaveBeenNthCalledWith(1, { sessionId: 'session:1' });
    expect(contextService.getSessionUsageSnapshot).toHaveBeenNthCalledWith(2, { sessionId: 'session:2' });
  });
});
