/* Desktop IPC handlers for Discovery interests and Candidate Supply configuration. */
import {
  DiscoveryInterestListResultSchema,
  DiscoveryInterestChangeResultSchema,
  SupplyConfigurationViewSchema,
  SupplyConfirmResultSchema,
  type ApplicationOperations,
} from '@megumi/application/contracts';
import type { DesktopRuntimeLogger as ApplicationLogger } from '../../runtime-logger';
import { electronIpcMain, type DesktopIpcMain } from '../../adapters/electron-ipc-main-adapter';
import { createIpcRequestHandler } from '../create-request-handler';
import { IPC_CHANNELS } from '../channels';
import type { RuntimeIpcError } from '../contracts';
import {
  DiscoveryInterestListRequestSchema,
  DiscoveryInterestChangeRequestSchema,
  DiscoveryConfigurationGetRequestSchema,
  DiscoveryConfigurationUpdateRequestSchema,
  DiscoveryCandidateSupplyConfirmRequestSchema,
} from '../schemas';

export interface DiscoveryHandlersService {
  host: Pick<ApplicationOperations, 'discovery'>;
}

export interface RegisterDiscoveryHandlersOptions {
  logger?: ApplicationLogger;
  ipcMain?: DesktopIpcMain;
}

export function registerDiscoveryHandlers(
  service: DiscoveryHandlersService,
  options: RegisterDiscoveryHandlersOptions = {},
): void {
  const ipcMain = options.ipcMain ?? electronIpcMain;

  ipcMain.handle(
    IPC_CHANNELS.discovery.interestList,
    createIpcRequestHandler({
      channel: IPC_CHANNELS.discovery.interestList,
      requestSchema: DiscoveryInterestListRequestSchema,
      responseSchema: DiscoveryInterestListResultSchema,
      responseValidation: 'dev-only',
      logger: options.logger,
      handle: () => service.host.discovery.listInterests(),
      mapError: mapDiscoveryIpcError,
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.discovery.interestChange,
    createIpcRequestHandler({
      channel: IPC_CHANNELS.discovery.interestChange,
      requestSchema: DiscoveryInterestChangeRequestSchema,
      responseSchema: DiscoveryInterestChangeResultSchema,
      responseValidation: 'dev-only',
      logger: options.logger,
      handle: (request) => service.host.discovery.changeInterest(request.payload),
      mapError: mapDiscoveryIpcError,
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.discovery.configurationGet,
    createIpcRequestHandler({
      channel: IPC_CHANNELS.discovery.configurationGet,
      requestSchema: DiscoveryConfigurationGetRequestSchema,
      responseSchema: SupplyConfigurationViewSchema,
      responseValidation: 'dev-only',
      logger: options.logger,
      handle: () => service.host.discovery.getConfiguration(),
      mapError: mapDiscoveryIpcError,
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.discovery.configurationUpdate,
    createIpcRequestHandler({
      channel: IPC_CHANNELS.discovery.configurationUpdate,
      requestSchema: DiscoveryConfigurationUpdateRequestSchema,
      responseSchema: SupplyConfigurationViewSchema,
      responseValidation: 'dev-only',
      logger: options.logger,
      handle: (request) => service.host.discovery.updateConfiguration(request.payload),
      mapError: mapDiscoveryIpcError,
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.discovery.candidateSupplyConfirm,
    createIpcRequestHandler({
      channel: IPC_CHANNELS.discovery.candidateSupplyConfirm,
      requestSchema: DiscoveryCandidateSupplyConfirmRequestSchema,
      responseSchema: SupplyConfirmResultSchema,
      logger: options.logger,
      handle: () => service.host.discovery.confirmCandidateSupply(),
      mapError: mapDiscoveryIpcError,
    }),
  );
}

function mapDiscoveryIpcError(): RuntimeIpcError {
  return {
    code: 'ipc_handler_failed',
    message: 'Discovery service failed.',
  };
}
