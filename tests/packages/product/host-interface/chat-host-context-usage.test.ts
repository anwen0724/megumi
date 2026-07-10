import { describe, expect, it, vi } from 'vitest';
import { createChatHost } from '@megumi/product/host-interface/chat-host';
import type {
  ContextUsageWindow,
  GetCurrentContextUsageResult,
} from '@megumi/coding-agent/context';

function createController(input: {
  refreshAndGetSessionUsage: (request: {
    session_id: string;
    workspace_id?: string;
    model_config: ContextUsageWindow;
    reason: string;
  }) => Promise<GetCurrentContextUsageResult> | GetCurrentContextUsageResult;
}) {
  return createChatHost({
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
    agentRunQueries: {
      listRunsBySession: () => [],
      listRuntimeEventsByRun: () => [],
    },
    contextUsageMonitor: {
      refreshAndGetSessionUsage: input.refreshAndGetSessionUsage,
    },
    contextUsageWindowProvider: ({ modelId }) => ({
      model_id: modelId ?? 'configured-model',
      context_window_tokens: 258_000,
    }),
  });
}

describe('ChatHost context usage', () => {
  it('delegates refresh and query lifecycle to the Context owner for UI queries', async () => {
    const refreshAndGetSessionUsage = vi.fn((): GetCurrentContextUsageResult => ({
      status: 'ok',
      usage: {
        used_tokens: 222_000,
        context_window_tokens: 258_000,
        remaining_tokens: 36_000,
        used_ratio: 222_000 / 258_000,
        auto_compaction_threshold_ratio: 0.8,
        should_auto_compact: true,
      },
    }));
    const controller = createController({ refreshAndGetSessionUsage });

    await expect(controller.getContextUsage({
      sessionId: 'session:1',
      projectId: 'workspace:1',
      modelId: 'deepseek-v4-flash',
    })).resolves.toEqual({
      status: 'ok',
      usage: {
        usedTokens: 222_000,
        totalTokens: 258_000,
        remainingTokens: 36_000,
        usedPercent: 86,
        autoCompactPercent: 80,
        shouldAutoCompact: true,
      },
    });
    expect(refreshAndGetSessionUsage).toHaveBeenCalledWith({
      session_id: 'session:1',
      workspace_id: 'workspace:1',
      model_config: {
        model_id: 'deepseek-v4-flash',
        context_window_tokens: 258_000,
      },
      reason: 'host_context_usage_requested',
    });
  });

  it('starts background refresh without waiting for Context owner refresh to settle', async () => {
    let resolveRefresh!: (value: GetCurrentContextUsageResult) => void;
    const refreshAndGetSessionUsage = vi.fn(() => new Promise<GetCurrentContextUsageResult>((resolve) => {
      resolveRefresh = resolve;
    }));
    const controller = createController({ refreshAndGetSessionUsage });

    const result = await Promise.race([
      controller.getContextUsage({
        sessionId: 'session:1',
        projectId: 'workspace:1',
        refresh: 'background',
      }),
      Promise.resolve('not-awaited'),
    ]);

    expect(result).toEqual({ status: 'not_available', reason: 'not_calculated' });
    expect(refreshAndGetSessionUsage).toHaveBeenCalledWith({
      session_id: 'session:1',
      workspace_id: 'workspace:1',
      model_config: {
        model_id: 'configured-model',
        context_window_tokens: 258_000,
      },
      reason: 'host_context_usage_requested',
    });

    resolveRefresh({
      status: 'not_available',
      reason: 'not_calculated',
    });
  });

  it('returns not_calculated for background refresh even when owner has not finished', async () => {
    const refreshAndGetSessionUsage = vi.fn(async (): Promise<GetCurrentContextUsageResult> => ({
      status: 'ok',
      usage: {
        used_tokens: 10,
        context_window_tokens: 100,
        remaining_tokens: 90,
        used_ratio: 0.1,
        auto_compaction_threshold_ratio: 0.8,
        should_auto_compact: false,
      },
    }));
    const controller = createController({ refreshAndGetSessionUsage });

    await expect(controller.getContextUsage({
      sessionId: 'session:1',
      projectId: 'workspace:1',
      refresh: 'background',
    })).resolves.toEqual({ status: 'not_available', reason: 'not_calculated' });
  });
});
