/*
 * Evaluates fixed Feedback-to-Preference outcomes from explicit batch, scope,
 * direction, and evidence facts without using Trace data as business state.
 */

export interface PreferenceLearningEvaluationFeedback {
  readonly feedbackId: string;
  readonly currentReaction: 'liked' | 'disliked' | null;
  readonly matchedInterestIds: readonly string[];
}

export interface PreferenceLearningEvaluationDirection {
  readonly directionId: string;
  readonly polarity: 'positive' | 'negative';
  readonly statement: string;
  readonly supportingFeedbackIds: readonly string[];
}

export interface PreferenceLearningEvaluationScope {
  readonly scopeKey: string;
  readonly revision: number;
  readonly directions: readonly PreferenceLearningEvaluationDirection[];
}

export interface PreferenceLearningEvaluationCase {
  readonly caseId: string;
  readonly description: string;
  readonly feedback: readonly PreferenceLearningEvaluationFeedback[];
  readonly observation: {
    readonly batchStatus: 'completed' | 'failed';
    readonly modelCallCount: number;
    readonly scopes: readonly PreferenceLearningEvaluationScope[];
  };
  readonly expected: {
    readonly scopes: readonly PreferenceLearningEvaluationScope[];
  };
}

export interface PreferenceLearningEvaluationResult {
  readonly passed: boolean;
  readonly issues: readonly { readonly code: string; readonly message: string }[];
  readonly metrics: {
    readonly feedbackCount: number;
    readonly activeFeedbackCount: number;
    readonly scopeCount: number;
    readonly directionCount: number;
    readonly positiveDirectionCount: number;
    readonly negativeDirectionCount: number;
    readonly modelCallCount: number;
  };
}

/** Verifies one replayed learning outcome against exact revision and Evidence expectations. */
export function evaluatePreferenceLearningCase(
  evaluationCase: PreferenceLearningEvaluationCase,
): PreferenceLearningEvaluationResult {
  const issues: Array<{ code: string; message: string }> = [];
  const activeFeedback = new Map(evaluationCase.feedback.flatMap((feedback) => (
    feedback.currentReaction ? [[feedback.feedbackId, feedback] as const] : []
  )));

  if (evaluationCase.observation.batchStatus !== 'completed') {
    addIssue(issues, 'batch_not_completed', 'The Preference Learning batch did not complete.');
  }
  if (evaluationCase.observation.modelCallCount !== 1) {
    addIssue(issues, 'unexpected_model_call_count', 'Preference Learning must use one ordinary model Completion.');
  }
  if (JSON.stringify(evaluationCase.observation.scopes) !== JSON.stringify(evaluationCase.expected.scopes)) {
    addIssue(issues, 'unexpected_preference_state', 'Persisted Preference scopes differ from the expected exact state.');
  }

  for (const scope of evaluationCase.observation.scopes) {
    if (!Number.isInteger(scope.revision) || scope.revision < 1) {
      addIssue(issues, 'invalid_scope_revision', `Scope ${scope.scopeKey} has an invalid revision.`);
    }
    const directionIds = new Set<string>();
    for (const direction of scope.directions) {
      if (directionIds.has(direction.directionId)) {
        addIssue(issues, 'duplicate_direction', `Direction ${direction.directionId} is duplicated.`);
      }
      directionIds.add(direction.directionId);
      if (!direction.statement.trim()) {
        addIssue(issues, 'empty_direction_statement', `Direction ${direction.directionId} is not explainable.`);
      }
      for (const feedbackId of direction.supportingFeedbackIds) {
        const feedback = activeFeedback.get(feedbackId);
        if (!feedback) {
          addIssue(issues, 'invalid_feedback_reference', `Direction ${direction.directionId} references inactive Feedback.`);
          continue;
        }
        if (!scopeAllowsFeedback(scope.scopeKey, feedback.matchedInterestIds)) {
          addIssue(issues, 'cross_scope_feedback', `Direction ${direction.directionId} crosses its allowed scope.`);
        }
      }
    }
  }

  const directions = evaluationCase.observation.scopes.flatMap(({ directions: items }) => items);
  return {
    passed: issues.length === 0,
    issues,
    metrics: {
      feedbackCount: evaluationCase.feedback.length,
      activeFeedbackCount: activeFeedback.size,
      scopeCount: evaluationCase.observation.scopes.length,
      directionCount: directions.length,
      positiveDirectionCount: directions.filter(({ polarity }) => polarity === 'positive').length,
      negativeDirectionCount: directions.filter(({ polarity }) => polarity === 'negative').length,
      modelCallCount: evaluationCase.observation.modelCallCount,
    },
  };
}

function scopeAllowsFeedback(scopeKey: string, matchedInterestIds: readonly string[]): boolean {
  if (scopeKey === 'exploration') return matchedInterestIds.length === 0;
  if (!scopeKey.startsWith('interest:')) return false;
  return matchedInterestIds.includes(scopeKey.slice('interest:'.length));
}

function addIssue(
  issues: Array<{ code: string; message: string }>,
  code: string,
  message: string,
): void {
  issues.push({ code, message });
}
