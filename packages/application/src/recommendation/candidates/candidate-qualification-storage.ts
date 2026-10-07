/*
 * Owns versioned candidate qualification; all readers use the same eligibility predicate.
 */
import { z } from 'zod';
import type { DatabaseConnection } from '../../storage/index';
import { ANALYSIS_CONTRACT_VERSION, MATCHING_CONTRACT_VERSION, EvidenceSchema, type DiscoveryAttempt } from '../content/material-contracts';
import { randomUUID } from 'node:crypto';
import { createMaterialStorage, validateEvidence } from '../content/material-storage';
export const CandidateQualificationSchema = z.object({
  contentId: z.string().min(1),
  interestId: z.string().min(1),
  interestRevision: z.number().int().positive(),
  materialId: z.string().min(1),
  relation: z.enum(['direct', 'related', 'none']),
  status: z.enum(['eligible', 'rejected', 'pending']),
  basis: z.string().min(1),
  evidence: z.array(EvidenceSchema),
  reviewedAt: z.number().int().nonnegative(),
  validUntil: z.number().int().positive(),
}).strict().superRefine((candidate, context) => {
  if (candidate.validUntil <= candidate.reviewedAt || (candidate.status === 'eligible' && (candidate.relation === 'none' || candidate.evidence.length === 0))) {
    context.addIssue({
      code: 'custom',
      message: 'Eligible candidates need a positive relation, material evidence and a future review deadline.'
    });
  }
});
export type CandidateQualification = z.infer<typeof CandidateQualificationSchema>;
// The same input predicate guards reads and commits; material changes need no cleanup job.
const CURRENT_INPUT_WHERE = `EXISTS (SELECT 1 FROM interests i WHERE i.id = rc.interest_id AND i.enabled = 1 AND i.revision = rc.interest_revision)
  AND EXISTS (SELECT 1 FROM contents c WHERE c.id = rc.content_id AND c.current_material_id = rc.material_id)
  AND EXISTS (SELECT 1 FROM content_analysis a WHERE a.content_id = rc.content_id AND a.material_id = rc.material_id AND a.contract_version = rc.analysis_contract_version AND a.status = 'ready')`;
