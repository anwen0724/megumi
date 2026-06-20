// Compatibility re-export for desktop code while shared renderer contracts own window.megumi types.
export type {
  MegumiRendererApi,
  RendererChatStreamEventDto,
  RendererIpcFailure,
  RendererIpcRequest,
  RendererIpcResult,
  RendererIpcSuccess,
  RendererRuntimeEventDto,
  RendererUnsubscribe,
} from '../../shared/renderer-contracts/renderer-api';
