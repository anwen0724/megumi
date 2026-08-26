/*
 * Owns Discovery Source registration and validates source and mode resolution.
 */
import {
  SourceDescriptorSchema,
  type DiscoverySource,
  type DiscoverySourceId,
  type SourceAvailability,
  type SourceDescriptor,
  type SourceSearchMode,
} from './discovery-source';

export interface SourceRegistry {
  /** Lists validated descriptors in registration order. */
  listDescriptors(): readonly SourceDescriptor[];
  /** Lists descriptors with their current availability snapshots. */
  listSources(): readonly { readonly descriptor: SourceDescriptor; readonly availability: SourceAvailability }[];
  /** Returns a registered Source without imposing a search mode. */
  get(sourceId: DiscoverySourceId): DiscoverySource | undefined;
  /** Rechecks selected Sources and returns their latest availability snapshots. */
  checkSources(sourceIds: readonly DiscoverySourceId[]): Promise<readonly {
    readonly descriptor: SourceDescriptor;
    readonly availability: SourceAvailability;
  }[]>;
  /** Resolves a registered Source and validates support for the requested mode. */
  resolve(sourceId: DiscoverySourceId, mode: SourceSearchMode): DiscoverySource;
}

/** Creates the validated registry used to resolve all configured Discovery Sources. */
export function createSourceRegistry(sources: readonly DiscoverySource[]): SourceRegistry {
  const entries = new Map<DiscoverySourceId, { source: DiscoverySource; descriptor: SourceDescriptor }>();
  for (const source of sources) {
    const sourceId = source.descriptor.id.trim();
    if (!sourceId) throw new Error('Source id must not be empty.');
    const parsed = SourceDescriptorSchema.safeParse({ ...source.descriptor, id: sourceId });
    if (!parsed.success) throw new Error(`Invalid source descriptor for source id ${sourceId}.`);
    if (entries.has(sourceId)) throw new Error(`Duplicate source id: ${sourceId}.`);
    entries.set(sourceId, { source, descriptor: parsed.data });
  }

  return {
    listDescriptors: () => [...entries.values()].map((entry) => entry.descriptor),
    listSources: () => [...entries.values()].map((entry) => ({
      descriptor: entry.descriptor,
      availability: entry.source.getAvailability(),
    })),
    get: (sourceId) => entries.get(sourceId.trim())?.source,
    async checkSources(sourceIds) {
      const selected = new Set(sourceIds.map((sourceId) => sourceId.trim()));
      const targets = [...entries.values()].filter((entry) => selected.has(entry.descriptor.id));
      await Promise.all(targets.map((entry) => entry.source.checkAvailability?.()));
      return targets.map((entry) => ({
        descriptor: entry.descriptor,
        availability: entry.source.getAvailability(),
      }));
    },
    resolve(sourceId, mode) {
      const entry = entries.get(sourceId.trim());
      if (!entry) throw new Error(`Unknown source: ${sourceId}.`);
      if (!entry.descriptor.supportedModes.includes(mode)) {
        throw new Error(`Source ${sourceId} does not support search mode ${mode}.`);
      }
      return entry.source;
    },
  };
}
