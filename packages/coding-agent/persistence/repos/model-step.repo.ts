// Owns persisted model-call step records and provider trace metadata.
import type { MegumiDatabase } from '../connection';
import type { JsonObject } from '@megumi/shared/primitives';
import type { RuntimeError } from '@megumi/shared/runtime';
import type { RunStep } from '@megumi/shared/session';

type Nullable<T> = T | null;

interface ModelStepRow {
  model_step_id: string;
  run_id: string;
  step_id: Nullable<string>;
  provider_id: string;
  model_id: string;
  status: RunStep['status'];
  started_at: string;
  completed_at: Nullable<string>;
  error_json: Nullable<string>;
  metadata_json: Nullable<string>;
  model_step_json: string;
}

export interface ModelStepRecord {
  modelStepId: string;
  runId: string;
  stepId?: string;
  providerId: string;
  modelId: string;
  status: RunStep['status'];
  startedAt: string;
  completedAt?: string;
  error?: RuntimeError;
  metadata?: JsonObject;
}

export class ModelStepRepository {
  constructor(private readonly database: MegumiDatabase) {}

  saveModelStep(modelStep: ModelStepRecord): ModelStepRecord {
    this.database.prepare(`
      INSERT INTO model_steps (
        model_step_id, run_id, step_id, provider_id, model_id, status,
        started_at, completed_at, error_json, metadata_json, model_step_json
      ) VALUES (
        @model_step_id, @run_id, @step_id, @provider_id, @model_id, @status,
        @started_at, @completed_at, @error_json, @metadata_json, @model_step_json
      )
      ON CONFLICT(model_step_id) DO UPDATE SET
        run_id = excluded.run_id,
        step_id = excluded.step_id,
        provider_id = excluded.provider_id,
        model_id = excluded.model_id,
        status = excluded.status,
        started_at = excluded.started_at,
        completed_at = excluded.completed_at,
        error_json = excluded.error_json,
        metadata_json = excluded.metadata_json,
        model_step_json = excluded.model_step_json
    `).run(toModelStepRow(modelStep));

    return this.getModelStep(modelStep.modelStepId) ?? modelStep;
  }

  getModelStep(modelStepId: string): ModelStepRecord | undefined {
    const row = this.database.prepare('SELECT * FROM model_steps WHERE model_step_id = ?').get(modelStepId) as
      | ModelStepRow
      | undefined;
    return row ? fromModelStepRow(row) : undefined;
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

function toModelStepRow(modelStep: ModelStepRecord): ModelStepRow {
  return {
    model_step_id: modelStep.modelStepId,
    run_id: modelStep.runId,
    step_id: modelStep.stepId ?? null,
    provider_id: modelStep.providerId,
    model_id: modelStep.modelId,
    status: modelStep.status,
    started_at: modelStep.startedAt,
    completed_at: modelStep.completedAt ?? null,
    error_json: modelStep.error ? stringifyJson(modelStep.error) : null,
    metadata_json: modelStep.metadata ? stringifyJson(modelStep.metadata) : null,
    model_step_json: stringifyJson(modelStep),
  };
}

function fromModelStepRow(row: ModelStepRow): ModelStepRecord {
  return {
    modelStepId: row.model_step_id,
    runId: row.run_id,
    ...(row.step_id ? { stepId: row.step_id } : {}),
    providerId: row.provider_id,
    modelId: row.model_id,
    status: row.status,
    startedAt: row.started_at,
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
    ...(row.error_json ? { error: parseJson<RuntimeError>(row.error_json) } : {}),
    ...(row.metadata_json ? { metadata: parseJson<JsonObject>(row.metadata_json) } : {}),
  };
}
