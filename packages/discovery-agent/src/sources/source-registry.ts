/* Owns discovery-source registration and validates source/mode resolution. */
import {
  SourceDescriptorSchema,
  type DiscoverySource,
  type DiscoverySourceId,
  type SourceDescriptor,
  type SourceSearchMode,
} from './discovery-source';

export interface SourceRegistry {
  listDescriptors(): readonly SourceDescriptor[];
  get(sourceId: DiscoverySourceId): DiscoverySource | undefined;
  resolve(sourceId: DiscoverySourceId, mode: SourceSearchMode): DiscoverySource;
}

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
    get: (sourceId) => entries.get(sourceId.trim())?.source,
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
