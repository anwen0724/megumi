/* Verifies continuous Case references and operation boundaries before model execution. */
import { expect, it } from 'vitest';
import { EvaluationCaseSchema } from '../../evals/agent/contracts/evaluation-dataset';

const sequence = {
  schemaVersion: 2, caseId: 'continuous', revision: 1, name: 'Continuous', description: 'Lazy learning', type: 'preference_sequence',
  initialState: { clock: '2026-09-06T00:00:00Z', interests: [], candidates: [], recommendations: [], preferences: [], recommendationTargetCount: 1, recommendationWorkingSetCount: 10 },
  input: { steps: [{ stepId: 'inspect', kind: 'inspect', scope: { scope: 'exploration' } }, { stepId: 'next', kind: 'advance_clock', milliseconds: 1000 }] },
};

it('accepts a read-only continuous sequence and rejects duplicate steps, missing references and extra fields', () => {
  expect(EvaluationCaseSchema.safeParse(sequence).success).toBe(true);
  expect(EvaluationCaseSchema.safeParse({ ...sequence, input: { steps: [sequence.input.steps[0], sequence.input.steps[0]] } }).success).toBe(false);
  expect(EvaluationCaseSchema.safeParse({ ...sequence, input: { steps: [{ stepId: 'edit', kind: 'edit_preference', preferenceReferenceId: 'missing', statement: 'exact text' }] } }).success).toBe(false);
  expect(EvaluationCaseSchema.safeParse({ ...sequence, input: { steps: [{ stepId: 'next', kind: 'advance_clock', milliseconds: 1, learn: true }] } }).success).toBe(false);
});
