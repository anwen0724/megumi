import { describe, expect, it, vi } from 'vitest';
import {
  ContextRepository,
  mapRuntimeEventToRuntimeFactSource,
  mapSessionCompactionToContextSource,
  mapSessionMessageToContextSource,
} from '@megumi/coding-agent/context/services/context-repository';
import type { ContextCompaction } from '@megumi/coding-agent/context';

describe('context repository mapping', () => {
  it('maps persisted session messages into context sources', () => {
    expect(mapSessionMessageToContextSource({
      messageId: 'message:1',
      role: 'user',
      content: 'hello',
      status: 'completed',
      createdAt: '2026-07-03T00:00:00.000Z',
    })).toEqual({
      source_id: 'message:1',
      source_kind: 'session_message',
      text: 'hello',
      persisted: true,
      created_at: '2026-07-03T00:00:00.000Z',
      metadata: { role: 'user', status: 'completed' },
    });
  });

  it('maps persisted compactions into context summary sources', () => {
    expect(mapSessionCompactionToContextSource({
      compactionId: 'compaction:1',
      summary: 'compressed context',
      status: 'completed',
      createdAt: '2026-07-03T00:00:00.000Z',
      metadata: { covered_source_ids: ['message:old'] },
    })).toMatchObject({
      source_id: 'compaction:1',
      source_kind: 'context_compaction_summary',
      text: 'compressed context',
      persisted: true,
    });
  });

  it('maps tool result runtime events into tool result sources', () => {
    expect(mapRuntimeEventToRuntimeFactSource({
      eventId: 'event:1',
      eventType: 'tool.result.created',
      createdAt: '2026-07-03T00:00:00.000Z',
      payload: { summary: 'Read README.md' },
    })).toMatchObject({
      source_id: 'event:1',
      source_kind: 'tool_result',
      text: 'Read README.md',
      persisted: true,
    });
  });

  it('saves context compaction through existing session compaction persistence', () => {
    const sessionRepository = {
      listMessagesBySession: vi.fn(() => []),
      listSessionCompactionsBySession: vi.fn(() => []),
      saveSessionCompaction: vi.fn(),
    };
    const repository = new ContextRepository({
      sessionRepository,
      activePathRepository: { getActivePath: vi.fn(() => ({ entries: [] })) },
      runtimeEventRepository: { listRuntimeEventsByRun: vi.fn(() => []) },
    });
    const compaction: ContextCompaction = {
      compaction_id: 'compaction:1',
      session_id: 'session:1',
      trigger: { kind: 'manual', requested_by: 'command' },
      summary: 'summary',
      compacted_source_refs: [],
      preserved_source_refs: [{ source_id: 'message:keep', source_kind: 'session_message' }],
      usage_before: {
        used_tokens: 10,
        context_window_tokens: 100,
        remaining_tokens: 90,
        used_ratio: 0.1,
        auto_compaction_threshold_ratio: 0.8,
        should_auto_compact: false,
      },
      status: 'completed',
      created_at: '2026-07-03T00:00:00.000Z',
    };

    repository.saveContextCompaction(compaction);

    expect(sessionRepository.saveSessionCompaction).toHaveBeenCalledWith(expect.objectContaining({
      compactionId: compaction.compaction_id,
      sessionId: compaction.session_id,
      summary: compaction.summary,
      status: 'completed',
    }));
  });
});
