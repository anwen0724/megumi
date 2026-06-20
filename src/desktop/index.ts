// Public exports for tests that verify desktop boundaries.
export { createDesktopAppApi } from './composition/create-app-api';
export { createHostAdapters } from './composition/create-host-adapters';
export { createLocalDesktopRuntime } from './composition/create-local-runtime';
export { createMegumiRendererApi } from './preload/megumi-api';
export type { MegumiRendererApi, RendererChatStreamEventDto, RendererRuntimeEventDto } from '../shared/renderer-contracts/renderer-api';
