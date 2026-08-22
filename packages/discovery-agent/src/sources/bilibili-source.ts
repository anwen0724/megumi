/* Searches Bilibili public videos through WBI with bounded retry and risk-control cooldown. */
import {
  SourceContentSchema,
  type DiscoverySource,
  type SourceFailure,
  type SourceSearchMode,
} from './discovery-source';
import { signBilibiliWbiParameters } from './bilibili-wbi';

const NAV_URL = 'https://api.bilibili.com/x/web-interface/nav';
const SEARCH_URL = 'https://api.bilibili.com/x/web-interface/wbi/search/type';
const DEFAULT_KEY_TTL_MS = 6 * 60 * 60 * 1_000;
const DEFAULT_COOLDOWN_MS = 15 * 60 * 1_000;
const DEFAULT_TIMEOUT_MS = 10_000;

type FetchImplementation = typeof globalThis.fetch;
type WbiKeys = { readonly imgKey: string; readonly subKey: string; readonly expiresAt: number };

class BilibiliFailure extends Error {
  public constructor(public readonly failure: SourceFailure, public readonly invalidKey = false) {
    super(failure.message);
  }
}

export function createBilibiliSource(input: {
  readonly fetch?: FetchImplementation;
  readonly now?: () => number;
  readonly keyTtlMs?: number;
  readonly cooldownMs?: number;
  readonly timeoutMs?: number;
} = {}): DiscoverySource {
  const fetchImplementation = input.fetch ?? globalThis.fetch;
  const now = input.now ?? Date.now;
  const keyTtlMs = input.keyTtlMs ?? DEFAULT_KEY_TTL_MS;
  const cooldownMs = input.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let keys: WbiKeys | undefined;
  let cooldown: { until: number; failure: SourceFailure } | undefined;

  const source: DiscoverySource = {
    descriptor: { id: 'bilibili', name: '哔哩哔哩', supportedModes: ['relevance', 'recent'] },
    async search(request) {
      if (cooldown && cooldown.until > now()) return { status: 'failed', failure: cooldown.failure };
      if (cooldown) cooldown = undefined;
      try {
        let result: unknown;
        try {
          result = await searchOnce(request.query, request.mode, request.limit, request.signal, false);
        } catch (error) {
          if (!(error instanceof BilibiliFailure) || !error.invalidKey) throw error;
          keys = undefined;
          result = await searchOnce(request.query, request.mode, request.limit, request.signal, true);
        }
        return { status: 'success', items: normalizeSearchItems(result) };
      } catch (error) {
        const failure = normalizeFailure(error, request.signal);
        if (failure.code === 'risk_control' || failure.code === 'rate_limited') {
          cooldown = { until: now() + cooldownMs, failure };
        }
        return { status: 'failed', failure };
      }
    },
  };

  async function searchOnce(
    query: string,
    mode: SourceSearchMode,
    limit: number,
    signal: AbortSignal,
    forceKeys: boolean,
  ): Promise<unknown> {
    const currentKeys = await resolveKeys(signal, forceKeys);
    const signed = signBilibiliWbiParameters({
      params: {
        search_type: 'video',
        keyword: query.trim(),
        order: mode === 'recent' ? 'pubdate' : 'totalrank',
        page: 1,
        page_size: Math.max(1, Math.min(50, Math.floor(limit))),
      },
      imgKey: currentKeys.imgKey,
      subKey: currentKeys.subKey,
      timestampSeconds: Math.floor(now() / 1_000),
    });
    const url = new URL(SEARCH_URL);
    for (const [key, value] of Object.entries(signed)) url.searchParams.set(key, value);
    const payload = await fetchJson(url, signal);
    const code = recordNumber(payload, 'code');
    if (code === -403) {
      throw new BilibiliFailure(failure('invalid_response', 'Bilibili rejected the WBI signature.', true), true);
    }
    if (code === -352 || containsVoucher(payload)) {
      throw new BilibiliFailure(failure('risk_control', 'Bilibili risk control rejected the request.', true));
    }
    if (code === -429) {
      throw new BilibiliFailure(failure('rate_limited', 'Bilibili rate limited the request.', true));
    }
    if (code !== 0) {
      throw new BilibiliFailure(failure('invalid_response', 'Bilibili returned an unsuccessful response.', false));
    }
    const data = recordValue(payload, 'data');
    return recordValue(data, 'result') ?? [];
  }

  async function resolveKeys(signal: AbortSignal, force: boolean): Promise<WbiKeys> {
    if (!force && keys && keys.expiresAt > now()) return keys;
    const payload = await fetchJson(new URL(NAV_URL), signal);
    if (recordNumber(payload, 'code') !== 0) {
      throw new BilibiliFailure(failure('invalid_response', 'Bilibili WBI key response was invalid.', true));
    }
    const data = recordValue(payload, 'data');
    const wbiImage = recordValue(data, 'wbi_img');
    const imgKey = fileKey(recordString(wbiImage, 'img_url'));
    const subKey = fileKey(recordString(wbiImage, 'sub_url'));
    if (!imgKey || !subKey) {
      throw new BilibiliFailure(failure('invalid_response', 'Bilibili WBI keys were missing.', true));
    }
    keys = { imgKey, subKey, expiresAt: now() + keyTtlMs };
    return keys;
  }

  async function fetchJson(url: URL, signal: AbortSignal): Promise<unknown> {
    if (signal.aborted) throw new BilibiliFailure(failure('cancelled', 'Bilibili request was cancelled.', false));
    const controller = new AbortController();
    let timedOut = false;
    const cancel = () => controller.abort(signal.reason);
    signal.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error('Bilibili request timeout'));
    }, timeoutMs);
    try {
      const response = await fetchImplementation(url, {
        method: 'GET',
        headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 Megumi/0.1' },
        signal: controller.signal,
      });
      if (response.status === 412) {
        throw new BilibiliFailure(failure('risk_control', 'Bilibili risk control rejected the request.', true));
      }
      if (response.status === 429) {
        throw new BilibiliFailure(failure('rate_limited', 'Bilibili rate limited the request.', true));
      }
      if (!response.ok) {
        throw new BilibiliFailure(failure('invalid_response', `Bilibili returned HTTP ${response.status}.`, response.status >= 500));
      }
      try {
        return await response.json();
      } catch {
        throw new BilibiliFailure(failure('invalid_response', 'Bilibili returned invalid JSON.', false));
      }
    } catch (error) {
      if (error instanceof BilibiliFailure) throw error;
      if (signal.aborted) throw new BilibiliFailure(failure('cancelled', 'Bilibili request was cancelled.', false));
      if (timedOut) throw new BilibiliFailure(failure('timeout', 'Bilibili request timed out.', true));
      throw new BilibiliFailure(failure('network_error', 'Bilibili network request failed.', true));
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
    }
  }

  return source;
}

