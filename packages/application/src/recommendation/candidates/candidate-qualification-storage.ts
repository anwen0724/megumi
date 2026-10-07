/* Owns versioned candidate qualification; all readers use the same eligibility predicate. */
import { z } from 'zod';
import type { DatabaseConnection } from '../../storage/index';
import { ANALYSIS_CONTRACT_VERSION, MATCHING_CONTRACT_VERSION, EvidenceSchema } from '../content/material-contracts';
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
export function createCandidateQualificationStorage(database: DatabaseConnection) {
  const materials = createMaterialStorage(database);
  return {
    /** Commits matching independently from material analysis. */
    saveQualification(input: CandidateQualification): { status: 'saved' | 'input_changed' } {
      const candidate = CandidateQualificationSchema.parse(input);
      return database.transaction({
        operation: () => {
          const current = database.prepare({
            sql: `WITH rc(content_id,interest_id,interest_revision,material_id,analysis_contract_version) AS (VALUES(?,?,?,?,?)) SELECT 1 FROM rc WHERE ${CURRENT_INPUT_WHERE}`
          }).get([
            candidate.contentId,
            candidate.interestId,
            candidate.interestRevision,
            candidate.materialId,
            ANALYSIS_CONTRACT_VERSION
          ]);
          if (!current) return { status: 'input_changed' };
          const material = materials.readMaterial(candidate.materialId);
          if (!material) return { status: 'input_changed' };
          validateEvidence(material, candidate.evidence);
          database.prepare({
            sql: `INSERT INTO recommendation_candidates(content_id,interest_id,interest_revision,material_id,analysis_contract_version,matching_contract_version,relation,status,basis,evidence,reviewed_at,valid_until)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(content_id,interest_id) DO UPDATE SET interest_revision=excluded.interest_revision,material_id=excluded.material_id,analysis_contract_version=excluded.analysis_contract_version,matching_contract_version=excluded.matching_contract_version,relation=excluded.relation,status=excluded.status,basis=excluded.basis,evidence=excluded.evidence,reviewed_at=excluded.reviewed_at,valid_until=excluded.valid_until` }).run([
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
    listEligible(now: number): readonly CandidateQualification[] {
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
        valid_until: number
      }>({
        sql: `SELECT rc.* FROM recommendation_candidates rc
        WHERE ${CURRENT_INPUT_WHERE} AND rc.status = 'eligible' AND rc.analysis_contract_version = ? AND rc.matching_contract_version = ? AND rc.valid_until > ? ORDER BY rc.content_id,rc.interest_id`
      }).all([ANALYSIS_CONTRACT_VERSION, MATCHING_CONTRACT_VERSION, now]).map((row) => CandidateQualificationSchema.parse({
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
}
