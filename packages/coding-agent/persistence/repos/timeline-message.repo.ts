import type { MegumiDatabase } from '../connection';
import { TimelineMessageSchema } from '@megumi/shared/timeline';
import type { JsonObject } from '@megumi/shared/primitives';
import type { TimelineMessage } from '@megumi/shared/timeline';

type Nullable<T> = T | null;

export type TimelineRunCommitStatus = 'committed' | 'failed';

export interface TimelineHydrationDiagnostic {
  messageId: string;
  code: 'timeline_message_parse_failed';
  message: string;
}

export interface TimelineCommitDiagnostic {
  diagnosticId: string;
  projectId: string;
  sessionId: string;
  runId: string;
  code: string;
  message: string;
  createdAt: string;
  metadata?: JsonObject;
}

export interface TimelineRunCommitRecord {
  runId: string;
  projectId: string;
  sessionId: string;
  status: TimelineRunCommitStatus;
  committedAt?: string;
  updatedAt: string;
  error?: JsonObject;
}

export interface TimelineCommitInput {
  projectId: string;
  sessionId: string;
  runId: string;
  committedAt: string;
  messages: TimelineMessage[];
  sessionPreview?: string;
}

interface TimelineMessageRow {
  message_id: string;
  project_id: string;
  session_id: string;
  run_id: Nullable<string>;
  role: TimelineMessage['role'];
  status: string;
  created_at: string;
  updated_at: string;
  sort_time: string;
  turn_order: number;
  blocks_json: string;
  message_json: string;
}

interface TimelineRunCommitRow {
  run_id: string;
  project_id: string;
  session_id: string;
  status: TimelineRunCommitStatus;
  committed_at: Nullable<string>;
  updated_at: string;
  error_json: Nullable<string>;
}

interface TimelineCommitDiagnosticRow {
  diagnostic_id: string;
  project_id: string;
  session_id: string;
  run_id: string;
  code: string;
  message: string;
  created_at: string;
  metadata_json: Nullable<string>;
}

export class TimelineMessageRepository {
  constructor(private readonly database: MegumiDatabase) {}

  commitRunTimeline(input: TimelineCommitInput): TimelineMessage[] {
    const messages = sortMessages(input.messages.map((message) => validateTimelineMessage(message)));
    validateCommitOwnership(input, messages);

    const commit = this.database.transaction(() => {
      for (const message of messages) {
        this.database.prepare(`
          INSERT INTO timeline_messages (
            message_id, project_id, session_id, run_id, role, status,
            created_at, updated_at, sort_time, turn_order, blocks_json, message_json
          ) VALUES (
            @message_id, @project_id, @session_id, @run_id, @role, @status,
            @created_at, @updated_at, @sort_time, @turn_order, @blocks_json, @message_json
          )
          ON CONFLICT(message_id) DO UPDATE SET
            project_id = excluded.project_id,
            session_id = excluded.session_id,
            run_id = excluded.run_id,
            role = excluded.role,
            status = excluded.status,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at,
            sort_time = excluded.sort_time,
            turn_order = excluded.turn_order,
            blocks_json = excluded.blocks_json,
            message_json = excluded.message_json
        `).run(toTimelineMessageRow(message));
      }

      this.database.prepare(`
        INSERT INTO timeline_run_commits (
          run_id, project_id, session_id, status, committed_at, updated_at, error_json
        ) VALUES (
          @run_id, @project_id, @session_id, 'committed', @committed_at, @updated_at, NULL
        )
        ON CONFLICT(run_id) DO UPDATE SET
          project_id = excluded.project_id,
          session_id = excluded.session_id,
          status = excluded.status,
          committed_at = excluded.committed_at,
          updated_at = excluded.updated_at,
          error_json = NULL
      `).run({
        run_id: input.runId,
        project_id: input.projectId,
        session_id: input.sessionId,
        committed_at: input.committedAt,
        updated_at: input.committedAt,
      });

      this.database.prepare(`
        UPDATE sessions
        SET
          updated_at = @updated_at,
          summary = COALESCE(@summary, summary)
        WHERE session_id = @session_id
      `).run({
        session_id: input.sessionId,
        updated_at: input.committedAt,
        summary: input.sessionPreview ?? null,
      });
    });

    commit();

    return messages;
  }

