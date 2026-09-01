/* Builds the fixed Discovery Source boundary used by Controlled Evaluation. */
import { createOpenWebSource, createSourceRegistry, type SourceRegistry } from '@megumi/discovery';
import type { WebFetch, WebSearch } from '@megumi/tools';
import type { EvaluationFixture } from '../../fixtures/fixture';

export function createControlledDiscoverySourceRegistry(input: {
  readonly fixture: EvaluationFixture;
  readonly webSearch: WebSearch;
  readonly webFetch: WebFetch;
}): SourceRegistry {
  const requestedSourceIds = new Set(input.fixture.controlledSearch.map((entry) => entry.sourceId));
  if ([...requestedSourceIds].some((sourceId) => sourceId !== 'open_web')) {
    throw new Error('Controlled Evaluation currently supports only the open_web Discovery Source.');
  }
  return createSourceRegistry([
    createOpenWebSource({ webSearch: input.webSearch, webFetch: input.webFetch }),
  ]);
}

export function describeControlledDiscoverySources(fixture: EvaluationFixture): readonly {
  readonly sourceId: string;
  readonly resultSetCount: number;
}[] {
  return [...new Set(fixture.controlledSearch.map((entry) => entry.sourceId))]
    .sort()
    .map((sourceId) => ({
      sourceId,
      resultSetCount: fixture.controlledSearch.filter((entry) => entry.sourceId === sourceId).length,
    }));
}
