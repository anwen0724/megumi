/* Builds the fixed Discovery Source boundary used by Controlled Evaluation. */
import { createOpenWebSource, createSourceRegistry, type SourceRegistry } from '@megumi/discovery';
import type { WebFetch, WebSearch } from '@megumi/tools';
import type { CaseInitialState } from '../../run/initial-state';

export function createControlledDiscoverySourceRegistry(input: {
  readonly initialState: CaseInitialState;
  readonly webSearch: WebSearch;
  readonly webFetch: WebFetch;
}): SourceRegistry {
  const requestedSourceIds = new Set(input.initialState.controlledSources.map((entry) => entry.sourceId));
  if ([...requestedSourceIds].some((sourceId) => sourceId !== 'open_web')) {
    throw new Error('Controlled Evaluation currently supports only the open_web Discovery Source.');
  }
  return createSourceRegistry([
    createOpenWebSource({ webSearch: input.webSearch, webFetch: input.webFetch }),
  ]);
}

export function describeControlledDiscoverySources(initialState: CaseInitialState): readonly {
  readonly sourceId: string;
  readonly resultSetCount: number;
}[] {
  return [...new Set(initialState.controlledSources.map((entry) => entry.sourceId))]
    .sort()
    .map((sourceId) => ({
      sourceId,
      resultSetCount: initialState.controlledSources.filter((entry) => entry.sourceId === sourceId).length,
    }));
}
