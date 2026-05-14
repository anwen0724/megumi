import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@megumi/shared/ipc-channels';
import type { ChatRuntimeRequest } from '@megumi/shared/chat-contracts';
import type { RuntimeIpcError } from '@megumi/shared/ipc-errors';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';
import {
  ChatCancelRequestSchema,
  ChatStartRequestSchema,
} from '@megumi/shared/ipc-schemas';
import type { ProviderId } from '@megumi/shared/provider-contracts';
import { createAiChatService } from '@megumi/desktop/main/services/ai-chat.service';
import { MegumiHomeConfigService } from '@megumi/desktop/main/services/megumi-home-config.service';
import { initializeElectronMegumiHomeSync } from '@megumi/desktop/main/services/megumi-home.service';
import { ProviderRuntimeService } from '@megumi/desktop/main/services/provider-runtime.service';
import { getDefaultProviderService } from './provider.handler';
import { createElectronSecretStoreService } from '@megumi/desktop/main/services/secret-store.service';
import { createRuntimeIpcHandler } from '../runtime-ipc-handler';
import { forwardRuntimeEvents } from '../runtime-event-forwarder';
import type { RuntimeLogger } from '../../services/runtime-logger.service';

export interface ChatHandlersService {
  streamChat(request: ChatRuntimeRequest): AsyncIterable<RuntimeEvent>;
  cancelChat(requestId: string): boolean;
}

export interface RegisterChatHandlersOptions {
  logger?: RuntimeLogger;
}

let defaultChatService: ChatHandlersService | null = null;

export function registerChatHandlers(
  service = getDefaultChatService(),
  options: RegisterChatHandlersOptions = {},
): void {
  ipcMain.handle(
    IPC_CHANNELS.chat.start,
    createRuntimeIpcHandler({
      channel: IPC_CHANNELS.chat.start,
      requestSchema: ChatStartRequestSchema,
      logger: options.logger,
      handle: async (request, event, context) => {
        const runtimeRequest: ChatRuntimeRequest = {
          ...request.payload,
          requestId: request.requestId,
          runtimeContext: context,
        };
        const stream = service.streamChat(runtimeRequest);

        void forwardRuntimeEvents(event.sender, stream, { logger: options.logger });

        return {
          requestId: request.requestId,
        };
      },
      mapError: mapChatIpcError,
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.chat.cancel,
    createRuntimeIpcHandler({
      channel: IPC_CHANNELS.chat.cancel,
      requestSchema: ChatCancelRequestSchema,
      logger: options.logger,
      handle: async (request) => ({
        cancelled: service.cancelChat(request.payload.targetRequestId),
      }),
      mapError: mapChatIpcError,
    }),
  );
}

function mapChatIpcError(): RuntimeIpcError {
  return {
    code: 'ipc_handler_failed',
    message: 'Chat service failed.',
    severity: 'error',
    retryable: true,
    source: 'main',
  };
}

export function getDefaultChatService(): ChatHandlersService {
  if (!defaultChatService) {
    const providerSettings = getDefaultProviderService();
    const homePaths = initializeElectronMegumiHomeSync();
    const secretStore = createElectronSecretStoreService(homePaths.homePath);
    const configCredentials = {
      async getProviderApiKeyEnv(providerId: ProviderId) {
        return new MegumiHomeConfigService({ configPath: homePaths.configPath }).getProviderApiKeyEnv(providerId);
      },
      async getPlaintextProviderApiKey(providerId: ProviderId) {
        return new MegumiHomeConfigService({ configPath: homePaths.configPath }).getPlaintextProviderApiKey(providerId);
      },
    };
    const resolver = new ProviderRuntimeService({
      settings: providerSettings,
      secretStore,
      configCredentials,
    });

    defaultChatService = createAiChatService(resolver);
  }

  return defaultChatService;
}
