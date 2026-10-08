/* Owns extraction claims, attempts, successful versions and the consolidation revision. */
import type { DatabaseConnection } from '../storage/index';
import type { MemorySourceSnapshot } from './source-contracts';
import type { ExtractionCoverage } from './extraction-input';
import type {
  ExtractionError,
  ExtractionJob,
  ExtractionOutput,
  ExtractionResult,
  ExtractionSourceFailure,
  SavedExtraction,
} from './extraction-contracts';

export interface ExtractionLease {
  readonly jobId: string;
  readonly ownerToken: string;
  readonly eligibilityVersion: number;
  readonly controlRevision: number;
  readonly sessionId: string;
  readonly sourceVersion: string;
}

type JobRow = {
  job_id: string;
  run_id: string;
  session_id: string;
  source_version: string;
  status: ExtractionJob['status'];
  attempt: number;
  retry_group_id: string;
  retry_of_job_id: string | null;
  retry_at: string | null;
  error_json: string | null;
  result_json: string | null;
};

function jobFromRow(row: JobRow): ExtractionJob {
  return {
    jobId: row.job_id,
    runId: row.run_id,
    sessionId: row.session_id,
    sourceVersion: row.source_version,
    status: row.status,
    attempt: row.attempt,
    retryGroupId: row.retry_group_id,
    ...(row.retry_of_job_id ? { retryOfJobId: row.retry_of_job_id } : {}),
    ...(row.retry_at ? { retryAt: row.retry_at } : {}),
    ...(row.error_json ? { error: JSON.parse(row.error_json) } : {}),
    ...(row.result_json ? { result: JSON.parse(row.result_json) } : {}),
  };
}

