/*
 * Defines the Candidate Supply interface: maintenance, preparation, the
 * caller-provided usage and retention contracts, and the results both
 * operations return. Behaviour lives in the supply implementation.
 */
import { z } from 'zod';
import {
  CandidatePoolSchema,
  type CandidatePool,
  type CandidateSnapshot,
  type SupplyHealth,
} from '../candidates/candidate-contracts';
import { InterestIdSchema, type InterestSnapshotEntry } from '../interests/interest-contracts';

/** Content a usage already spent or excluded. Supply never writes this record. */
export const UsageSnapshotSchema = z
  .object({
    revision: z.string(),
    excludedContentIds: z.array(z.string().trim().min(1)),
  })
  .strict();
export type UsageSnapshot = z.infer<typeof UsageSnapshotSchema>;

/** Reads the current usage record for one pool. A read failure is not "empty". */
export interface UsageReader {
  readUsageSnapshot(pool: CandidatePool): Promise<UsageSnapshot>;
}

/**
 * Reports content ids that still have a business reason to keep their identity
 * and display data, such as recommendation history or favourites. A failing
 * query rejects; supply never treats a failure as "no references".
 */
export interface ContentRetentionReader {
  findRetainedContentIds(contentIds: readonly string[]): Promise<readonly string[]>;
}

export const CoverageRequirementSchema = z
  .object({ interestId: InterestIdSchema, minimumCount: z.number().int().positive() })
  .strict();
export type CoverageRequirement = z.infer<typeof CoverageRequirementSchema>;

/**
 * What one caller needs from one pool. `minimumCount` is the caller's own need
 * and is unrelated to supply thresholds; coverage entries are optional
 * per-interest floors that must not exceed the pool minimum.
 */
export const CandidateRequirementSchema = z
  .object({
    pool: CandidatePoolSchema,
    minimumCount: z.number().int().positive(),
    coverage: z.array(CoverageRequirementSchema),
  })
  .strict()
  .superRefine((requirement, context) => {
    const seen = new Set<string>();
    for (const entry of requirement.coverage) {
      if (seen.has(entry.interestId)) {
        context.addIssue({
          code: 'custom',
          path: ['coverage'],
          message: 'Coverage interest ids must be unique.',
        });
      }
      seen.add(entry.interestId);
      if (entry.minimumCount > requirement.minimumCount) {
        context.addIssue({
          code: 'custom',
          path: ['coverage'],
          message: 'Coverage minimum must not exceed minimumCount.',
        });
      }
    }
  });
export type CandidateRequirement = z.infer<typeof CandidateRequirementSchema>;

/** Reasons no local candidate can satisfy a request before any external work. */
export const UnavailableCodeSchema = z.enum([
  'DISABLED',
  'NO_INTERESTS',
  'MODEL_UNAVAILABLE',
  'SOURCE_UNAVAILABLE',
  'SERVICE_CLOSED',
]);
export type UnavailableCode = z.infer<typeof UnavailableCodeSchema>;

export const StopReasonSchema = z.enum([
  'targets_met',
  'minimums_met',
  'no_work',
  'budget_exhausted',
  'deadline',
  'sources_exhausted',
  'blocked',
  'cancelled',
]);
export type StopReason = z.infer<typeof StopReasonSchema>;

export const IssueStageSchema = z.enum(['configuration', 'search', 'material', 'analysis', 'matching']);
export type IssueStage = z.infer<typeof IssueStageSchema>;

/** One reportable problem, merged by stage, code, and subject instead of per fragment. */
export const SupplyIssueSchema = z
  .object({
    stage: IssueStageSchema,
    code: z.string().trim().min(1),
    subjectId: z.string().trim().min(1).optional(),
    message: z.string().trim().min(1),
  })
  .strict();
export type SupplyIssue = z.infer<typeof SupplyIssueSchema>;

/** Mutually exclusive preparation outcomes. */
export type PreparationResult =
  | { status: 'ready'; snapshot: CandidateSnapshot }
  | { status: 'invalid_request'; code: string; message: string }
  | {
      status: 'insufficient';
      snapshot: CandidateSnapshot;
      stopReason: StopReason;
      issues: SupplyIssue[];
    }
  | { status: 'input_changed'; interests: InterestSnapshotEntry[] }
  | { status: 'unavailable'; code: UnavailableCode; message: string }
  | { status: 'cancelled' };

/** What one maintenance run saved, reported apart from pool levels. */
export interface MaintenanceCounts {
  discoveredItems: number;
  normalizedContents: number;
  analyzedContents: number;
  newCandidates: number;
}

export interface MaintenanceResult {
  status: 'completed' | 'cancelled';
  stopReason: StopReason;
  savedCounts: MaintenanceCounts;
  poolHealth: SupplyHealth[];
  issues: SupplyIssue[];
}

export interface MaintenanceHandle {
  readonly id: string;
  readonly result: Promise<MaintenanceResult>;
}

/** Raised synchronously when maintenance is requested after close. */
export class SupplyLifecycleError extends Error {
  readonly code = 'SERVICE_CLOSED';

  constructor(message = 'Candidate supply is closed.') {
    super(message);
    this.name = 'SupplyLifecycleError';
  }
}

export interface CandidateSupply {
  startMaintenance(input: { reason: 'startup' | 'periodic' }): MaintenanceHandle;
  prepareCandidates(input: {
    requirement: CandidateRequirement;
    signal?: AbortSignal;
  }): Promise<PreparationResult>;
  listCandidates(input: { requirement: CandidateRequirement }): Promise<CandidateSnapshot>;
  close(): Promise<void>;
}
