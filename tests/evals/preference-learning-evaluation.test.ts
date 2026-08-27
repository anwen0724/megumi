/* Verifies fixed Feedback sequences produce exact, explainable Preference revisions. */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  evaluatePreferenceLearningCase,
  PREFERENCE_LEARNING_FIXED_CASES,
  type PreferenceLearningEvaluationCase,
} from '../../evals/agent/preference-learning';

describe('Preference Learning Evaluation', () => {
  it('passes aligned, isolated, switched, and withdrawn Feedback sequences', () => {
    const results = PREFERENCE_LEARNING_FIXED_CASES.map(evaluatePreferenceLearningCase);

    expect(results.every(({ passed }) => passed)).toBe(true);
    expect(PREFERENCE_LEARNING_FIXED_CASES.map(({ caseId }) => caseId)).toEqual([
      'three-aligned-feedback',
      'cross-interest-isolation',
      'feedback-switch-correction',
      'feedback-withdrawal',
    ]);
  });

  it('reports exact Direction polarity and Evidence counts', () => {
    const evaluationCase = requireCase('cross-interest-isolation');

    expect(evaluatePreferenceLearningCase(evaluationCase).metrics).toEqual({
      feedbackCount: 2,
      activeFeedbackCount: 2,
      scopeCount: 2,
      directionCount: 2,
      positiveDirectionCount: 1,
      negativeDirectionCount: 1,
      modelCallCount: 1,
    });
  });

  it('rejects a Direction that crosses Interest scope or cites withdrawn Feedback', () => {
    const source = requireCase('cross-interest-isolation');
    const invalid: PreferenceLearningEvaluationCase = {
      ...source,
      observation: {
        ...source.observation,
        scopes: [{
          scopeKey: 'interest:interest:agents', revision: 1,
          directions: [{
            directionId: 'direction:invalid', polarity: 'positive', statement: 'Invalid cross-scope result.',
            supportingFeedbackIds: ['feedback:typescript'],
          }],
        }],
      },
    };

    const result = evaluatePreferenceLearningCase(invalid);

    expect(result.passed).toBe(false);
    expect(result.issues.map(({ code }) => code)).toEqual(expect.arrayContaining([
      'unexpected_preference_state',
      'cross_scope_feedback',
    ]));
  });
});

function requireCase(caseId: string): PreferenceLearningEvaluationCase {
  const evaluationCase = PREFERENCE_LEARNING_FIXED_CASES.find((item) => item.caseId === caseId);
  if (!evaluationCase) throw new Error(`Missing fixed Preference Learning Case: ${caseId}`);
  return evaluationCase;
}
