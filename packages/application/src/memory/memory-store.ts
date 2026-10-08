/* Owns the single memory writer, durable maintenance state and successful snapshots. */
import type { DatabaseConnection } from '../storage/index';
import type { MemoryArtifactState } from './contracts';
import type { ConsolidationSelection } from './consolidation-selection';
import { randomUUID, createHash } from 'node:crypto';

export type MemoryState = {
  artifact_state: MemoryArtifactState; control_revision: number; dirty_revision: number; processed_revision: number;
  successful_snapshot_id: string | null; artifact_versions_json: string; clear_pending: number;
  reply_cursor: number; clear_reply_cursor: number; writer_token: string | null; writer_lease_expires_at: string | null;
};
export interface MemoryWriter { readonly token: string; readonly controlRevision: number }

export function createMemoryStore(database: DatabaseConnection, now: () => number) {
  const iso = () => new Date(now()).toISOString();
  function state(): MemoryState { return database.prepare<MemoryState>({ sql: 'SELECT * FROM memory_state WHERE id = 1' }).get()!; }
  function assertWriter(writer: MemoryWriter, clearing = false): void {
    const current = state();
    if (current.writer_token !== writer.token || !current.writer_lease_expires_at || current.writer_lease_expires_at <= iso()
      || current.control_revision !== writer.controlRevision || (!clearing && current.clear_pending)) throw new Error('OWNER_LOST');
  }
  function cachedRequest<T>(operation: string, requestId: string, input: unknown): T | undefined {
    if (!requestId || requestId.length > 200) throw new Error('INVALID_ARGUMENT');
    const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const previous = database.prepare<{ input_hash: string; result_json: string }>({ sql: 'SELECT input_hash,result_json FROM memory_requests WHERE operation = ? AND request_id = ?' }).get([operation, requestId]);
    if (!previous) return undefined;
    if (previous.input_hash !== hash) throw new Error('REQUEST_CONFLICT');
    return JSON.parse(previous.result_json) as T;
  }
  return {
    state, assertWriter, cachedRequest,
    acquire(clearing = false): MemoryWriter {
      return database.transaction({ operation: () => {
        const current = state();
        if ((!clearing && current.clear_pending) || (current.writer_token && current.writer_lease_expires_at! > iso())) throw new Error('BUSY');
        const token = randomUUID();
        database.prepare({ sql: 'UPDATE memory_state SET writer_token = ?, writer_lease_expires_at = ? WHERE id = 1' })
          .run([token, new Date(now() + 3600000).toISOString()]);
        return { token, controlRevision: current.control_revision };
      } });
    },
    renew(writer: MemoryWriter): void {
      database.transaction({ operation: () => {
        assertWriter(writer);
        database.prepare({ sql: 'UPDATE memory_state SET writer_lease_expires_at = ? WHERE id = 1' }).run([new Date(now() + 3600000).toISOString()]);
        database.prepare({ sql: "UPDATE memory_jobs SET lease_expires_at = ? WHERE owner_token = ? AND status = 'running'" }).run([new Date(now() + 3600000).toISOString(), writer.token]);
      } });
    },
    release(writer: MemoryWriter): void {
      database.prepare({ sql: 'UPDATE memory_state SET writer_token = NULL, writer_lease_expires_at = NULL WHERE id = 1 AND writer_token = ?' }).run([writer.token]);
    },
    markRepair(): void { database.prepare({ sql: "UPDATE memory_state SET artifact_state = CASE WHEN clear_pending = 1 THEN 'clearing' ELSE 'needsRepair' END WHERE id = 1" }).run(); },
    dirty(): number {
      return database.prepare<{ dirty_revision: number }>({ sql: 'UPDATE memory_state SET dirty_revision = dirty_revision + 1 WHERE id = 1 RETURNING dirty_revision' }).get()!.dirty_revision;
    },
    beginRun(runId: string, reason: string): void {
      database.prepare({ sql: "INSERT INTO memory_runs(run_id,kind,reason,status,target_revision,created_at) VALUES (?,'generation',?,'running',?,?)" }).run([runId, reason, state().dirty_revision, iso()]);
    },
    finishRun(runId: string, status: 'completed' | 'failed' | 'cancelled', result: unknown): void {
      database.prepare({ sql: 'UPDATE memory_runs SET status = ?, completed_at = ?, result_json = ? WHERE run_id = ?' }).run([status, iso(), JSON.stringify(result), runId]);
    },
    claimJob(writer: MemoryWriter, runId: string, selection: ConsolidationSelection, failedJobId?: string): string | undefined {
      return database.transaction({ operation: () => {
        assertWriter(writer);
        const latest = database.prepare<{ job_id: string; status: string; retry_group_id: string }>({ sql: "SELECT * FROM memory_jobs WHERE stage = 'consolidate' AND target_revision = ? ORDER BY rowid DESC LIMIT 1" }).get([selection.targetRevision]);
        const jobId = randomUUID(); let group = latest?.retry_group_id ?? jobId;
        if (failedJobId) {
          if (latest?.job_id !== failedJobId || latest.status !== 'failed') throw new Error('INVALID_ARGUMENT');
          group = jobId;
        }
        const failures = database.prepare<{ count: number; retry_at: string | null }>({ sql: "SELECT count(*) AS count, max(retry_at) AS retry_at FROM memory_jobs WHERE retry_group_id = ? AND status = 'failed'" }).get([group])!;
        if (failures.count >= 3 || (failures.retry_at && failures.retry_at > iso())) return undefined;
        database.prepare({ sql: `INSERT INTO memory_jobs(job_id,run_id,stage,target_revision,status,attempt,retry_group_id,retry_of_job_id,owner_token,lease_expires_at,started_at,result_json)
          VALUES (?,?,'consolidate',?,'running',?,?,?,?,?,?,?)` }).run([jobId, runId, selection.targetRevision, failures.count + 1, group, failedJobId ?? null, writer.token,
          state().writer_lease_expires_at, iso(), JSON.stringify({ priorState: state().artifact_state, versions: JSON.parse(state().artifact_versions_json) })]);
        database.prepare({ sql: "UPDATE memory_state SET artifact_state = 'updating' WHERE id = 1" }).run();
        return jobId;
      } });
    },
    settleJob(writer: MemoryWriter, jobId: string, status: 'failed' | 'cancelled' | 'superseded', code: string): void {
      database.prepare({ sql: "UPDATE memory_jobs SET status = ?, completed_at = ?, retry_at = ?, error_json = ? WHERE job_id = ? AND owner_token = ? AND status = 'running'" })
        .run([status, iso(), status === 'failed' ? new Date(now() + 3600000).toISOString() : null, JSON.stringify({ code, message: 'Memory consolidation did not complete.' }), jobId, writer.token]);
    },
    commit(writer: MemoryWriter, jobId: string, selection: ConsolidationSelection, versions: Record<string, string>, result: unknown): void {
      database.transaction({ operation: () => {
        assertWriter(writer);
        for (const source of selection.selected) {
          if (!database.prepare({ sql: `SELECT 1 FROM memory_current_extractions c JOIN memory_sources s ON s.session_id = c.session_id
            WHERE c.session_id = ? AND c.source_version = ? AND s.eligibility = 'eligible'` }).get([source.sessionId, source.sourceVersion])) throw new Error('SOURCE_CHANGED');
        }
        const snapshotId = randomUUID();
        const identities = (items: ConsolidationSelection['selected']) => items.map(({ sessionId, sourceVersion }) => ({ sessionId, sourceVersion }));
        database.prepare({ sql: 'INSERT INTO memory_snapshots(snapshot_id,target_revision,diff_json,created_at) VALUES (?,?,?,?)' }).run([snapshotId, selection.targetRevision,
          JSON.stringify({ added: identities(selection.added), removed: identities(selection.removed), retained: identities(selection.retained) }), iso()]);
        selection.selected.forEach((source, index) => database.prepare({ sql: 'INSERT INTO memory_snapshot_sources(snapshot_id,session_id,source_version,ordinal,artifact_path) VALUES (?,?,?,?,?)' })
          .run([snapshotId, source.sessionId, source.sourceVersion, index, source.artifactPath]));
        database.prepare({ sql: "UPDATE memory_state SET artifact_state = 'ready', processed_revision = ?, successful_snapshot_id = ?, artifact_versions_json = ? WHERE id = 1" })
          .run([selection.targetRevision, snapshotId, JSON.stringify(versions)]);
        database.prepare({ sql: "UPDATE memory_jobs SET status = 'succeeded', completed_at = ?, result_json = ? WHERE job_id = ? AND owner_token = ?" })
          .run([iso(), JSON.stringify(result), jobId, writer.token]);
        database.prepare({ sql: 'DELETE FROM memory_snapshots WHERE snapshot_id <> ?' }).run([snapshotId]);
      } });
    },
    recover(versions: Record<string, string> | undefined): void {
      database.transaction({ operation: () => {
        const current = state();
        if (current.writer_token && current.writer_lease_expires_at! > iso()) return;
        const expired = database.prepare<{ run_id: string; result_json: string | null }>({ sql: `UPDATE memory_jobs SET status = 'failed', completed_at = ?, retry_at = ?, error_json = ?
          WHERE stage = 'consolidate' AND status = 'running' AND lease_expires_at <= ? RETURNING run_id,result_json` })
          .all([iso(), new Date(now() + 3600000).toISOString(), JSON.stringify({ code: 'LEASE_EXPIRED', message: 'Memory writer lease expired.' }), iso()]);
        for (const job of expired) {
          const before = job.result_json ? JSON.parse(job.result_json) : {};
          const intact = JSON.stringify(before.versions) === JSON.stringify(versions);
          database.prepare({ sql: "UPDATE memory_state SET artifact_state = CASE WHEN clear_pending = 1 THEN 'clearing' ELSE ? END WHERE id = 1" }).run([intact ? before.priorState ?? 'needsRepair' : 'needsRepair']);
          database.prepare({ sql: "UPDATE memory_runs SET status = 'failed', completed_at = ?, result_json = ? WHERE run_id = ?" })
            .run([iso(), JSON.stringify({ error: { code: 'LEASE_EXPIRED', message: 'Memory writer lease expired.' } }), job.run_id]);
        }
        if (current.artifact_state === 'updating' && !expired.length) {
          database.prepare({ sql: "UPDATE memory_state SET artifact_state = 'needsRepair' WHERE id = 1" }).run();
        }
        database.prepare({ sql: 'UPDATE memory_state SET writer_token = NULL, writer_lease_expires_at = NULL WHERE id = 1' }).run();
      } });
    },
    request<T>(operation: string, requestId: string, input: unknown, execute: () => T): T {
      if (!requestId || requestId.length > 200) throw new Error('INVALID_ARGUMENT');
      const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
      return database.transaction({ operation: () => {
        const previous = database.prepare<{ input_hash: string; result_json: string }>({ sql: 'SELECT input_hash,result_json FROM memory_requests WHERE operation = ? AND request_id = ?' }).get([operation, requestId]);
        if (previous) { if (previous.input_hash !== hash) throw new Error('REQUEST_CONFLICT'); return JSON.parse(previous.result_json) as T; }
        const result = execute();
        database.prepare({ sql: 'INSERT INTO memory_requests(operation,request_id,input_hash,result_json,created_at,expires_at) VALUES (?,?,?,?,?,?)' })
          .run([operation, requestId, hash, JSON.stringify(result), iso(), new Date(now() + 86400000).toISOString()]);
        return result;
      } });
    },
  };
}
