/* Verifies browser-backed platform source normalization and availability mapping. */
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  createDouyinSource,
  createXiaohongshuSource,
  createZhihuSource,
  type BrowserSourceTaskGateway,
} from '@megumi/discovery';

describe('browser platform sources', () => {
  it.each([
    ['xiaohongshu', createXiaohongshuSource, '小红书', 'post'],
    ['douyin', createDouyinSource, '抖音', 'video'],
    ['zhihu', createZhihuSource, '知乎', 'article'],
  ] as const)('normalizes %s results through the common gateway', async (sourceId, createSource, name, contentType) => {
    const execute = vi.fn(async () => ({
      status: 'success' as const,
      items: [{
        sourceContentId: `${sourceId}:1`,
        url: platformUrl(sourceId),
        title: 'Result',
        author: 'Author',
        contentType,
      }],
    }));
    const source = createSource({ gateway: gateway(execute) });

    await expect(source.search({
      query: ' Agent ', mode: 'relevance', limit: 5, signal: new AbortController().signal,
    })).resolves.toEqual({
      status: 'success',
      items: [expect.objectContaining({ sourceId, sourceName: name, title: 'Result', author: 'Author', contentType })],
    });
    expect(execute).toHaveBeenCalledWith(
      { sourceId, operation: 'search', query: 'Agent', mode: 'relevance', limit: 5 },
      { signal: expect.any(AbortSignal) },
    );
  });

  it('maps extension, login, and risk facts into source availability', async () => {
    const results = [
      { status: 'failed' as const, failure: { code: 'login_required' as const, message: 'Login required.' } },
      { status: 'failed' as const, failure: { code: 'risk_control' as const, message: 'Verification required.' } },
    ];
    const source = createZhihuSource({ gateway: gateway(async () => results.shift()!) });
    expect(source.getAvailability()).toEqual({ state: 'unknown' });
    await source.search({ query: 'Agent', mode: 'relevance', limit: 5, signal: new AbortController().signal });
    expect(source.getAvailability()).toMatchObject({ state: 'login_required' });
    await source.search({ query: 'Agent', mode: 'relevance', limit: 5, signal: new AbortController().signal });
    expect(source.getAvailability()).toMatchObject({ state: 'risk_controlled' });
  });
});

function gateway(execute: BrowserSourceTaskGateway['execute']): BrowserSourceTaskGateway {
  return { getConnectionState: () => ({ state: 'ready' }), execute };
}

function platformUrl(sourceId: string): string {
  if (sourceId === 'xiaohongshu') return 'https://www.xiaohongshu.com/explore/abc';
  if (sourceId === 'douyin') return 'https://www.douyin.com/video/123';
  return 'https://www.zhihu.com/question/1/answer/2';
}