function normalizeSearchItems(value: unknown) {
  if (!Array.isArray(value)) {
    throw new BilibiliFailure(failure('invalid_response', 'Bilibili search results were invalid.', false));
  }
  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const bvid = optionalString(entry.bvid);
    const title = decodeHtmlText(optionalString(entry.title) ?? '');
    if (!bvid || !title) return [];
    const publishedSeconds = nonnegativeInteger(entry.pubdate);
    const engagement = {
      ...(nonnegativeInteger(entry.play) !== undefined ? { viewCount: nonnegativeInteger(entry.play) } : {}),
      ...(nonnegativeInteger(entry.favorites) !== undefined ? { favoriteCount: nonnegativeInteger(entry.favorites) } : {}),
      ...(nonnegativeInteger(entry.like) !== undefined ? { likeCount: nonnegativeInteger(entry.like) } : {}),
      ...(nonnegativeInteger(entry.review) !== undefined ? { commentCount: nonnegativeInteger(entry.review) } : {}),
    };
    const coverUrl = normalizeCoverUrl(optionalString(entry.pic));
    return [SourceContentSchema.parse({
      sourceId: 'bilibili',
      sourceName: '哔哩哔哩',
      sourceContentId: bvid,
      canonicalUrl: `https://www.bilibili.com/video/${bvid}`,
      contentType: 'video',
      title,
      ...(optionalString(entry.author) ? { author: optionalString(entry.author) } : {}),
      ...(publishedSeconds !== undefined ? { publishedAt: new Date(publishedSeconds * 1_000).toISOString() } : {}),
      ...(optionalString(entry.description) ? { description: optionalString(entry.description) } : {}),
      ...(coverUrl ? { coverUrl } : {}),
      ...(Object.keys(engagement).length ? { engagement } : {}),
    })];
  });
}

function normalizeFailure(error: unknown, signal: AbortSignal): SourceFailure {
  if (error instanceof BilibiliFailure) return error.failure;
  if (signal.aborted) return failure('cancelled', 'Bilibili request was cancelled.', false);
  return failure('network_error', 'Bilibili request failed.', true);
}

function failure(code: SourceFailure['code'], message: string, retryable: boolean): SourceFailure {
  return { code, message, retryable };
}

function fileKey(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const filename = value.split('/').at(-1);
  return filename?.split('.')[0] || undefined;
}

function containsVoucher(value: unknown): boolean {
  return isRecord(value) && ('v_voucher' in value || Object.values(value).some(containsVoucher));
}

function decodeHtmlText(value: string): string {
  return value.replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, ' ').trim();
}

function normalizeCoverUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value.startsWith('//')) return `https:${value}`;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function nonnegativeInteger(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isInteger(number) && number >= 0 ? number : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recordValue(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function recordNumber(value: unknown, key: string): number | undefined {
  const entry = recordValue(value, key);
  return typeof entry === 'number' ? entry : undefined;
}

function recordString(value: unknown, key: string): string | undefined {
  return optionalString(recordValue(value, key));
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
