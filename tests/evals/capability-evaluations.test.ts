/* Verifies every evaluated Product capability has one dedicated Evaluation Module. */
import { describe, expect, it } from 'vitest';
import { loadEvaluationCatalog } from '../../evals/agent/catalog/evaluation-catalog';
import { candidateSupplyEvaluation } from '../../evals/agent/capabilities/candidate-supply/candidate-supply-evaluation';
import { conversationEvaluation } from '../../evals/agent/capabilities/conversation/conversation-evaluation';
import { dailyRecommendationEvaluation } from '../../evals/agent/capabilities/daily-recommendation/daily-recommendation-evaluation';
import { interestUnderstandingEvaluation } from '../../evals/agent/capabilities/interest-understanding/interest-understanding-evaluation';
import { preferenceLearningEvaluation } from '../../evals/agent/capabilities/preference-learning/preference-learning-evaluation';

describe('Capability Evaluation modules', () => {
  it('covers the complete Case catalog with one business-specific executor', async () => {
    const catalog = await loadEvaluationCatalog('evals/agent');
    const evaluators = [
      conversationEvaluation,
      interestUnderstandingEvaluation,
      candidateSupplyEvaluation,
      dailyRecommendationEvaluation,
      preferenceLearningEvaluation,
    ];
    const capabilities = evaluators.map((evaluation) => evaluation.capability);

    expect(new Set(capabilities).size).toBe(5);
    expect(capabilities.sort()).toEqual([
      'candidate_supply',
      'conversation',
      'daily_recommendation',
      'interest_understanding',
      'preference_learning',
    ]);
    expect([...catalog.cases.values()].every((evaluationCase) => (
      capabilities.includes(evaluationCase.capability)
    ))).toBe(true);
    expect(evaluators.every((evaluation) => typeof evaluation.execute === 'function')).toBe(true);
  });
});
