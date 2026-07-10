import { describe, expect, it, vi } from 'vitest';
import { createChatController } from '@megumi/coding-agent/host-interface';
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
  return createChatController({
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

describe('chat controller context usage', () => {
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
});
