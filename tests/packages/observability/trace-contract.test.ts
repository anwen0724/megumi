/* Verifies Discovery businesses extend the existing closed Trace contract. */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { TraceCorrelationSchema, TraceKindSchema } from '@megumi/observability';

describe('Trace contract', () => {
  it('accepts closed Discovery Trace kinds without opening arbitrary values', () => {
    expect(TraceKindSchema.parse('candidate_supply')).toBe('candidate_supply');
    expect(TraceKindSchema.parse('recommendation')).toBe('recommendation');
    expect(TraceKindSchema.parse('preference_learning')).toBe('preference_learning');
    expect(TraceKindSchema.safeParse('candidate_supply_custom').success).toBe(false);
  });

  it('accepts explicit business correlation identities', () => {
    expect(TraceCorrelationSchema.parse({
      requestId: 'recommendation-request:1',
      preferenceLearningBatchId: 'preference-batch:1',
    })).toEqual({
      requestId: 'recommendation-request:1',
      preferenceLearningBatchId: 'preference-batch:1',
    });
  });
});
