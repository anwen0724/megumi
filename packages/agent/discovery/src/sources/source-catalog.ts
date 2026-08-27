/*
 * Owns the production catalog of Megumi's built-in Discovery Sources.
 */
import {
  createBingRssWebSearch,
  createFallbackWebSearch,
  type WebFetch,
  type WebSearch,
} from '@megumi/tools';
import type { Observability } from '@megumi/observability';
import type { EmbeddedBrowser } from './embedded-browser';
import { createBilibiliSource } from './bilibili-source';
import { createDouyinSource } from './douyin-source';
import { createOpenWebSource } from './open-web-source';
import { createSourceRegistry } from './source-registry';
import { createXiaohongshuSource } from './xiaohongshu-source';
import { createZhihuSource } from './zhihu-source';
import { createTwitterSource } from './twitter-source';

export const DISCOVERY_SOURCE_IDS = [
  'bilibili', 'open_web', 'xiaohongshu', 'douyin', 'zhihu', 'twitter',
] as const;

/** Creates Megumi's production Source catalog and returns its validated registry. */
export function createDiscoverySourceRegistry(input: {
  readonly webSearch?: WebSearch | (() => WebSearch | undefined);
  readonly webFetch?: WebFetch;
  readonly embeddedBrowser: EmbeddedBrowser;
  readonly zhihuAccessSecret?: () => string | undefined;
  readonly twitterApiKey?: () => string | undefined;
  readonly observability?: Observability;
  readonly onCheckError?: (error: unknown, sourceId: string) => void;
}) {
  const configuredWebSearch = deferredWebSearch(input.webSearch);
  const bingWebSearch = createBingRssWebSearch();
  return createSourceRegistry([
    createBilibiliSource(),
    createOpenWebSource({
      webSearch: createFallbackWebSearch([configuredWebSearch, bingWebSearch]),
      webFetch: input.webFetch,
      provider: () => resolveWebSearch(input.webSearch) ? undefined : 'Bing',
    }),
    createXiaohongshuSource({ browser: input.embeddedBrowser }),
    createDouyinSource({ browser: input.embeddedBrowser }),
    createZhihuSource({ accessSecret: input.zhihuAccessSecret ?? (() => undefined) }),
    createTwitterSource({ apiKey: input.twitterApiKey ?? (() => undefined) }),
  ], {
    observability: input.observability,
    ...(input.onCheckError ? { onCheckError: input.onCheckError } : {}),
  });
}

/** Resolves mutable Host settings for every request without weakening the fallback chain. */
function deferredWebSearch(input: WebSearch | (() => WebSearch | undefined) | undefined): WebSearch {
  return {
    async search(request) {
      const configured = resolveWebSearch(input);
      return configured
        ? configured.search(request)
        : { query: request.query.trim(), results: [] };
    },
  };
}

function resolveWebSearch(input: WebSearch | (() => WebSearch | undefined) | undefined): WebSearch | undefined {
  return typeof input === 'function' ? input() : input;
}