/** Creates single-pool persistence after the pending foundation migration is applied. */
export function createCandidateQualificationStorage(database: DatabaseConnection, newId: () => string = randomUUID) {
  const materials = createMaterialStorage(database);
  const storage = {
    /** Counts an in-request correction against this exact matching input. */
    retryMatching(contentId: string, interestId: string, attempt: DiscoveryAttempt, now: number): boolean {
      return database.prepare({ sql: 'UPDATE recommendation_candidates SET attempts=attempts+1 WHERE content_id=? AND interest_id=? AND owner_run_id=? AND attempt_token=? AND attempts<3 AND attempt_deadline_at>?' }).run([contentId, interestId, attempt.runId, attempt.token, now]).changes > 0;
    },
    /** Reads one content per duplicate group, retaining all of its matching interests. */
    listCandidates(now: number, input: {
      contentLanguages?: readonly string[];
      excludeContentIds?: readonly string[];
      interestIds?: readonly string[];
    } = {}) {
      const pairs = storage.listEligible(now, input).filter(pair => !input.interestIds || input.interestIds.includes(pair.interestId));
      const groups = new Map<string, {
        contentId: string;
        materialId: string;
        publisher: string;
        qualifications: CandidateQualification[];
      }>();
      for (const pair of pairs) {
        const row = database.prepare<{
          duplicate_group_id: string | null;
          author_id: string | null;
          author: string | null;
          canonical_url: string;
        }>({ sql: 'SELECT * FROM contents WHERE id=?' }).get([pair.contentId])!;
        const group = row.duplicate_group_id ?? pair.contentId;
        const old = groups.get(group);
        if (old) {
          if (old.contentId === pair.contentId && !old.qualifications.some(q => q.interestId === pair.interestId))
            old.qualifications.push(pair);
        }
        else
          groups.set(group, { contentId: pair.contentId, materialId: pair.materialId, publisher: row.author_id ?? row.author ?? new URL(row.canonical_url).hostname, qualifications: [pair] });
      }
      return [...groups.values()].map(item => ({ ...item, material: materials.readMaterial(item.materialId)!, analysis: materials.readAnalysis(item.contentId, item.materialId)! }));
    },
    /** Counts exactly the qualified input visible to result consumers. */
    inventory(now: number, interestId: string, contentLanguages: readonly string[]) {
      return storage.listCandidates(now, { contentLanguages, interestIds: [interestId] }).length;
    },
    /** Resolves duplicate identity without transferring evidence between material versions. */
    duplicateGroup(contentId: string): string {
      return database.prepare<{
        duplicate_group_id: string | null;
      }>({ sql: 'SELECT duplicate_group_id FROM contents WHERE id=?' }).get([contentId])?.duplicate_group_id ?? contentId;
    },
    /** Claims one interest/material match; a changed input resets its retry counter. */
    claimMatching(input: {
      contentId: string;
      materialId: string;
      interestId: string;
      interestRevision: number;
      runId: string;
      now: number;
      deadlineAt: number;
    }): DiscoveryAttempt | undefined {
      return database.transaction({
        operation: () => {
          const current = database.prepare({ sql: `WITH rc(content_id,interest_id,interest_revision,material_id,analysis_contract_version) AS (VALUES(?,?,?,?,?)) SELECT 1 FROM rc WHERE ${CURRENT_INPUT_WHERE}` }).get([input.contentId, input.interestId, input.interestRevision, input.materialId, ANALYSIS_CONTRACT_VERSION]);
          if (!current || input.deadlineAt <= input.now || !database.prepare({ sql: "SELECT 1 FROM discovery_runs WHERE id=? AND status='running'" }).get([input.runId]))
            return undefined;
          const old = database.prepare<{
            interest_revision: number;
            material_id: string;
            analysis_contract_version: number;
            matching_contract_version: number;
            status: string;
            valid_until: number;
            attempts: number;
            retry_at: number | null;
            attempt_deadline_at: number | null;
          }>({ sql: 'SELECT * FROM recommendation_candidates WHERE content_id=? AND interest_id=?' }).get([input.contentId, input.interestId]);
          const same = old && old.interest_revision === input.interestRevision && old.material_id === input.materialId && old.analysis_contract_version === ANALYSIS_CONTRACT_VERSION && old.matching_contract_version === MATCHING_CONTRACT_VERSION && old.valid_until > input.now;
          if (same && (old.status !== 'pending' || old.attempts >= 3 || (old.retry_at ?? 0) > input.now || (old.attempt_deadline_at ?? 0) > input.now))
            return undefined;
          const token = newId();
          database.prepare({
            sql: `INSERT INTO recommendation_candidates(content_id,interest_id,interest_revision,material_id,analysis_contract_version,matching_contract_version,relation,status,basis,evidence,reviewed_at,valid_until,attempts,owner_run_id,attempt_token,attempt_started_at,attempt_deadline_at)
          VALUES(?,?,?,?,?,?,'none','pending','Awaiting matching','[]',?,?,?,?,?,?,?) ON CONFLICT(content_id,interest_id) DO UPDATE SET interest_revision=excluded.interest_revision,material_id=excluded.material_id,analysis_contract_version=excluded.analysis_contract_version,matching_contract_version=excluded.matching_contract_version,relation='none',status='pending',basis=excluded.basis,evidence='[]',reviewed_at=excluded.reviewed_at,valid_until=excluded.valid_until,attempts=excluded.attempts,retry_at=NULL,error_code=NULL,owner_run_id=excluded.owner_run_id,attempt_token=excluded.attempt_token,attempt_started_at=excluded.attempt_started_at,attempt_deadline_at=excluded.attempt_deadline_at` }).run([input.contentId, input.interestId, input.interestRevision, input.materialId, ANALYSIS_CONTRACT_VERSION, MATCHING_CONTRACT_VERSION, input.now, input.now + 30 * 86400000, same ? old.attempts + 1 : 1, input.runId, token, input.now, input.deadlineAt]);
          return { runId: input.runId, token, startedAt: input.now, deadlineAt: input.deadlineAt };
        }
      });
    },
    /** Releases only this match attempt and preserves the current input for retry. */
    releaseMatching(contentId: string, interestId: string, attempt: DiscoveryAttempt, now: number, errorCode?: string): void {
      database.prepare({ sql: 'UPDATE recommendation_candidates SET error_code=?,retry_at=?,owner_run_id=NULL,attempt_token=NULL,attempt_started_at=NULL,attempt_deadline_at=NULL WHERE content_id=? AND interest_id=? AND owner_run_id=? AND attempt_token=?' }).run([errorCode ?? null, errorCode ? now + 60000 : null, contentId, interestId, attempt.runId, attempt.token]);
    },
    /** Recovers ownership without clearing a newer claimant. */
    recoverInterrupted(): void {
      database.prepare({ sql: "UPDATE recommendation_candidates SET owner_run_id=NULL,attempt_token=NULL,attempt_started_at=NULL,attempt_deadline_at=NULL WHERE owner_run_id IN (SELECT id FROM discovery_runs WHERE status IN ('interrupted','cancelled'))" }).run();
    },
    /** Classifies current matching work using the same input and expiry as qualification. */
    matchingWork(contentId: string, materialId: string, interestId: string, revision: number, now: number): 'ready' | 'actionable' | 'blocked' | 'running' | 'failed' {
      const row = database.prepare<{
        status: string;
        interest_revision: number;
        material_id: string;
        analysis_contract_version: number;
        matching_contract_version: number;
        valid_until: number;
        attempts: number;
        retry_at: number | null;
        attempt_deadline_at: number | null;
      }>({ sql: 'SELECT * FROM recommendation_candidates WHERE content_id=? AND interest_id=?' }).get([contentId, interestId]);
      if (!row || row.interest_revision !== revision || row.material_id !== materialId || row.analysis_contract_version !== ANALYSIS_CONTRACT_VERSION || row.matching_contract_version !== MATCHING_CONTRACT_VERSION || row.valid_until <= now)
        return 'actionable';
      return row.status !== 'pending' ? 'ready' : (row.attempt_deadline_at ?? 0) > now ? 'running' : row.attempts >= 3 ? 'failed' : (row.retry_at ?? 0) > now ? 'blocked' : 'actionable';
    },
    /** Commits matching independently from material analysis. */
    saveQualification(input: CandidateQualification, attempt?: DiscoveryAttempt): {
      status: 'saved' | 'input_changed';
    } {
      const candidate = CandidateQualificationSchema.parse(input);
      return database.transaction({
        operation: () => {
          if (attempt && !database.prepare({
            sql: `SELECT 1 FROM recommendation_candidates c JOIN discovery_runs r ON r.id = c.owner_run_id
              WHERE c.content_id = ? AND c.interest_id = ? AND c.owner_run_id = ? AND c.attempt_token = ?
              AND c.attempt_deadline_at > ? AND r.status = 'running'`,
          }).get([candidate.contentId, candidate.interestId, attempt.runId, attempt.token, candidate.reviewedAt]))
            return { status: 'input_changed' };
          const current = database.prepare({
            sql: `WITH rc(content_id,interest_id,interest_revision,material_id,analysis_contract_version) AS (VALUES(?,?,?,?,?)) SELECT 1 FROM rc WHERE ${CURRENT_INPUT_WHERE}`
          }).get([
            candidate.contentId,
            candidate.interestId,
            candidate.interestRevision,
            candidate.materialId,
            ANALYSIS_CONTRACT_VERSION
          ]);
          if (!current)
            return { status: 'input_changed' };
          const material = materials.readMaterial(candidate.materialId);
          if (!material)
            return { status: 'input_changed' };
          validateEvidence(material, candidate.evidence);
          database.prepare({
            sql: `INSERT INTO recommendation_candidates(content_id,interest_id,interest_revision,material_id,analysis_contract_version,matching_contract_version,relation,status,basis,evidence,reviewed_at,valid_until)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(content_id,interest_id) DO UPDATE SET interest_revision=excluded.interest_revision,material_id=excluded.material_id,analysis_contract_version=excluded.analysis_contract_version,matching_contract_version=excluded.matching_contract_version,relation=excluded.relation,status=excluded.status,basis=excluded.basis,evidence=excluded.evidence,reviewed_at=excluded.reviewed_at,valid_until=excluded.valid_until,owner_run_id=NULL,attempt_token=NULL,attempt_started_at=NULL,attempt_deadline_at=NULL,retry_at=NULL,error_code=NULL`
          }).run([
            candidate.contentId,
            candidate.interestId,
            candidate.interestRevision,
            candidate.materialId,
            ANALYSIS_CONTRACT_VERSION,
            MATCHING_CONTRACT_VERSION,
            candidate.relation,
            candidate.status,
            candidate.basis,
            JSON.stringify(candidate.evidence),
            candidate.reviewedAt,
            candidate.validUntil
          ]);
          return { status: 'saved' };
        }
      });
    },
    /** Reads qualified pairs without source or model work. */
    listEligible(now: number, input: {
      contentLanguages?: readonly string[];
      excludeContentIds?: readonly string[];
    } = {}): readonly CandidateQualification[] {
      const excludedGroups = new Set((input.excludeContentIds ?? []).map((id) => {
        const row = database.prepare<{
          duplicate_group_id: string | null;
        }>({ sql: 'SELECT duplicate_group_id FROM contents WHERE id = ?' }).get([id]);
        return row?.duplicate_group_id ?? id;
      }));
      return database.prepare<{
        content_id: string;
        interest_id: string;
        interest_revision: number;
        material_id: string;
        relation: string;
        status: string;
        basis: string;
        evidence: string;
        reviewed_at: number;
        valid_until: number;
        language: string | null;
        duplicate_group_id: string | null;
      }>({
        sql: `SELECT rc.*,c.language,c.duplicate_group_id FROM recommendation_candidates rc JOIN contents c ON c.id = rc.content_id
        WHERE ${CURRENT_INPUT_WHERE} AND rc.status = 'eligible' AND rc.analysis_contract_version = ? AND rc.matching_contract_version = ? AND rc.valid_until > ? ORDER BY rc.content_id,rc.interest_id`
      }).all([ANALYSIS_CONTRACT_VERSION, MATCHING_CONTRACT_VERSION, now]).filter((row) => (!input.contentLanguages?.length || row.language !== null && input.contentLanguages.includes(row.language)) &&
        !excludedGroups.has(row.duplicate_group_id ?? row.content_id)).map((row) => CandidateQualificationSchema.parse({
          contentId: row.content_id,
          interestId: row.interest_id,
          interestRevision: row.interest_revision,
          materialId: row.material_id,
          relation: row.relation,
          status: row.status,
          basis: row.basis,
          evidence: JSON.parse(row.evidence),
          reviewedAt: row.reviewed_at,
          validUntil: row.valid_until
        }));
    },
  };
  return storage;
}
export type CandidateQualificationStorage = ReturnType<typeof createCandidateQualificationStorage>;
