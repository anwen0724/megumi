/*
 * Validates the Desktop Recommendation IPC boundary and delegates to its Product Host.
 */
import * as host from '@megumi/application/contracts';
import type { DesktopRuntimeLogger } from '../../runtime-logger';
import { electronIpcMain, type DesktopIpcMain } from '../../adapters/electron-ipc-main-adapter';
import { createIpcRequestHandler } from '../create-request-handler';
import { IPC_CHANNELS } from '../channels';
import { RuntimeIpcErrorSchema } from '../errors';
import type { RuntimeIpcError } from '../contracts';
import * as requests from '../schemas';
export interface DiscoveryHandlersService { host: Pick<host.ApplicationOperations, 'recommendation'> }
export interface RegisterDiscoveryHandlersOptions { logger?: DesktopRuntimeLogger; ipcMain?: DesktopIpcMain }
/** Registers the complete typed recommendation surface; external failures remain explicit. */
export function registerDiscoveryHandlers(service: DiscoveryHandlersService, options: RegisterDiscoveryHandlersOptions = {}): void {
  const ipcMain = options.ipcMain ?? electronIpcMain;
  ipcMain.handle(IPC_CHANNELS.recommendation.interestList, createIpcRequestHandler({
    channel: IPC_CHANNELS.recommendation.interestList, requestSchema: requests.ListInterestsRequestSchema,
    responseSchema: host.InterestListResultSchema, logger: options.logger,
    handle: request => service.host.recommendation.listInterests(), mapError: mapRecommendationError,
  }));
  ipcMain.handle(IPC_CHANNELS.recommendation.createInterest, createIpcRequestHandler({
    channel: IPC_CHANNELS.recommendation.createInterest, requestSchema: requests.CreateInterestRequestSchema,
    responseSchema: host.CreateInterestResultSchema, logger: options.logger,
    handle: request => service.host.recommendation.createInterest(request.payload), mapError: mapRecommendationError,
  }));
  ipcMain.handle(IPC_CHANNELS.recommendation.updateInterest, createIpcRequestHandler({
    channel: IPC_CHANNELS.recommendation.updateInterest, requestSchema: requests.UpdateInterestRequestSchema,
    responseSchema: host.UpdateInterestResultSchema, logger: options.logger,
    handle: request => service.host.recommendation.updateInterest(request.payload), mapError: mapRecommendationError,
  }));
  ipcMain.handle(IPC_CHANNELS.recommendation.deleteInterest, createIpcRequestHandler({
    channel: IPC_CHANNELS.recommendation.deleteInterest, requestSchema: requests.DeleteInterestRequestSchema,
    responseSchema: host.DeleteInterestResultSchema, logger: options.logger,
    handle: request => service.host.recommendation.deleteInterest(request.payload), mapError: mapRecommendationError,
  }));
  ipcMain.handle(IPC_CHANNELS.recommendation.listDailyFeed, createIpcRequestHandler({
    channel: IPC_CHANNELS.recommendation.listDailyFeed, requestSchema: requests.ListDailyFeedRequestSchema,
    responseSchema: host.DailyFeedViewSchema, logger: options.logger,
    handle: request => service.host.recommendation.listDailyFeed(request.payload), mapError: mapRecommendationError,
  }));
  ipcMain.handle(IPC_CHANNELS.recommendation.getCuratedSelection, createIpcRequestHandler({
    channel: IPC_CHANNELS.recommendation.getCuratedSelection, requestSchema: requests.GetCuratedSelectionRequestSchema,
    responseSchema: host.CuratedSelectionViewSchema, logger: options.logger,
    handle: request => service.host.recommendation.getCuratedSelection(), mapError: mapRecommendationError,
  }));
  ipcMain.handle(IPC_CHANNELS.recommendation.listFavorites, createIpcRequestHandler({
    channel: IPC_CHANNELS.recommendation.listFavorites, requestSchema: requests.ListFavoritesRequestSchema,
    responseSchema: host.FavoritesViewSchema, logger: options.logger,
    handle: request => service.host.recommendation.listFavorites(request.payload), mapError: mapRecommendationError,
  }));
  ipcMain.handle(IPC_CHANNELS.recommendation.setFavorite, createIpcRequestHandler({
    channel: IPC_CHANNELS.recommendation.setFavorite, requestSchema: requests.SetFavoriteRequestSchema,
    responseSchema: host.SetFavoriteResultSchema, logger: options.logger,
    handle: request => service.host.recommendation.setFavorite(request.payload), mapError: mapRecommendationError,
  }));
  ipcMain.handle(IPC_CHANNELS.recommendation.startDailyFeed, createIpcRequestHandler({
    channel: IPC_CHANNELS.recommendation.startDailyFeed, requestSchema: requests.StartDailyFeedRequestSchema,
    responseSchema: host.StartDailyFeedResultSchema, logger: options.logger,
    handle: request => service.host.recommendation.startDailyFeed(request.payload), mapError: mapRecommendationError,
  }));
  ipcMain.handle(IPC_CHANNELS.recommendation.startCuratedSelection, createIpcRequestHandler({
    channel: IPC_CHANNELS.recommendation.startCuratedSelection, requestSchema: requests.StartCuratedSelectionRequestSchema,
    responseSchema: host.StartCuratedSelectionResultSchema, logger: options.logger,
    handle: request => service.host.recommendation.startCuratedSelection(request.payload), mapError: mapRecommendationError,
  }));
  ipcMain.handle(IPC_CHANNELS.recommendation.getRun, createIpcRequestHandler({
    channel: IPC_CHANNELS.recommendation.getRun, requestSchema: requests.GetRunRequestSchema,
    responseSchema: host.RecommendationRunViewSchema.optional(), logger: options.logger,
    handle: request => service.host.recommendation.getRun(request.payload), mapError: mapRecommendationError,
  }));
  ipcMain.handle(IPC_CHANNELS.recommendation.cancelRun, createIpcRequestHandler({
    channel: IPC_CHANNELS.recommendation.cancelRun, requestSchema: requests.CancelRunRequestSchema,
    responseSchema: host.CancelRunResultSchema, logger: options.logger,
    handle: request => service.host.recommendation.cancelRun(request.payload), mapError: mapRecommendationError,
  }));
  ipcMain.handle(IPC_CHANNELS.recommendation.configurationGet, createIpcRequestHandler({
    channel: IPC_CHANNELS.recommendation.configurationGet, requestSchema: requests.GetConfigurationRequestSchema,
    responseSchema: host.RecommendationConfigurationViewSchema, logger: options.logger,
    handle: request => service.host.recommendation.getConfiguration(), mapError: mapRecommendationError,
  }));
  ipcMain.handle(IPC_CHANNELS.recommendation.configurationUpdate, createIpcRequestHandler({
    channel: IPC_CHANNELS.recommendation.configurationUpdate, requestSchema: requests.UpdateConfigurationRequestSchema,
    responseSchema: host.RecommendationConfigurationViewSchema, logger: options.logger,
    handle: request => service.host.recommendation.updateConfiguration(request.payload), mapError: mapRecommendationError,
  }));
  ipcMain.handle(IPC_CHANNELS.recommendation.sourceLogin, createIpcRequestHandler({
    channel: IPC_CHANNELS.recommendation.sourceLogin, requestSchema: requests.OpenSourceLoginRequestSchema,
    responseSchema: host.SourceLoginResultSchema, logger: options.logger,
    handle: request => service.host.recommendation.openSourceLogin(request.payload), mapError: mapRecommendationError,
  }));
  ipcMain.handle(IPC_CHANNELS.recommendation.sourceAccess, createIpcRequestHandler({
    channel: IPC_CHANNELS.recommendation.sourceAccess, requestSchema: requests.CheckSourceAccessRequestSchema,
    responseSchema: host.SourceAccessViewSchema, logger: options.logger,
    handle: request => service.host.recommendation.checkSourceAccess(request.payload), mapError: mapRecommendationError,
  }));
  ipcMain.handle(IPC_CHANNELS.recommendation.openContent, createIpcRequestHandler({
    channel: IPC_CHANNELS.recommendation.openContent, requestSchema: requests.OpenContentRequestSchema,
    responseSchema: host.OpenContentResultSchema, logger: options.logger,
    handle: request => service.host.recommendation.openContent(request.payload), mapError: mapRecommendationError,
  }));
}
/** Preserves known product error codes; unclassified failures report storage failure. */
function mapRecommendationError(error: unknown): RuntimeIpcError {
  const parsed = RuntimeIpcErrorSchema.safeParse(error instanceof Error ? { code: 'code' in error ? error.code : 'STORAGE_ERROR', message: error.message } : error);
  return parsed.success ? parsed.data : { code: 'STORAGE_ERROR', message: 'Recommendation request failed.' };
}
