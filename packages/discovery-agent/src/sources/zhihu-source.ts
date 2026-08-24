/* Defines the Zhihu source through the shared browser task gateway. */
import type { BrowserSourceTaskGateway } from '../browser-sources/browser-source-contracts';
import { createBrowserSource } from '../browser-sources/browser-source';

export function createZhihuSource(input: { readonly gateway: BrowserSourceTaskGateway }) {
  return createBrowserSource({ sourceId: 'zhihu', name: '知乎', gateway: input.gateway });
}
