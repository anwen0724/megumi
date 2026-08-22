/* Verifies execution-scoped candidate identity, lookup and disposal. */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  createCandidateRegistry,
  type SourceContent,
} from '@megumi/discovery-agent';

describe('CandidateRegistry', () => {
  it('deduplicates source identities before canonical URLs and keeps IDs stable in one execution', () => {
    const registry = createCandidateRegistry();

    const inserted = registry.add([
      content({ sourceId: 'bilibili', sourceContentId: 'BV1ABC', canonicalUrl: 'https://bilibili.com/video/BV1ABC' }),
      content({ sourceId: 'bilibili', sourceContentId: 'BV1ABC', canonicalUrl: 'https://www.bilibili.com/video/BV1ABC?from=search' }),
      content({ sourceId: 'other', sourceContentId: 'BV1ABC', canonicalUrl: 'https://example.com/item' }),
    ]);

    expect(inserted.map((item) => item.candidateId)).toEqual(['candidate:1', 'candidate:2']);
    expect(registry.list()).toHaveLength(2);
    expect(registry.get('candidate:1')?.sourceId).toBe('bilibili');
  });

  it('deduplicates normalized canonical URLs when a source has no native content ID', () => {
    const registry = createCandidateRegistry();

    const inserted = registry.add([
      content({ canonicalUrl: 'https://EXAMPLE.com:443/article?a=1&b=2#section' }),
      content({ canonicalUrl: 'https://example.com/article?b=2&a=1' }),
    ]);

    expect(inserted).toHaveLength(1);
  });

  it('drops the whole candidate set when its execution ends', () => {
    const registry = createCandidateRegistry();
    registry.add([content({ canonicalUrl: 'https://example.com/one' })]);

    registry.dispose();

    expect(() => registry.list()).toThrow(/disposed/i);
    expect(() => registry.add([content({ canonicalUrl: 'https://example.com/two' })])).toThrow(/disposed/i);
  });
});

function content(overrides: Partial<SourceContent>): SourceContent {
  return {
    sourceId: 'open_web',
    sourceName: 'example.com',
    canonicalUrl: 'https://example.com/default',
    contentType: 'page',
    title: 'Example',
    ...overrides,
  };
}
