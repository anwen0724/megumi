/* Verifies extensible source registration and mode validation. */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  createSourceRegistry,
  type DiscoverySource,
  type SourceSearchMode,
} from '@megumi/discovery';

function source(id: string, modes: readonly SourceSearchMode[] = ['relevance']): DiscoverySource {
  return {
    descriptor: {
      id,
      name: `Source ${id}`,
      access: 'public_http',
      supportedModes: [...modes],
      supportsRead: false,
    },
    getAvailability: () => ({ state: 'ready', checkedAt: '2026-08-24T08:00:00.000Z' }),
    async search() { return { status: 'success', items: [] }; },
  };
}

describe('SourceRegistry', () => {
  it('accepts a third adapter without changing any shared contract', () => {
    const registry = createSourceRegistry([
      source('open_web'),
      source('bilibili', ['relevance', 'recent']),
      source('test_source', ['recent']),
    ]);

    expect(registry.listDescriptors().map((entry) => entry.id))
      .toEqual(['open_web', 'bilibili', 'test_source']);
    expect(registry.resolve('test_source', 'recent').descriptor.name).toBe('Source test_source');
    expect(registry.listSources()).toEqual([
      expect.objectContaining({
        descriptor: expect.objectContaining({ id: 'open_web', access: 'public_http', supportsRead: false }),
        availability: { state: 'ready', checkedAt: '2026-08-24T08:00:00.000Z' },
      }),
      expect.objectContaining({ descriptor: expect.objectContaining({ id: 'bilibili' }) }),
      expect.objectContaining({ descriptor: expect.objectContaining({ id: 'test_source' }) }),
    ]);
  });

  it.each([
    { sources: [source('')], message: /source id/i },
    { sources: [source('open_web'), source('open_web')], message: /duplicate source id/i },
  ])('rejects invalid registrations', ({ sources, message }) => {
    expect(() => createSourceRegistry(sources)).toThrow(message);
  });

  it('rejects unknown sources and unsupported search modes before invoking an adapter', () => {
    const registry = createSourceRegistry([source('open_web')]);

    expect(() => registry.resolve('missing', 'relevance')).toThrow(/unknown source/i);
    expect(() => registry.resolve('open_web', 'recent')).toThrow(/does not support.*recent/i);
  });
});
