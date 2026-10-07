/*
 * Desktop IPC handlers for Discovery interests and Candidate Supply configuration.
 */
import { DiscoveryInterestListResultSchema, DiscoveryInterestChangeResultSchema, SupplyConfigurationViewSchema, SupplyConfirmResultSchema, SourceAccessViewSchema, SourceLoginResultSchema, DailyFeedViewSchema, StartDailyFeedResultSchema, RecommendationRunViewSchema, CancelRunResultSchema, type ApplicationOperations, } from '@megumi/application/contracts';
import type { DesktopRuntimeLogger as ApplicationLogger } from '../../runtime-logger';
import { electronIpcMain, type DesktopIpcMain } from '../../adapters/electron-ipc-main-adapter';
import { createIpcRequestHandler } from '../create-request-handler';
import { IPC_CHANNELS } from '../channels';
import { RuntimeIpcErrorSchema } from '../errors';
import type { RuntimeIpcError } from '../contracts';
import { DiscoveryInterestListRequestSchema, DiscoveryInterestChangeRequestSchema, DiscoveryConfigurationGetRequestSchema, DiscoveryConfigurationUpdateRequestSchema, DiscoveryCandidateSupplyConfirmRequestSchema, SourceLoginRequestSchema, SourceAccessCheckRequestSchema, DailyFeedListRequestSchema, DailyFeedStartRequestSchema, RecommendationRunRequestSchema, RecommendationCancelRequestSchema, } from '../schemas';
export interface DiscoveryHandlersService {
  host: Pick<ApplicationOperations, 'discovery'>;
}
export interface RegisterDiscoveryHandlersOptions {
  logger?: ApplicationLogger;
  ipcMain?: DesktopIpcMain;
}
export function registerDiscoveryHandlers(service: DiscoveryHandlersService, options: RegisterDiscoveryHandlersOptions = {}): void {
  const ipcMain = options.ipcMain ?? electronIpcMain;
  ipcMain.handle(IPC_CHANNELS.recommendation.listDailyFeed, createIpcRequestHandler({ channel: IPC_CHANNELS.recommendation.listDailyFeed, requestSchema: DailyFeedListRequestSchema, responseSchema: DailyFeedViewSchema, logger: options.logger, handle: request => service.host.discovery.listDailyFeed(request.payload), mapError: mapRecommendationError }));
  ipcMain.handle(IPC_CHANNELS.recommendation.startDailyFeed, createIpcRequestHandler({ channel: IPC_CHANNELS.recommendation.startDailyFeed, requestSchema: DailyFeedStartRequestSchema, responseSchema: StartDailyFeedResultSchema, logger: options.logger, handle: request => service.host.discovery.startDailyFeed(request.payload), mapError: mapRecommendationError }));
  ipcMain.handle(IPC_CHANNELS.recommendation.getRun, createIpcRequestHandler({ channel: IPC_CHANNELS.recommendation.getRun, requestSchema: RecommendationRunRequestSchema, responseSchema: RecommendationRunViewSchema.optional(), logger: options.logger, handle: request => service.host.discovery.getRun(request.payload), mapError: mapRecommendationError }));
  ipcMain.handle(IPC_CHANNELS.recommendation.cancelRun, createIpcRequestHandler({ channel: IPC_CHANNELS.recommendation.cancelRun, requestSchema: RecommendationCancelRequestSchema, responseSchema: CancelRunResultSchema, logger: options.logger, handle: request => service.host.discovery.cancelRun(request.payload), mapError: mapRecommendationError }));
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
  ipcMain.handle(IPC_CHANNELS.discovery.sourceLogin, createIpcRequestHandler({
    channel: IPC_CHANNELS.discovery.sourceLogin, requestSchema: SourceLoginRequestSchema, responseSchema: SourceLoginResultSchema,
    logger: options.logger, handle: (request) => service.host.discovery.openSourceLogin(request.payload), mapError: mapDiscoveryIpcError,
  }));
  ipcMain.handle(IPC_CHANNELS.discovery.sourceAccess, createIpcRequestHandler({
    channel: IPC_CHANNELS.discovery.sourceAccess, requestSchema: SourceAccessCheckRequestSchema, responseSchema: SourceAccessViewSchema,
    logger: options.logger, handle: (request) => service.host.discovery.checkSourceAccess(request.payload), mapError: mapDiscoveryIpcError,
  }));
}
function mapDiscoveryIpcError(): RuntimeIpcError {
  return {
    code: 'ipc_handler_failed',
    message: 'Discovery service failed.',
  };
}
function mapRecommendationError(error: unknown): RuntimeIpcError {
  const parsed = RuntimeIpcErrorSchema.safeParse(error instanceof Error ? { code: 'code' in error ? error.code : 'STORAGE_ERROR', message: error.message } : error);
  return parsed.success ? parsed.data : { code: 'STORAGE_ERROR', message: 'Recommendation request failed.' };
}
