/* Reads legacy sealed facts without rewriting their stored shape or scoring semantics. */
import { z } from 'zod';
import { DiscoveryStateSchema } from '@megumi/discovery';

const EnvelopeSchema = z.object({ facts: z.object({ discovery: z.record(z.unknown()) }) });
const RowsSchema = z.array(z.record(z.unknown()));

/** Adds only v2 legacy field defaults for validation; v3 never receives compatibility defaults. */
export function readDiscoveryRecordState(value: unknown, version: number) {
  const envelope = EnvelopeSchema.safeParse(value);
  if (!envelope.success) return DiscoveryStateSchema.safeParse(undefined);
  const state = { ...envelope.data.facts.discovery };
  if (version === 2) {
    for (const key of ['preferences', 'preferenceSets', 'preferenceEvidence', 'recommendationStates']) {
      const rows = RowsSchema.safeParse(state[key]);
      if (!rows.success) return DiscoveryStateSchema.safeParse(undefined);
      state[key] = rows.data.map((row) => key === 'preferences' ? { origin: 'learned', status: 'active', revision: 1, ...row }
        : key === 'preferenceSets' ? { policyRevision: 0, ...row }
        : key === 'recommendationStates' ? { reactionSequence: 0, ...row }
        : { relation: 'support', updatedAt: row.createdAt, ...row });
    }
  }
  return DiscoveryStateSchema.safeParse(state);
}
