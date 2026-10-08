/* Aggregates explicit human judgments against the frozen fixture labels. */
import type { EffectFixture } from './effect-fixtures';

export interface EffectReview {
  id: string;
  facts?: {
    id: string;
    review: {
      recalled: boolean | null;
      used: boolean | null;
      correctAndApplicable: boolean | null;
      evidenceLocation: string;
    };
  }[];
  forbidden?: { usedAsCurrentFact?: boolean | null }[];
  additionalUsedKnowledge?: {
    description: string;
    correctAndApplicable: boolean | null;
    evidenceLocation: string;
  }[];
  additionalKnowledgeReviewed?: boolean | null;
  humanReview?: {
    taskSucceeded: boolean | null;
    constraintsRespected: boolean | null;
    wrongFactUses: number | null;
    repeatedFailedSteps: number | null;
    repeatedQuestions: number | null;
    irrelevantReads: number | null;
    crossProjectMisuses: number | null;
    notes: string;
  };
}

const countFields = [
  'wrongFactUses',
  'repeatedFailedSteps',
  'repeatedQuestions',
  'irrelevantReads',
  'crossProjectMisuses',
] as const;
const ratio = (numerator: number, denominator: number, unresolved: number) => ({
  numerator,
  denominator,
  unresolved,
  rate: denominator > 0 && unresolved === 0 ? numerator / denominator : null,
});

