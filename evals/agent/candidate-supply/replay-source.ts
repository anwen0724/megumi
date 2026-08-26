/* Provides strict, in-order Source replay for deterministic Candidate Supply Evaluation cases. */
import type {
  DiscoverySource,
  SourceAvailability,
  SourceContentDetail,
  SourceDescriptor,
  SourceFailure,
  SourceSearchMode,
} from '@megumi/discovery';

type SearchResult =
  | { readonly status: 'success'; readonly items: readonly import('@megumi/discovery').SourceContent[] }
  | { readonly status: 'failed'; readonly failure: SourceFailure };
type ReadResult =
  | { readonly status: 'success'; readonly detail: SourceContentDetail }
  | { readonly status: 'failed'; readonly failure: SourceFailure };

export interface ReplaySearchStep {
  readonly request: { readonly query: string; readonly mode: SourceSearchMode; readonly limit: number };
  readonly result: SearchResult;
  readonly providerResponse?: unknown;
}

export interface ReplayReadStep {
  readonly request: { readonly sourceContentId?: string; readonly url: string };
  readonly result: ReadResult;
  readonly providerResponse?: unknown;
}

export type ReplaySourceCall =
  | { readonly operation: 'search'; readonly query: string; readonly mode: SourceSearchMode; readonly limit: number }
  | { readonly operation: 'read'; readonly sourceContentId?: string; readonly url: string };

export interface ReplayDiscoverySource {
  readonly source: DiscoverySource;
  calls(): readonly ReplaySourceCall[];
  assertExhausted(): void;
}

export function createReplayDiscoverySource(input: {
  readonly descriptor: SourceDescriptor;
  readonly availability?: SourceAvailability;
  readonly searches?: readonly ReplaySearchStep[];
  readonly reads?: readonly ReplayReadStep[];
}): ReplayDiscoverySource {
  const searches = [...(input.searches ?? [])];
  const reads = [...(input.reads ?? [])];
  const calls: ReplaySourceCall[] = [];
  const source: DiscoverySource = {
    descriptor: input.descriptor,
    getAvailability: () => input.availability ?? { state: 'ready' },
    async search(request) {
      const step = searches.shift();
      if (!step) throw new Error(`No replay search remains for Source ${input.descriptor.id}.`);
      assertSearchRequest(step, request);
      calls.push({
        operation: 'search', query: request.query, mode: request.mode, limit: request.limit,
      });
      if (step.providerResponse !== undefined) request.onProviderResponse?.(step.providerResponse);
      return copySearchResult(step.result);
    },
    ...(input.descriptor.supportsRead ? {
      async read(request) {
        const step = reads.shift();
        if (!step) throw new Error(`No replay read remains for Source ${input.descriptor.id}.`);
        if (step.request.sourceContentId !== request.sourceContentId || step.request.url !== request.url) {
          throw new Error(`Replay read request did not match Source ${input.descriptor.id}.`);
        }
        calls.push({
          operation: 'read',
          ...(request.sourceContentId ? { sourceContentId: request.sourceContentId } : {}),
          url: request.url,
        });
        if (step.providerResponse !== undefined) request.onProviderResponse?.(step.providerResponse);
        return copyReadResult(step.result);
      },
    } : {}),
  };
  return {
    source,
    calls: () => calls.map((call) => ({ ...call })),
    assertExhausted() {
      if (searches.length > 0 || reads.length > 0) {
        throw new Error(`Replay Source ${input.descriptor.id} has unconsumed interactions.`);
      }
    },
  };
}

function assertSearchRequest(
  step: ReplaySearchStep,
  request: Parameters<DiscoverySource['search']>[0],
): void {
  if (step.request.query !== request.query
    || step.request.mode !== request.mode
    || step.request.limit !== request.limit) {
    throw new Error(`Replay search request did not match: ${request.query}.`);
  }
}

function copySearchResult(result: SearchResult): SearchResult {
  return result.status === 'success'
    ? { status: 'success', items: result.items.map((item) => ({ ...item })) }
    : { status: 'failed', failure: { ...result.failure } };
}

function copyReadResult(result: ReadResult): ReadResult {
  return result.status === 'success'
    ? { status: 'success', detail: { ...result.detail } }
    : { status: 'failed', failure: { ...result.failure } };
}
