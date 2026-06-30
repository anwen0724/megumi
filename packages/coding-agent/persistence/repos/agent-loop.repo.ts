// Aggregates persistence repository implementations for the spec-aligned database redesign.

import type { MegumiDatabase } from '../connection';

import type { JsonObject } from '@megumi/shared/primitives';

import type { RuntimeError, RuntimeEvent } from '@megumi/shared/runtime';

import type { ModelStepRuntimeRequest } from '@megumi/shared/model';

import type {
  Run,
  RunAction,
  RunObservation,
  RunStep,
  Session,
  SessionBranchMarker,
  SessionCompactionEntry,
  SessionMessage,
  SessionInterruptedRunMarker,
  SessionInterruptedRunPreviousStatus,
  SessionInterruptedRunReason,
} from '@megumi/shared/session';

import {
  SessionInterruptedRunMarkerSchema,
} from '@megumi/shared/session';

import type {
  ContextPatch,
  RunContext,
  RunContextBuild,
  RunContextSource,
} from '@megumi/shared/run';

import type {
  CancelRequest,
  Checkpoint,
  CheckpointRestoreRecord,
  CheckpointStatus,
  RecoverableRunReason,
  RecoverableRunSummary,
  ResumeRequest,
  RetryRequest,
} from '@megumi/shared/recovery';

import { RecoverableRunSummarySchema } from '@megumi/shared/recovery';

import type {
  ImplementationPlanArtifactRecord,
  ImplementationPlanArtifactStatus,
  PermissionSnapshotRecord,
  RunSourcePlanRelation,
} from '@megumi/shared/permission';

import { TimelineMessageSchema, type TimelineMessage } from '@megumi/shared/timeline';
import type { ToolRegistrySnapshot } from '@megumi/shared/tool';



namespace NewSchemaCompat {
// Shared compatibility helpers while repositories are moved onto the Drizzle schema.

const defaultWorkspaceId = 'workspace:default';

export function ensureWorkspace(
  database: MegumiDatabase,
  input: { workspaceId?: string | null; workspacePath?: string | null; now: string },
): string {
  const workspaceId = input.workspaceId ?? defaultWorkspaceId;
  const existing = database.prepare('SELECT workspace_id FROM workspaces WHERE workspace_id = ?')
    .get(workspaceId) as { workspace_id: string } | undefined;
  if (!existing) {
    throw new Error(`Workspace ${workspaceId} must be created before agent loop persistence.`);
  }

  return workspaceId;
}

export function defaultBranchIdForSession(sessionId: string): string {
  return `${sessionId}:branch:default`;
}

export function ensureSessionDefaultBranch(
  database: MegumiDatabase,
  input: { sessionId: string; now: string },
): string {
  const session = database.prepare(`
    SELECT session_id
    FROM sessions
    WHERE session_id = ?
  `).get(input.sessionId) as
    | { session_id: string }
    | undefined;

  if (!session) {
    throw new Error(`Session ${input.sessionId} does not exist`);
  }

  return session.session_id;
}

export function activeBranchIdForSession(database: MegumiDatabase, sessionId: string, now: string): string {
  return ensureSessionDefaultBranch(database, { sessionId, now });
}

export function appendPathNode(
  database: MegumiDatabase,
  input: {
    pathNodeId: string;
    sessionId: string;
    branchId: string;
    parentPathNodeId?: string | null;
    sourceKind: string;
    sourceId: string;
    createdAt: string;
    metadataJson?: string | null;
  },
): void {
  const session = database.prepare('SELECT session_id FROM sessions WHERE session_id = ?')
    .get(input.sessionId) as { session_id: string } | undefined;
  if (!session) {
    throw new Error(`Session ${input.sessionId} does not exist.`);
  }
}
}



const ensureWorkspace = NewSchemaCompat.ensureWorkspace;

const defaultBranchIdForSession = NewSchemaCompat.defaultBranchIdForSession;

const ensureSessionDefaultBranch = NewSchemaCompat.ensureSessionDefaultBranch;

const activeBranchIdForSession = NewSchemaCompat.activeBranchIdForSession;

const appendPathNode = NewSchemaCompat.appendPathNode;

namespace AgentLoopRepositoryParts {
// Compatibility repository for persisted Coding Agent run records on the agent_loop_runs table.

type Nullable<T> = T | null;

interface RunRow {
  run_id: string;
  workspace_id: string;
  session_id: string;
  run_kind: string;
  user_message_id: Nullable<string>;
  assistant_message_id: Nullable<string>;
  attempt_number: number;
  status: Run['status'];
  permission_mode: string;
  permission_snapshot_json: Nullable<string>;
  started_at: Nullable<string>;
  completed_at: Nullable<string>;
  cancelled_at: Nullable<string>;
  error_json: Nullable<string>;
  created_at: string;
  metadata_json: Nullable<string>;
}

export class AgentLoopRunRecordMethods {
  constructor(private readonly database: MegumiDatabase) {}

  saveRun(run: Run): Run {
    ensureSessionDefaultBranch(this.database, { sessionId: run.sessionId, now: run.createdAt });
    const row = toRunRow(this.database, run);

    this.database.transaction(() => {
      this.database.prepare(`
        INSERT INTO agent_loop_runs (
          run_id, workspace_id, session_id, run_kind, user_message_id, assistant_message_id,
          base_run_id, base_message_id, base_entry_id, attempt_number, status, permission_mode,
          permission_snapshot_json, memory_recall_trace_id, started_at, completed_at, cancelled_at,
          error_json, created_at, metadata_json
        ) VALUES (
          @run_id, @workspace_id, @session_id, @run_kind, @user_message_id, @assistant_message_id,
          NULL, NULL, NULL, @attempt_number, @status, @permission_mode,
          @permission_snapshot_json, NULL, @started_at, @completed_at, @cancelled_at,
          @error_json, @created_at, @metadata_json
        )
        ON CONFLICT(run_id) DO UPDATE SET
          user_message_id = excluded.user_message_id,
          status = excluded.status,
          permission_mode = excluded.permission_mode,
          permission_snapshot_json = COALESCE(agent_loop_runs.permission_snapshot_json, excluded.permission_snapshot_json),
          started_at = excluded.started_at,
          completed_at = excluded.completed_at,
          cancelled_at = excluded.cancelled_at,
          error_json = excluded.error_json,
          metadata_json = excluded.metadata_json
      `).run(row);
    })();

    return this.getRun(run.runId) ?? run;
  }

  getRun(runId: string): Run | undefined {
    const row = this.database
      .prepare('SELECT * FROM agent_loop_runs WHERE run_id = ?')
      .get(runId) as RunRow | undefined;
    return row ? fromRunRow(row) : undefined;
  }

  listRunsBySession(sessionId: string): Run[] {
    return (this.database
      .prepare('SELECT * FROM agent_loop_runs WHERE session_id = ? ORDER BY created_at ASC, run_id ASC')
      .all(sessionId) as RunRow[]).map(fromRunRow);
  }

