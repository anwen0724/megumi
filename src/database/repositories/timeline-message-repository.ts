// Persists canonical renderer timeline messages committed from chat stream events.
import type { TimelineMessage } from '../../shared/renderer-contracts/timeline';
import type { JsonObject } from '../../shared';
import type { SqliteDatabase } from '../connection';
import { decodeJson, encodeJson } from '../json';

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
  code: 'timeline_commit_failed';
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
  run_id: string | null;
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
  committed_at: string | null;
  updated_at: string;
  error_json: string | null;
}

interface TimelineCommitDiagnosticRow {
  diagnostic_id: string;
  project_id: string;
  session_id: string;
  run_id: string;
  code: TimelineCommitDiagnostic['code'];
  message: string;
  created_at: string;
  metadata_json: string | null;
}

export class SqliteTimelineMessageRepository {
  constructor(private readonly database: SqliteDatabase) {}

  commitRunTimeline(input: TimelineCommitInput): TimelineMessage[] {
    const messages = sortMessages(input.messages.map(assertTimelineMessage));
    validateCommitOwnership(input, messages);

    const commit = this.database.transaction(() => {
      for (const message of messages) {
        this.database.prepare(`
          INSERT INTO timeline_messages (
            message_id, project_id, session_id, run_id, role, status,
            created_at, updated_at, sort_time, turn_order, blocks_json, message_json
          ) VALUES (
            @messageId, @projectId, @sessionId, @runId, @role, @status,
            @createdAt, @updatedAt, @sortTime, @turnOrder, @blocksJson, @messageJson
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
          @runId, @projectId, @sessionId, 'committed', @committedAt, @updatedAt, NULL
        )
        ON CONFLICT(run_id) DO UPDATE SET
          project_id = excluded.project_id,
          session_id = excluded.session_id,
          status = excluded.status,
          committed_at = excluded.committed_at,
          updated_at = excluded.updated_at,
          error_json = NULL
      `).run({
        runId: input.runId,
        projectId: input.projectId,
        sessionId: input.sessionId,
        committedAt: input.committedAt,
        updatedAt: input.committedAt,
      });

      this.database.prepare(`
        UPDATE sessions
        SET updated_at = @updatedAt,
            title = CASE
              WHEN @sessionPreview IS NOT NULL AND title = 'New session' THEN @sessionPreview
              ELSE title
            END
        WHERE id = @sessionId
      `).run({
        sessionId: input.sessionId,
        updatedAt: input.committedAt,
        sessionPreview: input.sessionPreview ?? null,
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
          @diagnosticId, @projectId, @sessionId, @runId, @code, @message, @createdAt, @metadataJson
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
          @runId, @projectId, @sessionId, 'failed', NULL, @updatedAt, @errorJson
        )
        ON CONFLICT(run_id) DO UPDATE SET
          project_id = excluded.project_id,
          session_id = excluded.session_id,
          status = excluded.status,
          updated_at = excluded.updated_at,
          error_json = excluded.error_json
      `).run({
        runId: diagnostic.runId,
        projectId: diagnostic.projectId,
        sessionId: diagnostic.sessionId,
        updatedAt: diagnostic.createdAt,
        errorJson: JSON.stringify({ code: diagnostic.code, message: diagnostic.message }),
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

function toTimelineMessageRow(message: TimelineMessage) {
  return {
    messageId: String(message.messageId),
    projectId: message.projectId,
    sessionId: String(message.sessionId),
    runId: messageRunId(message) || null,
    role: message.role,
    status: 'committed',
    createdAt: message.createdAt,
    updatedAt: message.updatedAt ?? message.createdAt,
    sortTime: message.createdAt,
    turnOrder: messageTurnOrder(message),
    blocksJson: JSON.stringify(message.blocks),
    messageJson: JSON.stringify(message),
  };
}

function parseTimelineMessageRow(row: TimelineMessageRow):
  | { ok: true; message: TimelineMessage }
  | { ok: false; message: string } {
  try {
    const message = decodeJson<TimelineMessage>(row.message_json);
    const blocks = decodeJson<TimelineMessage['blocks']>(row.blocks_json);
    if (!message || !blocks) {
      return { ok: false, message: 'Persisted timeline message JSON could not be parsed.' };
    }
    return { ok: true, message: assertTimelineMessage({ ...(message as object), blocks } as TimelineMessage) };
  } catch {
    return { ok: false, message: 'Persisted timeline message failed schema validation.' };
  }
}

function assertTimelineMessage(message: TimelineMessage): TimelineMessage {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    throw new Error('Timeline message must be an object.');
  }
  if (message.role !== 'user' && message.role !== 'assistant' && message.role !== 'separator') {
    throw new Error('Timeline message role is invalid.');
  }
  if (!message.messageId || !message.projectId || !message.sessionId || !Array.isArray(message.blocks)) {
    throw new Error('Timeline message required fields are missing.');
  }
  if (message.role === 'assistant' && !message.runId) {
    throw new Error('Assistant timeline message requires runId.');
  }
  return message;
}

function validateCommitOwnership(input: TimelineCommitInput, messages: TimelineMessage[]): void {
  for (const message of messages) {
    const runId = messageRunId(message);
    if (
      message.projectId !== input.projectId
      || String(message.sessionId) !== input.sessionId
      || (runId && runId !== input.runId)
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
  if (typeof message.turnOrder === 'number') return message.turnOrder;
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

function fromTimelineRunCommitRow(row: TimelineRunCommitRow): TimelineRunCommitRecord {
  return {
    runId: row.run_id,
    projectId: row.project_id,
    sessionId: row.session_id,
    status: row.status,
    ...(row.committed_at ? { committedAt: row.committed_at } : {}),
    updatedAt: row.updated_at,
    ...(row.error_json ? { error: decodeJson<JsonObject>(row.error_json) } : {}),
  };
}

function toTimelineCommitDiagnosticRow(diagnostic: TimelineCommitDiagnostic) {
  return {
    diagnosticId: diagnostic.diagnosticId,
    projectId: diagnostic.projectId,
    sessionId: diagnostic.sessionId,
    runId: diagnostic.runId,
    code: diagnostic.code,
    message: diagnostic.message,
    createdAt: diagnostic.createdAt,
    metadataJson: encodeJson(diagnostic.metadata),
  };
}

function fromTimelineCommitDiagnosticRow(row: TimelineCommitDiagnosticRow): TimelineCommitDiagnostic {
  return {
    diagnosticId: row.diagnostic_id,
    projectId: row.project_id,
    sessionId: row.session_id,
    runId: row.run_id,
    code: row.code,
    message: row.message,
    createdAt: row.created_at,
    ...(row.metadata_json ? { metadata: decodeJson<JsonObject>(row.metadata_json) } : {}),
  };
}
