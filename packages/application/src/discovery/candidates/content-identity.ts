/* Produces stable source-local and canonical identities for discovered content. */
import { createHash } from 'node:crypto';
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

/** Creates the stable Candidate identity required by the Candidate Supply contract. */
export function canonicalContentIdentity(content: Pick<SourceContent, 'canonicalUrl'>): string {
  const normalized = normalizeContentUrl(content.canonicalUrl);
  return `content:sha256:${createHash('sha256').update(normalized).digest('hex')}`;
}

/** Normalizes an HTTP(S) URL for stable cross-source content comparison. */
export function normalizeContentUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Candidate canonicalUrl must use HTTP or HTTPS.');
  }
  url.hash = '';
  url.protocol = url.protocol.toLowerCase();
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
