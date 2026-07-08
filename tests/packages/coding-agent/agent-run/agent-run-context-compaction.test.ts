import { describe, expect, it, vi } from 'vitest';
import { consumeContextUsageSignal } from '@megumi/coding-agent/agent-run/core/run-orchestrator';
import { RuntimeEventSchema } from '@megumi/coding-agent/events';

describe('Agent Run context compaction control flow', () => {
  it('consumes auto compaction signals by calling Context Compaction Service', async () => {
    const compact = vi.fn(async () => ({
      status: 'completed' as const,
      compaction: {
        compaction_id: 'compaction-1',
        session_id: 'session-1',
        workspace_id: 'workspace-1',
        trigger: { kind: 'auto' as const, reason: 'context_window_threshold' as const, signal_id: 'signal-1' },
        summary: 'summary',
        compacted_source_refs: [],
        preserved_source_refs: [],
        usage_before: usage(),
        status: 'completed' as const,
        created_at: '2026-01-01T00:00:00.000Z',
      },
      events: [],
    }));
    const emit = vi.fn((input) => ({
      eventId: `event:${input.eventType.replaceAll('.', '_')}`,
      schemaVersion: 1 as const,
      eventType: input.eventType,
      runId: 'run-1',
      sessionId: input.sessionId ?? 'session-1',
      sequence: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      source: 'core' as const,
      visibility: 'user' as const,
      persist: 'required' as const,
      payload: input.payload,
    }));

    const result = await consumeContextUsageSignal({
      signal: {
        kind: 'auto_compaction_needed',
        signal_id: 'signal-1',
        session_id: 'session-1',
        workspace_id: 'workspace-1',
        usage: usage(),
        created_at: '2026-01-01T00:00:00.000Z',
      },
      context_compaction_service: { compact },
      event_sink: { emit },
    });

    expect(compact).toHaveBeenCalledWith({
      session_id: 'session-1',
      workspace_id: 'workspace-1',
      trigger: { kind: 'auto', reason: 'context_window_threshold', signal_id: 'signal-1' },
    });
    expect(result.status).toBe('completed');
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'context.compaction.started',
      sessionId: 'session-1',
      payload: expect.objectContaining({
        compactionId: 'signal-1',
        triggerReason: 'context_limit',
      }),
    }));
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'context.compaction.completed',
      sessionId: 'session-1',
      payload: expect.objectContaining({
        compactionId: 'compaction-1',
        triggerReason: 'context_limit',
      }),
    }));
    expectRuntimeEventsSchemaValid(emit.mock.results.map((result) => result.value));
  });

  it('ignores non-auto-compaction context usage signals', async () => {
    const compact = vi.fn();

    const result = await consumeContextUsageSignal({
      signal: {
        kind: 'usage_changed',
        signal_id: 'signal-1',
        session_id: 'session-1',
        usage: usage(),
        created_at: '2026-01-01T00:00:00.000Z',
      },
      context_compaction_service: { compact },
      event_sink: { emit: vi.fn() },
    });

    expect(result).toEqual({ status: 'ignored', reason: 'not_auto_compaction_signal' });
    expect(compact).not.toHaveBeenCalled();
  });
});

function usage() {
  return {
    used_tokens: 90,
    context_window_tokens: 100,
    remaining_tokens: 10,
    used_ratio: 0.9,
    auto_compaction_threshold_ratio: 0.8,
    should_auto_compact: true,
  };
}

function expectRuntimeEventsSchemaValid(events: unknown[]): void {
  for (const event of events) {
    expect(RuntimeEventSchema.safeParse(event).success).toBe(true);
  }
}
