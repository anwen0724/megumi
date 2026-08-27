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
  EnsureDailyRecommendationRequest,
  EnsureDailyRecommendationResult,
} from './daily-recommendation/daily-recommendation';
import {
  createDailyRecommendationRuntime,
  type CreateDailyRecommendationRuntimeOptions,
} from './daily-recommendation/daily-recommendation-runtime';
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
import {
  createPreferenceLearningRuntime,
  type CreatePreferenceLearningRuntimeOptions,
} from './preferences/preference-learning-runtime';

export interface Discovery {
  /** Applies one explicit user Interest change. */
  changeInterest(request: ChangeInterestRequest): Promise<Interest>;
  /** Controls whether one Session contributes Interest Evidence. */
  setSessionParticipation(request: SetSessionParticipationRequest): Promise<SessionParticipation>;
  /** Enqueues one completed conversation turn for Interest extraction when eligible. */
  observeConversationTurn(request: ObserveConversationTurnRequest): ObserveConversationTurnResult;
  /** Retracts the Evidence contributed by one Session. */
  retractSessionEvidence(sessionId: string): Promise<void>;
  /** Starts owned background recovery and Daily Recommendation scheduling. */
  startBackground(): Promise<void>;
  /** Ensures the requested Daily Recommendation Batch according to its trigger semantics. */
  ensureDailyRecommendation(request: EnsureDailyRecommendationRequest): Promise<EnsureDailyRecommendationResult>;
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
  readonly dailyRecommendation?: Omit<CreateDailyRecommendationRuntimeOptions, 'notifyCandidateSupply'>;
  readonly candidateSupply?: CreateCandidateSupplyRuntimeOptions;
  readonly preferenceLearning?: CreatePreferenceLearningRuntimeOptions;
  readonly configuration?: {
    readonly sourceRegistry: SourceRegistry;
    readonly settings: DiscoveryConfigurationStore;
  };
  readonly onBackgroundError?: (
    error: unknown,
    context: {
      readonly operation: 'source_refresh' | 'candidate_supply_start'
        | 'preference_learning_start' | 'daily_recommendation_start';
    },
  ) => void;
}

/** Composes Megumi's Discovery business operations from its optional capabilities. */
export function createDiscovery(options: CreateDiscoveryOptions): Discovery {
  let candidateSupplyRuntime: ReturnType<typeof createCandidateSupplyRuntime> | undefined;
  const preferenceLearningRuntime = options.preferenceLearning
    ? createPreferenceLearningRuntime({
        ...options.preferenceLearning,
        onPreferencesCommitted: (interestIds) => {
          options.preferenceLearning?.onPreferencesCommitted?.(interestIds);
          if (!options.candidateSupply || interestIds.length === 0) return;
          options.candidateSupply.repository.invalidateAdmissions({
            interestIds,
            now: options.candidateSupply.now(),
          });
          candidateSupplyRuntime?.notify('candidate_state_changed');
        },
      })
    : undefined;
  const dailyRecommendationRuntime = options.dailyRecommendation
    ? createDailyRecommendationRuntime({
        ...options.dailyRecommendation,
        notifyCandidateSupply: () => candidateSupplyRuntime?.notify('consumer_shortfall'),
        notifyPreferenceLearning: () => preferenceLearningRuntime?.notifyFeedbackChanged(),
      })
    : undefined;
  candidateSupplyRuntime = options.candidateSupply
    ? createCandidateSupplyRuntime({
        ...options.candidateSupply,
        onPoolAvailable: () => {
          options.candidateSupply?.onPoolAvailable?.();
          dailyRecommendationRuntime?.notifyCandidatesAvailable();
        },
      })
    : undefined;
  const interestRuntime = options.interests
    ? createInterestRuntime({
        ...options.interests,
        onInterestsChanged: (interestIds) => {
          options.interests?.onInterestsChanged?.(interestIds);
          options.candidateSupply?.repository.invalidateAdmissions({
            interestIds,
            now: options.candidateSupply.now(),
          });
          candidateSupplyRuntime?.notify('interest_changed');
        },
      })
    : createDisabledInterestRuntime();
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
      const failures: unknown[] = [];
      await runBackgroundStartStep(options, failures, 'source_refresh', async () => {
        await discoveryConfiguration?.refreshSources();
      });
      await runBackgroundStartStep(options, failures, 'candidate_supply_start', async () => {
        await candidateSupplyRuntime?.start();
      });
      await runBackgroundStartStep(options, failures, 'preference_learning_start', async () => {
        await preferenceLearningRuntime?.start();
      });
      await runBackgroundStartStep(options, failures, 'daily_recommendation_start', async () => {
        await dailyRecommendationRuntime?.start();
      });
      if (failures.length > 0) {
        throw new AggregateError(failures, 'One or more Discovery background startup steps failed.');
      }
    },
    ensureDailyRecommendation: (request) => dailyRecommendationRuntime
      ? dailyRecommendationRuntime.ensure(request)
      : Promise.resolve({
          status: 'failed',
          localDate: request.now.slice(0, 10),
          failure: {
            code: 'daily_recommendation_not_configured',
            message: 'Daily Recommendation is not configured.',
            retryable: false,
          },
        }),
    getDiscoveryHome: (request) => dailyRecommendationRuntime
      ? Promise.resolve(dailyRecommendationRuntime.getHome(request))
      : Promise.reject(new Error('Daily Recommendation is not configured.')),
    searchRecommendations: (request) => dailyRecommendationRuntime
      ? Promise.resolve(dailyRecommendationRuntime.searchRecommendations(request))
      : Promise.reject(new Error('Daily Recommendation is not configured.')),
    updateRecommendationState: (request) => dailyRecommendationRuntime
      ? Promise.resolve(dailyRecommendationRuntime.updateRecommendationState(request))
      : Promise.reject(new Error('Daily Recommendation is not configured.')),
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
        dailyRecommendationRuntime?.shutdown() ?? Promise.resolve(),
        candidateSupplyRuntime?.shutdown() ?? Promise.resolve(),
        preferenceLearningRuntime?.shutdown() ?? Promise.resolve(),
      ]);
    },
  };
}

/** Keeps independent Discovery background owners startable after one startup step fails. */
async function runBackgroundStartStep(
  options: CreateDiscoveryOptions,
  failures: unknown[],
  operation: 'source_refresh' | 'candidate_supply_start'
    | 'preference_learning_start' | 'daily_recommendation_start',
  start: () => Promise<void>,
): Promise<void> {
  try {
    await start();
  } catch (error) {
    failures.push(error);
    try {
      options.onBackgroundError?.(error, { operation });
    } catch {
      // The observer is the terminal boundary for a best-effort startup diagnostic.
    }
  }
}
