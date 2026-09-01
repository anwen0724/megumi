/* Selects the concrete Task Runner while keeping orchestration independent of business details. */
import type { EvaluationTask } from '../contracts/evaluation-task';
import type { TaskRunner } from '../runtime/evidence-collector';
import { candidateSupplyTaskRunner } from './candidate-supply-task-runner';
import { conversationTaskRunner } from './conversation-task-runner';
import { dailyRecommendationTaskRunner } from './daily-recommendation-task-runner';
import { interestUnderstandingTaskRunner } from './interest-understanding-task-runner';
import { preferenceLearningTaskRunner } from './preference-learning-task-runner';

const taskRunners: Readonly<Record<EvaluationTask['runner'], TaskRunner>> = {
  conversation: conversationTaskRunner as TaskRunner,
  interest_understanding: interestUnderstandingTaskRunner as TaskRunner,
  candidate_supply: candidateSupplyTaskRunner as TaskRunner,
  daily_recommendation: dailyRecommendationTaskRunner as TaskRunner,
  preference_learning: preferenceLearningTaskRunner as TaskRunner,
};

export function resolveTaskRunner(task: EvaluationTask): TaskRunner {
  return taskRunners[task.runner];
}
