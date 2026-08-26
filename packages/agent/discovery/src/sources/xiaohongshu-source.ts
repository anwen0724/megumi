/*
 * Owns Xiaohongshu browser URLs, page-state interpretation, and content normalization.
 */
import {
  reportSourceProviderResponse,
  SourceContentDetailSchema,
  SourceContentSchema,
  type DiscoverySource,
  type SourceFailure,
} from './discovery-source';
import type { EmbeddedBrowser, EmbeddedBrowserSnapshot } from './embedded-browser';

const ALLOWED_ORIGINS = [
  'https://www.xiaohongshu.com',
  'https://edith.xiaohongshu.com',
  'https://passport.xiaohongshu.com',
] as const;
const HOME_URL = 'https://www.xiaohongshu.com/';

/** Creates the Xiaohongshu Source backed by Megumi's embedded browser session. */
export function createXiaohongshuSource(input: { readonly browser: EmbeddedBrowser }): DiscoverySource {
  let availability: ReturnType<DiscoverySource['getAvailability']> = { state: 'unknown' };
  const checkAvailability = async () => {
    const checkedAt = new Date().toISOString();
    const result = await input.browser.snapshot({
      profileId: 'xiaohongshu', url: HOME_URL, allowedOrigins: ALLOWED_ORIGINS,
      signal: new AbortController().signal,
    });
    if (result.status === 'failed') {
      availability = { state: 'unknown', checkedAt };
      return availability;
    }
    availability = availabilityFromPage(result.snapshot, checkedAt);
    return availability;
  };
  return {
    descriptor: {
      id: 'xiaohongshu', name: '小红书', access: 'browser_session',
      supportedModes: ['relevance'], supportsRead: true,
    },
    getAvailability: () => availability,
    checkAvailability,
    async connect() {
      await input.browser.openLogin({ profileId: 'xiaohongshu', url: HOME_URL, allowedOrigins: ALLOWED_ORIGINS });
      await checkAvailability();
    },
    async search(request) {
      if (request.mode !== 'relevance') return failed('invalid_response', 'Xiaohongshu does not support recent search.', false);
      const url = new URL('https://www.xiaohongshu.com/search_result');
      url.searchParams.set('keyword', request.query.trim());
      url.searchParams.set('source', 'web_explore_feed');
      const result = await input.browser.snapshot({
        profileId: 'xiaohongshu', url: url.toString(), allowedOrigins: ALLOWED_ORIGINS, signal: request.signal,
      });
      reportSourceProviderResponse(request.onProviderResponse, result);
      if (result.status === 'failed') {
        availability = { state: 'unknown', checkedAt: new Date().toISOString() };
        return failed(result.failure.code, result.failure.message, result.failure.code !== 'cancelled');
      }
      const items = searchItems(result.snapshot, request.limit);
      if (items.length > 0) {
        availability = { state: 'ready', checkedAt: new Date().toISOString() };
        return { status: 'success', items };
      }
      const pageFailure = blockingPageState(result.snapshot);
      if (pageFailure) {
        availability = pageFailure.code === 'login_required'
          ? { state: 'login_required', checkedAt: new Date().toISOString() }
          : { state: 'risk_controlled', checkedAt: new Date().toISOString() };
        return failed(pageFailure.code, pageFailure.message, false);
      }
      availability = { state: 'ready', checkedAt: new Date().toISOString() };
      return { status: 'success', items };
    },
    async read(request) {
      const result = await input.browser.snapshot({
        profileId: 'xiaohongshu', url: request.url, allowedOrigins: ALLOWED_ORIGINS, signal: request.signal,
      });
      reportSourceProviderResponse(request.onProviderResponse, result);
      if (result.status === 'failed') return failed(result.failure.code, result.failure.message, result.failure.code !== 'cancelled');
      const pageFailure = blockingPageState(result.snapshot);
      if (pageFailure) return failed(pageFailure.code, pageFailure.message, false);
      const title = cleanTitle(result.snapshot.title, '小红书') || result.snapshot.bodyText.split(/\r?\n/u)[0]?.trim();
      if (!title) return failed('invalid_response', 'Xiaohongshu detail title was missing.', false);
      return { status: 'success', detail: SourceContentDetailSchema.parse({
        sourceId: 'xiaohongshu', sourceName: '小红书',
        ...(request.sourceContentId || noteId(request.url) ? { sourceContentId: request.sourceContentId ?? noteId(request.url) } : {}),
        canonicalUrl: request.url, contentType: 'post', title,
        ...(result.snapshot.bodyText.trim() ? { description: result.snapshot.bodyText.trim(), contentText: result.snapshot.bodyText.trim() } : {}),
      }) };
    },
  };
}

