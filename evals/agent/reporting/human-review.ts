/* Imports additive Human Metric results without replacing automated evaluation. */
import { z } from 'zod';
import {
  EvaluationRunResultSchema,
  TaskMetricResultSchema,
  type EvaluationRunResult,
} from '../contracts/evaluation-result';

export const HumanReviewImportSchema = z.object({
  runId: z.string().min(1),
  reviews: z.array(z.object({
    taskRunId: z.string().min(1),
    result: TaskMetricResultSchema.refine(
      (result) => result.evaluator === 'human',
      'Human Review result must use the human evaluator.',
    ),
  }).strict()),
}).strict();

export function importHumanReview(result: EvaluationRunResult, raw: unknown): EvaluationRunResult {
  const review = HumanReviewImportSchema.parse(raw);
  if (review.runId !== result.runId) throw new Error('Human Review Run ID does not match the Evaluation result.');
  return EvaluationRunResultSchema.parse({
    ...result,
    taskResults: result.taskResults.map((taskResult) => ({
      ...taskResult,
      metricResults: [
        ...taskResult.metricResults,
        ...review.reviews
          .filter((entry) => entry.taskRunId === taskResult.taskRunId)
          .map((entry) => entry.result),
      ],
    })),
  });
}
