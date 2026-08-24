/* Desktop IPC handlers for daily discovery, interests, and recommendation state. */
import {
  DiscoveryDailyEnsureResultSchema,
  DiscoveryConfigurationUiDtoSchema,
  BrowserSourceConnectionViewSchema,
  BrowserSourcePairingViewSchema,
  DiscoveryHomeUiResultSchema,
  DiscoveryInterestUiDtoSchema,
  DiscoveryRecommendationSearchUiResultSchema,
  DiscoveryRecommendationUiDtoSchema,
  DiscoverySessionParticipationUiDtoSchema,
  type ProductHostInterface,
} from '@megumi/product-host/host';
import type { DesktopRuntimeLogger as ProductRuntimeLogger } from '../../runtime-logger';
import { electronIpcMain, type DesktopIpcMain } from '../../adapters/electron-ipc-main-adapter';
import { createIpcRequestHandler } from '../create-request-handler';
import { IPC_CHANNELS } from '../channels';
import type { RuntimeIpcError } from '../contracts';
import {
  DiscoveryDailyEnsureRequestSchema,
  DiscoveryConfigurationGetRequestSchema,
  DiscoveryConfigurationUpdateRequestSchema,
  BrowserSourceConnectionGetRequestSchema,
  BrowserSourcePairingBeginRequestSchema,
  BrowserSourceConnectionRevokeRequestSchema,
  DiscoveryHomeRequestSchema,
  DiscoveryInterestChangeRequestSchema,
  DiscoveryRecommendationSearchRequestSchema,
  DiscoveryRecommendationStateRequestSchema,
  DiscoverySessionParticipationRequestSchema,
} from '../schemas';

export interface DiscoveryHandlersService {
  host: Pick<ProductHostInterface, 'discovery' | 'browserSource'>;
}

export interface RegisterDiscoveryHandlersOptions {
  logger?: ProductRuntimeLogger;
  ipcMain?: DesktopIpcMain;
}

