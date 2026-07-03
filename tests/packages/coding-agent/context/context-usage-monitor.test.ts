import { describe, expect, it, vi } from 'vitest';
import { ContextUsageMonitor } from '@megumi/coding-agent/context';

function createMonitor(input: {
  text?: string;
  signalSink?: (value: any) => void;
  threshold?: number;
} = {}) {
  return new ContextUsageMonitor({
    contextService: {
      getSessionContext: vi.fn(async () => ({
        status: 'ok' as const,
        session_context: {
          session_id: 'session:1',
          workspace_id: 'workspace:1',
          sources: [{
            source_id: 'message:1',
            source_kind: 'session_message' as const,
            text: input.text ?? 'hello',
            persisted: true,
          }],
        },
      })),
    },
    clock: { now: () => '2026-07-03T00:00:00.000Z' },
    ids: {
      signalId: vi.fn()
        .mockReturnValueOnce('signal:1')
        .mockReturnValueOnce('signal:2')
        .mockReturnValueOnce('signal:3'),
      subscriptionId: vi.fn()
        .mockReturnValueOnce('subscription:1')
        .mockReturnValueOnce('subscription:2'),
    },
    defaultThresholdRatio: input.threshold ?? 0.8,
    signalSink: input.signalSink,
  });
}

describe('context usage monitor', () => {
  it('returns not_available before start', () => {
    const monitor = createMonitor();

    expect(monitor.getCurrentUsage({ session_id: 'session:1', workspace_id: 'workspace:1' })).toEqual({
      status: 'not_available',
      reason: 'not_started',
    });
  });

  it('starts without requiring synchronous usage calculation', async () => {
    const monitor = createMonitor();

    await expect(monitor.start({
      session_id: 'session:1',
      workspace_id: 'workspace:1',
      model_config: { model_id: 'test', context_window_tokens: 100 },
    })).resolves.toEqual({ status: 'ok' });
    expect(monitor.getCurrentUsage({ session_id: 'session:1', workspace_id: 'workspace:1' })).toEqual({
      status: 'not_available',
      reason: 'not_calculated',
    });
  });

  it('subscribes and emits usage_changed on refresh', async () => {
    const signalSink = vi.fn();
    const monitor = createMonitor({ signalSink });
    await monitor.start({
      session_id: 'session:1',
      workspace_id: 'workspace:1',
      model_config: { model_id: 'test', context_window_tokens: 100 },
    });
    const subscription = monitor.subscribe({ session_id: 'session:1', workspace_id: 'workspace:1' });

    await monitor.refreshSession({ session_id: 'session:1', workspace_id: 'workspace:1', reason: 'test' });

    expect(subscription).toEqual({ status: 'ok', subscription_id: 'subscription:1' });
    expect(signalSink).toHaveBeenCalledWith(expect.objectContaining({
      subscription_id: 'subscription:1',
      signal: expect.objectContaining({ kind: 'usage_changed' }),
    }));
  });

  it('emits auto_compaction_needed once for the same usage state', async () => {
    const signalSink = vi.fn();
    const monitor = createMonitor({ text: 'x'.repeat(2000), signalSink, threshold: 0.1 });
    await monitor.start({
      session_id: 'session:1',
      workspace_id: 'workspace:1',
      model_config: { model_id: 'test', context_window_tokens: 100 },
    });
    monitor.subscribe({ session_id: 'session:1', workspace_id: 'workspace:1' });

    await monitor.refreshSession({ session_id: 'session:1', workspace_id: 'workspace:1', reason: 'test' });
    await monitor.refreshSession({ session_id: 'session:1', workspace_id: 'workspace:1', reason: 'test' });

    expect(signalSink.mock.calls.filter((call) => call[0].signal.kind === 'auto_compaction_needed')).toHaveLength(1);
  });

  it('does not emit auto_compaction_needed while compaction is running', async () => {
    const signalSink = vi.fn();
    const monitor = createMonitor({ text: 'x'.repeat(2000), signalSink, threshold: 0.1 });
    await monitor.start({
      session_id: 'session:1',
      workspace_id: 'workspace:1',
      model_config: { model_id: 'test', context_window_tokens: 100 },
    });
    monitor.subscribe({ session_id: 'session:1', workspace_id: 'workspace:1' });
    monitor.markCompactionRunning({ session_id: 'session:1', workspace_id: 'workspace:1', running: true });

    await monitor.refreshSession({ session_id: 'session:1', workspace_id: 'workspace:1', reason: 'test' });

    expect(signalSink.mock.calls.some((call) => call[0].signal.kind === 'auto_compaction_needed')).toBe(false);
  });

  it('broadcasts the same signal to multiple subscribers for one session', async () => {
    const signalSink = vi.fn();
    const monitor = createMonitor({ signalSink });
    await monitor.start({
      session_id: 'session:1',
      workspace_id: 'workspace:1',
      model_config: { model_id: 'test', context_window_tokens: 100 },
    });
    monitor.subscribe({ session_id: 'session:1', workspace_id: 'workspace:1' });
    monitor.subscribe({ session_id: 'session:1', workspace_id: 'workspace:1' });

    await monitor.refreshSession({ session_id: 'session:1', workspace_id: 'workspace:1', reason: 'test' });

    const usageSignals = signalSink.mock.calls.filter((call) => call[0].signal.kind === 'usage_changed');
    expect(usageSignals).toHaveLength(2);
    expect(usageSignals[0][0].signal).toEqual(usageSignals[1][0].signal);
  });

  it('isolates sessions by workspace and session id, and stop removes state', async () => {
    const monitor = createMonitor();
    await monitor.start({
      session_id: 'session:1',
      workspace_id: 'workspace:1',
      model_config: { model_id: 'test', context_window_tokens: 100 },
    });
    await monitor.start({
      session_id: 'session:1',
      workspace_id: 'workspace:2',
      model_config: { model_id: 'test', context_window_tokens: 100 },
    });

    await monitor.refreshSession({ session_id: 'session:1', workspace_id: 'workspace:1', reason: 'test' });

    expect(monitor.getCurrentUsage({ session_id: 'session:1', workspace_id: 'workspace:1' }).status).toBe('ok');
    expect(monitor.getCurrentUsage({ session_id: 'session:1', workspace_id: 'workspace:2' })).toEqual({
      status: 'not_available',
      reason: 'not_calculated',
    });
    expect(monitor.stop({ session_id: 'session:1', workspace_id: 'workspace:1' })).toEqual({ status: 'ok' });
    expect(monitor.getCurrentUsage({ session_id: 'session:1', workspace_id: 'workspace:1' })).toEqual({
      status: 'not_available',
      reason: 'not_started',
    });
  });
});
