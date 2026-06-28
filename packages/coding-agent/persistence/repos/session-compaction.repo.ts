// Owns persisted session compaction summaries for session context history.
import type { MegumiDatabase } from '../connection';
import {
  SessionCompactionEntrySchema,
  type SessionCompactionEntry,
} from '@megumi/shared/session';

type Nullable<T> = T | null;

interface SessionCompactionRow {
  compaction_id: string;
  session_id: string;
  summary: string;
  first_kept_source_ref_json: string;
  tokens_before: number;
  trigger_reason: string;
  status: string;
  created_at: string;
  metadata_json: Nullable<string>;
}

export class SessionCompactionRepository {
  constructor(private readonly database: MegumiDatabase) {}

  saveSessionCompaction(entry: SessionCompactionEntry): void {
    const parsed = SessionCompactionEntrySchema.parse(entry);

    this.database.prepare(`
      INSERT INTO session_compactions (
        compaction_id,
        session_id,
        summary,
        first_kept_source_ref_json,
        tokens_before,
        trigger_reason,
        status,
        created_at,
        metadata_json
      ) VALUES (
        @compactionId,
        @sessionId,
        @summary,
        @firstKeptSourceRefJson,
        @tokensBefore,
        @triggerReason,
        @status,
        @createdAt,
        @metadataJson
      )
      ON CONFLICT(compaction_id) DO UPDATE SET
        session_id = excluded.session_id,
        summary = excluded.summary,
        first_kept_source_ref_json = excluded.first_kept_source_ref_json,
        tokens_before = excluded.tokens_before,
        trigger_reason = excluded.trigger_reason,
        status = excluded.status,
        created_at = excluded.created_at,
        metadata_json = excluded.metadata_json
    `).run({
      compactionId: parsed.compactionId,
      sessionId: parsed.sessionId,
      summary: parsed.summary,
      firstKeptSourceRefJson: stringifyJson(parsed.firstKeptSourceRef),
      tokensBefore: parsed.tokensBefore,
      triggerReason: parsed.triggerReason,
      status: parsed.status,
      createdAt: parsed.createdAt,
      metadataJson: parsed.metadata ? stringifyJson(parsed.metadata) : null,
    });
  }

  getSessionCompaction(compactionId: string): SessionCompactionEntry | null {
    const row = this.database
      .prepare('SELECT * FROM session_compactions WHERE compaction_id = ?')
      .get(compactionId) as SessionCompactionRow | undefined;

    return row ? fromSessionCompactionRow(row) : null;
  }

  listSessionCompactionsBySession(sessionId: string): SessionCompactionEntry[] {
    return (this.database
      .prepare(`
        SELECT *
        FROM session_compactions
        WHERE session_id = ?
        ORDER BY created_at DESC, compaction_id DESC
      `)
      .all(sessionId) as SessionCompactionRow[]).map(fromSessionCompactionRow);
  }

  getLatestCompletedSessionCompaction(sessionId: string): SessionCompactionEntry | null {
    const row = this.database
      .prepare(`
        SELECT *
        FROM session_compactions
        WHERE session_id = ?
          AND status = 'completed'
        ORDER BY created_at DESC, compaction_id DESC
        LIMIT 1
      `)
      .get(sessionId) as SessionCompactionRow | undefined;

    return row ? fromSessionCompactionRow(row) : null;
  }
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value);
}

function parseJson<T>(value: string | null): T | undefined;
function parseJson<T>(value: string): T;
function parseJson<T>(value: string | null): T | undefined {
  return value ? JSON.parse(value) as T : undefined;
}

function fromSessionCompactionRow(row: SessionCompactionRow): SessionCompactionEntry {
  return SessionCompactionEntrySchema.parse({
    compactionId: row.compaction_id,
    sessionId: row.session_id,
    summary: row.summary,
    summaryKind: 'compaction',
    firstKeptSourceRef: parseJson(row.first_kept_source_ref_json),
    tokensBefore: row.tokens_before,
    triggerReason: row.trigger_reason,
    status: row.status,
    createdAt: row.created_at,
    metadata: row.metadata_json ? parseJson(row.metadata_json) : undefined,
  });
}
