/* Defines grader, case, suite, and report outcomes without mutating product facts. */
import type { EvaluationEvidence, EvaluationExecution } from '../runner/evaluation-contracts';
import type { EvaluationPolicy } from '../suites/evaluation-suite';

export type EvaluationGraderStatus = 'passed' | 'failed' | 'needs_review' | 'error' | 'skipped';
export type EvaluationCaseVerdict = 'passed' | 'failed' | 'needs_review' | 'insufficient_evidence';
export type EvaluationSuiteVerdict = 'passed' | 'failed' | 'invalid';

export interface EvaluationGraderResult {
  graderId: string;
  status: EvaluationGraderStatus;
  summary: string;
  evidenceReferences: string[];
  required: boolean;
}

export interface EvaluationReport {
  schemaVersion: 1;
  execution: EvaluationExecution;
  evidence: EvaluationEvidence;
  graderResults: EvaluationGraderResult[];
  caseVerdict: EvaluationCaseVerdict;
  needsReview: string[];
  summary: {
    modelCallCount: number;
    toolCallCount: number;
    durationMs?: number;
    tokenCount?: number;
    finalReply?: string;
    fileChanges: string[];
  };
}

export interface EvaluationSuiteReport {
  schemaVersion: 1;
  suiteId: string;
  targetId: string;
  executionProfileId: string;
  policy: EvaluationPolicy & { resolvedCaseIds: string[] };
  verdict: EvaluationSuiteVerdict;
  executionReports: EvaluationReport[];
  metrics: Record<string, number | null>;
  baselineComparison: EvaluationBaselineComparison;
}

export type EvaluationBaselineComparison =
  | { status: 'no_baseline'; differences: [] }
  | { status: 'comparable'; differences: [] }
  | { status: 'not_comparable'; differences: string[] };
