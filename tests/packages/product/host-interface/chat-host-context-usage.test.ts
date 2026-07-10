import { describe, expect, it, vi } from 'vitest';
import { createChatHost } from '@megumi/product/host-interface/chat-host';
import type {
  ContextUsageWindow,
  GetCurrentContextUsageResult,
  StartContextUsageMonitorResult,
} from '@megumi/coding-agent/context';

function createController(input: {
  getCurrentUsage: (request: { session_id: string; workspace_id?: string }) => GetCurrentContextUsageResult;
  start: (request: { session_id: string; workspace_id?: string; model_config: ContextUsageWindow }) => Promise<StartContextUsageMonitorResult> | StartContextUsageMonitorResult;
  refreshSession: (request: { session_id: string; workspace_id?: string; reason: string }) => Promise<void> | void;
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
      getCurrentUsage: input.getCurrentUsage,
      start: input.start,
      refreshSession: input.refreshSession,
    },
    contextUsageWindowProvider: ({ modelId }) => ({
      model_id: modelId ?? 'configured-model',
      context_window_tokens: 258_000,
    }),
  });
}

describe('ChatHost context usage', () => {
  it('starts, refreshes, and returns current context usage for UI queries', async () => {
    const getCurrentUsage = vi.fn((): GetCurrentContextUsageResult => ({
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
    const start = vi.fn(async (): Promise<StartContextUsageMonitorResult> => ({ status: 'ok' }));
    const refreshSession = vi.fn(async () => undefined);
    const controller = createController({ getCurrentUsage, start, refreshSession });

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
    expect(start).toHaveBeenCalledWith({
      session_id: 'session:1',
      workspace_id: 'workspace:1',
      model_config: {
        model_id: 'deepseek-v4-flash',
        context_window_tokens: 258_000,
      },
    });
    expect(refreshSession).toHaveBeenCalledWith({
      session_id: 'session:1',
      workspace_id: 'workspace:1',
      reason: 'ui_context_usage_requested',
    });
  });

  it('starts background refresh without waiting for refreshSession to settle', async () => {
    let resolveRefresh!: () => void;
    const getCurrentUsage = vi.fn((): GetCurrentContextUsageResult => ({
      status: 'not_available',
      reason: 'not_calculated',
    }));
    const start = vi.fn(async (): Promise<StartContextUsageMonitorResult> => ({ status: 'ok' }));
    const refreshSession = vi.fn(() => new Promise<void>((resolve) => {
      resolveRefresh = resolve;
    }));
    const controller = createController({ getCurrentUsage, start, refreshSession });

    const result = await Promise.race([
      controller.getContextUsage({
        sessionId: 'session:1',
        projectId: 'workspace:1',
        refresh: 'background',
      }),
      Promise.resolve('not-awaited'),
    ]);

    expect(result).toEqual({ status: 'not_available', reason: 'not_calculated' });
    expect(refreshSession).toHaveBeenCalledWith({
      session_id: 'session:1',
      workspace_id: 'workspace:1',
      reason: 'ui_context_usage_requested',
    });

    resolveRefresh();
  });

  it('normalizes missing background usage to not_calculated while refresh starts', async () => {
    const getCurrentUsage = vi.fn((): GetCurrentContextUsageResult => ({
      status: 'not_available',
      reason: 'not_started',
    }));
    const start = vi.fn(async (): Promise<StartContextUsageMonitorResult> => ({ status: 'ok' }));
    const refreshSession = vi.fn(async () => undefined);
    const controller = createController({ getCurrentUsage, start, refreshSession });

    await expect(controller.getContextUsage({
      sessionId: 'session:1',
      projectId: 'workspace:1',
      refresh: 'background',
    })).resolves.toEqual({ status: 'not_available', reason: 'not_calculated' });
  });
});