export function createExtractionStore(database: DatabaseConnection) {
  function isCurrent(lease: ExtractionLease, now: string): boolean {
    return !!database
      .prepare({
        sql: `SELECT j.job_id FROM memory_jobs j
      JOIN memory_sources s ON s.session_id = j.session_id CROSS JOIN memory_state m
      WHERE j.job_id = ? AND j.owner_token = ? AND j.status = 'running' AND j.lease_expires_at > ?
        AND s.eligibility = 'eligible' AND s.eligibility_version = ? AND m.control_revision = ? AND m.clear_pending = 0`,
      })
      .get([lease.jobId, lease.ownerToken, now, lease.eligibilityVersion, lease.controlRevision]);
  }
  const store = {
    beginRun(runId: string, now: string, retry: boolean): void {
      database
        .prepare({
          sql: `INSERT INTO memory_runs(run_id,kind,reason,status,target_revision,created_at)
        VALUES (?, 'extract', ?, 'running', (SELECT dirty_revision FROM memory_state WHERE id = 1), ?)`,
        })
        .run([runId, retry ? 'retry' : 'manual', now]);
    },
    claim(input: {
      runId: string;
      jobId: string;
      ownerToken: string;
      source: MemorySourceSnapshot;
      now: string;
      failedJobId?: string;
    }): ExtractionLease | undefined {
      return database.transaction({
        operation: () => {
          const source = input.source;
          database
            .prepare({
              sql: 'INSERT OR IGNORE INTO memory_sources(session_id,updated_at) VALUES (?,?)',
            })
            .run([source.sessionId, input.now]);
          const eligibility = database
            .prepare<{
              eligibility: string;
              eligibility_version: number;
            }>({
              sql: 'SELECT eligibility, eligibility_version FROM memory_sources WHERE session_id = ?',
            })
            .get([source.sessionId])!;
          const state = database
            .prepare<{
              control_revision: number;
              clear_pending: number;
            }>({ sql: 'SELECT control_revision, clear_pending FROM memory_state WHERE id = 1' })
            .get()!;
          if (eligibility.eligibility !== 'eligible' || state.clear_pending) return undefined;
          const saved = database
            .prepare({
              sql: 'SELECT 1 FROM memory_extractions WHERE session_id = ? AND source_version = ?',
            })
            .get([source.sessionId, source.sourceVersion]);
          if (saved) {
            const changed = database
              .prepare({
                sql: `INSERT INTO memory_current_extractions(session_id,source_version) VALUES (?,?)
            ON CONFLICT(session_id) DO UPDATE SET source_version = excluded.source_version
            WHERE source_version <> excluded.source_version`,
              })
              .run([source.sessionId, source.sourceVersion]).changes;
            if (changed)
              database
                .prepare({
                  sql: 'UPDATE memory_state SET dirty_revision = dirty_revision + 1 WHERE id = 1',
                })
                .run();
            return undefined;
          }
          const expired = database
            .prepare<{ run_id: string }>({
              sql: `UPDATE memory_jobs SET status = 'failed', completed_at = ?, retry_at = ?, error_json = ?
          WHERE stage = 'extract' AND status IN ('pending','running') AND lease_expires_at <= ? RETURNING run_id`,
            })
            .all([
              input.now,
              input.now,
              JSON.stringify({
                code: 'LEASE_EXPIRED',
                message: 'Extraction ownership expired.',
              }),
              input.now,
            ]);
          for (const runId of new Set(expired.map(job => job.run_id))) {
            if (
              runId !== input.runId &&
              !store.listJobs(runId).some(job => job.status === 'running')
            )
              store.finishRun(runId, input.now);
          }
          if (
            database
              .prepare({
                sql: "SELECT 1 FROM memory_jobs WHERE session_id = ? AND stage = 'extract' AND status IN ('pending','running')",
              })
              .get([source.sessionId])
          )
            return undefined;
          const active = database
            .prepare<{
              count: number;
            }>({ sql: "SELECT count(*) AS count FROM memory_jobs WHERE stage = 'extract' AND status IN ('pending','running')" })
            .get()!;
          if (active.count >= 8) return undefined;
          const latest = database
            .prepare<JobRow>({
              sql: "SELECT * FROM memory_jobs WHERE session_id = ? AND source_version = ? AND stage = 'extract' ORDER BY rowid DESC LIMIT 1",
            })
            .get([source.sessionId, source.sourceVersion]);
          let group = latest?.retry_group_id ?? input.jobId;
          let attempt = 1;
          if (input.failedJobId) {
            if (latest?.job_id !== input.failedJobId || latest.status !== 'failed')
              return undefined;
            group = input.jobId;
          } else if (latest) {
            const failures = database
              .prepare<{
                count: number;
                retry_at: string | null;
              }>({
                sql: "SELECT count(*) AS count, max(retry_at) AS retry_at FROM memory_jobs WHERE retry_group_id = ? AND status = 'failed'",
              })
              .get([group])!;
            if (failures.count >= 3 || (failures.retry_at && failures.retry_at > input.now))
              return undefined;
            attempt = failures.count + 1;
          }
          database
            .prepare({
              sql: `INSERT INTO memory_jobs(job_id,run_id,stage,session_id,source_version,status,attempt,owner_token,lease_expires_at,started_at,retry_group_id,retry_of_job_id)
          VALUES (?,?,'extract',?,?,'running',?,?,?,?,?,?)`,
            })
            .run([
              input.jobId,
              input.runId,
              source.sessionId,
              source.sourceVersion,
              attempt,
              input.ownerToken,
              new Date(Date.parse(input.now) + 3600000).toISOString(),
              input.now,
              group,
              input.failedJobId ?? null,
            ]);
          return {
            jobId: input.jobId,
            ownerToken: input.ownerToken,
            sessionId: source.sessionId,
            sourceVersion: source.sourceVersion,
            eligibilityVersion: eligibility.eligibility_version,
            controlRevision: state.control_revision,
          };
        },
      });
    },
    complete(input: {
      lease: ExtractionLease;
      source: MemorySourceSnapshot;
      output: ExtractionOutput;
      coverage: ExtractionCoverage;
      now: string;
      result: NonNullable<ExtractionJob['result']>;
    }): boolean {
      return database.transaction({
        operation: () => {
          if (
            input.source.sessionId !== input.lease.sessionId ||
            input.source.sourceVersion !== input.lease.sourceVersion ||
            !isCurrent(input.lease, input.now)
          )
            return false;
          database
            .prepare({
              sql: `INSERT INTO memory_extractions(session_id,source_version,workspace_id,source_updated_at,raw_memory,rollout_summary,rollout_slug,coverage_json,extracted_at)
          VALUES (?,?,?,?,?,?,?,?,?)`,
            })
            .run([
              input.source.sessionId,
              input.source.sourceVersion,
              input.source.workspaceId,
              input.source.contentUpdatedAt,
              input.output.rawMemory,
              input.output.rolloutSummary,
              input.output.rolloutSlug,
              JSON.stringify({
                ...input.coverage,
                sourceRef: input.source.sourceRef,
                branchId: input.source.branchId,
              }),
              input.now,
            ]);
          database
            .prepare({
              sql: `INSERT INTO memory_current_extractions(session_id,source_version) VALUES (?,?)
          ON CONFLICT(session_id) DO UPDATE SET source_version = excluded.source_version`,
            })
            .run([input.source.sessionId, input.source.sourceVersion]);
          database
            .prepare({
              sql: "UPDATE memory_jobs SET status = 'succeeded', completed_at = ?, result_json = ? WHERE job_id = ?",
            })
            .run([input.now, JSON.stringify(input.result), input.lease.jobId]);
          database
            .prepare({
              sql: 'UPDATE memory_state SET dirty_revision = dirty_revision + 1 WHERE id = 1',
            })
            .run();
          return true;
        },
      });
    },
    settle(
      lease: ExtractionLease,
      status: 'failed' | 'cancelled' | 'superseded',
      now: string,
      error: ExtractionError,
    ): void {
      database
        .prepare({
          sql: `UPDATE memory_jobs SET status = ?, completed_at = ?, error_json = ?, retry_at = ?
        WHERE job_id = ? AND owner_token = ? AND status = 'running'`,
        })
        .run([
          status,
          now,
          JSON.stringify(error),
          status === 'failed' ? new Date(Date.parse(now) + 3600000).toISOString() : null,
          lease.jobId,
          lease.ownerToken,
        ]);
    },
    finishRun(
      runId: string,
      now: string,
      sourceFailures: readonly ExtractionSourceFailure[] = [],
    ): ExtractionResult {
      const jobs = store.listJobs(runId);
      if (jobs.some(job => job.status === 'running'))
        throw new Error('Extraction jobs have not settled.');
      const succeeded = jobs.some(job => job.status === 'succeeded');
      const failed = sourceFailures.length > 0 || jobs.some(job => job.status === 'failed');
      const cancelled = jobs.some(job => job.status === 'cancelled' || job.status === 'superseded');
      const result: ExtractionResult = succeeded
        ? failed || cancelled
          ? 'partial'
          : 'extracted'
        : failed
          ? 'failed'
          : cancelled
            ? 'cancelled'
            : 'unchanged';
      const status =
        result === 'failed' ? 'failed' : result === 'cancelled' ? 'cancelled' : 'completed';
      database
        .prepare({
          sql: 'UPDATE memory_runs SET status = ?, completed_at = ?, result_json = ? WHERE run_id = ?',
        })
        .run([
          status,
          now,
          JSON.stringify({
            stage: 'extract',
            result,
            sourceFailures,
            jobs: jobs.map(job => ({
              jobId: job.jobId,
              status: job.status,
            })),
          }),
          runId,
        ]);
      return result;
    },
    getJob(jobId: string): ExtractionJob | undefined {
      const row = database
        .prepare<JobRow>({ sql: 'SELECT * FROM memory_jobs WHERE job_id = ?' })
        .get([jobId]);
      return row ? jobFromRow(row) : undefined;
    },
    listJobs(runId: string): readonly ExtractionJob[] {
      return database
        .prepare<JobRow>({
          sql: 'SELECT * FROM memory_jobs WHERE run_id = ? ORDER BY started_at, job_id',
        })
        .all([runId])
        .map(jobFromRow);
    },
    getExtraction(sessionId: string): SavedExtraction | undefined {
      const row = database
        .prepare<{
          session_id: string;
          source_version: string;
          raw_memory: string;
          rollout_summary: string;
          rollout_slug: string;
          coverage_json: string;
          extracted_at: string;
        }>({
          sql: `SELECT e.* FROM memory_extractions e JOIN memory_current_extractions c
          ON e.session_id = c.session_id AND e.source_version = c.source_version WHERE e.session_id = ?`,
        })
        .get([sessionId]);
      if (!row) return undefined;
      const { sourceRef, ...coverage } = JSON.parse(row.coverage_json);
      return {
        sessionId,
        sourceVersion: row.source_version,
        rawMemory: row.raw_memory,
        rolloutSummary: row.rollout_summary,
        rolloutSlug: row.rollout_slug,
        coverage,
        sourceRef,
        extractedAt: row.extracted_at,
      };
    },
    isCurrent,
  };
  return store;
}
