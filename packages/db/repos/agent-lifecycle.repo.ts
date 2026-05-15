import type { MegumiDatabase } from '../connection';
import type {
  AgentAction,
  AgentObservation,
  AgentRun,
  AgentSession,
  AgentStep,
  Message,
} from '@megumi/shared/agent-lifecycle-contracts';
import type { JsonObject } from '@megumi/shared/json';
import type { RuntimeError } from '@megumi/shared/runtime-errors';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';

type Nullable<T> = T | null;

interface SessionRow {
  session_id: string;
  title: string;
  workspace_id: Nullable<string>;
  workspace_path: Nullable<string>;
  status: AgentSession['status'];
  created_at: string;
  updated_at: string;
  archived_at: Nullable<string>;
  summary: Nullable<string>;
  metadata_json: Nullable<string>;
}

interface MessageRow {
  message_id: string;
  session_id: string;
  run_id: Nullable<string>;
  role: Message['role'];
  content: string;
  status: Message['status'];
  created_at: string;
  completed_at: Nullable<string>;
  metadata_json: Nullable<string>;
}

interface RunRow {
  run_id: string;
  session_id: string;
  trigger_message_id: Nullable<string>;
  agent_definition_id: Nullable<string>;
  agent_config_snapshot_ref: Nullable<string>;
  mode: string;
  mode_snapshot_ref: Nullable<string>;
  goal: string;
  status: AgentRun['status'];
  created_at: string;
  started_at: Nullable<string>;
  completed_at: Nullable<string>;
  cancelled_at: Nullable<string>;
  error_json: Nullable<string>;
  source_plan_id: Nullable<string>;
  policy_snapshot_ref: Nullable<string>;
  metadata_json: Nullable<string>;
}

interface StepRow {
  step_id: string;
  run_id: string;
  parent_step_id: Nullable<string>;
  kind: AgentStep['kind'];
  status: AgentStep['status'];
  title: Nullable<string>;
  started_at: Nullable<string>;
  completed_at: Nullable<string>;
  error_json: Nullable<string>;
  metadata_json: Nullable<string>;
}

interface ActionRow {
  action_id: string;
  run_id: string;
  step_id: string;
  kind: AgentAction['kind'];
  status: AgentAction['status'];
  requested_at: string;
  completed_at: Nullable<string>;
  input_preview_json: Nullable<string>;
  error_json: Nullable<string>;
  metadata_json: Nullable<string>;
}

interface ObservationRow {
  observation_id: string;
  run_id: string;
  step_id: Nullable<string>;
  action_id: Nullable<string>;
  source: AgentObservation['source'];
  kind: string;
  received_at: string;
  summary: Nullable<string>;
  data_ref: Nullable<string>;
  error_json: Nullable<string>;
  metadata_json: Nullable<string>;
}

interface RuntimeEventRow {
  event_json: string;
}

export class AgentLifecycleRepository {
  constructor(private readonly database: MegumiDatabase) {}

  saveSession(session: AgentSession): AgentSession {
    this.database.prepare(`
      INSERT INTO agent_sessions (
        session_id, title, workspace_id, workspace_path, status, created_at, updated_at,
        archived_at, summary, metadata_json
      ) VALUES (
        @session_id, @title, @workspace_id, @workspace_path, @status, @created_at, @updated_at,
        @archived_at, @summary, @metadata_json
      )
      ON CONFLICT(session_id) DO UPDATE SET
        title = excluded.title,
        workspace_id = excluded.workspace_id,
        workspace_path = excluded.workspace_path,
        status = excluded.status,
        updated_at = excluded.updated_at,
        archived_at = excluded.archived_at,
        summary = excluded.summary,
        metadata_json = excluded.metadata_json
    `).run(toSessionRow(session));

    return this.getSession(session.sessionId) ?? session;
  }

  getSession(sessionId: string): AgentSession | undefined {
    const row = this.database.prepare('SELECT * FROM agent_sessions WHERE session_id = ?').get(sessionId) as
      | SessionRow
      | undefined;
    return row ? fromSessionRow(row) : undefined;
  }

