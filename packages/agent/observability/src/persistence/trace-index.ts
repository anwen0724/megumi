/*
 * Owns the disposable SQLite query index for Trace summaries and Journal record locations.
 */
import type { DatabaseConnection, DatabaseRow, DatabaseValue } from '@megumi/database';
import type { TraceListQuery, TraceSummaryProjection } from '../query/trace-query';
import type { TraceProjection } from '../query/trace-projector';
import type { TraceCorrelation } from '../trace/trace-contract';

export const TRACE_INDEX_SCHEMA_VERSION = 3;

const STRING_CORRELATION_KEYS = [
  'requestId', 'executionId', 'sessionId', 'messageId', 'workspaceId', 'batchId',
  'compactionId', 'modelCallId', 'toolCallId', 'sourceId', 'candidateId',
  'recommendationId', 'contentId', 'contentDigest',
] as const;
const NUMBER_CORRELATION_KEYS = ['providerAttempt', 'discoveryAttempt'] as const;
const SCALAR_CORRELATION_KEYS = [
  ...STRING_CORRELATION_KEYS,
  ...NUMBER_CORRELATION_KEYS,
] as const;

export interface JournalCheckpoint {
  readonly filePath: string;
  /** Last byte ending in a fully indexed newline-delimited record. */
  readonly consumedBytes: number;
  readonly size: number;
  readonly modifiedAtMs: number;
}

export interface TraceRecordLocator {
  readonly traceId: string;
  readonly sequence?: number;
  readonly filePath: string;
  readonly byteOffset: number;
  readonly byteLength: number;
}

interface TraceIndexMutation {
  readonly traces: readonly TraceProjection[];
  readonly records: readonly TraceRecordLocator[];
  readonly checkpoints: readonly JournalCheckpoint[];
}

export interface TraceIndex {
  /** Opens or rebuilds the metadata schema when it is absent or incompatible. */
  initialize(): { readonly status: 'ready' | 'rebuilt' };
  /** Atomically replaces every disposable projection from Journal truth. */
  replace(input: TraceIndexMutation): void;
  /** Atomically applies newly consumed records and replaces only affected Trace projections. */
  apply(input: TraceIndexMutation): void;
  /** Returns matching Trace summaries in reverse chronological order. */
  queryTraces(query: TraceListQuery): readonly TraceSummaryProjection[];
  /** Returns exact Journal locations for reconstructing one Trace. */
  getRecordLocators(traceId: string): readonly TraceRecordLocator[];
  /** Returns the last successfully consumed position for every indexed Journal file. */
  readCheckpoints(): readonly JournalCheckpoint[];
  /** Verifies exact checkpoints for strict snapshot comparisons. */
  matchesCheckpoints(checkpoints: readonly JournalCheckpoint[]): boolean;
  /** Prunes metadata whose source Journal files are no longer retained. */
  prune(input: { readonly retainedJournalPaths: readonly string[] }): Promise<void>;
}

export interface CreateTraceIndexOptions {
  readonly database: DatabaseConnection;
}

interface SchemaVersionRow extends DatabaseRow { readonly schema_version: number }
interface TraceSummaryRow extends DatabaseRow {
  readonly trace_id: string;
  readonly trace_kind: string;
  readonly status: string;
  readonly diagnostics: string;
  readonly started_at: string | null;
  readonly ended_at: string | null;
  readonly span_count: number;
  readonly event_count: number;
  readonly content_count: number;
  readonly issue_count: number;
}
interface CorrelationRow extends DatabaseRow {
  readonly trace_id: string;
  readonly key: string;
  readonly value: string;
}
interface RecordLocatorRow extends DatabaseRow {
  readonly trace_id: string;
  readonly sequence: number | null;
  readonly file_path: string;
  readonly byte_offset: number;
  readonly byte_length: number;
}
interface CheckpointRow extends DatabaseRow {
  readonly file_path: string;
  readonly consumed_bytes: number;
  readonly size: number;
  readonly modified_at_ms: number;
}

