/*
 * Stages provider-neutral Session messages from legacy persisted Runtime
 * Events before destructive migrations run. New runtime code must never call
 * this compatibility projector.
 */
import type { MegumiDatabase } from '../connection';

type LegacyEventRow = {
  event_id: string;
  run_id: string;
  session_id: string;
  event_type: string;
  sequence: number;
  created_at: string;
  payload_json: string;
};

type LegacyMessageRow = {
  message_id: string;
  session_id: string;
  run_id: string | null;
  role: string;
  content_text: string;
  message_json?: string;
  created_at: string;
};

type ModelStep = {
  modelCallId: string;
  order: number;
  createdAt: string;
  thinking: string[];
  text: string[];
  completedContent?: Array<Record<string, unknown>>;
  stopReason?: string;
  toolCalls: Array<{ id: string; name: string; input: unknown; order: number }>;
};

type StagedProjection = {
  role: 'assistant' | 'toolResult';
  sourceId: string;
  message: Record<string, unknown>;
  contentText: string;
  createdAt: string;
  order: number;
  useExistingFinal?: boolean;
};

export function prepareLegacySessionHistoryBackfill(database: MegumiDatabase): void {
  if (!tableExists(database, 'agent_run_runtime_events')) return;
  database.transaction(() => {
    createStagingTable(database);
    database.prepare('DELETE FROM legacy_session_message_staging').run();
    const hasMessageJson = columnExists(database, 'session_messages', 'message_json');
    const messageColumns = hasMessageJson
      ? 'message_id, session_id, run_id, role, content_text, message_json, created_at'
      : 'message_id, session_id, run_id, role, content_text, created_at';
    const runIds = database.prepare(`
      SELECT DISTINCT run_id FROM agent_run_runtime_events ORDER BY run_id
    `).all() as Array<{ run_id: string }>;

    for (const { run_id: runId } of runIds) {
      const messages = database.prepare(`
        SELECT ${messageColumns} FROM session_messages
        WHERE run_id = ? ORDER BY created_at, message_id
      `).all(runId) as LegacyMessageRow[];
      const user = messages.find((message) => message.role === 'user');
      if (!user) continue;
      const userEntry = findMessageEntry(database, user.session_id, user.message_id);
      if (!userEntry) continue;
      const finalAssistant = [...messages].reverse().find((message) => message.role === 'assistant');
      const finalEntry = finalAssistant
        ? findMessageEntry(database, finalAssistant.session_id, finalAssistant.message_id)
        : undefined;
      const events = database.prepare(`
        SELECT event_id, run_id, session_id, event_type, sequence, created_at, payload_json
        FROM agent_run_runtime_events WHERE run_id = ?
        ORDER BY sequence, created_at, event_id
      `).all(runId) as LegacyEventRow[];
      const staged = projectRun(events, finalAssistant?.content_text);
      let parentEntryId = userEntry.entry_id;
      const resolved = staged.flatMap((item) => {
        const existing = item.useExistingFinal && finalAssistant && finalEntry
          ? { message: finalAssistant, entry: finalEntry }
          : findExistingSemanticMessage(database, messages, item);
        const messageId = existing?.message.message_id ?? (item.role === 'assistant'
          ? `legacy:assistant:${runId}:${item.sourceId}`
          : `legacy:tool-result:${runId}:${item.sourceId}`);
        const entryId = existing?.entry.entry_id ?? `legacy:entry:${messageId}`;
        const resolvedItem = { item, messageId, entryId, parentEntryId };
        parentEntryId = entryId;
        return [resolvedItem];
      });
      const finalAlreadyIncluded = Boolean(finalEntry && resolved.some((item) => item.entryId === finalEntry.entry_id));
      for (const [index, resolvedItem] of resolved.entries()) {
        const { item, messageId, entryId } = resolvedItem;
        database.prepare(`
          INSERT INTO legacy_session_message_staging (
            message_id, entry_id, session_id, run_id, role, content_text,
            message_json, parent_entry_id, reparent_entry_id, created_at,
            completed_at, sort_order
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          messageId, entryId, user.session_id, runId, item.role, item.contentText,
          JSON.stringify(item.message), resolvedItem.parentEntryId,
          index === resolved.length - 1 && !finalAlreadyIncluded ? finalEntry?.entry_id ?? null : null,
          item.createdAt, item.createdAt, index,
        );
      }
    }
  })();
}

function projectRun(events: LegacyEventRow[], existingFinalText?: string): StagedProjection[] {
  const steps = new Map<string, ModelStep>();
  const results = new Map<string, { toolName: string; status: 'success' | 'failure'; content: unknown[]; createdAt: string; order: number }>();
  for (const event of events) {
    const payload = parsePayload(event);
    if (event.event_type === 'model_call.started') {
      const id = requiredString(payload, 'modelCallId', event);
      step(steps, id, event);
    } else if (event.event_type === 'model_call.text_delta') {
      const id = requiredString(payload, 'modelCallId', event);
      step(steps, id, event).text.push(requiredString(payload, 'delta', event));
    } else if (event.event_type === 'model.thinking.delta') {
      const id = requiredString(payload, 'modelStepId', event);
      step(steps, id, event).thinking.push(requiredString(payload, 'delta', event));
    } else if (event.event_type === 'model_call.tool_call') {
      const id = requiredString(payload, 'modelCallId', event);
      step(steps, id, event).toolCalls.push({
        id: requiredString(payload, 'toolCallId', event),
        name: requiredString(payload, 'toolName', event),
        input: payload.input ?? null,
        order: event.sequence,
      });
    } else if (event.event_type === 'model_call.completed') {
      const id = requiredString(payload, 'modelCallId', event);
      const current = step(steps, id, event);
      current.completedContent = Array.isArray(payload.content)
        ? payload.content as Array<Record<string, unknown>>
        : [];
      if (typeof payload.finishReason === 'string') current.stopReason = payload.finishReason;
    } else if (event.event_type === 'tool_result.created') {
      const toolCallId = requiredString(payload, 'toolCallId', event);
      results.set(toolCallId, {
        toolName: requiredString(payload, 'toolName', event),
        status: payload.kind === 'success' ? 'success' : 'failure',
        content: Array.isArray(payload.content) ? payload.content : [],
        createdAt: event.created_at,
        order: event.sequence,
      });
    }
  }

  const output: StagedProjection[] = [];
  const usedResultIds = new Set<string>();
  const orderedSteps = [...steps.values()].sort((left, right) => left.order - right.order);
  for (const [stepIndex, current] of orderedSteps.entries()) {
    const content: Array<Record<string, unknown>> = [];
    if (current.thinking.length > 0) content.push({ type: 'thinking', thinking: current.thinking.join('') });
    const completedText = textOfContent(current.completedContent ?? []);
    const streamedText = current.text.join('');
    const text = completedText || streamedText;
    if (text) content.push({ type: 'text', text });
    for (const call of current.toolCalls.sort((left, right) => left.order - right.order)) {
      content.push({ type: 'toolCall', id: call.id, name: call.name, argumentsText: JSON.stringify(call.input) });
    }
    const useExistingFinal = stepIndex === orderedSteps.length - 1
      && current.toolCalls.length === 0
      && existingFinalText !== undefined
      && text === existingFinalText;
    if (content.length > 0) {
      output.push({
        role: 'assistant',
        sourceId: current.modelCallId,
        message: {
          role: 'assistant', content,
          ...(current.stopReason ? { stopReason: current.stopReason } : {}),
        },
        contentText: text,
        createdAt: current.createdAt,
        order: current.order,
        ...(useExistingFinal ? { useExistingFinal: true } : {}),
      });
    }
    for (const [callIndex, call] of current.toolCalls.sort((left, right) => left.order - right.order).entries()) {
      const result = results.get(call.id);
      if (!result) continue;
      usedResultIds.add(call.id);
      output.push({
        role: 'toolResult', sourceId: call.id,
        message: {
          role: 'toolResult', toolCallId: call.id, toolName: result.toolName,
          status: result.status, content: result.content,
        },
        contentText: textOfContent(result.content),
        createdAt: result.createdAt,
        order: current.order + ((callIndex + 1) / 1000),
      });
    }
  }
  for (const [toolCallId, result] of [...results.entries()].sort((left, right) => left[1].order - right[1].order)) {
    if (usedResultIds.has(toolCallId)) continue;
    output.push({
      role: 'toolResult',
      sourceId: toolCallId,
      message: {
        role: 'toolResult', toolCallId, toolName: result.toolName,
        status: result.status, content: result.content,
      },
      contentText: textOfContent(result.content),
      createdAt: result.createdAt,
      order: result.order,
    });
  }
  return output.sort((left, right) => left.order - right.order || left.sourceId.localeCompare(right.sourceId));
}

function step(steps: Map<string, ModelStep>, modelCallId: string, event: LegacyEventRow): ModelStep {
  const existing = steps.get(modelCallId);
  if (existing) return existing;
  const created: ModelStep = {
    modelCallId, order: event.sequence, createdAt: event.created_at,
    thinking: [], text: [], toolCalls: [],
  };
  steps.set(modelCallId, created);
  return created;
}

function parsePayload(event: LegacyEventRow): Record<string, unknown> {
  const parsed = JSON.parse(event.payload_json) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Legacy Runtime Event ${event.event_id} payload is not an object.`);
  }
  return parsed as Record<string, unknown>;
}

function requiredString(payload: Record<string, unknown>, key: string, event: LegacyEventRow): string {
  const value = payload[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Legacy Runtime Event ${event.event_id} is missing ${key}.`);
  }
  return value;
}

function textOfContent(content: unknown[]): string {
  return content.flatMap((block) => {
    if (!block || typeof block !== 'object' || Array.isArray(block)) return [];
    const value = block as Record<string, unknown>;
    return value.type === 'text' && typeof value.text === 'string' ? [value.text] : [];
  }).join('');
}

function findExistingSemanticMessage(
  database: MegumiDatabase,
  messages: LegacyMessageRow[],
  item: StagedProjection,
): { message: LegacyMessageRow; entry: { entry_id: string } } | undefined {
  const matched = messages.find((message) => {
    if (!message.message_json || message.role !== item.role) return false;
    const parsed = JSON.parse(message.message_json) as Record<string, unknown>;
    if (item.role === 'toolResult') return parsed.toolCallId === item.sourceId;
    const projectedCalls = toolCallIds(item.message);
    const existingCalls = toolCallIds(parsed);
    return projectedCalls.length > 0
      ? projectedCalls.length === existingCalls.length
        && projectedCalls.every((id, index) => id === existingCalls[index])
      : message.content_text === item.contentText;
  });
  if (!matched) return undefined;
  const entry = findMessageEntry(database, matched.session_id, matched.message_id);
  return entry ? { message: matched, entry } : undefined;
}

function toolCallIds(message: Record<string, unknown>): string[] {
  return Array.isArray(message.content)
    ? message.content.flatMap((block) => {
        if (!block || typeof block !== 'object' || Array.isArray(block)) return [];
        const value = block as Record<string, unknown>;
        return value.type === 'toolCall' && typeof value.id === 'string' ? [value.id] : [];
      })
    : [];
}

function findMessageEntry(database: MegumiDatabase, sessionId: string, messageId: string): { entry_id: string } | undefined {
  return database.prepare(`
    SELECT entry_id FROM session_entries WHERE session_id = ? AND message_id = ?
    ORDER BY created_at, entry_id LIMIT 1
  `).get(sessionId, messageId) as { entry_id: string } | undefined;
}

function createStagingTable(database: MegumiDatabase): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS legacy_session_message_staging (
      message_id text PRIMARY KEY NOT NULL,
      entry_id text NOT NULL UNIQUE,
      session_id text NOT NULL,
      run_id text NOT NULL,
      role text NOT NULL,
      content_text text NOT NULL,
      message_json text NOT NULL,
      parent_entry_id text,
      reparent_entry_id text,
      created_at text NOT NULL,
      completed_at text,
      sort_order integer NOT NULL
    )
  `);
}

function tableExists(database: MegumiDatabase, table: string): boolean {
  return Boolean(database.prepare(`
    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?
  `).get(table));
}

function columnExists(database: MegumiDatabase, table: string, column: string): boolean {
  return (database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
    .some((item) => item.name === column);
}