  saveMessage(message: Message): Message {
    this.database.prepare(`
      INSERT INTO messages (
        message_id, session_id, run_id, role, content, status, created_at, completed_at, metadata_json
      ) VALUES (
        @message_id, @session_id, @run_id, @role, @content, @status, @created_at, @completed_at, @metadata_json
      )
      ON CONFLICT(message_id) DO UPDATE SET
        run_id = excluded.run_id,
        content = excluded.content,
        status = excluded.status,
        completed_at = excluded.completed_at,
        metadata_json = excluded.metadata_json
    `).run(toMessageRow(message));

    return message;
  }

  listMessagesBySession(sessionId: string): Message[] {
    return (this.database
      .prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC')
      .all(sessionId) as MessageRow[]).map(fromMessageRow);
  }

  saveRun(run: AgentRun): AgentRun {
    this.database.prepare(`
      INSERT INTO agent_runs (
        run_id, session_id, trigger_message_id, agent_definition_id, agent_config_snapshot_ref,
        mode, mode_snapshot_ref, goal, status, created_at, started_at, completed_at,
        cancelled_at, error_json, source_plan_id, policy_snapshot_ref, metadata_json
      ) VALUES (
        @run_id, @session_id, @trigger_message_id, @agent_definition_id, @agent_config_snapshot_ref,
        @mode, @mode_snapshot_ref, @goal, @status, @created_at, @started_at, @completed_at,
        @cancelled_at, @error_json, @source_plan_id, @policy_snapshot_ref, @metadata_json
      )
      ON CONFLICT(run_id) DO UPDATE SET
        status = excluded.status,
        started_at = excluded.started_at,
        completed_at = excluded.completed_at,
        cancelled_at = excluded.cancelled_at,
        error_json = excluded.error_json,
        metadata_json = excluded.metadata_json
    `).run(toRunRow(run));

    return this.getRun(run.runId) ?? run;
  }

  getRun(runId: string): AgentRun | undefined {
    const row = this.database.prepare('SELECT * FROM agent_runs WHERE run_id = ?').get(runId) as RunRow | undefined;
    return row ? fromRunRow(row) : undefined;
  }

  saveStep(step: AgentStep): AgentStep {
    this.database.prepare(`
      INSERT INTO agent_steps (
        step_id, run_id, parent_step_id, kind, status, title, started_at, completed_at, error_json, metadata_json
      ) VALUES (
        @step_id, @run_id, @parent_step_id, @kind, @status, @title, @started_at, @completed_at, @error_json, @metadata_json
      )
      ON CONFLICT(step_id) DO UPDATE SET
        status = excluded.status,
        title = excluded.title,
        started_at = excluded.started_at,
        completed_at = excluded.completed_at,
        error_json = excluded.error_json,
        metadata_json = excluded.metadata_json
    `).run(toStepRow(step));

    return step;
  }

  listStepsByRun(runId: string): AgentStep[] {
    return (this.database
      .prepare('SELECT * FROM agent_steps WHERE run_id = ? ORDER BY started_at ASC, step_id ASC')
      .all(runId) as StepRow[]).map(fromStepRow);
  }

  saveAction(action: AgentAction): AgentAction {
    this.database.prepare(`
      INSERT INTO agent_actions (
        action_id, run_id, step_id, kind, status, requested_at, completed_at, input_preview_json, error_json, metadata_json
      ) VALUES (
        @action_id, @run_id, @step_id, @kind, @status, @requested_at, @completed_at, @input_preview_json, @error_json, @metadata_json
      )
      ON CONFLICT(action_id) DO UPDATE SET
        status = excluded.status,
        completed_at = excluded.completed_at,
        error_json = excluded.error_json,
        metadata_json = excluded.metadata_json
    `).run(toActionRow(action));

    return action;
  }

  listActionsByRun(runId: string): AgentAction[] {
    return (this.database
      .prepare('SELECT * FROM agent_actions WHERE run_id = ? ORDER BY requested_at ASC')
      .all(runId) as ActionRow[]).map(fromActionRow);
  }

