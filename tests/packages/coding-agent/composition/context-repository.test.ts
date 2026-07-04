import { describe, expect, it, vi } from 'vitest';
import {
  ContextRepository,
  mapRuntimeEventToRuntimeFactSource,
  mapSessionCompactionToContextSource,
  mapSessionMessageToContextSource,
} from '@megumi/coding-agent/composition/context-repository';
import type { ContextCompaction } from '@megumi/coding-agent/context';
import type { SessionService } from '@megumi/coding-agent/session';

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

  it('reads context sources from the current session active history only', () => {
    const sessionService = {
      getActiveHistory: vi.fn(() => ({
        status: 'ok' as const,
        history: [
          {
            type: 'message' as const,
            entry: {
              entry_id: 'E1',
              session_id: 'session:1',
              entry_type: 'message' as const,
              message_id: 'message:active',
              created_at: '2026-07-03T00:00:00.000Z',
            },
            message: {
              message_id: 'message:active',
              session_id: 'session:1',
              role: 'user' as const,
              content_text: 'active message',
              created_at: '2026-07-03T00:00:00.000Z',
            },
            attachments: [],
          },
          {
            type: 'compaction' as const,
            entry: {
              entry_id: 'EC1',
              session_id: 'session:1',
              entry_type: 'compaction' as const,
              compaction_id: 'compaction:active',
              created_at: '2026-07-03T00:01:00.000Z',
            },
            compaction: {
              compaction_id: 'compaction:active',
              session_id: 'session:1',
              summary_text: 'active summary',
              covered_until_entry_id: 'E0',
              created_at: '2026-07-03T00:01:00.000Z',
            },
          },
        ],
      })),
      saveCompactionSummary: vi.fn(),
    } satisfies Pick<SessionService, 'getActiveHistory' | 'saveCompactionSummary'>;
    const repository = new ContextRepository({
      sessionService,
      runtimeEventRepository: { listRuntimeEventsByRun: vi.fn(() => []) },
    });

    expect(repository.listMessagesBySession('session:1')).toEqual([
      expect.objectContaining({ messageId: 'message:active', content: 'active message' }),
    ]);
    expect(repository.listSessionCompactionsBySession('session:1')).toEqual([
      expect.objectContaining({ compactionId: 'compaction:active', summary: 'active summary' }),
    ]);
  });

  it('saves context compaction through Session Service', () => {
    const sessionService = {
      getActiveHistory: vi.fn(() => ({
        status: 'ok' as const,
        history: [
          {
            type: 'message' as const,
            entry: {
              entry_id: 'E-old',
              session_id: 'session:1',
              entry_type: 'message' as const,
              message_id: 'message:old',
              created_at: '2026-07-03T00:00:00.000Z',
            },
            message: {
              message_id: 'message:old',
              session_id: 'session:1',
              role: 'user' as const,
              content_text: 'old',
              created_at: '2026-07-03T00:00:00.000Z',
            },
            attachments: [],
          },
          {
            type: 'message' as const,
            entry: {
              entry_id: 'E-keep',
              session_id: 'session:1',
              parent_entry_id: 'E-old',
              entry_type: 'message' as const,
              message_id: 'message:keep',
              created_at: '2026-07-03T00:01:00.000Z',
            },
            message: {
              message_id: 'message:keep',
              session_id: 'session:1',
              role: 'user' as const,
              content_text: 'keep',
              created_at: '2026-07-03T00:01:00.000Z',
            },
            attachments: [],
          },
        ],
      })),
      saveCompactionSummary: vi.fn(() => ({ status: 'saved' as const, compaction: {} as any })),
    } satisfies Pick<SessionService, 'getActiveHistory' | 'saveCompactionSummary'>;
    const repository = new ContextRepository({
      sessionService,
      runtimeEventRepository: { listRuntimeEventsByRun: vi.fn(() => []) },
    });
    const compaction: ContextCompaction = {
      compaction_id: 'compaction:1',
      session_id: 'session:1',
      trigger: { kind: 'manual', requested_by: 'command' },
      summary: 'summary',
      compacted_source_refs: [{ source_id: 'message:old', source_kind: 'session_message' }],
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

    expect(sessionService.saveCompactionSummary).toHaveBeenCalledWith(expect.objectContaining({
      compaction_id: compaction.compaction_id,
      session_id: compaction.session_id,
      summary_text: compaction.summary,
      covered_until_entry_id: 'E-old',
      first_kept_entry_id: 'E-keep',
      append_to_active_path: true,
    }));
  });
});
