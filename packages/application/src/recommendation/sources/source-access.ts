/* Assembles the approved sources and owns search/material fallback and access state. */
import type { WebFetch } from '@megumi/agent';
import {
  SourceIdSchema,
  SOURCE_CATALOG,
  type SourceId,
  type SourceAccessView,
  type SourceLoginResult
} from './source-access-contracts';
import type { EmbeddedBrowser } from './browser-access';
import { createTavilySource } from './tavily-source';
import { createBingSource } from './bing-source';
import { createZhihuSource } from './zhihu-source';
import { createBilibiliSource } from './bilibili-source';
import { createXiaohongshuSource } from './xiaohongshu-source';
import { createDirectWebSource } from './direct-web-source';
import type {
  RawItem,
  SourceConnector,
  SourceFailure,
  SourceMaterialRequest,
  SourceMaterialResult,
  SourceSearchRequest,
  SourceSearchResult
} from './source-connector';
import { sourceFailure } from './source-http';
import { identifyContentUrl } from './source-material';
import { PLATFORM_ORIGINS } from './platform-page-reader';

export interface SourceAccessOptions {
  enabledSources(): readonly string[];
  accessSecret(sourceId: 'tavily' | 'zhihu'): string | undefined;
  browser?: EmbeddedBrowser;
  fetch?: typeof globalThis.fetch;
  webFetch?: WebFetch;
  now?: () => number;
}

