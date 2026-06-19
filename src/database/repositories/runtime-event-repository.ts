// Persists AgentRuntimeEvent history for run hydration without acting as the live event bus.
import type { AgentRuntimeEvent } from '../../app';
import type { JsonObject } from '../../shared';
import type { SqliteDatabase } from '../connection';
import { decodeJson, encodeJson } from '../json';

export interface RuntimeEventRecord extends AgentRuntimeEvent {
  eventId: string;
  sequence: number;
}

interface RuntimeEventRow {
  id: string;
  run_id: string;
  session_id: string | null;
  workspace_id: string | null;
  type: string;
  sequence: number;
  occurred_at: string;
  payload_json: string | null;
  event_json: string;
}

export class SqliteRuntimeEventRepository {
  constructor(private readonly database: SqliteDatabase) {}

  saveEvent(event: AgentRuntimeEvent): RuntimeEventRecord | undefined {
    if (!event.runId) return undefined;
    const sequence = this.nextSequence(event.runId);
    const eventId = `runtime-event:${event.runId}:${sequence}`;
    const record: RuntimeEventRecord = { ...event, eventId, sequence };
    this.database.prepare(`
      INSERT INTO runtime_events (
        id, run_id, session_id, workspace_id, type, sequence, occurred_at, payload_json, event_json
      ) VALUES (
        @id, @runId, @sessionId, @workspaceId, @type, @sequence, @occurredAt, @payloadJson, @eventJson
      )
    `).run({
      id: eventId,
      runId: event.runId,
      sessionId: event.sessionId ?? null,
      workspaceId: event.workspaceId ?? null,
      type: event.type,
      sequence,
      occurredAt: event.occurredAt,
      payloadJson: encodeJson(event.payload),
      eventJson: JSON.stringify(record),
    });
    return record;
  }

  listEventsByRun(runId: string): RuntimeEventRecord[] {
    return (this.database
      .prepare('SELECT * FROM runtime_events WHERE run_id = ? ORDER BY sequence ASC')
      .all(runId) as RuntimeEventRow[]).map(mapRuntimeEventRow);
  }

  private nextSequence(runId: string): number {
    const row = this.database
      .prepare('SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM runtime_events WHERE run_id = ?')
      .get(runId) as { next_sequence: number } | undefined;
    return row?.next_sequence ?? 1;
  }
}

function mapRuntimeEventRow(row: RuntimeEventRow): RuntimeEventRecord {
  const parsed = decodeJson<RuntimeEventRecord>(row.event_json);
  if (parsed) return parsed;
  return {
    eventId: row.id,
    sequence: row.sequence,
    type: row.type,
    runId: row.run_id,
    ...(row.session_id ? { sessionId: row.session_id } : {}),
    ...(row.workspace_id ? { workspaceId: row.workspace_id } : {}),
    occurredAt: row.occurred_at,
    payload: decodeJson<JsonObject>(row.payload_json) ?? {},
  };
}
