/* Mechanical checks are review aids, not replacements for knowledge-level human acceptance. */
import type { EffectFixture } from './effect-fixtures';

export function checkEffectAnswer(fixture: EffectFixture, reply: string) {
  const answer = reply.replace(/<memory_citations>[\s\S]*?<\/memory_citations>/g, '').trim();
  const match = answer.match(/```(?:json)?\s*([\s\S]*?)```/);
  let parsed: Record<string, unknown> | undefined;
  try { parsed = JSON.parse(match?.[1] ?? answer); } catch { /* Retain prose for human review instead of guessing JSON. */ }
  const facts = fixture.facts.map(fact => {
    const actual = parsed?.[fact.field];
    const expected = fact.expected;
    const matched = Array.isArray(expected)
      ? Array.isArray(actual) && (fact.ordered === false ? JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort()) : JSON.stringify(actual) === JSON.stringify(expected))
      : typeof expected === 'string' && typeof actual === 'string' ? actual.toLowerCase() === expected.toLowerCase() : actual === expected;
    return { ...fact, actual, matched, review: { recalled: null, used: null, correctAndApplicable: null, evidenceLocation: '' } };
  });
  const forbidden = fixture.forbidden.map(rule => ({ ...rule, matched: Array.isArray(parsed?.[rule.field])
    ? (parsed[rule.field] as unknown[]).includes(rule.value) : parsed?.[rule.field] === rule.value }));
  return { parseable: !!parsed, facts, forbidden,
    mechanicalPass: !!parsed && facts.every(fact => fact.matched) && forbidden.every(rule => !rule.matched),
    humanReview: { taskSucceeded: null, constraintsRespected: null, wrongFactUses: null,
      repeatedFailedSteps: null, repeatedQuestions: null, irrelevantReads: null, crossProjectMisuses: null, notes: '' } };
}
