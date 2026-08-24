/* Verifies execution-scoped candidate identity, lookup and disposal. */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  createCandidateRegistry,
  type SourceContent,
} from '@megumi/discovery';

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

  it('merges the same platform content across Open Web and a native source', () => {
    const registry = createCandidateRegistry();

    registry.add([content({
      sourceId: 'open_web',
      sourceName: 'zhihu.com',
      canonicalUrl: 'https://www.zhihu.com/question/123/answer/456?utm_source=search#answer',
      title: 'Web title',
    })]);
    registry.add([content({
      sourceId: 'zhihu',
      sourceName: '知乎',
      sourceContentId: 'answer:456',
      canonicalUrl: 'https://www.zhihu.com/question/123/answer/456',
      contentType: 'article',
      title: 'Native title',
      author: 'Author',
    })]);

    expect(registry.list()).toHaveLength(1);
    expect(registry.list()[0]).toMatchObject({
      candidateId: 'candidate:1',
      sourceId: 'zhihu',
      sourceContentId: 'answer:456',
      title: 'Native title',
      author: 'Author',
    });
  });

  it('removes known tracking parameters without removing content parameters', () => {
    const registry = createCandidateRegistry();
    registry.add([
      content({ canonicalUrl: 'https://example.com/article?id=7&utm_medium=social&spm_id_from=333' }),
      content({ sourceId: 'other', canonicalUrl: 'https://example.com/article?id=7' }),
      content({ sourceId: 'other', canonicalUrl: 'https://example.com/article?id=8' }),
    ]);

    expect(registry.list()).toHaveLength(2);
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
