/*
 * Owns discovery runs, query reuse, discovered identities, checkpoints and yield facts.
 */
import type { DatabaseConnection } from '../../storage/index';
import type { InterestSnapshotEntry } from '../interests/interest-contracts';
import { RawItemSchema, type RawItem } from '../sources/source-connector';
import { identifyContentUrl } from '../sources/source-material';
import type { DiscoveryBudget } from './discovery-budget';
import type { DiscoveryAttempt } from '../content/material-contracts';
import { z } from 'zod';
import { InterestSnapshotEntrySchema } from '../interests/interest-contracts';
import { DiscoveryPlanSchema, DiscoveryBudgetSchema, RecommendationIssueSchema, YieldSummarySchema, type DiscoveryRunRecord } from './discovery-records';
export interface DiscoveryQuery {
  interestId: string;
  interestRevision: number;
  sourceId: string;
  query: string;
  direction: 'direct' | 'exploratory';
  basis: string;
}
export interface DiscoveryIssue {
  code: string;
  message: string;
  subjectId?: string;
}
export interface SavedDiscovery {
  resultId: string;
  item: RawItem;
  contentId?: string;
}
export type SearchYield = z.input<typeof YieldSummarySchema>[number];
/** Creates persisted discovery history and token-scoped material acquisition. */
export function createDiscoveryStorage(database: DatabaseConnection, newId: (prefix: string) => string) {
  const readResults = (historyId: string): SavedDiscovery[] => database.prepare<{
    id: string;
    raw_payload: string | null;
    content_id: string | null;
  }>({ sql: 'SELECT r.id,r.raw_payload,r.content_id FROM search_result_links l JOIN search_results r ON r.id = l.search_result_id WHERE l.search_history_id = ? ORDER BY r.first_seen_at,r.id' }).all([historyId]).flatMap(row => {
    if (!row.raw_payload)
      return [];
    const parsed = RawItemSchema.safeParse(JSON.parse(row.raw_payload));
    return parsed.success ? [{ resultId: row.id, item: parsed.data, ...(row.content_id ? { contentId: row.content_id } : {}) }] : [];
  });
  return {
    /** Reuses durable zero-yield judgments as planning evidence, without inventing a profile. */
    planningHistory(interestId: string, revision: number, since: number) {
      const rows = database.prepare<{
        id: string;
        query: string;
        source_id: string;
        yield_summary: string | null;
        result_count: number | null;
      }>({ sql: 'SELECT h.id,q.query,h.source_id,r.yield_summary,h.result_count FROM search_queries q JOIN search_history h ON h.query_id=q.id JOIN discovery_runs r ON r.id=h.run_id WHERE q.interest_id=? AND q.interest_revision=? AND h.searched_at>=? AND h.outcome=\'success\' ORDER BY h.searched_at DESC,h.id DESC' }).all([interestId, revision, since]);
      return rows.map(row => {
        const yielded = row.yield_summary ? YieldSummarySchema.parse(JSON.parse(row.yield_summary)).find(y => y.historyId === row.id) : undefined;
        return { query: row.query, sourceId: row.source_id, discovered: row.result_count ?? 0, status: yielded?.status ?? 'pending', admitted: yielded?.admittedContentIds.length ?? 0 };
      });
    },
    /** Claims detail acquisition for one current material input, including failed attempts. */
    claimMaterial(input: {
      contentId: string;
      materialId: string;
      url: string;
      runId: string;
      now: number;
      deadlineAt: number;
      operation?: 'detail' | 'publication';
    }): DiscoveryAttempt | undefined {
      return database.transaction({
        operation: () => {
          if (input.deadlineAt <= input.now || !database.prepare({ sql: "SELECT 1 FROM discovery_runs WHERE id=? AND status='running'" }).get([input.runId]))
            return undefined;
          const method = `${input.operation ?? 'detail'}:${input.materialId}`;
          const old = database.prepare<{
            id: string;
            status: string;
            attempts: number;
            retry_at: number | null;
            attempt_deadline_at: number | null;
          }>({ sql: 'SELECT * FROM material_requests WHERE content_id=? AND method=? ORDER BY rowid DESC LIMIT 1' }).get([input.contentId, method]);
          if (old && (old.status === 'ready' || old.attempts >= 3 || (old.retry_at ?? 0) > input.now || (old.attempt_deadline_at ?? 0) > input.now))
            return undefined;
          const id = old?.id ?? newId('material_request');
          const token = newId('material_request');
          database.prepare({
            sql: `INSERT INTO material_requests(id,content_id,discovery_run_id,method,request_url,status,attempts,owner_run_id,attempt_token,attempt_started_at,attempt_deadline_at)
          VALUES(?,?,?,?,?,'running',1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status='running',attempts=attempts+1,owner_run_id=excluded.owner_run_id,attempt_token=excluded.attempt_token,attempt_started_at=excluded.attempt_started_at,attempt_deadline_at=excluded.attempt_deadline_at`
          }).run([id, input.contentId, input.runId, method, input.url, input.runId, token, input.now, input.deadlineAt]);
          return { runId: input.runId, token, startedAt: input.now, deadlineAt: input.deadlineAt };
        }
      });
    },
    /** Checks the acquisition token inside the same transaction as its material write. */
    completeMaterial(attempt: DiscoveryAttempt, now: number, operation: () => void): boolean {
      return database.transaction({
        operation: () => {
          if (!database.prepare({ sql: "SELECT 1 FROM material_requests m JOIN discovery_runs r ON r.id=m.owner_run_id WHERE m.owner_run_id=? AND m.attempt_token=? AND m.status='running' AND m.attempt_deadline_at>? AND r.status='running'" }).get([attempt.runId, attempt.token, now]))
            return false;
          operation();
          database.prepare({ sql: "UPDATE material_requests SET status='ready',error_code=NULL,retry_at=NULL,owner_run_id=NULL,attempt_token=NULL,attempt_started_at=NULL,attempt_deadline_at=NULL WHERE owner_run_id=? AND attempt_token=?" }).run([attempt.runId, attempt.token]);
          return true;
        }
      });
    },
    /** Clears only the acquisition named by the caller. */
    releaseMaterial(attempt: DiscoveryAttempt, now: number, errorCode?: string): void {
      database.prepare({ sql: 'UPDATE material_requests SET status=?,error_code=?,retry_at=?,owner_run_id=NULL,attempt_token=NULL,attempt_started_at=NULL,attempt_deadline_at=NULL WHERE owner_run_id=? AND attempt_token=?' }).run([errorCode ? 'failed' : 'cancelled', errorCode ?? null, errorCode ? now + 60000 : null, attempt.runId, attempt.token]);
    },
    /** Supplies only discoveries produced for this current interest; unknown relevance is not guessed. */
    forInterest(interestId: string, revision: number): readonly SavedDiscovery[] {
      const rows = database.prepare<{
        history_id: string;
      }>({ sql: 'SELECT DISTINCT h.id AS history_id FROM search_queries q JOIN search_history h ON h.query_id=q.id WHERE q.interest_id=? AND q.interest_revision=? ORDER BY h.searched_at,h.id' }).all([interestId, revision]);
      const unique = new Map<string, SavedDiscovery>();
      for (const row of rows)
        for (const saved of readResults(row.history_id))
          unique.set(saved.contentId ?? saved.resultId, saved);
      return [...unique.values()];
    },
    startRun(input: {
      id: string;
      purpose: 'daily_feed' | 'candidate_supply';
      interests: readonly InterestSnapshotEntry[];
      configRevision: string;
      now: number;
      budget: DiscoveryBudget;
    }) {
      database.prepare({ sql: "INSERT INTO discovery_runs(id,purpose,status,interest_snapshot,config_revision,started_at,budget,yield_summary) VALUES(?,?,'running',?,?,?,?,'[]')" }).run([input.id, input.purpose, JSON.stringify(input.interests), input.configRevision, input.now, JSON.stringify(input.budget.snapshot())]);
    },
    finishRun(id: string, status: DiscoveryRunRecord['status'], now: number, budget: DiscoveryBudget, issues: readonly DiscoveryIssue[]) {
      database.prepare({ sql: "UPDATE discovery_runs SET status = ?,finished_at = ?,budget = ?,issues = ?,next_step=? WHERE id = ? AND status = 'running'" }).run([status, now, JSON.stringify(budget.snapshot()), JSON.stringify(issues), status === 'completed' ? null : 'resume_saved_work', id]);
      database.prepare({ sql: 'UPDATE candidate_supply_state SET last_finished_at = ? WHERE id = 1' }).run([now]);
    },
    readRun(id: string) {
      const row = database.prepare<{
        id: string;
        purpose: string;
        status: string;
        interest_snapshot: string;
        started_at: number;
        finished_at: number | null;
        budget: string;
        issues: string;
        yield_summary: string;
        accepted_plan: string | null;
      }>({ sql: 'SELECT * FROM discovery_runs WHERE id = ?' }).get([id]);
      return row ? { id: row.id, purpose: row.purpose, status: row.status, interests: z.array(InterestSnapshotEntrySchema).parse(JSON.parse(row.interest_snapshot)), startedAt: row.started_at, finishedAt: row.finished_at, budget: DiscoveryBudgetSchema.parse(JSON.parse(row.budget)), issues: z.array(RecommendationIssueSchema).parse(JSON.parse(row.issues)), yieldSummary: YieldSummarySchema.parse(JSON.parse(row.yield_summary)), acceptedPlan: row.accepted_plan ? DiscoveryPlanSchema.parse(JSON.parse(row.accepted_plan)) : [] } : undefined;
    },
    interruptRunning(now: number): string[] {
      return database.transaction({
        operation: () => {
          const ids = database.prepare<{
            id: string;
          }>({ sql: "SELECT id FROM discovery_runs WHERE status = 'running'" }).all().map(row => row.id);
          database.prepare({ sql: "UPDATE discovery_runs SET status = 'interrupted',finished_at = ? WHERE status = 'running'" }).run([now]);
          database.prepare({ sql: "UPDATE material_requests SET status='cancelled',owner_run_id=NULL,attempt_token=NULL,attempt_started_at=NULL,attempt_deadline_at=NULL WHERE owner_run_id IN (SELECT id FROM discovery_runs WHERE status IN ('interrupted','cancelled'))" }).run();
          return ids;
        }
      });
    },
    savePlan(runId: string, plan: readonly DiscoveryQuery[]) { database.prepare({ sql: 'UPDATE discovery_runs SET accepted_plan = ? WHERE id = ?' }).run([JSON.stringify(plan), runId]); },
    checkpoint(runId: string, budget: DiscoveryBudget) { database.prepare({ sql: 'UPDATE discovery_runs SET budget = ? WHERE id = ?' }).run([JSON.stringify(budget.snapshot()), runId]); },
    saveYield(runId: string, yields: readonly SearchYield[]) { database.prepare({ sql: 'UPDATE discovery_runs SET yield_summary = ? WHERE id = ?' }).run([JSON.stringify(YieldSummarySchema.parse(yields)), runId]); },
    pendingYields() {
      return database.prepare<{
        id: string;
        yield_summary: string;
      }>({ sql: "SELECT id,yield_summary FROM discovery_runs WHERE purpose = 'candidate_supply' AND yield_summary IS NOT NULL ORDER BY started_at,id" }).all().flatMap(row => YieldSummarySchema.parse(JSON.parse(row.yield_summary)).map(yielded => ({ runId: row.id, ...yielded })));
    },
    queryId(query: DiscoveryQuery, now: number) {
      const existing = database.prepare<{
        id: string;
      }>({ sql: "SELECT id FROM search_queries WHERE interest_id = ? AND interest_revision = ? AND query = ? AND status = 'active'" }).get([query.interestId, query.interestRevision, query.query]);
      if (existing)
        return existing.id;
      const id = newId('query');
      database.prepare({ sql: "INSERT INTO search_queries(id,interest_id,interest_revision,query,category,origin,status,created_at) VALUES(?,?,?,?,?,'ai','active',?)" }).run([id, query.interestId, query.interestRevision, query.query, query.direction === 'direct' ? 'core' : 'exploratory', now]);
      return id;
    },
    recent(queryId: string, sourceId: string, purpose: string, window: {
      start: number;
      end: number;
    } | undefined, since: number) {
      const row = database.prepare<{
        id: string;
      }>({ sql: "SELECT id FROM search_history WHERE query_id = ? AND source_id = ? AND purpose = ? AND outcome = 'success' AND window_start IS ? AND window_end IS ? AND searched_at >= ? ORDER BY searched_at DESC LIMIT 1" }).get([queryId, sourceId, purpose, window?.start ?? null, window?.end ?? null, since]);
      return row ? { historyId: row.id, items: readResults(row.id) } : undefined;
    },
    saveSearch(input: {
      runId: string;
      queryId: string;
      sourceId: string;
      purpose: string;
      query: string;
      now: number;
      window?: {
        start: number;
        end: number;
      };
      items?: readonly RawItem[];
      errorCode?: string;
    }) {
      return database.transaction({
        operation: () => {
          const id = newId('search');
          database.prepare({ sql: 'INSERT INTO search_history(id,query_id,source_id,search_scope,searched_at,outcome,result_count,new_item_count,run_id,purpose,window_start,window_end,error_code) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)' }).run([id, input.queryId, input.sourceId, JSON.stringify({ query: input.query, window: input.window ?? null }), input.now, input.errorCode ? 'failed' : 'success', input.items?.length ?? null, 0, input.runId, input.purpose, input.window?.start ?? null, input.window?.end ?? null, input.errorCode ?? null]);
          let newItems = 0;
          for (const raw of input.items ?? []) {
            const identity = identifyContentUrl(raw.url);
            if (!identity)
              continue;
            const item: RawItem = { ...raw, ...identity, requestUrl: raw.requestUrl ?? raw.url };
            const old = database.prepare<{
              id: string;
              raw_payload: string | null;
            }>({ sql: 'SELECT id,raw_payload FROM search_results WHERE platform = ? AND ((external_id IS NOT NULL AND external_id = ?) OR request_url = ?)' }).get([identity.platform ?? 'web', identity.externalId ?? null, identity.url]);
            if (!old)
              newItems++;
            const resultId = old?.id ?? newId('discovery');
            database.prepare({ sql: 'INSERT INTO search_results(id,platform,source_id,external_id,request_url,title,excerpt,author,publication_evidence,raw_payload,status,first_seen_at,last_seen_at) VALUES(?,?,?,?,?,?,?,?,?,?,\'pending\',?,?) ON CONFLICT(id) DO UPDATE SET last_seen_at=excluded.last_seen_at,raw_payload=excluded.raw_payload,publication_evidence=excluded.publication_evidence,title=excluded.title,excerpt=excluded.excerpt' }).run([resultId, identity.platform ?? 'web', raw.source, identity.externalId ?? null, identity.url, raw.title ?? null, raw.text ?? null, raw.author ?? null, JSON.stringify(raw.publicationEvidence ?? []), JSON.stringify(item), input.now, input.now]);
            database.prepare({ sql: 'INSERT OR IGNORE INTO search_result_links(search_history_id,search_result_id) VALUES(?,?)' }).run([id, resultId]);
          }
          database.prepare({ sql: 'UPDATE search_history SET new_item_count=? WHERE id=?' }).run([newItems, id]);
          database.prepare({ sql: 'UPDATE search_queries SET last_used_at = ? WHERE id = ?' }).run([input.now, input.queryId]);
          return { historyId: id, items: readResults(id) };
        }
      });
    },
    readResults,
    /** Separates terminal acquisition failures from work that can still resume. */
    resultFailed(resultId: string): boolean {
      return Boolean(database.prepare({ sql: "SELECT 1 FROM search_results WHERE id=? AND status='failed' AND attempts>=3" }).get([resultId]));
    },
    /** Counts material-less discoveries only when their saved retry is runnable. */
    resultActionable(resultId: string, now: number): boolean {
      return Boolean(database.prepare({sql:"SELECT 1 FROM search_results WHERE id=? AND status IN ('pending','failed') AND attempts<3 AND (retry_at IS NULL OR retry_at<=?)"}).get([resultId,now]));
    },
    pendingResults(limit: number, now: number): SavedDiscovery[] {
      return database.prepare<{
        id: string;
        raw_payload: string;
        content_id: string | null;
      }>({ sql: "SELECT id,raw_payload,content_id FROM search_results WHERE raw_payload IS NOT NULL AND status IN ('pending','failed') AND attempts < 3 AND (retry_at IS NULL OR retry_at <= ?) ORDER BY first_seen_at,id LIMIT ?" }).all([now, limit]).flatMap(row => {
        const parsed = RawItemSchema.safeParse(JSON.parse(row.raw_payload));
        return parsed.success ? [{ resultId: row.id, item: parsed.data, ...(row.content_id ? { contentId: row.content_id } : {}) }] : [];
      });
    },
    saveResult(resultId: string, item: RawItem, contentId: string | undefined, now: number, errorCode?: string) {
      database.prepare({ sql: 'UPDATE search_results SET raw_payload=?,content_id=coalesce(?,content_id),status=?,error_code=?,retry_at=?,attempts=attempts+? WHERE id=?' }).run([JSON.stringify(item), contentId ?? null, errorCode ? 'failed' : 'normalized', errorCode ?? null, errorCode ? now + 60000 : null, errorCode ? 1 : 0, resultId]);
    },
    state() {
      database.prepare({ sql: "INSERT OR IGNORE INTO candidate_supply_state(id,source_cooldowns,search_backoff) VALUES(1,'{}','{}')" }).run();
      const row = database.prepare<{
        search_backoff: string;
        source_cooldowns: string;
        candidate_next_interest_id: string | null;
        daily_feed_next_interest_id: string | null;
      }>({ sql: 'SELECT * FROM candidate_supply_state WHERE id = 1' }).get()!;
      return { backoff: z.record(z.object({ revision: z.number().int().positive(), failures: z.number().int().nonnegative(), nextAt: z.number().int().nonnegative() }).strict()).parse(JSON.parse(row.search_backoff)), cooldowns: z.record(z.number().int().nonnegative()).parse(JSON.parse(row.source_cooldowns)), candidateCursor: row.candidate_next_interest_id, dailyCursor: row.daily_feed_next_interest_id };
    },
    saveState(input: {
      backoff?: Record<string, {
        revision: number;
        failures: number;
        nextAt: number;
      }>;
      cooldowns?: Record<string, number>;
      cursor?: string | null;
      purpose?: string;
    }) {
      if (input.backoff)
        database.prepare({ sql: 'UPDATE candidate_supply_state SET search_backoff = ? WHERE id = 1' }).run([JSON.stringify(input.backoff)]);
      if (input.cooldowns)
        database.prepare({ sql: 'UPDATE candidate_supply_state SET source_cooldowns = ? WHERE id = 1' }).run([JSON.stringify(input.cooldowns)]);
      if ('cursor' in input)
        database.prepare({ sql: `UPDATE candidate_supply_state SET ${input.purpose === 'daily_feed' ? 'daily_feed_next_interest_id' : 'candidate_next_interest_id'} = ? WHERE id = 1` }).run([input.cursor ?? null]);
    },
  };
}
export type DiscoveryStorage = ReturnType<typeof createDiscoveryStorage>;
