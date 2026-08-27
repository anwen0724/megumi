/* Defines fixed Preference Learning sequences for repeatable cross-feedback evaluation. */
import type { PreferenceLearningEvaluationCase } from './evaluation-metrics';

export const PREFERENCE_LEARNING_FIXED_CASES = [
  {
    caseId: 'three-aligned-feedback',
    description: 'Three aligned likes form one stable positive Direction.',
    feedback: [
      feedback('feedback:1', 'liked', ['interest:agents']),
      feedback('feedback:2', 'liked', ['interest:agents']),
      feedback('feedback:3', 'liked', ['interest:agents']),
    ],
    observation: {
      batchStatus: 'completed', modelCallCount: 1,
      scopes: [scope('interest:interest:agents', 1, [
        direction('direction:runtime', 'positive', ['feedback:1', 'feedback:2', 'feedback:3']),
      ])],
    },
    expected: {
      scopes: [scope('interest:interest:agents', 1, [
        direction('direction:runtime', 'positive', ['feedback:1', 'feedback:2', 'feedback:3']),
      ])],
    },
  },
  {
    caseId: 'cross-interest-isolation',
    description: 'Feedback for two Interests produces separate Preference scopes.',
    feedback: [
      feedback('feedback:agent', 'liked', ['interest:agents']),
      feedback('feedback:typescript', 'disliked', ['interest:typescript']),
    ],
    observation: {
      batchStatus: 'completed', modelCallCount: 1,
      scopes: [
        scope('interest:interest:agents', 1, [direction('direction:agent', 'positive', ['feedback:agent'])]),
        scope('interest:interest:typescript', 1, [
          direction('direction:typescript', 'negative', ['feedback:typescript']),
        ]),
      ],
    },
    expected: {
      scopes: [
        scope('interest:interest:agents', 1, [direction('direction:agent', 'positive', ['feedback:agent'])]),
        scope('interest:interest:typescript', 1, [
          direction('direction:typescript', 'negative', ['feedback:typescript']),
        ]),
      ],
    },
  },
  {
    caseId: 'feedback-switch-correction',
    description: 'Changing a learned reaction creates a correcting Preference revision.',
    feedback: [feedback('feedback:switch', 'disliked', ['interest:agents'])],
    observation: {
      batchStatus: 'completed', modelCallCount: 1,
      scopes: [scope('interest:interest:agents', 2, [
        direction('direction:runtime-negative', 'negative', ['feedback:switch']),
      ])],
    },
    expected: {
      scopes: [scope('interest:interest:agents', 2, [
        direction('direction:runtime-negative', 'negative', ['feedback:switch']),
      ])],
    },
  },
  {
    caseId: 'feedback-withdrawal',
    description: 'Withdrawing the last Evidence removes its Direction in the next revision.',
    feedback: [feedback('feedback:withdrawn', null, ['interest:agents'])],
    observation: {
      batchStatus: 'completed', modelCallCount: 1,
      scopes: [scope('interest:interest:agents', 2, [])],
    },
    expected: { scopes: [scope('interest:interest:agents', 2, [])] },
  },
] as const satisfies readonly PreferenceLearningEvaluationCase[];

function feedback(
  feedbackId: string,
  currentReaction: 'liked' | 'disliked' | null,
  matchedInterestIds: readonly string[],
) {
  return { feedbackId, currentReaction, matchedInterestIds };
}

function scope(
  scopeKey: string,
  revision: number,
  directions: readonly ReturnType<typeof direction>[],
) {
  return { scopeKey, revision, directions };
}

function direction(
  directionId: string,
  polarity: 'positive' | 'negative',
  supportingFeedbackIds: readonly string[],
) {
  return {
    directionId,
    polarity,
    statement: polarity === 'positive' ? 'Prefer concrete runtime analysis.' : 'Reduce shallow runtime summaries.',
    supportingFeedbackIds,
  };
}