/** Creates a disposable SQLite acceleration index without owning the connection lifecycle. */
export function createTraceIndex(options: CreateTraceIndexOptions): TraceIndex {
  return {
    initialize() {
      if (schemaIsReady(options.database)) return { status: 'ready' };
      rebuildSchema(options.database);
      return { status: 'rebuilt' };
    },

    replace(input) {
      options.database.transaction({
        operation: () => {
          clearProjectionTables(options.database);
          insertMutation(options.database, input);
        },
      });
    },

    apply(input) {
      options.database.transaction({
        operation: () => {
          for (const trace of input.traces) deleteTraceProjection(options.database, trace.traceId);
          insertMutation(options.database, input);
        },
      });
    },

    queryTraces(query) {
      return queryTraceSummaries(options.database, query);
    },

    getRecordLocators(traceId) {
      return options.database.prepare<RecordLocatorRow>({
        sql: `SELECT trace_id, sequence, file_path, byte_offset, byte_length
          FROM journal_records WHERE trace_id = ?
          ORDER BY COALESCE(sequence, 2147483647), file_path, byte_offset`,
      }).all([traceId]).map(projectRecordLocator);
    },

    readCheckpoints() {
      return options.database.prepare<CheckpointRow>({
        sql: `SELECT file_path, consumed_bytes, size, modified_at_ms
          FROM journal_checkpoints ORDER BY file_path`,
      }).all().map(projectCheckpoint);
    },

    matchesCheckpoints(checkpoints) {
      const actual = this.readCheckpoints();
      const expected = [...checkpoints].sort((left, right) => left.filePath.localeCompare(right.filePath));
      return actual.length === expected.length && actual.every((checkpoint, index) => {
        const candidate = expected[index];
        return candidate !== undefined
          && checkpoint.filePath === candidate.filePath
          && checkpoint.consumedBytes === candidate.consumedBytes
          && checkpoint.size === candidate.size
          && checkpoint.modifiedAtMs === candidate.modifiedAtMs;
      });
    },

    async prune(input) {
      options.database.transaction({
        operation: () => {
          if (input.retainedJournalPaths.length === 0) {
            clearProjectionTables(options.database);
            return;
          }
          const placeholders = input.retainedJournalPaths.map(() => '?').join(', ');
          options.database.prepare({
            sql: `DELETE FROM journal_records WHERE file_path NOT IN (${placeholders})`,
          }).run(input.retainedJournalPaths);
          options.database.prepare({
            sql: `DELETE FROM trace_sources WHERE file_path NOT IN (${placeholders})`,
          }).run(input.retainedJournalPaths);
          options.database.prepare({
            sql: 'DELETE FROM traces WHERE NOT EXISTS (SELECT 1 FROM trace_sources s WHERE s.trace_id = traces.trace_id)',
          }).run();
          options.database.prepare({
            sql: `DELETE FROM journal_checkpoints WHERE file_path NOT IN (${placeholders})`,
          }).run(input.retainedJournalPaths);
        },
      });
    },
  };
}

function schemaIsReady(database: DatabaseConnection): boolean {
  try {
    const row = database.prepare<SchemaVersionRow>({
      sql: 'SELECT schema_version FROM observability_index_meta LIMIT 1',
    }).get();
    if (row?.schema_version !== TRACE_INDEX_SCHEMA_VERSION) return false;
    for (const table of [
      'traces', 'spans', 'links', 'contents', 'correlations', 'journal_records',
      'journal_checkpoints', 'trace_sources',
    ]) {
      database.prepare({ sql: `SELECT 1 FROM ${table} LIMIT 0` });
    }
    return true;
  } catch {
    return false;
  }
}

/** Recreates every index-owned table because the Journal remains authoritative. */
function rebuildSchema(database: DatabaseConnection): void {
  database.transaction({
    operation: () => {
      for (const table of [
        'trace_sources', 'journal_checkpoints', 'journal_records', 'correlations',
        'contents', 'links', 'spans', 'traces', 'observability_index_meta',
      ]) {
        database.prepare({ sql: `DROP TABLE IF EXISTS ${table}` }).run();
      }
      for (const sql of INDEX_SCHEMA_STATEMENTS) database.prepare({ sql }).run();
      database.prepare({
        sql: 'INSERT INTO observability_index_meta (schema_version) VALUES (?)',
      }).run([TRACE_INDEX_SCHEMA_VERSION]);
    },
  });
}

function clearProjectionTables(database: DatabaseConnection): void {
  for (const table of [
    'trace_sources', 'journal_checkpoints', 'journal_records', 'correlations',
    'contents', 'links', 'spans', 'traces',
  ]) {
    database.prepare({ sql: `DELETE FROM ${table}` }).run();
  }
}

