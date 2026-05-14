import type { RuntimeEvent } from '@megumi/shared/runtime-events';
import type { MegumiAPI } from '../../preload/types';

declare global {
  interface Window {
    megumi: MegumiAPI & {
      runtime: {
        onEvent(callback: (event: RuntimeEvent) => void): () => void;
      };
    };
  }
}
