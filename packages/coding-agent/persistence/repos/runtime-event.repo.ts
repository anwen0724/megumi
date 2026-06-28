// Owns persisted runtime event storage and replay ordering for Coding Agent runs.
import type { MegumiDatabase } from '../connection';
import type { RuntimeEvent } from '@megumi/shared/runtime';

interface RuntimeEventRow {
  event_json: string;
}

export class RuntimeEventRepository {
  constructor(private readonly database: MegumiDatabase) {}

  appendRuntimeEvent(event: RuntimeEvent): RuntimeEvent {
    this.database.prepare(`
      INSERT INTO runtime_events (
        event_id, session_id, run_id, step_id, action_id, observation_id, message_id,
        event_type, sequence, created_at, source, visibility, persist, payload_json, event_json
      ) VALUES (
        @event_id, @session_id, @run_id, @step_id, @action_id, @observation_id, @message_id,
        @event_type, @sequence, @created_at, @source, @visibility, @persist, @payload_json, @event_json
      )
    `).run({
      event_id: event.eventId,
      session_id: event.sessionId ?? null,
      run_id: event.runId ?? null,
      step_id: event.stepId ?? null,
      action_id: event.actionId ?? null,
      observation_id: event.observationId ?? null,
      message_id: event.messageId ?? null,
      event_type: event.eventType,
      sequence: event.sequence,
      created_at: event.createdAt,
      source: event.source,
      visibility: event.visibility,
      persist: event.persist,
      payload_json: stringifyJson(event.payload),
      event_json: stringifyJson(event),
    });

    return event;
  }

  listRuntimeEventsByRun(runId: string): RuntimeEvent[] {
    return (this.database
      .prepare('SELECT event_json FROM runtime_events WHERE run_id = ? ORDER BY sequence ASC')
      .all(runId) as RuntimeEventRow[]).map((row) => JSON.parse(row.event_json) as RuntimeEvent);
  }
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value);
}