  saveObservation(observation: AgentObservation): AgentObservation {
    this.database.prepare(`
      INSERT INTO agent_observations (
        observation_id, run_id, step_id, action_id, source, kind, received_at, summary, data_ref, error_json, metadata_json
      ) VALUES (
        @observation_id, @run_id, @step_id, @action_id, @source, @kind, @received_at, @summary, @data_ref, @error_json, @metadata_json
      )
      ON CONFLICT(observation_id) DO UPDATE SET
        summary = excluded.summary,
        data_ref = excluded.data_ref,
        error_json = excluded.error_json,
        metadata_json = excluded.metadata_json
    `).run(toObservationRow(observation));

    return observation;
  }

  listObservationsByRun(runId: string): AgentObservation[] {
    return (this.database
      .prepare('SELECT * FROM agent_observations WHERE run_id = ? ORDER BY received_at ASC')
      .all(runId) as ObservationRow[]).map(fromObservationRow);
  }

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

function parseJson<T>(value: string | null): T | undefined;
function parseJson<T>(value: string): T;
function parseJson<T>(value: string | null): T | undefined {
  return value ? JSON.parse(value) as T : undefined;
}

function toSessionRow(session: AgentSession): SessionRow {
  return {
    session_id: session.sessionId,
    title: session.title,
    workspace_id: session.workspaceId ?? null,
    workspace_path: session.workspacePath ?? null,
    status: session.status,
    created_at: session.createdAt,
    updated_at: session.updatedAt,
    archived_at: session.archivedAt ?? null,
    summary: session.summary ?? null,
    metadata_json: session.metadata ? stringifyJson(session.metadata) : null,
  };
}

function fromSessionRow(row: SessionRow): AgentSession {
  return {
    sessionId: row.session_id,
    title: row.title,
    ...(row.workspace_id ? { workspaceId: row.workspace_id } : {}),
    ...(row.workspace_path ? { workspacePath: row.workspace_path } : {}),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.archived_at ? { archivedAt: row.archived_at } : {}),
    ...(row.summary ? { summary: row.summary } : {}),
    ...(row.metadata_json ? { metadata: parseJson<JsonObject>(row.metadata_json) } : {}),
  };
}

function toMessageRow(message: Message): MessageRow {
  return {
    message_id: message.messageId,
    session_id: message.sessionId,
    run_id: message.runId ?? null,
    role: message.role,
    content: message.content,
    status: message.status,
    created_at: message.createdAt,
    completed_at: message.completedAt ?? null,
    metadata_json: message.metadata ? stringifyJson(message.metadata) : null,
  };
}

function fromMessageRow(row: MessageRow): Message {
  return {
    messageId: row.message_id,
    sessionId: row.session_id,
    ...(row.run_id ? { runId: row.run_id } : {}),
    role: row.role,
    content: row.content,
    status: row.status,
    createdAt: row.created_at,
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
    ...(row.metadata_json ? { metadata: parseJson<JsonObject>(row.metadata_json) } : {}),
  };
}

function toRunRow(run: AgentRun): RunRow {
  return {
    run_id: run.runId,
    session_id: run.sessionId,
    trigger_message_id: run.triggerMessageId ?? null,
    agent_definition_id: run.agentDefinitionId ?? null,
    agent_config_snapshot_ref: run.agentConfigSnapshotRef ?? null,
    mode: run.mode,
    mode_snapshot_ref: run.modeSnapshotRef ?? null,
    goal: run.goal,
    status: run.status,
    created_at: run.createdAt,
    started_at: run.startedAt ?? null,
    completed_at: run.completedAt ?? null,
    cancelled_at: run.cancelledAt ?? null,
    error_json: run.error ? stringifyJson(run.error) : null,
    source_plan_id: run.sourcePlanId ?? null,
    policy_snapshot_ref: run.policySnapshotRef ?? null,
    metadata_json: run.metadata ? stringifyJson(run.metadata) : null,
  };
}

