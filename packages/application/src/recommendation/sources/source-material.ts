/* Converts acquiring-service fields into stable platform identity and actual material. */
import { normalizeContentUrl } from '../content/normalize-content';
import type { PublicationEvidence } from '../content/material-contracts';
import type { RawItem, SourceMaterial } from './source-connector';

/** Limits stored text by Unicode code points and records the actual acquired range. */
export function boundedMaterial(
  text: string,
): Pick<SourceMaterial, 'text' | 'truncated' | 'rangeStart' | 'rangeEnd'> {
  const points = [...text.trim()];
  return {
    text: points.slice(0, 50_000).join(''),
    truncated: points.length > 50_000,
    rangeStart: 0,
    rangeEnd: Math.min(points.length, 50_000),
  };
}

export function identifyContentUrl(
  value: string,
): Pick<RawItem, 'url' | 'platform' | 'externalId'> | undefined {
  const canonical = normalizeContentUrl(value);
  if (!canonical) return undefined;

  const url = new URL(canonical);
  if (url.hostname === 'www.bilibili.com' || url.hostname === 'm.bilibili.com') {
    const id = /\/video\/(BV[\w]+)/.exec(url.pathname)?.[1];
    if (id)
      return {
        url: `https://www.bilibili.com/video/${id}`,
        platform: 'bilibili',
        externalId: id,
      };
  }
  if (url.hostname === 'www.zhihu.com' || url.hostname === 'zhuanlan.zhihu.com') {
    const answer = /\/question\/\d+\/answer\/(\d+)/.exec(url.pathname)?.[1];
    const article = /\/p\/(\d+)/.exec(url.pathname)?.[1];
    if (answer || article)
      return {
        url: answer
          ? `https://www.zhihu.com${url.pathname.replace(/\/$/, '')}`
          : `https://zhuanlan.zhihu.com/p/${article}`,
        platform: 'zhihu',
        externalId: answer ?? article,
      };
    // A question is an entry page, not an answer with its own material.
  }
  if (url.hostname === 'www.xiaohongshu.com') {
    const id = /\/(?:explore|discovery\/item|search_result)\/([\w]+)/.exec(url.pathname)?.[1];
    if (id)
      return {
        url: `https://www.xiaohongshu.com/explore/${id}`,
        platform: 'xiaohongshu',
        externalId: id,
      };
  }

  return {
    url: canonical,
    platform: 'web',
  };
}

export function publicationClaim(
  value: string | number,
  location: string,
  kind: PublicationEvidence['kind'] = 'published',
  verified = false,
): PublicationEvidence {
  const valid =
    typeof value === 'number'
      ? Number.isFinite(value) && !Number.isNaN(new Date(value).getTime())
      : Number.isFinite(Date.parse(value));
  const storedValue =
    typeof value === 'number' && value < 0 && valid ? new Date(value).toISOString() : value;
  return {
    kind,
    value: valid ? storedValue : null,
    precision: !valid
      ? 'unknown'
      : typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? 'date'
        : 'instant',
    timezone: typeof value === 'number' ? 'UTC' : null,
    location,
    rawValue: String(value),
    status: verified && valid ? 'verified' : 'unverified',
  };
}
