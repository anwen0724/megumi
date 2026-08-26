/* Derives Candidate Supply quality and cost metrics exclusively from persisted and Tool facts. */
import type { CandidateAdmissionDecision, CandidateQueryOutcome } from '@megumi/discovery';

export interface EvaluationRatio {
  readonly numerator: number;
  readonly denominator: number;
  readonly value: number | null;
}

export interface CandidateSupplyEvaluationQueryFact {
  readonly queryId: string;
  readonly sourceId: string;
  readonly status: CandidateQueryOutcome['status'];
  readonly rawResultCount: number;
  readonly invalidResultCount: number;
  readonly newCandidateCount: number;
  readonly mergedCandidateCount: number;
  readonly admissionSettled: boolean;
  readonly availableCandidateCount: number;
}

export interface CandidateSupplyEvaluationAssessmentFact {
  readonly decision: CandidateAdmissionDecision['decision'];
  readonly reasonCode?: Extract<CandidateAdmissionDecision, { decision: 'reject' }>['reasonCode'];
}

export interface CandidateSupplyEvaluationFacts {
  readonly gap: {
    readonly initialCount: number;
    readonly remainingCount: number;
  };
  readonly queries: readonly CandidateSupplyEvaluationQueryFact[];
  readonly assessments: readonly CandidateSupplyEvaluationAssessmentFact[];
  readonly candidates: {
    readonly materializedCount: number;
    readonly pendingCount: number;
  };
  readonly calls: {
    readonly model: number;
    readonly search: number;
    readonly read: number;
    readonly admission: number;
  };
}

export interface CandidateSupplyEvaluationMetrics {
  readonly gapElimination: EvaluationRatio;
  readonly newCandidateMaterial: EvaluationRatio;
  readonly admission: EvaluationRatio;
  readonly pending: EvaluationRatio;
  readonly rejectionReasons: Readonly<Record<string, EvaluationRatio>>;
  readonly semanticDuplicate: EvaluationRatio;
  readonly invalid: EvaluationRatio;
  readonly merge: EvaluationRatio;
  readonly zeroAdmissionQuery: EvaluationRatio;
  readonly sourceFailure: EvaluationRatio;
  readonly calls: CandidateSupplyEvaluationFacts['calls'];
}

export function calculateCandidateSupplyMetrics(
  facts: CandidateSupplyEvaluationFacts,
): CandidateSupplyEvaluationMetrics {
  assertFacts(facts);
  const rawResults = sum(facts.queries.map((query) => query.rawResultCount));
  const invalidResults = sum(facts.queries.map((query) => query.invalidResultCount));
  const normalizedResults = rawResults - invalidResults;
  const newCandidates = sum(facts.queries.map((query) => query.newCandidateCount));
  const mergedCandidates = sum(facts.queries.map((query) => query.mergedCandidateCount));
  const completedAssessments = facts.assessments.filter(({ decision }) => decision !== 'needs_detail');
  const admitted = completedAssessments.filter(({ decision }) => decision === 'admit').length;
  const rejected = completedAssessments.filter(({ decision }) => decision === 'reject');
  const settledSuccessfulQueries = facts.queries.filter((query) => (
    query.status === 'succeeded' && query.admissionSettled
  ));
  const terminalQueries = facts.queries.filter((query) => query.status !== 'running');
  const failedQueries = terminalQueries.filter((query) => query.status === 'failed');
  const eliminatedGapCount = Math.max(0, facts.gap.initialCount - facts.gap.remainingCount);
  const rejectionReasons = Object.fromEntries(
    [...new Set(rejected.flatMap(({ reasonCode }) => reasonCode ? [reasonCode] : []))]
      .sort()
      .map((reasonCode) => [
        reasonCode,
        ratio(rejected.filter((assessment) => assessment.reasonCode === reasonCode).length, rejected.length),
      ]),
  );

  return {
    gapElimination: ratio(eliminatedGapCount, facts.gap.initialCount),
    newCandidateMaterial: ratio(newCandidates, rawResults),
    admission: ratio(admitted, completedAssessments.length),
    pending: ratio(facts.candidates.pendingCount, facts.candidates.materializedCount),
    rejectionReasons,
    semanticDuplicate: ratio(
      rejected.filter(({ reasonCode }) => reasonCode === 'semantic_duplicate').length,
      completedAssessments.length,
    ),
    invalid: ratio(invalidResults, rawResults),
    merge: ratio(mergedCandidates, normalizedResults),
    zeroAdmissionQuery: ratio(
      settledSuccessfulQueries.filter(({ availableCandidateCount }) => availableCandidateCount === 0).length,
      settledSuccessfulQueries.length,
    ),
    sourceFailure: ratio(failedQueries.length, terminalQueries.length),
    calls: { ...facts.calls },
  };
}

function ratio(numerator: number, denominator: number): EvaluationRatio {
  return { numerator, denominator, value: denominator === 0 ? null : numerator / denominator };
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function assertFacts(facts: CandidateSupplyEvaluationFacts): void {
  const values = [
    facts.gap.initialCount,
    facts.gap.remainingCount,
    facts.candidates.materializedCount,
    facts.candidates.pendingCount,
    ...Object.values(facts.calls),
    ...facts.queries.flatMap((query) => [
      query.rawResultCount,
      query.invalidResultCount,
      query.newCandidateCount,
      query.mergedCandidateCount,
      query.availableCandidateCount,
    ]),
  ];
  if (values.some((value) => !Number.isInteger(value) || value < 0)) {
    throw new Error('Candidate Supply Evaluation facts must be non-negative integers.');
  }
  if (facts.candidates.pendingCount > facts.candidates.materializedCount) {
    throw new Error('Pending Candidate count cannot exceed materialized Candidate count.');
  }
  for (const query of facts.queries) {
    if (query.invalidResultCount > query.rawResultCount) {
      throw new Error(`Invalid result count exceeds raw results for ${query.queryId}.`);
    }
  }
}
