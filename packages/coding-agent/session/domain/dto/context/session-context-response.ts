/* Defines Session history and compaction results returned to Context. */
import type { SessionCompactionSummary, SessionEntry, SessionHistoryItem } from '../../model/session-entry';
import type { SessionRuntimeError } from '../../model/session';

export type GetActiveHistoryResult =
  | { status: 'ok'; history: SessionHistoryItem[] }
  | { status: 'failed'; failure: SessionRuntimeError };

export type SaveCompactionSummaryResult =
  | { status: 'saved'; compaction: SessionCompactionSummary; entry?: SessionEntry }
  | { status: 'failed'; failure: SessionRuntimeError };
