/*
 * Composes Megumi's content-discovery business operations. Execution is
 * injected as a capability; this module never creates or owns Agent runs.
 */
import {
  createCandidateSupplyRuntime,
  type CreateCandidateSupplyRuntimeOptions,
} from './candidate-supply/candidate-supply-runtime';
import type {
  CandidatePoolSnapshot,
  CandidateSupplyResult,
  CandidateSupplyTrigger,
} from './candidate-supply/candidate-supply';
import { candidatePoolSettings } from './candidate-supply/candidate-pool';
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
  DailyRecommendationBatch,
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
  SearchRecommendationsRequest,
  SearchRecommendationsResult,
} from './discovery-view';
import type {
  ChangeInterestRequest,
  Interest,
  InterestEvidence,
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
import type { RecommendationStateResult } from './persistence/recommendation-repository';
import type { SourceRegistry } from './sources/source-registry';
import {
  createPreferenceLearningRuntime,
  type CreatePreferenceLearningRuntimeOptions,
} from './preferences/preference-learning-runtime';
import type {
  PreferenceLearningBatch,
  PreferenceLearningCompletion,
} from './preferences/preference';

export interface InterestFacts {
  readonly interests: readonly Interest[];
  readonly evidence: readonly InterestEvidence[];
}

export interface Discovery {
  /** Applies one explicit user Interest change. */
  changeInterest(request: ChangeInterestRequest): Promise<Interest>;
  /** Controls whether one Session contributes Interest Evidence. */
  setSessionParticipation(request: SetSessionParticipationRequest): Promise<SessionParticipation>;
  /** Enqueues one completed conversation turn for Interest extraction when eligible. */
  observeConversationTurn(request: ObserveConversationTurnRequest): ObserveConversationTurnResult;
  /** Reads exact Interest and Evidence business entities by their database identities. */
  getInterestFacts(request: {
    readonly interestIds: readonly string[];
    readonly evidenceIds: readonly string[];
  }): InterestFacts;
  /** Retracts the Evidence contributed by one Session. */
  retractSessionEvidence(sessionId: string): Promise<void>;
  /** Starts owned recovery and optionally enables automatic background triggers. */
  startBackground(options?: { readonly automaticTriggers?: boolean }): Promise<void>;
  /** Ensures the requested Daily Recommendation Batch according to its trigger semantics. */
  ensureDailyRecommendation(request: EnsureDailyRecommendationRequest): Promise<EnsureDailyRecommendationResult>;
  getDailyRecommendationBatch(localDate: string): DailyRecommendationBatch | undefined;
  requestCandidateSupply(trigger?: CandidateSupplyTrigger): Promise<CandidateSupplyResult> | undefined;
  /** Reads the current Candidate Pool through Candidate Supply's rules. */
  getCandidatePoolSnapshot(): CandidatePoolSnapshot | undefined;
  getPreferenceLearningBatch(batchId: string): PreferenceLearningBatch | undefined;
  getPreferenceLearningCompletion(feedbackChangeId: string): PreferenceLearningCompletion | undefined;
  /** Reads the persisted Discovery Home projection. */
  getDiscoveryHome(request: GetDiscoveryHomeRequest): Promise<DiscoveryHomeView>;
  /** Searches persisted Recommendations rather than external Sources. */
  searchRecommendations(request: SearchRecommendationsRequest): Promise<SearchRecommendationsResult>;
  /** Applies one user-controlled Recommendation state change. */
  updateRecommendationState(request: UpdateRecommendationStateRequest): Promise<RecommendationStateResult>;
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
  readonly dailyRecommendation?: CreateDailyRecommendationRuntimeOptions;
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
  const preferenceLearningRuntime = options.preferenceLearning
    ? createPreferenceLearningRuntime(options.preferenceLearning)
    : undefined;
  const dailyRecommendationRuntime = options.dailyRecommendation
    ? createDailyRecommendationRuntime({
        ...options.dailyRecommendation,
        notifyPreferenceLearning: () => preferenceLearningRuntime?.notifyFeedbackChanged(),
      })
    : undefined;
  const candidateSupplyRuntime = options.candidateSupply
    ? createCandidateSupplyRuntime(options.candidateSupply)
    : undefined;
  const interestRuntime = options.interests
    ? createInterestRuntime({
        ...options.interests,
        onInterestsChanged: (interestIds) => {
          options.interests?.onInterestsChanged?.(interestIds);
          requestCandidateSupply(candidateSupplyRuntime, 'interest_changed', options);
        },
      })
    : createDisabledInterestRuntime();
  const discoveryConfiguration = options.configuration
    ? createDiscoveryConfiguration(options.configuration)
    : undefined;

  return {
    async changeInterest(request) {
      const interest = await interestRuntime.changeInterest(request);
      requestCandidateSupply(candidateSupplyRuntime, 'interest_changed', options);
      return interest;
    },
    setSessionParticipation: (request) => interestRuntime.setSessionParticipation(request),
    observeConversationTurn: (request) => interestRuntime.observeConversationTurn(request),
    getInterestFacts: (request) => interestRuntime.getInterestFacts(request),
    retractSessionEvidence: (sessionId) => interestRuntime.retractSessionEvidence(sessionId),
    async startBackground(startOptions = {}) {
      const automaticTriggers = startOptions.automaticTriggers ?? true;
      const failures: unknown[] = [];
      await runBackgroundStartStep(options, failures, 'source_refresh', async () => {
        if (!discoveryConfiguration) return;
        const configuration = await discoveryConfiguration.get();
        await discoveryConfiguration.refreshSources(
          configuration.sources.filter((source) => source.enabled).map((source) => source.sourceId),
        );
      });
      await runBackgroundStartStep(options, failures, 'candidate_supply_start', async () => {
        await candidateSupplyRuntime?.start({ automaticTriggers });
      });
      await runBackgroundStartStep(options, failures, 'preference_learning_start', async () => {
        await preferenceLearningRuntime?.start({ automaticTriggers });
      });
      await runBackgroundStartStep(options, failures, 'daily_recommendation_start', async () => {
        await dailyRecommendationRuntime?.start({ automaticTriggers });
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
    getDailyRecommendationBatch: (localDate) => dailyRecommendationRuntime?.getBatch(localDate),
    requestCandidateSupply: (trigger = 'supply_conditions_changed') => (
      candidateSupplyRuntime?.requestCheck(trigger)
    ),
    getCandidatePoolSnapshot: () => {
      if (!options.candidateSupply) return undefined;
      const settings = options.candidateSupply.settings.read();
      return options.candidateSupply.repository.readCandidatePoolSnapshot(candidatePoolSettings({
        minimumCount: settings.candidatePoolMinimumCount,
        maximumCount: settings.candidatePoolMaximumCount,
        candidateValidityDays: settings.candidateValidityDays,
      }));
    },
    getPreferenceLearningBatch: (id) => options.preferenceLearning?.repository.getPreferenceLearningBatch(id),
    getPreferenceLearningCompletion: (id) => (
      options.preferenceLearning?.repository.getPreferenceLearningCompletion(id)
    ),
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
      requestCandidateSupply(candidateSupplyRuntime, 'supply_conditions_changed', options);
      return view;
    },
    async connectDiscoverySource(request) {
      if (!discoveryConfiguration) throw new Error('Discovery configuration is not configured.');
      const view = await discoveryConfiguration.connectSource(request);
      requestCandidateSupply(candidateSupplyRuntime, 'supply_conditions_changed', options);
      return view;
    },
    async refreshDiscoverySource(request) {
      if (!discoveryConfiguration) throw new Error('Discovery configuration is not configured.');
      const view = await discoveryConfiguration.refreshSource(request);
      requestCandidateSupply(candidateSupplyRuntime, 'supply_conditions_changed', options);
      return view;
    },
    async refreshDiscoverySources() {
      if (!discoveryConfiguration) throw new Error('Discovery configuration is not configured.');
      const view = await discoveryConfiguration.refreshSources();
      requestCandidateSupply(candidateSupplyRuntime, 'supply_conditions_changed', options);
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

function requestCandidateSupply(
  runtime: ReturnType<typeof createCandidateSupplyRuntime> | undefined,
  trigger: CandidateSupplyTrigger,
  options: CreateDiscoveryOptions,
): void {
  if (!runtime) return;
  void runtime.requestCheck(trigger).catch((error) => {
    try {
      options.onBackgroundError?.(error, { operation: 'candidate_supply_start' });
    } catch {
      // The observer is the terminal boundary for a background diagnostic.
    }
  });
}
