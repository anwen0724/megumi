/*
 * Produces stable source and cross-source identities for discovered content.
 */
import type { SourceContent } from '../sources/discovery-source';

const TRACKING_PARAMETERS = new Set([
  'from', 'from_source', 'share_source', 'share_token', 'source', 'spm_id_from',
]);

/** Creates a Source-local identity when a stable provider content id exists. */
export function sourceContentIdentity(content: SourceContent): string {
  return content.sourceContentId
    ? `source:${content.sourceId}:id:${content.sourceContentId}`
    : `source:${content.sourceId}:url:${normalizeContentUrl(content.canonicalUrl)}`;
}

/** Creates the cross-source identity from a normalized canonical URL. */
export function canonicalContentIdentity(content: Pick<SourceContent, 'canonicalUrl'>): string {
  const url = new URL(content.canonicalUrl);
  const platform = platformIdentity(url);
  return platform ?? `content:v2:url:${normalizeContentUrl(url.toString())}`;
}

/** Normalizes an HTTP(S) URL for stable cross-source content comparison. */
export function normalizeContentUrl(value: string): string {
  const url = new URL(value);
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  for (const key of [...url.searchParams.keys()]) {
    const normalized = key.toLowerCase();
    if (normalized.startsWith('utm_') || TRACKING_PARAMETERS.has(normalized)) {
      url.searchParams.delete(key);
    }
  }
  url.searchParams.sort();
  if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/u, '');
  return url.toString();
}

function platformIdentity(url: URL): string | undefined {
  const host = url.hostname.toLowerCase().replace(/^www\./u, '');
  const path = decodeURIComponent(url.pathname);
  if (host === 'bilibili.com' || host.endsWith('.bilibili.com')) {
    const id = path.match(/\/video\/(BV[\dA-Za-z]+)/u)?.[1];
    if (id) return `content:v2:platform:bilibili:${id}`;
  }
  if (host === 'xiaohongshu.com' || host.endsWith('.xiaohongshu.com')) {
    const id = path.match(/\/(?:explore|discovery\/item)\/([\dA-Za-z]+)/u)?.[1];
    if (id) return `content:v2:platform:xiaohongshu:note:${id}`;
  }
  if (host === 'douyin.com' || host.endsWith('.douyin.com')) {
    const id = path.match(/\/video\/(\d+)/u)?.[1];
    if (id) return `content:v2:platform:douyin:aweme:${id}`;
  }
  if (host === 'zhihu.com' || host.endsWith('.zhihu.com')) {
    const answerId = path.match(/\/question\/\d+\/answer\/(\d+)/u)?.[1];
    if (answerId) return `content:v2:platform:zhihu:answer:${answerId}`;
    const articleId = path.match(/\/p\/(\d+)/u)?.[1];
    if (articleId) return `content:v2:platform:zhihu:article:${articleId}`;
    const questionId = path.match(/\/question\/(\d+)/u)?.[1];
    if (questionId) return `content:v2:platform:zhihu:question:${questionId}`;
  }
  return undefined;
}