  listRunsByStatuses(statuses: Run['status'][]): Run[] {
    if (statuses.length === 0) {
      return [];
    }

    const placeholders = statuses.map(() => '?').join(', ');
    return (this.database
      .prepare(`
        SELECT *
        FROM agent_loop_runs
        WHERE status IN (${placeholders})
        ORDER BY created_at ASC, run_id ASC
      `)
      .all(...statuses) as RunRow[]).map(fromRunRow);
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

function workspaceIdForSession(database: MegumiDatabase, sessionId: string): string {
  const row = database
    .prepare('SELECT workspace_id FROM sessions WHERE session_id = ?')
    .get(sessionId) as { workspace_id: string } | undefined;
  if (!row) {
    throw new Error(`Session ${sessionId} does not exist`);
  }
  return row.workspace_id;
}

function toRunRow(database: MegumiDatabase, run: Run): RunRow {
  const metadata = {
    ...(run.metadata ?? {}),
    goal: run.goal,
    ...(run.agentDefinitionId ? { agentDefinitionId: run.agentDefinitionId } : {}),
    ...(run.agentConfigSnapshotRef ? { agentConfigSnapshotRef: run.agentConfigSnapshotRef } : {}),
    ...(run.sourcePlanId ? { sourcePlanId: run.sourcePlanId } : {}),
    ...(run.policySnapshotRef ? { policySnapshotRef: run.policySnapshotRef } : {}),
  };

  return {
    run_id: run.runId,
    workspace_id: workspaceIdForSession(database, run.sessionId),
    session_id: run.sessionId,
    run_kind: 'normal',
    user_message_id: run.triggerMessageId ?? null,
    assistant_message_id: null,
    attempt_number: 1,
    status: run.status,
    permission_mode: run.mode,
    permission_snapshot_json: run.permissionSnapshotRef ? stringifyJson({ ref: run.permissionSnapshotRef }) : null,
    started_at: run.startedAt ?? null,
    completed_at: run.completedAt ?? null,
    cancelled_at: run.cancelledAt ?? null,
    error_json: run.error ? stringifyJson(run.error) : null,
    created_at: run.createdAt,
    metadata_json: stringifyJson(metadata),
  };
}

function fromRunRow(row: RunRow): Run {
  const metadata = parseJson<JsonObject>(row.metadata_json) ?? {};
  const publicMetadata = publicRunMetadata(metadata);
  return {
    runId: row.run_id,
    sessionId: row.session_id,
    ...(row.user_message_id ? { triggerMessageId: row.user_message_id } : {}),
    ...(typeof metadata.agentDefinitionId === 'string' ? { agentDefinitionId: metadata.agentDefinitionId } : {}),
    ...(typeof metadata.agentConfigSnapshotRef === 'string'
      ? { agentConfigSnapshotRef: metadata.agentConfigSnapshotRef }
      : {}),
    mode: row.permission_mode,
    ...((row.permission_snapshot_json || typeof metadata.permissionSnapshotRef === 'string')
      ? {
          permissionSnapshotRef: row.permission_snapshot_json
            ? permissionSnapshotRefFromJson(row.permission_snapshot_json)
            : metadata.permissionSnapshotRef as string,
        }
      : {}),
    goal: typeof metadata.goal === 'string' ? metadata.goal : '',
    status: row.status,
    createdAt: row.created_at,
    ...(row.started_at ? { startedAt: row.started_at } : {}),
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
    ...(row.cancelled_at ? { cancelledAt: row.cancelled_at } : {}),
    ...(row.error_json ? { error: parseJson(row.error_json) } : {}),
    ...(typeof metadata.sourcePlanId === 'string' ? { sourcePlanId: metadata.sourcePlanId } : {}),
    ...(typeof metadata.policySnapshotRef === 'string' ? { policySnapshotRef: metadata.policySnapshotRef } : {}),
    ...(publicMetadata ? { metadata: publicMetadata } : {}),
  };
}

function publicRunMetadata(metadata: JsonObject): JsonObject | undefined {
  const {
    goal: _goal,
    agentDefinitionId: _agentDefinitionId,
    agentConfigSnapshotRef: _agentConfigSnapshotRef,
    sourcePlanId: _sourcePlanId,
    policySnapshotRef: _policySnapshotRef,
    ...publicMetadata
  } = metadata;
  return Object.keys(publicMetadata).length > 0 ? publicMetadata : undefined;
}
}

namespace AgentLoopRepositoryParts {
// Compatibility repository for model-call records on the model_calls table.

type Nullable<T> = T | null;

interface ModelCallRow {
  model_call_id: string;
  run_id: string;
  call_order: number;
  provider_id: string;
  model_id: string;
  status: RunStep['status'];
  started_at: string;
  completed_at: Nullable<string>;
  error_json: Nullable<string>;
  metadata_json: Nullable<string>;
}

export interface ModelCallRecord {
  modelCallId: string;
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

export class AgentLoopModelCallMethods {
  constructor(private readonly database: MegumiDatabase) {}

  saveModelCall(modelCall: ModelCallRecord): ModelCallRecord {
    const existing = this.getModelCall(modelCall.modelCallId);
    const callOrder = existing ? this.callOrderFor(modelCall.modelCallId) : this.nextCallOrder(modelCall.runId);
    this.database.prepare(`
      INSERT INTO model_calls (
        model_call_id, run_id, call_order, provider_id, model_id, status,
        input_summary_json, context_snapshot_json, request_json, response_json,
        output_summary_json, token_usage_json, started_at, completed_at, error_json, metadata_json
      ) VALUES (
        @model_call_id, @run_id, @call_order, @provider_id, @model_id, @status,
        NULL, NULL, NULL, NULL, NULL, NULL, @started_at, @completed_at, @error_json, @metadata_json
      )
      ON CONFLICT(model_call_id) DO UPDATE SET
        run_id = excluded.run_id,
        provider_id = excluded.provider_id,
        model_id = excluded.model_id,
        status = excluded.status,
        completed_at = excluded.completed_at,
        error_json = excluded.error_json,
        metadata_json = excluded.metadata_json
    `).run(toModelCallRow(modelCall, callOrder));

    return this.getModelCall(modelCall.modelCallId) ?? modelCall;
  }

  getModelCall(modelCallId: string): ModelCallRecord | undefined {
    const row = this.database
      .prepare('SELECT * FROM model_calls WHERE model_call_id = ?')
      .get(modelCallId) as ModelCallRow | undefined;
    return row ? fromModelCallRow(row) : undefined;
  }

  private nextCallOrder(runId: string): number {
    const row = this.database
      .prepare('SELECT COALESCE(MAX(call_order), 0) + 1 AS next_order FROM model_calls WHERE run_id = ?')
      .get(runId) as { next_order: number };
    return row.next_order;
  }

  private callOrderFor(modelCallId: string): number {
    const row = this.database
      .prepare('SELECT call_order FROM model_calls WHERE model_call_id = ?')
      .get(modelCallId) as { call_order: number } | undefined;
    return row?.call_order ?? 1;
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

function toModelCallRow(modelCall: ModelCallRecord, callOrder: number): ModelCallRow {
  const metadata = {
    ...(modelCall.metadata ?? {}),
    ...(modelCall.stepId ? { stepId: modelCall.stepId } : {}),
  };
  return {
    model_call_id: modelCall.modelCallId,
    run_id: modelCall.runId,
    call_order: callOrder,
    provider_id: modelCall.providerId,
    model_id: modelCall.modelId,
    status: modelCall.status,
    started_at: modelCall.startedAt,
    completed_at: modelCall.completedAt ?? null,
    error_json: modelCall.error ? stringifyJson(modelCall.error) : null,
    metadata_json: stringifyJson(metadata),
  };
}

function fromModelCallRow(row: ModelCallRow): ModelCallRecord {
  const metadata = parseJson<JsonObject>(row.metadata_json) ?? {};
  const publicMetadata = publicModelCallMetadata(metadata);
  return {
    modelCallId: row.model_call_id,
    runId: row.run_id,
    ...(typeof metadata.stepId === 'string' ? { stepId: metadata.stepId } : {}),
    providerId: row.provider_id,
    modelId: row.model_id,
    status: row.status,
    startedAt: row.started_at,
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
    ...(row.error_json ? { error: parseJson<RuntimeError>(row.error_json) } : {}),
    ...(publicMetadata ? { metadata: publicMetadata } : {}),
  };
}

function publicModelCallMetadata(metadata: JsonObject): JsonObject | undefined {
  const { stepId: _stepId, ...publicMetadata } = metadata;
  return Object.keys(publicMetadata).length > 0 ? publicMetadata : undefined;
}
}

namespace AgentLoopRepositoryParts {
// Owns persisted agent loop event storage and replay ordering.

interface RuntimeEventRow {
  event_json: string;
}

export class AgentLoopRuntimeEventMethods {
  constructor(private readonly database: MegumiDatabase) {}

  appendRuntimeEvent(event: RuntimeEvent): RuntimeEvent {
    if (event.eventType === 'run.created') {
      return event;
    }

    const run = event.runId
      ? this.database
        .prepare('SELECT session_id FROM agent_loop_runs WHERE run_id = ?')
        .get(event.runId) as { session_id: string } | undefined
      : undefined;
    const sessionId = event.sessionId ?? run?.session_id;

    if (!event.runId || !sessionId) {
      return event;
    }

    const sequence = this.sequenceForEvent(event.eventId, event.runId, event.sequence);
    const persistedEvent = { ...event, sequence };

    this.database.prepare(`
      INSERT INTO agent_loop_events (
        event_id, session_id, run_id, event_type, sequence, created_at,
        visibility, payload_json, event_json
      ) VALUES (
        @event_id, @session_id, @run_id, @event_type, @sequence, @created_at,
        @visibility, @payload_json, @event_json
      )
    `).run({
      event_id: event.eventId,
      session_id: sessionId,
      run_id: event.runId,
      event_type: event.eventType,
      sequence,
      created_at: event.createdAt,
      visibility: event.visibility,
      payload_json: stringifyJson(event.payload),
      event_json: stringifyJson(persistedEvent),
    });

    return persistedEvent;
  }

  listRuntimeEventsByRun(runId: string): RuntimeEvent[] {
    return (this.database
      .prepare(`
        SELECT event_json
        FROM agent_loop_events
        WHERE run_id = ?
          AND event_type NOT LIKE 'compat.%'
          AND event_type NOT LIKE 'context.%'
          AND event_type NOT LIKE 'recovery.%'
          AND event_type NOT LIKE 'timeline.%'
          AND event_type NOT LIKE 'agent_loop.%'
        ORDER BY sequence ASC
      `)
      .all(runId) as RuntimeEventRow[]).map((row) => JSON.parse(row.event_json) as RuntimeEvent);
  }

  private sequenceForEvent(eventId: string, runId: string, proposedSequence?: number): number {
    const existingEvent = this.database
      .prepare('SELECT sequence FROM agent_loop_events WHERE event_id = ?')
      .get(eventId) as { sequence: number } | undefined;
    if (existingEvent) {
      return existingEvent.sequence;
    }

    if (typeof proposedSequence !== 'number' || !Number.isFinite(proposedSequence)) {
      return (this.database
        .prepare('SELECT COALESCE(MAX(CASE WHEN sequence > 0 THEN sequence ELSE 0 END), 0) + 1 AS next_sequence FROM agent_loop_events WHERE run_id = ?')
        .get(runId) as { next_sequence: number }).next_sequence;
    }

    const sequenceOwner = this.database
      .prepare('SELECT event_id FROM agent_loop_events WHERE run_id = ? AND sequence = ?')
      .get(runId, proposedSequence) as { event_id: string } | undefined;
    if (!sequenceOwner) {
      return proposedSequence;
    }

    return (this.database
      .prepare('SELECT COALESCE(MAX(CASE WHEN sequence > 0 THEN sequence ELSE 0 END), 0) + 1 AS next_sequence FROM agent_loop_events WHERE run_id = ?')
      .get(runId) as { next_sequence: number }).next_sequence;
  }
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value);
}
}

namespace AgentLoopRepositoryParts {
// Stores agent loop lifecycle facts as ordered agent loop events.

type AgentLoopFactKind = 'step' | 'action' | 'observation';

interface AgentLoopFactEventRow {
  payload_json: string;
}

export class AgentLoopExecutionFactMethods {
  constructor(private readonly database: MegumiDatabase) {}

