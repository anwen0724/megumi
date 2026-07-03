import { describe, expect, it, vi } from 'vitest';
import { composeCodingAgentContext } from '@megumi/coding-agent/composition/compose-coding-agent-context';

describe('composeCodingAgentContext', () => {
  it('routes monitor auto compaction signals to ContextCompactionService', async () => {
    const saveSessionCompaction = vi.fn();
    const runtime = composeCodingAgentContext({
      sessionRepository: {
        listMessagesBySession: () => [
          message('message:1', 'old context '.repeat(100), '2026-07-03T00:00:00.000Z'),
          message('message:2', 'recent context', '2026-07-03T00:01:00.000Z'),
          message('message:3', 'latest context', '2026-07-03T00:02:00.000Z'),
        ],
        listSessionCompactionsBySession: () => [],
        saveSessionCompaction,
        getActivePath: () => ({ entries: [] }),
      },
      runtimeEventRepository: {
        listRuntimeEventsByRun: () => [],
      },
      summaryModelCallPort: {
        completePrompt: vi.fn(async () => ({ status: 'ok' as const, text: 'summary' })),
      },
      modelConfigProvider: () => ({ model_id: 'test', context_window_tokens: 100 }),
    });
    await runtime.contextUsageMonitor.start({
      session_id: 'session:1',
      workspace_id: 'workspace:1',
      model_config: { model_id: 'test', context_window_tokens: 100 },
      threshold_ratio: 0.5,
    });

    await runtime.contextUsageMonitor.refreshSession({
      session_id: 'session:1',
      workspace_id: 'workspace:1',
      reason: 'test',
    });

    await vi.waitFor(() => {
      expect(saveSessionCompaction).toHaveBeenCalledWith(expect.objectContaining({
        sessionId: 'session:1',
        summary: 'summary',
        status: 'completed',
      }));
    });
  });
});

function message(messageId: string, content: string, createdAt: string) {
  return {
    messageId,
    role: 'user' as const,
    content,
    status: 'completed',
    createdAt,
  };
}
