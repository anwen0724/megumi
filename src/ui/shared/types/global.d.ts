// Declares the preload bridge available to the migrated renderer UI.
import type { MegumiRendererApi } from '../../../desktop/dto/renderer-api';

declare global {
  interface Window {
    megumi: MegumiRendererApi;
  }
}

export {};