/** Applies one already projected Journal mutation inside the caller's transaction. */
function insertMutation(database: DatabaseConnection, input: TraceIndexMutation): void {
  for (const trace of input.traces) insertTraceProjection(database, trace);
  for (const record of input.records) insertRecordLocator(database, record);
  for (const checkpoint of input.checkpoints) upsertCheckpoint(database, checkpoint);
}

function deleteTraceProjection(database: DatabaseConnection, traceId: string): void {
  for (const table of ['trace_sources', 'correlations', 'contents', 'links', 'spans']) {
    database.prepare({ sql: `DELETE FROM ${table} WHERE trace_id = ?` }).run([traceId]);
  }
  database.prepare({ sql: 'DELETE FROM traces WHERE trace_id = ?' }).run([traceId]);
}

/** Inserts metadata only; inline values and stored bytes never cross this boundary. */
function insertTraceProjection(database: DatabaseConnection, trace: TraceProjection): void {
  const eventCount = trace.spans.reduce((count, span) => count + span.events.length, 0);
  database.prepare({
    sql: `INSERT INTO traces (
      trace_id, trace_kind, status, diagnostics, started_at, ended_at,
      span_count, event_count, content_count, issue_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  }).run([
    trace.traceId, trace.traceKind, trace.status, trace.diagnostics,
    trace.startedAt ?? null, trace.endedAt ?? null, trace.spans.length,
    eventCount, trace.contents.length, trace.issues.length,
  ]);
  for (const sourceFile of trace.sourceFiles) {
    database.prepare({
      sql: 'INSERT INTO trace_sources (trace_id, file_path) VALUES (?, ?)',
    }).run([trace.traceId, sourceFile]);
  }
  for (const span of trace.spans) {
    database.prepare({
      sql: `INSERT INTO spans (
        trace_id, span_id, parent_span_id, name, started_at, ended_at, outcome_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    }).run([
      trace.traceId, span.spanId, span.parentSpanId ?? null, span.name,
      span.startedAt, span.endedAt ?? null, span.outcome?.status ?? null,
    ]);
  }
  for (const link of trace.links) {
    database.prepare({
      sql: 'INSERT INTO links (trace_id, sequence, link_kind, target_trace_id) VALUES (?, ?, ?, ?)',
    }).run([trace.traceId, link.sequence, link.linkKind, link.targetTraceId]);
  }
  for (const content of trace.contents) {
    const contentId = content.content.mode === 'inline' || content.content.mode === 'stored'
      ? content.content.contentId
      : null;
    const mediaType = content.content.mode === 'inline' || content.content.mode === 'stored'
      ? content.content.mediaType
      : null;
    database.prepare({
      sql: `INSERT INTO contents (
        trace_id, sequence, span_id, kind, mode, content_id, media_type
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    }).run([
      trace.traceId, content.sequence, content.spanId ?? null, content.kind,
      content.content.mode, contentId, mediaType,
    ]);
  }
  for (const correlation of trace.correlations) {
    insertCorrelations(database, trace.traceId, correlation);
  }
}

function insertCorrelations(
  database: DatabaseConnection,
  traceId: string,
  correlation: TraceProjection['correlations'][number],
): void {
  const statement = database.prepare({
    sql: 'INSERT INTO correlations (trace_id, key, value) VALUES (?, ?, ?)',
  });
  for (const key of SCALAR_CORRELATION_KEYS) {
    const value = correlation[key];
    if (value !== undefined) statement.run([traceId, key, String(value)]);
  }
  for (const recommendationId of correlation.recommendationIds ?? []) {
    statement.run([traceId, 'recommendationIds', recommendationId]);
  }
}

function insertRecordLocator(database: DatabaseConnection, locator: TraceRecordLocator): void {
  database.prepare({
    sql: `INSERT OR IGNORE INTO journal_records (
      trace_id, sequence, file_path, byte_offset, byte_length
    ) VALUES (?, ?, ?, ?, ?)`,
  }).run([
    locator.traceId, locator.sequence ?? null, locator.filePath,
    locator.byteOffset, locator.byteLength,
  ]);
}

function upsertCheckpoint(database: DatabaseConnection, checkpoint: JournalCheckpoint): void {
  database.prepare({
    sql: `INSERT INTO journal_checkpoints (
      file_path, consumed_bytes, size, modified_at_ms
    ) VALUES (?, ?, ?, ?)
    ON CONFLICT(file_path) DO UPDATE SET
      consumed_bytes = excluded.consumed_bytes,
      size = excluded.size,
      modified_at_ms = excluded.modified_at_ms`,
  }).run([
    checkpoint.filePath, checkpoint.consumedBytes,
    checkpoint.size, checkpoint.modifiedAtMs,
  ]);
}

/** Queries list metadata without reconstructing Journal records or captured bodies. */
function queryTraceSummaries(
  database: DatabaseConnection,
  query: TraceListQuery,
): TraceSummaryProjection[] {
  const conditions: string[] = [];
  const parameters: DatabaseValue[] = [];
  addCondition(conditions, parameters, query.startedAtOrAfter, 't.started_at >= ?');
  addCondition(conditions, parameters, query.startedBefore, 't.started_at < ?');
  addCondition(conditions, parameters, query.traceKind, 't.trace_kind = ?');
  addCondition(conditions, parameters, query.status, 't.status = ?');
  if (query.spanName) {
    conditions.push('EXISTS (SELECT 1 FROM spans s WHERE s.trace_id = t.trace_id AND s.name = ?)');
    parameters.push(query.spanName);
  }
  if (query.contentKind) {
    conditions.push('EXISTS (SELECT 1 FROM contents c WHERE c.trace_id = t.trace_id AND c.kind = ?)');
    parameters.push(query.contentKind);
  }
  if (query.correlation) appendCorrelationConditions(conditions, parameters, query.correlation);
  const limit = Math.max(1, Math.min(query.limit ?? 200, 200));
  parameters.push(limit);
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = database.prepare<TraceSummaryRow>({
    sql: `SELECT t.trace_id, t.trace_kind, t.status, t.diagnostics,
      t.started_at, t.ended_at, t.span_count, t.event_count, t.content_count, t.issue_count
      FROM traces t ${where}
      ORDER BY t.started_at DESC, t.trace_id ASC LIMIT ?`,
  }).all(parameters);
  const correlations = loadCorrelations(database, rows.map((row) => row.trace_id));
  return rows.map((row) => ({
    traceId: row.trace_id,
    traceKind: parseTraceKind(row.trace_kind),
    status: parseTraceStatus(row.status),
    diagnostics: row.diagnostics === 'complete' ? 'complete' : 'incomplete',
    correlations: correlations.get(row.trace_id) ?? [],
    ...(row.started_at ? { startedAt: row.started_at } : {}),
    ...(row.ended_at ? { endedAt: row.ended_at } : {}),
    spanCount: row.span_count,
    eventCount: row.event_count,
    contentCount: row.content_count,
    issueCount: row.issue_count,
  }));
}

function appendCorrelationConditions(
  conditions: string[],
  parameters: DatabaseValue[],
  correlation: TraceCorrelation,
): void {
  for (const key of SCALAR_CORRELATION_KEYS) {
    const value = correlation[key];
    if (value === undefined) continue;
    conditions.push('EXISTS (SELECT 1 FROM correlations r WHERE r.trace_id = t.trace_id AND r.key = ? AND r.value = ?)');
    parameters.push(key, String(value));
  }
  for (const recommendationId of correlation.recommendationIds ?? []) {
    conditions.push('EXISTS (SELECT 1 FROM correlations r WHERE r.trace_id = t.trace_id AND r.key = ? AND r.value = ?)');
    parameters.push('recommendationIds', recommendationId);
  }
}

function loadCorrelations(
  database: DatabaseConnection,
  traceIds: readonly string[],
): ReadonlyMap<string, readonly TraceCorrelation[]> {
  if (traceIds.length === 0) return new Map();
  const placeholders = traceIds.map(() => '?').join(', ');
  const rows = database.prepare<CorrelationRow>({
    sql: `SELECT trace_id, key, value FROM correlations
      WHERE trace_id IN (${placeholders}) ORDER BY trace_id, rowid`,
  }).all(traceIds);
  const grouped = new Map<string, MutableCorrelation>();
  for (const row of rows) {
    const correlation = grouped.get(row.trace_id) ?? {};
    grouped.set(row.trace_id, correlation);
    if (isStringCorrelationKey(row.key)) {
      correlation[row.key] = row.value;
    } else if (row.key === 'providerAttempt' || row.key === 'discoveryAttempt') {
      const value = Number(row.value);
      if (Number.isInteger(value) && value > 0) correlation[row.key] = value;
    } else if (row.key === 'recommendationIds') {
      correlation.recommendationIds ??= [];
      if (!correlation.recommendationIds.includes(row.value)) {
        correlation.recommendationIds.push(row.value);
      }
    }
  }
  return new Map([...grouped].map(([traceId, correlation]) => [traceId, [correlation]]));
}

type MutableCorrelation = {
  -readonly [Key in Exclude<keyof TraceCorrelation, 'recommendationIds'>]?: TraceCorrelation[Key];
} & { recommendationIds?: string[] };

function isStringCorrelationKey(value: string): value is typeof STRING_CORRELATION_KEYS[number] {
  return STRING_CORRELATION_KEYS.some((key) => key === value);
}

function projectRecordLocator(row: RecordLocatorRow): TraceRecordLocator {
  return {
    traceId: row.trace_id,
    ...(row.sequence === null ? {} : { sequence: row.sequence }),
    filePath: row.file_path,
    byteOffset: row.byte_offset,
    byteLength: row.byte_length,
  };
}

function projectCheckpoint(row: CheckpointRow): JournalCheckpoint {
  return {
    filePath: row.file_path,
    consumedBytes: row.consumed_bytes,
    size: row.size,
    modifiedAtMs: row.modified_at_ms,
  };
}

function parseTraceKind(value: string): TraceSummaryProjection['traceKind'] {
  return value === 'conversation'
    || value === 'daily_recommendation'
    || value === 'candidate_supply'
    || value === 'preference_learning'
    ? value
    : 'unknown';
}

function parseTraceStatus(value: string): TraceSummaryProjection['status'] {
  return value === 'ok' || value === 'error' || value === 'cancelled' ? value : 'incomplete';
}

function addCondition(
  conditions: string[],
  parameters: DatabaseValue[],
  value: DatabaseValue | undefined,
  sql: string,
): void {
  if (value === undefined) return;
  conditions.push(sql);
  parameters.push(value);
}

const INDEX_SCHEMA_STATEMENTS = [
  'CREATE TABLE observability_index_meta (schema_version INTEGER NOT NULL)',
  `CREATE TABLE traces (
    trace_id TEXT PRIMARY KEY,
    trace_kind TEXT NOT NULL,
    status TEXT NOT NULL,
    diagnostics TEXT NOT NULL,
    started_at TEXT,
    ended_at TEXT,
    span_count INTEGER NOT NULL,
    event_count INTEGER NOT NULL,
    content_count INTEGER NOT NULL,
    issue_count INTEGER NOT NULL
  )`,
  `CREATE TABLE spans (
    trace_id TEXT NOT NULL REFERENCES traces(trace_id) ON DELETE CASCADE,
    span_id TEXT NOT NULL,
    parent_span_id TEXT,
    name TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    outcome_status TEXT,
    PRIMARY KEY (trace_id, span_id)
  )`,
  `CREATE TABLE links (
    trace_id TEXT NOT NULL REFERENCES traces(trace_id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL,
    link_kind TEXT NOT NULL,
    target_trace_id TEXT NOT NULL,
    PRIMARY KEY (trace_id, sequence)
  )`,
  `CREATE TABLE contents (
    trace_id TEXT NOT NULL REFERENCES traces(trace_id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL,
    span_id TEXT,
    kind TEXT NOT NULL,
    mode TEXT NOT NULL,
    content_id TEXT,
    media_type TEXT,
    PRIMARY KEY (trace_id, sequence)
  )`,
  `CREATE TABLE correlations (
    trace_id TEXT NOT NULL REFERENCES traces(trace_id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE journal_records (
    trace_id TEXT NOT NULL,
    sequence INTEGER,
    file_path TEXT NOT NULL,
    byte_offset INTEGER NOT NULL,
    byte_length INTEGER NOT NULL,
    PRIMARY KEY (file_path, byte_offset)
  )`,
  `CREATE TABLE journal_checkpoints (
    file_path TEXT PRIMARY KEY,
    consumed_bytes INTEGER NOT NULL,
    size INTEGER NOT NULL,
    modified_at_ms REAL NOT NULL
  )`,
  `CREATE TABLE trace_sources (
    trace_id TEXT NOT NULL REFERENCES traces(trace_id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    PRIMARY KEY (trace_id, file_path)
  )`,
  'CREATE INDEX traces_started_at_idx ON traces(started_at DESC)',
  'CREATE INDEX spans_name_idx ON spans(name)',
  'CREATE INDEX contents_kind_idx ON contents(kind)',
  'CREATE INDEX correlations_lookup_idx ON correlations(key, value, trace_id)',
  'CREATE INDEX journal_records_trace_idx ON journal_records(trace_id, sequence, file_path, byte_offset)',
] as const;
