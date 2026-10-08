/* Reads content links from the isolated platform page after a primary API failure. */
import type { EmbeddedBrowser } from './browser-access';
import type { RawItem, SourceSearchRequest, SourceSearchResult } from './source-connector';
import { boundedMaterial, identifyContentUrl } from './source-material';
import { sourceFailure } from './source-http';

export async function searchPlatformPage(
  browser: EmbeddedBrowser,
  profileId: 'zhihu' | 'bilibili',
  request: SourceSearchRequest,
): Promise<SourceSearchResult> {
  if (request.signal?.aborted) return sourceFailure('cancelled', 'Platform search was cancelled.');
  if (request.reserveRequest && !request.reserveRequest('search'))
    return sourceFailure('budget_exhausted', 'Source request budget was exhausted.');

  const url =
    profileId === 'zhihu'
      ? new URL('https://www.zhihu.com/search')
      : new URL('https://search.bilibili.com/all');
  url.searchParams.set(profileId === 'zhihu' ? 'q' : 'keyword', request.query);
  if (profileId === 'zhihu') url.searchParams.set('type', 'content');

  const result = await browser.readPlatform({
    profileId,
    operation: 'search',
    url: url.href,
    signal: request.signal ?? new AbortController().signal,
  });
  if (result.status === 'failed') return sourceFailure(result.failure.code, result.failure.message);

  const snapshot = result.snapshot;
  if (snapshot.pageState === 'login_required' || snapshot.pageState === 'challenge_required')
    return sourceFailure(snapshot.pageState, 'Platform requires user verification.');

  const items: RawItem[] = [];
  const seen = new Set<string>();
  for (const link of snapshot.links) {
    const identity = identifyContentUrl(link.href);
    if (!identity || identity.platform !== profileId || seen.has(identity.url)) continue;

    seen.add(identity.url);
    items.push({
      ...identity,
      source: profileId,
      title: link.text,
      ...boundedMaterial(link.contextText ?? ''),
      kind: 'excerpt',
      method: `${profileId}_browser_search`,
      publicationEvidence: [],
    });
    if (items.length >= request.limit) break;
  }

  return items.length || snapshot.completed
    ? {
        status: 'success',
        items,
      }
    : sourceFailure('timeout', 'Platform search did not establish results or an empty result.');
}
