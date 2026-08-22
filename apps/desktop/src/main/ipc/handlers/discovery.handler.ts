/* Desktop IPC handlers for daily discovery, interests, and recommendation state. */
import {
  DiscoveryDailyEnsureResultSchema,
  DiscoveryHomeUiResultSchema,
  DiscoveryInterestUiDtoSchema,
  DiscoveryRecommendationSearchUiResultSchema,
  DiscoveryRecommendationUiDtoSchema,
  DiscoverySessionParticipationUiDtoSchema,
  type ProductHostInterface,
} from '@megumi/product/host';
import type { ProductRuntimeLogger } from '@megumi/product';
import { electronIpcMain, type DesktopIpcMain } from '../../adapters/electron-ipc-main-adapter';
import { createIpcRequestHandler } from '../create-request-handler';
import { IPC_CHANNELS } from '../channels';
import type { RuntimeIpcError } from '../contracts';
import {
  DiscoveryDailyEnsureRequestSchema,
  DiscoveryHomeRequestSchema,
  DiscoveryInterestChangeRequestSchema,
  DiscoveryRecommendationSearchRequestSchema,
  DiscoveryRecommendationStateRequestSchema,
  DiscoverySessionParticipationRequestSchema,
} from '../schemas';

export interface DiscoveryHandlersService {
  host: Pick<ProductHostInterface, 'discovery'>;
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
