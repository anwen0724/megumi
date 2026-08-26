/*
 * Stores rebuildable Trace metadata and Journal checkpoints through DatabaseConnection only.
 */
import type {
  DatabaseConnection,
  DatabaseRow,
  DatabaseValue,
} from '@megumi/database';
import type { TraceListQuery } from '../query/trace-query';
import type { TraceProjection } from '../query/trace-projector';

export const TRACE_INDEX_SCHEMA_VERSION = 1;

const SCALAR_CORRELATION_KEYS = [
  'requestId',
  'executionId',
  'sessionId',
  'messageId',
  'workspaceId',
  'batchId',
  'compactionId',
  'modelCallId',
  'toolCallId',
  'sourceId',
  'candidateId',
  'recommendationId',
  'contentId',
  'contentDigest',
  'providerAttempt',
  'discoveryAttempt',
] as const;

export interface JournalCheckpoint {
  readonly filePath: string;
  readonly size: number;
  readonly modifiedAtMs: number;
}

export interface TraceIndex {
  /** Opens or rebuilds the metadata schema when it is absent or incompatible. */
  initialize(): { readonly status: 'ready' | 'rebuilt' };
  /** Atomically replaces all projections and source checkpoints from Journal truth. */
  replace(input: {
    readonly traces: readonly TraceProjection[];
    readonly checkpoints: readonly JournalCheckpoint[];
  }): void;
  /** Returns matching Trace IDs in reverse chronological order. */
  queryTraceIds(query: TraceListQuery): readonly string[];
  /** Verifies that every retained Journal file still matches the indexed checkpoint. */
  matchesCheckpoints(checkpoints: readonly JournalCheckpoint[]): boolean;
  /** Prunes metadata whose complete source Journal group is no longer retained. */
  prune(input: { readonly retainedJournalPaths: readonly string[] }): Promise<void>;
}

export interface CreateTraceIndexOptions {
  readonly database: DatabaseConnection;
}

interface SchemaVersionRow extends DatabaseRow {
  readonly schema_version: number;
}

interface TraceIdRow extends DatabaseRow {
  readonly trace_id: string;
}

interface CheckpointRow extends DatabaseRow {
  readonly file_path: string;
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
          for (const trace of input.traces) insertTraceProjection(options.database, trace);
          for (const checkpoint of input.checkpoints) insertCheckpoint(options.database, checkpoint);
        },
      });
    },

    queryTraceIds(query) {
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
      if (query.correlation) {
        for (const key of SCALAR_CORRELATION_KEYS) {
          const value = query.correlation[key];
          if (value === undefined) continue;
          conditions.push('EXISTS (SELECT 1 FROM correlations r WHERE r.trace_id = t.trace_id AND r.key = ? AND r.value = ?)');
          parameters.push(key, String(value));
        }
        for (const recommendationId of query.correlation.recommendationIds ?? []) {
          conditions.push('EXISTS (SELECT 1 FROM correlations r WHERE r.trace_id = t.trace_id AND r.key = ? AND r.value = ?)');
          parameters.push('recommendationIds', recommendationId);
        }
      }
      const limit = Math.max(1, Math.min(query.limit ?? 200, 200));
      parameters.push(limit);
      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      return options.database.prepare<TraceIdRow>({
        sql: `SELECT DISTINCT t.trace_id FROM traces t ${where} ORDER BY t.started_at DESC, t.trace_id ASC LIMIT ?`,
      }).all(parameters).map((row) => row.trace_id);
    },

    matchesCheckpoints(checkpoints) {
      const rows = options.database.prepare<CheckpointRow>({
        sql: 'SELECT file_path, size, modified_at_ms FROM journal_checkpoints ORDER BY file_path',
      }).all();
      if (rows.length !== checkpoints.length) return false;
      const expected = [...checkpoints].sort((left, right) => left.filePath.localeCompare(right.filePath));
      return rows.every((row, index) => {
        const checkpoint = expected[index];
        return checkpoint
          ? row.file_path === checkpoint.filePath
            && row.size === checkpoint.size
            && row.modified_at_ms === checkpoint.modifiedAtMs
          : false;
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
      'traces',
      'spans',
      'links',
      'contents',
      'correlations',
      'journal_checkpoints',
      'trace_sources',
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
        'trace_sources',
        'journal_checkpoints',
        'correlations',
        'contents',
        'links',
        'spans',
        'traces',
        'observability_index_meta',
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
    'trace_sources',
    'journal_checkpoints',
    'correlations',
    'contents',
    'links',
    'spans',
    'traces',
  ]) {
    database.prepare({ sql: `DELETE FROM ${table}` }).run();
  }
}

/** Inserts only metadata; inline values and stored bytes never cross this boundary. */
function insertTraceProjection(database: DatabaseConnection, trace: TraceProjection): void {
  database.prepare({
    sql: `INSERT INTO traces (
      trace_id, trace_kind, status, diagnostics, started_at, ended_at, outcome_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  }).run([
    trace.traceId,
    trace.traceKind,
    trace.status,
    trace.diagnostics,
    trace.startedAt ?? null,
    trace.endedAt ?? null,
    trace.recordedOutcome?.status ?? null,
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
      trace.traceId,
      span.spanId,
      span.parentSpanId ?? null,
      span.name,
      span.startedAt,
      span.endedAt ?? null,
      span.outcome?.status ?? null,
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
      trace.traceId,
      content.sequence,
      content.spanId ?? null,
      content.kind,
      content.content.mode,
      contentId,
      mediaType,
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

function insertCheckpoint(database: DatabaseConnection, checkpoint: JournalCheckpoint): void {
  database.prepare({
    sql: `INSERT INTO journal_checkpoints (
      file_path, size, modified_at_ms
    ) VALUES (?, ?, ?)`,
  }).run([checkpoint.filePath, checkpoint.size, checkpoint.modifiedAtMs]);
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
    outcome_status TEXT
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
  `CREATE TABLE journal_checkpoints (
    file_path TEXT PRIMARY KEY,
    size INTEGER NOT NULL,
    modified_at_ms REAL NOT NULL
  )`,
  `CREATE TABLE trace_sources (
    trace_id TEXT NOT NULL REFERENCES traces(trace_id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    PRIMARY KEY (trace_id, file_path)
  )`,
  'CREATE INDEX spans_name_idx ON spans(name)',
  'CREATE INDEX contents_kind_idx ON contents(kind)',
  'CREATE INDEX correlations_lookup_idx ON correlations(key, value, trace_id)',
] as const;