  listCommittedMessagesBySession(input: {
    projectId: string;
    sessionId: string;
  }): { messages: TimelineMessage[]; diagnostics: TimelineHydrationDiagnostic[] } {
    const rows = this.database.prepare(`
      SELECT *
      FROM timeline_messages
      WHERE project_id = ? AND session_id = ?
      ORDER BY sort_time ASC, run_id ASC, turn_order ASC, message_id ASC
    `).all(input.projectId, input.sessionId) as TimelineMessageRow[];

    const messages: TimelineMessage[] = [];
    const diagnostics: TimelineHydrationDiagnostic[] = [];

    for (const row of rows) {
      const parsed = parseTimelineMessageRow(row);

      if (parsed.ok) {
        messages.push(parsed.message);
      } else {
        diagnostics.push({
          messageId: row.message_id,
          code: 'timeline_message_parse_failed',
          message: parsed.message,
        });
      }
    }

    return { messages, diagnostics };
  }

  getRunCommit(runId: string): TimelineRunCommitRecord | undefined {
    const row = this.database
      .prepare('SELECT * FROM timeline_run_commits WHERE run_id = ?')
      .get(runId) as TimelineRunCommitRow | undefined;

    return row ? fromTimelineRunCommitRow(row) : undefined;
  }

  recordCommitDiagnostic(diagnostic: TimelineCommitDiagnostic): TimelineCommitDiagnostic {
    const save = this.database.transaction(() => {
      this.database.prepare(`
        INSERT INTO timeline_commit_diagnostics (
          diagnostic_id, project_id, session_id, run_id, code, message, created_at, metadata_json
        ) VALUES (
          @diagnostic_id, @project_id, @session_id, @run_id, @code, @message, @created_at, @metadata_json
        )
        ON CONFLICT(diagnostic_id) DO UPDATE SET
          project_id = excluded.project_id,
          session_id = excluded.session_id,
          run_id = excluded.run_id,
          code = excluded.code,
          message = excluded.message,
          created_at = excluded.created_at,
          metadata_json = excluded.metadata_json
      `).run(toTimelineCommitDiagnosticRow(diagnostic));

      this.database.prepare(`
        INSERT INTO timeline_run_commits (
          run_id, project_id, session_id, status, committed_at, updated_at, error_json
        ) VALUES (
          @run_id, @project_id, @session_id, 'failed', NULL, @updated_at, @error_json
        )
        ON CONFLICT(run_id) DO UPDATE SET
          project_id = excluded.project_id,
          session_id = excluded.session_id,
          status = excluded.status,
          updated_at = excluded.updated_at,
          error_json = excluded.error_json
      `).run({
        run_id: diagnostic.runId,
        project_id: diagnostic.projectId,
        session_id: diagnostic.sessionId,
        updated_at: diagnostic.createdAt,
        error_json: stringifyJson({
          code: diagnostic.code,
          message: diagnostic.message,
        }),
      });
    });

    save();

    return diagnostic;
  }

  listCommitDiagnostics(runId: string): TimelineCommitDiagnostic[] {
    return (this.database.prepare(`
      SELECT *
      FROM timeline_commit_diagnostics
      WHERE run_id = ?
      ORDER BY created_at ASC, diagnostic_id ASC
    `).all(runId) as TimelineCommitDiagnosticRow[]).map(fromTimelineCommitDiagnosticRow);
  }
}

function validateTimelineMessage(message: TimelineMessage): TimelineMessage {
  return TimelineMessageSchema.parse(message);
}

function validateCommitOwnership(input: TimelineCommitInput, messages: TimelineMessage[]): void {
  for (const message of messages) {
    const messageRunId =
      message.role === 'assistant' || message.role === 'user' ? message.runId : undefined;

    if (
      message.projectId !== input.projectId ||
      String(message.sessionId) !== input.sessionId ||
      (messageRunId !== undefined && String(messageRunId) !== input.runId)
    ) {
      throw new Error('Timeline commit message ownership mismatch.');
    }
  }
}

