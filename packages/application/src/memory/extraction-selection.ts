/* Selects source identities before a transactional claim rechecks durable eligibility. */
import type { MemorySourceInfo } from './source-contracts';
import type { MemoryConfiguration } from './extraction-contracts';

export function selectExtractionSources(input: {
  readonly sources: readonly MemorySourceInfo[];
  readonly configuration: MemoryConfiguration;
  readonly now: number;
  readonly triggerSessionId?: string;
}): readonly MemorySourceInfo[] {
  return [...input.sources].sort((a, b) => b.contentUpdatedAt.localeCompare(a.contentUpdatedAt)
    || b.sessionId.localeCompare(a.sessionId)).slice(0, 5000).filter(source => {
    const age = input.now - Date.parse(source.contentUpdatedAt);
    return (source.kind ?? 'conversation') === 'conversation' && !source.running
      && source.sessionId !== input.triggerSessionId
      && age >= input.configuration.minSourceIdleHours * 3600000
      && age <= input.configuration.maxSourceAgeDays * 86400000;
  });
}