  saveStep(step: RunStep): RunStep {
    this.saveAgentLoopFact({
      eventId: `agent-loop:step:${step.stepId}`,
      runId: step.runId,
      kind: 'step',
      createdAt: step.startedAt ?? step.completedAt ?? new Date(0).toISOString(),
      record: step,
    });
    return step;
  }

  listStepsByRun(runId: string): RunStep[] {
    return this.listAgentLoopFacts<RunStep>(runId, 'step')
      .sort((left, right) => (left.startedAt ?? '').localeCompare(right.startedAt ?? '') || left.stepId.localeCompare(right.stepId));
  }

  saveAction(action: RunAction): RunAction {
    this.saveAgentLoopFact({
      eventId: `agent-loop:action:${action.actionId}`,
      runId: action.runId,
      kind: 'action',
      createdAt: action.requestedAt,
      record: action,
    });
    return action;
  }

  listActionsByRun(runId: string): RunAction[] {
    return this.listAgentLoopFacts<RunAction>(runId, 'action')
      .sort((left, right) => left.requestedAt.localeCompare(right.requestedAt));
  }

  saveObservation(observation: RunObservation): RunObservation {
    this.saveAgentLoopFact({
      eventId: `agent-loop:observation:${observation.observationId}`,
      runId: observation.runId,
      kind: 'observation',
      createdAt: observation.receivedAt,
      record: observation,
    });
    return observation;
  }

  listObservationsByRun(runId: string): RunObservation[] {
    return this.listAgentLoopFacts<RunObservation>(runId, 'observation')
      .sort((left, right) => left.receivedAt.localeCompare(right.receivedAt));
  }

  private saveAgentLoopFact(input: {
    eventId: string;
    runId: string;
    kind: AgentLoopFactKind;
    createdAt: string;
    record: unknown;
  }): void {
    const run = this.database
      .prepare('SELECT session_id FROM agent_loop_runs WHERE run_id = ?')
      .get(input.runId) as { session_id: string } | undefined;
    if (!run) {
      throw new Error(`Run ${input.runId} does not exist`);
    }

    const existing = this.database
      .prepare('SELECT sequence FROM agent_loop_events WHERE event_id = ?')
      .get(input.eventId) as { sequence: number } | undefined;
    const sequence = existing?.sequence ?? this.nextSequence(input.runId);
    const payload = JSON.stringify({ agentLoopFactKind: input.kind, record: input.record });

    this.database.prepare(`
      INSERT INTO agent_loop_events (
        event_id, run_id, session_id, sequence, event_type, visibility, created_at, payload_json, event_json
      ) VALUES (
        @event_id, @run_id, @session_id, @sequence, @event_type, 'internal', @created_at, @payload_json, @event_json
      )
      ON CONFLICT(event_id) DO UPDATE SET
        created_at = excluded.created_at,
        payload_json = excluded.payload_json,
        event_json = excluded.event_json
    `).run({
      event_id: input.eventId,
      run_id: input.runId,
      session_id: run.session_id,
      sequence,
      event_type: `agent_loop.${input.kind}`,
      created_at: input.createdAt,
      payload_json: payload,
      event_json: payload,
    });
  }

  private listAgentLoopFacts<T>(runId: string, kind: AgentLoopFactKind): T[] {
    return (this.database
      .prepare(`
        SELECT payload_json
        FROM agent_loop_events
        WHERE run_id = ? AND event_type = ?
        ORDER BY sequence ASC
      `)
      .all(runId, `agent_loop.${kind}`) as AgentLoopFactEventRow[])
      .map((row) => JSON.parse(row.payload_json) as { record: T })
      .map((payload) => payload.record);
  }

  private nextSequence(runId: string): number {
    const row = this.database
      .prepare('SELECT COALESCE(MIN(sequence), 0) - 1 AS next_sequence FROM agent_loop_events WHERE run_id = ?')
      .get(runId) as { next_sequence: number };
    return row.next_sequence;
  }
}
}

namespace AgentLoopRepositoryParts {
// Persists context construction audit records as agent-loop events.


type ContextEventKind = 'context.baseline' | 'context.source' | 'context.patch' | 'context.build';

interface ContextEventRow {
  payload_json: string;
}

interface RunOwnerRow {
  session_id: string;
}

export class AgentLoopContextMethods {
  constructor(private readonly database: MegumiDatabase) {}

  saveBaseline(context: RunContext): RunContext {
    saveContextEvent(this.database, {
      eventId: `context-baseline:${context.contextId}`,
      runId: context.runId,
      eventType: 'context.baseline',
      createdAt: context.createdAt,
      payload: context,
    });
    return this.getBaseline(context.contextId) ?? context;
  }

  getBaseline(contextId: string): RunContext | undefined {
    const row = this.database.prepare(`
      SELECT payload_json
      FROM agent_loop_events
      WHERE event_id = ?
    `).get(`context-baseline:${contextId}`) as ContextEventRow | undefined;
    return row ? parseJson<RunContext>(row.payload_json) : undefined;
  }

  saveSourceRef(source: RunContextSource & { runId?: string }): RunContextSource {
    const runId = source.runId ?? source.metadata?.runId;
    if (typeof runId !== 'string' || runId.length === 0) {
      throw new Error('Context source ref requires runId for persistence.');
    }
    saveContextEvent(this.database, {
      eventId: `context-source:${source.sourceId}`,
      runId,
      eventType: 'context.source',
      createdAt: source.loadedAt,
      payload: { ...source, runId },
    });
    return source;
  }

  listSourcesByRun(runId: string): RunContextSource[] {
    return listContextEvents<RunContextSource>(this.database, runId, 'context.source');
  }

  savePatch(patch: ContextPatch): ContextPatch {
    saveContextEvent(this.database, {
      eventId: `context-patch:${patch.patchId}`,
      runId: patch.runId,
      eventType: 'context.patch',
      createdAt: patch.createdAt,
      payload: patch,
    });
    return patch;
  }

  listPatchesByRun(runId: string): ContextPatch[] {
    return listContextEvents<ContextPatch>(this.database, runId, 'context.patch');
  }

  saveEffectiveBuild(build: RunContextBuild): RunContextBuild {
    assertSafeBuildMetadata(build.metadata);
    saveContextEvent(this.database, {
      eventId: `context-build:${build.buildId}`,
      runId: build.runId,
      eventType: 'context.build',
      createdAt: build.builtAt,
      payload: build,
    });
    return build;
  }

