/* Imports additive Human Grader results without replacing automated grades. */
import { z } from 'zod';
import { GraderResultSchema } from '../runtime/grading';
import { EvaluationRunResultSchema, type EvaluationRunResult } from '../runtime/evaluation-result';

export const HumanReviewImportSchema = z.object({
  runId: z.string().min(1),
  reviews: z.array(z.object({
    caseRunId: z.string().min(1),
    grade: GraderResultSchema.refine((grade) => grade.grader === 'human', 'Review grade must use the human Grader.'),
  }).strict()),
}).strict();

export function importHumanReview(result: EvaluationRunResult, raw: unknown): EvaluationRunResult {
  const review = HumanReviewImportSchema.parse(raw);
  if (review.runId !== result.runId) throw new Error('Human Review Run ID does not match the Evaluation result.');
  return EvaluationRunResultSchema.parse({
    ...result,
    caseResults: result.caseResults.map((caseResult) => ({
      ...caseResult,
      grades: [
        ...caseResult.grades,
        ...review.reviews.filter((entry) => entry.caseRunId === caseResult.caseRunId).map((entry) => entry.grade),
      ],
    })),
  });
}

