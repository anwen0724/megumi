import { describe, expect, it, vi } from 'vitest';
import { composeCodingAgentContext } from '@megumi/coding-agent/composition/compose-coding-agent-context';

describe('composeCodingAgentContext', () => {
  it('publishes monitor auto compaction signals without running compaction inside Context composition', async () => {
    const saveCompactionSummary = vi.fn(() => ({ status: 'saved' as const, compaction: {} as any }));
    const completePrompt = vi.fn(async () => ({ status: 'ok' as const, text: 'summary' }));
    const runtime = composeCodingAgentContext({
      sessionService: {
        getActiveHistory: () => ({
          status: 'ok',
          history: [
            historyMessage('message:1', 'old context '.repeat(100), '2026-07-03T00:00:00.000Z'),
            historyMessage('message:2', 'recent context', '2026-07-03T00:01:00.000Z'),
            historyMessage('message:3', 'latest context', '2026-07-03T00:02:00.000Z'),
          ],
        }),
        saveCompactionSummary,
      },
      runtimeEventRepository: {
        listRuntimeEventsByRun: () => [],
      },
      summaryModelCallPort: {
        completePrompt,
      },
      modelConfigProvider: () => ({ model_id: 'test', context_window_tokens: 100 }),
    });
    const signals: unknown[] = [];
    runtime.contextUsageSignalBus.subscribe('auto_compaction_needed', (signal) => {
      signals.push(signal);
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
      expect(signals).toEqual([expect.objectContaining({
        kind: 'auto_compaction_needed',
        session_id: 'session:1',
        workspace_id: 'workspace:1',
      })]);
    });
    expect(completePrompt).not.toHaveBeenCalled();
    expect(saveCompactionSummary).not.toHaveBeenCalled();
  });
});

function historyMessage(messageId: string, content: string, createdAt: string) {
  return {
    type: 'message' as const,
    entry: {
      entry_id: `entry:${messageId}`,
      session_id: 'session:1',
      entry_type: 'message' as const,
      message_id: messageId,
      created_at: createdAt,
    },
    message: {
      message_id: messageId,
      session_id: 'session:1',
      role: 'user' as const,
      content_text: content,
      created_at: createdAt,
    },
    attachments: [],
  };
}
