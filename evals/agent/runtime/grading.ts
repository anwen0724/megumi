/* Defines independent deterministic, model, and human grading outcomes. */
import { z } from 'zod';
import type { EvaluationCase } from '../catalog/evaluation-case';
import type { EvidenceBundle } from './evidence';

export const GradeJudgementSchema = z.enum(['pass', 'fail', 'not_gradable']);
export const GraderResultSchema = z.object({
  grader: z.enum(['deterministic', 'model', 'human']),
  dimension: z.string().min(1),
  judgement: GradeJudgementSchema,
  score: z.number().int().min(0).max(4).optional(),
  rationale: z.string().min(1),
  evidenceRefs: z.array(z.string().min(1)),
  graderModel: z.string().min(1).optional(),
  promptVersion: z.string().min(1).optional(),
  ruleVersion: z.string().min(1),
  gradedAt: z.string().datetime({ offset: true }),
}).strict().superRefine((value, context) => {
  if (value.grader === 'model' && value.judgement !== 'not_gradable' && value.score === undefined) {
    context.addIssue({ code: 'custom', path: ['score'], message: 'Model grades require a 0-4 score.' });
  }
});
export type GraderResult = z.infer<typeof GraderResultSchema>;

export interface DeterministicRule {
  readonly ruleId: string;
  readonly evaluate: (evidence: import('./evidence').EvidenceBundle) => Omit<GraderResult, 'grader' | 'gradedAt' | 'ruleVersion'>;
}

export function gradeDeterministically(input: {
  readonly evidence: import('./evidence').EvidenceBundle;
  readonly rules: readonly DeterministicRule[];
  readonly now: string;
  readonly ruleVersion: string;
}): GraderResult[] {
  return input.rules.map((rule) => GraderResultSchema.parse({
    grader: 'deterministic',
    gradedAt: input.now,
    ruleVersion: input.ruleVersion,
    ...rule.evaluate(input.evidence),
  }));
}

/** Evaluates only explicit product and evidence hard gates. */
export function gradeHardGates(input: {
  readonly evaluationCase: EvaluationCase;
  readonly evidence: EvidenceBundle;
  readonly now: string;
}): GraderResult[] {
  return input.evaluationCase.grading.hardGates.map((gate) => {
    const result = evaluateGate(gate, input.evidence);
    return GraderResultSchema.parse({
      grader: 'deterministic',
      dimension: gate,
      judgement: result.passed ? 'pass' : 'fail',
      rationale: result.rationale,
      evidenceRefs: result.evidenceRefs,
      ruleVersion: 'hard-gates-v1',
      gradedAt: input.now,
    });
  });
}

function evaluateGate(gate: string, evidence: EvidenceBundle): {
  readonly passed: boolean;
  readonly rationale: string;
  readonly evidenceRefs: readonly string[];
} {
  switch (gate) {
    case 'business_completion_present':
      return {
        passed: Object.keys(evidence.completion).length > 0,
        rationale: 'A durable business or Execution completion result must be present.',
        evidenceRefs: [`${evidence.evidenceId}#completion`],
      };
    case 'trace_correlated':
      return {
        passed: evidence.trace !== null,
        rationale: 'The Case requires one correlated Trace.',
        evidenceRefs: [`${evidence.evidenceId}#trace`],
      };
    case 'no_evidence_conflict':
      return {
        passed: !evidence.issues.some((issue) => issue.code === 'evidence_conflict'),
        rationale: 'Business facts and execution evidence must not conflict.',
        evidenceRefs: [`${evidence.evidenceId}#issues`],
      };
    case 'no_scope_escape':
      return {
        passed: !JSON.stringify(evidence.afterFacts).includes('scope_escape'),
        rationale: 'No product result may report an out-of-scope operation.',
        evidenceRefs: [`${evidence.evidenceId}#afterFacts`],
      };
    default:
      return {
        passed: false,
        rationale: `Unknown deterministic hard gate: ${gate}.`,
        evidenceRefs: [],
      };
  }
}
