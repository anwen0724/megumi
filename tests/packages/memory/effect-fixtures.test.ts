/* Offline checks of the fixed experiment and independent answer checker; no provider calls. */
import { expect, it } from 'vitest';
import { effectFixtures, effectConditions } from '../../../scripts/memory/effect-fixtures';
import { checkEffectAnswer } from '../../../scripts/memory/effect-scoring';

it('defines twelve isolated synthetic cases with evidence for every acceptance label', () => {
  const counts = new Map<string, number>();
  for (const fixture of effectFixtures) {
    counts.set(fixture.category, (counts.get(fixture.category) ?? 0) + 1);
    const allowed = new Set(fixture.histories.filter(item => !item.excluded).map(item => item.id));
    for (const fact of fixture.facts) {
      expect(fact.applicability.length).toBeGreaterThan(0);
      expect(fact.evidence.length).toBeGreaterThan(0);
      expect(fact.evidence.every(id => allowed.has(id))).toBe(true);
    }
    if (fixture.category === 'verified-procedure') expect(fixture.histories.some(item => item.tool?.succeeded)).toBe(true);
  }
  expect(counts.size).toBe(6);
  expect([...counts.values()]).toEqual([2, 2, 2, 2, 2, 2]);
  expect(effectFixtures.length * effectConditions.length * 2).toBe(72);
});

it('does not accept a corrected old value and never fills human judgments automatically', () => {
  const fixture = effectFixtures.find(item => item.id === 'correction-api')!;
  const old = checkEffectAnswer(fixture, '{"endpoint":"/api/v1/items","paginationParameter":"page"}');
  expect(old.mechanicalPass).toBe(false);
  expect(old.forbidden.every(item => item.matched)).toBe(true);
  const current = checkEffectAnswer(fixture, '```json\n{"method":"GET","endpoint":"/api/v2/items","paginationParameter":"cursor"}\n```\n<memory_citations>[]</memory_citations>');
  expect(current.mechanicalPass).toBe(true);
  expect(current.humanReview.taskSucceeded).toBeNull();
  expect(current.facts.every(item => item.review.recalled === null)).toBe(true);
});

it('retains unparseable output as a failure instead of guessing values from prose', () => {
  const result = checkEffectAnswer(effectFixtures[0], 'I think this should be zh-CN and ms.');
  expect(result.parseable).toBe(false);
  expect(result.mechanicalPass).toBe(false);
});
