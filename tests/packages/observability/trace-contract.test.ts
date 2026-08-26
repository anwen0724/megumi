/* Verifies Candidate Supply extends the existing closed Trace contract. */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { TraceKindSchema } from '@megumi/observability';

describe('Trace contract', () => {
  it('accepts Candidate Supply without opening an arbitrary Trace kind', () => {
    expect(TraceKindSchema.parse('candidate_supply')).toBe('candidate_supply');
    expect(TraceKindSchema.safeParse('candidate_supply_custom').success).toBe(false);
  });
});
