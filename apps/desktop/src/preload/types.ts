import type { RuntimeEvent } from '@megumi/shared/runtime-events';
import type { api } from './api';

export type MegumiAPI = typeof api & {
  runtime: {
    onEvent(callback: (event: RuntimeEvent) => void): () => void;
  };
};
