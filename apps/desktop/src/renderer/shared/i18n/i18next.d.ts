/* Augments i18next with the canonical Desktop source-resource shape. */
import 'i18next';
import type { RendererResources } from './resources';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    resources: RendererResources;
    returnNull: false;
  }
}