  listEffectiveBuildsByRun(runId: string): RunContextBuild[] {
    return listContextEvents<RunContextBuild>(this.database, runId, 'context.build');
  }
}

function saveContextEvent(database: MegumiDatabase, input: {
  eventId: string;
  runId: string;
  eventType: ContextEventKind;
  createdAt: string;
  payload: unknown;
}): void {
  const owner = runOwner(database, input.runId);
  const existing = database.prepare('SELECT sequence FROM agent_loop_events WHERE event_id = ?')
    .get(input.eventId) as { sequence: number } | undefined;
  const sequence = existing?.sequence ?? nextSequence(database, input.runId);
  const eventJson = {
    eventId: input.eventId,
    runId: input.runId,
    sessionId: owner.session_id,
    sequence,
    eventType: input.eventType,
    visibility: 'internal',
    createdAt: input.createdAt,
    payload: input.payload,
  };

  database.prepare(`
    INSERT INTO agent_loop_events (
      event_id, run_id, session_id, sequence, event_type, visibility,
      created_at, payload_json, event_json
    ) VALUES (
      @event_id, @run_id, @session_id, @sequence, @event_type, 'internal',
      @created_at, @payload_json, @event_json
    )
    ON CONFLICT(event_id) DO UPDATE SET
      payload_json = excluded.payload_json,
      event_json = excluded.event_json
  `).run({
    event_id: input.eventId,
    run_id: input.runId,
    session_id: owner.session_id,
    sequence,
    event_type: input.eventType,
    created_at: input.createdAt,
    payload_json: stringifyJson(input.payload),
    event_json: stringifyJson(eventJson),
  });
}

function listContextEvents<T>(database: MegumiDatabase, runId: string, eventType: ContextEventKind): T[] {
  return (database.prepare(`
    SELECT payload_json
    FROM agent_loop_events
    WHERE run_id = ? AND event_type = ?
    ORDER BY created_at ASC, event_id ASC
  `).all(runId, eventType) as ContextEventRow[]).map((row) => parseJson<T>(row.payload_json));
}

function runOwner(database: MegumiDatabase, runId: string): RunOwnerRow {
  const row = database.prepare('SELECT session_id FROM agent_loop_runs WHERE run_id = ?')
    .get(runId) as RunOwnerRow | undefined;
  if (!row) {
    throw new Error(`Run ${runId} does not exist`);
  }
  return row;
}

function nextSequence(database: MegumiDatabase, runId: string): number {
  const row = database.prepare('SELECT COALESCE(MIN(sequence), 0) - 1 AS next_sequence FROM agent_loop_events WHERE run_id = ?')
    .get(runId) as { next_sequence: number };
  return row.next_sequence;
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value);
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function assertSafeBuildMetadata(metadata: JsonObject | undefined): void {
  if (!metadata) {
    return;
  }

  const serialized = JSON.stringify(metadata);
  const unsafeFieldNames = [
    ['exactPromptInput', 'Snapshot'].join(''),
    ['packedModelInput', 'Snapshot'].join(''),
    ['rawFull', 'Prompt'].join(''),
    ['rawRestrictedFile', 'Content'].join(''),
    ['plaintext', 'Secret'].join(''),
  ];
  const hasUnsafeField = unsafeFieldNames.some((field) => serialized.includes(field));
  const hasSecretLikeValue = /(sk-[A-Za-z0-9_-]{12,}|BEGIN (RSA |OPENSSH |PRIVATE )?KEY|password\s*=)/i.test(serialized);

  if (hasUnsafeField || hasSecretLikeValue) {
    throw new Error('Unsafe context snapshot metadata cannot be persisted.');
  }
}
}

namespace AgentLoopRepositoryParts {
// Persists recovery lifecycle records as agent-loop events on the redesigned schema.


type RecoveryEventType =
  | 'recovery.checkpoint'
  | 'recovery.resume_request'
  | 'recovery.cancel_request'
  | 'recovery.retry_request'
  | 'recovery.restore_record'
  | 'recovery.interrupted_run';

export interface RunNeedingTimelineBackfill {
  runId: string;
  sessionId: string;
  projectId: string;
  status: RecoverableRunSummary['status'];
  reason: RecoverableRunReason;
  errorJson: string | null;
  createdAt: string;
  completedAt: string | null;
  triggerMessageId: string | null;
  triggerMessageContent: string | null;
  triggerMessageCreatedAt: string | null;
}

interface EventRow {
  event_id: string;
  created_at: string;
  payload_json: string;
}

interface RunRow {
  run_id: string;
  workspace_id: string;
  session_id: string;
  status: RecoverableRunSummary['status'];
  error_json: string | null;
  created_at: string;
  completed_at: string | null;
  user_message_id: string | null;
  metadata_json: string | null;
  title: string;
}

const RECOVERABLE_RUN_STATUSES = [
  'waiting_for_approval',
  'paused',
  'failed',
  'cancelled',
  'queued',
  'running',
  'cancelling',
] as const;

const RUNNING_LIKE_STATUSES = ['queued', 'running', 'cancelling'] as const;

export class AgentLoopRecoveryMethods {
  constructor(private readonly database: MegumiDatabase) {}

  saveCheckpoint(checkpoint: Checkpoint): Checkpoint {
    saveRecoveryEvent(this.database, {
      eventId: `recovery-checkpoint:${checkpoint.checkpointId}`,
      runId: checkpoint.runId,
      eventType: 'recovery.checkpoint',
      createdAt: checkpoint.createdAt,
      payload: checkpoint,
    });
    return checkpoint;
  }

  getCheckpoint(checkpointId: string): Checkpoint | undefined {
    return getEventPayload<Checkpoint>(this.database, `recovery-checkpoint:${checkpointId}`);
  }

  listCheckpointsByRun(runId: string): Checkpoint[] {
    return listRecoveryEvents<Checkpoint>(this.database, runId, 'recovery.checkpoint')
      .sort((left, right) => left.sequence - right.sequence || left.createdAt.localeCompare(right.createdAt));
  }

  getLatestCheckpointByRun(runId: string): Checkpoint | undefined {
    return [...this.listCheckpointsByRun(runId)].sort((left, right) => right.sequence - left.sequence)[0];
  }

  markCheckpointStatus(checkpointId: string, status: CheckpointStatus): void {
    const checkpoint = this.getCheckpoint(checkpointId);
    if (checkpoint) {
      this.saveCheckpoint({ ...checkpoint, status });
    }
  }

  saveResumeRequest(request: ResumeRequest): ResumeRequest {
    saveRecoveryEvent(this.database, {
      eventId: `recovery-resume:${request.resumeRequestId}`,
      runId: request.runId,
      eventType: 'recovery.resume_request',
      createdAt: request.createdAt,
      payload: request,
    });
    return request;
  }

  listResumeRequestsByRun(runId: string): ResumeRequest[] {
    return listRecoveryEvents<ResumeRequest>(this.database, runId, 'recovery.resume_request');
  }

  saveCancelRequest(request: CancelRequest): CancelRequest {
    saveRecoveryEvent(this.database, {
      eventId: `recovery-cancel:${request.cancelRequestId}`,
      runId: request.runId,
      eventType: 'recovery.cancel_request',
      createdAt: request.createdAt,
      payload: request,
    });
    return request;
  }

  listCancelRequestsByRun(runId: string): CancelRequest[] {
    return listRecoveryEvents<CancelRequest>(this.database, runId, 'recovery.cancel_request');
  }

  saveRetryRequest(request: RetryRequest): RetryRequest {
    saveRecoveryEvent(this.database, {
      eventId: `recovery-retry:${request.retryRequestId}`,
      runId: request.runId,
      eventType: 'recovery.retry_request',
      createdAt: request.createdAt,
      payload: request,
    });
    return request;
  }

  listRetryRequestsByRun(runId: string): RetryRequest[] {
    return listRecoveryEvents<RetryRequest>(this.database, runId, 'recovery.retry_request');
  }

  saveRestoreRecord(record: CheckpointRestoreRecord): CheckpointRestoreRecord {
    saveRecoveryEvent(this.database, {
      eventId: `recovery-restore:${record.restoreRecordId}`,
      runId: record.runId,
      eventType: 'recovery.restore_record',
      createdAt: record.restoredAt,
      payload: record,
    });
    return record;
  }

  listRestoreRecordsByRun(runId: string): CheckpointRestoreRecord[] {
    return listRecoveryEvents<CheckpointRestoreRecord>(this.database, runId, 'recovery.restore_record');
  }

  listRecoverableRuns(): RecoverableRunSummary[] {
    return recoverableRunRows(this.database)
      .map((row) => {
        const marker = latestInterruptedMarker(this.database, row.run_id);
        if (RUNNING_LIKE_STATUSES.includes(row.status as (typeof RUNNING_LIKE_STATUSES)[number]) && !marker) {
          return undefined;
        }
        const latest = this.getLatestCheckpointByRun(row.run_id);
        const metadata = parseJson<Record<string, unknown>>(row.metadata_json) ?? {};
        const goal = typeof metadata.goal === 'string' ? metadata.goal : '';
        return RecoverableRunSummarySchema.parse({
          runId: row.run_id,
          sessionId: row.session_id,
          status: row.status,
          reason: recoverableReasonFor(row.status, marker?.interruptedMarkerId ?? null),
          ...(latest ? { latestCheckpointId: latest.checkpointId, latestCheckpointAt: latest.createdAt } : {}),
          title: row.title,
          ...(goal ? { preview: goal.slice(0, 240) } : {}),
          ...(marker ? { metadata: { interruptedMarkerId: marker.interruptedMarkerId } } : {}),
        });
      })
      .filter((summary): summary is RecoverableRunSummary => Boolean(summary));
  }

  listRunsNeedingTimelineBackfill(): RunNeedingTimelineBackfill[] {
    return recoverableRunRows(this.database)
      .filter((row) => {
        const marker = latestInterruptedMarker(this.database, row.run_id);
        return (row.status === 'failed' || row.status === 'cancelled' || Boolean(marker))
          && !hasTimelineCommit(this.database, row.run_id);
      })
      .map((row) => {
        const trigger = row.user_message_id ? getUserMessage(this.database, row.user_message_id) : undefined;
        return {
          runId: row.run_id,
          sessionId: row.session_id,
          projectId: row.workspace_id,
          status: row.status,
          reason: recoverableReasonFor(row.status, latestInterruptedMarker(this.database, row.run_id)?.interruptedMarkerId ?? null),
          errorJson: row.error_json,
          createdAt: row.created_at,
          completedAt: row.completed_at,
          triggerMessageId: trigger?.message_id ?? null,
          triggerMessageContent: trigger?.content_text ?? null,
          triggerMessageCreatedAt: trigger?.created_at ?? null,
        };
      });
  }

