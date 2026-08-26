/*
 * Owns Douyin browser URLs, page-state interpretation, and content normalization.
 */
import { SourceContentDetailSchema, SourceContentSchema, type DiscoverySource, type SourceFailure } from './discovery-source';
import type { EmbeddedBrowser, EmbeddedBrowserSnapshot } from './embedded-browser';

const ALLOWED_ORIGINS = [
  'https://www.douyin.com',
  'https://sso.douyin.com',
  'https://passport.douyin.com',
] as const;
const HOME_URL = 'https://www.douyin.com/';

/** Creates the Douyin Source backed by Megumi's embedded browser session. */
export function createDouyinSource(input: { readonly browser: EmbeddedBrowser }): DiscoverySource {
  let availability: ReturnType<DiscoverySource['getAvailability']> = { state: 'unknown' };
  return {
    descriptor: {
      id: 'douyin', name: '抖音', access: 'browser_session',
      supportedModes: ['relevance'], supportsRead: true,
    },
    getAvailability: () => availability,
    async connect() {
      await input.browser.openLogin({ profileId: 'douyin', url: HOME_URL, allowedOrigins: ALLOWED_ORIGINS });
      availability = { state: 'unknown' };
    },
    async search(request) {
      if (request.mode !== 'relevance') return failed('invalid_response', 'Douyin does not support recent search.', false);
      const url = new URL(`https://www.douyin.com/search/${encodeURIComponent(request.query.trim())}`);
      url.searchParams.set('type', 'general');
      const result = await input.browser.snapshot({
        profileId: 'douyin', url: url.toString(), allowedOrigins: ALLOWED_ORIGINS, signal: request.signal,
      });
      if (result.status === 'failed') return failed(result.failure.code, result.failure.message, result.failure.code !== 'cancelled');
      const pageFailure = pageState(result.snapshot);
      if (pageFailure) {
        availability = pageFailure.code === 'login_required'
          ? { state: 'login_required', checkedAt: new Date().toISOString() }
          : { state: 'risk_controlled', checkedAt: new Date().toISOString() };
        return failed(pageFailure.code, pageFailure.message, false);
      }
      availability = { state: 'ready', checkedAt: new Date().toISOString() };
      const seen = new Set<string>();
      const items = result.snapshot.links.flatMap((link) => {
        try {
          const canonicalUrl = new URL(link.href, result.snapshot.finalUrl).toString();
          const id = videoId(canonicalUrl);
          const title = link.text.trim();
          if (!id || !title || seen.has(id)) return [];
          seen.add(id);
          return [SourceContentSchema.parse({
            sourceId: 'douyin', sourceName: '抖音', sourceContentId: id,
            canonicalUrl, contentType: 'video', title,
            ...(link.contextText?.trim() ? { description: link.contextText.trim() } : {}),
            ...(httpUrl(link.imageUrl) ? { coverUrl: httpUrl(link.imageUrl) } : {}),
          })];
        } catch {
          // One malformed page link must not discard otherwise usable search results.
          return [];
        }
      }).slice(0, request.limit);
      return { status: 'success', items };
    },
    async read(request) {
      const result = await input.browser.snapshot({
        profileId: 'douyin', url: request.url, allowedOrigins: ALLOWED_ORIGINS, signal: request.signal,
      });
      if (result.status === 'failed') return failed(result.failure.code, result.failure.message, result.failure.code !== 'cancelled');
      const pageFailure = pageState(result.snapshot);
      if (pageFailure) return failed(pageFailure.code, pageFailure.message, false);
      const title = cleanTitle(result.snapshot.title, '抖音') || result.snapshot.bodyText.split(/\r?\n/u)[0]?.trim();
      if (!title) return failed('invalid_response', 'Douyin detail title was missing.', false);
      return { status: 'success', detail: SourceContentDetailSchema.parse({
        sourceId: 'douyin', sourceName: '抖音',
        ...(request.sourceContentId || videoId(request.url) ? { sourceContentId: request.sourceContentId ?? videoId(request.url) } : {}),
        canonicalUrl: request.url, contentType: 'video', title,
        ...(result.snapshot.bodyText.trim() ? { description: result.snapshot.bodyText.trim(), contentText: result.snapshot.bodyText.trim() } : {}),
      }) };
    },
  };
}

function pageState(snapshot: EmbeddedBrowserSnapshot): { code: 'login_required' | 'risk_control'; message: string } | undefined {
  const text = `${snapshot.finalUrl}\n${snapshot.bodyText}`;
  if (/\/login\b|登录后|请登录|扫码登录/iu.test(text)) return { code: 'login_required', message: 'Douyin login is required.' };
  if (/访问过于频繁|安全验证|完成验证|验证码|risk|captcha/iu.test(text)) return { code: 'risk_control', message: 'Douyin requires verification.' };
  return undefined;
}

function videoId(value: string): string | undefined {
  try {
    return new URL(value).pathname.match(/\/video\/(\d+)/u)?.[1];
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
