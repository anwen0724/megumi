/* Verifies Discovery businesses extend the existing closed Trace contract. */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { TraceKindSchema } from '@megumi/observability';

describe('Trace contract', () => {
  it('accepts closed Discovery Trace kinds without opening arbitrary values', () => {
    expect(TraceKindSchema.parse('candidate_supply')).toBe('candidate_supply');
    expect(TraceKindSchema.parse('preference_learning')).toBe('preference_learning');
    expect(TraceKindSchema.safeParse('candidate_supply_custom').success).toBe(false);
  });
});
