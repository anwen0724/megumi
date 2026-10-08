/* Verifies denominator and unknown handling without a database or external model. */
import { expect, it } from 'vitest';
import { summarizeHumanReview, type EffectReview } from '../../../scripts/memory/effect-review';
import type { EffectFixture } from '../../../scripts/memory/effect-fixtures';

const fixture: EffectFixture = {
  id: 'sample', category: 'preference', project: 'sample', histories: [], task: 'Synthetic review input', forbidden: [],
  facts: [
    { id: 'remembered', description: 'Preferred unit', field: 'unit', expected: 'ms', applicability: 'report', evidence: ['history'] },
    { id: 'given', description: 'Current task value', field: 'value', expected: 20, applicability: 'this task', evidence: [], memoryRequired: false },
  ],
};
const manifest = { fixtures: [fixture], conditions: ['memory'], repeats: 2 };
const reviewed: EffectReview = {
  id: 'sample/memory/1', facts: [{ id: 'remembered', review: { recalled: true, used: true, correctAndApplicable: true, evidenceLocation: 'requests.jsonl:1 system; answer.unit' } }],
  forbidden: [], additionalKnowledgeReviewed: true, additionalUsedKnowledge: [],
  humanReview: { taskSucceeded: true, constraintsRespected: true, wrongFactUses: 0, repeatedFailedSteps: 0, repeatedQuestions: 0, irrelevantReads: 0, crossProjectMisuses: 0, notes: '' },
};

it('retains missing trials and unknown judgments while excluding current-task facts from recall', () => {
  const result = summarizeHumanReview(manifest, [reviewed]);
  expect(result.byCondition.memory).toMatchObject({
    plannedTasks: 2, taskSuccess: { numerator: 1, denominator: 2, unresolved: 1, rate: null },
    knowledgeRecall: { numerator: 1, denominator: 2, unresolved: 1, rate: null },
    reviewComplete: false, incomplete: ['sample/memory/2'],
  });
  expect(result.allCategoriesShowRepeatableReuse).toBe(false);
});

it('counts unsupported used knowledge against precision and does not infer repeatable reuse from task success', () => {
  const other: EffectReview = { ...reviewed, id: 'sample/memory/2', additionalUsedKnowledge: [{ description: 'Unsupported project default', correctAndApplicable: false, evidenceLocation: 'answer.extra' }],
    humanReview: { ...reviewed.humanReview!, wrongFactUses: 1 } };
  const result = summarizeHumanReview(manifest, [reviewed, other]);
  expect(result.byCondition.memory).toMatchObject({ taskSuccess: { rate: 1 }, knowledgeRecall: { rate: 1 }, useAccuracy: { numerator: 2, denominator: 3, rate: 2 / 3 }, reviewComplete: true });
  expect(result.allCategoriesShowRepeatableReuse).toBe(false);
});
