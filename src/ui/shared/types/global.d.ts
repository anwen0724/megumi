import type { MegumiRendererApi } from '../../../desktop/dto/renderer-api';

declare global {
  interface Window {
    megumi: MegumiRendererApi;
  }
}