  markInterruptedRuns(input: {
    markedAt: string;
    reason: SessionInterruptedRunReason;
    createMarkerId(runId: string): string;
  }): SessionInterruptedRunMarker[] {
    const rows = this.database.prepare(`
      SELECT r.run_id, r.session_id, r.status
      FROM agent_loop_runs r
      WHERE r.status IN (${RUNNING_LIKE_STATUSES.map(() => '?').join(', ')})
      ORDER BY r.created_at ASC, r.run_id ASC
    `).all(...RUNNING_LIKE_STATUSES) as Array<{
      run_id: string;
      session_id: string;
      status: SessionInterruptedRunPreviousStatus;
    }>;

    const markers = rows
      .filter((row) => !latestInterruptedMarker(this.database, row.run_id))
      .map((row) => SessionInterruptedRunMarkerSchema.parse({
        interruptedMarkerId: input.createMarkerId(row.run_id),
        sessionId: row.session_id,
        runId: row.run_id,
        previousStatus: row.status,
        reason: input.reason,
        markedAt: input.markedAt,
      }));

    for (const marker of markers) {
      saveRecoveryEvent(this.database, {
        eventId: `recovery-interrupted:${marker.interruptedMarkerId}`,
        runId: marker.runId,
        eventType: 'recovery.interrupted_run',
        createdAt: marker.markedAt,
        payload: marker,
      });
    }

    return markers;
  }
}

function saveRecoveryEvent(database: MegumiDatabase, input: {
  eventId: string;
  runId: string;
  eventType: RecoveryEventType;
  createdAt: string;
  payload: unknown;
}): void {
  const owner = ensureRecoveryRun(database, input.runId, input.createdAt);
  const existing = database.prepare('SELECT sequence FROM agent_loop_events WHERE event_id = ?')
    .get(input.eventId) as { sequence: number } | undefined;
  const sequence = existing?.sequence ?? nextSequence(database, input.runId);
  database.prepare(`
    INSERT INTO agent_loop_events (
      event_id, run_id, session_id, sequence, event_type, visibility,
      created_at, payload_json, event_json
    ) VALUES (
      @event_id, @run_id, @session_id, @sequence, @event_type, 'internal',
      @created_at, @payload_json, @event_json
    )
    ON CONFLICT(event_id) DO UPDATE SET
      payload_json = excluded.payload_json,
      event_json = excluded.event_json
  `).run({
    event_id: input.eventId,
    run_id: input.runId,
    session_id: owner.sessionId,
    sequence,
    event_type: input.eventType,
    created_at: input.createdAt,
    payload_json: stringifyJson(input.payload),
    event_json: stringifyJson({ ...input, sessionId: owner.sessionId, sequence, visibility: 'internal' }),
  });
}

function getEventPayload<T>(database: MegumiDatabase, eventId: string): T | undefined {
  const row = database.prepare('SELECT payload_json FROM agent_loop_events WHERE event_id = ?')
    .get(eventId) as { payload_json: string } | undefined;
  return row ? parseJson<T>(row.payload_json) : undefined;
}

function listRecoveryEvents<T>(database: MegumiDatabase, runId: string, eventType: RecoveryEventType): T[] {
  return (database.prepare(`
    SELECT event_id, created_at, payload_json
    FROM agent_loop_events
    WHERE run_id = ? AND event_type = ?
    ORDER BY created_at ASC, sequence ASC, event_id ASC
  `).all(runId, eventType) as EventRow[])
    .map((row) => parseJson<T>(row.payload_json))
    .filter((payload): payload is T => Boolean(payload));
}

function recoverableRunRows(database: MegumiDatabase): RunRow[] {
  return database.prepare(`
    SELECT
      r.run_id,
      r.workspace_id,
      r.session_id,
      r.status,
      r.error_json,
      r.created_at,
      r.completed_at,
      r.user_message_id,
      r.metadata_json,
      s.title
    FROM agent_loop_runs r
    INNER JOIN sessions s ON s.session_id = r.session_id
    WHERE r.status IN (${RECOVERABLE_RUN_STATUSES.map(() => '?').join(', ')})
    ORDER BY r.created_at ASC, r.run_id ASC
  `).all(...RECOVERABLE_RUN_STATUSES) as RunRow[];
}

function latestInterruptedMarker(database: MegumiDatabase, runId: string): SessionInterruptedRunMarker | undefined {
  return listRecoveryEvents<SessionInterruptedRunMarker>(database, runId, 'recovery.interrupted_run').at(-1);
}

function hasTimelineCommit(database: MegumiDatabase, runId: string): boolean {
  const row = database.prepare("SELECT 1 FROM agent_loop_events WHERE event_id = ? AND event_type = 'timeline.commit'")
    .get(`timeline-commit:${runId}`);
  return Boolean(row);
}

function getUserMessage(database: MegumiDatabase, messageId: string): {
  message_id: string;
  content_text: string;
  created_at: string;
} | undefined {
  return database.prepare(`
    SELECT message_id, content_text, created_at
    FROM session_messages
    WHERE message_id = ? AND role = 'user'
  `).get(messageId) as { message_id: string; content_text: string; created_at: string } | undefined;
}

function ensureRecoveryRun(database: MegumiDatabase, runId: string, now: string): { sessionId: string } {
  const existing = database.prepare('SELECT session_id FROM agent_loop_runs WHERE run_id = ?')
    .get(runId) as { session_id: string } | undefined;
  if (existing) {
    return { sessionId: existing.session_id };
  }

  throw new Error(`Recovery event requires an existing agent loop run: ${runId}`);
}

function nextSequence(database: MegumiDatabase, runId: string): number {
  const row = database.prepare('SELECT COALESCE(MIN(sequence), 0) - 1 AS next_sequence FROM agent_loop_events WHERE run_id = ?')
    .get(runId) as { next_sequence: number };
  return row.next_sequence;
}

function recoverableReasonFor(
  status: RecoverableRunSummary['status'],
  interruptedMarkerId: string | null,
): RecoverableRunReason {
  if (interruptedMarkerId) {
    return 'interrupted';
  }
  if (status === 'waiting_for_approval') {
    return 'waiting_for_approval';
  }
  return status as RecoverableRunReason;
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value);
}

function parseJson<T>(value: string | null | undefined): T | undefined {
  return value ? JSON.parse(value) as T : undefined;
}
}

namespace AgentLoopRepositoryParts {
// Stores permission snapshots and implementation-plan compatibility records in the redesigned schema.


interface RunRow {
  run_id: string;
  workspace_id: string;
  session_id: string;
  permission_snapshot_json: string | null;
  metadata_json: string | null;
}

interface ArtifactRow {
  artifact_id: string;
  workspace_id: string | null;
  session_id: string | null;
  run_id: string | null;
  kind: string;
  title: string;
  status: ImplementationPlanArtifactStatus;
  created_at: string;
  updated_at: string;
  metadata_json: string | null;
}

interface RunMetadata {
  sourcePlan?: RunSourcePlanRelation;
  implementationPlan?: ImplementationPlanArtifactRecord;
  [key: string]: unknown;
}

interface PlanMetadata {
  implementationPlan?: ImplementationPlanArtifactRecord;
  userMetadata?: JsonObject;
}

export class AgentLoopPermissionSnapshotMethods {
  constructor(private readonly database: MegumiDatabase) {}

  savePermissionSnapshot(snapshot: PermissionSnapshotRecord): PermissionSnapshotRecord {
    requireRun(this.database, snapshot.runId);
    const metadata = runMetadata(this.database, snapshot.runId);
    metadata.permissionSnapshotRef = snapshot.permissionSnapshotId;
    this.database.prepare(`
      UPDATE agent_loop_runs
      SET permission_snapshot_json = ?,
          metadata_json = ?
      WHERE run_id = ?
    `).run(stringifyJson(snapshot), stringifyJson(metadata), snapshot.runId);

    return this.getPermissionSnapshot(snapshot.permissionSnapshotId) ?? snapshot;
  }

  getPermissionSnapshot(permissionSnapshotId: string): PermissionSnapshotRecord | undefined {
    const rows = this.database.prepare(`
      SELECT permission_snapshot_json
      FROM agent_loop_runs
      WHERE permission_snapshot_json IS NOT NULL
    `).all() as Array<{ permission_snapshot_json: string | null }>;
    return rows
      .map((row) => parseJson<PermissionSnapshotRecord>(row.permission_snapshot_json))
      .find((snapshot) => snapshot?.permissionSnapshotId === permissionSnapshotId);
  }

  getPermissionSnapshotByRun(runId: string): PermissionSnapshotRecord | undefined {
    const row = this.database.prepare(`
      SELECT permission_snapshot_json
      FROM agent_loop_runs
      WHERE run_id = ?
    `).get(runId) as { permission_snapshot_json: string | null } | undefined;
    return parseJson<PermissionSnapshotRecord>(row?.permission_snapshot_json);
  }

  saveImplementationPlan(plan: ImplementationPlanArtifactRecord): ImplementationPlanArtifactRecord {
    requireRun(this.database, plan.producingRunId);
    const metadata = runMetadata(this.database, plan.producingRunId);
    metadata.implementationPlan = plan;
    this.database.prepare('UPDATE agent_loop_runs SET metadata_json = ? WHERE run_id = ?')
      .run(stringifyJson(metadata), plan.producingRunId);
    return plan;
  }

  getImplementationPlan(planArtifactId: string): ImplementationPlanArtifactRecord | undefined {
    return this.listImplementationPlans()
      .find((plan) => plan.planArtifactId === planArtifactId);
  }

  getImplementationPlanByProducingRun(runId: string): ImplementationPlanArtifactRecord | undefined {
    return runMetadata(this.database, runId).implementationPlan;
  }

  updateImplementationPlanStatus(input: {
    planArtifactId: string;
    status: ImplementationPlanArtifactStatus;
    updatedAt: string;
    supersededByPlanId?: string;
  }): ImplementationPlanArtifactRecord | undefined {
    const current = this.getImplementationPlan(input.planArtifactId);
    if (!current) {
      return undefined;
    }

    const updated: ImplementationPlanArtifactRecord = {
      ...current,
      status: input.status,
      updatedAt: input.updatedAt,
      ...(input.status === 'accepted' ? { acceptedAt: input.updatedAt } : {}),
      ...(input.status === 'rejected' ? { rejectedAt: input.updatedAt } : {}),
      ...(input.status === 'superseded'
        ? {
            supersededAt: input.updatedAt,
            ...(input.supersededByPlanId ? { supersededByPlanId: input.supersededByPlanId } : {}),
          }
        : {}),
    };

    return this.saveImplementationPlan(updated);
  }

