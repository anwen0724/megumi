/* Desktop IPC handlers for Discovery interests, Recommendation, and configuration. */
import {
  DiscoveryPreferenceDetailsResultSchema,
  DiscoveryPreferenceEvidenceResultSchema,
  DiscoveryPreferenceEditResultSchema,
  DiscoveryPreferenceDeleteResultSchema,
  DiscoveryRecommendationRequestResultSchema,
  DiscoveryCandidateSupplyConfirmResultSchema,
  DiscoveryConfigurationUiDtoSchema,
  DiscoveryHomeUiResultSchema,
  DiscoveryInterestUiDtoSchema,
  DiscoveryRecommendationSearchUiResultSchema,
  DiscoveryRecommendationStateResultSchema,
  DiscoveryInterestSessionSettingUiDtoSchema,
  DiscoverySourceUiDtoSchema,
  type ProductHostInterface,
} from '@megumi/product-host/host';
import type { DesktopRuntimeLogger as ProductRuntimeLogger } from '../../runtime-logger';
import { electronIpcMain, type DesktopIpcMain } from '../../adapters/electron-ipc-main-adapter';
import { createIpcRequestHandler } from '../create-request-handler';
import { IPC_CHANNELS } from '../channels';
import type { RuntimeIpcError } from '../contracts';
import {
  DiscoveryPreferenceDetailsRequestSchema,
  DiscoveryPreferenceEvidenceRequestSchema,
  DiscoveryPreferenceEditRequestSchema,
  DiscoveryPreferenceDeleteRequestSchema,
  DiscoveryRecommendationRequestSchema,
  DiscoveryCandidateSupplyConfirmRequestSchema,
  DiscoveryConfigurationGetRequestSchema,
  DiscoveryConfigurationUpdateRequestSchema,
  DiscoveryHomeRequestSchema,
  DiscoveryInterestChangeRequestSchema,
  DiscoveryRecommendationSearchRequestSchema,
  DiscoveryRecommendationStateRequestSchema,
  DiscoveryInterestSessionSettingRequestSchema,
  DiscoverySourceConnectRequestSchema,
  DiscoverySourceRefreshRequestSchema,
  DiscoverySourcesRefreshRequestSchema,
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

  ipcMain.handle(IPC_CHANNELS.discovery.preferenceDetails, createIpcRequestHandler({
    channel: IPC_CHANNELS.discovery.preferenceDetails, requestSchema: DiscoveryPreferenceDetailsRequestSchema,
    responseSchema: DiscoveryPreferenceDetailsResultSchema, logger: options.logger,
    handle: (request) => service.host.discovery.getPreferenceDetails(request.payload), mapError: mapDiscoveryIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.discovery.preferenceEvidence, createIpcRequestHandler({
    channel: IPC_CHANNELS.discovery.preferenceEvidence, requestSchema: DiscoveryPreferenceEvidenceRequestSchema,
    responseSchema: DiscoveryPreferenceEvidenceResultSchema, logger: options.logger,
    handle: (request) => service.host.discovery.getPreferenceEvidence(request.payload), mapError: mapDiscoveryIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.discovery.preferenceEdit, createIpcRequestHandler({
    channel: IPC_CHANNELS.discovery.preferenceEdit, requestSchema: DiscoveryPreferenceEditRequestSchema,
    responseSchema: DiscoveryPreferenceEditResultSchema, logger: options.logger,
    handle: (request) => service.host.discovery.editPreference(request.payload), mapError: mapDiscoveryIpcError,
  }));

  ipcMain.handle(IPC_CHANNELS.discovery.preferenceDelete, createIpcRequestHandler({
    channel: IPC_CHANNELS.discovery.preferenceDelete, requestSchema: DiscoveryPreferenceDeleteRequestSchema,
    responseSchema: DiscoveryPreferenceDeleteResultSchema, logger: options.logger,
    handle: (request) => service.host.discovery.deletePreference(request.payload), mapError: mapDiscoveryIpcError,
  }));


  ipcMain.handle(IPC_CHANNELS.discovery.candidateSupplyConfirm, createIpcRequestHandler({
    channel: IPC_CHANNELS.discovery.candidateSupplyConfirm,
    requestSchema: DiscoveryCandidateSupplyConfirmRequestSchema,
    responseSchema: DiscoveryCandidateSupplyConfirmResultSchema,
    logger: options.logger,
    handle: () => service.host.discovery.confirmCandidateSupply(),
    mapError: mapDiscoveryIpcError,
  }));

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
  ipcMain.handle(IPC_CHANNELS.discovery.sourceConnect, createIpcRequestHandler({
    channel: IPC_CHANNELS.discovery.sourceConnect,
    requestSchema: DiscoverySourceConnectRequestSchema,
    responseSchema: DiscoverySourceUiDtoSchema,
    responseValidation: 'dev-only',
    logger: options.logger,
    handle: (request) => service.host.discovery.connectSource(request.payload),
    mapError: mapDiscoveryIpcError,
  }));
  ipcMain.handle(IPC_CHANNELS.discovery.sourceRefresh, createIpcRequestHandler({
    channel: IPC_CHANNELS.discovery.sourceRefresh,
    requestSchema: DiscoverySourceRefreshRequestSchema,
    responseSchema: DiscoverySourceUiDtoSchema,
    responseValidation: 'dev-only',
    logger: options.logger,
    handle: (request) => service.host.discovery.refreshSource(request.payload),
    mapError: mapDiscoveryIpcError,
  }));
  ipcMain.handle(IPC_CHANNELS.discovery.sourcesRefresh, createIpcRequestHandler({
    channel: IPC_CHANNELS.discovery.sourcesRefresh,
    requestSchema: DiscoverySourcesRefreshRequestSchema,
    responseSchema: DiscoveryConfigurationUiDtoSchema,
    responseValidation: 'dev-only',
    logger: options.logger,
    handle: () => service.host.discovery.refreshSources(),
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
    requestSchema: DiscoveryInterestSessionSettingRequestSchema,
    responseSchema: DiscoveryInterestSessionSettingUiDtoSchema,
    responseValidation: 'dev-only',
    logger: options.logger,
    handle: (request) => service.host.discovery.setInterestSessionSetting(request.payload),
    mapError: mapDiscoveryIpcError,
  }));
  ipcMain.handle(IPC_CHANNELS.discovery.recommendationRequest, createIpcRequestHandler({
    channel: IPC_CHANNELS.discovery.recommendationRequest,
    requestSchema: DiscoveryRecommendationRequestSchema,
    responseSchema: DiscoveryRecommendationRequestResultSchema,
    responseValidation: 'dev-only',
    logger: options.logger,
    handle: (request) => service.host.discovery.requestRecommendation(request.payload),
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
    responseSchema: DiscoveryRecommendationStateResultSchema,
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
