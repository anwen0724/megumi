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
import type { Observability, OperationCompletion } from '@megumi/observability';

export interface SourceRegistry {
  /** Lists validated descriptors in registration order. */
  listDescriptors(): readonly SourceDescriptor[];
  /** Lists descriptors with their current availability snapshots. */
  listSources(): readonly { readonly descriptor: SourceDescriptor; readonly availability: SourceAvailability }[];
  /** Returns a registered Source without imposing a search mode. */
  get(sourceId: DiscoverySourceId): DiscoverySource | undefined;
  /** Rechecks selected Sources and returns their latest availability snapshots. */
  checkSources(sourceIds: readonly DiscoverySourceId[], observability?: Observability): Promise<readonly {
    readonly descriptor: SourceDescriptor;
    readonly availability: SourceAvailability;
  }[]>;
  /** Resolves a registered Source and validates support for the requested mode. */
  resolve(sourceId: DiscoverySourceId, mode: SourceSearchMode): DiscoverySource;
}

/** Creates the validated registry used to resolve all configured Discovery Sources. */
export function createSourceRegistry(
  sources: readonly DiscoverySource[],
  options: {
    readonly observability?: Observability;
    readonly onCheckError?: (error: unknown, sourceId: string) => void;
  } = {},
): SourceRegistry {
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
    async checkSources(sourceIds, observability) {
      const selected = new Set(sourceIds.map((sourceId) => sourceId.trim()));
      const targets = [...entries.values()].filter((entry) => selected.has(entry.descriptor.id));
      await Promise.all(targets.map(async (entry) => {
        try {
          await observeAvailability(observability ?? options.observability, entry.descriptor.id, async () => {
            await entry.source.checkAvailability?.();
            return entry.source.getAvailability();
          });
        } catch (error) {
          reportCheckError(options.onCheckError, error, entry.descriptor.id);
        }
      }));
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

/** Reports one Adapter failure without allowing it to cancel independent Source checks. */
function reportCheckError(
  reporter: ((error: unknown, sourceId: string) => void) | undefined,
  error: unknown,
  sourceId: string,
): void {
  try {
    reporter?.(error, sourceId);
  } catch {
    // A diagnostic callback cannot change Source availability or refresh completion.
  }
}

async function observeAvailability(
  observability: Observability | undefined,
  sourceId: string,
  operation: () => Promise<SourceAvailability>,
): Promise<SourceAvailability> {
  let operationPromise: Promise<SourceAvailability> | undefined;
  const runOnce = () => {
    operationPromise ??= operation();
    return operationPromise;
  };
  if (!observability) return runOnce();
  try {
    return await observability.withSpan({
      name: 'source.availability.check',
      correlation: { sourceId },
      classifyResult: classifyAvailability,
    }, runOnce);
  } catch {
    return runOnce();
  }
}

function classifyAvailability(availability: SourceAvailability): OperationCompletion {
  if (availability.state === 'ready') return { outcome: { status: 'ok', code: 'ready' } };
  return {
    outcome: {
      status: 'error',
      code: availability.state,
      message: `Source availability is ${availability.state}.`,
      retryable: availability.state !== 'not_configured',
    },
  };
}