export function registerDiscoveryHandlers(
  service: DiscoveryHandlersService,
  options: RegisterDiscoveryHandlersOptions = {},
): void {
  const ipcMain = options.ipcMain ?? electronIpcMain;

  ipcMain.handle(IPC_CHANNELS.discovery.configurationGet, createIpcRequestHandler({
    channel: IPC_CHANNELS.discovery.configurationGet,
    requestSchema: DiscoveryConfigurationGetRequestSchema,
    responseSchema: DiscoveryConfigurationUiDtoSchema,
    responseValidation: 'dev-only',
    logger: options.logger,
    handle: () => service.host.discovery.getConfiguration(),
    mapError: mapDiscoveryIpcError,
  }));
  ipcMain.handle(IPC_CHANNELS.discovery.configurationUpdate, createIpcRequestHandler({
    channel: IPC_CHANNELS.discovery.configurationUpdate,
    requestSchema: DiscoveryConfigurationUpdateRequestSchema,
    responseSchema: DiscoveryConfigurationUiDtoSchema,
    responseValidation: 'dev-only',
    logger: options.logger,
    handle: (request) => service.host.discovery.updateConfiguration(request.payload),
    mapError: mapDiscoveryIpcError,
  }));
  ipcMain.handle(IPC_CHANNELS.browserSource.connectionGet, createIpcRequestHandler({
    channel: IPC_CHANNELS.browserSource.connectionGet,
    requestSchema: BrowserSourceConnectionGetRequestSchema,
    responseSchema: BrowserSourceConnectionViewSchema,
    responseValidation: 'dev-only',
    logger: options.logger,
    handle: () => service.host.browserSource.getConnection(),
    mapError: mapDiscoveryIpcError,
  }));
  ipcMain.handle(IPC_CHANNELS.browserSource.pairingBegin, createIpcRequestHandler({
    channel: IPC_CHANNELS.browserSource.pairingBegin,
    requestSchema: BrowserSourcePairingBeginRequestSchema,
    responseSchema: BrowserSourcePairingViewSchema,
    responseValidation: 'dev-only',
    logger: options.logger,
    handle: () => service.host.browserSource.beginPairing(),
    mapError: mapDiscoveryIpcError,
  }));
  ipcMain.handle(IPC_CHANNELS.browserSource.connectionRevoke, createIpcRequestHandler({
    channel: IPC_CHANNELS.browserSource.connectionRevoke,
    requestSchema: BrowserSourceConnectionRevokeRequestSchema,
    responseSchema: BrowserSourceConnectionViewSchema,
    responseValidation: 'dev-only',
    logger: options.logger,
    handle: () => service.host.browserSource.revokeConnection(),
    mapError: mapDiscoveryIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.discovery.interestChange, createIpcRequestHandler({
    channel: IPC_CHANNELS.discovery.interestChange,
    requestSchema: DiscoveryInterestChangeRequestSchema,
    responseSchema: DiscoveryInterestUiDtoSchema,
    responseValidation: 'dev-only',
    logger: options.logger,
    handle: (request) => service.host.discovery.changeInterest(request.payload),
    mapError: mapDiscoveryIpcError,
  }));
  ipcMain.handle(IPC_CHANNELS.discovery.sessionParticipationSet, createIpcRequestHandler({
    channel: IPC_CHANNELS.discovery.sessionParticipationSet,
    requestSchema: DiscoverySessionParticipationRequestSchema,
    responseSchema: DiscoverySessionParticipationUiDtoSchema,
    responseValidation: 'dev-only',
    logger: options.logger,
    handle: (request) => service.host.discovery.setSessionParticipation(request.payload),
    mapError: mapDiscoveryIpcError,
  }));
  ipcMain.handle(IPC_CHANNELS.discovery.dailyEnsure, createIpcRequestHandler({
    channel: IPC_CHANNELS.discovery.dailyEnsure,
    requestSchema: DiscoveryDailyEnsureRequestSchema,
    responseSchema: DiscoveryDailyEnsureResultSchema,
    responseValidation: 'dev-only',
    logger: options.logger,
    handle: (request) => service.host.discovery.ensureDaily(request.payload),
    mapError: mapDiscoveryIpcError,
  }));
  ipcMain.handle(IPC_CHANNELS.discovery.homeGet, createIpcRequestHandler({
    channel: IPC_CHANNELS.discovery.homeGet,
    requestSchema: DiscoveryHomeRequestSchema,
    responseSchema: DiscoveryHomeUiResultSchema,
    responseValidation: 'dev-only',
    logger: options.logger,
    handle: (request) => service.host.discovery.getHome(request.payload),
    mapError: mapDiscoveryIpcError,
  }));
  ipcMain.handle(IPC_CHANNELS.discovery.recommendationsSearch, createIpcRequestHandler({
    channel: IPC_CHANNELS.discovery.recommendationsSearch,
    requestSchema: DiscoveryRecommendationSearchRequestSchema,
    responseSchema: DiscoveryRecommendationSearchUiResultSchema,
    responseValidation: 'dev-only',
    logger: options.logger,
    handle: (request) => service.host.discovery.searchRecommendations(request.payload),
    mapError: mapDiscoveryIpcError,
  }));
  ipcMain.handle(IPC_CHANNELS.discovery.recommendationStateUpdate, createIpcRequestHandler({
    channel: IPC_CHANNELS.discovery.recommendationStateUpdate,
    requestSchema: DiscoveryRecommendationStateRequestSchema,
    responseSchema: DiscoveryRecommendationUiDtoSchema,
    responseValidation: 'dev-only',
    logger: options.logger,
    handle: (request) => service.host.discovery.updateRecommendationState(request.payload),
    mapError: mapDiscoveryIpcError,
  }));
}

function mapDiscoveryIpcError(): RuntimeIpcError {
  return {
    code: 'ipc_handler_failed',
    message: 'Discovery service failed.',
  };
}
