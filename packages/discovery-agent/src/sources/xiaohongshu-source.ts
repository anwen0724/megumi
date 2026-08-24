/* Defines the Xiaohongshu source through the shared browser task gateway. */
import type { BrowserSourceTaskGateway } from '../browser-sources/browser-source-contracts';
import { createBrowserSource } from '../browser-sources/browser-source';

export function createXiaohongshuSource(input: { readonly gateway: BrowserSourceTaskGateway }) {
  return createBrowserSource({ sourceId: 'xiaohongshu', name: '小红书', gateway: input.gateway });
}
