import { describe, expect, it } from 'vitest';
import { planContextCompaction } from '@megumi/coding-agent/context/core/context-compaction';
import type { SessionContext, SessionContextUsage } from '@megumi/coding-agent/context';

const usage: SessionContextUsage = {
  used_tokens: 900,
  context_window_tokens: 1000,
  remaining_tokens: 100,
  used_ratio: 0.9,
  auto_compaction_threshold_ratio: 0.8,
  should_auto_compact: true,
};

describe('context compaction planning', () => {
  it('returns nothing_to_compact when there are fewer than two old session messages', () => {
    const result = planContextCompaction({
      session_context: {
        session_id: 'session:1',
        sources: [{
          source_id: 'message:1',
          source_kind: 'session_message',
          text: 'one message',
          persisted: true,
          created_at: '2026-07-03T00:00:00.000Z',
        }],
      },
      usage,
      trigger: { kind: 'manual', requested_by: 'command' },
    });

    expect(result).toEqual({ status: 'skipped', reason: 'nothing_to_compact' });
  });

  it('selects old messages and runtime/tool facts while preserving recent messages', () => {
    const result = planContextCompaction({
      session_context: contextWithSources(),
      usage,
      trigger: { kind: 'manual', requested_by: 'command' },
    });

    expect(result.status).toBe('ready');
    const ready = result.status === 'ready' ? result : undefined;
    expect(ready?.candidate_parts.map((part) => part.part_kind)).toEqual([
      'context_compaction_candidate',
      'context_compaction_candidate',
      'context_compaction_candidate',
    ]);
    expect(ready?.compacted_source_refs.map((ref) => ref.source_id)).toEqual([
      'message:1',
      'runtime:1',
      'tool:1',
    ]);
    expect(ready?.preserved_source_refs.map((ref) => ref.source_id)).toEqual([
      'message:2',
      'message:3',
    ]);
  });

  it('never selects agent instructions or memory recall as compaction candidates', () => {
    const result = planContextCompaction({
      session_context: {
        ...contextWithSources(),
        sources: [
          ...contextWithSources().sources,
          {
            source_id: 'instruction:1',
            source_kind: 'agent_instruction',
            text: 'AGENTS.md',
            persisted: false,
          },
          {
            source_id: 'memory:1',
            source_kind: 'memory_recall_result',
            text: 'memory recall',
            persisted: false,
          },
        ],
      },
      usage,
      trigger: { kind: 'manual', requested_by: 'command' },
    });

    expect(result.status).toBe('ready');
    const compactedRefs = result.status === 'ready' ? result.compacted_source_refs : [];
    expect(compactedRefs.map((ref) => ref.source_kind)).not.toContain('agent_instruction');
    expect(compactedRefs.map((ref) => ref.source_kind)).not.toContain('memory_recall_result');
  });

  it('skips auto compaction when usage no longer needs compaction', () => {
    const result = planContextCompaction({
      session_context: contextWithSources(),
      usage: { ...usage, should_auto_compact: false },
      trigger: { kind: 'auto', reason: 'context_window_threshold', signal_id: 'signal:1' },
    });

    expect(result).toEqual({ status: 'skipped', reason: 'not_needed' });
  });
});

function contextWithSources(): SessionContext {
  return {
    session_id: 'session:1',
    sources: [
      {
        source_id: 'message:1',
        source_kind: 'session_message',
        text: 'old message',
        persisted: true,
        created_at: '2026-07-03T00:00:00.000Z',
      },
      {
        source_id: 'message:2',
        source_kind: 'session_message',
        text: 'recent message 1',
        persisted: true,
        created_at: '2026-07-03T00:01:00.000Z',
      },
      {
        source_id: 'message:3',
        source_kind: 'session_message',
        text: 'recent message 2',
        persisted: true,
        created_at: '2026-07-03T00:02:00.000Z',
      },
      {
        source_id: 'runtime:1',
        source_kind: 'runtime_fact',
        text: 'runtime fact',
        persisted: true,
      },
      {
        source_id: 'tool:1',
        source_kind: 'tool_result',
        text: 'tool result',
        persisted: true,
      },
    ],
  };
}