function searchItems(snapshot: EmbeddedBrowserSnapshot, limit: number) {
  const seen = new Set<string>();
  return snapshot.links.flatMap((link) => {
    try {
      const canonicalUrl = new URL(link.href, snapshot.finalUrl).toString();
      const id = noteId(canonicalUrl);
      const title = link.text.trim();
      if (!id || !title || seen.has(id)) return [];
      seen.add(id);
      return [SourceContentSchema.parse({
        sourceId: 'xiaohongshu', sourceName: '小红书', sourceContentId: id,
        canonicalUrl, contentType: 'post', title,
        ...(link.contextText?.trim() ? { description: link.contextText.trim() } : {}),
        ...(httpUrl(link.imageUrl) ? { coverUrl: httpUrl(link.imageUrl) } : {}),
      })];
    } catch {
      // One malformed page link must not discard otherwise usable search results.
      return [];
    }
  }).slice(0, limit);
}

function availabilityFromPage(snapshot: EmbeddedBrowserSnapshot, checkedAt: string) {
  const failure = blockingPageState(snapshot);
  if (failure?.code === 'login_required') return { state: 'login_required' as const, checkedAt };
  if (failure) return { state: 'risk_controlled' as const, checkedAt };
  return { state: 'ready' as const, checkedAt };
}

function blockingPageState(snapshot: EmbeddedBrowserSnapshot): { code: 'login_required' | 'risk_control'; message: string } | undefined {
  const url = new URL(snapshot.finalUrl);
  if (url.hostname === 'passport.xiaohongshu.com' || /^\/login(?:\/|$)/u.test(url.pathname)) {
    return { code: 'login_required', message: 'Xiaohongshu login is required.' };
  }
  if (snapshot.links.some((link) => isLoginLink(link.href, snapshot.finalUrl, ['passport.xiaohongshu.com']))) {
    return { code: 'login_required', message: 'Xiaohongshu login is required.' };
  }
  if (/扫码登录|请先登录|请登录后继续/iu.test(snapshot.bodyText)) {
    return { code: 'login_required', message: 'Xiaohongshu login is required.' };
  }
  if (/访问过于频繁|安全验证|完成验证|验证码|risk|captcha/iu.test(snapshot.bodyText)) return { code: 'risk_control', message: 'Xiaohongshu requires verification.' };
  return undefined;
}

function isLoginLink(value: string, baseUrl: string, loginHosts: readonly string[]): boolean {
  try {
    const url = new URL(value, baseUrl);
    return loginHosts.includes(url.hostname) || /^\/login(?:\/|$)/u.test(url.pathname);
  } catch {
    return false;
  }
}

function noteId(value: string): string | undefined {
  try {
    return new URL(value).pathname.match(/\/(?:explore|search_result)\/([\da-z]+)/iu)?.[1];
  } catch {
    return undefined;
  }
}

function cleanTitle(value: string | undefined, suffix: string): string | undefined {
  const title = value?.replace(new RegExp(`\\s*[-—_]\\s*${suffix}.*$`, 'u'), '').trim();
  return title || undefined;
}

function httpUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return /^https?:$/u.test(url.protocol) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function failed(code: SourceFailure['code'], message: string, retryable: boolean) {
  return { status: 'failed' as const, failure: { code, message, retryable } };
}