  saveSourcePlanRelation(relation: RunSourcePlanRelation): RunSourcePlanRelation {
    requireRun(this.database, relation.runId);
    const metadata = runMetadata(this.database, relation.runId);
    metadata.sourcePlan = relation;
    this.database.prepare('UPDATE agent_loop_runs SET metadata_json = ? WHERE run_id = ?')
      .run(stringifyJson(metadata), relation.runId);

    return this.getSourcePlanRelation(relation.runId) ?? relation;
  }

  getSourcePlanRelation(runId: string): RunSourcePlanRelation | undefined {
    return runMetadata(this.database, runId).sourcePlan;
  }

  listRunsBySourcePlan(sourcePlanId: string): RunSourcePlanRelation[] {
    const rows = this.database.prepare(`
      SELECT metadata_json
      FROM agent_loop_runs
      WHERE metadata_json IS NOT NULL
    `).all() as Array<{ metadata_json: string | null }>;
    return rows
      .map((row) => parseJson<RunMetadata>(row.metadata_json)?.sourcePlan)
      .filter((relation): relation is RunSourcePlanRelation => relation?.sourcePlanId === sourcePlanId)
      .sort((left, right) => left.linkedAt.localeCompare(right.linkedAt));
  }

  private listImplementationPlans(): ImplementationPlanArtifactRecord[] {
    const rows = this.database.prepare(`
      SELECT metadata_json
      FROM agent_loop_runs
      WHERE metadata_json IS NOT NULL
    `).all() as Array<{ metadata_json: string | null }>;
    return rows
      .map((row) => parseJson<RunMetadata>(row.metadata_json)?.implementationPlan)
      .filter((plan): plan is ImplementationPlanArtifactRecord => Boolean(plan));
  }
}

function requireRun(database: MegumiDatabase, runId: string): RunRow {
  const row = database.prepare(`
    SELECT run_id, workspace_id, session_id, permission_snapshot_json, metadata_json
    FROM agent_loop_runs
    WHERE run_id = ?
  `).get(runId) as RunRow | undefined;
  if (!row) {
    throw new Error(`Run ${runId} does not exist`);
  }
  return row;
}

function runMetadata(database: MegumiDatabase, runId: string): RunMetadata {
  const row = database.prepare('SELECT metadata_json FROM agent_loop_runs WHERE run_id = ?')
    .get(runId) as { metadata_json: string | null } | undefined;
  return parseJson<RunMetadata>(row?.metadata_json) ?? {};
}

function planFromArtifactRow(row: ArtifactRow): ImplementationPlanArtifactRecord {
  const metadata = parseJson<PlanMetadata>(row.metadata_json);
  if (metadata?.implementationPlan) {
    return metadata.implementationPlan;
  }
  return {
    planArtifactId: row.artifact_id,
    producingRunId: row.run_id ?? '',
    title: row.title,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(metadata?.userMetadata ? { metadata: metadata.userMetadata } : {}),
  };
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(dropUndefined(value));
}

function parseJson<T>(value: string | null | undefined): T | undefined {
  return value ? JSON.parse(value) as T : undefined;
}

function dropUndefined(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(dropUndefined);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, dropUndefined(entry)]),
    );
  }
  return value;
}
}

namespace AgentLoopRepositoryParts {
// Persists UI timeline projections on session_messages and agent-loop events.


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

interface SessionMessageRow {
  message_id: string;
  session_id: string;
  run_id: string | null;
  role: string;
  content_text: string;
  blocks_json: string | null;
  created_at: string;
  completed_at: string | null;
  metadata_json: string | null;
}

interface EventPayloadRow {
  payload_json: string;
}

export class AgentLoopTimelineMessageMethods {
  constructor(private readonly database: MegumiDatabase) {}

  commitRunTimeline(input: TimelineCommitInput): TimelineMessage[] {
    const messages = sortMessages(input.messages.map((message) => TimelineMessageSchema.parse(message)));
    validateCommitOwnership(input, messages);

    const commit = this.database.transaction(() => {
      if (timelineRunExists(this.database, input.runId)) {
        saveTimelineEvent(this.database, {
          eventId: `timeline-commit:${input.runId}`,
          runId: input.runId,
          sessionId: input.sessionId,
          eventType: 'timeline.commit',
          createdAt: input.committedAt,
          payload: {
            runId: input.runId,
            projectId: input.projectId,
            sessionId: input.sessionId,
            status: 'committed',
            committedAt: input.committedAt,
            updatedAt: input.committedAt,
          } satisfies TimelineRunCommitRecord,
        });
      }
    });

    commit();
    return messages;
  }

  listCommittedMessagesBySession(input: {
    projectId: string;
    sessionId: string;
  }): { messages: TimelineMessage[]; diagnostics: TimelineHydrationDiagnostic[] } {
    const rows = this.database.prepare(`
      SELECT message_id, session_id, run_id, role, content_text, blocks_json, created_at, completed_at, metadata_json
      FROM session_messages
      WHERE session_id = ?
      ORDER BY created_at ASC, run_id ASC, message_id ASC
    `).all(input.sessionId) as SessionMessageRow[];

    const messages: TimelineMessage[] = branchSeparatorMessagesBySession(this.database, input);
    const diagnostics: TimelineHydrationDiagnostic[] = [];
    for (const row of rows) {
      const result = parseTimelineMessage(row, input.projectId);
      if (result.ok) {
        if (result.message.projectId === input.projectId || result.message.role === 'separator') {
          messages.push(result.message);
        }
      } else if (!('skip' in result)) {
        diagnostics.push({
          messageId: row.message_id,
          code: 'timeline_message_parse_failed',
          message: result.message,
        });
      }
    }
    return { messages: sortMessages(messages), diagnostics };
  }

  getRunCommit(runId: string): TimelineRunCommitRecord | undefined {
    const row = this.database.prepare(`
      SELECT payload_json
      FROM agent_loop_events
      WHERE event_id = ?
    `).get(`timeline-commit:${runId}`) as EventPayloadRow | undefined;
    return row ? parseJson<TimelineRunCommitRecord>(row.payload_json) : undefined;
  }

  recordCommitDiagnostic(diagnostic: TimelineCommitDiagnostic): TimelineCommitDiagnostic {
    const error = { code: diagnostic.code, message: diagnostic.message };
    saveTimelineEvent(this.database, {
      eventId: `timeline-diagnostic:${diagnostic.diagnosticId}`,
      runId: diagnostic.runId,
      sessionId: diagnostic.sessionId,
      eventType: 'timeline.commit.diagnostic',
      createdAt: diagnostic.createdAt,
      payload: diagnostic,
    });
    saveTimelineEvent(this.database, {
      eventId: `timeline-commit:${diagnostic.runId}`,
      runId: diagnostic.runId,
      sessionId: diagnostic.sessionId,
      eventType: 'timeline.commit',
      createdAt: diagnostic.createdAt,
      payload: {
        runId: diagnostic.runId,
        projectId: diagnostic.projectId,
        sessionId: diagnostic.sessionId,
        status: 'failed',
        updatedAt: diagnostic.createdAt,
        error,
      } satisfies TimelineRunCommitRecord,
    });
    return diagnostic;
  }

