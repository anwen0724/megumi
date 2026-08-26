/* Verifies browser-session Sources own platform URLs, page interpretation, and content normalization. */
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  createDouyinSource,
  createXiaohongshuSource,
  type EmbeddedBrowser,
  type EmbeddedBrowserSnapshot,
} from '@megumi/discovery';

describe('embedded-browser platform sources', () => {
  it.each([
    {
      sourceId: 'xiaohongshu',
      createSource: createXiaohongshuSource,
      resultUrl: 'https://www.xiaohongshu.com/explore/abc123?xsec_token=secret',
      expectedSearch: 'https://www.xiaohongshu.com/search_result?keyword=Agent+Harness&source=web_explore_feed',
      contentType: 'post',
    },
    {
      sourceId: 'douyin',
      createSource: createDouyinSource,
      resultUrl: 'https://www.douyin.com/video/73001',
      expectedSearch: 'https://www.douyin.com/search/Agent%20Harness?type=general',
      contentType: 'video',
    },
  ] as const)('normalizes $sourceId from a generic document snapshot', async ({ sourceId, createSource, resultUrl, expectedSearch, contentType }) => {
    const snapshot = vi.fn(async () => successSnapshot({
      finalUrl: expectedSearch,
      bodyText: '登录后可以查看更多个性化内容。',
      links: [{
        href: resultUrl,
        text: 'Agent 实战内容',
        contextText: 'Agent 实战内容 作者 Alice 一份深入的工程经验',
        imageUrl: 'https://example.com/cover.jpg',
      }, {
        href: sourceId === 'douyin' ? 'https://passport.douyin.com/login' : 'https://passport.xiaohongshu.com/login',
        text: '登录',
      }],
    }));
    const source = createSource({ browser: browser(snapshot) });

    const result = await source.search({
      query: ' Agent Harness ', mode: 'relevance', limit: 5, signal: new AbortController().signal,
    });

    expect(snapshot).toHaveBeenCalledWith(expect.objectContaining({
      profileId: sourceId,
      url: expectedSearch,
      allowedOrigins: expect.arrayContaining([expect.stringContaining(sourceId === 'douyin' ? 'douyin.com' : 'xiaohongshu.com')]),
      signal: expect.any(AbortSignal),
    }));
    expect(result).toEqual({ status: 'success', items: [expect.objectContaining({
      sourceId, canonicalUrl: resultUrl, title: 'Agent 实战内容', contentType,
      description: 'Agent 实战内容 作者 Alice 一份深入的工程经验',
      coverUrl: 'https://example.com/cover.jpg',
    })] });
    expect(source.getAvailability()).toMatchObject({ state: 'ready' });
    expect(source.descriptor.supportsRead).toBe(true);
  });

  it.each([
    ['https://www.xiaohongshu.com/login', '请登录后继续', 'login_required'],
    ['https://www.xiaohongshu.com/search_result?keyword=Agent', '访问过于频繁，请完成验证', 'risk_control'],
  ] as const)('maps platform pages to $failureCode', async (finalUrl, bodyText, failureCode) => {
    const source = createXiaohongshuSource({ browser: browser(async () => successSnapshot({ finalUrl, bodyText })) });
    const result = await source.search({
      query: 'Agent', mode: 'relevance', limit: 5, signal: new AbortController().signal,
    });
    expect(result).toMatchObject({ status: 'failed', failure: { code: failureCode } });
    expect(source.getAvailability()).toMatchObject({
      state: failureCode === 'login_required' ? 'login_required' : 'risk_controlled',
    });
  });

  it.each([
    [createXiaohongshuSource, 'https://www.xiaohongshu.com/', 'https://passport.xiaohongshu.com/login'],
    [createDouyinSource, 'https://www.douyin.com/', 'https://passport.douyin.com/login'],
  ] as const)('recognizes a structural login link during an explicit availability check', async (createSource, finalUrl, loginUrl) => {
    const source = createSource({ browser: browser(async () => successSnapshot({
      finalUrl,
      links: [{ href: loginUrl, text: '登录' }],
    })) });

    await expect(source.checkAvailability!()).resolves.toMatchObject({ state: 'login_required' });
  });

  it('opens a visible persistent-profile login window only after an explicit connect request', async () => {
    const openLogin = vi.fn(async () => undefined);
    const source = createDouyinSource({ browser: browser(async () => successSnapshot({}), openLogin) });
    await expect(source.connect!()).resolves.toBeUndefined();
    expect(openLogin).toHaveBeenCalledWith(expect.objectContaining({
      profileId: 'douyin', url: 'https://www.douyin.com/',
    }));
  });

  it('uses the same persistent profile to read candidate detail', async () => {
    const snapshot = vi.fn(async () => successSnapshot({
      finalUrl: 'https://www.douyin.com/video/73001',
      title: 'Agent 视频 - 抖音',
      bodyText: '这是视频详情正文。',
    }));
    const source = createDouyinSource({ browser: browser(snapshot) });
    const result = await source.read!({
      sourceContentId: '73001', url: 'https://www.douyin.com/video/73001',
      signal: new AbortController().signal,
    });
    expect(result).toEqual({ status: 'success', detail: expect.objectContaining({
      sourceId: 'douyin', sourceContentId: '73001', title: 'Agent 视频', contentText: '这是视频详情正文。',
    }) });
  });
});

function browser(
  snapshot: EmbeddedBrowser['snapshot'],
  openLogin: EmbeddedBrowser['openLogin'] = async () => undefined,
): EmbeddedBrowser {
  return { snapshot, openLogin, shutdown: async () => undefined };
}

function successSnapshot(input: Partial<EmbeddedBrowserSnapshot>) {
  return {
    status: 'success' as const,
    snapshot: {
      finalUrl: input.finalUrl ?? 'https://example.com/',
      ...(input.title ? { title: input.title } : {}),
      bodyText: input.bodyText ?? '',
      links: input.links ?? [],
    },
  };
}
