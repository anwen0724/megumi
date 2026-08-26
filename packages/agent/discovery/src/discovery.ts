/*
 * Composes Megumi's content-discovery business operations. Execution is
 * injected as a capability; this module never creates or owns Agent runs.
 */
import {
  createCandidateSupplyRuntime,
  type CreateCandidateSupplyRuntimeOptions,
} from './candidate-supply/candidate-supply-runtime';
import {
  createDiscoveryConfiguration,
  type ConnectDiscoverySourceRequest,
  type DiscoveryConfigurationStore,
  type DiscoveryConfigurationView,
  type DiscoverySourceView,
  type RefreshDiscoverySourceRequest,
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
  /** Applies one explicit user Interest change. */
  changeInterest(request: ChangeInterestRequest): Promise<Interest>;
  /** Controls whether one Session contributes Interest Evidence. */
  setSessionParticipation(request: SetSessionParticipationRequest): Promise<SessionParticipation>;
  /** Enqueues one completed conversation turn for Interest extraction when eligible. */
  observeConversationTurn(request: ObserveConversationTurnRequest): ObserveConversationTurnResult;
  /** Retracts the Evidence contributed by one Session. */
  retractSessionEvidence(sessionId: string): Promise<void>;
  /** Starts owned background recovery and Daily Discovery scheduling. */
  startBackground(): Promise<void>;
  /** Ensures the requested Daily Discovery Batch according to its trigger semantics. */
  ensureDailyDiscovery(request: EnsureDailyDiscoveryRequest): Promise<EnsureDailyDiscoveryResult>;
  /** Reads the persisted Discovery Home projection. */
  getDiscoveryHome(request: GetDiscoveryHomeRequest): Promise<DiscoveryHomeView>;
  /** Searches persisted Recommendations rather than external Sources. */
  searchRecommendations(request: SearchRecommendationsRequest): Promise<SearchRecommendationsResult>;
  /** Applies one user-controlled Recommendation state change. */
  updateRecommendationState(request: UpdateRecommendationStateRequest): Promise<RecommendationView>;
  /** Reads the current user-facing Discovery configuration. */
  getDiscoveryConfiguration(): Promise<DiscoveryConfigurationView>;
  /** Validates and persists user-facing Discovery configuration changes. */
  updateDiscoveryConfiguration(request: UpdateDiscoveryConfigurationRequest): Promise<DiscoveryConfigurationView>;
  /** Starts the interactive connection flow for one browser-session Source. */
  connectDiscoverySource(request: ConnectDiscoverySourceRequest): Promise<DiscoverySourceView>;
  /** Rechecks one Source without opening its interactive connection flow. */
  refreshDiscoverySource(request: RefreshDiscoverySourceRequest): Promise<DiscoverySourceView>;
  /** Rechecks every registered Source and returns one complete projection. */
  refreshDiscoverySources(): Promise<DiscoveryConfigurationView>;
  /** Stops and drains every background activity owned by Discovery. */
  shutdown(): Promise<void>;
}

export interface CreateDiscoveryOptions {
  readonly interests?: CreateInterestRuntimeOptions;
  readonly dailyDiscovery?: CreateDailyDiscoveryRuntimeOptions & {
    readonly now: () => string;
  };
  readonly candidateSupply?: CreateCandidateSupplyRuntimeOptions;
  readonly configuration?: {
    readonly sourceRegistry: SourceRegistry;
    readonly settings: DiscoveryConfigurationStore;
  };
}

/** Composes Megumi's Discovery business operations from its optional capabilities. */
export function createDiscovery(options: CreateDiscoveryOptions): Discovery {
  const interestRuntime = options.interests
    ? createInterestRuntime(options.interests)
    : createDisabledInterestRuntime();
  const dailyDiscoveryRuntime = options.dailyDiscovery
    ? createDailyDiscoveryRuntime(options.dailyDiscovery)
    : undefined;
  const candidateSupplyRuntime = options.candidateSupply
    ? createCandidateSupplyRuntime(options.candidateSupply)
    : undefined;
  const discoveryConfiguration = options.configuration
    ? createDiscoveryConfiguration(options.configuration)
    : undefined;

  return {
    async changeInterest(request) {
      const interest = await interestRuntime.changeInterest(request);
      options.candidateSupply?.repository.invalidateAdmissions({
        interestIds: [interest.interestId],
        now: options.candidateSupply.now(),
      });
      candidateSupplyRuntime?.notify('interest_changed');
      return interest;
    },
    setSessionParticipation: (request) => interestRuntime.setSessionParticipation(request),
    observeConversationTurn: (request) => interestRuntime.observeConversationTurn(request),
    retractSessionEvidence: (sessionId) => interestRuntime.retractSessionEvidence(sessionId),
    async startBackground() {
      await discoveryConfiguration?.refreshSources();
      await candidateSupplyRuntime?.start();
      await dailyDiscoveryRuntime?.start();
    },
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
    async updateDiscoveryConfiguration(request) {
      if (!discoveryConfiguration) throw new Error('Discovery configuration is not configured.');
      const view = await discoveryConfiguration.update(request);
      candidateSupplyRuntime?.notify('configuration_changed');
      return view;
    },
    async connectDiscoverySource(request) {
      if (!discoveryConfiguration) throw new Error('Discovery configuration is not configured.');
      const view = await discoveryConfiguration.connectSource(request);
      candidateSupplyRuntime?.notify('configuration_changed');
      return view;
    },
    async refreshDiscoverySource(request) {
      if (!discoveryConfiguration) throw new Error('Discovery configuration is not configured.');
      const view = await discoveryConfiguration.refreshSource(request);
      candidateSupplyRuntime?.notify('configuration_changed');
      return view;
    },
    async refreshDiscoverySources() {
      if (!discoveryConfiguration) throw new Error('Discovery configuration is not configured.');
      const view = await discoveryConfiguration.refreshSources();
      candidateSupplyRuntime?.notify('configuration_changed');
      return view;
    },
    async shutdown() {
      await Promise.all([
        interestRuntime.shutdown(),
        dailyDiscoveryRuntime?.shutdown() ?? Promise.resolve(),
        candidateSupplyRuntime?.shutdown() ?? Promise.resolve(),
      ]);
    },
  };
}