function fromRunRow(row: RunRow): AgentRun {
  return {
    runId: row.run_id,
    sessionId: row.session_id,
    ...(row.trigger_message_id ? { triggerMessageId: row.trigger_message_id } : {}),
    ...(row.agent_definition_id ? { agentDefinitionId: row.agent_definition_id } : {}),
    ...(row.agent_config_snapshot_ref ? { agentConfigSnapshotRef: row.agent_config_snapshot_ref } : {}),
    mode: row.mode,
    ...(row.mode_snapshot_ref ? { modeSnapshotRef: row.mode_snapshot_ref } : {}),
    goal: row.goal,
    status: row.status,
    createdAt: row.created_at,
    ...(row.started_at ? { startedAt: row.started_at } : {}),
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
    ...(row.cancelled_at ? { cancelledAt: row.cancelled_at } : {}),
    ...(row.error_json ? { error: parseJson<RuntimeError>(row.error_json) } : {}),
    ...(row.source_plan_id ? { sourcePlanId: row.source_plan_id } : {}),
    ...(row.policy_snapshot_ref ? { policySnapshotRef: row.policy_snapshot_ref } : {}),
    ...(row.metadata_json ? { metadata: parseJson<JsonObject>(row.metadata_json) } : {}),
  };
}

function toStepRow(step: AgentStep): StepRow {
  return {
    step_id: step.stepId,
    run_id: step.runId,
    parent_step_id: step.parentStepId ?? null,
    kind: step.kind,
    status: step.status,
    title: step.title ?? null,
    started_at: step.startedAt ?? null,
    completed_at: step.completedAt ?? null,
    error_json: step.error ? stringifyJson(step.error) : null,
    metadata_json: step.metadata ? stringifyJson(step.metadata) : null,
  };
}

function fromStepRow(row: StepRow): AgentStep {
  return {
    stepId: row.step_id,
    runId: row.run_id,
    ...(row.parent_step_id ? { parentStepId: row.parent_step_id } : {}),
    kind: row.kind,
    status: row.status,
    ...(row.title ? { title: row.title } : {}),
    ...(row.started_at ? { startedAt: row.started_at } : {}),
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
    ...(row.error_json ? { error: parseJson<RuntimeError>(row.error_json) } : {}),
    ...(row.metadata_json ? { metadata: parseJson<JsonObject>(row.metadata_json) } : {}),
  };
}

function toActionRow(action: AgentAction): ActionRow {
  return {
    action_id: action.actionId,
    run_id: action.runId,
    step_id: action.stepId,
    kind: action.kind,
    status: action.status,
    requested_at: action.requestedAt,
    completed_at: action.completedAt ?? null,
    input_preview_json: action.inputPreview ? stringifyJson(action.inputPreview) : null,
    error_json: action.error ? stringifyJson(action.error) : null,
    metadata_json: action.metadata ? stringifyJson(action.metadata) : null,
  };
}

function fromActionRow(row: ActionRow): AgentAction {
  return {
    actionId: row.action_id,
    runId: row.run_id,
    stepId: row.step_id,
    kind: row.kind,
    status: row.status,
    requestedAt: row.requested_at,
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
    ...(row.input_preview_json ? { inputPreview: parseJson<JsonObject>(row.input_preview_json) } : {}),
    ...(row.error_json ? { error: parseJson<RuntimeError>(row.error_json) } : {}),
    ...(row.metadata_json ? { metadata: parseJson<JsonObject>(row.metadata_json) } : {}),
  };
}

function toObservationRow(observation: AgentObservation): ObservationRow {
  return {
    observation_id: observation.observationId,
    run_id: observation.runId,
    step_id: observation.stepId ?? null,
    action_id: observation.actionId ?? null,
    source: observation.source,
    kind: observation.kind,
    received_at: observation.receivedAt,
    summary: observation.summary ?? null,
    data_ref: observation.dataRef ?? null,
    error_json: observation.error ? stringifyJson(observation.error) : null,
    metadata_json: observation.metadata ? stringifyJson(observation.metadata) : null,
  };
}

function fromObservationRow(row: ObservationRow): AgentObservation {
  return {
    observationId: row.observation_id,
    runId: row.run_id,
    ...(row.step_id ? { stepId: row.step_id } : {}),
    ...(row.action_id ? { actionId: row.action_id } : {}),
    source: row.source,
    kind: row.kind,
    receivedAt: row.received_at,
    ...(row.summary ? { summary: row.summary } : {}),
    ...(row.data_ref ? { dataRef: row.data_ref } : {}),
    ...(row.error_json ? { error: parseJson<RuntimeError>(row.error_json) } : {}),
    ...(row.metadata_json ? { metadata: parseJson<JsonObject>(row.metadata_json) } : {}),
  };
}
