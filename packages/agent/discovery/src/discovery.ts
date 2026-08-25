/*
 * Composes Megumi's content-discovery business operations. Execution is
 * injected as a capability; this module never creates or owns Agent runs.
 */
import {
  createDiscoveryConfiguration,
  type ConnectDiscoverySourceRequest,
  type DiscoveryConfigurationStore,
  type DiscoveryConfigurationView,
  type DiscoverySourceView,
  type UpdateDiscoveryConfigurationRequest,
} from './configuration/discovery-configuration';
import type {
  EnsureDailyDiscoveryRequest,
  EnsureDailyDiscoveryResult,
} from './daily-discovery/daily-discovery';
import {
  createDailyDiscoveryRuntime,
  type CreateDailyDiscoveryRuntimeOptions,
} from './daily-discovery/daily-discovery-runtime';
import type {
  DiscoveryHomeView,
  GetDiscoveryHomeRequest,
  RecommendationView,
  SearchRecommendationsRequest,
  SearchRecommendationsResult,
} from './discovery-view';
import type {
  ChangeInterestRequest,
  Interest,
  SessionParticipation,
  SetSessionParticipationRequest,
} from './interests/interest';
import {
  createDisabledInterestRuntime,
  createInterestRuntime,
  type CreateInterestRuntimeOptions,
  type ObserveConversationTurnRequest,
  type ObserveConversationTurnResult,
} from './interests/interest-runtime';
import type { UpdateRecommendationStateRequest } from './recommendations/recommendation';
import type { SourceRegistry } from './sources/source-registry';

export interface Discovery {
  changeInterest(request: ChangeInterestRequest): Promise<Interest>;
  setSessionParticipation(request: SetSessionParticipationRequest): Promise<SessionParticipation>;
  observeConversationTurn(request: ObserveConversationTurnRequest): ObserveConversationTurnResult;
  retractSessionEvidence(sessionId: string): Promise<void>;
  startBackground(): Promise<void>;
  ensureDailyDiscovery(request: EnsureDailyDiscoveryRequest): Promise<EnsureDailyDiscoveryResult>;
  getDiscoveryHome(request: GetDiscoveryHomeRequest): Promise<DiscoveryHomeView>;
  searchRecommendations(request: SearchRecommendationsRequest): Promise<SearchRecommendationsResult>;
  updateRecommendationState(request: UpdateRecommendationStateRequest): Promise<RecommendationView>;
  getDiscoveryConfiguration(): Promise<DiscoveryConfigurationView>;
  updateDiscoveryConfiguration(request: UpdateDiscoveryConfigurationRequest): Promise<DiscoveryConfigurationView>;
  connectDiscoverySource(request: ConnectDiscoverySourceRequest): Promise<DiscoverySourceView>;
  shutdown(): Promise<void>;
}

export interface CreateDiscoveryOptions {
  readonly interests?: CreateInterestRuntimeOptions;
  readonly dailyDiscovery?: CreateDailyDiscoveryRuntimeOptions & {
    readonly now: () => string;
  };
  readonly configuration?: {
    readonly sourceRegistry: SourceRegistry;
    readonly settings: DiscoveryConfigurationStore;
  };
}

export function createDiscovery(options: CreateDiscoveryOptions): Discovery {
  const interestRuntime = options.interests
    ? createInterestRuntime(options.interests)
    : createDisabledInterestRuntime();
  const dailyDiscoveryRuntime = options.dailyDiscovery
    ? createDailyDiscoveryRuntime(options.dailyDiscovery)
    : undefined;
  const discoveryConfiguration = options.configuration
    ? createDiscoveryConfiguration(options.configuration)
    : undefined;

  return {
    changeInterest: (request) => interestRuntime.changeInterest(request),
    setSessionParticipation: (request) => interestRuntime.setSessionParticipation(request),
    observeConversationTurn: (request) => interestRuntime.observeConversationTurn(request),
    retractSessionEvidence: (sessionId) => interestRuntime.retractSessionEvidence(sessionId),
    startBackground: () => dailyDiscoveryRuntime?.start() ?? Promise.resolve(),
    ensureDailyDiscovery: (request) => dailyDiscoveryRuntime
      ? dailyDiscoveryRuntime.ensure(request)
      : Promise.resolve({
          status: 'failed',
          localDate: request.now.slice(0, 10),
          failure: {
            code: 'daily_discovery_not_configured',
            message: 'Daily discovery is not configured.',
            retryable: false,
          },
        }),
    getDiscoveryHome: (request) => dailyDiscoveryRuntime
      ? Promise.resolve(dailyDiscoveryRuntime.getHome(request))
      : Promise.reject(new Error('Daily discovery is not configured.')),
    searchRecommendations: (request) => dailyDiscoveryRuntime
      ? Promise.resolve(dailyDiscoveryRuntime.searchRecommendations(request))
      : Promise.reject(new Error('Daily discovery is not configured.')),
    updateRecommendationState: (request) => dailyDiscoveryRuntime
      ? Promise.resolve(dailyDiscoveryRuntime.updateRecommendationState(request))
      : Promise.reject(new Error('Daily discovery is not configured.')),
    getDiscoveryConfiguration: () => discoveryConfiguration
      ? discoveryConfiguration.get()
      : Promise.reject(new Error('Discovery configuration is not configured.')),
    updateDiscoveryConfiguration: (request) => discoveryConfiguration
      ? discoveryConfiguration.update(request)
      : Promise.reject(new Error('Discovery configuration is not configured.')),
    connectDiscoverySource: (request) => discoveryConfiguration
      ? discoveryConfiguration.connectSource(request)
      : Promise.reject(new Error('Discovery configuration is not configured.')),
    async shutdown() {
      await Promise.all([
        interestRuntime.shutdown(),
        dailyDiscoveryRuntime?.shutdown() ?? Promise.resolve(),
      ]);
    },
  };
}
