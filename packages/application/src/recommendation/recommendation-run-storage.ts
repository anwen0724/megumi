/*
 * Owns recommendation runs and token-scoped result judgments.
 */
import { z } from 'zod';
import type { DatabaseConnection, DatabaseRow } from '../storage/index';
import type { InterestSnapshotEntry } from './interests/interest-contracts';
import type { DiscoveryIssue } from './discovery/discovery-storage';
import type { DiscoveryAttempt } from './content/material-contracts';
import { RecommendationRunViewSchema } from './feed-contracts';
import { RecommendationIssueSchema } from './discovery/discovery-records';
interface RunRow extends DatabaseRow {
  id: string;
  kind: 'daily_feed' | 'curated';
  request_id: string;
  input_hash: string;
  status: string;
  interest_snapshot: string;
  candidate_snapshot: string;
  outcome: string | null;
  daily_feed_batch_id: string | null;
  curated_selection_id: string | null;
  started_at: number;
  finished_at: number | null;
}
/** Creates the result-run owner on the same transaction connection as published results. */
export function createRecommendationRunStorage(database: DatabaseConnection, newId: (prefix: string) => string) {
  const read = (id: string) => database.prepare<RunRow>({ sql: 'SELECT * FROM recommendation_runs WHERE id=?' }).get([id]);
  const byRequest=(requestId:string)=>database.prepare<RunRow>({sql:"SELECT r.* FROM recommendation_runs r WHERE request_id=? OR EXISTS(SELECT 1 FROM json_each(coalesce(r.outcome,'{}'),'$.requestAliases') alias WHERE alias.value=?)"}).get([requestId,requestId]);
  return {
    read,
    byRequest,
    /** Returns the last accepted selection run for persisted UI diagnostics. */
    latestCurated() {
      return database.prepare<{id:string}>({sql:"SELECT id FROM recommendation_runs WHERE kind='curated' ORDER BY started_at DESC,rowid DESC LIMIT 1"}).get()?.id;
    },
    /** Persists a joined request before acknowledging it, so response loss cannot run a new swap. */
    joinRequest(runId:string,requestId:string,inputHash:string) {
      database.transaction({operation:()=>{
        database.prepare({sql:'UPDATE recommendation_runs SET input_hash=input_hash WHERE id=?'}).run([runId]);
        const current=read(runId);const previous=byRequest(requestId);
        if(!current||current.input_hash!==inputHash||previous&&previous.id!==runId)throw Object.assign(new Error('Request ID has different inputs.'),{code:'REQUEST_CONFLICT'});
        const outcome=current.outcome?z.record(z.unknown()).parse(JSON.parse(current.outcome)):{};
        const aliases=z.array(z.string()).parse(outcome.requestAliases??[]);
        database.prepare({sql:'UPDATE recommendation_runs SET outcome=? WHERE id=?'}).run([JSON.stringify({...outcome,requestAliases:[...new Set([...aliases,requestId])]}),runId]);
      }});
    },
    /** Reuses the first persisted window even when an interrupted run saved no batch. */
    dailyWindow(date: string, interest: InterestSnapshotEntry) {
      const row = database.prepare<RunRow>({ sql: `SELECT * FROM recommendation_runs r WHERE kind='daily_feed' AND json_extract(outcome,'$.date')=? AND EXISTS(SELECT 1 FROM json_each(r.interest_snapshot) i WHERE json_extract(i.value,'$.id')=? AND json_extract(i.value,'$.revision')=?) ORDER BY started_at,id LIMIT 1` }).get([date, interest.id, interest.revision]);
      if (!row?.outcome)
        return undefined;
      const outcome = z.object({ windows: z.record(z.object({ start: z.number(), end: z.number() })).optional(), window: z.object({ start: z.number(), end: z.number() }).optional() }).passthrough().parse(JSON.parse(row.outcome));
      return outcome.windows?.[interest.id] ?? outcome.window;
    },
    create(input: {
      id: string;
      kind: 'daily_feed' | 'curated';
      requestId: string;
      inputHash: string;
      interests: readonly InterestSnapshotEntry[];
      now: number;
      outcome: Record<string, unknown>;
    }) {
      database.prepare({ sql: "INSERT INTO recommendation_runs(id,kind,request_id,input_hash,status,interest_snapshot,candidate_snapshot,outcome,started_at,retry_of_run_id) VALUES(?,?,?,?,'queued',?,'[]',?,?,(SELECT id FROM recommendation_runs WHERE kind=? AND input_hash=? AND status IN ('failed','interrupted','cancelled') ORDER BY started_at DESC,rowid DESC LIMIT 1))" }).run([input.id, input.kind, input.requestId, input.inputHash, JSON.stringify(input.interests), JSON.stringify(input.outcome), input.now,input.kind,input.inputHash]);
    },
    begin(id: string) { database.prepare({ sql: "UPDATE recommendation_runs SET status='running' WHERE id=? AND status='queued'" }).run([id]); },
    finish(id: string, status: string, now: number, issues: readonly DiscoveryIssue[], resultId?: string, details: Record<string, unknown> = {}) {
      const row = read(id);
      if (!row || !['running', 'queued'].includes(row.status))
        return;
      const outcome = { ...(row.outcome ? z.record(z.unknown()).parse(JSON.parse(row.outcome)) : {}), ...details, issues };
      database.prepare({ sql: "UPDATE recommendation_runs SET status=?,finished_at=?,outcome=?,daily_feed_batch_id=CASE WHEN kind='daily_feed' THEN ? ELSE daily_feed_batch_id END,curated_selection_id=CASE WHEN kind='curated' THEN ? ELSE curated_selection_id END WHERE id=? AND status IN ('queued','running')" }).run([status, now, JSON.stringify(outcome), resultId ?? null, resultId ?? null, id]);
    },
    /** Freezes the actual candidate inputs before any recommendation model call. */
    freeze(id: string, candidates: readonly unknown[]) {
      database.prepare({sql:"UPDATE recommendation_runs SET candidate_snapshot=? WHERE id=? AND status='queued'"}).run([JSON.stringify(candidates),id]);
    },
    view(id: string) {
      const row = read(id); if (!row)
        return undefined; const outcome = row.outcome ? z.record(z.unknown()).parse(JSON.parse(row.outcome)) : {}; const resultId = row.daily_feed_batch_id ?? row.curated_selection_id; return RecommendationRunViewSchema.parse({ id: row.id, kind: row.kind, status: row.status, startedAt: new Date(row.started_at).toISOString(), finishedAt: row.finished_at === null ? null : new Date(row.finished_at).toISOString(), ...(resultId ? { committedResultId: resultId } : {}), issues: z.array(RecommendationIssueSchema).parse(outcome.issues ?? []) });
    },
    interrupt(now: number) {
      database.transaction({operation:()=>{
        database.prepare({sql:"UPDATE recommendation_state SET next_retry_at=? WHERE pending_initial_interest_hash IN (SELECT input_hash FROM recommendation_runs WHERE kind='curated' AND status IN ('running','queued') AND json_extract(outcome,'$.automatic')=1)"}).run([now+300000]);
        database.prepare({ sql: "UPDATE recommendation_runs SET status='interrupted',finished_at=? WHERE status IN ('running','queued')" }).run([now]);
        database.prepare({ sql: "UPDATE recommendation_run_judgments SET status='cancelled',owner_run_id=NULL,attempt_token=NULL,attempt_started_at=NULL,attempt_deadline_at=NULL WHERE owner_run_id IN (SELECT id FROM recommendation_runs WHERE status='interrupted')" }).run();
      }});
    },
    /** Copies an already verified result only when its actual material and input hash match. */
    reuse(input: {
      runId: string;
      stage: 'topic' | 'value';
      contentId: string;
      interestId: string;
      materialId: string;
      inputHash: string;
    }): unknown | undefined {
      const saved = database.prepare<{
        result: string;
      }>({ sql: "SELECT result FROM recommendation_run_judgments WHERE stage=? AND content_id=? AND interest_id=? AND material_id=? AND input_hash=? AND status='ready' AND result IS NOT NULL LIMIT 1" }).get([input.stage, input.contentId, input.interestId, input.materialId, input.inputHash]);
      if (!saved)
        return undefined;
      database.prepare({ sql: "INSERT OR IGNORE INTO recommendation_run_judgments(run_id,stage,content_id,interest_id,material_id,input_hash,status,result,attempts) SELECT ?,?,?,?,?,?,'ready',?,0 WHERE EXISTS(SELECT 1 FROM recommendation_runs WHERE id=? AND status='running')" }).run([input.runId, input.stage, input.contentId, input.interestId, input.materialId, input.inputHash, saved.result, input.runId]);
      return JSON.parse(saved.result);
    },
    claim(input: {
      runId: string;
      stage: 'topic' | 'value';
      contentId: string;
      interestId: string;
      materialId: string;
      inputHash: string;
      now: number;
      deadlineAt: number;
    }): DiscoveryAttempt | undefined {
      if (!database.prepare({ sql: "SELECT 1 FROM recommendation_runs WHERE id=? AND status='running'" }).get([input.runId]))
        return undefined;
      const row = database.prepare<{
        attempts: number;
        status: string;
        attempt_token: string | null;
        attempt_deadline_at: number | null;
        retry_at: number | null;
      }>({ sql: 'SELECT * FROM recommendation_run_judgments WHERE run_id=? AND stage=? AND content_id=? AND interest_id=?' }).get([input.runId, input.stage, input.contentId, input.interestId]);
      if (row && (row.status === 'ready' || row.attempts >= 3 || (row.retry_at ?? 0) > input.now || (row.attempt_deadline_at ?? 0) > input.now))
        return undefined;
      const token = newId('judgment');
      database.prepare({ sql: `INSERT INTO recommendation_run_judgments(run_id,stage,content_id,interest_id,material_id,input_hash,status,attempts,owner_run_id,attempt_token,attempt_started_at,attempt_deadline_at) VALUES(?,?,?,?,?,?,'running',1,?,?,?,?) ON CONFLICT(run_id,stage,content_id,interest_id) DO UPDATE SET status='running',attempts=attempts+1,owner_run_id=excluded.owner_run_id,attempt_token=excluded.attempt_token,attempt_started_at=excluded.attempt_started_at,attempt_deadline_at=excluded.attempt_deadline_at` }).run([input.runId, input.stage, input.contentId, input.interestId, input.materialId, input.inputHash, input.runId, token, input.now, input.deadlineAt]);
      return { runId: input.runId, token, startedAt: input.now, deadlineAt: input.deadlineAt };
    },
    retry(attempt: DiscoveryAttempt, now: number) { return database.prepare({ sql: 'UPDATE recommendation_run_judgments SET attempts=attempts+1 WHERE owner_run_id=? AND attempt_token=? AND attempts<3 AND attempt_deadline_at>?' }).run([attempt.runId, attempt.token, now]).changes > 0; },
    save(attempt: DiscoveryAttempt, result: unknown, now: number) { return database.prepare({ sql: "UPDATE recommendation_run_judgments SET status='ready',result=?,owner_run_id=NULL,attempt_token=NULL,attempt_started_at=NULL,attempt_deadline_at=NULL WHERE owner_run_id=? AND attempt_token=? AND status='running' AND attempt_deadline_at>? AND EXISTS(SELECT 1 FROM recommendation_runs WHERE id=? AND status='running')" }).run([JSON.stringify(result), attempt.runId, attempt.token, now, attempt.runId]).changes > 0; },
    release(attempt: DiscoveryAttempt, now: number, errorCode?: string) { database.prepare({ sql: 'UPDATE recommendation_run_judgments SET status=?,retry_at=?,error_code=?,owner_run_id=NULL,attempt_token=NULL,attempt_started_at=NULL,attempt_deadline_at=NULL WHERE owner_run_id=? AND attempt_token=?' }).run([errorCode ? 'failed' : 'cancelled', errorCode ? now + 60000 : null, errorCode ?? null, attempt.runId, attempt.token]); }
  };
}
export type RecommendationRunStorage = ReturnType<typeof createRecommendationRunStorage>;
