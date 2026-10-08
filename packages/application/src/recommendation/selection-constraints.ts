/*
 * Enforces frozen selection identity, publisher limits and feasible interest coverage.
 */
import type { CandidateSelectionInput } from './candidates/candidate-qualification-storage';
import type { SelectionItem } from './curated-contracts';

/** Rejects a complete model comparison; it never rewrites its choices into a different result. */
export function validateSelectionConstraints(
  items: readonly SelectionItem[],
  inputs: readonly CandidateSelectionInput[],
  options: {
    targetCount: number;
    maxItemsPerPublisher: number;
    interestPriority: readonly string[];
  },
) {
  const byId = new Map(inputs.map(candidate => [candidate.contentId, candidate]));
  if (
    items.length > options.targetCount ||
    new Set(items.map(item => item.contentId)).size !== items.length
  )
    throw new Error('The final list exceeds its target or repeats content.');

  for (const item of items)
    if (!byId.has(item.contentId))
      throw new Error('The selected content is outside the frozen shortlist.');

  // Both a Web author's identity and its domain are independent constraints.
  const fits = (list: readonly SelectionItem[]) => {
    const publishers = new Map<string, number>();
    for (const item of list)
      for (const key of byId.get(item.contentId)!.publisherKeys) {
        const count = (publishers.get(key) ?? 0) + 1;
        if (count > options.maxItemsPerPublisher) return false;

        publishers.set(key, count);
      }

    return true;
  };
  if (!fits(items)) throw new Error('The final list exceeds a publisher limit.');
  if (!items.length) return;

  const priority = options.interestPriority
    .filter(id =>
      inputs.some(candidate => candidate.qualifications.some(pair => pair.interestId === id)),
    )
    .slice(0, options.targetCount);
  for (const [position, interestId] of priority.entries()) {
    if (items.some(item => item.matchedInterestIds.includes(interestId))) continue;

    const alternatives = inputs.filter(
      candidate =>
        !items.some(item => item.contentId === candidate.contentId) &&
        candidate.qualifications.some(pair => pair.interestId === interestId),
    );
    for (const alternative of alternatives) {
      const added = {
        contentId: alternative.contentId,
        reason: 'Coverage feasibility',
        evidence: [],
        matchedInterestIds: alternative.qualifications.map(pair => pair.interestId),
      };
      const replacements =
        items.length < options.targetCount
          ? [[...items, added]]
          : items.map((_, index) => items.map((item, other) => (index === other ? added : item)));
      if (
        replacements.some(
          list =>
            fits(list) &&
            priority
              .slice(0, position)
              .every(id => list.some(item => item.matchedInterestIds.includes(id))),
        )
      )
        throw new Error(`Cover interest ${interestId} before allocating extra slots.`);
    }
  }
}
