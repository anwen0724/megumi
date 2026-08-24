/* Defines the Douyin source through the shared browser task gateway. */
import type { BrowserSourceTaskGateway } from '../browser-sources/browser-source-contracts';
import { createBrowserSource } from '../browser-sources/browser-source';

export function createDouyinSource(input: { readonly gateway: BrowserSourceTaskGateway }) {
  return createBrowserSource({ sourceId: 'douyin', name: '抖音', gateway: input.gateway });
}
