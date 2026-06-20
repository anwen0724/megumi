// Declares the preload bridge available to the migrated renderer UI.
import type { MegumiRendererApi } from '../../../shared/renderer-contracts';

declare global {
  interface Window {
    megumi: MegumiRendererApi;
  }
}

export {};