function messageRunId(message: TimelineMessage): string {
  if (message.role === 'assistant' || message.role === 'user') {
    return String(message.runId ?? '');
  }

  return '';
}

function messageTurnOrder(message: TimelineMessage): number {
  if (message.turnOrder !== undefined) return message.turnOrder;
  if (message.role === 'user') return 0;
  if (message.role === 'assistant') return 1;
  return 2;
}

function sortMessages(messages: TimelineMessage[]): TimelineMessage[] {
  return [...messages].sort((left, right) => {
    const createdOrder = left.createdAt.localeCompare(right.createdAt);
    if (createdOrder !== 0) return createdOrder;

    const runOrder = messageRunId(left).localeCompare(messageRunId(right));
    if (runOrder !== 0) return runOrder;

    const turnOrder = messageTurnOrder(left) - messageTurnOrder(right);
    if (turnOrder !== 0) return turnOrder;

    return String(left.messageId).localeCompare(String(right.messageId));
  });
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value);
}

function parseJson<T>(value: string | null): T | undefined;
function parseJson<T>(value: string): T;
function parseJson<T>(value: string | null): T | undefined {
  return value ? JSON.parse(value) as T : undefined;
}

function toTimelineMessageRow(message: TimelineMessage): TimelineMessageRow {
  return {
    message_id: String(message.messageId),
    project_id: message.projectId,
    session_id: String(message.sessionId),
    run_id: messageRunId(message) || null,
    role: message.role,
    status: 'committed',
    created_at: message.createdAt,
    updated_at: message.updatedAt ?? message.createdAt,
    sort_time: message.createdAt,
    turn_order: messageTurnOrder(message),
    blocks_json: stringifyJson(message.blocks),
    message_json: stringifyJson(message),
  };
}

function parseTimelineMessageRow(row: TimelineMessageRow):
  | { ok: true; message: TimelineMessage }
  | { ok: false; message: string } {
  try {
    const messageJson = parseJson<Record<string, unknown>>(row.message_json);
    const blocks = parseJson<unknown[]>(row.blocks_json);
    const result = TimelineMessageSchema.safeParse({
      ...messageJson,
      blocks,
    });

    if (!result.success) {
      return {
        ok: false,
        message: 'Persisted timeline message failed schema validation.',
      };
    }

    return { ok: true, message: result.data };
  } catch {
    return {
      ok: false,
      message: 'Persisted timeline message JSON could not be parsed.',
    };
  }
}

function fromTimelineRunCommitRow(row: TimelineRunCommitRow): TimelineRunCommitRecord {
  return {
    runId: row.run_id,
    projectId: row.project_id,
    sessionId: row.session_id,
    status: row.status,
    ...(row.committed_at ? { committedAt: row.committed_at } : {}),
    updatedAt: row.updated_at,
    ...(row.error_json ? { error: parseJson<JsonObject>(row.error_json) } : {}),
  };
}

function toTimelineCommitDiagnosticRow(
  diagnostic: TimelineCommitDiagnostic,
): TimelineCommitDiagnosticRow {
  return {
    diagnostic_id: diagnostic.diagnosticId,
    project_id: diagnostic.projectId,
    session_id: diagnostic.sessionId,
    run_id: diagnostic.runId,
    code: diagnostic.code,
    message: diagnostic.message,
    created_at: diagnostic.createdAt,
    metadata_json: diagnostic.metadata ? stringifyJson(diagnostic.metadata) : null,
  };
}

function fromTimelineCommitDiagnosticRow(
  row: TimelineCommitDiagnosticRow,
): TimelineCommitDiagnostic {
  return {
    diagnosticId: row.diagnostic_id,
    projectId: row.project_id,
    sessionId: row.session_id,
    runId: row.run_id,
    code: row.code,
    message: row.message,
    createdAt: row.created_at,
    ...(row.metadata_json ? { metadata: parseJson<JsonObject>(row.metadata_json) } : {}),
  };
}