export function createSourceAccess(options: SourceAccessOptions) {
  const now = options.now ?? Date.now;
  const checks = new Map<SourceId, SourceAccessView>();
  let stopped = false;
  const sources: readonly SourceConnector[] = [
    createTavilySource({ accessSecret: () => options.accessSecret('tavily'), fetch: options.fetch }),
    createBingSource({ fetch: options.fetch }),
    createZhihuSource({
      accessSecret: () => options.accessSecret('zhihu'),
      fetch: options.fetch,
      browser: options.browser,
      now: options.now
    }),
    createBilibiliSource({ fetch: options.fetch, browser: options.browser, now: options.now }),
    createXiaohongshuSource({ browser: options.browser }),
  ];
  const direct = createDirectWebSource({ webFetch: options.webFetch });
  function view(sourceId: SourceId): SourceAccessView {
    if (!options.enabledSources().includes(sourceId)) return { sourceId, state: 'disabled', checkedAt: null, retryAt: null, error: null };
    if (sourceId === 'tavily' && !options.accessSecret('tavily')?.trim()) return {
      sourceId,
      state: 'not_configured',
      checkedAt: null,
      retryAt: null,
      error: { code: 'SOURCE_NOT_CONFIGURED', message: 'Tavily 凭据未配置。' }
    };
    const cached = checks.get(sourceId);
    if (sourceId === 'tavily' && cached?.state === 'not_configured') return {
      sourceId, state: 'unchecked', checkedAt: null, retryAt: null, error: null,
    };
    if (cached?.retryAt && Date.parse(cached.retryAt) <= now()) return { ...cached, state: 'unchecked', retryAt: null };
    return cached ?? { sourceId, state: 'unchecked', checkedAt: null, retryAt: null, error: null };
  }
  function checked(sourceId: SourceId, failure?: SourceFailure): SourceAccessView {
    let state: SourceAccessView['state'] = 'available';
    if (failure) {
      switch (failure.code) {
        case 'not_configured': state = 'not_configured'; break;
        case 'login_required': state = 'login_required'; break;
        case 'unauthorized': state = sourceId === 'tavily' ? 'unavailable' : 'login_required'; break;
        case 'challenge_required': state = 'challenge_required'; break;
        case 'rate_limited': state = 'cooling_down'; break;
        default: state = 'unavailable';
      }
    }
    const result: SourceAccessView = {
      sourceId,
      state,
      checkedAt: new Date(now()).toISOString(),
      retryAt: failure?.retryAfterMs === undefined ? null : new Date(now() + failure.retryAfterMs).toISOString(),
      error: failure ? { code: failure.code === 'not_configured' ? 'SOURCE_NOT_CONFIGURED' : failure.code.toUpperCase(), message: failure.message } : null
    };
    if (!stopped) checks.set(sourceId, result);
    return result;
  }
  async function callSearch(source: SourceConnector, request: SourceSearchRequest): Promise<SourceSearchResult> {
    if (!options.enabledSources().includes(source.id)) return sourceFailure('not_configured', 'Source is disabled.');
    const sourceId = SourceIdSchema.parse(source.id);
    const current = checks.get(sourceId);
    if (current?.retryAt && Date.parse(current.retryAt) > now()) return sourceFailure(
      current.state === 'challenge_required' ? 'challenge_required' : 'rate_limited',
      'Source is cooling down.',
      Date.parse(current.retryAt) - now()
    );
    const result = await source.search(request);
    if (result.status === 'success') checked(sourceId);
    else if (!['cancelled', 'budget_exhausted'].includes(result.failure.code)) checked(sourceId, result.failure);
    return result.status === 'success' ? { status: 'success', items: result.items.filter((item) => !item.platform || item.platform === 'web' || options.enabledSources().includes(item.platform)) } : result;
  }
  async function callMaterial(source: SourceConnector, request: SourceMaterialRequest): Promise<SourceMaterialResult> {
    const sourceId = SourceIdSchema.parse(source.id);
    const current = checks.get(sourceId);
    if (current?.retryAt && Date.parse(current.retryAt) > now()) return sourceFailure(
      current.state === 'challenge_required' ? 'challenge_required' : 'rate_limited',
      'Source is cooling down.',
      Date.parse(current.retryAt) - now()
    );
    const result = await source.fetch(request);
    if (result.status === 'success') checked(sourceId);
    else if (!['cancelled', 'budget_exhausted'].includes(result.failure.code)) checked(sourceId, result.failure);
    return result;
  }
  async function searchWeb(request: SourceSearchRequest, first?: SourceSearchResult): Promise<SourceSearchResult> {
    let result = first;
    for (const id of first ? ['bing_rss'] : ['tavily', 'bing_rss']) {
      if (!options.enabledSources().includes(id)) continue;
      const source = sources.find((entry) => entry.id === id);
      if (!source) continue;
      result = await callSearch(source, request);
      if ((result.status === 'success' && result.items.length) || (result.status === 'failed' && ['cancelled', 'budget_exhausted'].includes(result.failure.code))) return result;
    }
    return result ?? {
      status: 'failed', failure: {
        code: 'not_configured',
        message: 'No general search source is enabled.',
        retryable: false
      }
    };
  }
  const access = {
    async openSourceLogin(sourceId: SourceId): Promise<SourceLoginResult> {
      if (sourceId !== 'zhihu' && sourceId !== 'bilibili' && sourceId !== 'xiaohongshu') return { status: 'rejected', error: { code: 'UNSUPPORTED_OPERATION', message: 'This source uses a key rather than browser login.' } };
      if (stopped || !options.browser) return { status: 'rejected', error: { code: 'SOURCE_UNAVAILABLE', message: 'Platform browser is unavailable.' } };
      const address = sourceId === 'zhihu' ? 'https://www.zhihu.com/' : sourceId === 'bilibili' ? 'https://www.bilibili.com/' : 'https://www.xiaohongshu.com/';
      const handle = await options.browser.openLogin({ profileId: sourceId, url: address, allowedOrigins: PLATFORM_ORIGINS[sourceId] });
      void handle.closed.then(async () => { if (!stopped) { checks.delete(sourceId); await access.checkSourceAccess(sourceId); } }).catch(() => { if (!stopped) checked(sourceId, sourceFailure('unavailable', 'Platform access check failed.').failure); });
      return { status: 'opened' };
    },
    async shutdown() { stopped = true; await options.browser?.shutdown(); },
    readStatuses(): readonly SourceAccessView[] {
      return SOURCE_CATALOG.map(({ sourceId }) => view(sourceId));
    },
    async checkSourceAccess(sourceId: SourceId): Promise<SourceAccessView> {
      const current = view(sourceId);
      if (current.state === 'disabled' || current.state === 'not_configured' || current.retryAt && Date.parse(current.retryAt) > now()) return current;
      const usesZhihuApi = sourceId === 'zhihu' && !!options.accessSecret('zhihu')?.trim();
      if (!usesZhihuApi && (sourceId === 'zhihu' || sourceId === 'bilibili' || sourceId === 'xiaohongshu')) {
        if (!options.browser) return checked(sourceId, sourceFailure('unavailable', 'Platform browser is unavailable.').failure);
        const address = sourceId === 'zhihu' ? 'https://www.zhihu.com/' : sourceId === 'bilibili' ? 'https://www.bilibili.com/' : 'https://www.xiaohongshu.com/';
        const result = await options.browser.readPlatform({
          profileId: sourceId,
          operation: 'status',
          url: address,
          signal: AbortSignal.timeout(30_000)
        });
        if (result.status === 'failed') return checked(sourceId, sourceFailure(result.failure.code, result.failure.message).failure);
        const state = result.snapshot.pageState;
        return checked(
          sourceId,
          state === 'login_required' || state === 'challenge_required' ? sourceFailure(state, 'Platform requires user verification.').failure : undefined
        );
      }
      const source = sources.find((entry) => entry.id === sourceId);
      if (!source) throw new Error('Source was not assembled.');
      const result = await callSearch(source, { query: 'Megumi', limit: 1 });
      return result.status === 'success' ? checked(sourceId) : checked(sourceId, result.failure);
    },
    async acquireMaterial(item: RawItem, request: Pick<SourceMaterialRequest, 'signal' | 'reserveRequest'> = {}): Promise<SourceMaterialResult> {
      if (request.signal?.aborted) return sourceFailure('cancelled', 'Material acquisition was cancelled.');
      if (!options.enabledSources().length) return sourceFailure('not_configured', 'All recommendation sources are disabled.');
      const identity = identifyContentUrl(item.url);
      if (!identity) return sourceFailure('invalid_response', 'Content URL is invalid.');
      if (identity.platform !== 'web' && identity.platform && !options.enabledSources().includes(identity.platform)) return sourceFailure('not_configured', 'Content platform is disabled.');
      const platform = sources.find((source) => source.id === identity.platform);
      if (platform && options.enabledSources().includes(platform.id)) {
        const result = await callMaterial(platform, { ...request, url: item.requestUrl ?? identity.url, externalId: identity.externalId });
        if (result.status === 'success' || ['cancelled', 'budget_exhausted'].includes(result.failure.code)) return result;
      }
      const primary = sources.find((source) => source.id === 'tavily');
      if (primary && options.enabledSources().includes('tavily')) {
        const result = await callMaterial(primary, { ...request, url: identity.url, externalId: identity.externalId });
        if (result.status === 'success' || ['cancelled', 'budget_exhausted'].includes(result.failure.code)) return result;
      }
      return direct.fetch({ ...request, url: identity.url });
    },
    connectors: () => sources.filter((source) => options.enabledSources().includes(source.id)).map((source): SourceConnector => ({
      ...source,
      async search(request) {
        if (!options.enabledSources().includes(source.id)) return sourceFailure('not_configured', 'Source is disabled.');
        const result = await callSearch(source, request);
        if ((result.status === 'success' && result.items.length) || (result.status === 'failed' && ['cancelled', 'budget_exhausted'].includes(result.failure.code))) return result;
        if (source.id === 'tavily') return searchWeb(request, result);
        if (source.id === 'bing_rss') return result;
        const site = source.id === 'zhihu' ? 'zhihu.com' : source.id === 'bilibili' ? 'bilibili.com' : 'xiaohongshu.com';
        return searchWeb({ ...request, query: `site:${site} ${request.query}` });
      },
    })),
  };
  return access;
}
