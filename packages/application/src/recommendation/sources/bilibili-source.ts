/* Owns Bilibili search, detail, subtitle and the single browser fallback. */
/*!
 * WBI signing adapted from OpenBiliClaw.
 * MIT License
 * Copyright (c) 2026 OpenBiliClaw Contributors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import type { EmbeddedBrowser } from './browser-access';
import type { RawItem, SourceConnector, SourceSearchResult, SourceFailure } from './source-connector';
import { budgetedSourceFetch, requestSourceJson, sourceFailure } from './source-http';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { htmlToPlainText } from '../content/normalize-content';
import { boundedMaterial, identifyContentUrl, publicationClaim } from './source-material';
import { searchPlatformPage } from './platform-search';

const WBI_PERMUTATION = [
  46, 47, 18, 2, 53, 8, 23, 32,
  15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19,
  29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61,
  26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63,
  57, 62, 11, 36, 20, 34, 44, 52,
];
const EnvelopeSchema = z.object({ code: z.number(), data: z.unknown().optional() });
const KeysSchema = z.object({ wbi_img: z.object({ img_url: z.string().url(), sub_url: z.string().url() }) });
const SearchSchema = z.object({
  result: z.array(z.object({
    bvid: z.string().regex(/^BV[\w]+$/),
    title: z.string(),
    description: z.string().optional(),
    author: z.string().optional(),
    mid: z.union([z.string(), z.number()]).optional(),
    pubdate: z.number().nonnegative().optional()
  })).optional(), v_voucher: z.string().optional()
});
const VideoSchema = z.object({
  bvid: z.string(),
  title: z.string(),
  desc: z.string(),
  pubdate: z.number().nonnegative(),
  aid: z.number(),
  cid: z.number(),
  owner: z.object({ name: z.string(), mid: z.number() })
});
const SubtitlesSchema = z.object({ subtitle: z.object({ subtitles: z.array(z.object({ lan: z.string(), subtitle_url: z.string() })) }).optional() });
const TranscriptSchema = z.object({ body: z.array(z.object({ content: z.string() })).min(1) });

export function createBilibiliSource(options: { browser?: EmbeddedBrowser; fetch?: typeof globalThis.fetch; now?: () => number }): SourceConnector {
  const now = options.now ?? Date.now;
  const browser = options.browser;
  const fetch: typeof globalThis.fetch = browser ? async (input, init) => browser.fetchWithSession({ profileId: 'bilibili', url: String(input), signal: init?.signal ?? undefined }) : options.fetch ?? globalThis.fetch;
  let apiCooldown: { until: number; failure: SourceFailure } | undefined;
  function retainFailure(failure: SourceFailure) {
    if (failure.code === 'rate_limited' || failure.code === 'challenge_required') apiCooldown = { until: now() + (failure.retryAfterMs ?? 300_000), failure };
  }
  async function requestApi<T>(transport: typeof globalThis.fetch, url: string | URL, init: RequestInit, schema: z.ZodType<T>) {
    if (apiCooldown && apiCooldown.until > now()) return { status: 'failed' as const, failure: apiCooldown.failure };
    const result = await requestSourceJson(transport, url, init, schema);
    if (result.status === 'failed') retainFailure(result.failure);
    else {
      const envelope = EnvelopeSchema.safeParse(result.payload);
      if (envelope.success && envelope.data.code !== 0) retainFailure(biliFailure(envelope.data.code).failure);
    }
    return result;
  }
  let key: { value: string; at: number } | undefined;
  async function signedUrl(path: string, params: Record<string, string | number>, signal?: AbortSignal, reserve?: Parameters<SourceConnector['search']>[0]['reserveRequest']) {
    if (!key || now() - key.at >= 300_000) {
      const response = await requestApi(
        budgetedSourceFetch(fetch, reserve, 'bilibili'),
        'https://api.bilibili.com/x/web-interface/nav',
        { signal },
        EnvelopeSchema
      );
      if (response.status === 'failed') return response;
      const data = KeysSchema.safeParse(response.payload.data);
      if (!data.success) return sourceFailure('invalid_response', 'Bilibili did not return signing keys.');
      const merged = [data.data.wbi_img.img_url, data.data.wbi_img.sub_url].map((url) => new URL(url).pathname.split('/').pop()?.split('.')[0] ?? '').join('');
      if (merged.length !== 64) return sourceFailure('invalid_response', 'Bilibili signing key format changed.');
      key = { value: WBI_PERMUTATION.map((index) => merged[index]).join('').slice(0, 32), at: now() };
    }
    const url = new URL(path, 'https://api.bilibili.com');
    for (const [name, value] of Object.entries({ ...params, wts: Math.floor(now() / 1000) }).sort(([left], [right]) => left.localeCompare(right))) url.searchParams.set(name, String(value).replace(/[!'()*]/g, ''));
    url.searchParams.set(
      'w_rid',
      createHash('md5').update(url.searchParams.toString().replace(/%7E/g, '~') + key.value).digest('hex')
    );
    return { status: 'success' as const, url };
  }
  async function searchApi(request: Parameters<SourceConnector['search']>[0]): Promise<SourceSearchResult> {
    const params = {
      keyword: request.query,
      search_type: 'video',
      page: 1,
      page_size: Math.min(20, request.limit),
      order: request.timeRange ? 'pubdate' : 'totalrank',
      ...(request.timeRange?.from === undefined ? {} : { pubtime_begin: Math.floor(request.timeRange.from / 1000) }),
      ...(request.timeRange?.to === undefined ? {} : { pubtime_end: Math.floor(request.timeRange.to / 1000) }),
    };
    for (let attempt = 0;attempt < 2;attempt++) {
      const signed = await signedUrl('/x/web-interface/wbi/search/type', params, request.signal, request.reserveRequest);
      if (signed.status === 'failed') return signed;
      const response = await requestApi(budgetedSourceFetch(fetch, request.reserveRequest, 'bilibili'), signed.url, { signal: request.signal }, EnvelopeSchema);
      if (response.status === 'failed') return response;
      if (response.payload.code === -400 && attempt === 0) { key = undefined; continue; }
      if (response.payload.code !== 0) return biliFailure(response.payload.code);
      const parsed = SearchSchema.safeParse(response.payload.data);
      if (!parsed.success) return sourceFailure('invalid_response', 'Bilibili search format changed.');
      if (parsed.data.v_voucher) {
        const failure = sourceFailure('challenge_required', 'Bilibili requires verification.', 30 * 60_000);
        retainFailure(failure.failure);
        return failure;
      }
      if (!parsed.data.result) return sourceFailure('invalid_response', 'Bilibili did not establish search results.');
      const items: RawItem[] = parsed.data.result.slice(0, request.limit).map((entry) => ({
        source: 'bilibili',
        platform: 'bilibili',
        externalId: entry.bvid,
        url: `https://www.bilibili.com/video/${entry.bvid}`,
        title: htmlToPlainText(entry.title),
        ...boundedMaterial(entry.description ?? ''),
        kind: 'description',
        method: 'bilibili_api_search',
        author: entry.author,
        authorId: entry.mid === undefined ? undefined : String(entry.mid),
        publishedAt: entry.pubdate === undefined ? undefined : entry.pubdate * 1000,
        publicationEvidence: entry.pubdate === undefined ? [] : [publicationClaim(entry.pubdate * 1000, 'Bilibili.search.pubdate', 'published', true)],
      }));
      return { status: 'success', items };
    }
    return sourceFailure('invalid_response', 'Bilibili rejected refreshed signing parameters.');
  }
  const primary: SourceConnector = {
    managesRequestBudget: true,
    id: 'bilibili',
    descriptor: {
      id: 'bilibili',
      description: 'B 站视频与字幕。',
      accessPaths: ['public', 'browser_session'],
      maxResultsPerSearch: 20,
      supportsTimeRange: true,
      material: 'excerpt',
      supportsFetch: true
    },
    async search(request) {
      const result = await searchApi(request);
      if (!options.browser || (result.status === 'success' && result.items.length > 0) || (result.status === 'failed' && ['cancelled', 'budget_exhausted'].includes(result.failure.code))) return result;
      return searchPlatformPage(options.browser, 'bilibili', request);
    },
    async fetch(request) {
      const materialFetch = budgetedSourceFetch(fetch, request.reserveRequest, 'material');
      const identity = identifyContentUrl(request.url);
      if (!identity || identity.platform !== 'bilibili' || !identity.externalId) return sourceFailure('invalid_response', 'URL does not identify a Bilibili video.');
      const url = new URL('/x/web-interface/view', 'https://api.bilibili.com');
      url.searchParams.set('bvid', identity.externalId);
      let response = await requestApi(materialFetch, url, { signal: request.signal }, EnvelopeSchema);
      if (response.status === 'success' && (response.payload.code === -400 || response.payload.code === -403)) {
        const signed = await signedUrl('/x/web-interface/wbi/view', { bvid: identity.externalId }, request.signal, request.reserveRequest);
        if (signed.status === 'failed') return signed;
        response = await requestApi(materialFetch, signed.url, { signal: request.signal }, EnvelopeSchema);
      }
      if (response.status === 'failed') return response;
      if (response.payload.code !== 0) return biliFailure(response.payload.code);
      const parsed = VideoSchema.safeParse(response.payload.data);
      if (!parsed.success || parsed.data.bvid !== identity.externalId) return sourceFailure('invalid_response', 'Bilibili detail does not identify the requested video.');
      const video = parsed.data;
      const material = {
        ...boundedMaterial(video.desc),
        platform: 'bilibili' as const,
        kind: 'description' as const,
        method: 'bilibili_api_detail',
        title: video.title,
        author: video.owner.name,
        authorId: String(video.owner.mid),
        publishedAt: video.pubdate * 1000,
        publicationEvidence: [publicationClaim(video.pubdate * 1000, 'Bilibili.view.pubdate', 'published', true)],
      };
      const playerUrl = new URL('/x/player/v2', 'https://api.bilibili.com');
      playerUrl.searchParams.set('aid', String(video.aid));
      playerUrl.searchParams.set('cid', String(video.cid));
      const player = await requestApi(materialFetch, playerUrl, { signal: request.signal }, EnvelopeSchema);
      if (player.status === 'failed' && player.failure.code === 'cancelled') return player;
      const subtitles = player.status === 'success' && player.payload.code === 0 ? SubtitlesSchema.safeParse(player.payload.data) : undefined;
      const entries = subtitles?.success ? subtitles.data.subtitle?.subtitles ?? [] : [];
      const chosen = entries.find((entry) => entry.lan.startsWith('zh')) ?? entries.find((entry) => entry.lan.startsWith('en')) ?? entries[0];
      if (chosen) {
        let address: URL;
        try { address = new URL(chosen.subtitle_url.startsWith('//') ? `https:${chosen.subtitle_url}` : chosen.subtitle_url); } catch { return sourceFailure('invalid_response', 'Bilibili subtitle URL is invalid.'); }
        if (address.protocol !== 'https:' || !address.hostname.endsWith('.hdslb.com') || !address.pathname.startsWith('/bfs/subtitle/') || address.username || address.password) return sourceFailure('invalid_response', 'Bilibili subtitle URL is outside the allowed host.');
        const transcript = await requestApi(materialFetch, address, { signal: request.signal }, TranscriptSchema);
        if (transcript.status === 'failed' && transcript.failure.code === 'cancelled') return transcript;
        if (transcript.status === 'success') {
          const text = transcript.payload.body.map((line) => line.content).join('\n');
          if (text.trim()) return {
            status: 'success', material: {
              ...material,
              ...boundedMaterial(text),
              kind: 'transcript',
              method: 'bilibili_subtitle'
            }
          };
        }
      }
      return material.text ? { status: 'success', material } : sourceFailure('material_unavailable', 'Bilibili returned neither description nor subtitles.');
    },
  };
  return {
    ...primary,
    async fetch(request) {
      const result = await primary.fetch(request);
      if (result.status === 'success' || ['cancelled', 'budget_exhausted'].includes(result.failure.code) || !options.browser) return result;
      const identity = identifyContentUrl(request.url);
      if (!identity || identity.platform !== 'bilibili') return result;
      if (request.reserveRequest && !request.reserveRequest('material')) return sourceFailure('budget_exhausted', 'Source request budget was exhausted.');
      const page = await options.browser.readPlatform({
        profileId: 'bilibili',
        operation: 'detail',
        url: identity.url,
        signal: request.signal ?? new AbortController().signal
      });
      if (page.status === 'failed') return sourceFailure(page.failure.code, page.failure.message);
      if (page.snapshot.pageState === 'login_required' || page.snapshot.pageState === 'challenge_required') return sourceFailure(page.snapshot.pageState, 'Bilibili requires user verification.');
      const parsed = z.object({ video: VideoSchema.partial({ aid: true, cid: true }) }).safeParse(page.snapshot.structuredData);
      if (!parsed.success || parsed.data.video.bvid !== identity.externalId) return sourceFailure('material_unavailable', 'Bilibili did not expose the requested video.');
      const video = parsed.data.video;
      if (!video.desc.trim()) return sourceFailure('material_unavailable', 'Bilibili page returned no description.');
      return {
        status: 'success', material: {
          ...boundedMaterial(video.desc),
          platform: 'bilibili',
          kind: 'description',
          method: 'bilibili_browser_detail',
          title: video.title,
          author: video.owner.name,
          authorId: String(video.owner.mid),
          publishedAt: video.pubdate * 1000,
          publicationEvidence: [publicationClaim(video.pubdate * 1000, 'Bilibili.page.videoData.pubdate', 'published', true)],
        }
      };
    },
  };
}

function biliFailure(code: number) {
  if (code === -101) return sourceFailure('login_required', 'Bilibili requires login.');
  if (code === -412 || code === -352) return sourceFailure('challenge_required', 'Bilibili requires verification.', 30 * 60_000);
  if (code === -509) return sourceFailure('rate_limited', 'Bilibili rate limited the request.', 5 * 60_000);
  return sourceFailure('invalid_response', 'Bilibili returned a business error.');
}
