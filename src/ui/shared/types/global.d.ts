import type { MegumiAPI } from '../../../preload/types';

declare global {
  interface Window {
    megumi: MegumiAPI;
  }
}
