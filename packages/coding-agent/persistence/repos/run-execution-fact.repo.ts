// Owns persisted run execution facts: steps, actions, and observations.
import type { MegumiDatabase } from '../connection';
import type { JsonObject } from '@megumi/shared/primitives';
import type { RuntimeError } from '@megumi/shared/runtime';
import type { RunAction, RunObservation, RunStep } from '@megumi/shared/session';

type Nullable<T> = T | null;

interface StepRow {
  step_id: string;
  run_id: string;
  parent_step_id: Nullable<string>;
  kind: RunStep['kind'];
  status: RunStep['status'];
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
  kind: RunAction['kind'];
  status: RunAction['status'];
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
  source: RunObservation['source'];
  kind: string;
  received_at: string;
  summary: Nullable<string>;
  data_ref: Nullable<string>;
  error_json: Nullable<string>;
  metadata_json: Nullable<string>;
}

export class RunExecutionFactRepository {
  constructor(private readonly database: MegumiDatabase) {}

  saveStep(step: RunStep): RunStep {
    this.database.prepare(`
      INSERT INTO run_steps (
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

  listStepsByRun(runId: string): RunStep[] {
    return (this.database
      .prepare('SELECT * FROM run_steps WHERE run_id = ? ORDER BY started_at ASC, step_id ASC')
      .all(runId) as StepRow[]).map(fromStepRow);
  }

  saveAction(action: RunAction): RunAction {
    this.database.prepare(`
      INSERT INTO run_actions (
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

  listActionsByRun(runId: string): RunAction[] {
    return (this.database
      .prepare('SELECT * FROM run_actions WHERE run_id = ? ORDER BY requested_at ASC')
      .all(runId) as ActionRow[]).map(fromActionRow);
  }

  saveObservation(observation: RunObservation): RunObservation {
    this.database.prepare(`
      INSERT INTO run_observations (
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

  listObservationsByRun(runId: string): RunObservation[] {
    return (this.database
      .prepare('SELECT * FROM run_observations WHERE run_id = ? ORDER BY received_at ASC')
      .all(runId) as ObservationRow[]).map(fromObservationRow);
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

function toStepRow(step: RunStep): StepRow {
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

function fromStepRow(row: StepRow): RunStep {
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

function toActionRow(action: RunAction): ActionRow {
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

function fromActionRow(row: ActionRow): RunAction {
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

function toObservationRow(observation: RunObservation): ObservationRow {
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

function fromObservationRow(row: ObservationRow): RunObservation {
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