  listCommitDiagnostics(runId: string): TimelineCommitDiagnostic[] {
    return (this.database.prepare(`
      SELECT payload_json
      FROM agent_loop_events
      WHERE run_id = ? AND event_type = 'timeline.commit.diagnostic'
      ORDER BY created_at ASC, event_id ASC
    `).all(runId) as EventPayloadRow[])
      .map((row) => parseJson<TimelineCommitDiagnostic>(row.payload_json))
      .filter((diagnostic): diagnostic is TimelineCommitDiagnostic => Boolean(diagnostic));
  }
}

function saveTimelineEvent(database: MegumiDatabase, input: {
  eventId: string;
  runId: string;
  sessionId: string;
  eventType: string;
  createdAt: string;
  payload: unknown;
}): void {
  const existing = database.prepare('SELECT sequence FROM agent_loop_events WHERE event_id = ?')
    .get(input.eventId) as { sequence: number } | undefined;
  const sequence = existing?.sequence ?? nextSequence(database, input.runId);
  database.prepare(`
    INSERT INTO agent_loop_events (
      event_id, run_id, session_id, sequence, event_type, visibility,
      created_at, payload_json, event_json
    ) VALUES (
      @event_id, @run_id, @session_id, @sequence, @event_type, 'internal',
      @created_at, @payload_json, @event_json
    )
    ON CONFLICT(event_id) DO UPDATE SET
      payload_json = excluded.payload_json,
      event_json = excluded.event_json
  `).run({
    event_id: input.eventId,
    run_id: input.runId,
    session_id: input.sessionId,
    sequence,
    event_type: input.eventType,
    created_at: input.createdAt,
    payload_json: stringifyJson(input.payload),
    event_json: stringifyJson({ ...input, sequence, visibility: 'internal' }),
  });
}

function timelineRunExists(database: MegumiDatabase, runId: string): boolean {
  return Boolean(database.prepare('SELECT 1 FROM agent_loop_runs WHERE run_id = ?').get(runId));
}

function branchSeparatorMessagesBySession(
  database: MegumiDatabase,
  input: { projectId: string; sessionId: string },
): TimelineMessage[] {
  const rows = database.prepare(`
    SELECT entry_id, message_id, created_at, metadata_json
    FROM session_entries
    WHERE session_id = ?
      AND entry_kind = 'branch_marker'
    ORDER BY created_at ASC, entry_id ASC
  `).all(input.sessionId) as Array<{
    entry_id: string;
    message_id: string | null;
    created_at: string;
    metadata_json: string | null;
  }>;

  return rows
    .map((row) => {
      const marker = parseJson<{ compatBranchMarker?: SessionBranchMarker }>(row.metadata_json)?.compatBranchMarker;
      const sourceMessageId = marker?.seedSourceRef?.sourceKind === 'session_message'
        ? marker.seedSourceRef.sourceId
        : row.message_id;
      if (!marker || !sourceMessageId) {
        return undefined;
      }
      const sourceMessage = database.prepare('SELECT created_at FROM session_messages WHERE message_id = ?')
        .get(sourceMessageId) as { created_at: string } | undefined;
      const label = formatBranchDraftTime(sourceMessage?.created_at ?? marker.createdAt);
      const message = {
        messageId: `separator:${marker.branchMarkerId}`,
        role: 'separator',
        projectId: input.projectId,
        sessionId: input.sessionId,
        createdAt: marker.createdAt,
        updatedAt: marker.createdAt,
        blocks: [{
          blockId: `branch-separator:${marker.branchMarkerId}`,
          kind: 'branch_separator',
          branchMarkerId: marker.branchMarkerId,
          sourceMessageId,
          label,
          createdAt: marker.createdAt,
          updatedAt: marker.createdAt,
        }],
      };
      const parsed = TimelineMessageSchema.safeParse(message);
      return parsed.success ? parsed.data : undefined;
    })
    .filter((message): message is TimelineMessage => Boolean(message));
}

function formatBranchDraftTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return 'Branch from message';
  }
  return `Branch from ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function parseTimelineMessage(row: SessionMessageRow, projectId: string):
  | { ok: true; message: TimelineMessage }
  | { ok: false; message: string }
  | { ok: false; skip: true } {
  try {
    const message = parseJson<{ timelineMessage?: unknown }>(row.metadata_json)?.timelineMessage;
    if (!message) {
      if (row.role === 'separator' && row.blocks_json) {
        const reconstructed = {
          messageId: row.message_id,
          projectId,
          sessionId: row.session_id,
          role: 'separator',
          createdAt: row.created_at,
          updatedAt: row.completed_at ?? row.created_at,
          blocks: parseJson<unknown[]>(row.blocks_json),
        };
        const reconstructedResult = TimelineMessageSchema.safeParse(reconstructed);
        return reconstructedResult.success
          ? { ok: true, message: reconstructedResult.data }
          : { ok: false, message: 'Persisted timeline message failed schema validation.' };
      }
      if (row.role === 'user') {
        const reconstructed = {
          messageId: row.message_id,
          projectId,
          sessionId: row.session_id,
          role: 'user',
          runId: row.run_id ?? undefined,
          createdAt: row.created_at,
          updatedAt: row.completed_at ?? row.created_at,
          blocks: row.blocks_json ? parseJson<unknown[]>(row.blocks_json) : [{
            blockId: `${row.message_id}:text`,
            kind: 'user_text',
            text: row.content_text,
            format: 'plain',
          }],
        };
        const reconstructedResult = TimelineMessageSchema.safeParse(reconstructed);
        return reconstructedResult.success
          ? { ok: true, message: reconstructedResult.data }
          : { ok: false, message: 'Persisted user message failed schema validation.' };
      }
      if (row.role === 'assistant' && row.run_id) {
        const reconstructed = {
          messageId: row.message_id,
          projectId,
          sessionId: row.session_id,
          role: 'assistant',
          runId: row.run_id,
          createdAt: row.created_at,
          updatedAt: row.completed_at ?? row.created_at,
          blocks: row.blocks_json ? parseJson<unknown[]>(row.blocks_json) : [{
            blockId: `${row.message_id}:answer`,
            kind: 'answer_text',
            runId: row.run_id,
            textId: `${row.message_id}:answer`,
            status: 'completed',
            text: row.content_text,
            format: 'markdown',
          }],
        };
        const reconstructedResult = TimelineMessageSchema.safeParse(reconstructed);
        return reconstructedResult.success
          ? { ok: true, message: reconstructedResult.data }
          : { ok: false, message: 'Persisted assistant message failed schema validation.' };
      }
      return { ok: false, skip: true };
    }
    const result = TimelineMessageSchema.safeParse(message);
    if (!result.success) {
      return { ok: false, message: 'Persisted timeline message failed schema validation.' };
    }
    return { ok: true, message: result.data };
  } catch {
    return { ok: false, message: 'Persisted timeline message JSON could not be parsed.' };
  }
}

function validateCommitOwnership(input: TimelineCommitInput, messages: TimelineMessage[]): void {
  for (const message of messages) {
    const runId = messageRunId(message);
    if (
      message.projectId !== input.projectId ||
      String(message.sessionId) !== input.sessionId ||
      (runId && runId !== input.runId)
    ) {
      throw new Error('Timeline commit message ownership mismatch.');
    }
  }
}

function timelineContentText(message: TimelineMessage): string {
  const textBlocks = message.blocks
    .map((block) => {
      if ('text' in block && typeof block.text === 'string') {
        return block.text;
      }
      if ('status' in block && typeof block.status === 'string') {
        return block.status;
      }
      return block.kind;
    })
    .filter(Boolean);
  return textBlocks.join('\n') || message.role;
}

function messageRunId(message: TimelineMessage): string {
  return message.role === 'assistant' || message.role === 'user'
    ? String(message.runId ?? '')
    : '';
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

function nextSequence(database: MegumiDatabase, runId: string): number {
  const row = database.prepare('SELECT COALESCE(MIN(sequence), 0) - 1 AS next_sequence FROM agent_loop_events WHERE run_id = ?')
    .get(runId) as { next_sequence: number };
  return row.next_sequence;
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value);
}

function parseJson<T>(value: string | null | undefined): T | undefined {
  return value ? JSON.parse(value) as T : undefined;
}
}



export import ModelCallRecord = AgentLoopRepositoryParts.ModelCallRecord;

export import RunNeedingTimelineBackfill = AgentLoopRepositoryParts.RunNeedingTimelineBackfill;

export import TimelineHydrationDiagnostic = AgentLoopRepositoryParts.TimelineHydrationDiagnostic;

export import TimelineCommitDiagnostic = AgentLoopRepositoryParts.TimelineCommitDiagnostic;

export import TimelineRunCommitRecord = AgentLoopRepositoryParts.TimelineRunCommitRecord;

export import TimelineCommitInput = AgentLoopRepositoryParts.TimelineCommitInput;

export interface CreateRunForUserMessageInput {
  runId: string;
  workspaceId: string;
  sessionId: string;
  userMessageId: string;
  createdAt: string;
  permissionMode?: string;
  runKind?: string;
  baseRunId?: string | null;
  baseMessageId?: string | null;
  baseEntryId?: string | null;
  attemptNumber?: number;
}

export type CreateRunInput = CreateRunForUserMessageInput;

function permissionSnapshotRefFromJson(value: string): string | undefined {
  const parsed = JSON.parse(value) as { ref?: string; permissionSnapshotId?: string };
  return parsed?.ref ?? parsed?.permissionSnapshotId;
}

export interface RecordModelCallInput {
  modelCallId: string;
  runId: string;
  providerId: string;
  modelId: string;
  status: string;
  startedAt: string;
  completedAt?: string | null;
  requestJson?: string | null;
  responseJson?: string | null;
}

export interface RecordAgentLoopEventInput {
  eventId: string;
  runId: string;
  sessionId: string;
  eventType: string;
  createdAt: string;
  payloadJson?: string;
  visibility?: string;
}

export interface CompleteRunWithAssistantMessageInput {
  runId: string;
  messageId: string;
  sessionId: string;
  contentText: string;
  completedAt: string;
  blocksJson?: string | null;
}

export interface MarkRunCompletedInput {
  runId: string;
  assistantMessageId: string;
  completedAt: string;
}

export interface RecordToolRegistrySnapshotInput extends ToolRegistrySnapshot {}

export class AgentLoopRepository {
  constructor(private readonly database: MegumiDatabase) {}

  createRun(input: CreateRunInput): { runId: string } {
    this.database.prepare(`
      INSERT INTO agent_loop_runs (
        run_id, workspace_id, session_id, run_kind, user_message_id, assistant_message_id,
        base_run_id, base_message_id, base_entry_id, attempt_number, status, permission_mode,
        permission_snapshot_json, memory_recall_trace_id, started_at, completed_at, cancelled_at,
        error_json, created_at, metadata_json
      ) VALUES (
        @run_id, @workspace_id, @session_id, @run_kind, @user_message_id, NULL,
        @base_run_id, @base_message_id, @base_entry_id, @attempt_number, 'running', @permission_mode,
        NULL, NULL, @created_at, NULL, NULL,
        NULL, @created_at, NULL
      )
    `).run({
      run_id: input.runId,
      workspace_id: input.workspaceId,
      session_id: input.sessionId,
      run_kind: input.runKind ?? 'normal',
      user_message_id: input.userMessageId,
      base_run_id: input.baseRunId ?? null,
      base_message_id: input.baseMessageId ?? null,
      base_entry_id: input.baseEntryId ?? null,
      attempt_number: input.attemptNumber ?? 1,
      permission_mode: input.permissionMode ?? 'default',
      created_at: input.createdAt,
    });

    return { runId: input.runId };
  }

  createRunForUserMessage(input: CreateRunForUserMessageInput): { runId: string } {
    this.createRun(input);
    return {
      runId: input.runId,
    };
  }

  recordModelCall(input: RecordModelCallInput): { modelCallId: string; callOrder: number } {
    const callOrder = this.nextCallOrder(input.runId);
    this.database.prepare(`
      INSERT INTO model_calls (
        model_call_id, run_id, call_order, provider_id, model_id, status,
        input_summary_json, context_snapshot_json, request_json, response_json,
        output_summary_json, token_usage_json, started_at, completed_at, error_json, metadata_json
      ) VALUES (
        @model_call_id, @run_id, @call_order, @provider_id, @model_id, @status,
        NULL, NULL, @request_json, @response_json,
        NULL, NULL, @started_at, @completed_at, NULL, NULL
      )
    `).run({
      model_call_id: input.modelCallId,
      run_id: input.runId,
      call_order: callOrder,
      provider_id: input.providerId,
      model_id: input.modelId,
      status: input.status,
      request_json: input.requestJson ?? null,
      response_json: input.responseJson ?? null,
      started_at: input.startedAt,
      completed_at: input.completedAt ?? null,
    });

    return {
      modelCallId: input.modelCallId,
      callOrder,
    };
  }

  recordEvent(input: RecordAgentLoopEventInput): { eventId: string; sequence: number } {
    const sequence = this.nextEventSequence(input.runId);
    this.database.prepare(`
      INSERT INTO agent_loop_events (
        event_id, run_id, session_id, sequence, event_type, visibility,
        created_at, payload_json, event_json
      ) VALUES (
        @event_id, @run_id, @session_id, @sequence, @event_type, @visibility,
        @created_at, @payload_json, @event_json
      )
    `).run({
      event_id: input.eventId,
      run_id: input.runId,
      session_id: input.sessionId,
      sequence,
      event_type: input.eventType,
      visibility: input.visibility ?? 'internal',
      created_at: input.createdAt,
      payload_json: input.payloadJson ?? '{}',
      event_json: input.payloadJson ?? '{}',
    });

    return {
      eventId: input.eventId,
      sequence,
    };
  }

  completeRunWithAssistantMessage(input: CompleteRunWithAssistantMessageInput): { messageId: string; pathNodeId: string } {
    this.markRunCompleted({
      runId: input.runId,
      assistantMessageId: input.messageId,
      completedAt: input.completedAt,
    });
    return {
      messageId: input.messageId,
      pathNodeId: `${input.messageId}:path`,
    };
  }

  markRunCompleted(input: MarkRunCompletedInput): void {
    this.database.prepare(`
      UPDATE agent_loop_runs
      SET assistant_message_id = @assistant_message_id,
          status = 'completed',
          completed_at = @completed_at
      WHERE run_id = @run_id
    `).run({
      assistant_message_id: input.assistantMessageId,
      completed_at: input.completedAt,
      run_id: input.runId,
    });
  }

  saveToolRegistrySnapshot(snapshot: RecordToolRegistrySnapshotInput): ToolRegistrySnapshot {
    const workspaceId = this.workspaceIdForRun(snapshot.runId);
    this.database.prepare(`
      INSERT INTO tool_registry_snapshots (
        snapshot_id, run_id, workspace_id, tool_count, snapshot_json, created_at, metadata_json
      ) VALUES (
        @snapshot_id, @run_id, @workspace_id, @tool_count, @snapshot_json, @created_at, @metadata_json
      )
      ON CONFLICT(snapshot_id) DO UPDATE SET
        run_id = excluded.run_id,
        workspace_id = excluded.workspace_id,
        tool_count = excluded.tool_count,
        snapshot_json = excluded.snapshot_json,
        created_at = excluded.created_at,
        metadata_json = excluded.metadata_json
    `).run({
      snapshot_id: snapshot.snapshotId,
      run_id: snapshot.runId,
      workspace_id: workspaceId,
      tool_count: snapshot.entries.length,
      snapshot_json: JSON.stringify(snapshot),
      created_at: snapshot.createdAt,
      metadata_json: JSON.stringify({
        projectId: snapshot.projectId,
        permissionMode: snapshot.permissionMode,
        modelId: snapshot.modelId,
        registryVersion: snapshot.registryVersion,
        sourceVersionHash: snapshot.sourceVersionHash,
        sourceEntries: snapshot.sourceEntries,
      }),
    });

    return snapshot;
  }

  getToolRegistrySnapshotByRun(runId: string): ToolRegistrySnapshot | undefined {
    const row = this.database.prepare(`
      SELECT snapshot_json
      FROM tool_registry_snapshots
      WHERE run_id = ?
    `).get(runId) as { snapshot_json: string } | undefined;
    return row ? JSON.parse(row.snapshot_json) as ToolRegistrySnapshot : undefined;
  }

  private nextCallOrder(runId: string): number {
    const row = this.database.prepare(`
      SELECT COALESCE(MAX(call_order), 0) + 1 AS next_call_order
      FROM model_calls
      WHERE run_id = ?
    `).get(runId) as { next_call_order: number };
    return row.next_call_order;
  }

  private nextEventSequence(runId: string): number {
    const row = this.database.prepare(`
      SELECT COALESCE(MAX(CASE WHEN sequence > 0 THEN sequence ELSE 0 END), 0) + 1 AS next_sequence
      FROM agent_loop_events
      WHERE run_id = ?
    `).get(runId) as { next_sequence: number };
    return row.next_sequence;
  }

  private listImplementationPlans(): ImplementationPlanArtifactRecord[] {
    const rows = this.database.prepare(`
      SELECT metadata_json
      FROM agent_loop_runs
      WHERE metadata_json IS NOT NULL
    `).all() as Array<{ metadata_json: string | null }>;
    return rows
      .map((row) => row.metadata_json
        ? (JSON.parse(row.metadata_json) as { implementationPlan?: ImplementationPlanArtifactRecord }).implementationPlan
        : undefined)
      .filter((plan): plan is ImplementationPlanArtifactRecord => Boolean(plan));
  }

  private workspaceIdForRun(runId: string): string | null {
    const row = this.database.prepare('SELECT workspace_id FROM agent_loop_runs WHERE run_id = ?')
      .get(runId) as { workspace_id: string | null } | undefined;
    return row?.workspace_id ?? null;
  }
}

export interface AgentLoopRepository
  extends Pick<AgentLoopRepositoryParts.AgentLoopRunRecordMethods, keyof AgentLoopRepositoryParts.AgentLoopRunRecordMethods>,
    Pick<AgentLoopRepositoryParts.AgentLoopModelCallMethods, keyof AgentLoopRepositoryParts.AgentLoopModelCallMethods>,
    Pick<AgentLoopRepositoryParts.AgentLoopRuntimeEventMethods, keyof AgentLoopRepositoryParts.AgentLoopRuntimeEventMethods>,
    Pick<AgentLoopRepositoryParts.AgentLoopExecutionFactMethods, keyof AgentLoopRepositoryParts.AgentLoopExecutionFactMethods>,
    Pick<AgentLoopRepositoryParts.AgentLoopContextMethods, keyof AgentLoopRepositoryParts.AgentLoopContextMethods>,
    Pick<AgentLoopRepositoryParts.AgentLoopRecoveryMethods, keyof AgentLoopRepositoryParts.AgentLoopRecoveryMethods>,
    Pick<
      AgentLoopRepositoryParts.AgentLoopPermissionSnapshotMethods,
      keyof AgentLoopRepositoryParts.AgentLoopPermissionSnapshotMethods
    >,
    Pick<AgentLoopRepositoryParts.AgentLoopTimelineMessageMethods, keyof AgentLoopRepositoryParts.AgentLoopTimelineMessageMethods> {}

copyRepositoryMethods(AgentLoopRepository, [
  AgentLoopRepositoryParts.AgentLoopRunRecordMethods,
  AgentLoopRepositoryParts.AgentLoopModelCallMethods,
  AgentLoopRepositoryParts.AgentLoopRuntimeEventMethods,
  AgentLoopRepositoryParts.AgentLoopExecutionFactMethods,
  AgentLoopRepositoryParts.AgentLoopContextMethods,
  AgentLoopRepositoryParts.AgentLoopRecoveryMethods,
  AgentLoopRepositoryParts.AgentLoopPermissionSnapshotMethods,
  AgentLoopRepositoryParts.AgentLoopTimelineMessageMethods,
]);

function copyRepositoryMethods(
  target: { prototype: object },
  sources: Array<{ prototype: object }>,
): void {
  for (const source of sources) {
    for (const name of Object.getOwnPropertyNames(source.prototype)) {
      if (name === 'constructor' || name in target.prototype) {
        continue;
      }
      const descriptor = Object.getOwnPropertyDescriptor(source.prototype, name);
      if (descriptor) {
        Object.defineProperty(target.prototype, name, descriptor);
      }
    }
  }
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

