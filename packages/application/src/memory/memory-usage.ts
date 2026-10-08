/* Replays saved host receipts into deduplicated source usage without risking reply persistence. */
import type { DatabaseConnection } from '../storage/index';
import type { MemorySources } from './source-contracts';
import type { Observability } from '../observability/index';
import { validateMemoryCitations } from './memory-citations';

export type MemoryUsageResult = { readonly status: 'recorded' | 'alreadyProcessed' | 'pendingRetry'; readonly processedReplies: number };

/** The persisted reply cursor is the recovery authority even when the pending-event write fails. */
export function createMemoryUsage(options: { database: DatabaseConnection; sources: MemorySources; observability?: Observability }) {
  const { database, sources } = options;
  function event(replyId: string, status: 'valid' | 'invalid' | 'absent' | 'pendingRetry', count: number, executionId?: string, snapshotId?: string): void {
    // Diagnostics cannot roll back a reply or its usage transaction.
    try { options.observability?.recordEvent({ type: 'memory.usage.validated', replyId, status, count, executionId, snapshotId }); }
    catch { /* Observability is best effort; saved reply receipts remain authoritative. */ }
  }
  return function recordUsage(): MemoryUsageResult {
    let processedReplies = 0;
    try {
      for (;;) {
        const state = database.prepare<{ reply_cursor: number; clear_reply_cursor: number; clear_pending: number; control_revision: number }>({ sql: 'SELECT reply_cursor, clear_reply_cursor, clear_pending, control_revision FROM memory_state WHERE id = 1' }).get();
        if (!state) throw new Error('Missing memory state');
        if (state.clear_pending) return { status: 'pendingRetry', processedReplies };
        const replies = sources.listReplies({ afterCursor: Math.max(state.reply_cursor, state.clear_reply_cursor), limit: 200 });
        if (!replies.length) return { status: processedReplies ? 'recorded' : 'alreadyProcessed', processedReplies };
        for (const { message, cursor } of replies) {
          const evidence = message.memory_evidence;
          const text = message.content.filter(block => block.type === 'text').map(block => block.text).join('');
          const result = evidence && evidence.executionId === message.execution_id && evidence.controlRevision === state.control_revision
            ? validateMemoryCitations(text, evidence) : { status: text.includes('<memory_citations') ? 'invalid' as const : 'absent' as const, citations: [] };
          const used = new Map<string, string>();
          if (message.status === 'completed') for (const citation of result.citations) citation.sourceIds.forEach((id, index) => used.set(id, citation.sourceVersions[index]));
          try {
            database.transaction({ operation: () => {
              for (const [id, version] of used) database.prepare({ sql: `INSERT OR IGNORE INTO memory_usage_receipts
                (reply_id, session_id, source_version, status, used_at) VALUES (?, ?, ?, 'pending', ?)` }).run([message.message_id, id, version, message.completed_at ?? message.created_at]);
            } });
          } catch { event(message.message_id, 'pendingRetry', 0); return { status: 'pendingRetry', processedReplies }; }
          database.transaction({ operation: () => {
            // Recheck on replay and inside the accounting transaction; earlier validation is not eligibility.
            const current = database.prepare<typeof state>({ sql: 'SELECT reply_cursor, clear_reply_cursor, clear_pending, control_revision FROM memory_state WHERE id = 1' }).get();
            if (!current || current.clear_pending) throw new Error('Memory clearing');
            for (const [id] of used) {
              const pending = database.prepare<{ status: string }>({ sql: 'SELECT status FROM memory_usage_receipts WHERE reply_id = ? AND session_id = ?' }).get([message.message_id, id]);
              if (pending?.status !== 'pending') continue;
              const eligible = database.prepare<{ eligibility: string }>({ sql: 'SELECT eligibility FROM memory_sources WHERE session_id = ?' }).get([id]);
              const exists = sources.listSources({ sessionId: id }).length > 0;
              const count = cursor > current.clear_reply_cursor && evidence?.controlRevision === current.control_revision && eligible?.eligibility === 'eligible' && exists;
              if (count) database.prepare({ sql: `UPDATE memory_sources SET usage_count = usage_count + 1,
                last_used_at = CASE WHEN last_used_at IS NULL OR last_used_at < ? THEN ? ELSE last_used_at END WHERE session_id = ?` })
                .run([message.completed_at ?? message.created_at, message.completed_at ?? message.created_at, id]);
              database.prepare({ sql: 'UPDATE memory_usage_receipts SET status = ? WHERE reply_id = ? AND session_id = ?' }).run([count ? 'counted' : 'ignored', message.message_id, id]);
            }
            database.prepare({ sql: 'UPDATE memory_state SET reply_cursor = max(reply_cursor, ?) WHERE id = 1' }).run([cursor]);
          } });
          processedReplies++;
          event(message.message_id, result.status, used.size, message.execution_id, evidence?.snapshotId);
        }
      }
    } catch { event('', 'pendingRetry', 0); return { status: 'pendingRetry', processedReplies }; }
  };
}
