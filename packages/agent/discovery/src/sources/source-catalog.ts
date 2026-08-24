/* Owns the one production catalog of Megumi's built-in discovery sources. */
import type { WebFetch, WebSearch } from '@megumi/tools';
import type { BrowserSourceTaskGateway } from '../browser-sources/browser-source-contracts';
import { createBilibiliSource } from './bilibili-source';
import { createDouyinSource } from './douyin-source';
import { createOpenWebSource } from './open-web-source';
import { createSourceRegistry } from './source-registry';
import { createXiaohongshuSource } from './xiaohongshu-source';
import { createZhihuSource } from './zhihu-source';

export const DISCOVERY_SOURCE_IDS = ['bilibili', 'open_web', 'xiaohongshu', 'douyin', 'zhihu'] as const;

export function createDiscoverySourceRegistry(input: {
  readonly webSearch?: WebSearch;
  readonly webFetch?: WebFetch;
  readonly browserGateway: BrowserSourceTaskGateway;
}) {
  return createSourceRegistry([
    createBilibiliSource(),
    createOpenWebSource({ webSearch: input.webSearch, webFetch: input.webFetch }),
    createXiaohongshuSource({ gateway: input.browserGateway }),
    createDouyinSource({ gateway: input.browserGateway }),
    createZhihuSource({ gateway: input.browserGateway }),
  ]);
}
