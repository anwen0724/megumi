/*
 * Owns the production catalog of Megumi's built-in Discovery Sources.
 */
import type { WebFetch, WebSearch } from '@megumi/tools';
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
}) {
  return createSourceRegistry([
    createBilibiliSource(),
    createOpenWebSource({ webSearch: input.webSearch, webFetch: input.webFetch }),
    createXiaohongshuSource({ browser: input.embeddedBrowser }),
    createDouyinSource({ browser: input.embeddedBrowser }),
    createZhihuSource({ accessSecret: input.zhihuAccessSecret ?? (() => undefined) }),
    createTwitterSource({ apiKey: input.twitterApiKey ?? (() => undefined) }),
  ]);
}