/** Unknown judgments remain unknown, and a missing trial stays in the planned denominator. */
export function summarizeHumanReview(
  manifest: {
    fixtures: readonly EffectFixture[];
    conditions: readonly string[];
    repeats: number;
  },
  review: readonly EffectReview[],
) {
  const byId = new Map(review.map(item => [item.id, item]));
  if (byId.size !== review.length)
    throw new Error('Human review contains duplicate trial identities.');

  const plannedIds = new Set(
    manifest.fixtures.flatMap(fixture =>
      manifest.conditions.flatMap(condition =>
        Array.from(
          { length: manifest.repeats },
          (_, index) => `${fixture.id}/${condition}/${index + 1}`,
        ),
      ),
    ),
  );
  for (const id of byId.keys())
    if (!plannedIds.has(id))
      throw new Error(`Review identity is outside the frozen experiment: ${id}`);

  const byCondition: Record<string, unknown> = {};
  const repeatableFixtures: string[] = [];
  for (const condition of manifest.conditions) {
    const plannedTasks = manifest.fixtures.length * manifest.repeats;
    let tasksSucceeded = 0;
    let taskUnknown = 0;
    let constraintsRespected = 0;
    let constraintUnknown = 0;
    let requiredKnowledge = 0;
    let recalled = 0;
    let recallUnknown = 0;
    let noRequiredKnowledgeTasks = 0;
    let used = 0;
    let correctlyUsed = 0;
    let useUnknown = 0;
    let additionalUnknown = 0;
    let noMemoryUsedTasks = 0;
    let forbiddenUsed = 0;
    let forbiddenUnknown = 0;
    const counts = Object.fromEntries(
      countFields.map(field => [
        field,
        {
          total: 0,
          reviewedTasks: 0,
          unresolvedTasks: 0,
        },
      ]),
    );
    const incomplete: string[] = [];
    for (const fixture of manifest.fixtures) {
      let effectiveRepeats = 0;
      for (let repeat = 1; repeat <= manifest.repeats; repeat++) {
        const id = `${fixture.id}/${condition}/${repeat}`;
        const current = byId.get(id);
        const task = current?.humanReview;
        let complete = true;
        if (task?.taskSucceeded === true) tasksSucceeded++;
        else if (task?.taskSucceeded !== false) {
          taskUnknown++;
          complete = false;
        }
        if (task?.constraintsRespected === true) constraintsRespected++;
        else if (task?.constraintsRespected !== false) {
          constraintUnknown++;
          complete = false;
        }
        for (const field of countFields) {
          const value = task?.[field];
          if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
            counts[field].total += value;
            counts[field].reviewedTasks++;
          } else {
            counts[field].unresolvedTasks++;
            complete = false;
          }
        }

        const knowledge = fixture.facts.filter(fact => fact.memoryRequired !== false);
        if (!knowledge.length) noRequiredKnowledgeTasks++;

        let currentUsed = 0;
        let currentCorrect = 0;
        let currentRecalled = 0;
        let currentUnknown = 0;
        for (const fact of knowledge) {
          requiredKnowledge++;
          const judgment = current?.facts?.find(item => item.id === fact.id)?.review;
          if (judgment?.recalled === true) {
            recalled++;
            currentRecalled++;
          } else if (judgment?.recalled !== false) {
            recallUnknown++;
            complete = false;
          }
          if (judgment?.used === true) {
            used++;
            currentUsed++;
            if (judgment.correctAndApplicable === true) {
              correctlyUsed++;
              currentCorrect++;
            } else if (judgment.correctAndApplicable !== false) {
              useUnknown++;
              currentUnknown++;
              complete = false;
            }
          } else if (judgment?.used !== false) {
            useUnknown++;
            currentUnknown++;
            complete = false;
          }
          if ((judgment?.recalled || judgment?.used) && !judgment.evidenceLocation.trim()) {
            complete = false;
          }
        }

        for (const item of current?.additionalUsedKnowledge ?? []) {
          used++;
          currentUsed++;
          if (item.correctAndApplicable === true) {
            correctlyUsed++;
            currentCorrect++;
          } else if (item.correctAndApplicable !== false) {
            useUnknown++;
            currentUnknown++;
            complete = false;
          }
          if (!item.evidenceLocation.trim()) complete = false;
        }

        if (current?.additionalKnowledgeReviewed !== true) {
          additionalUnknown++;
          complete = false;
        }
        if (
          currentUsed === 0 &&
          currentUnknown === 0 &&
          current?.additionalKnowledgeReviewed === true
        )
          noMemoryUsedTasks++;

        for (const [index] of fixture.forbidden.entries()) {
          const value = current?.forbidden?.[index]?.usedAsCurrentFact;
          if (value === true) forbiddenUsed++;
          else if (value !== false) {
            forbiddenUnknown++;
            complete = false;
          }
        }

        if (!complete) incomplete.push(id);
        if (
          complete &&
          task?.taskSucceeded &&
          task.constraintsRespected &&
          currentRecalled > 0 &&
          currentUsed > 0 &&
          currentUsed === currentCorrect &&
          task.wrongFactUses === 0 &&
          task.crossProjectMisuses === 0 &&
          current?.forbidden?.every(item => item.usedAsCurrentFact !== true) !== false
        )
          effectiveRepeats++;
      }

      if (condition === 'memory' && manifest.repeats >= 2 && effectiveRepeats === manifest.repeats)
        repeatableFixtures.push(fixture.id);
    }

    byCondition[condition] = {
      plannedTasks,
      taskSuccess: ratio(tasksSucceeded, plannedTasks, taskUnknown),
      constraintCompliance: ratio(constraintsRespected, plannedTasks, constraintUnknown),
      knowledgeRecall: {
        ...ratio(recalled, requiredKnowledge, recallUnknown),
        excludedNoRequiredKnowledgeTasks: noRequiredKnowledgeTasks,
      },
      useAccuracy: {
        ...ratio(correctlyUsed, used, useUnknown + additionalUnknown),
        excludedNoMemoryUsedTasks: noMemoryUsedTasks,
      },
      forbiddenUsedAsCurrent: {
        count: forbiddenUsed,
        unresolved: forbiddenUnknown,
      },
      counts,
      reviewComplete: incomplete.length === 0,
      incomplete,
    };
  }

  const categories = [...new Set(manifest.fixtures.map(fixture => fixture.category))].map(
    category => ({
      category,
      repeatableFixtures: manifest.fixtures
        .filter(fixture => fixture.category === category && repeatableFixtures.includes(fixture.id))
        .map(fixture => fixture.id),
    }),
  );

  return {
    byCondition,
    repeatableReuseByCategory: categories,
    allCategoriesShowRepeatableReuse: categories.every(
      category => category.repeatableFixtures.length > 0,
    ),
    interpretation:
      'Null rates mean unreviewed judgments or an empty denominator. Planned failed/missing tasks are not removed. Recall counts only frozen facts with memoryRequired !== false. Use accuracy includes all used memory knowledge, including reviewer-added wrong or unsupported claims.',
  };
}
